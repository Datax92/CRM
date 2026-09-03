/**
 * Payroll arithmetic and the payroll state machine.
 *
 * Pure and dependency-free, so the raw `--experimental-strip-types` test
 * loader can reach it and so the figure an employee sees on their slip is
 * produced by the same function that produced the figure HR approved. A second
 * implementation on either side is how a payslip comes to disagree with the
 * payroll it came from.
 *
 * **Nothing here reads a database.** Commission and attendance deductions
 * arrive as numbers the caller has already fetched from `dealPayouts` and
 * `attendancePeriods` — this module never re-derives them, because duplicating
 * that derivation is exactly the duplication the brief forbids.
 */

/** The recurring parts of somebody's pay, set once and reused every month. */
export interface SalaryProfile {
  /** Monthly basic. The same `users/{uid}.monthlySalary` attendance already uses. */
  basic: number;
  /** Fixed monthly allowances — house, fuel, phone. */
  allowances: number;
  /** A recurring bonus. One-off bonuses go on the payroll line instead. */
  bonus: number;
  /** Anything else added every month. */
  otherAdditions: number;
  /** A standing deduction — a loan repayment, say. */
  otherDeductions: number;
  /**
   * Whether deal commission is paid through payroll at all. Some businesses
   * pay it separately; switching it off here keeps the payroll line honest
   * rather than showing a figure that is settled elsewhere.
   */
  includeCommission: boolean;
  /** Whether attendance deductions are applied to this person. */
  applyAttendanceDeductions: boolean;
}

export const DEFAULT_SALARY_PROFILE: SalaryProfile = {
  basic: 0,
  allowances: 0,
  bonus: 0,
  otherAdditions: 0,
  otherDeductions: 0,
  includeCommission: true,
  applyAttendanceDeductions: true,
};

/**
 * One person's month.
 *
 * `commission` and `attendanceDeduction` are copied in from the systems that
 * own them. Once a period is approved these numbers are **frozen** on the
 * stored line, so a later change to a deal split or a deduction rule cannot
 * move a month that has been paid.
 */
export interface PayrollLine {
  uid: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  /** Recorded on the line, not looked up, so history stays readable. */
  basic: number;
  allowances: number;
  bonus: number;
  /** One-off addition this month only — a spot bonus, a reimbursement. */
  extraAdditions: number;
  /** From `dealPayouts`, this month's finalised shares. */
  commission: number;
  /** From `attendancePeriods`, or computed live while the month is open. */
  attendanceDeduction: number;
  /** Standing deduction from the profile, plus anything added this month. */
  otherDeductions: number;
  /** Late arrivals behind `attendanceDeduction`, for the slip to explain itself. */
  lateCount: number;
  absentCount: number;
  leaveCount: number;
  presentCount: number;
  /** Free text an approver added — why a figure was adjusted. */
  note: string | null;
  net: number;
}

/** Payroll moves in one direction until somebody deliberately sends it back. */
export const PAYROLL_STATUSES = ["DRAFT", "REVIEWED", "APPROVED", "PAID"] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  DRAFT: "Draft",
  REVIEWED: "Reviewed",
  APPROVED: "Approved",
  PAID: "Paid",
};

/**
 * Which statuses a period may move to.
 *
 * Forward one step at a time, and back one step at a time — an approved
 * payroll that turned out to be wrong has to be correctable, but jumping
 * straight from Draft to Paid would skip the two reviews the workflow exists
 * for. **`PAID` is terminal**: money has left the building, and the way to fix
 * a paid month is an adjustment on the next one, not a rewrite of this one.
 */
export function allowedTransitions(from: PayrollStatus): PayrollStatus[] {
  switch (from) {
    case "DRAFT":
      return ["REVIEWED"];
    case "REVIEWED":
      return ["APPROVED", "DRAFT"];
    case "APPROVED":
      return ["PAID", "REVIEWED"];
    case "PAID":
      return [];
  }
}

export function canTransition(from: PayrollStatus, to: PayrollStatus): boolean {
  return allowedTransitions(from).includes(to);
}

/**
 * Whether the figures may still change.
 *
 * Draft and Reviewed are working states; Approved and Paid are decisions. The
 * brief is explicit that a finalised period must not be recalculated when
 * settings change later, and this is the one predicate that enforces it —
 * every write path asks it before touching a line.
 */
export function isEditable(status: PayrollStatus): boolean {
  return status === "DRAFT" || status === "REVIEWED";
}

/** Rupees, never fractional — payroll in paisa is a rounding argument nobody wins. */
function money(value: unknown): number {
  const number = Math.round(Number(value) || 0);
  return Number.isFinite(number) ? number : 0;
}

export interface PayrollTotals {
  additions: number;
  deductions: number;
  net: number;
}

/**
 * Basic + additions − deductions.
 *
 * Deductions are floored at the total additions rather than allowed to run
 * negative: a month where the deductions exceed the pay produces a net of
 * zero and the shortfall stays visible as the deduction figure. Paying
 * somebody a negative salary is not a thing that can happen, and letting the
 * arithmetic say otherwise would put a minus sign on a payslip.
 */
export function computeLineTotals(line: {
  basic: number;
  allowances: number;
  bonus: number;
  extraAdditions: number;
  commission: number;
  attendanceDeduction: number;
  otherDeductions: number;
}): PayrollTotals {
  const additions =
    money(line.basic) +
    money(line.allowances) +
    money(line.bonus) +
    money(line.extraAdditions) +
    money(line.commission);

  const deductions = money(line.attendanceDeduction) + money(line.otherDeductions);

  return { additions, deductions, net: Math.max(0, additions - deductions) };
}

/**
 * Builds a payroll line from a profile plus the two figures that come from
 * other modules.
 *
 * The profile's two switches are honoured here rather than at the call site,
 * so an employee whose commission is settled outside payroll cannot have it
 * quietly included by a caller that forgot to check.
 */
export function buildPayrollLine(input: {
  uid: string;
  name: string;
  email?: string | null;
  jobTitle?: string | null;
  profile: SalaryProfile;
  commission: number;
  attendanceDeduction: number;
  lateCount?: number;
  absentCount?: number;
  leaveCount?: number;
  presentCount?: number;
  extraAdditions?: number;
  extraDeductions?: number;
  note?: string | null;
}): PayrollLine {
  const { profile } = input;

  const commission = profile.includeCommission ? money(input.commission) : 0;
  const attendanceDeduction = profile.applyAttendanceDeductions
    ? money(input.attendanceDeduction)
    : 0;
  const otherDeductions = money(profile.otherDeductions) + money(input.extraDeductions);

  const parts = {
    basic: money(profile.basic),
    allowances: money(profile.allowances),
    bonus: money(profile.bonus),
    extraAdditions: money(profile.otherAdditions) + money(input.extraAdditions),
    commission,
    attendanceDeduction,
    otherDeductions,
  };

  return {
    uid: input.uid,
    name: input.name,
    email: input.email ?? null,
    jobTitle: input.jobTitle ?? null,
    ...parts,
    lateCount: Math.max(0, Math.floor(input.lateCount ?? 0)),
    absentCount: Math.max(0, Math.floor(input.absentCount ?? 0)),
    leaveCount: Math.max(0, Math.floor(input.leaveCount ?? 0)),
    presentCount: Math.max(0, Math.floor(input.presentCount ?? 0)),
    note: input.note?.trim() || null,
    net: computeLineTotals(parts).net,
  };
}

/** Recomputes `net` after an approver edits a figure by hand. */
export function repriceLine(line: PayrollLine, patch: Partial<PayrollLine>): PayrollLine {
  const next = {
    ...line,
    ...patch,
    basic: money(patch.basic ?? line.basic),
    allowances: money(patch.allowances ?? line.allowances),
    bonus: money(patch.bonus ?? line.bonus),
    extraAdditions: money(patch.extraAdditions ?? line.extraAdditions),
    commission: money(patch.commission ?? line.commission),
    attendanceDeduction: money(patch.attendanceDeduction ?? line.attendanceDeduction),
    otherDeductions: money(patch.otherDeductions ?? line.otherDeductions),
  };

  return { ...next, net: computeLineTotals(next).net };
}

/** What a whole period comes to. */
export function payrollTotals(lines: PayrollLine[]): PayrollTotals & {
  people: number;
  commission: number;
  attendanceDeduction: number;
} {
  return lines.reduce(
    (sum, line) => {
      const totals = computeLineTotals(line);
      return {
        people: sum.people + 1,
        additions: sum.additions + totals.additions,
        deductions: sum.deductions + totals.deductions,
        net: sum.net + totals.net,
        commission: sum.commission + money(line.commission),
        attendanceDeduction: sum.attendanceDeduction + money(line.attendanceDeduction),
      };
    },
    { people: 0, additions: 0, deductions: 0, net: 0, commission: 0, attendanceDeduction: 0 }
  );
}

/** Fills anything missing on a stored profile with the default. */
export function normalizeSalaryProfile(raw: Partial<SalaryProfile> | undefined): SalaryProfile {
  return {
    basic: money(raw?.basic),
    allowances: money(raw?.allowances),
    bonus: money(raw?.bonus),
    otherAdditions: money(raw?.otherAdditions),
    otherDeductions: money(raw?.otherDeductions),
    // Absent means yes for both, so adding these fields cannot silently stop
    // paying commission to everybody who predates them.
    includeCommission: raw?.includeCommission !== false,
    applyAttendanceDeductions: raw?.applyAttendanceDeductions !== false,
  };
}
