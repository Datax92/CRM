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
  /**
   * **Why the attendance deduction is what it is**, in words, one line per
   * charge — "Absence #1 of the month — one day's pay (26-day month)".
   *
   * Frozen onto the line at generation, so a payslip explains itself for ever
   * even after the policy behind it changes. Optional, because lines generated
   * before this existed have none and must still render.
   */
  deductionBasis?: string[];
  /** Free text an approver added — why a figure was adjusted. */
  note: string | null;
  net: number;
  /**
   * The monthly figures before a mid-month joining cut them down, and the days
   * that cut was worked from. Absent on lines written before 2026-09-25.
   */
  salary?: number;
  allowance?: number;
  joinedAt?: string | null;
  paidDays?: number;
  monthDays?: number;
}

/** Payroll moves in one direction until somebody deliberately sends it back. */
export const PAYROLL_STATUSES = ["DRAFT", "REVIEWED", "APPROVED", "PAID"] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

/**
 * Since the simple payroll (2026-09-25) a status only says how much of a
 * person's month has been paid: a payslip is written `APPROVED` on its first
 * payment and becomes `PAID` when it is settled. `DRAFT` and `REVIEWED` are no
 * longer written; they read as not paid.
 */
export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  DRAFT: "Not paid",
  REVIEWED: "Not paid",
  APPROVED: "Part paid",
  PAID: "Paid",
};

/**
 * Which statuses a period may move to, **and it depends who is asking**.
 *
 * The owner's instruction, and it is the difference between a workflow and
 * ceremony: *"for HR he sends approval to admin; admin doesn't need approval."*
 *
 * | | HR | admin |
 * |---|---|---|
 * | Draft | → Reviewed *(send to the admin)* | → **Approved**, directly |
 * | Reviewed | → Draft *(take it back)* | → Approved, or → Draft |
 * | Approved | — | → Reviewed *(send it back to correct it)* |
 * | Paid | — | — |
 *
 * **Only the admin approves.** HR prepares a payroll and hands it up; letting
 * them approve their own would make the review step a formality that proved
 * nothing — and until 2026-09-12 that is exactly what it was, because the
 * server only checked the role on `PAID`.
 *
 * **The admin never sends anything to themselves.** A one-person chain of Draft
 * → Reviewed → Approved is three presses to say one thing, which is why the
 * owner could not tell what the buttons were for.
 *
 * **`PAID` is not reachable here at all.** A month becomes paid when the last
 * salary is actually paid out of an account — the status follows the money.
 * And it is terminal: the way to fix a paid month is an adjustment on the next
 * one, not a rewrite of this one.
 */
export function allowedTransitions(from: PayrollStatus, isAdmin = true): PayrollStatus[] {
  if (isAdmin) {
    switch (from) {
      case "DRAFT":
        return ["APPROVED"];
      case "REVIEWED":
        return ["APPROVED", "DRAFT"];
      case "APPROVED":
        return ["REVIEWED"];
      case "PAID":
        return [];
    }
  }

  switch (from) {
    case "DRAFT":
      return ["REVIEWED"];
    case "REVIEWED":
      return ["DRAFT"];
    case "APPROVED":
    case "PAID":
      return [];
  }
}

export function canTransition(from: PayrollStatus, to: PayrollStatus, isAdmin = true): boolean {
  return allowedTransitions(from, isAdmin).includes(to);
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
  /** Why the attendance deduction is what it is, one line per charge. */
  deductionBasis?: string[];
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
    // Only when the deduction was actually applied — a profile with attendance
    // deductions switched off must not carry an explanation for a charge that
    // was never made.
    deductionBasis: attendanceDeduction > 0 ? (input.deductionBasis ?? []) : [],
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

/* -------------------------------------------------------------------------- */
/* The simple payroll (owner, 2026-09-25)                                      */
/* -------------------------------------------------------------------------- */

/**
 * How much of a month somebody is paid for, from their joining date.
 *
 * `null` means they are not on this month at all — they joined after it ended.
 * No date, or a date before the month, is the whole month. Calendar days, not
 * working days: "joined on the 12th of a 30-day month" is 19/30 of a salary,
 * which is a figure anybody can check on a phone calculator.
 */
export function joiningShare(
  joinedDayKey: string | null | undefined,
  monthKey: string
): { paidDays: number; monthDays: number } | null {
  const [year, month] = monthKey.split("-").map(Number);
  const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!joinedDayKey || !/^\d{4}-\d{2}-\d{2}$/.test(joinedDayKey)) return { paidDays: monthDays, monthDays };
  const joinedMonth = joinedDayKey.slice(0, 7);
  if (joinedMonth > monthKey) return null;
  if (joinedMonth < monthKey) return { paidDays: monthDays, monthDays };
  const day = Number(joinedDayKey.slice(8, 10));
  return { paidDays: Math.max(0, monthDays - day + 1), monthDays };
}

/**
 * One person's month: salary + allowance (cut down for a mid-month joining)
 * + commission − the attendance deduction Attendance Settings produced.
 * `null` when they had not joined yet.
 */
export function buildMonthLine(input: {
  uid: string;
  name: string;
  email?: string | null;
  jobTitle?: string | null;
  monthKey: string;
  salary: number;
  allowance: number;
  joinedDayKey?: string | null;
  commission: number;
  attendanceDeduction: number;
  deductionBasis?: string[];
  lateCount?: number;
  absentCount?: number;
  leaveCount?: number;
  presentCount?: number;
}): PayrollLine | null {
  const share = joiningShare(input.joinedDayKey, input.monthKey);
  if (!share) return null;
  const part = (value: number) => money((money(value) * share.paidDays) / share.monthDays);

  const parts = {
    basic: part(input.salary),
    allowances: part(input.allowance),
    bonus: 0,
    extraAdditions: 0,
    commission: money(input.commission),
    attendanceDeduction: money(input.attendanceDeduction),
    otherDeductions: 0,
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
    deductionBasis: parts.attendanceDeduction > 0 ? (input.deductionBasis ?? []) : [],
    note: null,
    net: computeLineTotals(parts).net,
    salary: money(input.salary),
    allowance: money(input.allowance),
    joinedAt: input.joinedDayKey ?? null,
    paidDays: share.paidDays,
    monthDays: share.monthDays,
  };
}

/**
 * Salary and allowance off a user document. The allowance gathers every extra
 * the old five-part profile could hold (allowances, bonus, other additions), so
 * the Rs 3,000 three people already had is still paid.
 */
export function readSalary(data: {
  monthlySalary?: unknown;
  salaryProfile?: Partial<SalaryProfile> | null;
}): { salary: number; allowance: number } {
  const profile = data.salaryProfile ?? {};
  return {
    salary: money(profile.basic ?? data.monthlySalary),
    allowance: money(profile.allowances) + money(profile.bonus) + money(profile.otherAdditions),
  };
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
