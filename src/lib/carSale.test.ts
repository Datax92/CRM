import test from 'node:test';
import assert from 'node:assert/strict';
//changes
import {
  calculateCarSale,
  emptyPartner,
  parseAmount,
  percentFromAmount,
  amountFromPercent,
  readPartners,
  partnershipLabel,
  type CarPartner,
} from './carSale.ts';

/* -------------------------------------------------------------------------- */
/* The owner's own sheet                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every figure below is read out of `car sale.xlsx`. They are the acceptance
 * test for this module: if the app disagrees with the book it replaces, the app
 * is wrong.
 */

function partner(name: string, amount: number, mine = false): CarPartner {
  return { name, percent: 0, amount, basis: 'AMOUNT', mine };
}

test("the sheet's DIHATSU MOVE 2015 — a two-way split, nothing deducted", () => {
  const split = calculateCarSale({
    purchaseCost: 2_325_000,
    salePrice: 2_500_000,
    partners: [partner('MAYSAM', 87_500, true), partner('QALBE', 87_500)],
  });

  assert.equal(split.totalProfit, 175_000);
  assert.equal(split.grossProfit, 87_500);
  assert.equal(split.netProfit, 87_500);
  assert.equal(split.unallocated, 0);
  assert.ok(split.valid);
});

test("the sheet's SUZUKI WAGON R 2018 — three round 25,000s out of 75,000", () => {
  const split = calculateCarSale({
    purchaseCost: 2_250_000,
    salePrice: 2_325_000,
    partners: [partner('ME', 25_000, true), partner('QALBE', 25_000), partner('KHAJI', 25_000)],
  });

  assert.equal(split.totalProfit, 75_000);
  // The whole reason a share may be typed in rupees: a third of 75,000 is
  // 24,999.99… and the owner's book says 25,000.
  assert.equal(split.grossProfit, 25_000);
  assert.equal(split.unallocated, 0);
  assert.ok(split.valid);
});

test("the sheet's HONDA CITY 2022 — investor and CC charges come off gross", () => {
  const split = calculateCarSale({
    purchaseCost: 4_450_000,
    salePrice: 4_730_000,
    partners: [partner('ME', 93_000, true), partner('QALBE', 93_000), partner('KHAJI', 93_000)],
    deductions: { investor: 10_000, ccCharges: 15_000, misc: 0 },
  });

  assert.equal(split.totalProfit, 280_000);
  assert.equal(split.grossProfit, 93_000);
  assert.equal(split.totalDeductions, 25_000);
  assert.equal(split.netProfit, 68_000);
  // 279,000 of the 280,000 shared out — the 1,000 rounding sits unallocated
  // rather than being pushed onto somebody.
  assert.equal(split.unallocated, 1_000);
  assert.ok(split.valid);
});

test("the sheet's HONDA CITY 2006 — a loss, and the owner carries all of it", () => {
  const split = calculateCarSale({
    purchaseCost: 1_752_500,
    salePrice: 1_750_000,
    partners: [partner('MAYSAM', -2_500, true), partner('QALBE', 0)],
  });

  assert.equal(split.totalProfit, -2_500);
  assert.equal(split.grossProfit, -2_500);
  assert.equal(split.netProfit, -2_500);
  assert.ok(split.valid, split.errors[0]);
});

test("the sheet's TOYOTA COROLLA 2009 — a profit that goes negative once the investor is paid", () => {
  const split = calculateCarSale({
    purchaseCost: 2_780_000,
    salePrice: 2_815_000,
    partners: [partner('ME', 11_600, true), partner('QALBE', 11_600), partner('KHAJI', 11_600)],
    deductions: { investor: 16_500, ccCharges: 0, misc: 0 },
  });

  assert.equal(split.totalProfit, 35_000);
  assert.equal(split.grossProfit, 11_600);
  assert.equal(split.netProfit, -4_900);
  assert.ok(split.valid);
});

test("the sheet's SUZUKI ALTO VXL 2020 — misc comes off too", () => {
  const split = calculateCarSale({
    purchaseCost: 2_500_000,
    salePrice: 2_539_000,
    partners: [partner('ME', 13_000, true), partner('QALBE', 13_000), partner('KHAJI', 13_000)],
    deductions: { investor: 0, ccCharges: 0, misc: 3_000 },
  });

  assert.equal(split.totalProfit, 39_000);
  assert.equal(split.grossProfit, 13_000);
  assert.equal(split.netProfit, 10_000);
  assert.ok(split.valid);
});

test("the six sale rows add up to the sheet's own totals row", () => {
  const rows = [
    calculateCarSale({ purchaseCost: 2_325_000, salePrice: 2_500_000, partners: [partner('MAYSAM', 87_500, true)] }),
    calculateCarSale({ purchaseCost: 2_250_000, salePrice: 2_325_000, partners: [partner('ME', 25_000, true)] }),
    calculateCarSale({ purchaseCost: 4_450_000, salePrice: 4_730_000, partners: [partner('ME', 93_000, true)], deductions: { investor: 10_000, ccCharges: 15_000, misc: 0 } }),
    calculateCarSale({ purchaseCost: 1_752_500, salePrice: 1_750_000, partners: [partner('MAYSAM', -2_500, true)] }),
    calculateCarSale({ purchaseCost: 2_780_000, salePrice: 2_815_000, partners: [partner('ME', 11_600, true)], deductions: { investor: 16_500, ccCharges: 0, misc: 0 } }),
    calculateCarSale({ purchaseCost: 2_500_000, salePrice: 2_539_000, partners: [partner('ME', 13_000, true)], deductions: { investor: 0, ccCharges: 0, misc: 3_000 } }),
  ];

  const sum = (pick: (row: (typeof rows)[number]) => number) =>
    Math.round(rows.reduce((total, row) => total + pick(row), 0) * 100) / 100;

  // The sheet's totals row, less the rental line it also carried: gross
  // 247,600 − 20,000 = 227,600; investor 44,000 − 17,500 = 26,500;
  // CC 17,500 − 2,500 = 15,000; net 183,100 − 0 = 183,100.
  assert.equal(sum((row) => row.grossProfit), 227_600);
  assert.equal(sum((row) => row.deductions.investor), 26_500);
  assert.equal(sum((row) => row.deductions.ccCharges), 15_000);
  assert.equal(sum((row) => row.deductions.misc), 3_000);
  assert.equal(sum((row) => row.netProfit), 183_100);
});

/* -------------------------------------------------------------------------- */
/* The two columns                                                             */
/* -------------------------------------------------------------------------- */

test('typing a percentage fills in the rupees', () => {
  const split = calculateCarSale({
    purchaseCost: 1_000_000,
    salePrice: 1_200_000,
    partners: [{ name: 'ME', percent: 50, amount: 0, basis: 'PERCENT', mine: true }],
  });

  assert.equal(split.totalProfit, 200_000);
  assert.equal(split.lines[0].amount, 100_000);
  assert.equal(split.grossProfit, 100_000);
});

test('typing the rupees fills in the percentage', () => {
  const split = calculateCarSale({
    purchaseCost: 1_000_000,
    salePrice: 1_200_000,
    partners: [{ name: 'ME', percent: 0, amount: 50_000, basis: 'AMOUNT', mine: true }],
  });

  assert.equal(split.lines[0].percent, 25);
});

test('the typed column survives a change to the sale price; the derived one moves', () => {
  const byPercent: CarPartner = { name: 'ME', percent: 50, amount: 0, basis: 'PERCENT', mine: true };
  const byAmount: CarPartner = { name: 'ME', percent: 0, amount: 100_000, basis: 'AMOUNT', mine: true };

  // Same starting point: half of a 200,000 profit is 100,000.
  assert.equal(calculateCarSale({ purchaseCost: 1_000_000, salePrice: 1_200_000, partners: [byPercent] }).grossProfit, 100_000);
  assert.equal(calculateCarSale({ purchaseCost: 1_000_000, salePrice: 1_200_000, partners: [byAmount] }).grossProfit, 100_000);

  // The car then sells for more. A percentage means "half of whatever it made";
  // a rupee figure means "this much, whatever it made". Both readings are
  // legitimate, which is exactly why `basis` has to be stored.
  const richer = { purchaseCost: 1_000_000, salePrice: 1_400_000 };
  assert.equal(calculateCarSale({ ...richer, partners: [byPercent] }).grossProfit, 200_000);
  assert.equal(calculateCarSale({ ...richer, partners: [byAmount] }).grossProfit, 100_000);
});

test('a car sold for exactly what it cost yields 0%, never Infinity', () => {
  assert.equal(percentFromAmount(0, 5_000), 0);
  const split = calculateCarSale({
    purchaseCost: 1_000_000,
    salePrice: 1_000_000,
    partners: [{ name: 'ME', percent: 0, amount: 0, basis: 'AMOUNT', mine: true }],
  });
  assert.equal(split.totalProfit, 0);
  assert.equal(split.myPercent, 0);
  assert.ok(split.valid);
});

/* -------------------------------------------------------------------------- */
/* What must be refused                                                        */
/* -------------------------------------------------------------------------- */

test('sharing out more than the car made is refused, not trimmed', () => {
  const split = calculateCarSale({
    purchaseCost: 1_000_000,
    salePrice: 1_075_000,
    partners: [partner('ME', 50_000, true), partner('QALBE', 50_000)],
  });

  assert.equal(split.totalProfit, 75_000);
  assert.equal(split.allocated, 100_000);
  assert.equal(split.valid, false);
  // Trimming would pay somebody a figure nobody agreed to.
  assert.equal(split.lines[1].amount, 50_000);
});

test('sharing out more loss than there was is refused too', () => {
  const split = calculateCarSale({
    purchaseCost: 1_000_000,
    salePrice: 997_500,
    partners: [partner('ME', -2_500, true), partner('QALBE', -2_500)],
  });

  assert.equal(split.totalProfit, -2_500);
  assert.equal(split.allocated, -5_000);
  assert.equal(split.valid, false);
});

test('a share with no name is an error, never a silent zero', () => {
  const split = calculateCarSale({
    purchaseCost: 1_000_000,
    salePrice: 1_100_000,
    partners: [partner('ME', 50_000, true), { name: null, percent: 0, amount: 50_000, basis: 'AMOUNT', mine: false }],
  });
  assert.equal(split.valid, false);
  assert.match(split.errors[0], /no name/);
});

test('exactly one partner may be the owner', () => {
  const two = calculateCarSale({
    purchaseCost: 1_000_000,
    salePrice: 1_100_000,
    partners: [partner('ME', 50_000, true), partner('QALBE', 50_000, true)],
  });
  assert.equal(two.valid, false);
  assert.equal(two.grossProfit, 0);

  const none = calculateCarSale({
    purchaseCost: 1_000_000,
    salePrice: 1_100_000,
    partners: [partner('QALBE', 50_000)],
  });
  assert.equal(none.valid, false);
  assert.match(none.errors[0], /Mark which partner is you/);
});

test('a car with no partners is entirely the owner’s', () => {
  const split = calculateCarSale({ purchaseCost: 1_000_000, salePrice: 1_150_000, partners: [] });
  assert.equal(split.grossProfit, 150_000);
  assert.equal(split.myPercent, 100);
  assert.ok(split.valid);
});

test('a deduction cannot be negative — that would be income hiding in a cost box', () => {
  const split = calculateCarSale({
    purchaseCost: 1_000_000,
    salePrice: 1_100_000,
    partners: [],
    deductions: { investor: -5_000, ccCharges: 0, misc: 0 },
  });
  assert.equal(split.valid, false);
});

/* -------------------------------------------------------------------------- */
/* Reading what was typed and what was stored                                  */
/* -------------------------------------------------------------------------- */

test('a money box keeps a negative; a percentage box does not', () => {
  assert.equal(parseAmount('-2500'), -2_500);
  assert.equal(parseAmount('1,00,000'), 100000);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('-'), 0);
  assert.equal(parseAmount('abc'), 0);
});

test('amountFromPercent works on a loss', () => {
  assert.equal(amountFromPercent(-2_500, 50), -1_250);
});

test('a partner row that is not an object is dropped, never half-read', () => {
  const partners = readPartners([
    { name: 'ME', amount: 25_000, basis: 'AMOUNT', mine: true },
    null,
    'QALBE',
    { name: '  ', percent: 10 },
  ]);
  assert.equal(partners.length, 2);
  assert.equal(partners[0].name, 'ME');
  assert.equal(partners[0].basis, 'AMOUNT');
  assert.equal(partners[1].name, null);
  // An unrecognised basis falls back rather than corrupting the arithmetic.
  assert.equal(partners[1].basis, 'PERCENT');
});

test('the partnership line reads the way the sheet writes it', () => {
  assert.equal(
    partnershipLabel([
      { ...emptyPartner(true), name: 'Mahziyar' },
      { ...emptyPartner(), name: 'QALBE' },
      { ...emptyPartner(), name: 'KHAJI' },
    ]),
    'ME / QALBE / KHAJI'
  );
  assert.equal(partnershipLabel([]), 'Mine alone');
});
