import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortExpenses, isExpenseSort, EXPENSE_SORTS } from './expenseSort.ts';

const list = [
  { id: 'a', dayKey: '2026-09-10', amount: 500, title: 'Rent', category: 'Office' },
  { id: 'b', dayKey: '2026-09-03', amount: 9000, title: 'bills', category: 'Utilities' },
  { id: 'c', dayKey: '2026-09-20', amount: 500, title: 'Chai', category: 'Kitchen' },
];
const ids = (rows: typeof list) => rows.map((row) => row.id).join('');

test('by the date typed on the expense, both ways', () => {
  assert.equal(ids(sortExpenses(list, 'DATE_DESC')), 'cab');
  assert.equal(ids(sortExpenses(list, 'DATE_ASC')), 'bac');
});

test('by amount, ties broken newest first', () => {
  assert.equal(ids(sortExpenses(list, 'AMOUNT_DESC')), 'bca');
  assert.equal(ids(sortExpenses(list, 'AMOUNT_ASC')), 'cab');
});

test('by title and category, ignoring case', () => {
  assert.equal(ids(sortExpenses(list, 'TITLE_ASC')), 'bca');
  assert.equal(ids(sortExpenses(list, 'CATEGORY_ASC')), 'cab');
});

test('the input is never reordered in place', () => {
  const before = ids(list);
  sortExpenses(list, 'AMOUNT_ASC');
  assert.equal(ids(list), before);
});

test('only known sorts are accepted', () => {
  for (const sort of EXPENSE_SORTS) assert.equal(isExpenseSort(sort), true);
  assert.equal(isExpenseSort('PRICE'), false);
});
