import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/server';
import { ADMIN_ASSIGN_WINDOW_MS } from '@/lib/constants/distribution';
import { FieldValue } from 'firebase-admin/firestore';
import {
  verifyMetaSignature,
  fetchLeadDetails,
  resolveCampaign,
  isMetaConfigured,
} from '@/lib/meta';

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

async function ingestLead(leadgenId: string, value: Record<string, unknown>): Promise<boolean> {
  const leadRef = adminDb.collection('leads').doc(leadgenId);

  const existing = await leadRef.get();
  if (existing.exists) return false;

  const adId = value.ad_id ? String(value.ad_id) : null;
  const formId = value.form_id ? String(value.form_id) : null;
  const pageId = value.page_id ? String(value.page_id) : null;

  // Without a page access token we cannot retrieve the customer's details.
  // Record the lead anyway — losing it entirely would be worse — but mark it
  // clearly so the admin knows why it looks empty.
  let details = null;
  let intakeWarning: string | null = null;

  if (isMetaConfigured()) {
    details = await fetchLeadDetails(leadgenId);
  } else {
    intakeWarning = 'META_PAGE_ACCESS_TOKEN is not configured, so contact details could not be retrieved from Meta.';
    console.error(`[meta] ${intakeWarning}`);
  }

  const campaign = await resolveCampaign(adId);
  const now = new Date();

  await leadRef.create({
    name: details?.name ?? `Meta lead ${leadgenId}`,
    phone: details?.phone ?? null,
    email: details?.email ?? null,
    city: details?.city ?? null,
    customFields: details?.customFields ?? {},

    source: 'META_ADS',
    status: 'NEW',
    assignedUserId: null,
    attemptedAssignees: [],

    campaignId: campaign.campaignId ?? null,
    campaignName: campaign.campaignName ?? null,
    adId,
    adName: campaign.adName ?? null,
    adsetName: campaign.adsetName ?? null,
    formId,
    pageId,

    createdAt: FieldValue.serverTimestamp(),
    metaCreatedTime: details?.metaCreatedTime ?? null,
    adminAssignDeadlineAt: new Date(now.getTime() + ADMIN_ASSIGN_WINDOW_MS),
    intakeWarning,
  });

  // FR-29: the audit trail starts at intake.
  await leadRef.collection('events').add({
    type: 'LEAD_INGESTED',
    actorUid: 'system:meta-webhook',
    at: FieldValue.serverTimestamp(),
    meta: {
      leadgenId,
      adId,
      formId,
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      contactDetailsRetrieved: Boolean(details),
    },
  });

  // FR-6 / FR-25: keep a campaign registry so reports can show names, not IDs.
  if (campaign.campaignId) {
    await adminDb.collection('campaigns').doc(campaign.campaignId).set(
      {
        name: campaign.campaignName ?? campaign.campaignId,
        metaCampaignId: campaign.campaignId,
        lastLeadAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  return true;
}
