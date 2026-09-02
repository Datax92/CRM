/**
 * Where a lead actually came from, in words.
 *
 * `lead.source` is a machine token — `META_ADS`, `DATA_BANK`, `MANUAL` — and on
 * its own it answers the wrong question. Two leads both reading "Data Bank" can
 * come from two spreadsheets bought from two different societies, and the whole
 * point of keeping the Data Bank in folders is to know which. So the source
 * shown to a person is the token *plus* the specific origin it came from:
 *
 *   Data Bank (Facile Town 2)
 *   Meta Ads (Ramadan Offer)
 *   Manual Entry
 *
 * The origin is read from fields denormalised onto the lead at creation
 * (`dataBankFolderName`, `campaignName`), never by joining back to the folder —
 * a folder can be renamed or deleted, and a lead's recorded origin must not
 * change or vanish when that happens. This is history, not a live reference.
 *
 * Dependency-free so the unit tests can run it under raw
 * `node --experimental-strip-types`.
 */

export interface LeadSourceInput {
  source?: string | null;
  /** Denormalised at promotion — the folder the row was sitting in. */
  dataBankFolderName?: string | null;
  dataBankFolderId?: string | null;
  campaignName?: string | null;
  campaignId?: string | null;
  adName?: string | null;
}

/** The generic half: what kind of origin this is. */
export const LEAD_SOURCE_LABELS: Record<string, string> = {
  META_ADS: 'Meta Ads',
  FACEBOOK: 'Meta Ads',
  INSTAGRAM: 'Meta Ads',
  DATA_BANK: 'Data Bank',
  MANUAL: 'Manual Entry',
  MANUAL_ENTRY: 'Manual Entry',
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  WALK_IN: 'Walk-in',
};

/**
 * Turns a stored token into a readable label.
 *
 * An unknown token is title-cased rather than dropped: a source the app has
 * never heard of is still better shown than replaced with "Other", which would
 * quietly hide the fact that something is writing leads with a token nobody
 * added here.
 */
export function leadSourceKindLabel(source?: string | null): string {
  const token = (source ?? '').trim();
  if (!token) return 'Unknown';

  const known = LEAD_SOURCE_LABELS[token.toUpperCase()];
  if (known) return known;

  return token
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The specific origin inside that kind — the folder, the campaign — or null
 * when the source has no finer detail (a manual entry is just a manual entry).
 */
export function leadSourceDetail(lead: LeadSourceInput): string | null {
  const token = (lead.source ?? '').trim().toUpperCase();

  if (token === 'DATA_BANK') {
    const folder = (lead.dataBankFolderName ?? '').trim();
    // A promoted row whose folder name was never recorded still says *which*
    // it was, by id, rather than pretending the detail does not exist.
    return folder || (lead.dataBankFolderId ? `Folder ${lead.dataBankFolderId.slice(0, 6)}` : null);
  }

  const campaign = (lead.campaignName ?? '').trim();
  if (campaign) return campaign;

  const ad = (lead.adName ?? '').trim();
  return ad || null;
}

/**
 * The one string shown in the Source column and on the detail pane.
 *
 * `Data Bank (Facile Town 2)` — kind, then the exact origin in brackets.
 */
export function describeLeadSource(lead: LeadSourceInput): string {
  const kind = leadSourceKindLabel(lead.source);
  const detail = leadSourceDetail(lead);
  return detail ? `${kind} (${detail})` : kind;
}
