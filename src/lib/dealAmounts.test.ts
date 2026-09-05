import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  dealAmounts,
  validateDealAmounts,
  readTotalPrice,
  readDownPayment,
  readAdjustment,
  readRemaining,
} from './dealAmounts.ts';

const LAKH = 100_000;

describe("the owner's own example", () => {
  test('50 lakh, 10 lakh down, no adjustment — the base is the total price', () => {
    const d = dealAmounts({ totalPrice: 50 * LAKH, downPayment: 10 * LAKH, adjustment: 0 });

    assert.equal(d.remaining, 50 * LAKH);
    assert.equal(d.profit, 50 * LAKH);
    // 1% to the employee, paid out of the 10 lakh down payment.
    assert.equal((d.profit * 1) / 100, 50_000);
  });

  test('50 lakh, 10 lakh down, 10 lakh adjustment — the base becomes 40 lakh', () => {
    const d = dealAmounts({ totalPrice: 50 * LAKH, downPayment: 10 * LAKH, adjustment: 10 * LAKH });

    assert.equal(d.remaining, 40 * LAKH);
    assert.equal(d.profit, 40 * LAKH);
    assert.equal((d.profit * 1) / 100, 40_000);
  });

  test('the down payment never changes the base, only what funds it', () => {
    const small = dealAmounts({ totalPrice: 50 * LAKH, downPayment: 1 * LAKH, adjustment: 0 });
    const large = dealAmounts({ totalPrice: 50 * LAKH, downPayment: 25 * LAKH, adjustment: 0 });

    assert.equal(small.profit, large.profit);
  });
});

describe('one rule, not two', () => {
  test('with no adjustment, Remaining is the total price', () => {
    // This is why there is no branch: the "no adjustment" case falls out of the
    // same expression, so the two cases cannot be wired up the wrong way round.
    const d = dealAmounts({ totalPrice: 3_000_000, downPayment: 500_000, adjustment: 0 });
    assert.equal(d.remaining, d.totalPrice);
  });

  test('an adjustment equal to the price leaves nothing to distribute', () => {
    const d = dealAmounts({ totalPrice: 2_000_000, downPayment: 0, adjustment: 2_000_000 });
    assert.equal(d.remaining, 0);
    assert.equal(d.profit, 0);
  });

  test('an adjustment larger than the price is clamped, never negative', () => {
    // A negative base would flip the sign of every commission on the screen
    // while somebody was still typing.
    const d = dealAmounts({ totalPrice: 1_000_000, downPayment: 0, adjustment: 5_000_000 });
    assert.equal(d.remaining, 0);
    assert.ok(d.profit >= 0);
  });
});

describe('the compatibility mirrors', () => {
  test('the old profit formula lands exactly on the new base', () => {
    // `profit = amountReceived − payableAmount` is what ~30 existing readers
    // assume. Writing the mirrors this way makes that formula produce the new
    // commission base, so nothing had to be migrated.
    const d = dealAmounts({ totalPrice: 50 * LAKH, downPayment: 10 * LAKH, adjustment: 10 * LAKH });

    assert.equal(d.amountReceived, 50 * LAKH);
    assert.equal(d.payableAmount, 10 * LAKH);
    assert.equal(d.amountReceived - d.payableAmount, d.remaining);
  });

  test('revenue keeps meaning the deal value', () => {
    const d = dealAmounts({ totalPrice: 4_000_000, downPayment: 900_000, adjustment: 250_000 });
    assert.equal(d.amountReceived, 4_000_000);
  });
});

describe('what a person is told', () => {
  test('a deal with no price is refused', () => {
    assert.deepEqual(validateDealAmounts({ totalPrice: 0, downPayment: 0, adjustment: 0 }), [
      'Enter the total price.',
    ]);
  });

  test('an adjustment over the price is refused', () => {
    const errors = validateDealAmounts({ totalPrice: 100, downPayment: 0, adjustment: 200 });
    assert.ok(errors.some((e) => /adjustment cannot be more/.test(e)));
  });

  test('a down payment over the price is refused', () => {
    // Typing the price into the down payment box is the mistake this catches,
    // and it would otherwise sit in the ledger permanently.
    const errors = validateDealAmounts({ totalPrice: 100, downPayment: 200, adjustment: 0 });
    assert.ok(errors.some((e) => /down payment cannot be more/.test(e)));
  });

  test("the owner's example passes", () => {
    assert.deepEqual(
      validateDealAmounts({ totalPrice: 50 * LAKH, downPayment: 10 * LAKH, adjustment: 10 * LAKH }),
      []
    );
  });
});

describe('reading a deal that predates the four fields', () => {
  const old = { amountReceived: 4_850_000, payableAmount: 3_200_000, profit: 1_650_000 };

  test('the total price falls back to what the deal was worth', () => {
    assert.equal(readTotalPrice(old), 4_850_000);
  });

  test('the base falls back to the stored profit, which is the same arithmetic', () => {
    assert.equal(readRemaining(old), 1_650_000);
  });

  test('the adjustment falls back to what came off the value', () => {
    assert.equal(readAdjustment(old), 3_200_000);
  });

  test('the down payment reads as NOT RECORDED, not as zero', () => {
    // The old form never asked. A confident "Rs 0" would read as a client who
    // has paid nothing, which is a different and alarming claim.
    assert.equal(readDownPayment(old), null);
  });

  test('a new deal reads its own fields', () => {
    const fresh = dealAmounts({ totalPrice: 50 * LAKH, downPayment: 10 * LAKH, adjustment: 10 * LAKH });
    assert.equal(readTotalPrice(fresh), 50 * LAKH);
    assert.equal(readDownPayment(fresh), 10 * LAKH);
    assert.equal(readAdjustment(fresh), 10 * LAKH);
    assert.equal(readRemaining(fresh), 40 * LAKH);
  });
});
