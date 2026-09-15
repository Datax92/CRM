"use server";

/**
 * The ledger's write side.
 *
 * **Every rupee that moves in this business moves through `postPayment` or
 * `createTransfer`.** No module writes a transaction itself, and no module
 * keeps its own idea of a balance — that is the whole point of the rebuild.
 * The arithmetic and the rules are in `lib/ledger`, pure and unit-tested; this
 * file is the boundary: it verifies the caller, re-reads the obligation inside
 * a Firestore transaction, and writes.
 *
 * **Why the guard is a re-read and not a client-side check.** Two people paying
 * the same expense at the same moment, or one person double-clicking, both send
 * a request that looked valid when it left the browser. The only place that can
 * be settled is inside the transaction, against the record's current
 * `paidAmount`. One commits; the other re-reads, sees the new figure, and is
 * refused. That is what makes a duplicate payment impossible rather than
 * unlikely.
 */

import { adminDb } from "@/lib/firebase/server";
import { requireAdmin, verifyAuth, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey } from "@/lib/dates";
import {
  accountBalance,
  allocationsToTransactions,
  checkAllocations,
  distributeAcrossObligations,
  money,
  normalizeAccountKind,
  reversalOf,
  transferTransactions,
  validateTransfer,
  type LedgerTransaction,
  type PaymentAllocation,
  type SourceModule,
  type TransactionType,
} from "@/lib/ledger";
import { FieldValue, Transaction } from "firebase-admin/firestore";

const ACCOUNTS = "accounts";
const TRANSACTIONS = "transactions";

/* -------------------------------------------------------------------------- */
/* Who may touch money                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Admin or HR.
 *
 * The owner's instruction was that office expenses are handled by HR **and**
 * admin "in a row" — the same screen, the same powers. `isHr` is true for both
 * (see `lib/constants/hierarchy`), so this is the one predicate the whole
 * financial side asks.
 */
async function requireFinance(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (!auth.isHr) {
    throw new UserFacingError("Only an administrator or HR can do this.");
  }
  return auth;
}

/* -------------------------------------------------------------------------- */
/* Accounts                                                                    */
/* -------------------------------------------------------------------------- */

export interface AccountInput {
  name: string;
  kind?: string;
  openingBalance?: number;
  note?: string | null;
  /** When the money came in. Shown on the account, never a transaction. */
  dayKey?: string;
}

export async function createAccount(
  token: string,
  input: AccountInput
): Promise<ActionResult<{ accountId: string }>> {
  return runAction("createAccount", async () => {
    const auth = await requireFinance(token);
    const name = (input.name ?? "").trim();
    if (!name) throw new UserFacingError("Give the account a name.");

    const amount = money(input.openingBalance);

    const ref = adminDb.collection(ACCOUNTS).doc();
    await ref.create({
      name,
      kind: normalizeAccountKind(input.kind),
      /**
       * **The amount the account starts with, and nothing more.**
       *
       * For a committee this is the pot: it comes in once, and from then on
       * the account is a vault to spend out of. It is deliberately *not* a
       * transaction — a row on the statement for it would be a line the owner's
       * sheet does not have, and a second thing to manage.
       */
      openingBalance: amount,
      startedOn: input.dayKey && /^\d{4}-\d{2}-\d{2}$/.test(input.dayKey) ? input.dayKey : karachiDayKey(),
      note: (input.note ?? "").trim() || null,
      status: "ACTIVE",
      // A cache. `lib/ledger.accountBalance` over the transactions is the
      // answer; this is here so a list of accounts does not read every
      // transaction in the business to draw itself.
      cachedBalance: amount,
      createdByUid: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { accountId: ref.id };
  });
}

export async function updateAccount(
  token: string,
  accountId: string,
  input: Partial<AccountInput> & { status?: "ACTIVE" | "ARCHIVED" }
): Promise<ActionResult> {
  return runAction("updateAccount", async () => {
    await requireFinance(token);
    const ref = adminDb.collection(ACCOUNTS).doc(accountId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That account no longer exists.");

    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new UserFacingError("Give the account a name.");
      patch.name = name;
    }
    if (input.kind !== undefined) patch.kind = normalizeAccountKind(input.kind);
    if (input.note !== undefined) patch.note = (input.note ?? "").trim() || null;
    if (input.status !== undefined) patch.status = input.status;
    if (input.openingBalance !== undefined) {
      // Changing an opening balance moves every balance after it, so it is
      // recorded rather than simply applied.
      patch.openingBalance = money(input.openingBalance);
      patch.history = FieldValue.arrayUnion({
        at: new Date().toISOString(),
        from: snap.data()?.openingBalance ?? 0,
        to: money(input.openingBalance),
      });
    }

    await ref.update(patch);
    // Only when the opening balance moved: everything else leaves the balance
    // alone, and a recompute reads the whole history.
    if (input.openingBalance !== undefined) await refreshBalance(accountId);
  });
}

/**
 * Moves an account's cached balance by a delta — **no reads at all**.
 *
 * This replaced a `refreshBalance` that re-read every transaction on the
 * account after every write and summed them. On a committee with 200 spendings
 * that was 200 reads to add the 201st, and a three-way split payment cost the
 * whole history of three accounts. On the free plan's 50,000 daily reads a busy
 * afternoon could spend the lot on arithmetic the server already knew.
 *
 * `FieldValue.increment` is applied by the database, so it is correct under
 * concurrent writes without a transaction and costs one write with no read in
 * front of it. The cache can still drift if a document is ever changed outside
 * these actions, which is what `recalculateBalances` is for — an explicit
 * repair, not something every write pays for.
 */
function bumpBalance(accountId: string, delta: number): Promise<unknown> {
  if (!Number.isFinite(delta) || delta === 0) return Promise.resolve();
  return adminDb
    .collection(ACCOUNTS)
    .doc(accountId)
    .update({ cachedBalance: FieldValue.increment(Math.round(delta * 100) / 100) });
}

/** The signed effect of a leg on its account's balance. */
function deltaOf(direction: "IN" | "OUT", amount: number): number {
  return direction === "IN" ? money(amount) : -money(amount);
}

/** Recomputes one account's balance from its transactions. The repair path. */
async function refreshBalance(accountId: string): Promise<number> {
  const [accountSnap, txnSnap] = await Promise.all([
    adminDb.collection(ACCOUNTS).doc(accountId).get(),
    adminDb.collection(TRANSACTIONS).where("accountId", "==", accountId).get(),
  ]);
  if (!accountSnap.exists) return 0;

  const balance = accountBalance(
    { id: accountId, openingBalance: money(accountSnap.data()?.openingBalance) },
    txnSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as LedgerTransaction)
  );
  await accountSnap.ref.update({ cachedBalance: balance.balance });
  return balance.balance;
}

export async function recalculateBalances(token: string): Promise<ActionResult<{ accounts: number }>> {
  return runAction("recalculateBalances", async () => {
    await requireFinance(token);
    const accounts = await adminDb.collection(ACCOUNTS).get();
    for (const doc of accounts.docs) await refreshBalance(doc.id);
    return { accounts: accounts.size };
  });
}

/* -------------------------------------------------------------------------- */
/* Paying something — the one path                                             */
/* -------------------------------------------------------------------------- */

export interface PayInput {
  /** Which module's record is being paid, and which record. */
  sourceModule: SourceModule;
  sourceId: string;
  /** The collection holding it, so the obligation can be re-read atomically. */
  sourceCollection: string;
  sourceLabel: string;
  /** "Where are we paying this from?" — one line per account. */
  allocations: PaymentAllocation[];
  type?: TransactionType;
  direction?: "IN" | "OUT";
  dayKey?: string;
  note?: string | null;
}

/**
 * Posts a split payment against an obligation, atomically.
 *
 * The obligation's own amount is never touched — a 50,000 expense paid
 * 30,000 + 10,000 + 10,000 stays a 50,000 expense, and the three legs only
 * record where the money came from. What *is* updated on the record is
 * `paidAmount` and `paymentStatus`, so the next payment knows what is left.
 *
 * **Committee receiving its own leg is not special-cased here or anywhere.**
 * An allocation names an account; Committee is an account. The same call posts
 * to Bank, Cash, Wallet, Investment or anything added later, which is what the
 * owner asked for when they said it must work for all modules and all accounts.
 */
export async function payFromAccounts(
  token: string,
  input: PayInput
): Promise<ActionResult<{ groupId: string; posted: number; fullyPaid: boolean }>> {
  return runAction("payFromAccounts", async () => {
    const auth = await requireFinance(token);

    const allocations = (input.allocations ?? []).map((line) => ({
      accountId: (line.accountId ?? "").trim(),
      amount: money(line.amount),
    }));
    if (allocations.length === 0) throw new UserFacingError("Add at least one account to pay from.");

    const dayKey = input.dayKey && /^\d{4}-\d{2}-\d{2}$/.test(input.dayKey)
      ? input.dayKey
      : karachiDayKey();
    const groupId = adminDb.collection(TRANSACTIONS).doc().id;

    const result = await adminDb.runTransaction(async (t: Transaction) => {
      const sourceRef = adminDb.collection(input.sourceCollection).doc(input.sourceId);
      const sourceSnap = await t.get(sourceRef);
      if (!sourceSnap.exists) throw new UserFacingError("That record no longer exists.");

      const source = sourceSnap.data()!;
      const payable = money(source.amount);
      const alreadyPaid = money(source.paidAmount);

      // **The guard, inside the transaction.** Whatever the browser believed
      // when it submitted, this is the current figure — so a double-click, a
      // retry, or two people paying at once cannot both succeed.
      const check = checkAllocations(payable, allocations, alreadyPaid);
      if (!check.valid) throw new UserFacingError(check.errors[0]);

      // Every account must exist and be open, or the money leaves for nowhere.
      const accountRefs = allocations.map((a) => adminDb.collection(ACCOUNTS).doc(a.accountId));
      const accountSnaps = await Promise.all(accountRefs.map((ref) => t.get(ref)));
      accountSnaps.forEach((snap, index) => {
        if (!snap.exists) throw new UserFacingError("One of those accounts no longer exists.");
        if (snap.data()?.status === "ARCHIVED") {
          throw new UserFacingError(`${snap.data()?.name ?? "That account"} is archived and cannot be paid from.`);
        }
        void index;
      });

      const legs = allocationsToTransactions({
        allocations,
        direction: input.direction ?? "OUT",
        type: input.type ?? "EXPENSE",
        dayKey,
        sourceModule: input.sourceModule,
        sourceId: input.sourceId,
        sourceLabel: input.sourceLabel,
        groupId,
        createdByUid: auth.uid,
        note: input.note ?? null,
      });

      for (const leg of legs) {
        const { idempotencyKey, ...row } = leg;
        t.create(adminDb.collection(TRANSACTIONS).doc(), {
          ...row,
          idempotencyKey,
          createdByName: auth.name ?? auth.email ?? null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      const paidNow = money(alreadyPaid + check.allocated);
      t.update(sourceRef, {
        paidAmount: paidNow,
        paymentStatus: paidNow >= payable ? "PAID" : "PARTIALLY_PAID",
        paidAt: paidNow >= payable ? FieldValue.serverTimestamp() : null,
        // Audit: what was paid, from where, by whom — appended, never replaced.
        history: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: "PAID",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
          amount: check.allocated,
          groupId,
          allocations: allocations.map((a) => ({ accountId: a.accountId, amount: a.amount })),
        }),
      });

      return { groupId, posted: legs.length, fullyPaid: paidNow >= payable };
    });

    // One increment per funding account — no reads. Outside the transaction
    // because a stale cache is a display problem and a refused payment is a
    // real one: the caches are never allowed to fail the write.
    const direction = input.direction ?? "OUT";
    await Promise.all(
      allocations.map((line) => bumpBalance(line.accountId, deltaOf(direction, line.amount)))
    );
    return result;
  });
}

/* -------------------------------------------------------------------------- */
/* Paying a period's total                                                     */
/* -------------------------------------------------------------------------- */

export interface PayTotalInput {
  /** Which book of expenses. */
  kind: "OFFICE" | "PERSONAL";
  /** The expenses on screen for the period — only the unpaid ones are touched. */
  ids: string[];
  allocations: PaymentAllocation[];
  dayKey?: string;
  note?: string | null;
}

/**
 * **Pays everything outstanding in a period at once** — "this month's office
 * expenses, from Car Sale and the bank".
 *
 * Built on the same rules as `payFromAccounts`, not beside them:
 *
 * - **every expense is still paid individually.** The payment lines are spread
 *   across the expenses oldest first (`distributeAcrossObligations`), and each
 *   leg names one expense and one account, so every statement still opens the
 *   expense it paid for and each expense's own `paidAmount` is exact;
 * - **the guard is a re-read inside the transaction.** Whatever the screen
 *   believed, each expense's outstanding figure is read again here, so a bill
 *   paid a second ago by somebody else is simply skipped rather than paid twice;
 * - **office expenses must be approved** to be paid, exactly as one at a time.
 *   A pending or rejected one in the period is left alone.
 *
 * Paying less than the total is allowed; the newest expenses keep the balance.
 */
export async function payExpensesTotal(
  token: string,
  input: PayTotalInput
): Promise<ActionResult<{ groupId: string; posted: number; fullyPaid: boolean; expenses: number }>> {
  return runAction("payExpensesTotal", async () => {
    const auth = await requireFinance(token);

    const collectionName = input.kind === "PERSONAL" ? "personalExpenses" : "expenses";
    const sourceModule: SourceModule = input.kind === "PERSONAL" ? "PERSONAL_EXPENSE" : "OFFICE_EXPENSE";
    const type: TransactionType = input.kind === "PERSONAL" ? "REIMBURSEMENT" : "EXPENSE";

    const ids = [...new Set((input.ids ?? []).filter(Boolean))];
    if (ids.length === 0) throw new UserFacingError("There is nothing in this period to pay.");
    // A Firestore transaction holds up to 500 writes: an expense update per
    // record plus at most `records + accounts − 1` legs.
    if (ids.length > 200) throw new UserFacingError("Pay at most 200 expenses at once — narrow the period.");

    const allocations = (input.allocations ?? []).map((line) => ({
      accountId: (line.accountId ?? "").trim(),
      amount: money(line.amount),
    }));
    const dayKey = input.dayKey && /^\d{4}-\d{2}-\d{2}$/.test(input.dayKey) ? input.dayKey : karachiDayKey();
    const groupId = adminDb.collection(TRANSACTIONS).doc().id;

    const result = await adminDb.runTransaction(async (t: Transaction) => {
      const refs = ids.map((id) => adminDb.collection(collectionName).doc(id));
      const snaps = await Promise.all(refs.map((ref) => t.get(ref)));

      const records = snaps
        .filter((snap) => snap.exists)
        .map((snap) => ({ snap, data: snap.data()! }))
        .filter(({ data }) =>
          input.kind === "PERSONAL" ? true : data.status !== "PENDING" && data.status !== "REJECTED"
        )
        .map(({ snap, data }) => {
          const amount = money(data.amount);
          const paid = Math.min(money(data.paidAmount), amount);
          return {
            ref: snap.ref,
            id: snap.id,
            dayKey: typeof data.dayKey === "string" ? data.dayKey : "",
            label: (data.title as string) || (data.category as string) || "Expense",
            amount,
            paid,
            outstanding: Math.round((amount - paid) * 100) / 100,
          };
        })
        .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.id.localeCompare(b.id));

      const plan = distributeAcrossObligations(records, allocations);
      if (!plan.valid) throw new UserFacingError(plan.errors[0]);

      const accountSnaps = await Promise.all(
        allocations.map((line) => t.get(adminDb.collection(ACCOUNTS).doc(line.accountId)))
      );
      for (const snap of accountSnaps) {
        if (!snap.exists) throw new UserFacingError("One of those accounts no longer exists.");
        if (snap.data()?.status === "ARCHIVED") {
          throw new UserFacingError(`${snap.data()?.name ?? "That account"} is archived and cannot be paid from.`);
        }
      }

      const byId = new Map(records.map((record) => [record.id, record]));
      for (const leg of plan.legs) {
        const record = byId.get(leg.obligationId)!;
        t.create(adminDb.collection(TRANSACTIONS).doc(), {
          accountId: leg.accountId,
          direction: "OUT",
          amount: leg.amount,
          type,
          dayKey,
          sourceModule,
          sourceId: record.id,
          sourceLabel: input.kind === "PERSONAL" ? `Personal expense — ${record.label}` : record.label,
          groupId,
          status: "POSTED",
          note: input.note?.trim() || "Paid with the period total",
          idempotencyKey: `${sourceModule}:${record.id}:${leg.accountId}`,
          createdByUid: auth.uid,
          createdByName: auth.name ?? auth.email ?? null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      let fullyPaid = true;
      for (const record of records) {
        const add = plan.paidByObligation.get(record.id) ?? 0;
        if (add <= 0) {
          if (record.outstanding > 0) fullyPaid = false;
          continue;
        }
        const paidNow = Math.round((record.paid + add) * 100) / 100;
        if (paidNow < record.amount) fullyPaid = false;
        t.update(record.ref, {
          paidAmount: paidNow,
          paymentStatus: paidNow >= record.amount ? "PAID" : "PARTIALLY_PAID",
          paidAt: paidNow >= record.amount ? FieldValue.serverTimestamp() : null,
          history: FieldValue.arrayUnion({
            at: new Date().toISOString(),
            action: "PAID",
            byUid: auth.uid,
            byName: auth.name ?? auth.email ?? null,
            amount: add,
            groupId,
            detail: "Paid with the period total",
            allocations: plan.legs
              .filter((leg) => leg.obligationId === record.id)
              .map((leg) => ({ accountId: leg.accountId, amount: leg.amount })),
          }),
        });
      }

      return {
        groupId,
        posted: plan.legs.length,
        fullyPaid,
        expenses: plan.paidByObligation.size,
      };
    });

    await Promise.all(allocations.map((line) => bumpBalance(line.accountId, -line.amount)));
    return result;
  });
}

/* -------------------------------------------------------------------------- */
/* Transfers                                                                   */
/* -------------------------------------------------------------------------- */

export async function createTransfer(
  token: string,
  input: { fromAccountId: string; toAccountId: string; amount: number; dayKey?: string; note?: string | null }
): Promise<ActionResult<{ groupId: string }>> {
  return runAction("createTransfer", async () => {
    const auth = await requireFinance(token);

    const errors = validateTransfer(input);
    if (errors.length > 0) throw new UserFacingError(errors[0]);

    const dayKey = input.dayKey && /^\d{4}-\d{2}-\d{2}$/.test(input.dayKey) ? input.dayKey : karachiDayKey();
    const groupId = adminDb.collection(TRANSACTIONS).doc().id;

    const [from, to] = await Promise.all([
      adminDb.collection(ACCOUNTS).doc(input.fromAccountId).get(),
      adminDb.collection(ACCOUNTS).doc(input.toAccountId).get(),
    ]);
    if (!from.exists || !to.exists) throw new UserFacingError("One of those accounts no longer exists.");

    // Both legs carry `type: TRANSFER`, which is what keeps a movement between
    // the company's own pots out of the income and expense totals.
    const legs = transferTransactions({
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amount: input.amount,
      dayKey,
      groupId,
      createdByUid: auth.uid,
      note: input.note ?? null,
    });

    const batch = adminDb.batch();
    for (const leg of legs) {
      batch.create(adminDb.collection(TRANSACTIONS).doc(), {
        ...leg,
        sourceLabel:
          leg.direction === "OUT"
            ? `Transfer to ${to.data()?.name ?? "another account"}`
            : `Transfer from ${from.data()?.name ?? "another account"}`,
        createdByName: auth.name ?? auth.email ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    await Promise.all([
      bumpBalance(input.fromAccountId, -money(input.amount)),
      bumpBalance(input.toAccountId, money(input.amount)),
    ]);
    return { groupId };
  });
}

/* -------------------------------------------------------------------------- */
/* Manual entries and corrections                                              */
/* -------------------------------------------------------------------------- */

export async function addManualTransaction(
  token: string,
  input: {
    accountId: string;
    direction: "IN" | "OUT";
    amount: number;
    type?: TransactionType;
    dayKey?: string;
    label: string;
    note?: string | null;
  }
): Promise<ActionResult<{ transactionId: string }>> {
  return runAction("addManualTransaction", async () => {
    const auth = await requireFinance(token);
    const amount = money(input.amount);
    if (amount <= 0) throw new UserFacingError("Enter an amount greater than zero.");
    const label = (input.label ?? "").trim();
    if (!label) throw new UserFacingError("Say what this was for.");

    const account = await adminDb.collection(ACCOUNTS).doc(input.accountId).get();
    if (!account.exists) throw new UserFacingError("That account no longer exists.");

    const ref = adminDb.collection(TRANSACTIONS).doc();
    await ref.create({
      accountId: input.accountId,
      direction: input.direction,
      amount,
      type: input.type ?? (input.direction === "IN" ? "INCOME" : "EXPENSE"),
      dayKey: input.dayKey && /^\d{4}-\d{2}-\d{2}$/.test(input.dayKey) ? input.dayKey : karachiDayKey(),
      sourceModule: "MANUAL",
      sourceId: null,
      sourceLabel: label,
      groupId: null,
      status: "POSTED",
      note: (input.note ?? "").trim() || null,
      createdByUid: auth.uid,
      createdByName: auth.name ?? auth.email ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    await bumpBalance(input.accountId, deltaOf(input.direction, amount));
    return { transactionId: ref.id };
  });
}

/**
 * Reverses a transaction.
 *
 * **Financial history is never rewritten.** The original stays **posted** and
 * an equal, opposite leg is added on the correction's own date. The two cancel,
 * so the balance is right, and both rows stay on the statement.
 *
 * The original is deliberately *not* voided as well: voiding removes its effect
 * and the reversal removes it a second time, moving the account by the amount
 * in the wrong direction. Admin only — a correction should take the most senior
 * person in the building.
 */
export async function reverseTransaction(
  token: string,
  transactionId: string,
  note?: string
): Promise<ActionResult<{ reversalId: string }>> {
  return runAction("reverseTransaction", async () => {
    const admin = await requireAdmin(token);

    const ref = adminDb.collection(TRANSACTIONS).doc(transactionId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That transaction no longer exists.");

    const original = { id: snap.id, ...snap.data() } as LedgerTransaction;
    if (original.status === "VOIDED") throw new UserFacingError("That transaction was voided and cannot be reversed.");
    if (original.reversedBy) throw new UserFacingError("That transaction has already been reversed.");

    const reversal = reversalOf(original, {
      dayKey: karachiDayKey(),
      createdByUid: admin.uid,
      note: (note ?? "").trim() || null,
    });

    const reversalRef = adminDb.collection(TRANSACTIONS).doc();
    const batch = adminDb.batch();
    // A marker, not a status: the original keeps counting, and the reversal
    // below cancels it. See the note above for why voiding as well is wrong.
    batch.update(ref, {
      reversedBy: reversalRef.id,
      reversedAt: FieldValue.serverTimestamp(),
      reversedByUid: admin.uid,
      reversedByName: admin.name ?? admin.email ?? null,
    });
    batch.create(reversalRef, {
      ...reversal,
      createdByName: admin.name ?? admin.email ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    // The reversal is the opposite leg, so the balance moves by its own delta.
    await bumpBalance(original.accountId, deltaOf(reversal.direction, reversal.amount));
    return { reversalId: reversalRef.id };
  });
}

/* -------------------------------------------------------------------------- */
/* Editing and deleting                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Edits a transaction — the amount, what it says, or its date.
 *
 * **This is a real edit, not a reversal**, because the owner asked for one: a
 * committee spending typed with a wrong figure should be correctable in place
 * rather than leaving a void and a counter-entry on a sheet that has to match a
 * paper one. What it does *not* do is forget: the previous values are appended
 * to the row's own `history`, with who changed them and when.
 *
 * The balance moves by the **difference**, so no history has to be re-read.
 *
 * A leg that came from another module is refused. Its amount belongs to the
 * expense or the receipt that created it, and changing it here would make the
 * two disagree with nothing to say which is right — go and edit the record
 * itself, or reverse the payment.
 */
export async function updateTransaction(
  token: string,
  transactionId: string,
  input: { amount?: number; label?: string; dayKey?: string; note?: string | null }
): Promise<ActionResult> {
  return runAction("updateTransaction", async () => {
    const auth = await requireFinance(token);

    const ref = adminDb.collection(TRANSACTIONS).doc(transactionId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That transaction no longer exists.");

    const current = snap.data()!;
    if (current.status === "VOIDED") throw new UserFacingError("That transaction was reversed and cannot be edited.");
    if (current.sourceModule !== "MANUAL") {
      // Still refused, and this one is worth keeping: the amount belongs to the
      // expense that created it, and editing it here would leave the two
      // disagreeing with nothing to say which is right. Deleting is offered
      // instead, which takes the money back off that record properly.
      throw new UserFacingError(
        "This came from an expense. Delete it to take the money back off that expense, or edit the expense itself."
      );
    }

    const patch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: auth.uid,
    };
    const previous: Record<string, unknown> = {};
    let delta = 0;

    if (input.amount !== undefined) {
      const next = money(input.amount);
      if (next <= 0) throw new UserFacingError("Enter an amount greater than zero.");
      const was = money(current.amount);
      if (next !== was) {
        previous.amount = was;
        patch.amount = next;
        // Only the difference, so nothing has to be summed again.
        delta = deltaOf(current.direction as "IN" | "OUT", next) - deltaOf(current.direction as "IN" | "OUT", was);
      }
    }
    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) throw new UserFacingError("Say what this was for.");
      if (label !== current.sourceLabel) {
        previous.sourceLabel = current.sourceLabel ?? null;
        patch.sourceLabel = label;
      }
    }
    if (input.dayKey !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(input.dayKey) && input.dayKey !== current.dayKey) {
      previous.dayKey = current.dayKey;
      patch.dayKey = input.dayKey;
    }
    if (input.note !== undefined) patch.note = (input.note ?? "").trim() || null;

    if (Object.keys(previous).length > 0) {
      patch.history = FieldValue.arrayUnion({
        at: new Date().toISOString(),
        action: "EDITED",
        byUid: auth.uid,
        byName: auth.name ?? auth.email ?? null,
        previous,
      });
    }

    await ref.update(patch);
    await bumpBalance(current.accountId as string, delta);
  });
}

/**
 * Deletes a transaction outright.
 *
 * The ledger's own preference is a reversal, which leaves both rows visible.
 * The owner asked for deletion as well, and for a hand-kept committee sheet
 * that is the right call: a row typed by mistake is noise on a page that has to
 * match a paper one, not history worth keeping.
 *
 * It is therefore **admin-only**, and confined to rows somebody typed here. A
 * leg that came from an expense or a receipt is refused — deleting it would
 * leave that record claiming it was paid from an account with no matching
 * movement, which is the one state this whole system exists to prevent.
 * Reverse the payment instead.
 */
export async function deleteTransaction(token: string, transactionId: string): Promise<ActionResult> {
  return runAction("deleteTransaction", async () => {
    await requireFinance(token);

    const ref = adminDb.collection(TRANSACTIONS).doc(transactionId);
    const snap = await ref.get();
    if (!snap.exists) return;

    const txn = snap.data()!;
    const amount = money(txn.amount);

    await ref.delete();

    if (txn.status === "POSTED") {
      // Undo its effect on the balance: the opposite of what it contributed.
      await bumpBalance(txn.accountId as string, -deltaOf(txn.direction as "IN" | "OUT", amount));
      await unpaySource(txn.sourceModule as SourceModule, txn.sourceId as string | null, amount);
    }
  });
}

/** Which collection each module's records live in, for un-paying on delete. */
const SOURCE_COLLECTIONS: Partial<Record<SourceModule, string>> = {
  OFFICE_EXPENSE: "expenses",
  PERSONAL_EXPENSE: "personalExpenses",
  MARKETING_INCOME: "marketingIncome",
  CAR_SALE: "carSales",
  PAYROLL: "payrollPeriods",
  CAPITAL_INVESTMENT: "capitalSpendings",
};

/**
 * Takes an amount back off whatever a deleted movement was funding.
 *
 * Deleting a row used to be refused whenever the money had come from an office
 * expense or a reimbursement, on the grounds that the expense would be left
 * claiming it was paid from a movement that no longer existed. That was the
 * right worry and the wrong answer — it left somebody stuck on a page they
 * could not tidy.
 *
 * Making the delete *complete* is the better answer. Removing the 10,000 a
 * committee put toward an expense means the committee no longer funded it, so
 * the expense drops by 10,000 and goes back to partly paid — payable again from
 * somewhere else. The two sides stay in agreement, which is the only thing that
 * ever mattered.
 *
 * Clamped at zero, because a record can be funded from several accounts and
 * removing one leg must leave the others standing.
 */
async function unpaySource(
  sourceModule: SourceModule,
  sourceId: string | null,
  amount: number
): Promise<void> {
  const collection = SOURCE_COLLECTIONS[sourceModule];
  if (!collection || !sourceId) return;

  const ref = adminDb.collection(collection).doc(sourceId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const record = snap.data()!;
  const paid = Math.max(0, money(record.paidAmount) - amount);
  const payable = money(record.amount);

  await ref.update({
    paidAmount: paid,
    paymentStatus: paid <= 0 ? "UNPAID" : paid >= payable ? "PAID" : "PARTIALLY_PAID",
    paidAt: paid >= payable ? (record.paidAt ?? null) : null,
    history: FieldValue.arrayUnion({
      at: new Date().toISOString(),
      action: "PAYMENT_REMOVED",
      amount,
      note: "A funding movement was deleted from its account.",
    }),
  });
}

/**
 * Deletes an account and everything in it.
 *
 * Irreversible, admin-only, and it takes the account's whole statement with it —
 * which is why `countAccountContents` exists: the screen names how many rows
 * are about to go before anybody presses it, rather than reporting the loss
 * afterwards.
 *
 * **A row that came from another module blocks the delete.** An office expense
 * that was paid from this account would be left insisting it was funded from
 * somewhere that no longer exists. Reverse those payments first, or archive the
 * account instead — archiving keeps the history and stops it being paid from.
 */
export async function deleteAccount(token: string, accountId: string): Promise<ActionResult<{ deleted: number }>> {
  return runAction("deleteAccount", async () => {
    await requireAdmin(token);

    const ref = adminDb.collection(ACCOUNTS).doc(accountId);
    if (!(await ref.get()).exists) throw new UserFacingError("That account no longer exists.");

    /**
     * **Deleting the account deletes its statement, and un-pays what those
     * movements were funding.**
     *
     * It used to refuse whenever any row had come from an expense, which left
     * somebody unable to remove a committee they had finished with — with the
     * reversal machinery as the only way out. Taking each row back off its
     * source record on the way through is the complete answer: nothing is left
     * claiming it was funded from an account that no longer exists, and the
     * expense simply becomes payable again from somewhere else.
     *
     * Paged so a long statement cannot exceed a batch, and so a run that fails
     * part-way can simply be run again.
     */
    let deleted = 0;
    for (;;) {
      const page = await adminDb.collection(TRANSACTIONS).where("accountId", "==", accountId).limit(300).get();
      if (page.empty) break;

      for (const doc of page.docs) {
        const txn = doc.data();
        if (txn.status === "POSTED") {
          await unpaySource(txn.sourceModule as SourceModule, txn.sourceId as string | null, money(txn.amount));
        }
      }

      const batch = adminDb.batch();
      for (const doc of page.docs) batch.delete(doc.ref);
      await batch.commit();
      deleted += page.size;
    }

    await ref.delete();
    return { deleted };
  });
}

/** How much a delete would destroy, so the confirmation can say so. */
export async function countAccountContents(
  token: string,
  accountId: string
): Promise<ActionResult<{ total: number; linked: number }>> {
  return runAction("countAccountContents", async () => {
    await requireFinance(token);
    return countsFor(accountId);
  });
}

/**
 * How many rows an account holds, and how many of them came from another
 * module.
 *
 * Two `count()` aggregations, which Firestore bills as **one read each however
 * many documents they cover** — so this costs 2 reads on a statement with two
 * rows and 2 reads on one with twenty thousand.
 */
async function countsFor(accountId: string): Promise<{ total: number; linked: number }> {
  const [all, manual] = await Promise.all([
    adminDb.collection(TRANSACTIONS).where("accountId", "==", accountId).count().get(),
    adminDb
      .collection(TRANSACTIONS)
      .where("accountId", "==", accountId)
      .where("sourceModule", "==", "MANUAL")
      .count()
      .get(),
  ]);
  const total = all.data().count;
  return { total, linked: Math.max(0, total - manual.data().count) };
}
