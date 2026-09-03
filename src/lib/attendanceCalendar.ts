/**
 * Calendar arithmetic for the attendance module.
 *
 * Pure and dependency-free, so it can be unit tested by the raw
 * `--experimental-strip-types` loader and so the three screens that need a
 * month's bounds cannot each get December wrong in their own way. Every
 * function works on the `YYYY-MM` / `YYYY-MM-DD` strings the records are keyed
 * by, computed in **UTC**: a calendar date's weekday and month length are
 * properties of the date itself, so no timezone conversion is involved — and
 * converting would introduce exactly the off-by-one this avoids.
 */

/** `2026-09` → `September 2026`, for a heading a person reads rather than parses. */
export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The month `by` months away, without tripping over the year boundary. */
export function shiftMonth(monthKey: string, by: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** How many days the month holds — 28, 29, 30 or 31. */
export function daysInMonth(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The weekday the 1st falls on, 0 = Sunday — the calendar's leading blanks. */
export function leadingBlanks(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

/** The first and last `dayKey` of a month, for a range query. */
export function monthRange(monthKey: string): { from: string; to: string } {
  return {
    from: `${monthKey}-01`,
    to: `${monthKey}-${String(daysInMonth(monthKey)).padStart(2, '0')}`,
  };
}

/** `2026-09-14` → `14`. */
export function dayNumber(dayKey: string): number {
  return Number(dayKey.slice(-2));
}

/** Every `dayKey` in a month, in order. */
export function monthDayKeys(monthKey: string): string[] {
  return Array.from(
    { length: daysInMonth(monthKey) },
    (_, index) => `${monthKey}-${String(index + 1).padStart(2, '0')}`
  );
}
