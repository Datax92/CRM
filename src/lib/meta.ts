import crypto from 'crypto';

/**
 * Meta Lead Ads integration.
 *
 * Meta's `leadgen` webhook deliberately carries no personal data — only a
 * `leadgen_id`. The customer's actual answers have to be fetched from the Graph
 * API with a Page Access Token that holds `leads_retrieval`. Without that token
 * every lead arrives anonymous, which is useless to the sales team.
 *
 * Credentials required (see .env.example):
 *   META_APP_SECRET             - verifies the X-Hub-Signature-256 header
 *   META_WEBHOOK_VERIFY_TOKEN   - the string Meta echoes during subscription
 *   META_PAGE_ACCESS_TOKEN      - long-lived page or system-user token
 *   META_AD_ACCOUNT_ID          - optional, only for campaign name resolution
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaLeadField {
  name: string;
  values: string[];
}

export interface NormalizedLead {
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  /** Any question on the form we don't have a canonical mapping for. */
  customFields: Record<string, string>;
  metaCreatedTime: string | null;
}

export interface CampaignInfo {
  campaignId: string | null;
  campaignName: string | null;
  adsetName: string | null;
  adName: string | null;
}

export function isMetaConfigured(): boolean {
  return Boolean(process.env.META_PAGE_ACCESS_TOKEN);
}

/**
 * Constant-time verification of Meta's payload signature.
 *
 * Must run against the raw request body — re-serialising parsed JSON changes
 * the bytes and the HMAC will never match.
 */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;

  if (!appSecret) {
    // Fail closed. An unverified webhook is an open door for fabricated leads.
    console.error('[meta] META_APP_SECRET is not set — rejecting webhook delivery.');
    return false;
  }
  if (!signatureHeader?.startsWith('sha256=')) {
    return false;
  }

  const expected = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const received = signatureHeader.slice('sha256='.length);

  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(received, 'hex');
  if (expectedBuf.length !== receivedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/** Field names Meta uses for its own standard questions. */
const NAME_KEYS = ['full_name', 'name', 'your_name'];
const FIRST_NAME_KEYS = ['first_name', 'given_name'];
const LAST_NAME_KEYS = ['last_name', 'family_name', 'surname'];
const PHONE_KEYS = ['phone_number', 'phone', 'mobile_number', 'contact_number', 'whatsapp_number'];
const EMAIL_KEYS = ['email', 'email_address'];
const CITY_KEYS = ['city', 'town'];

function pick(fields: Map<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = fields.get(key);
    if (value) return value;
  }
  return null;
}

/**
 * Maps Meta's `field_data` array onto our lead shape.
 *
 * Custom questions — and the Urdu/English labels a local campaign is likely to
 * use — won't match the canonical keys, so anything unrecognised is preserved
 * under `customFields` rather than dropped. Confirm the live form's field names
 * with whoever built it and extend the key lists above as needed.
 */
export function normalizeLeadFields(
  fieldData: MetaLeadField[],
  metaCreatedTime?: string | null
): NormalizedLead {
  const fields = new Map<string, string>();
  for (const field of fieldData ?? []) {
    const value = (field.values ?? []).filter(Boolean).join(', ').trim();
    if (value) fields.set(field.name.toLowerCase().trim(), value);
  }

  let name = pick(fields, NAME_KEYS);
  if (!name) {
    const first = pick(fields, FIRST_NAME_KEYS);
    const last = pick(fields, LAST_NAME_KEYS);
    name = [first, last].filter(Boolean).join(' ').trim() || null;
  }

  const known = new Set([
    ...NAME_KEYS, ...FIRST_NAME_KEYS, ...LAST_NAME_KEYS,
    ...PHONE_KEYS, ...EMAIL_KEYS, ...CITY_KEYS,
  ]);

  const customFields: Record<string, string> = {};
  for (const [key, value] of fields) {
    if (!known.has(key)) customFields[key] = value;
  }

  return {
    name: name || 'Unnamed lead',
    phone: pick(fields, PHONE_KEYS),
    email: pick(fields, EMAIL_KEYS),
    city: pick(fields, CITY_KEYS),
    customFields,
    metaCreatedTime: metaCreatedTime ?? null,
  };
}

/**
 * Fetches a lead's answers from the Graph API.
 * Throws on failure so the webhook can decide whether to retry.
 */
export async function fetchLeadDetails(leadgenId: string): Promise<NormalizedLead> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) {
    throw new Error('META_PAGE_ACCESS_TOKEN is not set — cannot retrieve lead details.');
  }

  const url = `${GRAPH_BASE}/${encodeURIComponent(leadgenId)}?fields=field_data,created_time,ad_id,form_id&access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Graph API returned ${response.status} for lead ${leadgenId}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    field_data?: MetaLeadField[];
    created_time?: string;
  };

  return normalizeLeadFields(data.field_data ?? [], data.created_time ?? null);
}

/**
 * Resolves an ad ID up to its campaign (FR-6).
 *
 * The leadgen webhook carries `ad_id` but never `campaign_id`, so campaign
 * attribution needs a second Graph call with `ads_read`. This is best-effort:
 * if the token lacks the permission we keep the ad ID and carry on rather than
 * losing the lead.
 */
export async function resolveCampaign(adId: string | null | undefined): Promise<CampaignInfo> {
  const empty: CampaignInfo = { campaignId: null, campaignName: null, adsetName: null, adName: null };
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!adId || !token) return empty;

  try {
    const url = `${GRAPH_BASE}/${encodeURIComponent(adId)}?fields=name,campaign{id,name},adset{id,name}&access_token=${encodeURIComponent(token)}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      console.warn(`[meta] Could not resolve campaign for ad ${adId} (HTTP ${response.status}). Needs ads_read.`);
      return empty;
    }

    const data = (await response.json()) as {
      name?: string;
      campaign?: { id?: string; name?: string };
      adset?: { name?: string };
    };

    return {
      campaignId: data.campaign?.id ?? null,
      campaignName: data.campaign?.name ?? null,
      adsetName: data.adset?.name ?? null,
      adName: data.name ?? null,
    };
  } catch (error) {
    console.warn('[meta] Campaign resolution failed:', error);
    return empty;
  }
}
