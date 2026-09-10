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
import { stateLifeCommission } from "@/lib/stateLife";
import { FieldValue } from "firebase-admin/firestore";

const PERSONAL = "personalExpenses";
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
/* Personal expenses — an employee spends, the company pays them back          */
/* -------------------------------------------------------------------------- */

/**
 * The standard reimbursement shape, not an invention: an employee spends their
 * own money, attaches a receipt and a business purpose, somebody who is **not
 * them** approves it, and only then is it paid back.
 *
 * Two separations do the work, and both are deliberate:
 *
 * - **Approval is not payment.** An approved claim is money owed, not money
 *   moved; it becomes a transaction when it is reimbursed, from whichever
 *   accounts fund it.
 * - **The approver is never the claimant.** Self-approval is the single
 *   failure mode this kind of module exists to prevent, so it is refused on the
 *   server rather than hidden on the screen.
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
  /** Admin/HR may file on somebody's behalf; an employee may only file their own. */
  employeeUid?: string | null;
  submit?: boolean;
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

    // An employee files their own and nobody else's. Only finance may name a
    // different claimant, and that is checked here rather than trusted.
    const employeeUid =
      auth.isHr && input.employeeUid ? input.employeeUid : auth.uid;
    if (!auth.isHr && input.employeeUid && input.employeeUid !== auth.uid) {
      throw new UserFacingError("You can only file your own expenses.");
    }

    const profile = await adminDb.collection("users").doc(employeeUid).get();
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
      employeeUid,
      employeeName: (profile.data()?.name as string) ?? null,
      subAdminUid: (profile.data()?.subAdminUid as string) ?? null,
      status: input.submit ? "SUBMITTED" : "DRAFT",
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
      // Once money has moved against it the record is history, not a draft.
      if (money(current.paidAmount) > 0) {
        throw new UserFacingError("This has already been reimbursed and cannot be edited.");
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

    const ref = adminDb.collection(PERSONAL).doc();
    await ref.create({
      ...payload,
      paidAmount: 0,
      paymentStatus: "UNPAID",
      createdByUid: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      history: [
        {
          at: new Date().toISOString(),
          action: input.submit ? "SUBMITTED" : "CREATED",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
        },
      ],
    });
    return { expenseId: ref.id };
  });
}

export async function decidePersonalExpense(
  token: string,
  expenseId: string,
  decision: "APPROVED" | "REJECTED" | "CANCELLED",
  note?: string
): Promise<ActionResult> {
  return runAction("decidePersonalExpense", async () => {
    const auth = await requireFinance(token);

    const ref = adminDb.collection(PERSONAL).doc(expenseId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That expense no longer exists.");
    const expense = snap.data()!;

    // **No self-approval.** The one rule a reimbursement module must enforce,
    // and it is enforced here because a screen that merely hides the button is
    // not an enforcement.
    if (expense.employeeUid === auth.uid && decision === "APPROVED") {
      throw new UserFacingError("You cannot approve your own expense. Ask another approver.");
    }
    if (money(expense.paidAmount) > 0 && decision !== "APPROVED") {
      throw new UserFacingError("This has already been reimbursed. Reverse the payment first.");
    }

    await ref.update({
      status: decision,
      decidedByUid: auth.uid,
      decidedByName: auth.name ?? auth.email ?? null,
      decisionNote: (note ?? "").trim() || null,
      decidedAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion({
        at: new Date().toISOString(),
        action: decision,
        byUid: auth.uid,
        byName: auth.name ?? auth.email ?? null,
        note: (note ?? "").trim() || null,
      }),
    });
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
