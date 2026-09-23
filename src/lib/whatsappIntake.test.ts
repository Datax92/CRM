import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readWhatsAppLead,
  cameFromAnAd,
  whatsappNotes,
  adLabel,
  whatsappSource,
  splitCloudApiMessages,
} from './whatsappIntake.ts';
import { resolveMetaSource, metaFolderId } from './metaIntake.ts';

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

test('an ad resolved to its campaign files under the campaign', () => {
  // The owner reads "Faisal Town 2" as one folder, however many ads it runs.
  const lead = readWhatsAppLead(cloudApiBody)!;
  const source = whatsappSource(lead, {
    campaignId: '120200000001',
    campaignName: 'Faisal Town 2',
    adsetName: 'Lahore 25-45',
    adName: 'FT2 video 3',
  });
  const folder = resolveMetaSource({ leadgenId: 'wamid.HBg', ...source });
  assert.equal(folder.basis, 'CAMPAIGN');
  assert.equal(folder.label, 'Faisal Town 2');
  assert.equal(metaFolderId(folder), 'meta_campaign_120200000001');
});

test('two ads in one campaign share a folder, and so does a form lead from it', () => {
  const campaign = { campaignId: '120200000001', campaignName: 'Faisal Town 2', adsetName: null };
  const first = resolveMetaSource({
    leadgenId: 'a',
    ...whatsappSource(readWhatsAppLead({ from: '92300', ad_id: '111', ad_headline: 'Plots from 25 lakh' })!, { ...campaign, adName: 'A' }),
  });
  const second = resolveMetaSource({
    leadgenId: 'b',
    ...whatsappSource(readWhatsAppLead({ from: '92301', ad_id: '222', ad_headline: 'Book today' })!, { ...campaign, adName: 'B' }),
  });
  // A lead-form ad in the same campaign, as the Meta webhook files it.
  const form = resolveMetaSource({ leadgenId: 'c', campaignId: '120200000001', campaignName: 'Faisal Town 2', formId: '9' });
  assert.equal(metaFolderId(first), metaFolderId(second));
  assert.equal(metaFolderId(first), metaFolderId(form));
});

test('a campaign that cannot be looked up falls back to one folder per ad, never to no lead', () => {
  // A token without ads_read, or a Graph timeout: the lead is still filed.
  const lead = readWhatsAppLead(cloudApiBody)!;
  const nothing = { campaignId: null, campaignName: null, adsetName: null, adName: null };
  const folder = resolveMetaSource({ leadgenId: 'wamid.HBg', ...whatsappSource(lead, nothing) });
  assert.equal(folder.basis, 'AD');
  assert.equal(folder.label, 'FASAL TOWN 2 – Pakistan');
  assert.equal(metaFolderId(folder), 'meta_ad_120212345');
});

test('a message typed straight to the number is not from an ad', () => {
  // The number is the business's everyday WhatsApp; only ad taps are leads.
  assert.equal(cameFromAnAd(readWhatsAppLead({ from: '923001234567', name: 'Supplier', text: 'Invoice attached' })!), false);
  // Empty strings from an unmapped field must not read as an ad.
  assert.equal(cameFromAnAd(readWhatsAppLead({ phone: '923001234567', ad_id: '', ad_headline: '' })!), false);
  // A headline alone is not proof: Meta always sends an id, a URL or a click id with a real referral.
  assert.equal(cameFromAnAd(readWhatsAppLead({ phone: '923001234567', ad_headline: 'Faisal Town 2' })!), false);
  assert.equal(cameFromAnAd(readWhatsAppLead({ phone: '923001234567', ad_id: '120212345' })!), true);
});

/** A Click-to-WhatsApp first message as Meta's Cloud API webhook delivers it. */
const cloudValue = {
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '923111555426', phone_number_id: '111' },
  contacts: [{ profile: { name: 'Awais Khan' }, wa_id: '923001234567' }],
  messages: [
    {
      from: '923001234567',
      id: 'wamid.ABC',
      timestamp: '1758620000',
      type: 'text',
      text: { body: 'Price?' },
      referral: {
        source_url: 'https://fb.me/x',
        source_id: '120251649751890457',
        source_type: 'ad',
        headline: 'Faisal Town 2',
        ctwa_clid: 'clid1',
      },
    },
  ],
};

test('a direct Cloud API message reads as the same lead the Make bridge would file', () => {
  const [body] = splitCloudApiMessages(cloudValue);
  const lead = readWhatsAppLead(body);
  assert.equal(lead?.phone, '923001234567');
  assert.equal(lead?.name, 'Awais Khan');
  assert.equal(lead?.messageId, 'wamid.ABC');
  assert.equal(lead?.message, 'Price?');
  assert.equal(lead?.adId, '120251649751890457');
  assert.equal(lead && cameFromAnAd(lead), true);
});

test('delivery and read receipts are not messages and file nothing', () => {
  assert.deepEqual(
    splitCloudApiMessages({ statuses: [{ id: 'wamid.X', status: 'read', recipient_id: '923001234567' }] }),
    []
  );
  assert.deepEqual(splitCloudApiMessages({}), []);
});

test('a batch pairs each message with its own sender', () => {
  const bodies = splitCloudApiMessages({
    contacts: [
      { profile: { name: 'A' }, wa_id: '1' },
      { profile: { name: 'B' }, wa_id: '2' },
    ],
    messages: [
      { from: '2', id: 'm2', text: { body: 'hi' } },
      { from: '1', id: 'm1', text: { body: 'hello' } },
    ],
  });
  assert.deepEqual(bodies.map((body) => readWhatsAppLead(body)?.name), ['B', 'A']);
});
