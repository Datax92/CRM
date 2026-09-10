import test from 'node:test';
import assert from 'node:assert/strict';

import {
  afterTax,
  DEFAULT_STATELIFE_RATES,
  fromPercent,
  normalizeRates,
  slabMeta,
  toPercent,
  slabNote,
  slabPosition,
  stateLifeCommission,
  stateLifeSlabs,
  stateLifeTotals,
  STATELIFE_RATES,
  STATELIFE_TAX_RATE,
} from './stateLife.ts';

/* -------------------------------------------------------------------------- */
/* The multipliers, against the workbook's own formulas                        */
/* -------------------------------------------------------------------------- */

test('the tax is folded into every rate, and the multipliers are the sheet\'s', () => {
  // `=E4*0.276`, `=E4*0.092`, `=E4*0.023`, `=E4*0.069` — read out of the file.
  assert.equal(STATELIFE_TAX_RATE, 0.08);
  assert.equal(afterTax(STATELIFE_RATES.first), 0.276);
  assert.equal(afterTax(STATELIFE_RATES.second), 0.092);
  assert.equal(afterTax(STATELIFE_RATES.quarter), 0.023);
  assert.equal(afterTax(STATELIFE_RATES.december), 0.069);
});

test('the commission base is PASS and never FYP', () => {
  // They are nearly equal on most rows, which is exactly why guessing would
  // have looked right: 300,000 proposed against 299,900 passed. Row 10 is
  // where it shows — 260,000 proposed, 253,019 passed.
  const same = stateLifeCommission({ fyp: 999_999, pass: 100_000, discount: 0 });
  const alone = stateLifeCommission({ pass: 100_000, discount: 0 });
  assert.deepEqual(same, alone);
  assert.equal(same.firstCommission, 27_600);
});

test('row 4 of the workbook, every column', () => {
  const c = stateLifeCommission({ fyp: 300_000, pass: 299_900, discount: 12_600 });
  assert.equal(c.firstCommission, 82_772.4);      // M
  assert.equal(c.secondCommission, 27_590.8);     // N
  assert.equal(c.discount, 12_600);               // O
  assert.equal(c.remainingCommission, 97_763.2);  // P
  assert.equal(c.quarterCommission, 6_897.7);     // Q
  assert.equal(c.decemberCommission, 20_693.1);   // R
  assert.equal(c.netCommission, 125_354);         // S
});

test('the sheet total, over the rows that carry one', () => {
  // Row 22 of the workbook: PASS 1,743,811 and net 679,834 across 14 rows. Two
  // rows are checked here rather than all fourteen — enough to prove the
  // accumulator rounds per row and not only at the end.
  const totals = stateLifeTotals([
    { fyp: 300_000, pass: 299_900, discount: 12_600 },
    { fyp: 100_000, pass: 99_900, discount: 0 },
  ]);
  assert.equal(totals.pass, 399_800);
  assert.equal(totals.netCommission, 171_308);
});


/* -------------------------------------------------------------------------- */
/* Slabs — the commission arrives in three, months apart                       */
/* -------------------------------------------------------------------------- */

test('the three slabs are the workbook columns P, Q and R', () => {
  // Row 4 of `statelife.xlsx`: PASS 299,900, discount 12,600.
  const slabs = stateLifeSlabs({ pass: 299_900, discount: 12_600 });
  assert.deepEqual(
    slabs.map((s) => [s.slab, s.amount]),
    [['FORTY', 97_763.2], ['QUARTER', 6_897.7], ['DECEMBER', 20_693.1]]
  );
});

test('the slabs sum to the workbook’s own Net Commission', () => {
  // 125,354 on row 4 — column S, and the figure the sheet totals.
  const slabs = stateLifeSlabs({ pass: 299_900, discount: 12_600 });
  const total = slabs.reduce((sum, s) => sum + s.amount, 0);
  assert.equal(Math.round(total * 100) / 100, 125_354);
  assert.equal(
    Math.round(total * 100) / 100,
    stateLifeCommission({ pass: 299_900, discount: 12_600 }).netCommission
  );
});

test('FORTY is the remaining commission, not 30% + 10%', () => {
  // The distinction the owner asked for: money is paid *from the remaining
  // commission*, and the discount never arrives, so it is not in the pot.
  const c = stateLifeCommission({ pass: 299_900, discount: 12_600 });
  const forty = stateLifeSlabs({ pass: 299_900, discount: 12_600 })[0];
  assert.equal(forty.amount, c.remainingCommission);
  assert.notEqual(forty.amount, c.firstCommission + c.secondCommission);
});

test('a discount larger than the commission leaves a negative slab, reported as it is', () => {
  // Row 15: PASS 31,000, discount 14,000, remaining -2,592.
  const slabs = stateLifeSlabs({ pass: 31_000, discount: 14_000 });
  assert.equal(slabs[0].amount, -2_592);
});

test('a negative slab is owed nothing, so it is not "still to come"', () => {
  // Reporting -2,592 as outstanding would make every total on the screen wrong
  // in the safe-looking direction.
  const position = slabPosition({ pass: 31_000, discount: 14_000 }, undefined);
  assert.equal(position.outstanding, position.slabs[1].amount + position.slabs[2].amount);
  assert.equal(position.slabs[0].outstanding, 0);
  assert.equal(position.net, 260); // the workbook's own Net for that row
});

test('nothing received leaves the whole net outstanding', () => {
  const position = slabPosition({ pass: 299_900, discount: 12_600 }, undefined);
  assert.equal(position.received, 0);
  assert.equal(position.outstanding, 125_354);
});

test('receiving the 40% leaves only the quarter and December to come', () => {
  const position = slabPosition(
    { pass: 299_900, discount: 12_600 },
    { FORTY: { amount: 97_763.2, dayKey: '2026-02-10', accountId: 'a1', accountName: 'Bank' } }
  );
  assert.equal(position.received, 97_763.2);
  assert.equal(position.outstanding, 27_590.8);
  assert.equal(position.slabs[0].outstanding, 0);
});

test('a part payment leaves the balance of that slab outstanding', () => {
  // The sheet's own descriptions record these: "5K PENDING", "22K PENDING".
  const position = slabPosition(
    { pass: 299_900, discount: 12_600 },
    { FORTY: { amount: 90_000, dayKey: '2026-02-10', accountId: 'a1', accountName: 'Bank' } }
  );
  assert.equal(position.received, 90_000);
  assert.equal(position.slabs[0].outstanding, 7_763.2);
  assert.equal(position.outstanding, 35_354);
});

test('the slab note is written the way the sheet writes column T', () => {
  // Row 6 of the workbook reads "40% FEB + 2.5% JAN INCOM".
  assert.equal(
    slabNote({
      FORTY: { amount: 36_800, dayKey: '2026-02-14', accountId: 'a1', accountName: 'Bank' },
      QUARTER: { amount: 2_300, dayKey: '2026-01-31', accountId: 'a1', accountName: 'Bank' },
    }),
    '40% FEB + 2.5% JAN INCOME'
  );
  assert.equal(slabNote(undefined), null);
  assert.equal(slabNote({}), null);
});

/* -------------------------------------------------------------------------- */
/* Editable rates, and what must not move when they change                     */
/* -------------------------------------------------------------------------- */

test('the defaults are the workbook’s own figures', () => {
  assert.deepEqual(DEFAULT_STATELIFE_RATES, {
    first: 0.3, second: 0.1, quarter: 0.025, december: 0.075, tax: 0.08,
  });
});

test('a policy with no stored rates reads exactly as it always did', () => {
  // The whole reason there is no migration: every existing row keeps its
  // numbers because absent rates fall back to the workbook's.
  const before = stateLifeCommission({ pass: 299_900, discount: 12_600 });
  const after = stateLifeCommission({ pass: 299_900, discount: 12_600 }, undefined);
  assert.deepEqual(before, after);
  assert.equal(after.netCommission, 125_354);
});

test('a policy keeps its own rates, whatever the business default becomes', () => {
  // Written at 30/10; the book later moves to 25/10. The policy must not move.
  const written = stateLifeCommission(
    { pass: 100_000, discount: 0 },
    { first: 0.3, second: 0.1, quarter: 0.025, december: 0.075, tax: 0.08 }
  );
  const atNewRates = stateLifeCommission(
    { pass: 100_000, discount: 0 },
    { first: 0.25, second: 0.1, quarter: 0.025, december: 0.075, tax: 0.08 }
  );
  assert.equal(written.firstCommission, 27_600);
  assert.equal(atNewRates.firstCommission, 23_000);
  assert.notEqual(written.netCommission, atNewRates.netCommission);
});

test('a missing rate falls back one field at a time, never the whole set', () => {
  // A policy that stored only a corrected tax must keep its four commission
  // rates; replacing the lot because one was absent would rewrite the others.
  const rates = normalizeRates({ tax: 0.05 });
  assert.equal(rates.tax, 0.05);
  assert.equal(rates.first, 0.3);
  assert.equal(rates.second, 0.1);
  assert.equal(rates.quarter, 0.025);
  assert.equal(rates.december, 0.075);
});

test('junk and out-of-range rates fall back rather than corrupting a commission', () => {
  assert.equal(normalizeRates({ first: -1 }).first, 0.3);
  assert.equal(normalizeRates({ first: 'nonsense' }).first, 0.3);
  assert.equal(normalizeRates({ first: 5 }).first, 1);
  // A tax of 1 makes every commission zero and nothing downstream would say so.
  assert.ok(normalizeRates({ tax: 1 }).tax < 1);
  assert.ok(normalizeRates({ tax: 4 }).tax < 1);
});

test('zero tax means the rate is the multiplier', () => {
  assert.equal(afterTax(0.3, 0), 0.3);
  assert.equal(stateLifeCommission({ pass: 100_000 }, { tax: 0 }).firstCommission, 30_000);
});

test('percentages round-trip through the form’s own conversion', () => {
  for (const rate of [0.3, 0.1, 0.025, 0.075, 0.08, 0.425]) {
    assert.equal(fromPercent(toPercent(rate)), rate);
  }
  assert.equal(toPercent(0.025), 2.5);
  assert.equal(fromPercent(2.5), 0.025);
});

test('the slab name is computed from the rates, never hard-coded', () => {
  // "40%" is first + second. A book written at 25 + 10 has a 35% slab, and
  // labelling it 40% would put a wrong figure on an account statement for ever.
  assert.equal(slabMeta(undefined).FORTY.short, '40%');
  assert.equal(slabMeta({ first: 0.25, second: 0.1 }).FORTY.short, '35%');
  assert.equal(slabMeta({ quarter: 0.03 }).QUARTER.short, '3%');
});

test('a slab receipt is what arrived, and re-rating the policy never rewrites it', () => {
  // The received figure is money that actually moved. Changing the rate may
  // change what is still owed; it can never change what was banked.
  // A **part** receipt, deliberately: a full one zeroes that slab's balance at
  // either rate, so it would prove nothing about the outstanding moving.
  const receipts = {
    FORTY: { amount: 20_000, dayKey: '2026-02-14', accountId: 'a1', accountName: 'Bank' },
  };
  const atOld = slabPosition({ pass: 100_000 }, receipts, { first: 0.3, second: 0.1 });
  const atNew = slabPosition({ pass: 100_000 }, receipts, { first: 0.25, second: 0.1 });

  // What was banked is identical either way — it is money that actually moved.
  assert.equal(atOld.received, 20_000);
  assert.equal(atNew.received, 20_000);

  // What is still owed follows the rate, which is the point of correcting one.
  assert.equal(atOld.outstanding, 16_800 + 9_200);
  assert.equal(atNew.outstanding, 12_200 + 9_200);
});

test('a receipt larger than the re-rated slab leaves nothing outstanding, never a negative', () => {
  // Dropping the rate below what has already been banked is refused on the
  // server; if it ever got through, the screen must still not print a negative
  // balance owed.
  const receipts = {
    FORTY: { amount: 36_800, dayKey: '2026-02-14', accountId: 'a1', accountName: 'Bank' },
  };
  const atNew = slabPosition({ pass: 100_000 }, receipts, { first: 0.25, second: 0.1 });
  assert.equal(atNew.slabs[0].outstanding, 0);
});

test('totals take each row at its own rates', () => {
  // A book part-written at one rate and part at another must total to what its
  // rows actually say, not to one rate applied across the lot.
  const totals = stateLifeTotals([
    { pass: 100_000, discount: 0, rates: { first: 0.3, second: 0.1, quarter: 0.025, december: 0.075, tax: 0.08 } },
    { pass: 100_000, discount: 0, rates: { first: 0.25, second: 0.1, quarter: 0.025, december: 0.075, tax: 0.08 } },
  ]);
  assert.equal(totals.firstCommission, 27_600 + 23_000);
});
