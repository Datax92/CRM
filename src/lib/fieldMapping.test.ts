import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyFieldMapping,
  parseSheetNumber,
  normalizeMapsTo,
  hasAnyMapping,
  DEAL_TARGET_KEYS,
  LEAD_TARGET_KEYS,
} from './fieldMapping.ts';

describe('numbers as spreadsheets actually write them', () => {
  test('commas, currency and trailing marks are stripped', () => {
    assert.equal(parseSheetNumber('5,000,000'), 5_000_000);
    assert.equal(parseSheetNumber('Rs 5000000'), 5_000_000);
    assert.equal(parseSheetNumber('50,00,000/-'), 5_000_000);
    assert.equal(parseSheetNumber(' 1200000 '), 1_200_000);
  });

  test('a cell with no digits is not a number', () => {
    // "TBC" in a price column must leave the field unmapped, so Deal Entry
    // asks — pre-filling a confident zero would be worse than asking.
    assert.equal(parseSheetNumber('TBC'), null);
    assert.equal(parseSheetNumber('—'), null);
    assert.equal(parseSheetNumber(''), null);
    assert.equal(parseSheetNumber(undefined), null);
  });

  test('decimals survive', () => {
    assert.equal(parseSheetNumber('1250.50'), 1250.5);
  });
});

describe('applying a folder mapping to one row', () => {
  const fields = [
    { key: 'f1', mapsTo: 'deal:totalPrice' },
    { key: 'f2', mapsTo: 'deal:downPayment' },
    { key: 'f3', mapsTo: 'kyc:cnic' },
    { key: 'f4', mapsTo: 'lead:city' },
    { key: 'f5' },
    { key: 'f6', mapsTo: null },
  ];

  test('each column lands where it was pointed', () => {
    const out = applyFieldMapping(fields, {
      f1: '5,000,000',
      f2: '1,000,000',
      f3: '35201-1234567-8',
      f4: 'Islamabad',
      f5: 'ignored',
      f6: 'ignored too',
    });

    assert.deepEqual(out.deal, { totalPrice: 5_000_000, downPayment: 1_000_000 });
    assert.deepEqual(out.kyc, { cnic: '35201-1234567-8' });
    assert.deepEqual(out.lead, { city: 'Islamabad' });
  });

  test('an empty cell is skipped, not written as an empty string', () => {
    // A KYC field nobody filled and one somebody deliberately blanked look the
    // same in Firestore, and only one of them should count as completed.
    const out = applyFieldMapping(fields, { f1: '5000000', f3: '   ', f4: '' });
    assert.deepEqual(out.kyc, {});
    assert.deepEqual(out.lead, {});
    assert.deepEqual(out.deal, { totalPrice: 5_000_000 });
  });

  test('a price cell that is not a number leaves the field unmapped', () => {
    const out = applyFieldMapping(fields, { f1: 'to be confirmed' });
    assert.deepEqual(out.deal, {});
  });

  test('a folder with no mapping produces nothing', () => {
    const out = applyFieldMapping([{ key: 'a' }, { key: 'b' }], { a: 'x', b: 'y' });
    assert.deepEqual(out, { kyc: {}, deal: {}, lead: {} });
  });
});

describe('the targets a column may point at', () => {
  test('a malformed or unknown target is dropped rather than stored', () => {
    assert.equal(normalizeMapsTo('kyc:cnic'), 'kyc:cnic');
    assert.equal(normalizeMapsTo('deal:totalPrice'), 'deal:totalPrice');
    assert.equal(normalizeMapsTo('lead:city'), 'lead:city');

    assert.equal(normalizeMapsTo('deal:nonsense'), null);
    assert.equal(normalizeMapsTo('lead:name'), null);
    assert.equal(normalizeMapsTo('nowhere:x'), null);
    assert.equal(normalizeMapsTo('kyc:'), null);
    assert.equal(normalizeMapsTo(':cnic'), null);
    assert.equal(normalizeMapsTo(''), null);
    assert.equal(normalizeMapsTo(42), null);
  });

  test('Remaining is deliberately not a target', () => {
    // It is Total Price minus Adjustment. A column filling it could contradict
    // the two fields it is derived from.
    assert.equal(normalizeMapsTo('deal:remaining'), null);
    assert.ok(!(DEAL_TARGET_KEYS as readonly string[]).includes('remaining'));
  });

  test('name and phone are not targets either', () => {
    // Every folder already nominates those through `roles`; a second way to set
    // them would be a second answer to "which column is the phone number".
    assert.equal(normalizeMapsTo('lead:phone'), null);
    assert.ok(!(LEAD_TARGET_KEYS as readonly string[]).includes('name'));
    assert.ok(!(LEAD_TARGET_KEYS as readonly string[]).includes('phone'));
  });

  test('a folder knows whether it maps anything', () => {
    assert.equal(hasAnyMapping([{ key: 'a' }]), false);
    assert.equal(hasAnyMapping([{ key: 'a', mapsTo: 'kyc:cnic' }]), true);
    // A malformed target does not count as a mapping.
    assert.equal(hasAnyMapping([{ key: 'a', mapsTo: 'nowhere:gone' }]), false);
  });
});
