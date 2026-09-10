import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDistribution,
  parsePercentage,
  amountForPercentage,
  type DistributionShare,
} from './profitDistribution.ts';

/*
 * Splitting a deal, under the rule that the percentage multiplies one number
 * and the money leaves another.
 *
 * Every figure below is one of the owner's own worked examples. The pairs are
 * (Cut base, payment source):
 *
 *   Down Payment / Confirmation  50 lakh total, 10 lakh adjustment → (50L, 40L)
 *   Installments                 10 lakh received, 7 lakh payable  → (10L, 3L)
 *   Lump Sum                     40 lakh to builder, 4 lakh comm.  → (40L, 4L)
 */

const LAKH = 100_000;

/** Employee, own sub admin, other sub admin — there is no company share. */
const shares = (...percentages: number[]): DistributionShare[] => {
  const kinds: DistributionShare['kind'][] = ['EMPLOYEE', 'OWN_SUBADMIN', 'OTHER_SUBADMIN'];
  const roles: DistributionShare['recipientRole'][] = ['employee', 'subadmin', 'subadmin'];

  return percentages.map((percentage, index) => ({
    recipientUid: `uid-${index}`,
    recipientName: `Recipient ${index}`,
    recipientRole: roles[index],
    kind: kinds[index],
    percentage,
  }));
};

/* -------------------------------------------------------------------------- */
/* The four worked examples                                                    */
/* -------------------------------------------------------------------------- */

test('Down Payment: 1% of the 50 lakh total is 50,000, out of the 40 lakh remaining', () => {
  const result = calculateDistribution({ cutBase: 50 * LAKH, payoutSource: 40 * LAKH }, shares(1));

  // The number the owner specified, and the number the old single-base rule
  // got wrong: it multiplied the 40 lakh remaining and produced 40,000.
  assert.equal(result.lines[0].amount, 50_000);
  assert.equal(result.distributedAmount, 50_000);
  // Paid out of Remaining, not out of the base.
  assert.equal(result.companyRetained, 40 * LAKH - 50_000);
  assert.equal(result.valid, true);
});

test('Confirmation splits identically to Down Payment — same base, same source', () => {
  const down = calculateDistribution({ cutBase: 50 * LAKH, payoutSource: 40 * LAKH }, shares(1));
  const confirmation = calculateDistribution({ cutBase: 50 * LAKH, payoutSource: 40 * LAKH }, shares(1));
  assert.deepEqual(confirmation.lines.map((l) => l.amount), down.lines.map((l) => l.amount));
  assert.equal(confirmation.companyRetained, down.companyRetained);
});

test('Installments: 1% of the 10 lakh received is 10,000, out of the 3 lakh remaining', () => {
  const result = calculateDistribution({ cutBase: 10 * LAKH, payoutSource: 3 * LAKH }, shares(1));

  assert.equal(result.lines[0].amount, 10_000);
  assert.equal(result.companyRetained, 3 * LAKH - 10_000);
  assert.equal(result.valid, true);
});

test('Lump Sum: 1% of the 40 lakh the client paid, out of the 4 lakh commission', () => {
  const result = calculateDistribution({ cutBase: 40 * LAKH, payoutSource: 4 * LAKH }, shares(1));

  // Emphatically NOT 1% of the commission, which would be 4,000.
  assert.equal(result.lines[0].amount, 40_000);
  // The owner's stated outcome: 4 lakh − 40,000 = 3.6 lakh retained.
  assert.equal(result.companyRetained, 360_000);
  assert.equal(result.valid, true);
});

/* -------------------------------------------------------------------------- */
/* The base and the source are never confused                                  */
/* -------------------------------------------------------------------------- */

test('the amount depends on the base alone — the source does not change it', () => {
  const wide = calculateDistribution({ cutBase: 50 * LAKH, payoutSource: 40 * LAKH }, shares(2));
  const narrow = calculateDistribution({ cutBase: 50 * LAKH, payoutSource: 5 * LAKH }, shares(2));
  assert.equal(wide.lines[0].amount, narrow.lines[0].amount);
  assert.equal(wide.lines[0].amount, 100_000);
  // Only what is left over differs.
  assert.equal(wide.companyRetained, 40 * LAKH - 100_000);
  assert.equal(narrow.companyRetained, 5 * LAKH - 100_000);
});

test('the company keeps the source minus the cuts, and takes no percentage of its own', () => {
  const result = calculateDistribution({ cutBase: 10 * LAKH, payoutSource: 3 * LAKH }, shares(2, 2, 1));

  assert.equal(result.distributedAmount, 20_000 + 20_000 + 10_000);
  assert.equal(result.companyRetained, 3 * LAKH - 50_000);
  // Nothing named the company: it is not a recipient, it is what is left.
  assert.equal(result.lines.some((line) => line.recipientRole === 'company'), false);
});

/* -------------------------------------------------------------------------- */
/* Over-allocation                                                             */
/* -------------------------------------------------------------------------- */

test('cuts exceeding the payment source are refused, at well under 100%', () => {
  // 10% of a 40 lakh base is 4 lakh — the entire commission — so 11% overdraws
  // it while every individual share still looks modest.
  const result = calculateDistribution({ cutBase: 40 * LAKH, payoutSource: 4 * LAKH }, shares(6, 5));

  assert.equal(result.valid, false);
  assert.match(result.errors[0], /more than the Rs 400,000 available/);
  // A percentage test would have let this through: 11% is far below 100.
  assert.equal(result.distributedPercentage, 11);
});

test('cuts are refused, never quietly reduced to fit', () => {
  const result = calculateDistribution({ cutBase: 40 * LAKH, payoutSource: 4 * LAKH }, shares(6, 5));
  // The amounts are still exactly what the admin asked for.
  assert.deepEqual(result.lines.map((l) => l.amount), [240_000, 200_000]);
});

test('a split that exactly empties the source is allowed', () => {
  const result = calculateDistribution({ cutBase: 40 * LAKH, payoutSource: 4 * LAKH }, shares(10));
  assert.equal(result.distributedAmount, 4 * LAKH);
  assert.equal(result.companyRetained, 0);
  assert.equal(result.valid, true);
});

test('the share of the pot actually used is reported, because it surprises', () => {
  // 1% of the base is 1.25% of the source once an adjustment has shrunk it.
  const result = calculateDistribution({ cutBase: 50 * LAKH, payoutSource: 40 * LAKH }, shares(1));
  assert.equal(result.sourceUsedPercentage, 1.25);
});

/* -------------------------------------------------------------------------- */
/* Nothing to split                                                            */
/* -------------------------------------------------------------------------- */

test('a deal with no pot cannot be split', () => {
  const result = calculateDistribution({ cutBase: 10 * LAKH, payoutSource: 0 }, shares(1));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /nothing left on this deal/);
});

test('a loss-making legacy deal cannot be split either', () => {
  // One real deal in the project: 500,000 received against 600,000 payable.
  const result = calculateDistribution({ cutBase: 500_000, payoutSource: -100_000 }, shares(1));
  assert.equal(result.valid, false);
});

test('a deal with no base cannot be split', () => {
  const result = calculateDistribution({ cutBase: 0, payoutSource: 3 * LAKH }, shares(1));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /nothing to calculate a cut from/);
});

test('a recipient with no account selected is refused', () => {
  const withoutUid = shares(2).map((share) => ({ ...share, recipientUid: null }));
  const result = calculateDistribution({ cutBase: 10 * LAKH, payoutSource: 3 * LAKH }, withoutUid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /no account selected/);
});

/* -------------------------------------------------------------------------- */
/* Arithmetic                                                                  */
/* -------------------------------------------------------------------------- */

test('percentages parse from whatever the box produced', () => {
  assert.equal(parsePercentage(''), 0);
  assert.equal(parsePercentage(null), 0);
  assert.equal(parsePercentage('2.5%'), 2.5);
  assert.equal(parsePercentage('-3'), 0);
  assert.equal(parsePercentage('900'), 100);
  assert.equal(parsePercentage('abc'), 0);
});

test('amounts round to the paisa and never drift', () => {
  assert.equal(amountForPercentage(99_999, 2.5), 2_499.98);
  const result = calculateDistribution({ cutBase: 99_999, payoutSource: 99_999 }, shares(2.5, 1.25, 0.25));
  const summed = result.lines.reduce((total, line) => total + line.amount, 0);
  assert.equal(result.distributedAmount, Math.round(summed * 100) / 100);
  assert.equal(result.companyRetained, Math.round((99_999 - result.distributedAmount) * 100) / 100);
});
