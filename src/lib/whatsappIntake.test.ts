import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readWhatsAppLead,
  cameFromAnAd,
  whatsappNotes,
  adLabel,
} from './whatsappIntake.ts';

/** A real Cloud API webhook body, trimmed to what matters. */
const cloudApiBody = {
  contacts: [{ profile: { name: 'Ali Raza' }, wa_id: '923001234567' }],
  messages: [
    {
      id: 'wamid.HBg',
      from: '923001234567',
      timestamp: '1789400000',
      text: { body: 'Price kya hai?' },
      referral: {
        source_id: '120212345',
        source_url: 'https://fb.me/xyz',
        headline: 'FASAL TOWN 2 – Pakistan',
        body: 'Book your plot today',
        ctwa_clid: 'ARxyz',
      },
    },
  ],
};

test('a raw Cloud API payload yields the whole lead', () => {
  const lead = readWhatsAppLead(cloudApiBody)!;
  assert.equal(lead.phone, '923001234567');
  assert.equal(lead.name, 'Ali Raza');
  assert.equal(lead.message, 'Price kya hai?');
  assert.equal(lead.messageId, 'wamid.HBg');
  assert.equal(lead.adId, '120212345');
  assert.equal(lead.adHeadline, 'FASAL TOWN 2 – Pakistan');
  assert.equal(lead.clickId, 'ARxyz');
});

test('a flattened payload from an intermediary yields the same lead', () => {
  // Make can be configured to post a flat body. Both must work, or the lead
  // silently never arrives and nothing in the product says why.
  const lead = readWhatsAppLead({
    from: '923001234567',
    profile_name: 'Ali Raza',
    text: 'Price kya hai?',
    message_id: 'wamid.HBg',
    ad_id: '120212345',
    headline: 'FASAL TOWN 2 – Pakistan',
  })!;
  assert.equal(lead.phone, '923001234567');
  assert.equal(lead.name, 'Ali Raza');
  assert.equal(lead.adId, '120212345');
});

test('no phone number means nothing can be filed', () => {
  // The one field without which there is no lead — everything else is optional.
  assert.equal(readWhatsAppLead({ text: 'hello' }), null);
  assert.equal(readWhatsAppLead({}), null);
});

test('a message with no text still produces a lead', () => {
  // An image or a voice note is a real person starting a real conversation.
  const lead = readWhatsAppLead({ from: '923009999999', message_id: 'wamid.Y' })!;
  assert.equal(lead.phone, '923009999999');
  assert.equal(lead.message, null);
});

test('the message id is the dedupe key, and falls back to the number', () => {
  // A replay of the same message must not produce a second lead. Without an id
  // the guarantee is kept in a weaker form rather than abandoned.
  assert.equal(readWhatsAppLead({ from: '92300 123 4567' })!.messageId, 'wa_923001234567');
  assert.equal(readWhatsAppLead({ from: '923001234567', id: 'wamid.Z' })!.messageId, 'wamid.Z');
});

test('only a first message carries the ad, and that is how we know', () => {
  assert.equal(cameFromAnAd(readWhatsAppLead(cloudApiBody)!), true);
  // A later message in the same conversation has no referral. It is not a new
  // lead — the first-contact rule excludes it — and it is not an error either.
  assert.equal(cameFromAnAd(readWhatsAppLead({ from: '923001234567', text: 'ok' })!), false);
});

test('their own words are kept as words, never parsed into a number', () => {
  const lead = readWhatsAppLead(cloudApiBody)!;
  assert.equal(whatsappNotes(lead), 'They said: "Price kya hai?" · Ad: FASAL TOWN 2 – Pakistan');
  // Nothing typed and no ad: no note rather than an empty one.
  assert.equal(whatsappNotes(readWhatsAppLead({ from: '923001234567' })!), null);
});

test('a folder is labelled by the ad, and says so even when unnamed', () => {
  assert.equal(adLabel(readWhatsAppLead(cloudApiBody)!), 'FASAL TOWN 2 – Pakistan');
  assert.equal(adLabel(readWhatsAppLead({ from: '92300', ad_id: '999' })!), 'WhatsApp ad 999');
  assert.equal(adLabel(readWhatsAppLead({ from: '92300' })!), 'WhatsApp (no ad)');
});
