"use server";

/**
 * Capital Investment — a venture, what went into it, and what it cost.
 *
 * **Read from the owner's own `CAPITAL INVESTMENT` sheet**, not invented. Each
 * block on it is a named pot with two columns:
 *
 * ```
 *   STATE LIFE LOAN                          SPENDINGS
 *   Amount Received | Description            Amount Spent | Description
 *   1,192,500       | STATE LIFE LOAN        152,000      | CULTUS (…)
 *     428,000       | DADDY 8 MARCH           23,000      | CHEQUE KI PAYMENT
 *     130,000       | APIL COMMITTEE 270     225,000      | FEB COMMITTEE GIVEN
 * ```
 *
 * Two facts follow from that shape and they are the whole design:
 *
 * 1. **The money goes in more than once.** A venture is not one investment, it
 *    is a pot somebody keeps adding to — three rows and a gap for the next.
 *    So a contribution is an ordinary `IN` transaction on the pot's account
 *    (`addManualTransaction`), which is why there is no action for it here.
 *
 * 2. **A spending is an obligation, and what funds it is a separate question.**
 *    The owner asked for exactly this: *"I can choose from where I should pay,
 *    which account — basically which income, like committee."* A spending on
 *    the State Life Loan venture might be paid out of the Committee, out of
 *    StateLife commission, or out of the venture's own pot. So a spending is a
 *    record, and `payFromAccounts` funds it from one or more accounts — the
 *    same control an office expense uses, with the same duplicate-payment
 *    guard and the same split arithmetic.
 *
 * Which means the venture has **two totals that are not the same number**, and
 * both are true: what the pot holds (contributions less what was paid *out of
 * it*), and what the venture has cost (every spending, whoever funded it).
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, requireAdmin, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey } from "@/lib/dates";
import { money } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { FieldValue } from "firebase-admin/firestore";

const SPENDINGS = "capitalSpendings";
const ACCOUNTS = "accounts";
const TRANSACTIONS = "transactions";

async function requireFinance(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (!auth.isHr) throw new UserFacingError("Only an administrator or HR can do this.");
  return auth;
}

const dayOrToday = (raw?: string) =>
  raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : karachiDayKey();

export interface CapitalSpendingInput {
  /** The investment account this spending belongs to. */
  investmentId: string;
  title: string;
  amount: number;
  dayKey?: string;
  description?: string | null;
}

/**
 * Records — or corrects — one spending against a venture.
 *
 * The amount is the obligation and is never changed by paying it, exactly as an
 * office expense works. What it may not do is fall **below what has already
 * been paid**: the transactions funding it are real movements and are not
 * rewritten by editing the record, so a smaller figure would leave one
 * insisting it was over-funded.
 */
export async function saveCapitalSpending(
  token: string,
  input: CapitalSpendingInput,
  spendingId?: string
): Promise<ActionResult<{ spendingId: string }>> {
  return runAction("saveCapitalSpending", async () => {
    const auth = await requireFinance(token);

    const title = (input.title ?? "").trim();
    if (!title) throw new UserFacingError("Say what the money went on.");
    const amount = money(input.amount);
    if (amount <= 0) throw new UserFacingError("Enter an amount greater than zero.");

    const investmentId = (input.investmentId ?? "").trim();
    if (!investmentId) throw new UserFacingError("Choose which investment this belongs to.");
    const account = await adminDb.collection(ACCOUNTS).doc(investmentId).get();
    if (!account.exists) throw new UserFacingError("That investment no longer exists.");

    const payload = {
      investmentId,
      // Denormalised so a row needs no join, and **frozen**: renaming the pot
      // must not rewrite what an existing spending says it was filed under.
      investmentName: (account.data()?.name as string) ?? null,
      title,
      amount,
      dayKey: dayOrToday(input.dayKey),
      description: (input.description ?? "").trim() || null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: auth.uid,
    };

    if (spendingId) {
      const ref = adminDb.collection(SPENDINGS).doc(spendingId);
      const snap = await ref.get();
      if (!snap.exists) throw new UserFacingError("That spending no longer exists.");

      const paidSoFar = money(snap.data()?.paidAmount);
      if (paidSoFar > 0 && amount < paidSoFar) {
        throw new UserFacingError(
          `${formatMoney(paidSoFar)} has already been paid against this. Remove that payment before reducing it.`
        );
      }

      await ref.update({
        ...payload,
        history: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: "EDITED",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
        }),
      });
      return { spendingId };
    }

    const ref = adminDb.collection(SPENDINGS).doc();
    await ref.create({
      ...payload,
      paidAmount: 0,
      paymentStatus: "UNPAID",
      createdByUid: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      history: [
        {
          at: new Date().toISOString(),
          action: "CREATED",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
        },
      ],
    });
    return { spendingId: ref.id };
  });
}

/**
 * Deletes a spending, and the payments made against it.
 *
 * Same rule the personal expense delete follows, for the same reason: leaving
 * transactions pointing at a record that no longer exists would show money gone
 * from an account for nothing. The movements go and the balances are put back.
 */
export async function deleteCapitalSpending(
  token: string,
  spendingId: string
): Promise<ActionResult<{ removedPayments: number; restored: number }>> {
  return runAction("deleteCapitalSpending", async () => {
    await requireAdmin(token);

    const ref = adminDb.collection(SPENDINGS).doc(spendingId);
    if (!(await ref.get()).exists) throw new UserFacingError("That spending no longer exists.");

    const legs = await adminDb
      .collection(TRANSACTIONS)
      .where("sourceModule", "==", "CAPITAL_INVESTMENT")
      .where("sourceId", "==", spendingId)
      .get();

    const restore = new Map<string, number>();
    const batch = adminDb.batch();
    for (const leg of legs.docs) {
      const row = leg.data();
      const accountId = row.accountId as string;
      // An OUT leg took money away, so undoing it puts money back.
      const delta = row.direction === "OUT" ? money(row.amount) : -money(row.amount);
      restore.set(accountId, (restore.get(accountId) ?? 0) + delta);
      batch.delete(leg.ref);
    }
    batch.delete(ref);
    await batch.commit();

    await Promise.all(
      [...restore].map(([accountId, delta]) =>
        adminDb.collection(ACCOUNTS).doc(accountId).update({
          cachedBalance: FieldValue.increment(Math.round(delta * 100) / 100),
        })
      )
    );

    return {
      removedPayments: legs.size,
      restored: Math.round([...restore.values()].reduce((sum, value) => sum + value, 0) * 100) / 100,
    };
  });
}

/** What deleting a spending would also delete. Read before the confirmation. */
export async function countCapitalSpendingPayments(
  token: string,
  spendingId: string
): Promise<ActionResult<{ payments: number; total: number }>> {
  return runAction("countCapitalSpendingPayments", async () => {
    await verifyAuth(token);
    const legs = await adminDb
      .collection(TRANSACTIONS)
      .where("sourceModule", "==", "CAPITAL_INVESTMENT")
      .where("sourceId", "==", spendingId)
      .get();
    return {
      payments: legs.size,
      total: legs.docs.reduce((sum, leg) => sum + money(leg.data().amount), 0),
    };
  });
}
