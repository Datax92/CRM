import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/server';
import { phoneKey } from '@/lib/dataBank';
import { karachiDayKey } from '@/lib/dates';
import { notifyMetaLead, recordMetaIntakeIssue } from '@/lib/server/metaFiling';
import { fileAndOfferMetaLead } from '@/lib/server/metaDistribute';
import { readWhatsAppLead, cameFromAnAd, whatsappNotes, adLabel } from '@/lib/whatsappIntake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lead intake from a Click-to-WhatsApp ad, via an approved intermediary.
 *
 * **What this replaces is a person copying by hand.** The owner's ads send
 * people to WhatsApp — 103 conversations at Rs 155–191 each when this was
 * built — and until now somebody read each chat and typed the name and number
 * into the CRM. Every one they missed was money already spent.
 *
 * **A third door into the same room.** It files through `fileAndOfferMetaLead`,
 * exactly as the Meta webhook and the form bridge do, so a WhatsApp lead is
 * filed, folder-grouped, offered down the priority lane and answered in the
 * popup identically. Nothing downstream knows or cares which door it came
 * through.
 *
 * **The one rule that is different, and it is the whole risk.** A form is
 * submitted once; a conversation is a stream. "Hi", then "price?", then a voice
 * note all arrive here, and filing each would put one person in the pipeline
 * three times with three salespeople ringing them. So **only the first message
 * from a number becomes a lead** — `alreadyKnown` asks the pipeline, not the
 * payload, because only the database knows who is already a customer.
 *
 * That check is deliberately **wider than the form bridge's**. A form's
 * duplicate rule is per folder, because two campaigns legitimately reach the
 * same person. Here the *same person is messaging you*; a second conversation
 * from a number you already hold is the same human being, whichever ad they
 * tapped, and must never become a second lead.
 *
 * **Authentication is the same shared secret the form bridge uses** and it
 * **fails closed**: unset, every request is refused rather than the door
 * standing open. Deliberately not a new variable — one more secret to configure
 * is one more way for this to be silently switched off.
 */
export async function POST(request: Request) {
  const secret = process.env.META_BRIDGE_SECRET;
  if (!secret) {
    console.error('[whatsapp-bridge] META_BRIDGE_SECRET is not set — refusing to run.');
    return NextResponse.json({ ok: false, error: 'Intake is not configured.' }, { status: 503 });
  }

  const auth =
    request.headers.get('authorization') === `Bearer ${secret}` ||
    request.headers.get('x-bridge-secret') === secret ||
    new URL(request.url).searchParams.get('secret') === secret;
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed payload' }, { status: 400 });
  }

  const lead = readWhatsAppLead(body);
  if (!lead) {
    /*
      No number at all. Kept rather than discarded — the payload still holds
      whatever WhatsApp sent, and the Meta Ads screen surfaces these so somebody
      notices the same day instead of it becoming an HTTP status nobody reads.
    */
    await recordMetaIntakeIssue({
      reason: 'NO_PHONE',
      detail: 'A WhatsApp message arrived with no sender number, so it cannot be filed.',
      leadgenId: null,
      source: 'WhatsApp',
      payload: body,
    });
    return NextResponse.json(
      { ok: false, error: 'A WhatsApp lead needs a sender number.' },
      { status: 200 }
    );
  }

  try {
    const key = phoneKey(lead.phone);

    /*
      **The first-contact rule.** Asked before anything is written, and asked of
      the pipeline rather than of this message. `phoneKey` is on every lead
      (backfilled 2026-09-13), so this is one indexed read.
    */
    if (key) {
      const known = await adminDb
        .collection('leads')
        .where('phoneKey', '==', key)
        .limit(1)
        .get();
      if (!known.empty) {
        const existing = known.docs[0];
        // 200, not an error: this is the rule working. A non-2xx would make the
        // intermediary retry a message that will never be filed, for ever.
        return NextResponse.json({
          ok: true,
          outcome: 'ALREADY_A_LEAD',
          leadId: existing.id,
          assignedTo: existing.data().assigneeName ?? null,
          message: 'That number is already in the pipeline — no second lead created.',
        });
      }
    }

    const result = await fileAndOfferMetaLead({
      // The WhatsApp message id, so a redelivery of the same message is caught
      // even before the phone rule above.
      leadgenId: lead.messageId,
      name: lead.name,
      phone: lead.phone,
      email: null,
      city: null,
      /*
        Their own words, and which ad they tapped. Kept as text for the reason
        `metaNotes` records: "around 50 lakh maybe" is a sentence, and storing it
        as a number would invent a precision the customer never gave.
      */
      extras: {
        ...(lead.message ? { 'Their first message': lead.message } : {}),
        ...(lead.adHeadline ? { 'Ad they tapped': lead.adHeadline } : {}),
        ...(lead.clickId ? { 'WhatsApp click id': lead.clickId } : {}),
      },
      /*
        Grouped by **ad**, which is what `resolveMetaSource` does when there is
        no campaign or form — one folder per ad, which is exactly how the owner
        reads the Meta Ads panel. The headline is the only human-readable name
        Meta attaches to a click-to-WhatsApp referral.
      */
      campaignId: null,
      campaignName: null,
      adId: lead.adId,
      adName: adLabel(lead),
      adsetName: null,
      formId: null,
      formName: null,
      pageId: null,
      submittedAt: lead.sentAt,
    });

    if (result.outcome === 'CREATED') {
      await notifyMetaLead(result.folderId, result.folderName, karachiDayKey());
    }

    return NextResponse.json({
      ok: true,
      ...result,
      // Reported rather than enforced: somebody who found the number another way
      // is still a real lead, and the owner may want to know the difference.
      fromAd: cameFromAnAd(lead),
      notes: whatsappNotes(lead),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[whatsapp-bridge] Failed to file a lead:', message);
    await recordMetaIntakeIssue({
      reason: 'FAILED',
      detail: message.slice(0, 300),
      leadgenId: lead.messageId,
      source: adLabel(lead),
      payload: body,
    }).catch(() => {});
    // Non-2xx so the intermediary retries rather than losing it.
    return NextResponse.json({ ok: false, error: 'Could not file the lead.' }, { status: 500 });
  }
}

/** A health check, so setup can be confirmed without sending a lead. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'whatsapp-bridge',
    configured: Boolean(process.env.META_BRIDGE_SECRET),
  });
}
