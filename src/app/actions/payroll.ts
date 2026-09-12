"use server";

import { adminDb } from "@/lib/firebase/server";
import {
  verifyAuth,
  requireAdmin,
  requireManager,
  type DecodedAuth,
} from "@/lib/firebase/serverAuth";
import { isHrManager } from "@/lib/constants/hierarchy";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiMonthKey } from "@/lib/dates";
import { monthAttendanceDeductions, type AttendancePolicy } from "@/lib/attendancePolicy";
import {
  DEFAULT_SALARY_PROFILE,
  buildPayrollLine,
  canTransition,
  isEditable,
  normalizeSalaryProfile,
  payrollTotals,
  repriceLine,
  type PayrollLine,
  type PayrollStatus,
  type SalaryProfile,
} from "@/lib/payroll";
import { statusOfRecord } from "@/lib/attendance";
import { roleTitle } from "@/lib/constants/hierarchy";
import { readPolicy } from "./attendance";
import { payFromAccounts } from "./ledger";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Payroll.
 *
 * **Nothing here owns data another module already owns.** The roster is
 * `users/*`; commission is `dealPayouts`, written by Profit Distribution;
 * attendance deductions are `attendancePeriods` (or, while a month is still
 * open, computed from the same `monthDeductions` the attendance screens use).
 * Payroll's own documents hold the salary profile, the generated lines and the
 * approval state — nothing else.
 *
 * **Two collections, for the same reason the deal split has two.** Firestore
 * grants a whole document or none of it, so a period document holding every
 * employee's pay cannot be shown to one employee. `payrollPeriods/{YYYY-MM}`
 * is the admin's and HR's; `payslips/{uid}_{YYYY-MM}` is one row per person,
 * readable by that person. A manager sees neither unless the admin has granted
 * it — the brief is explicit that salary amounts are not a manager's by
 * default.
 */

const PERIODS = "payrollPeriods";
const SLIPS = "payslips";

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Who may run payroll.
 *
 * The admin and an HR manager, and nobody else. A Sales manager is refused
 * outright rather than scoped to their team: the brief says a manager has no
 * access to salary amounts "unless explicitly granted by Admin", and that
 * grant is `salaryAccess: true` on their own profile — an opt-in that has to be
 * set deliberately, one person at a time.
 */
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

/* -------------------------------------------------------------------------- */
/* Salary profiles                                                             */
/* -------------------------------------------------------------------------- */

export interface SalaryProfileRecord extends SalaryProfile {
  uid: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  role: string;
}

/** Every employee's recurring pay, for the configuration screen. */
export async function listSalaryProfiles(
  token: string
): Promise<ActionResult<{ profiles: SalaryProfileRecord[] }>> {
  return runAction("listSalaryProfiles", async () => {
    await requirePayrollAccess(token);

    const snap = await adminDb.collection("users").get();
    const profiles = snap.docs
      .filter((doc) => doc.data().role !== "admin")
      .map((doc) => {
        const data = doc.data();
        return {
          uid: doc.id,
          name: (data.name as string) ?? (data.email as string) ?? "Unnamed",
          email: (data.email as string) ?? null,
          jobTitle: roleTitle(data),
          role: (data.role as string) ?? "employee",
          ...readProfile(data),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { profiles };
  });
}

/**
 * Reads a salary profile off a user document.
 *
 * `basic` falls back to `monthlySalary` — the field attendance already uses for
 * percentage deductions. One salary figure, not two: a payroll basic that could
 * disagree with the number the deduction was calculated from is a bug waiting
 * for its first percentage rule.
 */
function readProfile(data: FirebaseFirestore.DocumentData): SalaryProfile {
  const stored = (data.salaryProfile ?? {}) as Partial<SalaryProfile>;
  return normalizeSalaryProfile({
    ...stored,
    basic: stored.basic ?? Number(data.monthlySalary ?? 0),
  });
}

/**
 * Sets one employee's recurring pay.
 *
 * Writes `monthlySalary` alongside `salaryProfile.basic` so the attendance
 * module's percentage deduction and payroll's basic can never drift apart.
 * The previous values are appended to the profile's own history — the brief
 * asks for who changed what and when, and a salary is the field people argue
 * about most.
 */
export async function saveSalaryProfile(
  token: string,
  uid: string,
  input: Partial<SalaryProfile>
): Promise<ActionResult<{ profile: SalaryProfile }>> {
  return runAction("saveSalaryProfile", async () => {
    const auth = await requirePayrollAccess(token);

    const ref = adminDb.collection("users").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That employee no longer exists.");

    const data = snap.data() ?? {};
    if (data.role === "admin") {
      throw new UserFacingError("The administrator's own account is not on the payroll.");
    }

    const previous = readProfile(data);
    const next = normalizeSalaryProfile({ ...previous, ...input });

    await ref.update({
      salaryProfile: next,
      // One salary figure, shared with the attendance deduction.
      monthlySalary: next.basic,
      salaryHistory: FieldValue.arrayUnion({
        at: new Date(),
        byUid: auth.uid,
        byName: auth.name ?? auth.email ?? null,
        from: previous,
        to: next,
      }),
    });

    return { profile: next };
  });
}

/* -------------------------------------------------------------------------- */
/* Generating a month                                                          */
/* -------------------------------------------------------------------------- */

export interface PayrollPeriod {
  monthKey: string;
  status: PayrollStatus;
  lines: PayrollLine[];
  totals: ReturnType<typeof payrollTotals>;
  generatedAt: string | null;
  generatedByUid: string | null;
  /**
   * **What the month owes, and how much of it has actually left an account.**
   *
   * `amount` is the net total, written whenever the period is generated;
   * `paidAmount` is **summed from the payslips** rather than stored, because
   * salaries are paid one person at a time and a second running total is a
   * second thing that can be wrong.
   *
   * Approving a payroll says the company agreed the figures; paying says the
   * money moved. Two different facts, and the screen shows both — exactly as an
   * office expense does.
   */
  amount: number;
  paidAmount: number;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  /** Per person, keyed by uid. Empty until the month is approved. */
  payments: Record<string, { amount: number; paidAmount: number; status: string }>;
  /** Every status change and every line edit, oldest first. */
  history: {
    at: string | null;
    byUid: string;
    byName: string | null;
    action: string;
    detail: string | null;
  }[];
  exists: boolean;
}

/** Commission actually paid out in a month, per person, from `dealPayouts`. */
async function commissionByUid(monthKey: string): Promise<Map<string, number>> {
  const [year, month] = monthKey.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));

  // Scoped by when the split was finalised, not when the deal closed: the
  // commission becomes payable when the admin approves the split, and paying
  // it in the month the deal closed would mean re-opening a paid payroll every
  // time a late split landed.
  const snap = await adminDb
    .collection("dealPayouts")
    .where("finalizedAt", ">=", from)
    .where("finalizedAt", "<", to)
    .get();

  const totals = new Map<string, number>();
  for (const doc of snap.docs) {
    const data = doc.data();
    // A superseded split is not money anybody is owed.
    if (data.current === false) continue;
    const uid = String(data.recipientUid ?? "");
    if (!uid) continue;
    totals.set(uid, (totals.get(uid) ?? 0) + Number(data.amount ?? 0));
  }
  return totals;
}

interface AttendanceFigures {
  deduction: number;
  late: number;
  absent: number;
  leave: number;
  present: number;
  /** Why the deduction is what it is, one line per charge. */
  basis: string[];
}

/**
 * A month's attendance, per person.
 *
 * **A closed attendance period wins.** Once HR has finalised the month's
 * deductions those amounts are fixed, and recomputing them here from the live
 * policy is exactly the retroactive recalculation the brief forbids. Only an
 * open month is calculated fresh.
 */
async function attendanceByUid(
  monthKey: string,
  policy: AttendancePolicy,
  salaries: Map<string, number>
): Promise<Map<string, AttendanceFigures>> {
  const [periodSnap, records] = await Promise.all([
    adminDb.collection("attendancePeriods").doc(monthKey).get(),
    adminDb
      .collection("attendance")
      .where("dayKey", ">=", `${monthKey}-01`)
      .where("dayKey", "<=", `${monthKey}-31`)
      .get(),
  ]);

  const figures = new Map<string, AttendanceFigures>();
  const bump = (uid: string, patch: Partial<AttendanceFigures>) => {
    const current =
      figures.get(uid) ?? { deduction: 0, late: 0, absent: 0, leave: 0, present: 0, basis: [] };
    figures.set(uid, {
      deduction: current.deduction + (patch.deduction ?? 0),
      late: current.late + (patch.late ?? 0),
      absent: current.absent + (patch.absent ?? 0),
      leave: current.leave + (patch.leave ?? 0),
      present: current.present + (patch.present ?? 0),
      basis: patch.basis ?? current.basis,
    });
  };

  for (const doc of records.docs) {
    const data = doc.data();
    const uid = String(data.uid ?? "");
    if (!uid) continue;

    // The same reader every other surface uses, so payroll and the calendar
    // cannot disagree about a day somebody is being paid for.
    const status = statusOfRecord(data);

    if (status === "LATE") bump(uid, { late: 1, present: 1 });
    else if (status === "ABSENT") bump(uid, { absent: 1 });
    else if (status === "LEAVE") bump(uid, { leave: 1 });
    else if (status === "PRESENT") bump(uid, { present: 1 });
  }

  const closed = periodSnap.exists && periodSnap.data()?.finalized;
  if (closed) {
    for (const line of (periodSnap.data()?.lines ?? []) as { uid: string; amount: number }[]) {
      bump(line.uid, { deduction: Number(line.amount ?? 0) });
    }
  } else {
    /*
      **Lates *and* absences.** This read `monthDeductions(entry.late, …)` until
      2026-09-12, so a month of absences reduced nobody's pay — measured on the
      live September payroll, all seven people were docked Rs 0 including
      somebody absent five days on a 35,000 salary. `monthAttendanceDeductions`
      is the single reading of "what does this month's attendance cost", so the
      two halves can never again be added at one call site and forgotten at
      another.
    */
    for (const [uid, entry] of figures) {
      const charges = monthAttendanceDeductions(
        { late: entry.late, absent: entry.absent },
        policy,
        salaries.get(uid) ?? 0
      );
      bump(uid, {
        deduction: charges.total,
        // Frozen onto the line so a payslip can say *why* — "Absence #1 of the
        // month — one day's pay (26-day month)" — for ever, even after the
        // policy behind it changes.
        basis: [...charges.late, ...charges.absent]
          .filter((outcome) => outcome.deducted)
          .map((outcome) => outcome.basis),
      });
    }
  }

  return figures;
}

/**
 * Builds (or rebuilds) a month's payroll as a draft.
 *
 * Regenerating a draft is deliberate and safe — commission and attendance move
 * during a month, and HR needs the current picture before reviewing. It is
 * **refused once the period is approved or paid**: that is the whole of "a
 * finalised period must not be recalculated when settings change later".
 */
export async function generatePayroll(
  token: string,
  monthKey: string
): Promise<ActionResult<{ monthKey: string; people: number; net: number }>> {
  return runAction("generatePayroll", async () => {
    const auth = await requirePayrollAccess(token);
    const month = monthKey.slice(0, 7);

    if (month > karachiMonthKey()) {
      throw new UserFacingError("That month has not started yet.");
    }

    const ref = adminDb.collection(PERIODS).doc(month);
    const existing = await ref.get();
    const status = (existing.data()?.status as PayrollStatus) ?? "DRAFT";

    if (existing.exists && !isEditable(status)) {
      throw new UserFacingError(
        `${month} is ${status.toLowerCase()} and cannot be regenerated. Send it back for review first.`
      );
    }

    const [policy, usersSnap, commission] = await Promise.all([
      readPolicy(),
      adminDb.collection("users").get(),
      commissionByUid(month),
    ]);

    const people = usersSnap.docs.filter((doc) => doc.data().role !== "admin");
    const salaries = new Map(
      people.map((doc) => [doc.id, Number(doc.data().monthlySalary ?? 0)])
    );
    const attendance = await attendanceByUid(month, policy, salaries);

    const lines: PayrollLine[] = people.map((doc) => {
      const data = doc.data();
      const figures = attendance.get(doc.id);

      return buildPayrollLine({
        uid: doc.id,
        name: (data.name as string) ?? (data.email as string) ?? "Unnamed",
        email: (data.email as string) ?? null,
        // A manager's kind, an employee's job title — see `listSalaryProfiles`.
        jobTitle: roleTitle(data),
        profile: readProfile(data),
        commission: commission.get(doc.id) ?? 0,
        attendanceDeduction: figures?.deduction ?? 0,
        deductionBasis: figures?.basis ?? [],
        lateCount: figures?.late ?? 0,
        absentCount: figures?.absent ?? 0,
        leaveCount: figures?.leave ?? 0,
        presentCount: figures?.present ?? 0,
      });
    });

    lines.sort((a, b) => a.name.localeCompare(b.name));
    const totals = payrollTotals(lines);

    await ref.set(
      {
        monthKey: month,
        status: "DRAFT",
        lines,
        totals,
        /*
          **The obligation, in the shape the ledger already understands.**
          `payFromAccounts` reads `amount` off whatever record it is funding —
          so writing the net total here is the whole of what makes a payroll
          payable from the Committee, Car Sale or any other account, with the
          same split control and the same duplicate-payment guard every other
          module uses.

          Regenerating is only possible while the period is editable, and an
          editable period cannot have been paid, so resetting the payment here
          can never wipe a payment that exists.
        */
        amount: totals.net,
        paidAmount: 0,
        paymentStatus: "UNPAID",
        generatedAt: FieldValue.serverTimestamp(),
        generatedByUid: auth.uid,
        history: FieldValue.arrayUnion({
          at: new Date(),
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
          action: existing.exists ? "REGENERATED" : "GENERATED",
          detail: `${lines.length} employees, net ${totals.net}`,
        }),
      },
      { merge: true }
    );

    return { monthKey: month, people: lines.length, net: totals.net };
  });
}

/** One month, for the payroll screen. */
export async function getPayroll(
  token: string,
  monthKey: string
): Promise<ActionResult<PayrollPeriod>> {
  return runAction("getPayroll", async () => {
    await requirePayrollAccess(token);
    const month = monthKey.slice(0, 7);

    const snap = await adminDb.collection(PERIODS).doc(month).get();
    if (!snap.exists) {
      return {
        monthKey: month,
        status: "DRAFT" as PayrollStatus,
        lines: [],
        totals: payrollTotals([]),
        amount: 0,
        paidAmount: 0,
        paymentStatus: "UNPAID" as const,
        payments: {},
        generatedAt: null,
        generatedByUid: null,
        history: [],
        exists: false,
      };
    }

    const data = snap.data() ?? {};
    const lines = (data.lines ?? []) as PayrollLine[];

    /*
      **Each person's payment, read from their payslip.** They exist only once
      the month is approved, so before that this is empty and the screen shows
      no Pay from — which is the rule, not a coincidence.
    */
    const payments: PayrollPeriod["payments"] = {};
    let paidTotal = 0;
    if (data.status === "APPROVED" || data.status === "PAID") {
      const slips = await adminDb.collection(SLIPS).where("monthKey", "==", month).get();
      for (const slip of slips.docs) {
        const slipData = slip.data();
        if (slipData.current === false) continue;
        const uid = String(slipData.uid ?? "");
        if (!uid) continue;
        const amount = typeof slipData.amount === "number"
          ? slipData.amount
          : Number((slipData.line as PayrollLine | undefined)?.net ?? 0);
        const paidAmount = Number(slipData.paidAmount ?? 0);
        paidTotal += paidAmount;
        payments[uid] = {
          amount,
          paidAmount,
          status: paidAmount <= 0 ? "UNPAID" : paidAmount >= amount ? "PAID" : "PARTIALLY_PAID",
        };
      }
    }

    return {
      monthKey: month,
      status: (data.status as PayrollStatus) ?? "DRAFT",
      payments,
      lines,
      totals: payrollTotals(lines),
      /*
        **Read out of the snapshot, not assumed.** A field typed on an
        interface and never taken out of the document is this project's most
        repeated bug — seven times now — and it never shows as an error, only
        as a screen confidently displaying the default. `amount` falls back to
        the recomputed net so a period generated before this field existed is
        still payable.
      */
      amount: typeof data.amount === "number" ? data.amount : payrollTotals(lines).net,
      // Summed from the payslips above — never a stored second total.
      paidAmount: paidTotal,
      paymentStatus:
        paidTotal <= 0
          ? ("UNPAID" as const)
          : paidTotal >= (typeof data.amount === "number" ? data.amount : payrollTotals(lines).net)
            ? ("PAID" as const)
            : ("PARTIALLY_PAID" as const),
      generatedAt: data.generatedAt?.toDate?.()?.toISOString() ?? null,
      generatedByUid: (data.generatedByUid as string) ?? null,
      history: ((data.history ?? []) as Record<string, unknown>[]).map((entry) => ({
        at: (entry.at as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? null,
        byUid: String(entry.byUid ?? ""),
        byName: (entry.byName as string) ?? null,
        action: String(entry.action ?? ""),
        detail: (entry.detail as string) ?? null,
      })),
      exists: true,
    };
  });
}

/**
 * Edits one line before the period is finalised.
 *
 * The previous values go into the period's history, so an adjusted figure can
 * always be traced back to what it was and who moved it. Refused outright once
 * the period is approved.
 */
export async function adjustPayrollLine(
  token: string,
  monthKey: string,
  uid: string,
  patch: Partial<PayrollLine>
): Promise<ActionResult<{ net: number }>> {
  return runAction("adjustPayrollLine", async () => {
    const auth = await requirePayrollAccess(token);
    const month = monthKey.slice(0, 7);
    const ref = adminDb.collection(PERIODS).doc(month);

    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("Generate the payroll for this month first.");

    const data = snap.data() ?? {};
    const status = (data.status as PayrollStatus) ?? "DRAFT";
    if (!isEditable(status)) {
      throw new UserFacingError(
        `${month} is ${status.toLowerCase()}. Send it back for review before changing a figure.`
      );
    }

    const lines = (data.lines ?? []) as PayrollLine[];
    const index = lines.findIndex((line) => line.uid === uid);
    if (index === -1) throw new UserFacingError("That employee is not on this payroll.");

    const before = lines[index];
    const after = repriceLine(before, patch);
    const next = [...lines];
    next[index] = after;

    await ref.update({
      lines: next,
      totals: payrollTotals(next),
      history: FieldValue.arrayUnion({
        at: new Date(),
        byUid: auth.uid,
        byName: auth.name ?? auth.email ?? null,
        action: "LINE_ADJUSTED",
        detail: `${before.name}: net ${before.net} → ${after.net}${
          after.note ? ` (${after.note})` : ""
        }`,
      }),
    });

    return { net: after.net };
  });
}

/**
 * Freezes the month onto one payslip per employee, and tells each of them.
 *
 * Shared by the status change and by the payment, which are two ways of
 * reaching the same state: approving copies the lines onto the slips, and
 * paying the last rupee moves the month to `PAID`. Two copies of this would be
 * two chances for a payslip to say something the payroll does not.
 */
function writeSlipsAndNotices(
  batch: FirebaseFirestore.WriteBatch,
  month: string,
  lines: PayrollLine[],
  status: PayrollStatus,
  auth: DecodedAuth
): void {
  for (const line of lines) {
    batch.set(
      adminDb.collection(SLIPS).doc(`${line.uid}_${month}`),
      {
        uid: line.uid,
        monthKey: month,
        status,
        line,
        /*
          **The payslip is the obligation, and that is what makes a salary
          payable per person.** `payFromAccounts` reads `amount` off whatever
          record it funds and writes `paidAmount` back, so one person's month
          can be settled from the Committee while another's comes out of Car
          Sale — which is what the owner asked for.

          It only exists once the month is approved, which is exactly when
          paying becomes allowed. `merge: true` means a re-approval never
          resets a payment that has already been made.
        */
        amount: line.net,
        current: true,
        approvedAt: FieldValue.serverTimestamp(),
        approvedByUid: auth.uid,
        approvedByName: auth.name ?? auth.email ?? null,
      },
      { merge: true }
    );

    batch.set(adminDb.collection("notifications").doc(), {
      type: status === "PAID" ? "SALARY_PAID" : "SALARY_APPROVED",
      leadId: null,
      targetRole: "employee",
      targetUid: line.uid,
      payload: {
        message:
          status === "PAID"
            ? `Your salary for ${month} has been paid: Rs ${line.net.toLocaleString("en-PK")}.`
            : `Your salary slip for ${month} is ready: Rs ${line.net.toLocaleString("en-PK")}.`,
        monthKey: month,
      },
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
    });
  }
}

/**
 * Moves the period through Draft → Reviewed → Approved → Paid.
 *
 * **Approving freezes the month.** The lines are copied into one `payslips`
 * document per employee, which is what the employee reads and what survives
 * every later change to a salary, a deal split or a deduction rule. Sending an
 * approved period back for review marks those slips superseded rather than
 * deleting them — the record of what was approved is not something a
 * correction should destroy.
 */
export async function setPayrollStatus(
  token: string,
  monthKey: string,
  status: PayrollStatus
): Promise<ActionResult<{ status: PayrollStatus }>> {
  return runAction("setPayrollStatus", async () => {
    const auth = await requirePayrollAccess(token);
    const month = monthKey.slice(0, 7);
    const ref = adminDb.collection(PERIODS).doc(month);

    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("Generate the payroll for this month first.");

    const data = snap.data() ?? {};
    const current = (data.status as PayrollStatus) ?? "DRAFT";

    const isAdmin = auth.role === "admin";

    /*
      **Only the admin approves, and only the admin pays.** HR prepares a
      payroll and sends it up; approving their own would make the review step a
      formality that proved nothing — which is what it was, because this used to
      check the role on `PAID` alone.
    */
    if (status === "APPROVED" && !isAdmin) {
      throw new UserFacingError(
        "Only an administrator can approve a payroll. Send it for approval and the admin will release it."
      );
    }
    if (status === "PAID") {
      throw new UserFacingError(
        "A payroll becomes paid when the salaries are actually paid out of an account — use Pay from on each person."
      );
    }

    if (!canTransition(current, status, isAdmin)) {
      throw new UserFacingError(
        current === "PAID"
          ? "This payroll has been paid. Correct it with an adjustment on the next month rather than rewriting a paid one."
          : `A ${current.toLowerCase()} payroll cannot go straight to ${status.toLowerCase()}.`
      );
    }

    const lines = (data.lines ?? []) as PayrollLine[];
    const batch = adminDb.batch();

    batch.update(ref, {
      status,
      [`${status.toLowerCase()}At`]: FieldValue.serverTimestamp(),
      [`${status.toLowerCase()}ByUid`]: auth.uid,
      history: FieldValue.arrayUnion({
        at: new Date(),
        byUid: auth.uid,
        byName: auth.name ?? auth.email ?? null,
        action: `STATUS_${status}`,
        detail: `${current} → ${status}`,
      }),
    });

    // `PAID` is refused above — it is reached by paying, not by a status
    // change — so approving is the only thing that writes the slips here.
    if (status === "APPROVED") {
      writeSlipsAndNotices(batch, month, lines, status, auth);
    }

    if (status === "REVIEWED" && current === "APPROVED") {
      // Reopened. The slips stay, marked not current, so what was approved is
      // still readable after the correction.
      for (const line of lines) {
        batch.set(
          adminDb.collection(SLIPS).doc(`${line.uid}_${month}`),
          { current: false, supersededAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
    }

    await batch.commit();
    return { status };
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
 * Somebody's salary history.
 *
 * An employee gets their own and nothing else — passing another uid is refused
 * rather than filtered, so there is no path where a mistake in a caller leaks a
 * colleague's pay.
 */
export async function getPayslips(
  token: string,
  uid?: string
): Promise<ActionResult<{ slips: Payslip[] }>> {
  return runAction("getPayslips", async () => {
    const auth = await verifyAuth(token);
    const target = (uid ?? "").trim() || auth.uid;

    if (target !== auth.uid) {
      // Anyone asking about somebody else needs payroll access, full stop.
      await requirePayrollAccess(token);
    }

    const snap = await adminDb
      .collection(SLIPS)
      .where("uid", "==", target)
      .orderBy("monthKey", "desc")
      .limit(36)
      .get();

    return {
      slips: snap.docs.map((doc) => {
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

/**
 * Grants or removes a manager's access to salary figures.
 *
 * Admin only, and one person at a time — the brief's "unless explicitly
 * granted by Admin" is an opt-in, not a role.
 */
export async function setSalaryAccess(
  token: string,
  uid: string,
  granted: boolean
): Promise<ActionResult> {
  return runAction("setSalaryAccess", async () => {
    const auth = await requireAdmin(token);
    const ref = adminDb.collection("users").doc(uid);

    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That account no longer exists.");
    if (snap.data()?.role !== "subadmin") {
      throw new UserFacingError("Salary access is granted to managers, not to employees.");
    }

    await ref.update({
      salaryAccess: granted,
      salaryAccessSetAt: FieldValue.serverTimestamp(),
      salaryAccessSetByUid: auth.uid,
    });
  });
}

/** The default profile, so a caller can render an empty form without guessing. */
export async function defaultSalaryProfile(): Promise<SalaryProfile> {
  return { ...DEFAULT_SALARY_PROFILE };
}

/* -------------------------------------------------------------------------- */
/* Paying people, out of real accounts                                         */
/* -------------------------------------------------------------------------- */

/**
 * Pays **one person's** month out of one or more accounts.
 *
 * The owner's instruction: *"in front of every employee there should be an
 * option to pay from, after approved, and we can select any account which
 * generates income."* So the obligation is the **payslip** — `payslips/{uid}_{month}`,
 * which exists only once the month is approved and already carries the frozen
 * figures — and the funding is any account, exactly as an office expense works.
 * Sundus can be paid out of the Committee and Rafia out of Car Sale, on
 * different days, and each carries her own paid/unpaid state.
 *
 * It is a **wrapper, not a second payment path**: `payFromAccounts` does the
 * money, so this inherits the split arithmetic, the refusal to over-allocate
 * and the in-transaction guard that makes a double payment impossible. What it
 * adds is the three rules payroll owns and the ledger has no business knowing:
 *
 * - **Only an approved month may be paid.** Money must not leave against
 *   figures nobody has approved.
 * - **Only the admin pays.** HR prepares, reviews and approves.
 * - **When the last person is settled the month becomes `PAID`.** The status
 *   follows the money rather than the other way round.
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
): Promise<ActionResult<{ posted: number; fullyPaid: boolean; monthSettled: boolean }>> {
  return runAction("payPayrollLine", async () => {
    const auth = await verifyAuth(token);
    if (auth.role !== "admin") {
      throw new UserFacingError("Only an administrator can pay a salary.");
    }

    const month = monthKey.slice(0, 7);
    const periodRef = adminDb.collection(PERIODS).doc(month);
    const periodSnap = await periodRef.get();
    if (!periodSnap.exists) throw new UserFacingError("Generate the payroll for this month first.");

    const data = periodSnap.data() ?? {};
    const status = (data.status as PayrollStatus) ?? "DRAFT";
    if (status === "DRAFT" || status === "REVIEWED") {
      throw new UserFacingError(
        `${month} is ${status.toLowerCase()}. Approve it before paying anybody — money should not leave against figures nobody has approved.`
      );
    }

    const lines = (data.lines ?? []) as PayrollLine[];
    const line = lines.find((entry) => entry.uid === uid);
    if (!line) throw new UserFacingError("That employee is not on this payroll.");

    const slipRef = adminDb.collection(SLIPS).doc(`${uid}_${month}`);
    const slipSnap = await slipRef.get();
    if (!slipSnap.exists) throw new UserFacingError("That payslip does not exist yet.");
    // A slip approved before the payment fields existed carries no `amount`.
    if (typeof slipSnap.data()?.amount !== "number") {
      await slipRef.update({ amount: line.net });
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

    /*
      **The month is settled when everybody is.** Read back rather than counted
      up from this payment, so two people paid at once cannot both conclude
      they were the last.
    */
    const slips = await adminDb.collection(SLIPS).where("monthKey", "==", month).get();
    const settled = slips.docs
      .filter((doc) => doc.data().current !== false)
      .every((doc) => Number(doc.data().paidAmount ?? 0) >= Number(doc.data().amount ?? 0));

    if (settled && status === "APPROVED") {
      await periodRef.update({
        status: "PAID",
        paidAt: FieldValue.serverTimestamp(),
        paidByUid: auth.uid,
        history: FieldValue.arrayUnion({
          at: new Date(),
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
          action: "STATUS_PAID",
          detail: `APPROVED → PAID — everybody on ${month} has been paid`,
        }),
      });
    }

    return { posted: result.data.posted, fullyPaid: result.data.fullyPaid, monthSettled: settled };
  });
}

/**
 * Deletes a month's payroll so it can be started again.
 *
 * **The admin's alone**, at the owner's instruction — HR prepares a payroll and
 * does not throw one away.
 *
 * **Refused once a rupee of it has been paid.** Deleting then would leave money
 * gone from an account with nothing on the books explaining it, and unlike a
 * regenerate there would be no record left to correct. The message names who
 * has been paid so there is something to act on.
 */
export async function deletePayroll(
  token: string,
  monthKey: string
): Promise<ActionResult<{ slipsRemoved: number }>> {
  return runAction("deletePayroll", async () => {
    const auth = await requireAdmin(token);
    const month = monthKey.slice(0, 7);

    const ref = adminDb.collection(PERIODS).doc(month);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("There is no payroll for that month.");

    const slips = await adminDb.collection(SLIPS).where("monthKey", "==", month).get();
    const paid = slips.docs.filter((doc) => Number(doc.data().paidAmount ?? 0) > 0);
    if (paid.length > 0) {
      const names = paid
        .map((doc) => (doc.data().line as PayrollLine | undefined)?.name ?? "somebody")
        .slice(0, 3)
        .join(", ");
      throw new UserFacingError(
        `${month} cannot be deleted — ${paid.length} ${paid.length === 1 ? "salary has" : "salaries have"} already been paid (${names}${paid.length > 3 ? "…" : ""}). Remove those payments from their accounts first.`
      );
    }

    const batch = adminDb.batch();
    slips.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(ref);
    await batch.commit();

    void auth;
    return { slipsRemoved: slips.size };
  });
}
