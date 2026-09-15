/**
 * Turning a WhatsApp message from a Click-to-WhatsApp ad into a lead.
 *
 * **The shape of the problem is different from a form, in one way that
 * matters.** A lead form is submitted once, so one submission is one lead. A
 * WhatsApp conversation is a *stream* — the same person sends "Hi", then "price
 * kya hai?", then a voice note — and every one of those arrives here. Treating
 * each as a lead would put the same person in the pipeline five times and have
 * five salespeople ring them.
 *
 * So the rule is: **the first message from a number is the lead, and every
 * later message from that number is not.** `isFirstContact` is asked before
 * anything is filed; the caller answers it from the pipeline, not from this
 * module, because only the database knows who is already a customer.
 *
 * **What a click-to-WhatsApp lead actually contains**, and it is not what a
 * form gives you: their WhatsApp number, their profile name, the words they
 * typed, and — the useful part — a `referral` block Meta attaches to the *first*
 * message naming the exact ad they tapped. No email, no city, no budget, unless
 * they happen to type it. Richer in intent, thinner in fields.
 *
 * Dependency-free, so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

/** What the caller must give us; every field optional because Make's shape varies. */
export interface WhatsAppBridgeBody {
  [key: string]: unknown;
}

export interface WhatsAppLead {
  /** The WhatsApp message id (`wamid…`) — unique per message, so a replay is harmless. */
  messageId: string;
  /** Their number, as WhatsApp gives it. */
  phone: string;
  /** WhatsApp profile name. Often a nickname, sometimes an emoji. */
  name: string | null;
  /** What they actually typed. Empty for an image or voice note. */
  message: string | null;
  /** The ad they tapped, when Meta attached one. */
  adId: string | null;
  adHeadline: string | null;
  adBody: string | null;
  sourceUrl: string | null;
  /** Meta's click id for the conversation, kept for attribution reporting. */
  clickId: string | null;
  sentAt: string | null;
}

const text = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
};

/** Reads a value that may be nested, e.g. `referral.source_id`. */
function dig(body: WhatsAppBridgeBody, path: string): unknown {
  let current: unknown = body;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Pulls a lead out of whatever the intermediary posted.
 *
 * **Many spellings accepted on purpose.** Make's WhatsApp module, a raw Cloud
 * API webhook and a hand-built scenario each name these differently, and the
 * cost of guessing wrong is a lead that silently never arrives. Returns `null`
 * only when there is no phone number, which is the one field without which
 * nothing can be filed.
 */
export function readWhatsAppLead(body: WhatsAppBridgeBody): WhatsAppLead | null {
  const pick = (...paths: string[]): string | null => {
    for (const path of paths) {
      const found = text(dig(body, path));
      if (found) return found;
    }
    return null;
  };

  const phone = pick(
    'phone', 'from', 'wa_id', 'waId', 'phone_number', 'phoneNumber',
    'contacts.0.wa_id', 'messages.0.from', 'sender', 'contact.phone'
  );
  if (!phone) return null;

  return {
    /*
      Falling back to the phone number keeps the replay guarantee in a weaker
      form rather than abandoning it: the same person posted twice is still one
      record, which is exactly the rule this module exists to enforce.
    */
    messageId: pick('message_id', 'messageId', 'id', 'wamid', 'messages.0.id') ?? `wa_${phone.replace(/\D/g, '')}`,
    phone,
    name: pick('name', 'profile_name', 'profileName', 'contacts.0.profile.name', 'contact.name'),
    message: pick('message', 'text', 'body', 'text.body', 'messages.0.text.body'),
    adId: pick('ad_id', 'adId', 'referral.source_id', 'messages.0.referral.source_id'),
    adHeadline: pick('ad_headline', 'headline', 'referral.headline', 'messages.0.referral.headline'),
    adBody: pick('ad_body', 'referral.body', 'messages.0.referral.body'),
    sourceUrl: pick('source_url', 'referral.source_url', 'messages.0.referral.source_url'),
    clickId: pick('ctwa_clid', 'referral.ctwa_clid', 'messages.0.referral.ctwa_clid'),
    sentAt: pick('timestamp', 'sent_at', 'sentAt', 'messages.0.timestamp'),
  };
}

/**
 * Whether this message came from tapping an ad.
 *
 * **Only the first message of a conversation carries the referral**, so a
 * message without one is either a later message in an ad conversation — which
 * the first-contact rule already excludes — or somebody who found the number
 * some other way. The second case is a real lead and the owner may well want
 * it, so this is reported rather than used to refuse anything here.
 */
export function cameFromAnAd(lead: WhatsAppLead): boolean {
  return Boolean(lead.adId || lead.sourceUrl || lead.clickId);
}

/**
 * What the Data Bank record and the lead should carry beyond name and number.
 *
 * Their own words go in as a note rather than into a typed field, for the same
 * reason the form's budget answer does: "around 50 lakh maybe" is a sentence, and
 * storing it as a number would invent a precision the customer never gave.
 */
export function whatsappNotes(lead: WhatsAppLead): string | null {
  const parts: string[] = [];
  if (lead.message) parts.push(`They said: "${lead.message}"`);
  if (lead.adHeadline) parts.push(`Ad: ${lead.adHeadline}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** A label for the folder when Meta gave us an ad but no name for it. */
export function adLabel(lead: WhatsAppLead): string {
  return lead.adHeadline || (lead.adId ? `WhatsApp ad ${lead.adId}` : 'WhatsApp (no ad)');
}
