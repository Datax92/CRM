/**
 * One small document per person per day holding what Reports counts —
 * `activityDays/{uid}_{dayKey}` — kept current in the same transaction as the
 * entry it counts (owner, 2026-09-23, the day the free read quota ran out).
 *
 * **Why:** Reports' activity columns were folded from the entries themselves,
 * so "All employees · This month" read every entry the team had written since
 * the 1st — ~3,000 reads an open by the 23rd, growing every day of the month.
 * Five people over a month is ~150 of these documents instead.
 *
 * **The same classification as the entries, not a second one.** `entryTally`
 * is what Reports and the dossier fold, and `activityDelta` is built on it, so
 * a day's document is exactly the sum of that day's entries' tallies. Meetings
 * held and site visits ride alongside — Reports' own columns.
 *
 * **Credited like the entry.** The document is the credited person's —
 * `creditUid` on the entry, which `addFollowUp` sets to the lead's assignee —
 * on the entry's own `dayKey`, so a back-dated remark lands on the day it
 * describes, as it does in Reports today.
 *
 * **From a date, not from the beginning.** Documents exist only for entries
 * written since this shipped, so Reports reads them for days on or after
 * `config/activityTotals.from` (default `ACTIVITY_TOTALS_FROM`) and the entries
 * for anything earlier. `npm run backfill:activity-days` fills the earlier days
 * from the entries and moves the date back; nothing has to be trusted before
 * it is filled.
 *
 * Dependency-free so the raw `--experimental-strip-types` test loader runs it.
 */

export const ACTIVITY_DAYS = "activityDays";

/** The first day counted into `activityDays` without a backfill. */
export const ACTIVITY_TOTALS_FROM = "2026-09-24";

export const ACTIVITY_FIELDS = [
  "remarks",
  "followUps",
  "newConnects",
  "followUpConnects",
  "meetingsAligned",
  "meetings",
  "siteVisits",
] as const;

export type ActivityField = (typeof ACTIVITY_FIELDS)[number];
export type ActivityCounts = Record<ActivityField, number>;

/** What an entry contributes, read off the same flags the entry stores. */
export interface EntryFacts {
  kind?: string | null;
  connect?: boolean | null;
  meetingAligned?: boolean | null;
  meetingHeld?: boolean | null;
  siteVisit?: boolean | null;
}

export function activityDayId(uid: string, dayKey: string): string {
  return `${uid}_${dayKey}`;
}

export function emptyCounts(): ActivityCounts {
  return { remarks: 0, followUps: 0, newConnects: 0, followUpConnects: 0, meetingsAligned: 0, meetings: 0, siteVisits: 0 };
}

/**
 * One entry's counts — `entryTally`'s rule, restated here only because this
 * module must import nothing. A test holds the two together.
 */
export function countsOf(entry: EntryFacts): ActivityCounts {
  const remark = entry.kind === "REMARK";
  const connected = entry.connect === true;
  return {
    remarks: remark ? 1 : 0,
    followUps: remark ? 0 : 1,
    newConnects: remark && connected ? 1 : 0,
    followUpConnects: !remark && connected ? 1 : 0,
    meetingsAligned: entry.meetingAligned === true ? 1 : 0,
    meetings: entry.meetingHeld === true ? 1 : 0,
    siteVisits: entry.siteVisit === true ? 1 : 0,
  };
}

/**
 * What a day's document must move by when an entry goes from `before` to
 * `after`: a new entry is `before = null`; an edit is both. Only non-zero
 * fields are returned, so an edit that changes nothing counted writes nothing.
 */
export function activityDelta(before: EntryFacts | null, after: EntryFacts): Partial<ActivityCounts> {
  const next = countsOf(after);
  const prev = before ? countsOf(before) : emptyCounts();
  const delta: Partial<ActivityCounts> = {};
  for (const field of ACTIVITY_FIELDS) {
    const change = next[field] - prev[field];
    if (change !== 0) delta[field] = change;
  }
  return delta;
}

/** A stored day document's counts; missing or junk fields read as 0. */
export function readCounts(raw: Record<string, unknown> | null | undefined): ActivityCounts {
  const counts = emptyCounts();
  for (const field of ACTIVITY_FIELDS) {
    const value = Number(raw?.[field] ?? 0);
    counts[field] = Number.isFinite(value) ? value : 0;
  }
  return counts;
}

/** The day before a `YYYY-MM-DD` key, by calendar, in UTC so no zone can shift it. */
export function previousDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  return date.toISOString().slice(0, 10);
}

/**
 * How a report range splits between the two sources: entries for the days
 * before `totalsFrom`, day documents for the rest. Either half may be absent.
 */
export function splitRange(
  from: string,
  to: string,
  totalsFrom: string
): { entries: { from: string; to: string } | null; totals: { from: string; to: string } | null } {
  if (to < totalsFrom) return { entries: { from, to }, totals: null };
  if (from >= totalsFrom) return { entries: null, totals: { from, to } };
  return { entries: { from, to: previousDayKey(totalsFrom) }, totals: { from: totalsFrom, to } };
}
