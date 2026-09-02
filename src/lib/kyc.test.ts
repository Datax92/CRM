import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateKyc,
  leadPatchFromKyc,
  dealCustomerFromKyc,
  formatCnic,
  cnicDigits,
  kycCompleteness,
  KYC_SYNCED_FIELDS,
  KYC_FIELDS,
  KYC_SECTIONS,
} from './kyc.ts';

import { describeLeadSource, leadSourceDetail } from './leadSource.ts';

test('nothing is required — a partial KYC saves', () => {
  const { errors, values } = validateKyc({ name: 'Aroosa Abbas' });
  assert.deepEqual(errors, []);
  assert.equal(values.name, 'Aroosa Abbas');
});

test('a nameless KYC saves too', () => {
  // A rep opens this mid-call and fills in what they have. Requiring anything
  // pushes people back to not filling it in at all, which is the state the
  // feature exists to end.
  const { errors, values } = validateKyc({ phone: '03001234567' });
  assert.deepEqual(errors, []);
  assert.equal(values.phone, '03001234567');
});

test('a completely empty KYC is a valid save, not an error', () => {
  const { errors, values } = validateKyc({});
  assert.deepEqual(errors, []);
  assert.deepEqual(values, {});
});

test('the new commercial fields are collected', () => {
  const { values, errors } = validateKyc({
    project: 'Capital Smart City',
    interest: '5 Marla',
    investment: '2,500,000',
    budget: '4,000,000',
    trust: 'High — referred by an existing client',
    country: 'UAE',
  });

  assert.deepEqual(errors, []);
  assert.equal(values.project, 'Capital Smart City');
  assert.equal(values.interest, '5 Marla');
  assert.equal(values.investment, '2,500,000');
  assert.equal(values.budget, '4,000,000');
  assert.equal(values.trust, 'High — referred by an existing client');
  assert.equal(values.country, 'UAE');
});

test('no field is marked required, on any surface', () => {
  // The forms read this list to decide what to mark with an asterisk, so the
  // guarantee lives here rather than in a component.
  for (const field of KYC_FIELDS) {
    assert.equal((field as { required?: boolean }).required, undefined, field.key);
  }
});

test('the field list has no duplicate keys', () => {
  const keys = KYC_FIELDS.map((field) => field.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('every field appears in exactly one section', () => {
  const placed = KYC_SECTIONS.flatMap((section) => section.keys);
  assert.equal(new Set(placed).size, placed.length, 'a field is in two sections');
  for (const field of KYC_FIELDS) {
    assert.ok(placed.includes(field.key), `${field.key} is not on the form`);
  }
});

test('a CNIC is normalised to 5-7-1 and checked for length', () => {
  assert.equal(validateKyc({ name: 'A B', cnic: '3520112345678' }).values.cnic, '35201-1234567-8');
  assert.match(validateKyc({ name: 'A B', cnic: '3520112' }).errors[0], /13 digits/);
});

test('CNIC comparison ignores the dashes', () => {
  assert.equal(cnicDigits('35201-1234567-8'), cnicDigits('3520112345678'));
  assert.equal(formatCnic('not a cnic'), 'not a cnic', 'unparseable input survives rather than vanishing');
});

test('a bad email is caught, a good one passes', () => {
  assert.match(validateKyc({ name: 'A B', email: 'nope' }).errors[0], /email/i);
  assert.deepEqual(validateKyc({ name: 'A B', email: 'a@b.co' }).errors, []);
});

test('unknown keys are dropped rather than written to the document', () => {
  const { values } = validateKyc({ name: 'A B', injected: 'x' } as Record<string, string>);
  assert.equal(values.injected, undefined);
});

test('the lead patch carries exactly the four mirrored columns', () => {
  assert.deepEqual(
    KYC_SYNCED_FIELDS.map((field) => field.syncsTo),
    ['name', 'phone', 'email', 'city']
  );

  const patch = leadPatchFromKyc({
    name: 'Aroosa Abbas',
    phone: '03001234567',
    email: 'client@example.com',
    city: 'Islamabad',
    cnic: '35201-1234567-8',
  });

  assert.deepEqual(patch, {
    name: 'Aroosa Abbas',
    phone: '03001234567',
    email: 'client@example.com',
    city: 'Islamabad',
  });
});

test('an empty KYC value never wipes what the lead already has', () => {
  assert.deepEqual(leadPatchFromKyc({ name: 'A B', email: '' }), { name: 'A B' });
});

test('deal entry takes KYC first and falls back to the lead', () => {
  const customer = dealCustomerFromKyc(
    { name: 'Aroosa Abbas', cnic: '35201-1234567-8', address: 'Street 4' },
    { name: 'aroosa', phone: '03001234567', email: 'old@example.com', city: 'Lahore' }
  );

  assert.equal(customer.name, 'Aroosa Abbas', 'the confirmed name wins');
  assert.equal(customer.cnic, '35201-1234567-8', 'nobody types the CNIC twice');
  assert.equal(customer.phone, '03001234567', 'the lead fills the gap');
  assert.equal(customer.city, 'Lahore');
});

test('deal entry works with no KYC at all', () => {
  const customer = dealCustomerFromKyc(null, { name: 'Walk-in', phone: '0300' });
  assert.equal(customer.name, 'Walk-in');
  assert.equal(customer.cnic, '');
});

test('completeness counts filled fields, not keys present', () => {
  const { filled, total } = kycCompleteness({ name: 'A B', city: '   ', cnic: '35201-1234567-8' });
  assert.equal(filled, 2);
  assert.ok(total > filled);
});

test('a Data Bank lead names the folder it came from', () => {
  assert.equal(
    describeLeadSource({ source: 'DATA_BANK', dataBankFolderName: 'Facile Town 2' }),
    'Data Bank (Facile Town 2)'
  );
});

test('a manual lead has no bracket, because there is no finer origin', () => {
  assert.equal(describeLeadSource({ source: 'MANUAL' }), 'Manual Entry');
});

test('a Meta lead names its campaign', () => {
  assert.equal(
    describeLeadSource({ source: 'META_ADS', campaignName: 'Ramadan Offer' }),
    'Meta Ads (Ramadan Offer)'
  );
});

test('a promoted row with no recorded folder name still says which folder', () => {
  const detail = leadSourceDetail({ source: 'DATA_BANK', dataBankFolderId: 'abcdef123456' });
  assert.match(detail ?? '', /abcdef/);
});

test('an unknown source token is shown, not hidden behind "Other"', () => {
  assert.equal(describeLeadSource({ source: 'TIKTOK_ADS' }), 'Tiktok Ads');
  assert.equal(describeLeadSource({ source: '' }), 'Unknown');
});
