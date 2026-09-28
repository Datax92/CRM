import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readAmanatEntry,
  calculateAmanatTotals,
  amanatPaymentState,
  pendingOfAmanat,
  type AmanatEntry,
} from './amanatSheet.ts';

test('amanatSheet: reads raw entry correctly', () => {
  const raw = {
    id: 'entry-1',
    type: 'RECEIVED',
    party: 'Haji Sb',
    title: 'Plot Token Trust',
    amount: 500000,
    paidAmount: 0,
    dayKey: '2026-09-28',
    purpose: 'Property Deal',
    notes: 'To be held until registry',
    depositAccountId: 'acc-bank-1',
    depositAccountName: 'Meezan Bank',
    history: [],
  };

  const parsed = readAmanatEntry(raw);
  assert.equal(parsed.id, 'entry-1');
  assert.equal(parsed.type, 'RECEIVED');
  assert.equal(parsed.party, 'Haji Sb');
  assert.equal(parsed.amount, 500000);
  assert.equal(parsed.depositAccountId, 'acc-bank-1');
});

test('amanatSheet: calculates payment state and pending accurately', () => {
  const unpaid: AmanatEntry = {
    id: 'e1',
    type: 'EXPENSE',
    party: 'Haji Sb',
    title: 'Site Repair',
    amount: 100000,
    paidAmount: 0,
    dayKey: '2026-09-28',
    purpose: null,
    notes: null,
    history: [],
  };
  assert.equal(amanatPaymentState(unpaid), 'UNPAID');
  assert.equal(pendingOfAmanat(unpaid), 100000);

  const partial: AmanatEntry = {
    ...unpaid,
    paidAmount: 40000,
  };
  assert.equal(amanatPaymentState(partial), 'PART');
  assert.equal(pendingOfAmanat(partial), 60000);

  const fullyPaid: AmanatEntry = {
    ...unpaid,
    paidAmount: 100000,
  };
  assert.equal(amanatPaymentState(fullyPaid), 'PAID');
  assert.equal(pendingOfAmanat(fullyPaid), 0);
});

test('amanatSheet: calculates totals and trust balance in hand', () => {
  const entries: AmanatEntry[] = [
    {
      id: 'r1',
      type: 'RECEIVED',
      party: 'Haji Sb',
      title: 'Trust Deposit',
      amount: 500000,
      paidAmount: 0,
      dayKey: '2026-09-20',
      purpose: null,
      notes: null,
      history: [],
    },
    {
      id: 'e1',
      type: 'EXPENSE',
      party: 'Haji Sb',
      title: 'Legal Registry',
      amount: 150000,
      paidAmount: 150000,
      dayKey: '2026-09-22',
      purpose: null,
      notes: null,
      history: [],
    },
    {
      id: 'e2',
      type: 'EXPENSE',
      party: 'Haji Sb',
      title: 'Contractor Token',
      amount: 50000,
      paidAmount: 20000,
      dayKey: '2026-09-25',
      purpose: null,
      notes: null,
      history: [],
    },
  ];

  const totals = calculateAmanatTotals(entries);
  assert.equal(totals.totalReceived, 500000);
  assert.equal(totals.totalExpenses, 200000);
  assert.equal(totals.totalPaid, 170000);
  assert.equal(totals.pendingExpenses, 30000);
  assert.equal(totals.trustBalance, 330000); // 500,000 - 170,000
  assert.equal(totals.pendingCount, 1);
});
