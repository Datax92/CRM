"use server";

/**
 * Loans out of an account — the write side of `lib/spendingLoan`.
 *
 * The owner's words (2026-10-19): money in FAYSAL CC and UBL CC went to
 * Muhammad Hussain; "I wrote that the money was used here; when it comes back
 * I want to put it back here in the system." So a spending can be marked as a
 * loan (its money then moves as `LOAN`, which no income or spending reading
 * counts) and the borrower's repayments are recorded against it.
 *
 * Every write re-reads the spending inside a Firestore transaction, so two
 * people recording the same repayment cannot return more than was lent.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey } from "@/lib/dates";
import { money } from "@/lib/ledger";
import { checkLoanReturn, checkLoanToggle, loanReturnLabel, normalizeBorrower, readLoan } from "@/lib/spendingLoan";
import { LOAN_KINDS, lentOf, type LoanKind } from "@/lib/server/loanLedger";
import { FieldValue, type Transaction } from "firebase-admin/firestore";

const TRANSACTIONS = "transactions";
const ACCOUNTS = "accounts";

async function requireFinance(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (!auth.isHr) throw new UserFacingError("Only an administrator or HR can do this.");
  return auth;
}

const kindOf = (raw: unknown): LoanKind => (raw === "TICKET" ? "TICKET" : "TXN");

/**
 * Marks a spending as a loan to somebody, or back to a plain spending
 * (`borrower` null or empty).
 *
 * - a hand-typed outflow is retyped `LOAN` (or back to `EXPENSE`);
 * - a spending record keeps its type on the record, and every payment made on
 *   it is retyped, so the money that already left reads as lent.
 *
 * Renaming the borrower on a loan is the same call with a new name.
 */
export async function setSpendingLoan(
  token: string,
  input: { kind: "TXN" | "TICKET"; id: string; borrower: string | null }
): Promise<ActionResult<{ isLoan: boolean; retyped: number }>> {
  return runAction("setSpendingLoan", async () => {
    const auth = await requireFinance(token);
    const kind = kindOf(input.kind);
    const borrower = normalizeBorrower(input.borrower);
    const makeLoan = Boolean(borrower);
    const ref = adminDb.collection(LOAN_KINDS[kind]).doc(input.id);

    return adminDb.runTransaction(async (t: Transaction) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new UserFacingError("That spending no longer exists.");
      const data = snap.data()!;
      const current = readLoan(data, lentOf(kind, data));

      if (kind === "TXN") {
        const plain = data.type === "EXPENSE" || data.type === "LOAN";
        if (
          data.sourceModule !== "MANUAL" || data.direction !== "OUT" || !plain ||
          (data.status ?? "POSTED") !== "POSTED" || data.reversedBy || data.reversalOf
        ) {
          throw new UserFacingError("Only money typed straight out of an account can be marked as a loan.");
        }
      }

      const errors = checkLoanToggle({ makeLoan, borrower, returned: current.returned, paidBack: money(data.paidBack) });
      if (errors.length > 0) throw new UserFacingError(errors[0]);

      // A spending record's payments: read before any write (Firestore's rule).
      const legs = kind === "TICKET"
        ? (await t.get(
            adminDb.collection(TRANSACTIONS)
              .where("sourceModule", "==", "CAPITAL_INVESTMENT")
              .where("sourceId", "==", input.id)
          )).docs
        : [];

      const from = makeLoan ? "EXPENSE" : "LOAN";
      const to = makeLoan ? "LOAN" : "EXPENSE";
      let retyped = 0;
      for (const leg of legs) {
        if (leg.data().type !== from) continue;
        t.update(leg.ref, { type: to, updatedAt: FieldValue.serverTimestamp(), updatedByUid: auth.uid });
        retyped += 1;
      }

      t.update(ref, {
        ...(kind === "TXN" ? { type: to } : {}),
        loanTo: makeLoan ? borrower : FieldValue.delete(),
        loanReturned: makeLoan ? current.returned : FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: auth.uid,
        history: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: makeLoan ? (current.isLoan ? "LOAN_RENAMED" : "MARKED_LOAN") : "UNMARKED_LOAN",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
          detail: makeLoan ? `Lent to ${borrower}` : current.to ? `Was lent to ${current.to}` : null,
        }),
      });

      return { isLoan: makeLoan, retyped };
    });
  });
}

export interface LoanReturnInput {
  kind: "TXN" | "TICKET";
  /** The loan: a hand-typed outflow, or a spending record. */
  id: string;
  /** The account the money came back into. */
  accountId: string;
  amount: number;
  dayKey?: string;
  note?: string | null;
}

/**
 * Records money a borrower gave back: one `LOAN_RETURN` row into the account
 * it came back to, and its amount on the loan.
 *
 * Typed `LOAN`, so it is not income, and `capitalPot` treats it as money
 * coming home rather than money put in.
 */
export async function recordLoanReturn(
  token: string,
  input: LoanReturnInput
): Promise<ActionResult<{ transactionId: string; owed: number; settled: boolean }>> {
  return runAction("recordLoanReturn", async () => {
    const auth = await requireFinance(token);
    const kind = kindOf(input.kind);
    const amount = money(input.amount);
    const dayKey = input.dayKey && /^\d{4}-\d{2}-\d{2}$/.test(input.dayKey) ? input.dayKey : karachiDayKey();
    const loanRef = adminDb.collection(LOAN_KINDS[kind]).doc(input.id);
    const accountRef = adminDb.collection(ACCOUNTS).doc((input.accountId ?? "").trim() || "_");
    const rowRef = adminDb.collection(TRANSACTIONS).doc();

    const result = await adminDb.runTransaction(async (t: Transaction) => {
      const [loanSnap, accountSnap] = await Promise.all([t.get(loanRef), t.get(accountRef)]);
      if (!loanSnap.exists) throw new UserFacingError("That loan no longer exists.");
      if (!accountSnap.exists) throw new UserFacingError("Choose the account the money came back into.");
      if (accountSnap.data()?.status === "ARCHIVED") {
        throw new UserFacingError(`${accountSnap.data()?.name ?? "That account"} is archived. Choose another.`);
      }
      const data = loanSnap.data()!;
      const loan = readLoan(data, lentOf(kind, data));
      if (!loan.isLoan) throw new UserFacingError("This is not marked as a loan.");

      // **The guard, inside the transaction**, against what is owed right now.
      const errors = checkLoanReturn({ owed: loan.owed, amount, borrower: loan.to });
      if (errors.length > 0) throw new UserFacingError(errors[0]);

      const label = kind === "TXN" ? String(data.sourceLabel ?? "") : String(data.title ?? "");
      t.create(rowRef, {
        accountId: accountRef.id,
        direction: "IN",
        amount,
        type: "LOAN",
        dayKey,
        sourceModule: "LOAN_RETURN",
        sourceId: loanRef.id,
        loanKind: kind,
        // The account the loan went out of, so a statement can name both sides.
        counterAccountId: kind === "TXN" ? (data.accountId as string) : (data.investmentId as string) ?? null,
        sourceLabel: loanReturnLabel(loan.to, label),
        groupId: null,
        status: "POSTED",
        note: (input.note ?? "").trim() || null,
        createdByUid: auth.uid,
        createdByName: auth.name ?? auth.email ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });

      const returned = money(loan.returned + amount);
      t.update(loanRef, {
        loanReturned: returned,
        history: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: "LOAN_RETURNED",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
          amount,
          accountId: accountRef.id,
          detail: `Back into ${accountSnap.data()?.name ?? "an account"}`,
        }),
      });
      const owed = money(loan.lent - returned);
      return { owed, settled: owed <= 0 };
    });

    await accountRef.update({ cachedBalance: FieldValue.increment(amount) }).catch(() => undefined);
    return { transactionId: rowRef.id, ...result };
  });
}
