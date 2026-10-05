import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readAmanatEntry,
  calculateAmanatTotals,
  amanatPaymentState,
  pendingOfAmanat,
  planReceiptLeg,
  liveReceiptLegs,
  amanatUsage,
  heldInAccountId,
  amanatReceiptLegId,
  AMANAT_ACCOUNT_ID,
  type AmanatEntry,
  type AmanatLedgerRow,
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

/* -------------------------------------------------------------------------- */
/* Amanat as an account                                                        */
/* -------------------------------------------------------------------------- */

const row = (over: Partial<AmanatLedgerRow> & { id: string }): AmanatLedgerRow => ({
  accountId: AMANAT_ACCOUNT_ID,
  direction: 'IN',
  amount: 0,
  status: 'POSTED',
  sourceModule: 'AMANAT',
  sourceId: 'e1',
  ...over,
});

test('amanat receipt: a new one posts one row into the chosen account', () => {
  const plan = planReceiptLeg('e1', [], { accountId: AMANAT_ACCOUNT_ID, amount: 200_000 });
  assert.deepEqual(plan.removeIds, []);
  assert.deepEqual(plan.write, { id: amanatReceiptLegId('e1'), accountId: AMANAT_ACCOUNT_ID, amount: 200_000 });
  assert.deepEqual([...plan.deltas], [[AMANAT_ACCOUNT_ID, 200_000]]);
});

test('amanat receipt: changing the amount moves the balance by the difference only', () => {
  const posted = [row({ id: amanatReceiptLegId('e1'), amount: 200_000 })];
  const plan = planReceiptLeg('e1', posted, { accountId: AMANAT_ACCOUNT_ID, amount: 150_000 });
  assert.deepEqual(plan.removeIds, []);
  assert.deepEqual([...plan.deltas], [[AMANAT_ACCOUNT_ID, -50_000]]);
});

test('amanat receipt: saving it unchanged moves nothing', () => {
  const posted = [row({ id: amanatReceiptLegId('e1'), amount: 200_000 })];
  const plan = planReceiptLeg('e1', posted, { accountId: AMANAT_ACCOUNT_ID, amount: 200_000 });
  assert.equal(plan.deltas.size, 0);
});

test('amanat receipt: moving it takes it out of the account that really holds it', () => {
  // The entry may say one account while its row sits in another; the row wins.
  const posted = [row({ id: 'legacy-random-id', accountId: 'bank', amount: 200_000 })];
  const plan = planReceiptLeg('e1', posted, { accountId: AMANAT_ACCOUNT_ID, amount: 200_000 });
  assert.deepEqual(plan.removeIds, ['legacy-random-id']);
  assert.deepEqual(new Map(plan.deltas), new Map([['bank', -200_000], [AMANAT_ACCOUNT_ID, 200_000]]));
});

test('amanat receipt: held in no account removes the row and writes none', () => {
  const posted = [row({ id: amanatReceiptLegId('e1'), amount: 25_000 })];
  const plan = planReceiptLeg('e1', posted, { accountId: null, amount: 25_000 });
  assert.deepEqual(plan.removeIds, [amanatReceiptLegId('e1')]);
  assert.equal(plan.write, null);
  assert.deepEqual([...plan.deltas], [[AMANAT_ACCOUNT_ID, -25_000]]);
});

test('amanat receipt: a reversed row and its reversal are history, not money to move', () => {
  const posted = [
    row({ id: 'a', amount: 10_000, reversedBy: 'b' }),
    row({ id: 'b', amount: 10_000, direction: 'OUT', reversalOf: 'a' }),
  ];
  assert.deepEqual(liveReceiptLegs(posted), []);
  const plan = planReceiptLeg('e1', posted, { accountId: AMANAT_ACCOUNT_ID, amount: 10_000 });
  assert.deepEqual(plan.removeIds, []);
  assert.deepEqual([...plan.deltas], [[AMANAT_ACCOUNT_ID, 10_000]]);
});

test('amanat usage: an expense paid from Amanat is used; Amanat\'s own rows are not', () => {
  const rows = [
    row({ id: 'in', amount: 200_000 }),
    row({ id: 'returned', direction: 'OUT', amount: 20_000 }),
    row({ id: 'office', direction: 'OUT', amount: 50_000, sourceModule: 'OFFICE_EXPENSE', sourceId: 'x' }),
    row({ id: 'salary', direction: 'OUT', amount: 30_000, sourceModule: 'PAYROLL', sourceId: 'p' }),
    row({ id: 'elsewhere', accountId: 'bank', direction: 'OUT', amount: 999, sourceModule: 'OFFICE_EXPENSE' }),
    row({ id: 'voided', direction: 'OUT', amount: 5_000, sourceModule: 'MANUAL', status: 'VOIDED' }),
  ];
  const usage = amanatUsage(new Set([AMANAT_ACCOUNT_ID]), rows);
  assert.equal(usage.used, 80_000);
  assert.deepEqual(usage.lines.map((line) => line.id), ['office', 'salary']);
});

test('amanat usage: money put back brings the figure down', () => {
  const rows = [
    row({ id: 'office', direction: 'OUT', amount: 50_000, sourceModule: 'OFFICE_EXPENSE' }),
    row({ id: 'back', direction: 'IN', amount: 50_000, sourceModule: 'TRANSFER' }),
  ];
  assert.equal(amanatUsage(new Set([AMANAT_ACCOUNT_ID]), rows).used, 0);
});

test('amanat in hand: received, less returned, less used, is what the account holds', () => {
  const entries: AmanatEntry[] = [
    readAmanatEntry({ id: 'e1', type: 'RECEIVED', party: 'A', amount: 200_000 }),
    readAmanatEntry({ id: 'e2', type: 'EXPENSE', party: 'A', amount: 20_000, paidAmount: 20_000 }),
  ];
  const rows = [
    row({ id: 'in', amount: 200_000 }),
    row({ id: 'returned', direction: 'OUT', amount: 20_000, sourceId: 'e2' }),
    row({ id: 'office', direction: 'OUT', amount: 50_000, sourceModule: 'OFFICE_EXPENSE' }),
  ];
  const totals = calculateAmanatTotals(entries);
  const usage = amanatUsage(new Set([AMANAT_ACCOUNT_ID]), rows);
  const balance = rows.reduce((sum, r) => sum + (r.direction === 'IN' ? r.amount : -r.amount), 0);
  assert.equal(totals.trustBalance, 180_000);
  assert.equal(totals.trustBalance - usage.used, 130_000);
  assert.equal(balance, 130_000);
});

test('amanat held in: the ledger answers before the entry does', () => {
  const entry = { id: 'e1', depositAccountId: null };
  assert.equal(heldInAccountId(entry, [row({ id: 'x', accountId: 'bank', amount: 1 })]), 'bank');
  assert.equal(heldInAccountId({ id: 'e1', depositAccountId: 'stored' }, []), 'stored');
  assert.equal(heldInAccountId(entry, [row({ id: 'x', sourceId: 'another', amount: 1 })]), null);
});
