import test from 'node:test';
import assert from 'node:assert/strict';

import { paymentState, PAYMENT_STATE_LABELS, PERSONAL_EXPENSE_CATEGORIES } from './personalExpenses.ts';

/* -------------------------------------------------------------------------- */
/* The state is derived, never stored                                          */
/* -------------------------------------------------------------------------- */

test('nothing paid back is Unpaid', () => {
  assert.equal(paymentState({ amount: 3000, paidAmount: 0 }), 'UNPAID');
});

test('some of it paid back is Part paid', () => {
  assert.equal(paymentState({ amount: 3000, paidAmount: 800 }), 'PART_PAID');
});

test('all of it paid back is Paid', () => {
  assert.equal(paymentState({ amount: 3000, paidAmount: 3000 }), 'PAID');
});

test('over-paid still reads as Paid, never as something worse', () => {
  // Reachable by editing the amount down after a payment. The screen must not
  // invent a fourth state for it.
  assert.equal(paymentState({ amount: 1000, paidAmount: 4000 }), 'PAID');
});

test('a record written before the ledger reads as Unpaid, not as Paid', () => {
  // `paidAmount` is absent on every record that predates the ledger, and an
  // absent field means nothing has been paid back — the opposite answer would
  // report the company as square with somebody it still owes.
  assert.equal(paymentState({ amount: 3000, paidAmount: undefined as unknown as number }), 'UNPAID');
  assert.equal(paymentState({ amount: 3000, paidAmount: NaN }), 'UNPAID');
});

test('a zero-amount record is not Paid by having nothing paid on it', () => {
  assert.equal(paymentState({ amount: 0, paidAmount: 0 }), 'UNPAID');
});

test('every state has a label, and none of them is jargon', () => {
  // The whole point of the rewrite: no "claim", "claimant", "submitted",
  // "approved" or "reimbursed" survives on this screen.
  const words = Object.values(PAYMENT_STATE_LABELS).join(' ').toLowerCase();
  for (const banned of ['claim', 'submit', 'approve', 'reimburse']) {
    assert.equal(words.includes(banned), false, `"${banned}" is back in the labels`);
  }
  assert.deepEqual(Object.values(PAYMENT_STATE_LABELS), ['Unpaid', 'Part paid', 'Paid']);
});

test('the built-in categories are personal spending, not company bills', () => {
  // "Rent" and "Utilities" belong to office expenses; mixing the two lists is
  // what keeping them separate avoids.
  for (const company of ['Rent', 'Utilities', 'Salaries']) {
    assert.equal((PERSONAL_EXPENSE_CATEGORIES as readonly string[]).includes(company), false);
  }
  assert.equal((PERSONAL_EXPENSE_CATEGORIES as readonly string[]).includes('Fuel'), true);
});
