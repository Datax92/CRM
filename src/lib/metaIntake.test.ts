import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveMetaSource,
  metaFolderId,
  buildMetaRecord,
  normalizeFieldData,
  META_FIELD_KEYS,
} from './metaIntake.ts';

/* -------------------------------------------------------------------------- */
/* Which folder a lead belongs in                                             */
/* -------------------------------------------------------------------------- */

test('leads from one campaign share a folder, and the campaign names it', () => {
  const a = resolveMetaSource({ leadgenId: '1', campaignId: '111', campaignName: 'Faisal Town 2' });
  const b = resolveMetaSource({ leadgenId: '2', campaignId: '111', campaignName: 'Faisal Town 2' });

  assert.equal(a.key, b.key);
  assert.equal(a.label, 'Faisal Town 2');
  assert.equal(a.basis, 'CAMPAIGN');
});

test('renaming a campaign keeps its leads in the same folder', () => {
  // The whole reason identity comes from the id: the owner renames campaigns
  // in Ads Manager, and a rename must not fork one ad's leads into two places.
  const before = resolveMetaSource({ leadgenId: '1', campaignId: '111', campaignName: 'FT2' });
  const after = resolveMetaSource({ leadgenId: '2', campaignId: '111', campaignName: 'Faisal Town 2 — September' });

  assert.equal(metaFolderId(before), metaFolderId(after));
  // …while the label follows the rename, so the folder does not read as stale.
  assert.equal(after.label, 'Faisal Town 2 — September');
});

test('two different campaigns never share a folder', () => {
  const gulf = resolveMetaSource({ leadgenId: '1', campaignId: '111', campaignName: 'Gulf' });
  const ft2 = resolveMetaSource({ leadgenId: '2', campaignId: '222', campaignName: 'Faisal Town 2' });
  assert.notEqual(metaFolderId(gulf), metaFolderId(ft2));
});

test('without a campaign it falls back to the form, then the ad', () => {
  // A caller without `ads_read` gets no campaign name at all, which is exactly
  // the position this project is in until App Review completes.
  const byForm = resolveMetaSource({ leadgenId: '1', formId: '900', formName: 'Gold Block 5 marla' });
  assert.equal(byForm.basis, 'FORM');
  assert.equal(byForm.label, 'Gold Block 5 marla');

  const byAd = resolveMetaSource({ leadgenId: '2', adId: '77', adName: 'Gulf Launch Ad' });
  assert.equal(byAd.basis, 'AD');
  assert.equal(byAd.label, 'Gulf Launch Ad');
});

test('a lead with no identifying detail still gets a home', () => {
  // Losing a contact with a real phone number because its provenance is
  // missing would be the worst outcome available.
  const s = resolveMetaSource({ leadgenId: '1' });
  assert.equal(s.basis, 'NONE');
  assert.equal(s.label, 'Meta Ads');
  assert.equal(metaFolderId(s), 'meta_meta_unknown');
});

test('folder ids are safe for Firestore and never empty', () => {
  const s = resolveMetaSource({ leadgenId: '1', campaignName: 'Faisal Town 2 — 50% off!! (Sept)' });
  const id = metaFolderId(s);
  assert.match(id, /^[a-z0-9_]+$/);
  assert.ok(id.length > 4 && id.length <= 120);
});

/* -------------------------------------------------------------------------- */
/* The row itself                                                             */
/* -------------------------------------------------------------------------- */

test('the eight fixed columns are always present, blank when unknown', () => {
  const { values } = buildMetaRecord({ leadgenId: '1', name: 'Ali Raza', phone: '0300 1234567' });
  assert.equal(values[META_FIELD_KEYS.name], 'Ali Raza');
  assert.equal(values[META_FIELD_KEYS.phone], '0300 1234567');
  assert.equal(values[META_FIELD_KEYS.email], '');
  assert.equal(values[META_FIELD_KEYS.campaign], '');
});

test('extra form questions become their own columns, never overwriting a fixed one', () => {
  const { values, extraFields } = buildMetaRecord({
    leadgenId: '1',
    name: 'Ali',
    extras: { 'Which project?': 'Gulf', 'Budget range': '50-80 lakh', '': 'ignored', 'Blank answer': '' },
  });

  assert.equal(values['x_which_project'], 'Gulf');
  assert.equal(values['x_budget_range'], '50-80 lakh');
  assert.equal(extraFields.length, 2, 'a nameless question and a blank answer are both dropped');
  // The fixed keys are untouched.
  assert.equal(values[META_FIELD_KEYS.name], 'Ali');
});

/* -------------------------------------------------------------------------- */
/* Meta's own answer format                                                   */
/* -------------------------------------------------------------------------- */

test("Meta's field_data is mapped onto the right columns", () => {
  const out = normalizeFieldData([
    { name: 'full_name', values: ['Imran Khan'] },
    { name: 'phone_number', values: ['+92 300 1234567'] },
    { name: 'email', values: ['imran@example.com'] },
    { name: 'city', values: ['Islamabad'] },
    { name: 'which_project', values: ['Faisal Town 2'] },
  ]);

  assert.equal(out.name, 'Imran Khan');
  assert.equal(out.phone, '+92 300 1234567');
  assert.equal(out.email, 'imran@example.com');
  assert.equal(out.city, 'Islamabad');
  assert.deepEqual(out.extras, { which_project: 'Faisal Town 2' });
});

test('a form asking for first and last name separately still yields one name', () => {
  const out = normalizeFieldData([
    { name: 'first_name', values: ['Sana'] },
    { name: 'last_name', values: ['Khan'] },
  ]);
  assert.equal(out.name, 'Sana Khan');
  // And neither half is left lying around as an anonymous extra.
  assert.deepEqual(out.extras, {});
});

test('empty answers and junk entries are skipped, not stored as blanks', () => {
  const out = normalizeFieldData([
    { name: 'full_name', values: [''] },
    { name: '', values: ['orphan'] },
    { name: 'phone_number', values: ['0300 9999999'] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    null as any,
  ]);
  assert.equal(out.name, '');
  assert.equal(out.phone, '0300 9999999');
  assert.deepEqual(out.extras, {});
});
