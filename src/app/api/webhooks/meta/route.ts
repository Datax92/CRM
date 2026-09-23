import { NextResponse } from 'next/server';
import {
  verifyMetaSignature,
  fetchLeadDetails,
  resolveCampaign,
  isMetaConfigured,
} from '@/lib/meta';
import { notifyMetaLead } from '@/lib/server/metaFiling';
import { fileAndOfferMetaLead } from '@/lib/server/metaDistribute';
import { fileWhatsAppMessage, splitCloudApiMessages } from '@/lib/server/whatsappFiling';
import { karachiDayKey } from '@/lib/dates';

// firebase-admin and node:crypto both require the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';



/**
 * Meta's subscription handshake. Meta calls this once when the webhook is first
 * registered and expects the challenge echoed back verbatim.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!expected) {
    console.error('[meta] META_WEBHOOK_VERIFY_TOKEN is not set — cannot complete subscription.');
    return new NextResponse('Webhook not configured', { status: 503 });
  }

  if (mode === 'subscribe' && token === expected) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse('Forbidden', { status: 403 });
}

/**
 * Lead intake (FR-4, FR-5, FR-6).
 *
 * Meta sends only a `leadgen_id`; the customer's answers are fetched separately
 * from the Graph API. The lead document is written with `create` semantics keyed
 * on the leadgen id, so Meta's at-least-once redelivery cannot produce duplicate
 * leads or restart an already-running 5-minute window.
 */
export async function POST(request: Request) {
  // Signature verification needs the raw bytes — parse only after checking.
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  if (!verifyMetaSignature(rawBody, signature)) {
    console.warn('[meta] Rejected webhook delivery with an invalid signature.');
    return new NextResponse('Invalid signature', { status: 401 });
  }

  let body: {
    object?: string;
    entry?: Array<{ changes?: Array<{ field?: string; value?: Record<string, unknown> }> }>;
  };

  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
  }

  /*
    **Click-to-WhatsApp, straight from Meta** (owner, 2026-09-23), replacing the
    Make scenario. The same app's webhook carries both objects, so the same
    signature check covers both. Each message goes through `fileWhatsAppMessage`,
    the filer the Make bridge also uses — ads only, first contact only.
  */
  if (body.object === 'whatsapp_business_account') {
    let filed = 0;
    let failed = 0;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        for (const message of splitCloudApiMessages(change.value ?? {})) {
          const result = await fileWhatsAppMessage(message, 'meta');
          if (result.status >= 500) failed++;
          else if (result.body.outcome === 'CREATED') filed++;
        }
      }
    }
    // Non-2xx makes Meta redeliver; the message id and the phone rule make a
    // redelivery of anything already filed a no-op.
    return NextResponse.json({ filed, failed }, { status: failed > 0 ? 500 : 200 });
  }

  if (body.object !== 'page') {
    // Acknowledge anything we don't handle so Meta stops retrying it.
    return NextResponse.json({ ignored: true });
  }

  let ingested = 0;
  let duplicates = 0;
  const failures: string[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue;

      const value = change.value ?? {};
      const leadgenId = String(value.leadgen_id ?? '');
      if (!leadgenId) continue;

      try {
        const created = await ingestLead(leadgenId, value);
        if (created) ingested++;
        else duplicates++;
      } catch (error) {
        // Log and keep going — one bad lead must not block the rest of the batch.
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[meta] Failed to ingest lead ${leadgenId}:`, message);
        failures.push(leadgenId);
      }
    }
  }

  // Meta retries on any non-2xx. Retrying is the right call when the Graph
  // fetch failed (often a transient token or rate-limit problem) and the lead
  // would otherwise be lost entirely.
  if (failures.length > 0) {
    return NextResponse.json(
      { ingested, duplicates, failed: failures.length },
      { status: 500 }
    );
  }

  return NextResponse.json({ ingested, duplicates });
}

/**
 * Files a Meta lead into the Data Bank.
 *
 * **It used to create a lead in the pipeline directly.** The owner's
 * instruction is that Facebook leads land in the admin's Data Bank, grouped one
 * folder per ad, and are distributed from there — so both this route and the
 * Make.com bridge now call `fileAndOfferMetaLead`, so a lead is filed and offered identically
 * whichever door it came through.
 */
async function ingestLead(leadgenId: string, value: Record<string, unknown>): Promise<boolean> {
  const adId = value.ad_id ? String(value.ad_id) : null;
  const formId = value.form_id ? String(value.form_id) : null;
  const pageId = value.page_id ? String(value.page_id) : null;

  /*
    **Without a token there are no answers, and a lead with no phone number
    cannot be filed.** Throwing rather than filing an empty shell is deliberate:
    the route turns it into a non-2xx, Meta retries, and the lead survives a
    transient token problem instead of being recorded as a nameless row.
  */
  if (!isMetaConfigured()) {
    throw new Error('META_PAGE_ACCESS_TOKEN is not configured — cannot retrieve lead details.');
  }

  const details = await fetchLeadDetails(leadgenId);
  const campaign = await resolveCampaign(adId);

  const result = await fileAndOfferMetaLead({
    leadgenId,
    name: details.name,
    phone: details.phone,
    email: details.email,
    city: details.city,
    extras: details.customFields ?? {},
    campaignId: campaign.campaignId,
    campaignName: campaign.campaignName,
    adId,
    adName: campaign.adName,
    adsetName: campaign.adsetName,
    formId,
    pageId,
    submittedAt: details.metaCreatedTime,
  });

  if (result.outcome === 'CREATED') {
    await notifyMetaLead(result.folderId, result.folderName, karachiDayKey());
    return true;
  }
  return false;
}
