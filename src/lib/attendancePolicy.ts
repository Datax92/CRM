/**
 * Attendance policy — the rules an admin or HR configures, and the arithmetic
 * that applies them.
 *
 * Everything here is **pure and dependency-free**, so the unit tests run it
 * under raw `node --experimental-strip-types`, and so the server action, the
 * cron sweep, the reports and the employee's own screen all reach the same
 * verdict from the same function. A late that the punch calls late and the
 * report calls on-time is worse than either answer alone.
 *
 * The clock arithmetic is done in **minutes since midnight, Karachi**, never on
 * `Date` objects. A check-in at 09:05 PKT is late or not late by the wall clock
 * the office runs on; comparing UTC instants would make the answer depend on
 * where the server happens to be.
 *
 * Nothing here is hard-coded policy. `DEFAULT_ATTENDANCE_POLICY` is a starting
 * point an admin overwrites — the deduction figure in particular is required to
 * be configurable (§5), so no amount appears anywhere else in the codebase.
 */

export type LeaveType = 'CASUAL' | 'MEDICAL';

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** How a late deduction is expressed. */
export type DeductionMode = 'AMOUNT' | 'PERCENT';

export interface AttendancePolicy {
  /**
   * Employees who may check in from any network — §2's explicit exception.
   * Field staff and anyone the admin has decided about, by uid.
   *
   * The stored field is still named `ipExemptUids`: it predates the address
   * check being removed, every existing installation has it, and renaming it
   * would silently empty the exemption list on the next read. What it means is
   * unchanged.
   */
  ipExemptUids: string[];

  /**
   * Whether check-in requires the device to be **at** the office.
   *
   * The strong check, and the reason the Wi-Fi name alone was never enough: a
   * saved network name travels home in somebody's pocket, a position does not.
   */
  locationRestriction: boolean;
  /** The office's latitude. `null` until somebody marks it. */
  officeLat: number | null;
  /** The office's longitude. `null` until somebody marks it. */
  officeLng: number | null;
  /**
   * How far from that point still counts as being at the office, in metres.
   *
   * Meant to be **generous**. Indoor positioning is routinely tens of metres
   * out, buildings are large, and a rule tight enough to catch somebody in the
   * car park will refuse people at their own desk. 150m is a small office and
   * its street; widen it rather than fight the error bars.
   */
  officeRadiusMeters: number;

  /**
   * Whether check-in requires the device to report an office Wi-Fi name.
   *
   * **The only network gate there is.** The address check it replaced is gone:
   * a business line's public IP is dynamic, so an allow-list built from it
   * stops matching without warning and then refuses everybody. The Wi-Fi name
   * is static, which is the property that makes it usable.
   */
  wifiRestriction: boolean;
  /**
   * The Wi-Fi network names that count as the office, as the router broadcasts
   * them. Empty means "not configured", and nothing is enforced.
   *
   * **This is a declared signal, not an observed one.** No browser exposes the
   * SSID, so the name is typed by the employee once per device and sent with
   * the punch; the comparison happens on the server. It is never shown back to
   * an employee — not in the punch control, not in a refusal message — because
   * a check whose expected answer is printed on the failure screen is not a
   * check at all.
   */
  officeWifiNames: string[];

  /** `HH:MM`, Karachi. A check-in at or before this is on time. */
  startTime: string;
  /** Minutes of grace after `startTime` before a check-in counts as late. */
  graceMinutes: number;
  /**
   * `HH:MM`, Karachi. No check-in by this time and the day is marked absent
   * (§4). Configurable, defaulting to noon.
   */
  absentCutoff: string;

  /** Late occurrences allowed per month before deductions start (§5). */
  allowedLates: number;
  /** How the deduction is worked out once the allowance is spent. */
  deductionMode: DeductionMode;
  /** Rupees when `AMOUNT`; percent of monthly salary when `PERCENT`. */
  deductionValue: number;

  /** Days granted per employee per year, by type (§6). */
  leaveAllowance: Record<LeaveType, number>;
}

/**
 * The starting policy.
 *
 * 09:00 with 15 minutes' grace, absent at noon, two lates free and a flat
 * deduction from the third — the owner's stated defaults. Every one of them is
 * editable in Attendance Settings; none is relied on anywhere else.
 */
export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  ipExemptUids: [],

  locationRestriction: false,
  officeLat: null,
  officeLng: null,
  officeRadiusMeters: 150,

  wifiRestriction: false,
  officeWifiNames: [],

  startTime: '09:00',
  graceMinutes: 15,
  absentCutoff: '12:00',

  allowedLates: 2,
  deductionMode: 'AMOUNT',
  deductionValue: 1000,

  leaveAllowance: { CASUAL: 1, MEDICAL: 1 },
};

export const LEAVE_TYPES: LeaveType[] = ['CASUAL', 'MEDICAL'];

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  CASUAL: 'Casual Leave',
  MEDICAL: 'Medical Leave',
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: 'Pending approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/* -------------------------------------------------------------------------- */
/* Clock                                                                       */
/* -------------------------------------------------------------------------- */

/** `HH:MM` → minutes since midnight, or null when it is not a time. */
export function parseClock(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/** Minutes since midnight → `HH:MM`, for storing a configured time. */
export function formatClockValue(minutes: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** `09:05` → `9:05 AM`, for reading back a configured time. */
export function formatClockLabel(value: string): string {
  const minutes = parseClock(value);
  if (minutes === null) return value;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours < 12 ? 'AM' : 'PM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${String(mins).padStart(2, '0')} ${suffix}`;
}

/**
 * Minutes since midnight in Karachi for an instant.
 *
 * Formatted through `Intl` rather than by adding an offset: Pakistan has used
 * daylight saving before and could again, and a hardcoded +5 would silently
 * mark a whole office late for the duration.
 */
export function karachiMinutesOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/* -------------------------------------------------------------------------- */
/* Lateness                                                                    */
/* -------------------------------------------------------------------------- */

export interface CheckInVerdict {
  late: boolean;
  /** How far past the grace period, in minutes. Zero when on time. */
  lateByMinutes: number;
  /** The moment after which a check-in is late, `HH:MM`. */
  lateAfter: string;
}

/**
 * Whether a check-in at this moment is late.
 *
 * Grace is part of the threshold rather than a separate forgiveness step: an
 * employee is told "late after 9:15", and that is one number to understand
 * rather than two to add up.
 */
export function classifyCheckIn(at: Date, policy: AttendancePolicy): CheckInVerdict {
  const start = parseClock(policy.startTime) ?? 0;
  const grace = Math.max(0, Math.floor(policy.graceMinutes || 0));
  const threshold = start + grace;
  const actual = karachiMinutesOfDay(at);

  return {
    late: actual > threshold,
    lateByMinutes: actual > threshold ? actual - threshold : 0,
    lateAfter: formatClockValue(threshold),
  };
}

/** Whether the absent cutoff has passed for a given moment (§4). */
export function pastAbsentCutoff(at: Date, policy: AttendancePolicy): boolean {
  const cutoff = parseClock(policy.absentCutoff);
  if (cutoff === null) return false;
  return karachiMinutesOfDay(at) >= cutoff;
}

/* -------------------------------------------------------------------------- */
/* Deductions                                                                  */
/* -------------------------------------------------------------------------- */

export interface DeductionOutcome {
  /** 1-based: the third late in the month is `occurrence: 3`. */
  occurrence: number;
  /** False for the occurrences inside the allowance. */
  deducted: boolean;
  amount: number;
  /** The rule as it stood, so a stored deduction explains itself later. */
  basis: string;
}

/**
 * What one late occurrence costs.
 *
 * §5's rule: the first `allowedLates` in a month are free, and every one after
 * that is charged at the configured rate. `monthlySalary` is only consulted for
 * a percentage rule — an amount rule does not need to know what anybody earns,
 * and asking for it would mean holding salaries this module has no other use
 * for.
 *
 * **The basis string is stored with the deduction on purpose.** §12 requires
 * that changing the policy later does not rewrite finalised periods, and the
 * clearest way to honour that is for every record to carry the rule it was
 * charged under, in words.
 */
export function lateDeduction(
  occurrence: number,
  policy: AttendancePolicy,
  monthlySalary = 0
): DeductionOutcome {
  const allowed = Math.max(0, Math.floor(policy.allowedLates ?? 0));
  const nth = Math.max(1, Math.floor(occurrence));

  if (nth <= allowed) {
    return {
      occurrence: nth,
      deducted: false,
      amount: 0,
      basis: `Within the ${allowed} late${allowed === 1 ? '' : 's'} allowed each month.`,
    };
  }

  const value = Math.max(0, Number(policy.deductionValue) || 0);

  if (policy.deductionMode === 'PERCENT') {
    const amount = Math.round((monthlySalary * value) / 100);
    return {
      occurrence: nth,
      deducted: true,
      amount,
      basis: `Late #${nth} of the month — ${value}% of monthly salary, over the ${allowed} allowed.`,
    };
  }

  return {
    occurrence: nth,
    deducted: true,
    amount: value,
    basis: `Late #${nth} of the month — flat ${value}, over the ${allowed} allowed.`,
  };
}

/** Every deduction a month of lates comes to, oldest first. */
export function monthDeductions(
  lateCount: number,
  policy: AttendancePolicy,
  monthlySalary = 0
): { outcomes: DeductionOutcome[]; total: number } {
  const outcomes = Array.from({ length: Math.max(0, Math.floor(lateCount)) }, (_, index) =>
    lateDeduction(index + 1, policy, monthlySalary)
  );

  return { outcomes, total: outcomes.reduce((sum, outcome) => sum + outcome.amount, 0) };
}

/* -------------------------------------------------------------------------- */
/* Leave                                                                       */
/* -------------------------------------------------------------------------- */

export interface LeaveBalance {
  type: LeaveType;
  allowed: number;
  used: number;
  remaining: number;
}

/**
 * What is left of each leave type.
 *
 * `used` counts **approved** days only. A pending request has not been granted
 * and must not eat a balance somebody may still be refused — but it is returned
 * separately so a screen can warn before an employee asks for a day they do not
 * have.
 */
export function leaveBalances(
  policy: AttendancePolicy,
  usedByType: Partial<Record<LeaveType, number>>,
  adjustments: Partial<Record<LeaveType, number>> = {}
): LeaveBalance[] {
  return LEAVE_TYPES.map((type) => {
    const allowed = Math.max(
      0,
      (policy.leaveAllowance?.[type] ?? 0) + (adjustments[type] ?? 0)
    );
    const used = Math.max(0, usedByType[type] ?? 0);
    return { type, allowed, used, remaining: Math.max(0, allowed - used) };
  });
}

/** Whole days between two `YYYY-MM-DD` dates, inclusive. */
export function leaveDayCount(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

/** Every `YYYY-MM-DD` a leave request covers, inclusive. */
export function leaveDayKeys(from: string, to: string): string[] {
  const count = leaveDayCount(from, to);
  const start = Date.parse(`${from}T00:00:00Z`);

  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10)
  );
}

/* -------------------------------------------------------------------------- */
/* Normalising what an admin typed                                             */
/* -------------------------------------------------------------------------- */

/**
 * Cleans a submitted policy, field by field.
 *
 * Runs on the server before the write, and on the client for instant feedback.
 * A bad value falls back to the current setting rather than to the default —
 * one mistyped field must not silently reset the other six.
 */
export function normalizePolicy(
  input: Partial<AttendancePolicy>,
  current: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY
): AttendancePolicy {
  const clockOr = (value: unknown, fallback: string) => {
    const text = typeof value === 'string' ? value.trim() : '';
    return parseClock(text) !== null ? text : fallback;
  };

  const intOr = (value: unknown, fallback: number, min: number, max: number) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };

  /** A coordinate is kept only as a pair — half an office is no office. */
  const rawLat = input.officeLat === undefined ? current.officeLat : input.officeLat;
  const rawLng = input.officeLng === undefined ? current.officeLng : input.officeLng;
  const bothReal =
    typeof rawLat === 'number' &&
    typeof rawLng === 'number' &&
    Number.isFinite(rawLat) &&
    Number.isFinite(rawLng) &&
    rawLat >= -90 &&
    rawLat <= 90 &&
    rawLng >= -180 &&
    rawLng <= 180 &&
    !(rawLat === 0 && rawLng === 0);

  const officeLat = bothReal ? (rawLat as number) : null;
  const officeLng = bothReal ? (rawLng as number) : null;
  const hasOffice = officeLat !== null && officeLng !== null;

  const officeWifiNames = Array.isArray(input.officeWifiNames)
    ? input.officeWifiNames
    : current.officeWifiNames;

  return {
    ipExemptUids: Array.isArray(input.ipExemptUids) ? input.ipExemptUids : current.ipExemptUids,

    /**
     * **Marking the office is the decision to enforce it**, the same rule the
     * Wi-Fi names follow — somebody who stands in their office and presses
     * "use my current location" means "only let people check in from here".
     * An explicit boolean always wins, and Settings always sends the field.
     *
     * A missing coordinate still enforces nothing: `classifyLocation` returns
     * UNKNOWN with no office configured, and the punch refuses nobody on an
     * UNKNOWN. Turning it on before marking the office would otherwise lock the
     * whole company out — the failure the address allow-list actually produced.
     */
    locationRestriction:
      typeof input.locationRestriction === 'boolean'
        ? input.locationRestriction
        : current.locationRestriction || hasOffice,
    officeLat,
    officeLng,
    // A radius of zero is nobody, and a radius of 20km is everybody; both are a
    // restriction that does not do what its screen says.
    officeRadiusMeters: intOr(input.officeRadiusMeters, current.officeRadiusMeters, 20, 20_000),

    /**
     * **Naming the office network is the decision to enforce it.**
     *
     * The stored document predates this field, and an installation that has
     * filled in the names and nothing else must not read as "recorded but not
     * policed" — that is the exact shape of the bug the address check had, where
     * office addresses sat in Settings looking as though they were doing
     * something. An **explicit** boolean always wins, so an admin who unticks
     * the box keeps that choice; Settings always sends the field. An empty list
     * still enforces nothing: there is nothing to enforce against, and refusing
     * everybody is worse than useless.
     */
    wifiRestriction:
      typeof input.wifiRestriction === 'boolean'
        ? input.wifiRestriction
        : current.wifiRestriction || officeWifiNames.length > 0,
    officeWifiNames,

    startTime: clockOr(input.startTime, current.startTime),
    graceMinutes: intOr(input.graceMinutes, current.graceMinutes, 0, 240),
    absentCutoff: clockOr(input.absentCutoff, current.absentCutoff),

    allowedLates: intOr(input.allowedLates, current.allowedLates, 0, 31),
    deductionMode:
      input.deductionMode === 'PERCENT' || input.deductionMode === 'AMOUNT'
        ? input.deductionMode
        : current.deductionMode,
    deductionValue: intOr(input.deductionValue, current.deductionValue, 0, 10_000_000),

    leaveAllowance: {
      CASUAL: intOr(input.leaveAllowance?.CASUAL, current.leaveAllowance.CASUAL, 0, 365),
      MEDICAL: intOr(input.leaveAllowance?.MEDICAL, current.leaveAllowance.MEDICAL, 0, 365),
    },
  };
}
