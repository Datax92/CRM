/**
 * Which day — or which range — an employee's dossier is showing.
 *
 * **The one place the selected date becomes a query.** Four surfaces read it
 * (the desktop dossier, the phone dossier, the entry query behind both, and the
 * lead/deal/activity lists inside them) and they must agree to the millisecond,
 * or the four figures at the top of the screen describe a different day from
 * the list underneath them.
 *
 * Two shapes come out of one selection, because the data is stored two ways:
 *
 * | consumer | wants | function |
 * |---|---|---|
 * | lead / deal / activity lists | a `Date` interval | `resolveDossierRange` |
 * | the follow-up entry query | two `YYYY-MM-DD` keys | `dossierRangeKeys` |
 *
 * Both are anchored to **Asia/Karachi**, which is where the business is. The
 * app runs on Vercel in UTC and Firestore stores UTC instants, so a day
 * computed without an explicit zone starts at 05:00 local and splits the
 * working day in two — the "Today is showing yesterday's records" class of bug.
 *
 * Lifted out of `components/employees/directoryChrome.tsx` because it is pure
 * date arithmetic with no chrome in it, and because a `.tsx` file cannot be
 * loaded by this project's raw `--experimental-strip-types` test runner — so
 * while it lived there, none of it could be tested.
 */

// Explicit `.ts` extensions: this module is unit-tested under the raw
// `node --experimental-strip-types` loader, which cannot resolve an
// extensionless relative import. Same reason `leadBuckets` writes them.
import {
  karachiDayKey,
  karachiDayRange,
  resolveRange,
  type DateRange,
  type RangeKey,
} from './dates.ts';
import type { LeadFilterKey } from './leadBuckets.ts';

/**
 * The dossier's own period keys.
 *
 * `DAY` is not a `RangeKey`, deliberately. `RANGE_LABELS` is an exhaustive
 * `Record<RangeKey, string>` and five unrelated screens build a period dropdown
 * by iterating its keys, so adding a fifth member there would put "a day" in
 * the Deals ledger, Campaigns, Committee and two more — none of which has a
 * date to go with it.
 */
export type DossierPeriod = RangeKey | 'DAY';

export interface DossierFilters {
  period: DossierPeriod;
  /**
   * The chosen day, `YYYY-MM-DD` in Karachi. Only read when `period` is `DAY`,
   * and kept when the period moves off it so switching to This month and back
   * does not lose the date somebody picked.
   */
  day?: string | null;
  cut: LeadFilterKey;
  /**
   * One origin — `Data Bank (GFS)` — as the exact string `describeLeadSource`
   * prints, or null/absent for every source. Applied to leads only; a deal and
   * an activity entry are not narrowed by it.
   */
  source?: string | null;
}

/** A well-formed Karachi day key, and nothing else. */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The chosen day, or today when nothing usable was chosen. */
export function dossierDay(filters: Pick<DossierFilters, 'day'>): string {
  return filters.day && DAY_KEY.test(filters.day) ? filters.day : karachiDayKey();
}

/**
 * The filters a dossier opens on: **today**, all leads.
 *
 * **A function, not a constant.** A module-level `karachiDayKey()` is evaluated
 * once, when the bundle is first imported — so a tab left open overnight, or a
 * session that started yesterday, opens every dossier on *yesterday* while the
 * control still says "Today". That is exactly the "Today sometimes shows the
 * previous day" symptom, and it is invisible in testing because a fresh reload
 * always looks right.
 *
 * Called from the `useState` initialiser, so the day is read when the dossier
 * is opened. Each dossier also gets its own object rather than sharing one.
 */
export function defaultDossierFilters(): DossierFilters {
  return { period: 'DAY', cut: 'ALL', day: karachiDayKey() };
}

/**
 * The period as an instant interval, for the lists that hold real timestamps.
 *
 * For a picked day this is `[midnight, next midnight)` in Karachi — the start
 * of the selected day to the start of the following one, with the upper bound
 * **exclusive**, so no instant belongs to two days and none falls between them.
 */
export function resolveDossierRange(filters: DossierFilters): DateRange {
  return filters.period === 'DAY'
    ? karachiDayRange(dossierDay(filters))
    : resolveRange(filters.period);
}

/**
 * The period as the two `YYYY-MM-DD` keys the follow-up query takes.
 *
 * Entries carry a `dayKey` stamped in Karachi, and `loadEntries` matches
 * `dayKey >= from && dayKey <= to`. For a picked day both ends are that same
 * key, so **exactly one day's entries come back from the database** — the
 * filtering is in the query, not in the browser.
 *
 * `ALL` needs a lower bound because a query needs one; it starts before this
 * company existed rather than at the epoch. The point is only that it is early
 * enough to include everything and still parse as a date.
 */
export function dossierRangeKeys(filters: DossierFilters): { from: string; to: string } {
  const today = karachiDayKey();
  if (filters.period === 'DAY') {
    const day = dossierDay(filters);
    return { from: day, to: day };
  }
  const range = resolveRange(filters.period);
  return { from: range.from ? karachiDayKey(range.from) : '2000-01-01', to: today };
}
