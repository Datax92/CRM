import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BORROWER_MAX,
  checkLoanReturn,
  checkLoanToggle,
  loanReturnLabel,
  normalizeBorrower,
  readLoan,
} from './spendingLoan.ts';

test('a borrower name is trimmed, single-spaced and capped; junk is empty', () => {
  assert.equal(normalizeBorrower('  Muhammad   Hussain '), 'Muhammad Hussain');
  assert.equal(normalizeBorrower(''), '');
  assert.equal(normalizeBorrower('   '), '');
  assert.equal(normalizeBorrower(42), '');
  assert.equal(normalizeBorrower(null), '');
  assert.equal(normalizeBorrower('x'.repeat(200)).length, BORROWER_MAX);
});

test('no name means not a loan, whatever else is stored', () => {
  const reading = readLoan({ loanReturned: 5000 }, 37_500);
  assert.equal(reading.isLoan, false);
  assert.equal(reading.owed, 0);
});

test("the owner's two loans: owed is what left less what came back", () => {
  const faysal = readLoan({ loanTo: 'Muhammad Hussain' }, 37_500);
  assert.deepEqual(faysal, { isLoan: true, to: 'Muhammad Hussain', lent: 37_500, returned: 0, owed: 37_500, settled: false });

  const ubl = readLoan({ loanTo: 'Muhammad Hussain', loanReturned: 4_879 }, 14_879);
  assert.equal(ubl.owed, 10_000);
  assert.equal(ubl.settled, false);

  const back = readLoan({ loanTo: 'Muhammad Hussain', loanReturned: 14_879 }, 14_879);
  assert.equal(back.owed, 0);
  assert.equal(back.settled, true);
});

test('returned is clamped to what was lent, so owed is never negative', () => {
  const reading = readLoan({ loanTo: 'A', loanReturned: 50_000 }, 30_000);
  assert.equal(reading.returned, 30_000);
  assert.equal(reading.owed, 0);
});

test('an unpaid spending record has lent nothing and is not "settled"', () => {
  const reading = readLoan({ loanTo: 'A' }, 0);
  assert.equal(reading.lent, 0);
  assert.equal(reading.owed, 0);
  assert.equal(reading.settled, false);
});

test('a repayment must be positive and no more than is owed', () => {
  assert.deepEqual(checkLoanReturn({ owed: 10_000, amount: 10_000, borrower: 'A' }), []);
  assert.deepEqual(checkLoanReturn({ owed: 10_000, amount: 2_500, borrower: 'A' }), []);
  assert.equal(checkLoanReturn({ owed: 10_000, amount: 10_001, borrower: 'A' }).length, 1);
  assert.equal(checkLoanReturn({ owed: 10_000, amount: 0, borrower: 'A' }).length, 1);
  assert.equal(checkLoanReturn({ owed: 10_000, amount: 'abc', borrower: 'A' }).length, 1);
  assert.match(checkLoanReturn({ owed: 0, amount: 1, borrower: 'A' })[0], /Nothing is owed/);
});

test('marking needs a name and refuses a spending already paid back', () => {
  assert.deepEqual(checkLoanToggle({ makeLoan: true, borrower: 'A', returned: 0 }), []);
  assert.match(checkLoanToggle({ makeLoan: true, borrower: '', returned: 0 })[0], /who/);
  assert.match(checkLoanToggle({ makeLoan: true, borrower: 'A', returned: 0, paidBack: 1 })[0], /paid back/);
});

test('un-marking is refused once money has come back', () => {
  assert.deepEqual(checkLoanToggle({ makeLoan: false, borrower: '', returned: 0 }), []);
  assert.match(checkLoanToggle({ makeLoan: false, borrower: '', returned: 1 })[0], /Remove those returns/);
});

test('a repayment row names the borrower and the spending', () => {
  assert.equal(loanReturnLabel('Muhammad Hussain', '14,879 MUHAMMAD HUSSAIN LOAN'), 'Loan returned — Muhammad Hussain — 14,879 MUHAMMAD HUSSAIN LOAN');
  assert.equal(loanReturnLabel('A', '  '), 'Loan returned — A');
});
