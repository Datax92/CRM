import { adminDb } from "@/lib/firebase/server";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import type { DecodedAuth } from "@/lib/firebase/serverAuth";
import { archiveInTransaction } from "@/lib/server/deletedArchive";
import { readLoan } from "@/lib/spendingLoan";

/**
 * Server-only pieces of the loan feature (`lib/spendingLoan`) that the ledger's
 * own delete/reverse paths need. Kept out of a `"use server"` file on purpose:
 * every export there is an endpoint a browser can call, and these take a
 * verified caller as an argument.
 */

export const LOAN_KINDS = { TXN: "transactions", TICKET: "capitalSpendings" } as const;
export type LoanKind = keyof typeof LOAN_KINDS;

const TRANSACTIONS = "transactions";
const ACCOUNTS = "accounts";

const money = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

/** What a spending has actually lent: a typed outflow's amount, a record's payments. */
export function lentOf(kind: LoanKind, data: Record<string, unknown>): number {
  return kind === "TXN" ? money(data.amount) : money(data.paidAmount);
}

/**
 * Takes one repayment off: the row, and its amount off the loan, so the
 * borrower owes it again. The row is copied to `deletedRecords` first.
 */
export async function removeLoanReturn(auth: DecodedAuth, legId: string): Promise<void> {
  const legRef = adminDb.collection(TRANSACTIONS).doc(legId);
  const move = await adminDb.runTransaction(async (t: Transaction) => {
    const legSnap = await t.get(legRef);
    if (!legSnap.exists) return null;
    const leg = legSnap.data()!;
    const kind: LoanKind = leg.loanKind === "TICKET" ? "TICKET" : "TXN";
    const loanRef = leg.sourceId ? adminDb.collection(LOAN_KINDS[kind]).doc(leg.sourceId as string) : null;
    const loanSnap = loanRef ? await t.get(loanRef) : null;

    archiveInTransaction(t, legSnap, auth, "LOAN_RETURN_REMOVED");
    t.delete(legRef);

    const amount = money(leg.amount);
    if (loanRef && loanSnap?.exists) {
      const data = loanSnap.data()!;
      const now = Math.max(0, money(money(data.loanReturned) - amount));
      t.update(loanRef, {
        loanReturned: now,
        history: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: "LOAN_RETURN_REMOVED",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
          amount,
          accountId: leg.accountId ?? null,
        }),
      });
    }
    return (leg.status ?? "POSTED") === "POSTED"
      ? { accountId: leg.accountId as string, delta: leg.direction === "IN" ? -amount : amount }
      : null;
  });
  if (move) {
    await adminDb.collection(ACCOUNTS).doc(move.accountId).update({
      cachedBalance: FieldValue.increment(move.delta),
    }).catch(() => undefined);
  }
}

/**
 * Why a ledger row cannot be removed or reversed because of a loan — or null.
 *
 * - a typed outflow marked as a loan, with money already back on it: removing
 *   it would leave repayments against a loan that no longer exists;
 * - a payment on a spending record marked as a loan, when taking it off would
 *   leave less lent than has already been repaid.
 */
export async function loanBlocksRemoval(row: Record<string, unknown>): Promise<string | null> {
  if (row.sourceModule === "MANUAL" && row.type === "LOAN" && money(row.loanReturned) > 0) {
    return "Money has already come back on this loan. Remove those returns before removing or reversing it.";
  }
  if (row.sourceModule === "CAPITAL_INVESTMENT" && typeof row.sourceId === "string" && row.direction === "OUT") {
    const ticket = await adminDb.collection(LOAN_KINDS.TICKET).doc(row.sourceId).get();
    if (!ticket.exists) return null;
    const data = ticket.data()!;
    const loan = readLoan(data, data.paidAmount);
    if (loan.isLoan && loan.returned > money(money(data.paidAmount) - money(row.amount))) {
      return "Part of this loan has already come back. Remove those returns before taking this payment off.";
    }
  }
  return null;
}
