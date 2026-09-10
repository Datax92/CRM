import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  dealAmounts,
  validateDealAmounts,
  describeDealAmounts,
  readDealType,
  readTotalPrice,
  readDownPayment,
  readAdjustment,
  readReceivedAmount,
  readCommission,
  readRemaining,
  readCutBase,
  readPayoutSource,
  normalizeDealType,
  isPricedType,
  DEAL_TYPES,
} from './dealAmounts.ts';

/*
 * The four deal types, and the rule the whole module exists to hold:
 *
 *   the Cut BASE is what the percentage multiplies
 *   the Cut SOURCE is where the money comes from
 *   they are deliberately different numbers
 *
 * Every figure below is one of the owner's own worked examples.
 */

const LAKH = 100_000;

/* -------------------------------------------------------------------------- */

describe('Down Payment', () => {
  const deal = dealAmounts({
    dealType: 'DOWN_PAYMENT',
    totalPrice: 50 * LAKH,
    downPayment: 10 * LAKH,
    adjustment: 10 * LAKH,
  });

  test('Remaining is the total price less the adjustment', () => {
    assert.equal(deal.remaining, 40 * LAKH);
  });

  test('the Cut base is the TOTAL PRICE, not the remaining', () => {
    // The owner's example: a 1% cut is 50,000, not the 40,000 the old
    // single-base rule produced.
    assert.equal(deal.cutBase, 50 * LAKH);
    assert.equal(deal.cutBase * 0.01, 50_000);
  });

  test('the Cut is paid out of the Remaining', () => {
    assert.equal(deal.payoutSource, 40 * LAKH);
  });

  test('the base and the source are different numbers here', () => {
    assert.notEqual(deal.cutBase, deal.payoutSource);
  });

  test('with no adjustment the two coincide, which is the only case they do', () => {
    const plain = dealAmounts({ dealType: 'DOWN_PAYMENT', totalPrice: 50 * LAKH, downPayment: 10 * LAKH });
    assert.equal(plain.remaining, 50 * LAKH);
    assert.equal(plain.cutBase, 50 * LAKH);
    assert.equal(plain.payoutSource, 50 * LAKH);
  });

  test('the down payment never changes the base or the source', () => {
    const small = dealAmounts({ dealType: 'DOWN_PAYMENT', totalPrice: 50 * LAKH, downPayment: 1, adjustment: 10 * LAKH });
    assert.equal(small.cutBase, deal.cutBase);
    assert.equal(small.payoutSource, deal.payoutSource);
  });

  test('an adjustment larger than the price is clamped, never negative', () => {
    const over = dealAmounts({ dealType: 'DOWN_PAYMENT', totalPrice: 10 * LAKH, adjustment: 99 * LAKH });
    assert.equal(over.remaining, 0);
    assert.equal(over.payoutSource, 0);
  });
});

/* -------------------------------------------------------------------------- */

describe('Confirmation', () => {
  const deal = dealAmounts({
    dealType: 'CONFIRMATION',
    totalPrice: 50 * LAKH,
    confirmationAmount: 7 * LAKH,
    adjustment: 10 * LAKH,
  });

  test('Remaining, base and source match Down Payment exactly', () => {
    assert.equal(deal.remaining, 40 * LAKH);
    assert.equal(deal.cutBase, 50 * LAKH);
    assert.equal(deal.payoutSource, 40 * LAKH);
  });

  test('the client payment is a Confirmation, and is kept apart from a down payment', () => {
    // Same shape, one renamed field. Storing it in `downPayment` would make the
    // record say the client put down a deposit they never put down.
    assert.equal(deal.confirmationAmount, 7 * LAKH);
    assert.equal(deal.downPayment, 0);
  });

  test('the confirmation is what `readDownPayment` reports for this type', () => {
    assert.equal(readDownPayment({ dealType: 'CONFIRMATION', confirmationAmount: 7 * LAKH }), 7 * LAKH);
  });
});

/* -------------------------------------------------------------------------- */

describe('Installments', () => {
  const deal = dealAmounts({
    dealType: 'INSTALLMENTS',
    receivedAmount: 10 * LAKH,
    payableAmount: 7 * LAKH,
  });

  test('Remaining is Amount Received less Payable Amount', () => {
    assert.equal(deal.remaining, 3 * LAKH);
  });

  test('the Cut base is the AMOUNT RECEIVED', () => {
    // 1% of 10 lakh = 10,000, per the owner's example — not 1% of the 3 lakh
    // remaining, which would be 3,000.
    assert.equal(deal.cutBase, 10 * LAKH);
    assert.equal(deal.cutBase * 0.01, 10_000);
  });

  test('the Cut is paid out of the Remaining', () => {
    assert.equal(deal.payoutSource, 3 * LAKH);
  });

  test('there is no total price on an installments deal', () => {
    // Deliberately not invented for the sake of the calculation.
    assert.equal(deal.totalPrice, 0);
  });

  test('a payable larger than the received amount is clamped, never a negative remaining', () => {
    const over = dealAmounts({ dealType: 'INSTALLMENTS', receivedAmount: 5 * LAKH, payableAmount: 9 * LAKH });
    assert.equal(over.remaining, 0);
  });
});

/* -------------------------------------------------------------------------- */

describe('Lump Sum', () => {
  const deal = dealAmounts({
    dealType: 'LUMP_SUM',
    receivedAmount: 40 * LAKH,
    payableAmount: 0,
    commission: 4 * LAKH,
  });

  test('there is no Remaining at all — the field does not exist for this type', () => {
    // Not zero. A lump sum has no remaining, and printing "Rs 0 remaining"
    // would be inventing a figure the business does not have.
    assert.equal(deal.remaining, null);
  });

  test('the Commission is taken as typed and never derived', () => {
    // Emphatically NOT receivedAmount − payableAmount, which would be 40 lakh.
    assert.equal(deal.commission, 4 * LAKH);
  });

  test('the Cut base is the AMOUNT RECEIVED — the money that went to the builder', () => {
    assert.equal(deal.cutBase, 40 * LAKH);
    assert.equal(deal.cutBase * 0.01, 40_000);
  });

  test('the Cut is paid out of the COMMISSION', () => {
    assert.equal(deal.payoutSource, 4 * LAKH);
  });

  test("the client's 40 lakh is not company revenue — the commission is", () => {
    // The single most important line in this file: the client pays the
    // builder, and only the builder's commission is ours.
    assert.equal(deal.companyRevenue, 4 * LAKH);
    assert.equal(deal.amountReceived, 4 * LAKH);
    assert.equal(deal.profit, 4 * LAKH);
    assert.notEqual(deal.amountReceived, 40 * LAKH);
  });

  test("the owner's outcome: 4 lakh less a 40,000 cut leaves 3.6 lakh", () => {
    const cut = deal.cutBase * 0.01;
    assert.equal(deal.payoutSource - cut, 360_000);
  });
});

/* -------------------------------------------------------------------------- */

describe('the compatibility mirrors', () => {
  test('profit is still received minus payable, on every type', () => {
    for (const dealType of DEAL_TYPES) {
      const deal = dealAmounts({
        dealType,
        totalPrice: 50 * LAKH, downPayment: 5 * LAKH, confirmationAmount: 5 * LAKH,
        adjustment: 10 * LAKH, receivedAmount: 10 * LAKH, payableAmount: 7 * LAKH,
        commission: 4 * LAKH,
      });
      assert.equal(deal.profit, deal.amountReceived - deal.legacyPayableAmount, dealType);
    }
  });

  test('a priced deal books its total price as revenue, as it always did', () => {
    const deal = dealAmounts({ dealType: 'DOWN_PAYMENT', totalPrice: 50 * LAKH, adjustment: 10 * LAKH });
    assert.equal(deal.amountReceived, 50 * LAKH);
    assert.equal(deal.legacyPayableAmount, 10 * LAKH);
    assert.equal(deal.profit, 40 * LAKH);
  });

  test('an installments deal mirrors its own two figures unchanged', () => {
    const deal = dealAmounts({ dealType: 'INSTALLMENTS', receivedAmount: 10 * LAKH, payableAmount: 7 * LAKH });
    assert.equal(deal.amountReceived, 10 * LAKH);
    assert.equal(deal.legacyPayableAmount, 7 * LAKH);
  });

  test('a lump sum books the commission and nothing payable', () => {
    const deal = dealAmounts({ dealType: 'LUMP_SUM', receivedAmount: 40 * LAKH, payableAmount: 3 * LAKH, commission: 4 * LAKH });
    assert.equal(deal.amountReceived, 4 * LAKH);
    assert.equal(deal.legacyPayableAmount, 0);
    assert.equal(deal.profit, 4 * LAKH);
  });
});

/* -------------------------------------------------------------------------- */

describe('validation, per type', () => {
  const ok = (input: Parameters<typeof validateDealAmounts>[0]) =>
    assert.deepEqual(validateDealAmounts(input), []);

  test('a priced deal needs a price', () => {
    assert.match(validateDealAmounts({ dealType: 'DOWN_PAYMENT', totalPrice: 0 })[0], /total price/i);
  });

  test('an adjustment over the price is refused', () => {
    const errors = validateDealAmounts({ dealType: 'DOWN_PAYMENT', totalPrice: 10 * LAKH, adjustment: 11 * LAKH });
    assert.match(errors.join(' '), /adjustment cannot be more than the total price/i);
  });

  test('the confirmation form names the confirmation, not a down payment', () => {
    const errors = validateDealAmounts({
      dealType: 'CONFIRMATION', totalPrice: 10 * LAKH, confirmationAmount: 11 * LAKH,
    });
    assert.match(errors.join(' '), /confirmation amount cannot be more/i);
  });

  test('installments refuse a payable bigger than the receipt — the only route to a negative Remaining', () => {
    const errors = validateDealAmounts({ dealType: 'INSTALLMENTS', receivedAmount: 5 * LAKH, payableAmount: 9 * LAKH });
    assert.match(errors.join(' '), /payable amount cannot be more/i);
  });

  test('a lump sum needs a commission, because it is what the company earns', () => {
    const errors = validateDealAmounts({ dealType: 'LUMP_SUM', receivedAmount: 40 * LAKH, commission: 0 });
    assert.match(errors.join(' '), /commission/i);
  });

  test('a commission bigger than the receipt catches the transposed pair', () => {
    // 40 lakh commission on a 4 lakh receipt is the two boxes swapped, and it
    // would put a 10x cut base into the ledger permanently.
    const errors = validateDealAmounts({ dealType: 'LUMP_SUM', receivedAmount: 4 * LAKH, commission: 40 * LAKH });
    assert.match(errors.join(' '), /right way round/i);
  });

  test("a priced deal is not judged on boxes that are not on its form", () => {
    // No receivedAmount, no commission — and it validates, because neither is
    // asked for on a Down Payment.
    ok({ dealType: 'DOWN_PAYMENT', totalPrice: 50 * LAKH, downPayment: 10 * LAKH, adjustment: 10 * LAKH });
  });

  test("each of the owner's four examples passes", () => {
    ok({ dealType: 'DOWN_PAYMENT', totalPrice: 50 * LAKH, downPayment: 10 * LAKH, adjustment: 10 * LAKH });
    ok({ dealType: 'CONFIRMATION', totalPrice: 50 * LAKH, confirmationAmount: 7 * LAKH, adjustment: 10 * LAKH });
    ok({ dealType: 'INSTALLMENTS', receivedAmount: 10 * LAKH, payableAmount: 7 * LAKH });
    ok({ dealType: 'LUMP_SUM', receivedAmount: 40 * LAKH, payableAmount: 0, commission: 4 * LAKH });
  });
});

/* -------------------------------------------------------------------------- */

describe('reading a deal recorded before the type selector', () => {
  // The seven real deals in the project, all of this shape.
  const legacy = { amountReceived: 628_000, payableAmount: 470_000, profit: 158_000 };

  test('a deal with no type is an Installments deal', () => {
    assert.equal(readDealType(legacy), 'INSTALLMENTS');
  });

  test('it keeps displaying exactly what it displays today', () => {
    assert.equal(readReceivedAmount(legacy), 628_000);
    assert.equal(readRemaining(legacy), 158_000);
    assert.equal(readAdjustment(legacy), 470_000);
  });

  test('its Cut base is Amount Received, the same rule as any Installments deal', () => {
    // The owner's instruction: one rule per type, never a second one depending
    // on when the deal was entered.
    assert.equal(readCutBase(legacy), 628_000);
    assert.notEqual(readCutBase(legacy), legacy.profit);
  });

  test('its Cut source is the Remaining', () => {
    assert.equal(readPayoutSource(legacy), 158_000);
  });

  test('a loss-making legacy deal reads as a loss rather than throwing', () => {
    const loss = { amountReceived: 500_000, payableAmount: 600_000, profit: -100_000 };
    assert.equal(readRemaining(loss), -100_000);
    assert.equal(readPayoutSource(loss), -100_000);
  });

  test('a deal from the brief four-field form reads as a Down Payment', () => {
    const fourField = { totalPrice: 50 * LAKH, downPayment: 10 * LAKH, adjustment: 10 * LAKH, remaining: 40 * LAKH };
    assert.equal(readDealType(fourField), 'DOWN_PAYMENT');
    assert.equal(readCutBase(fourField), 50 * LAKH);
    assert.equal(readPayoutSource(fourField), 40 * LAKH);
  });

  test('the down payment reads as NOT RECORDED, not as zero', () => {
    assert.equal(readDownPayment(legacy), null);
  });

  test('a stored deal prefers its own frozen figures over any re-derivation', () => {
    // If the rules change again, a deal keeps the numbers it was entered with.
    const stored = { dealType: 'INSTALLMENTS', receivedAmount: 10 * LAKH, cutBase: 999, payoutSource: 111 };
    assert.equal(readCutBase(stored), 999);
    assert.equal(readPayoutSource(stored), 111);
  });

  test('a lump sum never reports a Remaining, however it was stored', () => {
    assert.equal(readRemaining({ dealType: 'LUMP_SUM', commission: 4 * LAKH, remaining: 999 }), null);
    assert.equal(readPayoutSource({ dealType: 'LUMP_SUM', commission: 4 * LAKH }), 4 * LAKH);
    assert.equal(readCommission({ dealType: 'LUMP_SUM', commission: 4 * LAKH }), 4 * LAKH);
  });

  test('the total price still falls back to what an old deal was worth', () => {
    assert.equal(readTotalPrice(legacy), 628_000);
  });
});

/* -------------------------------------------------------------------------- */

describe('the type itself', () => {
  test('an unknown or missing type is Installments', () => {
    assert.equal(normalizeDealType(undefined), 'INSTALLMENTS');
    assert.equal(normalizeDealType('NONSENSE'), 'INSTALLMENTS');
    assert.equal(normalizeDealType('LUMP_SUM'), 'LUMP_SUM');
  });

  test('only two of the four are priced against a total', () => {
    assert.equal(isPricedType('DOWN_PAYMENT'), true);
    assert.equal(isPricedType('CONFIRMATION'), true);
    assert.equal(isPricedType('INSTALLMENTS'), false);
    assert.equal(isPricedType('LUMP_SUM'), false);
  });

  test('every type describes itself naming both cut figures', () => {
    for (const dealType of DEAL_TYPES) {
      const line = describeDealAmounts(dealAmounts({
        dealType, totalPrice: 50 * LAKH, receivedAmount: 10 * LAKH, commission: 4 * LAKH,
      }));
      assert.match(line, /Cut is a percentage of/);
      assert.match(line, /paid from/);
    }
  });
});
