/**
 * What the admin's bell shows.
 *
 * **An allow-list, at the owner's instruction (2026-09-22): check-in, late
 * arrival, absent, deal closed, and a lead promoted to P2 or P1.** The panel
 * had become a log of everything the system does — red flags, cold reviews,
 * expense approvals, leave requests, stale-lead sweeps, every personal lead —
 * and a list that shows everything is a list nobody reads, which costs the
 * five alerts that do matter.
 *
 * **An allow-list, not a block-list**, deliberately: a new alert type added
 * next month appears in nobody's way until somebody decides it belongs here.
 * The opposite shape leaks by default, which is how the panel filled up.
 *
 * **What this is not.** It does not stop the alerts being written, and it
 * changes nothing for an employee or a manager — a red flag still reaches the
 * person it is about, a leave request still reaches whoever decides it, and
 * every row stays in `notifications` as the record it always was. This is the
 * admin's *reading* list.
 *
 * Dependency-free so the unit tests run it under raw
 * `node --experimental-strip-types`.
 */

/** A check-in that opened somebody's day on time. Late ones are their own type. */
export const ATTENDANCE_CHECK_IN = 'ATTENDANCE_CHECK_IN';

/** A lead that climbed into P2 or P1 — the two bands worth interrupting for. */
export const LEAD_PROMOTED = 'LEAD_PROMOTED';

export const ADMIN_ALERT_TYPES: string[] = [
  ATTENDANCE_CHECK_IN,
  'ATTENDANCE_LATE',
  'ATTENDANCE_ABSENT',
  // Written by `closeDeal`, and the one alert that is also an instruction:
  // the split is waiting on the admin.
  'DEAL_CLOSED_REVIEW',
  LEAD_PROMOTED,
];

/**
 * Whether the admin's panel shows this alert.
 *
 * Everybody else is unaffected — the predicate is asked only for `targetRole:
 * 'admin'` rows, so an employee's or a manager's list is whatever it always
 * was.
 */
export function isAdminAlert(type: unknown): boolean {
  return typeof type === 'string' && ADMIN_ALERT_TYPES.includes(type);
}
