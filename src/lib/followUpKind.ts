/**
 * What to call an entry in a lead's contact history.
 *
 * The first one is a **Remark** — the rep's opening note on a lead they have
 * just picked up, which is not a follow-up because there is nothing yet to
 * follow up on. Everything after it is a **Follow-Up**.
 *
 * ```
 *   Remark → Follow-Up → Follow-Up → Follow-Up
 * ```
 *
 * **Derived from position, not stored on the document.** Two reasons, and the
 * second is the one that decides it:
 *
 * 1. Every lead that already exists gets the right labels the moment this
 *    ships. A stored `kind` would need a backfill, and a backfill that has not
 *    run yet shows the wrong word.
 * 2. The fact it encodes — "this was the first" — is already in the data, in
 *    the ordering. Storing it a second time is a chance for the two to
 *    disagree, and there is no reconciliation that could tell you which was
 *    right.
 *
 * The rename is presentational. Nothing downstream changes: a Remark still
 * increments `followUpCount`, still counts toward the ten that turn a lead
 * Cold, and still counts as a Connect if the call was long enough. It is the
 * same act of contact — this is what the sales team call it.
 *
 * Dependency-free so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

export type FollowUpKind = 'REMARK' | 'FOLLOW_UP';

export const FOLLOW_UP_KIND_LABELS: Record<FollowUpKind, string> = {
  REMARK: 'Remark',
  FOLLOW_UP: 'Follow-Up',
};

/** The word for the *next* entry on a lead that already has `count` of them. */
export function nextEntryKind(count: number): FollowUpKind {
  return (count ?? 0) <= 0 ? 'REMARK' : 'FOLLOW_UP';
}

export function nextEntryLabel(count: number): string {
  return FOLLOW_UP_KIND_LABELS[nextEntryKind(count)];
}

/**
 * The word for one entry in a list.
 *
 * @param index    Its position in the array as rendered.
 * @param total    How many entries the array holds.
 * @param newestFirst The app sorts history newest-first everywhere, so the
 *   **last** element is the first thing that happened. Passing `false` treats
 *   index 0 as the oldest instead.
 */
export function entryKindAt(index: number, total: number, newestFirst = true): FollowUpKind {
  const oldest = newestFirst ? total - 1 : 0;
  return index === oldest ? 'REMARK' : 'FOLLOW_UP';
}

export function entryLabelAt(index: number, total: number, newestFirst = true): string {
  return FOLLOW_UP_KIND_LABELS[entryKindAt(index, total, newestFirst)];
}

/**
 * The heading for the history tab.
 *
 * A lead with one entry reads "Remark", not "Follow-ups (1)", because that one
 * entry is not a follow-up and calling it one is the mistake this rename
 * exists to fix.
 */
export function historyTabLabel(total: number): string {
  if (total === 0) return 'Remarks';
  if (total === 1) return 'Remark';
  return `Remark + Follow-Ups`;
}

/**
 * What a lead's contact log allows right now.
 *
 * The rule (§1) is a shape, not a count: **day one takes a Remark and a
 * Follow-Up; every later day takes one Follow-Up.** A Remark is the opening
 * note on a lead nobody has spoken to yet, so there is exactly one of them
 * ever, and it can only be written on the day the log starts.
 *
 * Derived from what is already stored — the number of entries and today's
 * entries — rather than from a counter that could drift.
 */
export interface EntryAllowance {
  kind: "REMARK" | "FOLLOW_UP";
  allowed: boolean;
  reason: string | null;
}

export function entryAllowance(totalEntries: number, entriesToday: number, hasRemark: boolean): EntryAllowance {
  // Nothing logged yet: this is the Remark.
  if (totalEntries === 0) {
    return { kind: "REMARK", allowed: true, reason: null };
  }

  // Day one, remark written, follow-up not yet: the second half of §1.
  if (hasRemark && totalEntries === 1 && entriesToday === 1) {
    return { kind: "FOLLOW_UP", allowed: true, reason: null };
  }

  if (entriesToday > 0) {
    return {
      kind: "FOLLOW_UP",
      allowed: false,
      reason: "This lead already has today's entry. Add the next follow-up tomorrow.",
    };
  }

  return { kind: "FOLLOW_UP", allowed: true, reason: null };
}

/**
 * The history in the order it happened: Remark first, then each Follow-Up.
 *
 * Everything upstream — the query, `latestFollowUpId`, the edit-the-newest
 * rule — works newest-first, and changing that would touch a dozen call sites
 * for a presentational reason. So the reversal happens **here, at the point of
 * display**, and the array the rest of the app reasons about is untouched.
 *
 * A plain reverse rather than a re-sort: the source is `orderBy('occurredAt',
 * 'desc')`, so it is already ordered and re-sorting would only add a way for
 * this to disagree with the query.
 *
 * Callers must pass `newestFirst: false` to `entryLabelAt` for the reversed
 * array, or the Remark badge lands on the newest entry instead of the oldest.
 */
export function toChronological<T>(entries: T[]): T[] {
  return [...entries].reverse();
}
