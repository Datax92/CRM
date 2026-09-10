"use server";

/**
 * The modules that sit on the ledger: personal expenses, StateLife, and
 * Mahziyar marketing income.
 *
 * **None of them moves money.** Each records an obligation or an earning and
 * leaves the movement to `payFromAccounts` in `actions/ledger`, so there is one
 * path into the ledger and one place the "where are we paying this from?"
 * rules live. A module that wrote its own transaction would be the second
 * source of truth this rebuild exists to remove.
 *
 * Office expenses are not here: they already had a module (`actions/officeExpenses`)
 * with categories, receipts and approvals, and it keeps its records and its
 * history. All it needed was to be paid through the same call as everything
 * else.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, requireAdmin, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey } from "@/lib/dates";
import { money } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { stateLifeCommission } from "@/lib/stateLife";
import { FieldValue } from "firebase-admin/firestore";

const PERSONAL = "personalExpenses";
/** The ledger owns this collection; named here only to restore a balance. */
const ACCOUNTS_FOR_RESTORE = "accounts";
const STATELIFE = "stateLifePolicies";
const MARKETING = "marketingIncome";

async function requireFinance(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (!auth.isHr) throw new UserFacingError("Only an administrator or HR can do this.");
  return auth;
}

const dayOrToday = (raw?: string) =>
  raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : karachiDayKey();

/* -------------------------------------------------------------------------- */
/* Personal expenses — one person's own spending                               */
/* -------------------------------------------------------------------------- */

/**
 * What somebody spent out of their own pocket, and which account paid it back.
 *
 * **No approval, and no second person.** This was a reimbursement workflow —
 * submit, approve, reject, cancel, with a claimant chosen from the roster and a
 * manager to decide it — and the owner removed all of it: *"remove employees
 * and manager, it should be personal expense only."* So there is no `status`
 * written any more and no `employeeUid` to choose: the record belongs to
 * whoever filed it, and the only question left about it is how much of it an
 * account has paid back.
 *
 * **`employeeUid` is still stamped, and must be** — it is the clause the
 * Security Rule checks (`where('employeeUid','==',uid)`), so a record without
 * it would be unreadable by the person who owns it. It is taken from the token
 * and can no longer be sent in.
 */
export interface PersonalExpenseInput {
  title: string;
  category: string;
  amount: number;
  dayKey?: string;
  vendor?: string | null;
  purpose?: string | null;
  notes?: string | null;
  receiptUrl?: string | null;
  receiptName?: string | null;
}

export async function savePersonalExpense(
  token: string,
  input: PersonalExpenseInput,
  expenseId?: string
): Promise<ActionResult<{ expenseId: string }>> {
  return runAction("savePersonalExpense", async () => {
    const auth = await verifyAuth(token);

    const title = (input.title ?? "").trim();
    if (!title) throw new UserFacingError("Say what the expense was for.");
    const amount = money(input.amount);
    if (amount <= 0) throw new UserFacingError("Enter an amount greater than zero.");

    const payload = {
      title,
      category: (input.category ?? "Other").trim() || "Other",
      amount,
      dayKey: dayOrToday(input.dayKey),
      vendor: (input.vendor ?? "").trim() || null,
      purpose: (input.purpose ?? "").trim() || null,
      notes: (input.notes ?? "").trim() || null,
      receiptUrl: input.receiptUrl ?? null,
      receiptName: input.receiptName ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (expenseId) {
      const ref = adminDb.collection(PERSONAL).doc(expenseId);
      const snap = await ref.get();
      if (!snap.exists) throw new UserFacingError("That expense no longer exists.");
      const current = snap.data()!;
      if (current.employeeUid !== auth.uid && !auth.isHr) {
        throw new UserFacingError("That is not your expense.");
      }

      /*
        **The amount may not fall below what an account has already paid back.**
        The transactions funding it are real money movements and are not
        rewritten by editing the record, so a smaller amount would leave one
        insisting it was over-paid. Everything else about it stays editable,
        including after it has been paid — correcting a category or a date on a
        settled expense is ordinary, not an audit event.
      */
      const paidSoFar = money(current.paidAmount);
      if (paidSoFar > 0 && amount < paidSoFar) {
        throw new UserFacingError(
          `${formatMoney(paidSoFar)} has already been paid back for this. Reduce or delete that payment first.`
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
      return { expenseId };
    }

    const profile = await adminDb.collection("users").doc(auth.uid).get();
    const ref = adminDb.collection(PERSONAL).doc();
    await ref.create({
      ...payload,
      // The Security Rule's clause. Taken from the token, never from the input.
      employeeUid: auth.uid,
      employeeName: (profile.data()?.name as string) ?? auth.name ?? null,
      subAdminUid: (profile.data()?.subAdminUid as string) ?? null,
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
    return { expenseId: ref.id };
  });
}

/**
 * Deletes a personal expense **and the payments made against it**.
 *
 * A plain delete would leave the ledger holding transactions whose `sourceId`
 * points at nothing — money recorded as having left an account for a record
 * that no longer exists. So the movements go with it and each account's cached
 * balance is put back, which is what deleting the expense actually means.
 *
 * That is destructive and irreversible, so the action **reports what it will
 * cost before it is called** (`countPersonalExpensePayments`) and the screen
 * names the figure in the confirmation rather than afterwards.
 *
 * Yours to delete, or HR's. The balances are restored outside the batch: a
 * stale cache is a display problem that `balancesFor` recomputes from the
 * transactions anyway, and failing there must not leave the delete half done.
 */
export async function deletePersonalExpense(
  token: string,
  expenseId: string
): Promise<ActionResult<{ removedPayments: number; restored: number }>> {
  return runAction("deletePersonalExpense", async () => {
    const auth = await verifyAuth(token);

    const ref = adminDb.collection(PERSONAL).doc(expenseId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That expense no longer exists.");
    if (snap.data()!.employeeUid !== auth.uid && !auth.isHr) {
      throw new UserFacingError("That is not your expense.");
    }

    const legs = await adminDb
      .collection("transactions")
      .where("sourceModule", "==", "PERSONAL_EXPENSE")
      .where("sourceId", "==", expenseId)
      .get();

    const restore = new Map<string, number>();
    const batch = adminDb.batch();
    for (const leg of legs.docs) {
      const row = leg.data();
      const accountId = row.accountId as string;
      const amount = money(row.amount);
      // An OUT leg took money away, so undoing it puts money back.
      const delta = row.direction === "OUT" ? amount : -amount;
      restore.set(accountId, (restore.get(accountId) ?? 0) + delta);
      batch.delete(leg.ref);
    }
    batch.delete(ref);
    await batch.commit();

    await Promise.all(
      [...restore].map(([accountId, delta]) =>
        adminDb.collection(ACCOUNTS_FOR_RESTORE).doc(accountId).update({
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

/** What deleting this expense would also delete. Read before the confirmation. */
export async function countPersonalExpensePayments(
  token: string,
  expenseId: string
): Promise<ActionResult<{ payments: number; total: number }>> {
  return runAction("countPersonalExpensePayments", async () => {
    await verifyAuth(token);
    const legs = await adminDb
      .collection("transactions")
      .where("sourceModule", "==", "PERSONAL_EXPENSE")
      .where("sourceId", "==", expenseId)
      .get();
    return {
      payments: legs.size,
      total: legs.docs.reduce((sum, leg) => sum + money(leg.data().amount), 0),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* StateLife                                                                   */
/* -------------------------------------------------------------------------- */

export interface StateLifeInputRow {
  proposalNo: string;
  name: string;
  fyp: number;
  pass: number;
  srCode?: string | null;
  dayKey?: string;
  paidAmount?: number;
  paidDayKey?: string | null;
  policyNumber?: string | null;
  description?: string | null;
  srName?: string | null;
  discount?: number;
  incomeNote?: string | null;
}

/**
 * One policy row.
 *
 * **The commissions are computed here, never accepted from the client** — the
 * same rule the deal entry follows. `lib/stateLife` holds the arithmetic,
 * transcribed from the workbook, and stores the derived columns alongside the
 * typed ones so the table and its totals need no recomputation to draw.
 */
export async function saveStateLifePolicy(
  token: string,
  input: StateLifeInputRow,
  policyId?: string
): Promise<ActionResult<{ policyId: string }>> {
  return runAction("saveStateLifePolicy", async () => {
    const auth = await requireFinance(token);

    const name = (input.name ?? "").trim();
    if (!name) throw new UserFacingError("Enter the policyholder's name.");
    const pass = money(input.pass);
    if (pass <= 0) throw new UserFacingError("Enter the passed amount — every commission is a percentage of it.");

    const commission = stateLifeCommission({
      fyp: money(input.fyp),
      pass,
      discount: money(input.discount),
    });

    const payload = {
      proposalNo: (input.proposalNo ?? "").trim() || null,
      name,
      fyp: money(input.fyp),
      pass,
      srCode: (input.srCode ?? "").trim() || null,
      dayKey: dayOrToday(input.dayKey),
      paidAmount: money(input.paidAmount),
      paidDayKey: input.paidDayKey && /^\d{4}-\d{2}-\d{2}$/.test(input.paidDayKey) ? input.paidDayKey : null,
      policyNumber: (input.policyNumber ?? "").trim() || null,
      description: (input.description ?? "").trim() || null,
      srName: (input.srName ?? "").trim() || null,
      incomeNote: (input.incomeNote ?? "").trim() || null,
      ...commission,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: auth.uid,
    };

    if (policyId) {
      const ref = adminDb.collection(STATELIFE).doc(policyId);
      if (!(await ref.get()).exists) throw new UserFacingError("That policy no longer exists.");
      await ref.update(payload);
      return { policyId };
    }

    const ref = adminDb.collection(STATELIFE).doc();
    await ref.create({ ...payload, createdByUid: auth.uid, createdAt: FieldValue.serverTimestamp() });
    return { policyId: ref.id };
  });
}

export async function deleteStateLifePolicy(token: string, policyId: string): Promise<ActionResult> {
  return runAction("deleteStateLifePolicy", async () => {
    await requireAdmin(token);
    await adminDb.collection(STATELIFE).doc(policyId).delete();
  });
}

/* -------------------------------------------------------------------------- */
/* Mahziyar marketing income                                                   */
/* -------------------------------------------------------------------------- */

export interface MarketingIncomeInput {
  dayKey?: string;
  customerName: string;
  soldByUid?: string | null;
  soldByName?: string | null;
  teamUid?: string | null;
  teamName?: string | null;
  description?: string | null;
  amountReceived: number;
  staffCommission?: number;
  teamCommission?: number;
  companyCommission?: number;
}

/**
 * Marketing income, with its three commission cuts.
 *
 * **Deliberately separate from the deal profit split.** `lib/profitDistribution`
 * exists for a closed CRM deal, where the admin finalises percentages of a cut
 * base; this is a marketing receipt with three amounts typed directly. Routing
 * one through the other would put a second meaning on `dealPayouts` and make
 * every commission report ambiguous about which kind of earning it was
 * counting.
 *
 * `totalCost` is the sum of the three cuts — what the receipt costs in
 * commission — and it is **derived**, never typed, so it cannot disagree with
 * the parts. The money itself arrives in the ledger by paying it in through
 * `payFromAccounts` with `direction: 'IN'`.
 */
export async function saveMarketingIncome(
  token: string,
  input: MarketingIncomeInput,
  recordId?: string
): Promise<ActionResult<{ recordId: string }>> {
  return runAction("saveMarketingIncome", async () => {
    const auth = await requireFinance(token);

    const customerName = (input.customerName ?? "").trim();
    if (!customerName) throw new UserFacingError("Enter the customer's name.");
    const amountReceived = money(input.amountReceived);
    if (amountReceived <= 0) throw new UserFacingError("Enter the amount received.");

    const staffCommission = money(input.staffCommission);
    const teamCommission = money(input.teamCommission);
    const companyCommission = money(input.companyCommission);
    const totalCost = Math.round((staffCommission + teamCommission + companyCommission) * 100) / 100;

    if (totalCost > amountReceived) {
      // Not a rounding slip: the cuts cannot come to more than came in.
      throw new UserFacingError("The commissions come to more than the amount received.");
    }

    const payload = {
      dayKey: dayOrToday(input.dayKey),
      customerName,
      soldByUid: input.soldByUid ?? null,
      soldByName: (input.soldByName ?? "").trim() || null,
      teamUid: input.teamUid ?? null,
      teamName: (input.teamName ?? "").trim() || null,
      description: (input.description ?? "").trim() || null,
      amountReceived,
      staffCommission,
      teamCommission,
      companyCommission,
      totalCost,
      /** What the business keeps once the three cuts are paid. */
      netIncome: Math.round((amountReceived - totalCost) * 100) / 100,
      // Named `amount` as well so the generic payment path can read the
      // obligation the same way it reads every other module's.
      amount: amountReceived,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: auth.uid,
    };

    if (recordId) {
      const ref = adminDb.collection(MARKETING).doc(recordId);
      if (!(await ref.get()).exists) throw new UserFacingError("That record no longer exists.");
      await ref.update(payload);
      return { recordId };
    }

    const ref = adminDb.collection(MARKETING).doc();
    await ref.create({
      ...payload,
      paidAmount: 0,
      paymentStatus: "UNPAID",
      createdByUid: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { recordId: ref.id };
  });
}

export async function deleteMarketingIncome(token: string, recordId: string): Promise<ActionResult> {
  return runAction("deleteMarketingIncome", async () => {
    await requireAdmin(token);
    await adminDb.collection(MARKETING).doc(recordId).delete();
  });
}
