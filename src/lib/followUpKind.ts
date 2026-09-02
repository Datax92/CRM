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
