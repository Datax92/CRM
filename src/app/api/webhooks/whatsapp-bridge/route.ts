import { NextResponse } from 'next/server';
import { fileWhatsAppMessage } from '@/lib/server/whatsappFiling';

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
 * **Meta can now deliver these directly** (`/api/webhooks/meta`, object
 * `whatsapp_business_account`); both routes call `fileWhatsAppMessage`, so
 * this one can be switched off in Make once the direct subscription is live.
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

  // The rules — ads only, first contact only — live in one place, shared with
  // the direct Meta webhook, so the two doors can never file differently.
  const result = await fileWhatsAppMessage(body, 'make');
  return NextResponse.json(result.body, { status: result.status });
}

/** A health check, so setup can be confirmed without sending a lead. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'whatsapp-bridge',
    configured: Boolean(process.env.META_BRIDGE_SECRET),
  });
}
