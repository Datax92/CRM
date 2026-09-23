import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHARE_COLUMNS,
  bookTotals,
  calculateRound,
  checkRoundFunding,
  fundingDeltas,
  fundingLegs,
  isRoundOverdue,
  isRoundReceived,
  possibleFundingLegIds,
  postedEffect,
  receivedDayFor,
  roundProfitEffect,
  readFunding,
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

/* -------------------------------------------------------------------------- */
/* Where the amount came from                                                  */
/* -------------------------------------------------------------------------- */

test('no account is allowed — the amount is then on the sheet only', () => {
  const check = checkRoundFunding(407_000, [{ accountId: '', amount: '' }]);
  assert.equal(check.valid, true);
  assert.deepEqual(check.lines, []);
});

test('one account takes the whole amount without it being typed twice', () => {
  const check = checkRoundFunding(407_000, [{ accountId: 'investorA', amount: '' }]);
  assert.equal(check.valid, true);
  assert.deepEqual(check.lines, [{ accountId: 'investorA', amount: 407_000 }]);
});

test('a split must come to the amount exactly — short and over are both refused', () => {
  assert.equal(checkRoundFunding(407_000, [{ accountId: 'a', amount: 300_000 }, { accountId: 'm', amount: '107,000' }]).valid, true);

  const short = checkRoundFunding(407_000, [{ accountId: 'a', amount: 300_000 }, { accountId: 'm', amount: 100_000 }]);
  assert.equal(short.valid, false);
  // Intl puts a non-breaking space after "Rs".
  assert.match(short.errors[0], /Rs\s7,000 of the Rs\s407,000 amount is not from any account/);

  const over = checkRoundFunding(407_000, [{ accountId: 'a', amount: 300_000 }, { accountId: 'm', amount: 200_000 }]);
  assert.equal(over.valid, false);
  assert.match(over.errors[0], /more than the Rs\s407,000 amount/);
});

test('the same account twice, or a split line with no amount, is refused', () => {
  assert.equal(checkRoundFunding(10, [{ accountId: 'a', amount: 5 }, { accountId: 'a', amount: 5 }]).valid, false);
  assert.equal(checkRoundFunding(10, [{ accountId: 'a', amount: 10 }, { accountId: 'm', amount: '' }]).valid, false);
});

test('out on the date; back on the return date only once there is one', () => {
  const lines = [{ accountId: 'a', amount: 300_000 }, { accountId: 'm', amount: 107_000 }];
  const out = fundingLegs('r1', lines, '2026-08-31', null);
  assert.deepEqual(out.map((leg) => [leg.id, leg.direction, leg.amount, leg.dayKey]), [
    ['invx_r1_out_a', 'OUT', 300_000, '2026-08-31'],
    ['invx_r1_out_m', 'OUT', 107_000, '2026-08-31'],
  ]);

  const back = fundingLegs('r1', lines, '2026-08-31', '2026-09-18');
  assert.equal(back.length, 4);
  assert.deepEqual(back.filter((leg) => leg.kind === 'BACK').map((leg) => [leg.accountId, leg.direction, leg.dayKey]), [
    ['a', 'IN', '2026-09-18'],
    ['m', 'IN', '2026-09-18'],
  ]);
  // Every id an edit might need to clear, returned or not.
  assert.deepEqual(possibleFundingLegIds('r1', lines).sort(), back.map((leg) => leg.id).sort());
});

test('a returned round leaves the account where it started', () => {
  const legs = fundingLegs('r1', [{ accountId: 'a', amount: 407_000 }], '2026-08-31', '2026-09-18');
  assert.equal(fundingDeltas([], legs).size, 0);
  assert.equal(fundingDeltas([], fundingLegs('r1', [{ accountId: 'a', amount: 407_000 }], '2026-08-31', null)).get('a'), -407_000);
});

test('an edit moves each account by the difference only', () => {
  const before = fundingLegs('r1', [{ accountId: 'a', amount: 407_000 }], '2026-08-31', null);

  // Filling in the return date puts the money back.
  const returned = fundingLegs('r1', [{ accountId: 'a', amount: 407_000 }], '2026-08-31', '2026-09-18');
  assert.deepEqual([...fundingDeltas(before, returned)], [['a', 407_000]]);

  // Moving 107,000 of it to M: A gets 107,000 back, M pays 107,000.
  const split = fundingLegs('r1', [{ accountId: 'a', amount: 300_000 }, { accountId: 'm', amount: 107_000 }], '2026-08-31', null);
  assert.deepEqual([...fundingDeltas(before, split)], [['a', 107_000], ['m', -107_000]]);

  // Deleting the round undoes whatever is posted.
  assert.deepEqual([...fundingDeltas(before, [])], [['a', 407_000]]);
});

test('stored funding is read back strictly', () => {
  assert.deepEqual(readFunding([{ accountId: 'a', amount: 5 }, { accountId: '', amount: 5 }, { accountId: 'm', amount: 0 }, null]), [
    { accountId: 'a', amount: 5 },
  ]);
  assert.deepEqual(readFunding(undefined), []);
});

test('a round saved before Received existed reads as received — its money was already posted', () => {
  assert.equal(isRoundReceived({}), true);
  assert.equal(isRoundReceived({ received: undefined }), true);
  assert.equal(isRoundReceived({ received: true }), true);
  assert.equal(isRoundReceived({ received: false }), false);
  assert.equal(isRoundReceived(null), true);
});

test('the received day falls back to the return date, the day an older round was posted on', () => {
  assert.equal(receivedDayFor({ receivedDayKey: '2026-09-20', returnDayKey: '2026-09-18', dayKey: '2026-08-31' }), '2026-09-20');
  assert.equal(receivedDayFor({ returnDayKey: '2026-09-18', dayKey: '2026-08-31' }), '2026-09-18');
  assert.equal(receivedDayFor({ receivedDayKey: 'junk', dayKey: '2026-08-31' }), '2026-08-31');
});

test('a round not received has banked no profit — a loss included', () => {
  assert.equal(roundProfitEffect(82_000, false), 0);
  assert.equal(roundProfitEffect(-5_000, false), 0);
  assert.equal(roundProfitEffect(82_000, true), 82_000);
  assert.equal(roundProfitEffect(-5_000, true), -5_000);
});

test('what is posted is read with its sign, and only when posted', () => {
  assert.equal(postedEffect({ status: 'POSTED', direction: 'IN', amount: 82_000 }), 82_000);
  assert.equal(postedEffect({ status: 'POSTED', direction: 'OUT', amount: 5_000 }), -5_000);
  assert.equal(postedEffect({ status: 'VOID', direction: 'IN', amount: 82_000 }), 0);
  assert.equal(postedEffect(null), 0);
});

test('not received: the capital stays out; received: it comes back on the received day', () => {
  const lines = [{ accountId: 'investorA', amount: 407_000 }];
  const pending = fundingLegs('r1', lines, '2026-09-19', null);
  assert.deepEqual(pending.map((leg) => leg.kind), ['OUT']);

  const received = fundingLegs('r1', lines, '2026-09-19', '2026-10-09');
  const back = received.find((leg) => leg.kind === 'BACK');
  assert.equal(back?.dayKey, '2026-10-09');

  // Marking it received puts the whole amount back into the account it left.
  assert.deepEqual([...fundingDeltas(pending, received)], [['investorA', 407_000]]);
  // And undoing it takes it back out again.
  assert.deepEqual([...fundingDeltas(received, pending)], [['investorA', -407_000]]);
});

test('overdue means past the return date and still not received', () => {
  assert.equal(isRoundOverdue({ received: false, returnDayKey: '2026-09-18' }, '2026-09-23'), true);
  assert.equal(isRoundOverdue({ received: false, returnDayKey: '2026-09-23' }, '2026-09-23'), false);
  assert.equal(isRoundOverdue({ received: true, returnDayKey: '2026-09-18' }, '2026-09-23'), false);
  assert.equal(isRoundOverdue({ received: false, returnDayKey: null }, '2026-09-23'), false);
});
