import { NextResponse } from 'next/server';
import { karachiDayKey } from '@/lib/dates';
import { fileMetaLead, notifyMetaLead, recordMetaIntakeIssue } from '@/lib/server/metaFiling';
import type { MetaLeadInput } from '@/lib/metaIntake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lead intake from an approved intermediary — Make.com or Zapier.
 *
 * **Why this exists.** Meta delivers no production leads to an unpublished app,
 * and App Review takes up to twenty days. Make.com's own Meta app already holds
 * advanced access, so it can read the leads today and post them here. It also
 * carries the campaign and ad *names*, which Meta's own webhook would only give
 * us with `ads_read` — a permission that costs a screencast and a day of test
 * calls to request.
 *
 * **A second door, not a second system.** It hands the lead to `fileMetaLead`,
 * the same function Meta's own webhook uses, so a lead is filed identically
 * either way and turning this off when Meta approves changes nothing anybody
 * can see.
 *
 * **Authentication is a shared secret, not a signature.** Meta signs its
 * deliveries with the app secret and `/api/webhooks/meta` verifies that HMAC;
 * an intermediary cannot produce that signature, so this endpoint takes a
 * bearer token instead. It **fails closed**: with `META_BRIDGE_SECRET` unset,
 * every request is refused rather than the door standing open.
 */
export async function POST(request: Request) {
  const secret = process.env.META_BRIDGE_SECRET;
  if (!secret) {
    console.error('[meta-bridge] META_BRIDGE_SECRET is not set — refusing every delivery.');
    return NextResponse.json({ ok: false, error: 'Bridge is not configured.' }, { status: 503 });
  }

  /*
    Accepted in a header or a query parameter: Make.com sends headers happily,
    some Zapier actions do not, and a lead lost to a configuration detail is a
    lead lost. Compared with `timingSafeEqual` semantics via length check first.
  */
  const url = new URL(request.url);
  const presented =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-bridge-secret') ??
    url.searchParams.get('secret') ??
    '';

  if (presented.length !== secret.length || presented !== secret) {
    console.warn('[meta-bridge] Rejected a delivery with a bad secret.');
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed JSON' }, { status: 400 });
  }

  const lead = readBridgeLead(body);
  if (!lead) {
    /*
      **Kept, not discarded.** Usually it means the Facebook form has no phone
      question, or the intermediary is sending it under a name we do not
      recognise. Either way the person's details are in the payload and must not
      evaporate into an HTTP status nobody reads — the Meta Ads screen surfaces
      these so somebody notices the same day.
    */
    await recordMetaIntakeIssue({
      reason: 'NO_PHONE',
      detail: 'The lead arrived without a phone number, so it cannot be filed in the Data Bank.',
      leadgenId: typeof body.leadgen_id === 'string' ? body.leadgen_id : null,
      source: typeof body.campaign_name === 'string' ? body.campaign_name : null,
      payload: body,
    });
    return NextResponse.json(
      { ok: false, error: 'A lead needs at least a phone number. It has been kept under Meta Ads.' },
      { status: 200 }
    );
  }

  try {
    const result = await fileMetaLead(lead);
    if (result.outcome === 'CREATED') {
      await notifyMetaLead(result.folderId, result.folderName, karachiDayKey());
    }
    /*
      **200 for a duplicate and for a missing phone number.** Both are final
      answers — retrying will produce the same outcome for ever — and a
      non-2xx would make the intermediary queue it indefinitely.
    */
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // A real failure. Non-2xx so the intermediary retries rather than losing it
    // — and recorded too, in case every retry fails and it would otherwise go.
    const message = error instanceof Error ? error.message : String(error);
    console.error('[meta-bridge] Failed to file a lead:', message);
    await recordMetaIntakeIssue({
      reason: 'FAILED',
      detail: message.slice(0, 300),
      leadgenId: lead.leadgenId,
      source: lead.campaignName ?? lead.formName ?? null,
      payload: body,
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: 'Could not file the lead.' }, { status: 500 });
  }
}

/**
 * Reads whatever shape the intermediary sent.
 *
 * Make.com and Zapier each name their fields differently, and a person wiring
 * the scenario by hand will name them a third way — so every plausible spelling
 * is accepted rather than demanding one. The only hard requirement is a phone
 * number, because a contact nobody can ring is not a lead.
 */
function readBridgeLead(body: Record<string, unknown>): MetaLeadInput | null {
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = body[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number') return String(value);
    }
    return null;
  };

  const phone = pick('phone', 'phone_number', 'phoneNumber', 'mobile', 'contact_number', 'whatsapp_number');
  if (!phone) return null;

  const extras =
    body.extras && typeof body.extras === 'object' && !Array.isArray(body.extras)
      ? Object.fromEntries(
          Object.entries(body.extras as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])
        )
      : {};

  return {
    /*
      Meta's own id when the intermediary passes it — that is what makes a
      replay harmless. Falling back to the phone number keeps the guarantee in a
      weaker form rather than abandoning it: the same person re-posted is still
      one record.
    */
    leadgenId: pick('leadgen_id', 'leadgenId', 'id', 'lead_id') ?? `phone_${phone.replace(/\D/g, '')}`,
    name: pick('name', 'full_name', 'fullName', 'first_name'),
    phone,
    email: pick('email', 'email_address'),
    city: pick('city', 'town'),
    extras,
    campaignId: pick('campaign_id', 'campaignId'),
    campaignName: pick('campaign_name', 'campaignName', 'campaign'),
    adId: pick('ad_id', 'adId'),
    adName: pick('ad_name', 'adName', 'ad'),
    adsetName: pick('adset_name', 'adsetName', 'adset'),
    formId: pick('form_id', 'formId'),
    formName: pick('form_name', 'formName', 'form'),
    pageId: pick('page_id', 'pageId'),
    submittedAt: pick('created_time', 'createdTime', 'submitted_at', 'submittedAt'),
  };
}

/** A GET so you can confirm the endpoint is deployed without sending a lead. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'meta-bridge',
    configured: Boolean(process.env.META_BRIDGE_SECRET),
  });
}
