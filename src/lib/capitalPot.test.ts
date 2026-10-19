import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isContribution, isDirectSpending, isLentOut, potCash, type PotRow } from './capitalPot.ts';

const row = (over: Partial<PotRow>): PotRow => ({
  direction: 'OUT',
  amount: 0,
  sourceModule: 'MANUAL',
  groupId: null,
  reversalOf: null,
  status: 'POSTED',
  ...over,
});

/**
 * UBL CC's statement as it stood on 2026-10-17 (live, read-only), grouped:
 * the card's 950,000 limit put in, four small manual top-ups, three Investment
 * with X rounds out (two back), the 249,000 shortfall, and ten personal
 * expenses paid then reversed on 2026-10-12. The account held 66,000.
 */
const personal = [1000, 321, 1580, 5565, 16000, 1025, 1850, 1500, 5280, 9000];
const ubl: PotRow[] = [
  row({ direction: 'IN', amount: 950_000 }),
  ...[500, 27_000, 16_500, 6_000].map((amount) => row({ direction: 'IN', amount })),
  row({ amount: 330_000, sourceModule: 'INVESTMENT_WITH_X', groupId: 'invx_a' }),
  row({ direction: 'IN', amount: 330_000, sourceModule: 'INVESTMENT_WITH_X', groupId: 'invx_a' }),
  row({ amount: 330_000, sourceModule: 'INVESTMENT_WITH_X', groupId: 'invx_b' }),
  row({ direction: 'IN', amount: 330_000, sourceModule: 'INVESTMENT_WITH_X', groupId: 'invx_b' }),
  row({ amount: 330_000, sourceModule: 'INVESTMENT_WITH_X', groupId: 'invx_c' }),
  row({ amount: 315_000, sourceModule: 'INVESTMENT_WITH_X', groupId: 'invx_d' }),
  row({ amount: 40_000, sourceModule: 'INVESTMENT_WITH_X', groupId: 'invx_e' }),
  row({ amount: 249_000 }),
  ...personal.map((amount) => row({ amount, sourceModule: 'PERSONAL_EXPENSE' })),
  ...personal.map((amount) => row({ direction: 'IN', amount, sourceModule: 'PERSONAL_EXPENSE', reversalOf: 'x' })),
];

describe('still in hand is the pot’s cash', () => {
  test("UBL CC reads the 66,000 its account holds, not 22,879", () => {
    const cash = potCash(0, ubl);
    assert.equal(cash.received, 1_000_000);
    assert.equal(cash.inHand, 66_000);
  });

  test('a pay-back into the pot raises what is in hand and is not money put in', () => {
    const payBack = row({ direction: 'IN', amount: 77_000, sourceModule: 'PAY_BACK' });
    const cash = potCash(0, [...ubl, payBack]);
    assert.equal(cash.inHand, 66_000 + 77_000);
    assert.equal(cash.received, 1_000_000);
    assert.equal(isContribution(payBack), false);
  });

  test('a pot paying another pot back has not spent anything on itself', () => {
    const out = row({ amount: 20_000, sourceModule: 'PAY_BACK' });
    assert.equal(isDirectSpending(out), false);
    assert.equal(potCash(50_000, [out]).inHand, 30_000);
  });

  test('a hand-typed spending is a direct spending; a reversal coming back is not a contribution', () => {
    assert.equal(isDirectSpending(row({ amount: 249_000 })), true);
    assert.equal(isContribution(row({ direction: 'IN', amount: 1000, sourceModule: 'PERSONAL_EXPENSE', reversalOf: 'p' })), false);
  });

  test('a voided row is left out, as the balance leaves it out', () => {
    assert.equal(potCash(10_000, [row({ amount: 4_000, status: 'VOIDED' })]).inHand, 10_000);
  });
});

test('a loan repaid into the pot is cash coming home, never a contribution', () => {
  const lent = { direction: 'OUT' as const, amount: 37_500, sourceModule: 'MANUAL', type: 'LOAN' };
  const back = { direction: 'IN' as const, amount: 10_000, sourceModule: 'LOAN_RETURN' };
  const put = { direction: 'IN' as const, amount: 37_500, sourceModule: 'MANUAL' };
  assert.equal(isContribution(back), false);
  assert.equal(isLentOut(lent), true);
  assert.equal(isLentOut({ ...lent, type: 'EXPENSE' }), false);
  const cash = potCash(0, [put, lent, back]);
  assert.equal(cash.received, 37_500);
  assert.equal(cash.inHand, 10_000);
});
