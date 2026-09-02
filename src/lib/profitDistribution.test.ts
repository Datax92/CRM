import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDistribution,
  parsePercentage,
  amountForPercentage,
  type DistributionShare,
} from './profitDistribution.ts';

const shares = (...percentages: number[]): DistributionShare[] => {
  const kinds: DistributionShare['kind'][] = ['EMPLOYEE', 'OWN_SUBADMIN', 'OTHER_SUBADMIN', 'COMPANY_BASE'];
  const roles: DistributionShare['recipientRole'][] = ['employee', 'subadmin', 'subadmin', 'company'];

  return percentages.map((percentage, index) => ({
    recipientUid: roles[index] === 'company' ? null : `uid-${index}`,
    recipientName: `Recipient ${index}`,
    recipientRole: roles[index],
    kind: kinds[index],
    percentage,
  }));
};

test("the owner's worked example, to the rupee", () => {
  // Net 100,000 — employee 2%, own sub admin 2%, other sub admin 1%, company 4%.
  const result = calculateDistribution(100_000, shares(2, 2, 1, 4));

  assert.deepEqual(
    result.lines.map((line) => line.amount),
    [2_000, 2_000, 1_000, 4_000]
  );
  assert.equal(result.distributedPercentage, 9);
  assert.equal(result.distributedAmount, 9_000);
  assert.equal(result.remainingPercentage, 91);
  assert.equal(result.remainingAmount, 91_000);
  assert.equal(result.companyBaseAmount, 4_000);
  assert.equal(result.companyTotalAmount, 95_000);
  assert.equal(result.valid, true);
});

test('the company total separates its base share from the remainder', () => {
  const result = calculateDistribution(100_000, shares(2, 2, 1, 4));

  // Both numbers are reported, because they mean different things: one was
  // chosen, the other is what nobody was allocated.
  assert.equal(result.companyBaseAmount, 4_000);
  assert.equal(result.companyTotalAmount - result.companyBaseAmount, result.remainingAmount);
});

test('over-allocation is refused rather than clamped', () => {
  const result = calculateDistribution(100_000, shares(50, 40, 10, 10));

  assert.equal(result.distributedPercentage, 110);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /110%/);
  // Nothing is silently reduced to fit — the entered figures survive so the
  // admin can see which one to change.
  assert.deepEqual(result.lines.map((line) => line.percentage), [50, 40, 10, 10]);
});

test('exactly 100% is allowed and leaves nothing over', () => {
  const result = calculateDistribution(100_000, shares(40, 30, 20, 10));

  assert.equal(result.valid, true);
  assert.equal(result.remainingPercentage, 0);
  assert.equal(result.remainingAmount, 0);
  assert.equal(result.companyTotalAmount, 10_000);
});

test('the remaining amount is never negative in a valid result', () => {
  for (const split of [[0, 0, 0, 0], [1, 1, 1, 1], [25, 25, 25, 25]]) {
    const result = calculateDistribution(250_000, shares(...split));
    assert.equal(result.valid, true);
    assert.ok(result.remainingAmount >= 0, JSON.stringify(split));
  }
});

test('a deal with no profit cannot be distributed', () => {
  const result = calculateDistribution(0, shares(2, 2, 0, 4));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /no profit/i);
});

test('a person-shaped line with no account selected is rejected', () => {
  const withoutUid = shares(2, 0, 0, 4);
  withoutUid[0].recipientUid = null;

  const result = calculateDistribution(100_000, withoutUid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /no account selected/i);
});

test('the company line needs no account', () => {
  const result = calculateDistribution(100_000, shares(2, 2, 0, 4));
  assert.equal(result.valid, true);
});

test('percentages parse the way a text input actually behaves', () => {
  assert.equal(parsePercentage(''), 0, 'a cleared box is no share, not NaN');
  assert.equal(parsePercentage(null), 0);
  assert.equal(parsePercentage('2'), 2);
  assert.equal(parsePercentage('2.5%'), 2.5);
  assert.equal(parsePercentage('-5'), 0, 'negatives cannot pay someone backwards');
  assert.equal(parsePercentage('250'), 100, 'capped at the whole profit');
  assert.equal(parsePercentage('abc'), 0);
});

test('amounts round to the rupee and stay consistent with their percentage', () => {
  assert.equal(amountForPercentage(100_000, 2.5), 2_500);
  assert.equal(amountForPercentage(33_333, 3), 999.99);
  assert.equal(amountForPercentage(0, 50), 0);
});

test('a fractional split still adds up to the profit', () => {
  const result = calculateDistribution(99_999, shares(2.5, 1.25, 0.25, 4));
  const total = result.distributedAmount + result.remainingAmount;
  assert.ok(Math.abs(total - result.netProfit) < 0.01);
});
