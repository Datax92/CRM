/**
 * The **Assigned** half of a Data Bank folder, and the source filter the leads
 * screens share.
 *
 * A folder's unassigned rows are its records. Its assigned rows are not records
 * any more — a promoted row becomes a lead and its tombstone is deleted, and a
 * row handed to a manager moves into that manager's mirror. So "what did this
 * folder hand out, and to whom" is **derived on read** from the two places the
 * rows went:
 *
 * | went to | read from |
 * |---|---|
 * | a lead (employee, manager, admin, or a personal lead) | `leads` whose `dataBankFolderId` is this folder or one of its managers' mirrors |
 * | a manager's Data Bank, not worked yet | `dataBankRecords` in that manager's mirror |
 *
 * Nothing is stored for it, so every lead that already exists classifies the
 * moment this ships, with nothing to backfill and nothing to go stale.
 *
 * **Mirror ids are deterministic** (`mgr_{managerUid}_{sourceFolderId}`), which
 * is what makes the lead half complete: a mirror that emptied and was cleaned up
 * no longer exists as a folder, but the leads promoted out of it still carry its
 * id, and that id can be rebuilt from the roster.
 *
 * Imports nothing, so it runs under the raw `--experimental-strip-types` loader.
 */

/** The id of a manager's mirror of a source folder. Must match `managerFolderRefFor`. */
export function managerMirrorId(managerUid: string, sourceFolderId: string): string {
  return `mgr_${managerUid}_${sourceFolderId}`;
}

/** True when a folder id names a manager's mirror rather than an original. */
export function isMirrorId(folderId: string): boolean {
  return folderId.startsWith('mgr_');
}

/**
 * Every folder id whose leads count as this folder's.
 *
 * An original folder owns its own id plus one possible mirror per manager. A
 * mirror owns only itself — rows are always handed over out of the *origin*, so
 * a mirror never has mirrors of its own (`assignRecordsToManager`).
 */
export function folderScopeIds(folderId: string, managerUids: readonly string[]): string[] {
  if (isMirrorId(folderId)) return [folderId];
  const ids = [folderId];
  for (const uid of managerUids) {
    if (!uid) continue;
    const id = managerMirrorId(uid, folderId);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Whether a lead's recorded folder is this folder or one of its managers'
 * mirrors — the in-memory form of `folderScopeIds`, needing no roster.
 *
 * Safe on the id's shape alone: Firestore auto-ids and Firebase Auth uids are
 * both alphanumeric, so `_${folderId}` at the end of `mgr_{uid}_{folderId}` can
 * only mean this folder.
 */
export function leadBelongsToFolder(leadFolderId: string | null | undefined, folderId: string): boolean {
  if (!leadFolderId || !folderId) return false;
  if (leadFolderId === folderId) return true;
  if (isMirrorId(folderId)) return false;
  return isMirrorId(leadFolderId) && leadFolderId.endsWith(`_${folderId}`);
}

/** The manager a mirror id belongs to, or null when it is not a mirror of `folderId`. */
export function mirrorOwner(mirrorId: string, folderId: string): string | null {
  const suffix = `_${folderId}`;
  if (!isMirrorId(mirrorId) || !mirrorId.endsWith(suffix)) return null;
  const uid = mirrorId.slice('mgr_'.length, mirrorId.length - suffix.length);
  return uid || null;
}

/** One assigned row, whichever of the two places it went. */
export interface AssignedItem {
  id: string;
  /** `LEAD` is a lead in somebody's pipeline; `HANDOFF` is a row sitting in a manager's Data Bank. */
  kind: 'LEAD' | 'HANDOFF';
  name: string;
  phone: string;
  assigneeUid: string | null;
  assigneeName: string;
  /** Milliseconds, for ordering newest first. 0 when unknown. */
  at: number;
}

export interface AssigneeCount {
  uid: string;
  name: string;
  count: number;
}

/** Stands in for a lead that somehow has no assignee, so it is still counted somewhere. */
export const NO_ASSIGNEE = '__none';

/**
 * Who holds this folder's assigned rows, and how many each.
 *
 * Most first, then by name, so the person with the bulk of a list is at the top
 * of the picker — that is who somebody opening it is usually looking for.
 */
export function groupByAssignee(items: readonly AssignedItem[]): AssigneeCount[] {
  const byUid = new Map<string, AssigneeCount>();
  for (const item of items) {
    const uid = item.assigneeUid || NO_ASSIGNEE;
    const entry = byUid.get(uid);
    if (entry) entry.count += 1;
    else byUid.set(uid, { uid, name: item.assigneeName || 'Unassigned', count: 1 });
  }
  return [...byUid.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** The items held by one person, or all of them when `uid` is null. */
export function filterByAssignee(items: readonly AssignedItem[], uid: string | null): AssignedItem[] {
  if (!uid) return [...items];
  return items.filter((item) => (item.assigneeUid || NO_ASSIGNEE) === uid);
}

/**
 * Search inside the assigned list.
 *
 * The assigned rows are already in memory (a folder hands out hundreds, not
 * tens of thousands), so this can match anywhere in the name, unlike the
 * unassigned list's Firestore prefix search. A phone-looking query compares
 * digits only, so `0300 1234567` finds `+92 300 1234567`.
 */
export function matchesAssignedSearch(item: AssignedItem, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 7) {
    const tail = (value: string) => value.replace(/\D/g, '').replace(/^92/, '').replace(/^0+/, '').slice(-10);
    return tail(item.phone) !== '' && tail(item.phone) === tail(digits);
  }
  return item.name.toLowerCase().includes(q) || item.assigneeName.toLowerCase().includes(q);
}

/**
 * Newest first. Stable on id so two rows written in the same second do not
 * swap places on every snapshot.
 */
export function sortAssigned(items: readonly AssignedItem[]): AssignedItem[] {
  return [...items].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

/* -------------------------------------------------------------------------- */
/* Source filter                                                               */
/* -------------------------------------------------------------------------- */

export interface SourceOption {
  /** The exact string the rows display, so the filter and the row can never disagree. */
  key: string;
  count: number;
}

/**
 * The sources present in a list of leads, with counts.
 *
 * Keyed on the **displayed** source (`Data Bank (GFS)`, `Meta Ads (Ramadan
 * Offer)`), which the caller computes with `describeLeadSource`. Keying on the
 * folder id instead would split one sheet into several options — a lead
 * promoted out of a manager's mirror carries the mirror's id but the source's
 * name — and the reader thinks in the name they see on the row.
 *
 * Data Bank sources first, then everything else, each alphabetically: the
 * question being asked of this control is almost always "which sheet".
 */
export function sourceOptions<T>(rows: readonly T[], describe: (row: T) => string): SourceOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = describe(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const bank = (key: string) => (key.startsWith('Data Bank') ? 0 : 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => bank(a.key) - bank(b.key) || a.key.localeCompare(b.key));
}

/** Rows whose displayed source is `source`, or every row when it is null. */
export function filterBySource<T>(rows: readonly T[], source: string | null, describe: (row: T) => string): T[] {
  if (!source) return [...rows];
  return rows.filter((row) => describe(row) === source);
}
