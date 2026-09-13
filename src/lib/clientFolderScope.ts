/**
 * **The Client section is personal.** The admin's Clients are the admin's; each
 * manager's are that manager's. Nobody sees anybody else's, the admin included.
 *
 * This was not so. An admin's folder query was unscoped — the rule lets an admin
 * read every Client folder — so an HR manager who took Data Bank leads for
 * themselves had their folders land in the admin's Clients too. Measured
 * 2026-09-13: "Faisal Town 2 September 2026" listed three times on the admin's
 * screen (the admin's, Dilawar's and Tayyab's), which read as duplicates.
 *
 * And a folder shows **only the leads currently assigned to its owner**. A Client
 * folder holds the leads somebody took for themselves; a lead reassigned to an
 * employee afterwards is that employee's work, not the owner's client. The
 * membership row is left where it is — reassigning the lead back puts it back
 * — so nothing has to be cleaned up and nothing is lost. Measured the same day:
 * the admin's "Faisal town 2 Gulf" folder counted 43 leads of which 4 were the
 * admin's.
 *
 * Derived on read, so every existing folder is corrected the moment this ships.
 * Imports nothing, so it runs under the raw `--experimental-strip-types` loader.
 */

export interface ClientFolderOwnerFields {
  subAdminUid?: string | null;
  ownerUid?: string | null;
}

/**
 * Whether a Client folder belongs to this viewer.
 *
 * A manager's folders carry `subAdminUid`; the admin's carry none. `ownerUid`
 * is newer and absent on folders made by hand before it existed, so it narrows
 * only when present.
 */
export function isOwnClientFolder(
  folder: ClientFolderOwnerFields,
  viewer: { role?: string | null; uid?: string | null }
): boolean {
  const uid = viewer.uid ?? '';
  if (!uid) return false;
  if (viewer.role === 'subadmin') return folder.subAdminUid === uid;
  if (viewer.role === 'admin') {
    if (folder.subAdminUid) return false;
    return !folder.ownerUid || folder.ownerUid === uid;
  }
  return false;
}

/**
 * The lead ids a folder shows: its members that are assigned to its owner.
 *
 * `assigneeOf` answers from the live leads list. A member whose lead is not in
 * that list (deleted, or outside what this viewer may read) is left out rather
 * than shown as a row with nothing behind it.
 */
export function ownClientLeadIds(
  memberLeadIds: readonly string[],
  ownerUid: string,
  assigneeOf: (leadId: string) => string | null | undefined
): Set<string> {
  const ids = new Set<string>();
  for (const leadId of memberLeadIds) {
    if (assigneeOf(leadId) === ownerUid) ids.add(leadId);
  }
  return ids;
}

/**
 * How many leads each folder shows, by folder id — the same rule as
 * `ownClientLeadIds`, counted across every folder at once for the folder list.
 */
export function countOwnClientLeads(
  members: ReadonlyArray<{ folderId: string; leadId: string }>,
  ownerUid: string,
  assigneeOf: (leadId: string) => string | null | undefined
): Map<string, number> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const member of members) {
    // A membership id is `folderId__leadId`, so a repeat can only be a stale
    // snapshot row; count each pair once regardless.
    const pair = `${member.folderId}__${member.leadId}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    if (assigneeOf(member.leadId) !== ownerUid) continue;
    counts.set(member.folderId, (counts.get(member.folderId) ?? 0) + 1);
  }
  return counts;
}
