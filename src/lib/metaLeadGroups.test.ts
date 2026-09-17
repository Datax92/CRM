import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupMetaLeads,
  isMetaLead,
  metaBasisOf,
  metaFolderOf,
  UNKNOWN_META_FOLDER,
} from './metaLeadGroups.ts';

const FT2 = 'meta_campaign_120251649751890457';

const lead = (over: Record<string, unknown>) =>
  ({ id: String(Math.random()), ...over }) as { id: string; at?: number } & Record<string, unknown>;

test('a lead from an ad, and a lead added by hand into an ad folder, both belong', () => {
  // The admin's folder counts both, so the employee's card must too.
  assert.equal(isMetaLead(lead({ source: 'META_ADS', dataBankFolderId: FT2 })), true);
  assert.equal(isMetaLead(lead({ source: 'DATA_BANK', dataBankFolderId: FT2 })), true);
  // An ordinary Data Bank lead does not.
  assert.equal(isMetaLead(lead({ source: 'DATA_BANK', dataBankFolderId: 'abc123' })), false);
  assert.equal(isMetaLead(lead({ source: 'MANUAL_ENTRY' })), false);
});

test('the basis is read off the folder id the intake wrote', () => {
  assert.equal(metaBasisOf(FT2), 'CAMPAIGN');
  assert.equal(metaBasisOf('meta_form_164549619699490'), 'FORM');
  assert.equal(metaBasisOf('meta_ad_120212345'), 'AD');
  assert.equal(metaBasisOf(UNKNOWN_META_FOLDER), 'NONE');
});

test('a Meta lead with no folder is grouped under the same fallback the intake uses', () => {
  assert.equal(metaFolderOf(lead({ source: 'META_ADS' })), UNKNOWN_META_FOLDER);
});

test('one card per folder, counting waiting apart from taken, newest folder first', () => {
  const leads = [
    lead({ source: 'META_ADS', dataBankFolderId: FT2, dataBankFolderName: 'FASAL TOWN 2 – Pakistan', status: 'ASSIGNED', at: 300 }),
    lead({ source: 'META_ADS', dataBankFolderId: FT2, dataBankFolderName: 'FASAL TOWN 2 – Pakistan', status: 'ACCEPTED', at: 100 }),
    lead({ source: 'DATA_BANK', dataBankFolderId: FT2, dataBankFolderName: 'FASAL TOWN 2 – Pakistan', status: 'ACCEPTED', at: 200 }),
    lead({ source: 'META_ADS', dataBankFolderId: 'meta_ad_9', campaignName: 'Faisal Hills', status: 'CLOSED_LOST', at: 50 }),
    lead({ source: 'MANUAL_ENTRY', status: 'ACCEPTED', at: 999 }),
  ];
  const groups = groupMetaLeads(leads, (l) => l.at ?? null);
  assert.equal(groups.length, 2, 'the manual lead is not on the screen');
  assert.deepEqual(groups[0], {
    folderId: FT2,
    name: 'FASAL TOWN 2 – Pakistan',
    basis: 'CAMPAIGN',
    waiting: 1,
    taken: 2,
    total: 3,
    lastLeadAt: 300,
  });
  assert.equal(groups[1].name, 'Faisal Hills', 'falls back to the campaign name');
  assert.equal(groups[1].basis, 'AD');
});

test('a folder with no name and no dates still renders, rather than a blank card', () => {
  const [group] = groupMetaLeads([lead({ source: 'META_ADS' })], () => null);
  assert.equal(group.name, 'Meta Ads');
  assert.equal(group.lastLeadAt, null);
});
