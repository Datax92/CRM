import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHARE_COLUMNS,
  bookTotals,
  calculateRound,
  normalizeShareColumns,
  parseAmount,
  shareKeyFor,
} from './investmentWithX.ts';

const cols = DEFAULT_SHARE_COLUMNS;

/**
 * The rows of the owner's INVESTMENT WITH X sheet that were complete when it
 * was photographed: amount, profit, gross, shares, and the net the sheet
 * printed. NET PROFIT must come out exactly.
 */
const SHEET: Array<{ amount: number; profit: number; gross: number; shares: Record<string, number>; net: number }> = [
  { amount: 100_000, profit: 18_500, gross: 24_500, shares: { investor: 3_500 }, net: 15_000 },
  { amount: 140_000, profit: 8_000, gross: 8_000, shares: {}, net: 8_000 },
  { amount: 110_000, profit: 8_000, gross: 8_000, shares: { investor: 8_000 }, net: 0 },
  { amount: 50_000, profit: 5_000, gross: 5_000, shares: { investor: 5_000 }, net: 0 },
  { amount: 300_000, profit: 23_500, gross: 23_500, shares: { investor: 18_500 }, net: 5_000 },
  { amount: 300_000, profit: 25_000, gross: 25_000, shares: {}, net: 25_000 },
  { amount: 375_000, profit: 31_000, gross: 31_000, shares: { investor: 16_500 }, net: 14_500 },
  { amount: 330_000, profit: 35_000, gross: 35_000, shares: {}, net: 35_000 },
  { amount: 330_000, profit: 75_000, gross: 15_000, shares: { ali: 10_000, misc: 22_500 }, net: 42_500 },
  { amount: 180_000, profit: 30_000, gross: 30_000, shares: { investor: 27_000, ali: 3_000 }, net: 0 },
  { amount: 220_000, profit: 45_000, gross: 45_000, shares: { investor: 10_500, ali: 4_000 }, net: 30_500 },
  { amount: 350_000, profit: 82_000, gross: 82_000, shares: { investor: 17_500, ali: 5_000 }, net: 59_500 },
  { amount: 205_000, profit: 35_000, gross: 32_000, shares: { aaryj: 25_000 }, net: 10_000 },
  { amount: 350_000, profit: 82_000, gross: 82_000, shares: { ali: 5_000 }, net: 77_000 },
  { amount: 407_000, profit: 102_000, gross: 102_000, shares: { investor: 17_500 }, net: 84_500 },
  { amount: 245_000, profit: 55_000, gross: 55_000, shares: {}, net: 55_000 },
];

test('every complete row of the sheet: net = profit − shares', () => {
  for (const row of SHEET) {
    const round = calculateRound({ amount: row.amount, profit: row.profit, grossProfit: row.gross, shares: row.shares }, cols);
    assert.equal(round.netProfit, row.net, `row with amount ${row.amount}`);
  }
});

test('the totals row adds up the rows', () => {
  const rounds = SHEET.map((row) => calculateRound({ amount: row.amount, profit: row.profit, grossProfit: row.gross, shares: row.shares }, cols));
  const totals = bookTotals(rounds, cols);
  assert.equal(totals.netProfit, SHEET.reduce((sum, row) => sum + row.net, 0));
  assert.equal(totals.shares.investor, 3_500 + 8_000 + 5_000 + 18_500 + 16_500 + 27_000 + 10_500 + 17_500 + 17_500);
  assert.equal(totals.netProfit, totals.profit - totals.totalShares);
  assert.equal(totals.rounds, SHEET.length);
});

test('a book can take net from gross profit instead', () => {
  const round = calculateRound({ amount: 350_000, profit: 80_000, grossProfit: 82_000, shares: {} }, cols, 'GROSS');
  assert.equal(round.base, 82_000);
  assert.equal(round.netProfit, 82_000);
});

test('a loss is kept, never clamped to zero', () => {
  const round = calculateRound({ amount: 100_000, profit: 5_000, grossProfit: 5_000, shares: { investor: 12_000 } }, cols);
  assert.equal(round.netProfit, -7_000);
});

test('a share in a column the book does not have is ignored', () => {
  const round = calculateRound({ amount: 1, profit: 1_000, grossProfit: 1_000, shares: { stranger: 900 } }, cols);
  assert.equal(round.netProfit, 1_000);
});

test('amounts typed the way people type them', () => {
  assert.equal(parseAmount('Rs 18,500'), 18_500);
  assert.equal(parseAmount(' - '), 0);
  assert.equal(parseAmount('abc'), 0);
  assert.equal(parseAmount(22_500.456), 22_500.46);
});

test('renaming a column keeps its key; a new column gets a fresh unique one', () => {
  const next = normalizeShareColumns([
    { key: 'ali', label: 'MAISAM ALI' },
    { label: 'Daddy' },
    { label: 'daddy' },
    { label: '   ' },
  ]);
  assert.deepEqual(next, [
    { key: 'ali', label: 'MAISAM ALI' },
    { key: 'daddy', label: 'Daddy' },
    { key: 'daddy_2', label: 'daddy' },
  ]);
  assert.equal(shareKeyFor('!!!', []), 'share');
});
