/**
 * A person's own Facebook leads, grouped the way the admin's Meta Ads screen
 * groups them: one card per campaign folder.
 *
 * **Why this exists instead of reading the folders.** The admin's screen is
 * built on `dataBankFolders`, which are managing-roles-only — readable by an
 * employee, they would hand every salesperson an exportable copy of every
 * number the business has bought. So an employee's cards are derived from the
 * one thing they may read, their own leads, using the folder id and name that
 * every lead from an ad already carries (`dataBankFolderId`,
 * `dataBankFolderName`). The card an employee sees and the folder an admin sees
 * are therefore the same folder, keyed the same way.
 *
 * **A lead belongs here if it came from an ad or sits in an ad's folder.** A
 * lead added by hand into a campaign folder (a personal lead) is in the admin's
 * Assigned list for that folder, so it is on the employee's card too — the two
 * screens must count the same leads.
 *
 * Dependency-free, so the unit tests run under raw `node --experimental-strip-types`.
 */

export interface MetaLeadLike {
  id: string;
  source?: string | null;
  status?: string | null;
  dataBankFolderId?: string | null;
  dataBankFolderName?: string | null;
  campaignName?: string | null;
}

/** The folder a lead with no ad folder is filed under — matches `resolveMetaSource`'s fallback. */
export const UNKNOWN_META_FOLDER = 'meta_unknown';

export type MetaBasis = 'CAMPAIGN' | 'FORM' | 'AD' | 'NONE';

export interface MetaLeadGroup {
  folderId: string;
  name: string;
  basis: MetaBasis;
  /** Offered and not yet answered — the number that needs acting on. */
  waiting: number;
  /** Everything else: accepted and being worked, or closed. */
  taken: number;
  total: number;
  /** Newest lead in the folder, in epoch ms, or null when none carries a date. */
  lastLeadAt: number | null;
}

const isMetaFolderId = (id: unknown): id is string => typeof id === 'string' && id.startsWith('meta_');

/** Whether a lead belongs on the Meta Leads screen. */
export function isMetaLead(lead: MetaLeadLike): boolean {
  return (lead.source ?? '').toUpperCase() === 'META_ADS' || isMetaFolderId(lead.dataBankFolderId);
}

/** The folder a Meta lead is grouped under. */
export function metaFolderOf(lead: MetaLeadLike): string {
  return isMetaFolderId(lead.dataBankFolderId) ? lead.dataBankFolderId : UNKNOWN_META_FOLDER;
}

/** What kind of Meta source a folder is, read off its id — `metaFolderId` writes the prefix. */
export function metaBasisOf(folderId: string): MetaBasis {
  if (folderId.startsWith('meta_campaign_')) return 'CAMPAIGN';
  if (folderId.startsWith('meta_form_')) return 'FORM';
  if (folderId.startsWith('meta_ad_')) return 'AD';
  return 'NONE';
}

/**
 * One group per folder, newest first — if three campaigns fired this morning,
 * the most recent is the one somebody opens the screen looking for.
 */
export function groupMetaLeads<T extends MetaLeadLike>(
  leads: T[],
  millisOf: (lead: T) => number | null
): MetaLeadGroup[] {
  const groups = new Map<string, MetaLeadGroup>();

  for (const lead of leads) {
    if (!isMetaLead(lead)) continue;
    const folderId = metaFolderOf(lead);
    const group =
      groups.get(folderId) ??
      {
        folderId,
        name: '',
        basis: metaBasisOf(folderId),
        waiting: 0,
        taken: 0,
        total: 0,
        lastLeadAt: null,
      };

    // The folder's own name first; a lead that predates it may still carry the campaign.
    if (!group.name) {
      group.name = (lead.dataBankFolderName ?? '').trim() || (lead.campaignName ?? '').trim();
    }
    if (lead.status === 'ASSIGNED') group.waiting += 1;
    else group.taken += 1;
    group.total += 1;

    const at = millisOf(lead);
    if (at !== null && (group.lastLeadAt === null || at > group.lastLeadAt)) group.lastLeadAt = at;

    groups.set(folderId, group);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, name: group.name || 'Meta Ads' }))
    .sort((a, b) => (b.lastLeadAt ?? 0) - (a.lastLeadAt ?? 0) || a.name.localeCompare(b.name));
}
