/**
 * Meta lead intake — turning a Facebook lead into a Data Bank row.
 *
 * **Every Meta lead lands in the Data Bank, not straight in the pipeline**, and
 * leads from the same ad land in the same folder. That is the owner's
 * instruction and it is also what makes the system autonomous: a new campaign
 * the client launches next month creates its own folder the first time a lead
 * arrives, with nobody configuring anything.
 *
 * **Two doors, one destination.** Meta's own webhook is the eventual route, but
 * an unpublished app receives no production leads and App Review takes up to
 * twenty days — so an approved intermediary (Make.com / Zapier) posts the same
 * leads through a second, separately-secured endpoint in the meantime. Both
 * doors call the functions in this module, so a lead is filed identically
 * whichever way it arrived and switching the bridge off changes nothing.
 *
 * **What names a folder is the *source*, and source has a fallback chain.**
 * Meta gives a campaign name only to a caller with `ads_read`; the form name
 * is available to everyone. So the chain is campaign → form → ad → a single
 * "Meta Ads" folder, and a lead is never dropped for want of a label.
 *
 * Dependency-free so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

/** The generated field keys a Meta folder always has. Records key on these. */
export const META_FIELD_KEYS = {
  name: 'meta_name',
  phone: 'meta_phone',
  email: 'meta_email',
  city: 'meta_city',
  campaign: 'meta_campaign',
  adName: 'meta_ad',
  formName: 'meta_form',
  submittedAt: 'meta_submitted',
} as const;

/**
 * The columns every auto-created Meta folder carries.
 *
 * Fixed rather than derived from the first lead that happens to arrive: a
 * folder whose columns depend on which lead came first would give two folders
 * different shapes for the same kind of data, and records are stored against
 * field *keys* — so a later lead with an extra answer would render blank.
 * Anything the form asks beyond these is carried in `values` under its own
 * generated key and shown as an extra column.
 */
export const META_FOLDER_FIELDS: Array<{ key: string; label: string; mapsTo?: string | null }> = [
  { key: META_FIELD_KEYS.name, label: 'Full Name' },
  { key: META_FIELD_KEYS.phone, label: 'Phone Number' },
  { key: META_FIELD_KEYS.email, label: 'Email', mapsTo: 'kyc:email' },
  { key: META_FIELD_KEYS.city, label: 'City', mapsTo: 'lead:city' },
  { key: META_FIELD_KEYS.campaign, label: 'Campaign' },
  { key: META_FIELD_KEYS.adName, label: 'Ad' },
  { key: META_FIELD_KEYS.formName, label: 'Form' },
  { key: META_FIELD_KEYS.submittedAt, label: 'Submitted' },
];

export const META_FOLDER_ROLES = {
  name: META_FIELD_KEYS.name,
  phone: META_FIELD_KEYS.phone,
} as const;

/** What a lead carries once both doors have normalised it. */
export interface MetaLeadInput {
  /** Meta's own id for the submission. The dedupe key — never invent one. */
  leadgenId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  /** Any other answers the form asked, keyed by the question's own name. */
  extras?: Record<string, string> | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adId?: string | null;
  adName?: string | null;
  adsetName?: string | null;
  formId?: string | null;
  formName?: string | null;
  pageId?: string | null;
  submittedAt?: string | null;
}

/** Which ad a folder represents, and what to call it. */
export interface MetaSource {
  /**
   * Stable id for the folder. Derived from the *ids* Meta sends, never from a
   * name — renaming a campaign in Ads Manager must not start a second folder
   * and split one ad's leads across two places.
   */
  key: string;
  /** What the folder is called. A rename in Ads Manager updates this. */
  label: string;
  /** Which field the label came from, so the screen can say so. */
  basis: 'CAMPAIGN' | 'FORM' | 'AD' | 'NONE';
  campaignId: string | null;
  formId: string | null;
  adId: string | null;
}

const clean = (value: unknown): string => String(value ?? '').trim();

/**
 * Where this lead belongs.
 *
 * **Identity comes from an id, the name only from a name.** A campaign renamed
 * from "FT2" to "Faisal Town 2 – September" is the same campaign, and its leads
 * must keep arriving in the same folder; keying on the label would fork them.
 * Equally, a folder with a stale label is useless to a person, so the label is
 * refreshed from every lead while the key stays put.
 */
export function resolveMetaSource(lead: MetaLeadInput): MetaSource {
  const campaignId = clean(lead.campaignId) || null;
  const formId = clean(lead.formId) || null;
  const adId = clean(lead.adId) || null;

  const campaignName = clean(lead.campaignName);
  const formName = clean(lead.formName);
  const adName = clean(lead.adName);

  if (campaignId || campaignName) {
    return {
      key: `campaign_${campaignId ?? slug(campaignName)}`,
      label: campaignName || formName || adName || `Campaign ${campaignId}`,
      basis: 'CAMPAIGN',
      campaignId, formId, adId,
    };
  }

  if (formId || formName) {
    return {
      key: `form_${formId ?? slug(formName)}`,
      label: formName || `Form ${formId}`,
      basis: 'FORM',
      campaignId, formId, adId,
    };
  }

  if (adId || adName) {
    return {
      key: `ad_${adId ?? slug(adName)}`,
      label: adName || `Ad ${adId}`,
      basis: 'AD',
      campaignId, formId, adId,
    };
  }

  /*
    Nothing identified the ad at all. One shared folder rather than refusing the
    lead: a contact with a phone number is worth having even when its
    provenance is missing, and a folder called "Meta Ads" is honest about what
    is known.
  */
  return { key: 'meta_unknown', label: 'Meta Ads', basis: 'NONE', campaignId, formId, adId };
}

/** Firestore document ids: safe characters only, and never empty. */
export function metaFolderId(source: MetaSource): string {
  return `meta_${slug(source.key)}`.slice(0, 120);
}

function slug(value: string): string {
  const out = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return out || 'x';
}

/**
 * The row that goes into the folder.
 *
 * Extra answers are carried under a key derived from the question, so a form
 * asking "Which project?" produces a column of that name rather than being
 * thrown away — but they never collide with the eight fixed keys.
 */
export function buildMetaRecord(lead: MetaLeadInput): {
  values: Record<string, string>;
  extraFields: Array<{ key: string; label: string }>;
} {
  const values: Record<string, string> = {
    [META_FIELD_KEYS.name]: clean(lead.name),
    [META_FIELD_KEYS.phone]: clean(lead.phone),
    [META_FIELD_KEYS.email]: clean(lead.email),
    [META_FIELD_KEYS.city]: clean(lead.city),
    [META_FIELD_KEYS.campaign]: clean(lead.campaignName),
    [META_FIELD_KEYS.adName]: clean(lead.adName),
    [META_FIELD_KEYS.formName]: clean(lead.formName),
    [META_FIELD_KEYS.submittedAt]: clean(lead.submittedAt),
  };

  const fixed = new Set(Object.values(META_FIELD_KEYS));
  const extraFields: Array<{ key: string; label: string }> = [];

  for (const [question, answer] of Object.entries(lead.extras ?? {})) {
    const label = clean(question);
    const text = clean(answer);
    if (!label || !text) continue;
    const key = `x_${slug(label)}`.slice(0, 60);
    if (fixed.has(key as never) || values[key] !== undefined) continue;
    values[key] = text;
    extraFields.push({ key, label });
  }

  return { values, extraFields };
}

/**
 * The extra answers, written out as a note a person can read.
 *
 * **Why not map them onto typed KYC fields.** The obvious move is to send a
 * "Budget" answer to `kyc:budget` — but that field is money, and a Meta form
 * asks budget as a *range*: "less then 1 lac", "5 lac to 1o lac". The mapper
 * strips non-digits, so those would be stored as **1** and **51**. A confidently
 * wrong figure on a client record is worse than no figure, so the answer is
 * kept as the words the customer actually chose.
 *
 * It lands in the record's `notes`, which is visible in the Data Bank and is
 * carried onto the lead when the row is promoted — so whoever rings them can
 * see the budget band before they dial.
 */
export function metaNotes(lead: MetaLeadInput): string | null {
  const lines = Object.entries(lead.extras ?? {})
    .map(([question, answer]) => [clean(question), clean(answer)] as const)
    .filter(([question, answer]) => question && answer)
    .map(([question, answer]) => `${question.replace(/\s*\?\s*$/, '')}: ${answer}`);

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Meta sends a lead's answers as `[{ name, values: [...] }]`.
 *
 * The question's `name` is Meta's own machine key — `full_name`, `phone_number`
 * — and the standard ones are recognised so a lead arrives with its name and
 * phone in the right columns rather than as anonymous extras.
 */
const NAME_KEYS = ['full_name', 'name', 'your_name', 'first_name'];
const PHONE_KEYS = ['phone_number', 'phone', 'mobile_number', 'contact_number', 'whatsapp_number'];
const EMAIL_KEYS = ['email', 'email_address'];
const CITY_KEYS = ['city', 'town', 'location'];

export function normalizeFieldData(
  fieldData: Array<{ name?: string; values?: string[] }> | null | undefined
): { name: string; phone: string; email: string; city: string; extras: Record<string, string> } {
  const out = { name: '', phone: '', email: '', city: '', extras: {} as Record<string, string> };
  let firstName = '';
  let lastName = '';

  for (const entry of fieldData ?? []) {
    const key = clean(entry?.name).toLowerCase();
    const value = clean(entry?.values?.[0]);
    if (!key || !value) continue;

    if (key === 'first_name') { firstName = value; continue; }
    if (key === 'last_name') { lastName = value; continue; }

    if (!out.name && NAME_KEYS.includes(key)) out.name = value;
    else if (!out.phone && PHONE_KEYS.includes(key)) out.phone = value;
    else if (!out.email && EMAIL_KEYS.includes(key)) out.email = value;
    else if (!out.city && CITY_KEYS.includes(key)) out.city = value;
    else out.extras[key] = value;
  }

  // A form that asks for the two halves separately still produces one name.
  if (!out.name) out.name = [firstName, lastName].filter(Boolean).join(' ').trim();

  return out;
}

/**
 * Which campaign a lead in a Meta folder belongs to, however it got there.
 *
 * **A lead in a campaign's folder counts in that campaign** — the owner's call,
 * 2026-09-17. The Campaigns screen attributes by the lead's own `campaignId`,
 * while a folder's Assigned list counts whatever sits in the folder, so a lead
 * added by hand (Sundus's Dr haroon, in FASAL TOWN 2) or promoted by hand read
 * 2 in the folder and 1 in the campaign.
 *
 * **The record's own provenance wins**, because it is exact and travels with the
 * row into a manager's mirror, which carries no `metaSource`. The folder is
 * the answer only for a lead with no record behind it — a personal lead — and
 * only when the folder *is* a campaign: an ad or form folder names no campaign,
 * and inventing one would book leads against a campaign nobody chose.
 */
export function campaignForFolderLead(input: {
  record?: { metaCampaignId?: unknown; metaCampaignName?: unknown } | null;
  folder?: { name?: string | null; metaSource?: { basis?: unknown; campaignId?: unknown } | null } | null;
}): { campaignId: string | null; campaignName: string | null } {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

  const recordId = text(input.record?.metaCampaignId);
  const recordName = text(input.record?.metaCampaignName);
  if (recordId || recordName) return { campaignId: recordId, campaignName: recordName };

  const source = input.folder?.metaSource;
  const folderId = source?.basis === 'CAMPAIGN' ? text(source.campaignId) : null;
  if (folderId) return { campaignId: folderId, campaignName: text(input.folder?.name) };

  return { campaignId: null, campaignName: null };
}
