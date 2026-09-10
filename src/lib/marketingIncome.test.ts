import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateMarketingSplit,
  emptyCut,
  parsePercent,
  amountForPercent,
  readCuts,
  type MarketingCut,
} from './marketingIncome.ts';

const cut = (patch: Partial<MarketingCut> = {}): MarketingCut => ({
  uid: 'u1', name: 'Hussain', role: 'STAFF', percent: 0, ...patch,
});

/* -------------------------------------------------------------------------- */
/* Percentages in, rupees out                                                  */
/* -------------------------------------------------------------------------- */

test('a percentage becomes rupees, and the rupees are never typed', () => {
  const split = calculateMarketingSplit(250_000, [cut({ percent: 8 })]);
  assert.equal(split.lines[0].amount, 20_000);
  assert.equal(split.totalCost, 20_000);
});

test('two recipients, one of them a manager', () => {
  // The owner's ask: "i can add another manager as well".
  const split = calculateMarketingSplit(250_000, [
    cut({ percent: 8 }),
    cut({ uid: 'm1', name: 'Tayyab', role: 'MANAGER', percent: 4 }),
  ]);
  assert.deepEqual(split.lines.map((l) => l.amount), [20_000, 10_000]);
  assert.equal(split.totalPercent, 12);
  assert.equal(split.totalCost, 30_000);
});

test('everything left is the company\'s, and it has no percentage box', () => {
  const split = calculateMarketingSplit(250_000, [cut({ percent: 8 }), cut({ uid: 'm1', name: 'T', role: 'MANAGER', percent: 4 })]);
  assert.equal(split.companyKeeps, 220_000);
  assert.equal(split.companyPercent, 88);
  // The cuts and the company's share are the whole sale, exactly.
  assert.equal(split.totalCost + split.companyKeeps, 250_000);
});

test('no cuts at all leaves the whole sale with the company', () => {
  const split = calculateMarketingSplit(250_000, []);
  assert.equal(split.companyKeeps, 250_000);
  assert.equal(split.companyPercent, 100);
  assert.equal(split.valid, true);
});

test('100% allocated leaves the company nothing, and is still valid', () => {
  // Giving the whole sale away is a decision, not an error.
  const split = calculateMarketingSplit(100_000, [cut({ percent: 100 })]);
  assert.equal(split.companyKeeps, 0);
  assert.equal(split.valid, true);
});

/* -------------------------------------------------------------------------- */
/* What is refused                                                             */
/* -------------------------------------------------------------------------- */

test('over-allocation is refused, never trimmed', () => {
  // Trimming would pay somebody an amount nobody agreed to.
  const split = calculateMarketingSplit(100_000, [cut({ percent: 60 }), cut({ uid: 'u2', name: 'B', percent: 60 })]);
  assert.equal(split.valid, false);
  assert.match(split.errors[0], /more than the whole sale/);
  assert.equal(split.lines[0].amount, 60_000);
});

test('a percentage with nobody behind it is an error, not a silent zero', () => {
  const split = calculateMarketingSplit(100_000, [cut({ uid: null, name: null, percent: 5 })]);
  assert.equal(split.valid, false);
  assert.match(split.errors[0], /needs somebody/);
});

test('an empty row is not an error — it is a row somebody has not filled in', () => {
  assert.equal(calculateMarketingSplit(100_000, [emptyCut()]).valid, true);
});

test('the same person twice is refused', () => {
  const split = calculateMarketingSplit(100_000, [cut({ percent: 5 }), cut({ percent: 5 })]);
  assert.equal(split.valid, false);
  assert.match(split.errors.join(' '), /appears twice/);
});

test('no amount is an error, and does not produce NaN anywhere', () => {
  const split = calculateMarketingSplit(0, [cut({ percent: 8 })]);
  assert.equal(split.valid, false);
  assert.equal(split.lines[0].amount, 0);
  assert.equal(split.companyKeeps, 0);
});

/* -------------------------------------------------------------------------- */
/* Typing                                                                      */
/* -------------------------------------------------------------------------- */

test('a blank percentage is zero, never NaN', () => {
  // NaN propagating into the totals would blank the whole panel mid-edit.
  assert.equal(parsePercent(''), 0);
  assert.equal(parsePercent(null), 0);
  assert.equal(parsePercent('nonsense'), 0);
  assert.equal(parsePercent(-5), 0);
});

test('a percentage is capped at 100 and rounded to two decimals', () => {
  assert.equal(parsePercent(250), 100);
  assert.equal(parsePercent('2.5%'), 2.5);
  assert.equal(parsePercent('2.567'), 2.57);
});

test('amountForPercent survives junk rather than poisoning a total', () => {
  assert.equal(amountForPercent(Number.NaN, 10), 0);
  assert.equal(amountForPercent(100, Number.NaN), 0);
});

/* -------------------------------------------------------------------------- */
/* The old shape                                                               */
/* -------------------------------------------------------------------------- */

test('a record in the old three-figure shape reads as percentages', () => {
  // No migration: the stored rupees are converted back to a share of the sale.
  const cuts = readCuts({
    amountReceived: 250_000,
    staffCommission: 20_000, staffUid: 'u1', staffName: 'Hussain',
    teamCommission: 10_000, teamUid: 'm1', teamName: 'Tayyab',
    companyCommission: 5_000,
  });
  assert.deepEqual(cuts.map((c) => [c.name, c.role, c.percent]), [
    ['Hussain', 'STAFF', 8],
    ['Tayyab', 'MANAGER', 4],
  ]);
});

test('the old company figure is dropped, because the company is not a recipient', () => {
  const cuts = readCuts({ amountReceived: 100_000, companyCommission: 5_000 });
  assert.equal(cuts.length, 0);
  // And it therefore comes back as part of what the company keeps.
  assert.equal(calculateMarketingSplit(100_000, cuts).companyKeeps, 100_000);
});

test('a new-shape record reads its own cuts back unchanged', () => {
  const cuts = readCuts({ cuts: [{ uid: 'u1', name: 'A', role: 'MANAGER', percent: 3.5 }] });
  assert.deepEqual(cuts, [{ uid: 'u1', name: 'A', role: 'MANAGER', percent: 3.5 }]);
});
