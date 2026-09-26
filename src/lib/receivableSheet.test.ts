import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RECEIVABLE_GROUPS,
  entryState,
  normalizeGroups,
  pendingOf,
  readSheetEntry,
  sheetTotals,
} from './receivableSheet.ts';

/** The owner's OFFICIAL / REGULAR RECEIVABLES block, as it stands in the workbook. */
const REGULAR = [
  ['MEHDI', 2100], ['AFHAM', 1579], ['SUNDAS', 2660], ['TAYYAB', 4290], ['QALBE', 3500],
  ['BILAL', 5880], ['SAIF', 1400], ['BHATTI', 8500], ['MAMO QAISER', 1000], ['DILAWAR', 4297],
] as const;

test("the workbook's regular receivables total 35,206, all still pending", () => {
  const entries = REGULAR.map(([name, amount]) => ({ name, amount, settled: 0 }));
  const totals = sheetTotals(entries);
  assert.equal(totals.amount, 35_206);
  assert.equal(totals.pending, 35_206);
  assert.equal(totals.settled, 0);
});

test('pending = owed − settled, never negative', () => {
  assert.equal(pendingOf({ amount: 8_500, settled: 3_000 }), 5_500);
  assert.equal(pendingOf({ amount: 1_000, settled: 1_500 }), 0);
});

test('state: pending, part settled, settled, and an overdue payable', () => {
  const today = '2026-09-15';
  assert.equal(entryState({ side: 'RECEIVABLE', amount: 100, settled: 0, returnDayKey: null }, today), 'OPEN');
  assert.equal(entryState({ side: 'RECEIVABLE', amount: 100, settled: 40, returnDayKey: null }, today), 'PART');
  assert.equal(entryState({ side: 'RECEIVABLE', amount: 100, settled: 100, returnDayKey: null }, today), 'SETTLED');
  assert.equal(entryState({ side: 'PAYABLE', amount: 100, settled: 20, returnDayKey: '2026-09-01' }, today), 'OVERDUE');
  assert.equal(entryState({ side: 'PAYABLE', amount: 100, settled: 100, returnDayKey: '2026-09-01' }, today), 'SETTLED');
});

test('groups: trimmed, de-duplicated, never empty', () => {
  assert.deepEqual(normalizeGroups([' Staff ', 'staff', '', 'Customers'], DEFAULT_RECEIVABLE_GROUPS), ['Staff', 'Customers']);
  assert.deepEqual(normalizeGroups([], DEFAULT_RECEIVABLE_GROUPS), DEFAULT_RECEIVABLE_GROUPS);
});

test('a stored row with missing fields still reads', () => {
  const entry = readSheetEntry({ id: 'x', side: 'PAYABLE', amount: '75000' });
  assert.equal(entry.amount, 75_000);
  assert.equal(entry.group, 'Official / Unofficial');
  assert.equal(entry.name, 'Unnamed');
});

test('settling moves money the right way, and the account part never exceeds what is settled', async () => {
  const { settlementDirection, readSheetEntry } = await import('./receivableSheet.ts');
  assert.equal(settlementDirection('RECEIVABLE'), 'IN');
  assert.equal(settlementDirection('PAYABLE'), 'OUT');
  assert.equal(readSheetEntry({ id: 'a', amount: 100, settled: 40, accountSettled: 90 }).accountSettled, 40);
  assert.equal(readSheetEntry({ id: 'b', amount: 100, settled: 40 }).accountSettled, 0);
});
