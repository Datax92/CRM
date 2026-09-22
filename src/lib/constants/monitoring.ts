/**
 * How long a lead may sit without contact before its owner is reminded.
 *
 * **Seven days, and it is a reminder to the person holding the lead** (owner,
 * 2026-09-22). It replaced a 24-hour sweep that flagged the same leads to the
 * *admin*, which answered a different question — "which leads are going quiet"
 * is a management report, and by the time it reaches an inbox nobody is going
 * to ring anybody. The person who can act on it is the one whose lead it is.
 *
 * Mirrored by `api/cron/process-deadlines` (FR-18) and settable in Settings.
 */
export const DEFAULT_NO_CONTACT_DAYS = 7;

/** The widest the reminder window may be set to — a quarter, and no more. */
export const MAX_NO_CONTACT_DAYS = 90;
