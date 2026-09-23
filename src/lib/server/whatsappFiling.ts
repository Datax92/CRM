import { adminDb } from '@/lib/firebase/server';
import { phoneKey } from '@/lib/dataBank';
import { karachiDayKey } from '@/lib/dates';
import { notifyMetaLead, recordMetaIntakeIssue } from '@/lib/server/metaFiling';
import { fileAndOfferMetaLead } from '@/lib/server/metaDistribute';
import { resolveCampaign } from '@/lib/meta';
import { readWhatsAppLead, cameFromAnAd, whatsappNotes, whatsappSource, adLabel } from '@/lib/whatsappIntake';

export { splitCloudApiMessages } from '@/lib/whatsappIntake';

/**
 * One WhatsApp message in, at most one lead out — the rules both doors share.
 *
 * **Two doors, one filer.** A Click-to-WhatsApp message reaches the CRM either
 * through Make (`/api/webhooks/whatsapp-bridge`) or straight from Meta
 * (`/api/webhooks/meta`, `object: whatsapp_business_account`). Both call this,
 * so the ads-only rule, the first-contact rule and the filing are identical
 * whichever path a message took — and running both at once while switching
 * over files each person once, not twice (the message id and the phone rule
 * both catch the second copy).
 *
 * **Only the first message from a number becomes a lead.** A conversation is a
 * stream — "Hi", then "price?", then a voice note — and filing each would put
 * one person in the pipeline three times. `alreadyKnown` asks the pipeline, not
 * the payload, because only the database knows who is already a customer. That
 * check is deliberately **wider than the form's**: a second conversation from a
 * number already held is the same human being, whichever ad they tapped.
 *
 * Returns the HTTP status and body the caller should answer with: 200 for
 * everything handled (including "not from an ad" and "already a lead", which
 * are the rules working), 500 only when filing genuinely failed, so the sender
 * retries rather than losing the lead.
 */
export async function fileWhatsAppMessage(
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const lead = readWhatsAppLead(body);
  if (!lead) {
    // Kept rather than discarded — the Meta Ads screen surfaces these.
    await recordMetaIntakeIssue({
      reason: 'NO_PHONE',
      detail: 'A WhatsApp message arrived with no sender number, so it cannot be filed.',
      leadgenId: null,
      source: 'WhatsApp',
      payload: body,
    });
    return { status: 200, body: { ok: false, error: 'A WhatsApp lead needs a sender number.' } };
  }

  /*
    **Ads only**, asked before any read: the number is the business's everyday
    WhatsApp and most of what arrives is not a lead (owner, 2026-09-17).
  */
  if (!cameFromAnAd(lead)) {
    return {
      status: 200,
      body: { ok: true, outcome: 'NOT_FROM_AD', message: 'This message did not come from an ad, so no lead was created.' },
    };
  }

  try {
    const key = phoneKey(lead.phone);
    if (key) {
      const known = await adminDb.collection('leads').where('phoneKey', '==', key).limit(1).get();
      if (!known.empty) {
        const existing = known.docs[0];
        return {
          status: 200,
          body: {
            ok: true,
            outcome: 'ALREADY_A_LEAD',
            leadId: existing.id,
            assignedTo: existing.data().assigneeName ?? null,
            message: 'That number is already in the pipeline — no second lead created.',
          },
        };
      }
    }

    // Best-effort by design: `resolveCampaign` returns nulls rather than
    // throwing, and `whatsappSource` then groups by ad instead.
    const campaign = await resolveCampaign(lead.adId);
    const source = whatsappSource(lead, campaign);

    const result = await fileAndOfferMetaLead({
      // The WhatsApp message id, so a redelivery of the same message is caught
      // even before the phone rule above.
      leadgenId: lead.messageId,
      name: lead.name,
      phone: lead.phone,
      email: null,
      city: null,
      extras: {
        ...(lead.message ? { 'Their first message': lead.message } : {}),
        ...(lead.adHeadline ? { 'Ad they tapped': lead.adHeadline } : {}),
        ...(lead.clickId ? { 'WhatsApp click id': lead.clickId } : {}),
      },
      ...source,
      formId: null,
      formName: null,
      pageId: null,
      submittedAt: lead.sentAt,
    });

    if (result.outcome === 'CREATED') {
      await notifyMetaLead(result.folderId, result.folderName, karachiDayKey());
    }

    return {
      status: 200,
      body: {
        ok: true,
        ...result,
        groupedBy: campaign.campaignId ? 'CAMPAIGN' : 'AD',
        campaignName: campaign.campaignName,
        notes: whatsappNotes(lead),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[whatsapp] Failed to file a lead:', message);
    await recordMetaIntakeIssue({
      reason: 'FAILED',
      detail: message.slice(0, 300),
      leadgenId: lead.messageId,
      source: adLabel(lead),
      payload: body,
    }).catch(() => {});
    return { status: 500, body: { ok: false, error: 'Could not file the lead.' } };
  }
}
