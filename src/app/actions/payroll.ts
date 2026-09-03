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
import { monthDeductions, type AttendancePolicy } from "@/lib/attendancePolicy";
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
import { deriveStatus, type AttendanceStatus } from "@/lib/attendance";
import { readPolicy } from "./attendance";
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
          jobTitle: (data.jobTitle as string) ?? null,
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
      figures.get(uid) ?? { deduction: 0, late: 0, absent: 0, leave: 0, present: 0 };
    figures.set(uid, {
      deduction: current.deduction + (patch.deduction ?? 0),
      late: current.late + (patch.late ?? 0),
      absent: current.absent + (patch.absent ?? 0),
      leave: current.leave + (patch.leave ?? 0),
      present: current.present + (patch.present ?? 0),
    });
  };

  for (const doc of records.docs) {
    const data = doc.data();
    const uid = String(data.uid ?? "");
    if (!uid) continue;

    const first = data.firstActionAt?.toDate?.() ?? null;
    const minutes = Number(data.workedMinutes ?? 0);
    const status: AttendanceStatus =
      (data.overrideStatus as AttendanceStatus) ??
      (data.late ? "LATE" : deriveStatus(minutes, Boolean(first ?? data.checkedOut)));

    if (status === "LATE") bump(uid, { late: 1, present: 1 });
    else if (status === "ABSENT") bump(uid, { absent: 1 });
    else if (status === "LEAVE") bump(uid, { leave: 1 });
    else if (status === "PRESENT" || status === "HALF_DAY") bump(uid, { present: 1 });
  }

  const closed = periodSnap.exists && periodSnap.data()?.finalized;
  if (closed) {
    for (const line of (periodSnap.data()?.lines ?? []) as { uid: string; amount: number }[]) {
      bump(line.uid, { deduction: Number(line.amount ?? 0) });
    }
  } else {
    for (const [uid, entry] of figures) {
      bump(uid, {
        deduction: monthDeductions(entry.late, policy, salaries.get(uid) ?? 0).total,
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
        jobTitle: (data.jobTitle as string) ?? null,
        profile: readProfile(data),
        commission: commission.get(doc.id) ?? 0,
        attendanceDeduction: figures?.deduction ?? 0,
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
        generatedAt: null,
        generatedByUid: null,
        history: [],
        exists: false,
      };
    }

    const data = snap.data() ?? {};
    const lines = (data.lines ?? []) as PayrollLine[];

    return {
      monthKey: month,
      status: (data.status as PayrollStatus) ?? "DRAFT",
      lines,
      totals: payrollTotals(lines),
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

    if (!canTransition(current, status)) {
      throw new UserFacingError(
        current === "PAID"
          ? "This payroll has been paid. Correct it with an adjustment on the next month rather than rewriting a paid one."
          : `A ${current.toLowerCase()} payroll cannot go straight to ${status.toLowerCase()}.`
      );
    }

    // Only the admin marks money as paid. HR prepares and reviews; releasing
    // the payment is the decision the brief keeps with the admin.
    if (status === "PAID" && auth.role !== "admin") {
      throw new UserFacingError("Only an administrator can mark a payroll as paid.");
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

    if (status === "APPROVED" || status === "PAID") {
      for (const line of lines) {
        batch.set(
          adminDb.collection(SLIPS).doc(`${line.uid}_${month}`),
          {
            uid: line.uid,
            monthKey: month,
            status,
            line,
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
