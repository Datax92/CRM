import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allowedExpenseTransitions,
  expensesByCategory,
  expensesByPeriod,
  normalizeExpenseStatus,
  summarizeExpenses,
  trendPercent,
  type ExpenseStatus,
  type OfficeExpense,
} from './officeExpenses.ts';

const expense = (patch: Partial<OfficeExpense> = {}): OfficeExpense => ({
  id: 'e1',
  title: 'Office rent',
  category: 'Rent',
  amount: 100_000,
  description: null,
  status: 'APPROVED',
  paidBy: null,
  paymentMethod: null,
  receiptUrl: null,
  receiptName: null,
  addedByUid: 'admin',
  addedByEmail: null,
  dayKey: '2026-09-01',
  decidedByUid: null,
  decidedByName: null,
  decisionNote: null,
  ...patch,
});

/* -------------------------------------------------------------------------- */
/* Legacy records                                                              */
/* -------------------------------------------------------------------------- */

test('an expense written before approvals existed reads as approved', () => {
  // Re-opening a year of history as "Pending" would be a fiction, and would
  // also change every total that has ever been reported.
  assert.equal(normalizeExpenseStatus(undefined), 'APPROVED');
  assert.equal(normalizeExpenseStatus(null), 'APPROVED');
  assert.equal(normalizeExpenseStatus('nonsense'), 'APPROVED');
});

test('a real status survives normalisation', () => {
  assert.equal(normalizeExpenseStatus('PENDING'), 'PENDING');
  assert.equal(normalizeExpenseStatus('REJECTED'), 'REJECTED');
  assert.equal(normalizeExpenseStatus('APPROVED'), 'APPROVED');
});

/* -------------------------------------------------------------------------- */
/* Summaries                                                                   */
/* -------------------------------------------------------------------------- */

test('total counts everything, spend counts only what was approved', () => {
  const summary = summarizeExpenses([
    expense({ id: 'a', amount: 100_000, status: 'APPROVED' }),
    expense({ id: 'b', amount: 40_000, status: 'PENDING' }),
    expense({ id: 'c', amount: 25_000, status: 'REJECTED' }),
  ]);

  assert.equal(summary.total, 165_000, 'everything invoiced');
  assert.equal(summary.spend, 100_000, 'only what was approved is a cost');
  assert.equal(summary.pending, 40_000);
  assert.equal(summary.rejected, 25_000);
  assert.equal(summary.count, 3);
  assert.equal(summary.pendingCount, 1);
});

test('an empty ledger summarises to zeros rather than NaN', () => {
  const summary = summarizeExpenses([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.spend, 0);
  assert.equal(summary.count, 0);
});

/* -------------------------------------------------------------------------- */
/* Category breakdown                                                          */
/* -------------------------------------------------------------------------- */

test('the category chart shows approved spend only, largest first', () => {
  const rows = expensesByCategory([
    expense({ id: 'a', category: 'Rent', amount: 100_000 }),
    expense({ id: 'b', category: 'Internet', amount: 20_000 }),
    expense({ id: 'c', category: 'Internet', amount: 10_000 }),
    // A pending invoice is not yet a cost, and a rejected one never will be.
    expense({ id: 'd', category: 'Marketing', amount: 500_000, status: 'PENDING' }),
    expense({ id: 'e', category: 'Equipment', amount: 90_000, status: 'REJECTED' }),
  ]);

  assert.deepEqual(
    rows.map((row) => row.category),
    ['Rent', 'Internet'],
    'neither the pending nor the rejected category appears at all'
  );
  assert.equal(rows[0].amount, 100_000);
  assert.equal(rows[1].amount, 30_000);
  assert.equal(rows[1].count, 2);
});

test('shares are a percentage of approved spend and add to about 100', () => {
  const rows = expensesByCategory([
    expense({ id: 'a', category: 'Rent', amount: 75_000 }),
    expense({ id: 'b', category: 'Internet', amount: 25_000 }),
  ]);

  assert.equal(rows[0].share, 75);
  assert.equal(rows[1].share, 25);
});

test('an expense with no category lands in Other rather than an empty label', () => {
  const rows = expensesByCategory([expense({ category: '' })]);
  assert.equal(rows[0].category, 'Other');
});

/* -------------------------------------------------------------------------- */
/* Trends                                                                      */
/* -------------------------------------------------------------------------- */

test('periods group by day, month and year from the same key', () => {
  const ledger = [
    expense({ id: 'a', dayKey: '2026-08-31', amount: 10_000 }),
    expense({ id: 'b', dayKey: '2026-09-01', amount: 20_000 }),
    expense({ id: 'c', dayKey: '2026-09-02', amount: 30_000 }),
    expense({ id: 'd', dayKey: '2025-09-02', amount: 5_000 }),
  ];

  assert.deepEqual(expensesByPeriod(ledger, 'day').map((row) => row.key), [
    '2025-09-02',
    '2026-08-31',
    '2026-09-01',
    '2026-09-02',
  ]);

  const months = expensesByPeriod(ledger, 'month');
  assert.deepEqual(months.map((row) => row.key), ['2025-09', '2026-08', '2026-09']);
  assert.equal(months[2].amount, 50_000, 'both September days together');

  const years = expensesByPeriod(ledger, 'year');
  assert.deepEqual(years.map((row) => row.key), ['2025', '2026']);
  assert.equal(years[1].amount, 60_000);
});

test('a trend needs two periods to exist', () => {
  assert.equal(trendPercent([]), null);
  assert.equal(trendPercent([{ key: '2026-09', amount: 100, count: 1 }]), null);
});

test('a trend against a zero month is null, not infinity', () => {
  assert.equal(
    trendPercent([
      { key: '2026-08', amount: 0, count: 0 },
      { key: '2026-09', amount: 100, count: 1 },
    ]),
    null
  );
});

test('a trend reports the change between the last two periods', () => {
  assert.equal(
    trendPercent([
      { key: '2026-07', amount: 999, count: 1 },
      { key: '2026-08', amount: 100_000, count: 1 },
      { key: '2026-09', amount: 125_000, count: 1 },
    ]),
    25,
    'only the last two count — July is not in the comparison'
  );

  assert.equal(
    trendPercent([
      { key: '2026-08', amount: 100_000, count: 1 },
      { key: '2026-09', amount: 60_000, count: 1 },
    ]),
    -40
  );
});

/* -------------------------------------------------------------------------- */
/* Status changes                                                              */
/* -------------------------------------------------------------------------- */

test('a decision can be reversed — the wrong button does get pressed', () => {
  const from: ExpenseStatus = 'REJECTED';
  assert.deepEqual(allowedExpenseTransitions(from).sort(), ['APPROVED', 'PENDING']);
});

test('a status never transitions to itself', () => {
  for (const status of ['PENDING', 'APPROVED', 'REJECTED'] as ExpenseStatus[]) {
    assert.equal(allowedExpenseTransitions(status).includes(status), false);
    assert.equal(allowedExpenseTransitions(status).length, 2);
  }
});
