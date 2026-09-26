"use server";

import { adminDb } from "@/lib/firebase/server";
import { readAttendanceMonth, readRoster } from "@/lib/server/attendanceMonth";
import { verifyAuth, requireManager, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { isHrManager, roleTitle } from "@/lib/constants/hierarchy";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { monthAttendanceDeductions, type AttendancePolicy } from "@/lib/attendancePolicy";
import {
  buildMonthLine,
  normalizeSalaryProfile,
  payrollTotals,
  readSalary,
  type PayrollLine,
  type PayrollStatus,
} from "@/lib/payroll";
import { statusOfRecord } from "@/lib/attendance";
import { readPolicy } from "./attendance";
import { payFromAccounts } from "./ledger";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Payroll — the simple version (owner, 2026-09-25).
 *
 * *"employees managers are there and their salaries can be entered then their
 * pay is calculated based on … absent present etc, their joining date should
 * also be there."* So:
 *
 * - **Every person has a salary, an allowance and a joining date**, entered by
 *   the admin or HR. Nothing else.
 * - **A month is always live.** Salary + allowance (cut for a mid-month
 *   joining) + finalised commission − the deduction Attendance Settings
 *   produces. There is no Generate, no Review, no Approve.
 * - **Paying somebody freezes their month.** `payslips/{uid}_{YYYY-MM}` is
 *   written with the figures at that moment, the money leaves the accounts
 *   through `payFromAccounts`, and from then on that person's line is read from
 *   the slip. **Paying is the admin's alone**; HR enters salaries and sees the
 *   figures (owner, same day).
 *
 * `payrollPeriods` is no longer read or written. The one document it held (a
 * September 2026 draft that was never approved or paid) is left where it is.
 */

const SLIPS = "payslips";

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

/** The admin and HR. A Sales manager only with `salaryAccess: true`. */
async function requirePayrollAccess(token: string): Promise<DecodedAuth> {
  const auth = await requireManager(token);
  if (auth.role === "admin") return auth;

  const profile = await adminDb.collection("users").doc(auth.uid).get();
  const data = profile.data() ?? {};
  if (isHrManager(auth.role, data.managerKind) || data.salaryAccess === true) return auth;

  throw new UserFacingError(
    "Salary information is limited to the admin and HR. Ask an administrator if you need access."
  );
}

function joinedDayKeyOf(data: FirebaseFirestore.DocumentData): string | null {
  const joined = data.joinedAt?.toDate?.() as Date | undefined;
  return joined && !Number.isNaN(joined.getTime()) ? karachiDayKey(joined) : null;
}

/* -------------------------------------------------------------------------- */
/* Salaries                                                                    */
/* -------------------------------------------------------------------------- */

export interface SalaryProfileRecord {
  uid: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  role: string;
  salary: number;
  allowance: number;
  /** `YYYY-MM-DD`, Karachi, or null when nobody has entered it. */
  joinedAt: string | null;
}

/** Everybody on the payroll — employees and managers, never the admin. */
export async function listSalaryProfiles(
  token: string
): Promise<ActionResult<{ profiles: SalaryProfileRecord[] }>> {
  return runAction("listSalaryProfiles", async () => {
    await requirePayrollAccess(token);

    const snap = await adminDb.collection("users").get();
    const profiles = snap.docs
      .filter((doc) => doc.data().role !== "admin" && doc.data().status !== "DISABLED")
      .map((doc) => {
        const data = doc.data();
        return {
          uid: doc.id,
          name: (data.name as string) ?? (data.email as string) ?? "Unnamed",
          email: (data.email as string) ?? null,
          jobTitle: roleTitle(data),
          role: (data.role as string) ?? "employee",
          ...readSalary(data),
          joinedAt: joinedDayKeyOf(data),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { profiles };
  });
}

/**
 * Sets one person's salary, allowance and joining date. Admin and HR.
 *
 * Writes `monthlySalary` too — the figure Attendance Settings' per-day
 * deductions are worked out from — and the same `joinedAt` the directory shows,
 * so there is one salary and one joining date in the whole app. The previous
 * values go into `salaryHistory`.
 */
export async function saveSalaryProfile(
  token: string,
  uid: string,
  input: { salary: number; allowance: number; joinedAt: string | null }
): Promise<ActionResult<{ salary: number; allowance: number }>> {
  return runAction("saveSalaryProfile", async () => {
    const auth = await requirePayrollAccess(token);

    const salary = Math.round(Number(input.salary));
    const allowance = Math.round(Number(input.allowance));
    if (!Number.isFinite(salary) || salary < 0) throw new UserFacingError("Enter a salary of zero or more.");
    if (!Number.isFinite(allowance) || allowance < 0) throw new UserFacingError("Enter an allowance of zero or more.");

    const joinedRaw = (input.joinedAt ?? "").trim();
    if (joinedRaw && !/^\d{4}-\d{2}-\d{2}$/.test(joinedRaw)) {
      throw new UserFacingError("Choose a joining date.");
    }
    if (joinedRaw && joinedRaw > karachiDayKey()) {
      throw new UserFacingError("The joining date is in the future.");
    }

    const ref = adminDb.collection("users").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That person no longer exists.");
    const data = snap.data() ?? {};
    if (data.role === "admin") throw new UserFacingError("The administrator's own account is not on the payroll.");

    const previous = { ...readSalary(data), joinedAt: joinedDayKeyOf(data) };
    const profile = normalizeSalaryProfile({ basic: salary, allowances: allowance });

    await ref.update({
      salaryProfile: profile,
      monthlySalary: salary,
      // Midday Karachi, so the stored instant reads as the same date anywhere.
      joinedAt: joinedRaw ? new Date(`${joinedRaw}T12:00:00+05:00`) : null,
      salaryHistory: FieldValue.arrayUnion({
        at: new Date(),
        byUid: auth.uid,
        byName: auth.name ?? auth.email ?? null,
        from: previous,
        to: { salary, allowance, joinedAt: joinedRaw || null },
      }),
    });

    return { salary, allowance };
  });
}

/* -------------------------------------------------------------------------- */
/* A month                                                                     */
/* -------------------------------------------------------------------------- */

export interface PayrollPeriod {
  monthKey: string;
  lines: PayrollLine[];
  totals: ReturnType<typeof payrollTotals>;
  /** Net owed for the month, and how much of it has left an account. */
  amount: number;
  paidAmount: number;
  /** Per person: what they are owed and what has been paid. */
  payments: Record<string, { amount: number; paidAmount: number; status: "UNPAID" | "PARTIALLY_PAID" | "PAID" }>;
}

/** Commission finalised in a month, per person — Profit Distribution's figures. */
async function commissionByUid(monthKey: string): Promise<Map<string, number>> {
  const [year, month] = monthKey.split("-").map(Number);
  const snap = await adminDb
    .collection("dealPayouts")
    .where("finalizedAt", ">=", new Date(Date.UTC(year, month - 1, 1)))
    .where("finalizedAt", "<", new Date(Date.UTC(year, month, 1)))
    .get();

  const totals = new Map<string, number>();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.current === false) continue;
    const uid = String(data.recipientUid ?? "");
    if (uid) totals.set(uid, (totals.get(uid) ?? 0) + Number(data.amount ?? 0));
  }
  return totals;
}

interface AttendanceFigures {
  deduction: number;
  late: number;
  absent: number;
  leave: number;
  present: number;
  basis: string[];
}

/**
 * A month's attendance per person, priced by Attendance Settings.
 *
 * Days before somebody's joining date are ignored. A month whose attendance
 * deductions have been closed (`attendancePeriods/{month}.finalized`) uses the
 * frozen amounts rather than recomputing them.
 */
async function attendanceByUid(
  monthKey: string,
  policy: AttendancePolicy,
  salaries: Map<string, number>,
  joined: Map<string, string | null>,
  /** True when the figures decide a payment — see `readAttendanceMonth`. */
  fresh: boolean
): Promise<Map<string, AttendanceFigures>> {
  const [periodSnap, records] = await Promise.all([
    adminDb.collection("attendancePeriods").doc(monthKey).get(),
    readAttendanceMonth(monthKey, fresh),
  ]);

  const figures = new Map<string, AttendanceFigures>();
  const entry = (uid: string) => {
    let current = figures.get(uid);
    if (!current) {
      current = { deduction: 0, late: 0, absent: 0, leave: 0, present: 0, basis: [] };
      figures.set(uid, current);
    }
    return current;
  };

  for (const doc of records) {
    const data = doc.data;
    const uid = String(data.uid ?? "");
    if (!uid) continue;
    const from = joined.get(uid);
    if (from && String(data.dayKey ?? "") < from) continue;

    const status = statusOfRecord(data);
    const row = entry(uid);
    if (status === "LATE") { row.late += 1; row.present += 1; }
    else if (status === "ABSENT") row.absent += 1;
    else if (status === "LEAVE") row.leave += 1;
    else if (status === "PRESENT") row.present += 1;
  }

  if (periodSnap.exists && periodSnap.data()?.finalized) {
    for (const line of (periodSnap.data()?.lines ?? []) as { uid: string; amount: number }[]) {
      entry(line.uid).deduction += Number(line.amount ?? 0);
    }
  } else {
    for (const [uid, row] of figures) {
      const charges = monthAttendanceDeductions({ late: row.late, absent: row.absent }, policy, salaries.get(uid) ?? 0);
      row.deduction = charges.total;
      row.basis = [...charges.late, ...charges.absent].filter((o) => o.deducted).map((o) => o.basis);
    }
  }

  return figures;
}

/** Everybody's live line for a month. */
async function liveLines(
  month: string,
  /**
   * True when the lines decide a payment (`payPayrollLine`): salaries and
   * attendance then come from the database, never from the minute-long shared
   * copy the payroll screen reads — see `lib/server/attendanceMonth`.
   */
  fresh = false
): Promise<PayrollLine[]> {
  const [policy, users, commission] = await Promise.all([
    readPolicy(),
    readRoster(fresh),
    commissionByUid(month),
  ]);

  const people = users.filter((doc) => {
    const data = doc.data;
    return data.role !== "admin" && data.status !== "DISABLED";
  });
  const salaries = new Map(people.map((doc) => [doc.id, readSalary(doc.data).salary]));
  const joined = new Map(people.map((doc) => [doc.id, joinedDayKeyOf(doc.data)]));
  const attendance = await attendanceByUid(month, policy, salaries, joined, fresh);

  const lines: PayrollLine[] = [];
  for (const doc of people) {
    const data = doc.data;
    const figures = attendance.get(doc.id);
    const line = buildMonthLine({
      uid: doc.id,
      name: (data.name as string) ?? (data.email as string) ?? "Unnamed",
      email: (data.email as string) ?? null,
      jobTitle: roleTitle(data),
      monthKey: month,
      ...readSalary(data),
      joinedDayKey: joined.get(doc.id) ?? null,
      commission: commission.get(doc.id) ?? 0,
      attendanceDeduction: figures?.deduction ?? 0,
      deductionBasis: figures?.basis ?? [],
      lateCount: figures?.late ?? 0,
      absentCount: figures?.absent ?? 0,
      leaveCount: figures?.leave ?? 0,
      presentCount: figures?.present ?? 0,
    });
    if (line) lines.push(line);
  }
  return lines;
}

function paymentState(amount: number, paidAmount: number) {
  return paidAmount <= 0 ? ("UNPAID" as const) : paidAmount >= amount ? ("PAID" as const) : ("PARTIALLY_PAID" as const);
}

/**
 * One month: live figures for everybody, except anybody already paid, whose
 * figures come from their payslip and do not move again.
 */
export async function getPayroll(token: string, monthKey: string): Promise<ActionResult<PayrollPeriod>> {
  return runAction("getPayroll", async () => {
    await requirePayrollAccess(token);
    const month = monthKey.slice(0, 7);

    const [live, slips] = await Promise.all([
      liveLines(month),
      adminDb.collection(SLIPS).where("monthKey", "==", month).get(),
    ]);

    const byUid = new Map(live.map((line) => [line.uid, line]));
    const payments: PayrollPeriod["payments"] = {};

    for (const slip of slips.docs) {
      const data = slip.data();
      if (data.current === false) continue;
      const paidAmount = Number(data.paidAmount ?? 0);
      if (paidAmount <= 0) continue; // written for a payment that never went through
      const line = data.line as PayrollLine | undefined;
      if (!line?.uid) continue;
      const amount = typeof data.amount === "number" ? data.amount : line.net;
      byUid.set(line.uid, line);
      payments[line.uid] = { amount, paidAmount, status: paymentState(amount, paidAmount) };
    }

    const lines = [...byUid.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const line of lines) {
      payments[line.uid] ??= { amount: line.net, paidAmount: 0, status: "UNPAID" };
    }

    const totals = payrollTotals(lines);
    const paidAmount = Object.values(payments).reduce((sum, entry) => sum + entry.paidAmount, 0);
    return { monthKey: month, lines, totals, amount: totals.net, paidAmount, payments };
  });
}

/* -------------------------------------------------------------------------- */
/* Paying                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Pays one person's month out of one or more accounts. **The admin's alone.**
 *
 * The first payment freezes their figures onto the payslip; a later part
 * payment pays against those frozen figures. The money itself goes through
 * `payFromAccounts`, so the split, the over-payment refusal and the duplicate
 * guard are the ledger's own.
 */
export async function payPayrollLine(
  token: string,
  monthKey: string,
  uid: string,
  input: {
    allocations: Array<{ accountId: string; amount: number }>;
    dayKey?: string;
    note?: string | null;
  }
): Promise<ActionResult<{ posted: number; fullyPaid: boolean }>> {
  return runAction("payPayrollLine", async () => {
    const auth = await verifyAuth(token);
    if (auth.role !== "admin") throw new UserFacingError("Only an administrator can pay a salary.");

    const month = monthKey.slice(0, 7);
    if (month > karachiMonthKey()) throw new UserFacingError("That month has not started yet.");

    const slipRef = adminDb.collection(SLIPS).doc(`${uid}_${month}`);
    const slipSnap = await slipRef.get();
    const alreadyPaid = Number(slipSnap.data()?.paidAmount ?? 0);

    let line = slipSnap.data()?.line as PayrollLine | undefined;
    if (alreadyPaid <= 0 || !line) {
      // Fresh: this line becomes the payslip, so it must not come from a copy.
      line = (await liveLines(month, true)).find((entry) => entry.uid === uid);
      if (!line) throw new UserFacingError("That person is not on this month's payroll.");
      if (line.net <= 0) throw new UserFacingError(`${line.name} has nothing to pay for ${month}.`);
      await slipRef.set(
        {
          uid,
          monthKey: month,
          status: "APPROVED" as PayrollStatus,
          line,
          amount: line.net,
          current: true,
          approvedAt: FieldValue.serverTimestamp(),
          approvedByUid: auth.uid,
          approvedByName: auth.name ?? auth.email ?? null,
        },
        { merge: true }
      );
    }

    const result = await payFromAccounts(token, {
      sourceModule: "PAYROLL",
      sourceCollection: SLIPS,
      sourceId: `${uid}_${month}`,
      sourceLabel: `${line.name} — salary ${month}`,
      allocations: input.allocations,
      dayKey: input.dayKey,
      note: input.note ?? null,
    });
    if (!result.ok) throw new UserFacingError(result.error);

    if (result.data.fullyPaid) {
      const batch = adminDb.batch();
      batch.update(slipRef, { status: "PAID" as PayrollStatus, paidAt: FieldValue.serverTimestamp() });
      batch.set(adminDb.collection("notifications").doc(), {
        type: "SALARY_PAID",
        leadId: null,
        targetRole: "employee",
        targetUid: uid,
        payload: {
          message: `Your salary for ${month} has been paid: Rs ${line.net.toLocaleString("en-PK")}.`,
          monthKey: month,
        },
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });
      await batch.commit();
    }

    return { posted: result.data.posted, fullyPaid: result.data.fullyPaid };
  });
}

/* -------------------------------------------------------------------------- */
/* Payslips                                                                    */
/* -------------------------------------------------------------------------- */

export interface Payslip {
  id: string;
  uid: string;
  monthKey: string;
  status: PayrollStatus;
  line: PayrollLine;
  current: boolean;
  approvedAt: string | null;
  approvedByName: string | null;
}

/**
 * Somebody's salary history — only months money has actually been paid for.
 * An employee gets their own; anybody else's needs payroll access.
 */
export async function getPayslips(
  token: string,
  uid?: string
): Promise<ActionResult<{ slips: Payslip[] }>> {
  return runAction("getPayslips", async () => {
    const auth = await verifyAuth(token);
    const target = (uid ?? "").trim() || auth.uid;
    if (target !== auth.uid) await requirePayrollAccess(token);

    const snap = await adminDb
      .collection(SLIPS)
      .where("uid", "==", target)
      .orderBy("monthKey", "desc")
      .limit(36)
      .get();

    return {
      slips: snap.docs
        .filter((doc) => Number(doc.data().paidAmount ?? 0) > 0 || doc.data().status === "PAID")
        .map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            uid: String(data.uid ?? target),
            monthKey: String(data.monthKey ?? ""),
            status: (data.status as PayrollStatus) ?? "APPROVED",
            line: data.line as PayrollLine,
            current: data.current !== false,
            approvedAt: data.approvedAt?.toDate?.()?.toISOString() ?? null,
            approvedByName: (data.approvedByName as string) ?? null,
          };
        }),
    };
  });
}
