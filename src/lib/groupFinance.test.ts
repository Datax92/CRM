import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GROUP_FIELDS,
  EMPTY_MONTH,
  closingFrom,
  columnDefinitions,
  computeGroupMonth,
  displayedTotals,
  isIncomeMovement,
  monthLabel,
  monthsOfYear,
  normalizeGroupFields,
  readGroupMonth,
  shiftMonth,
  type LedgerRowInput,
} from './groupFinance.ts';

const names = new Map([
  ['car_sale', 'Car Sale'],
  ['mahziyar_marketing', 'Mahziyar Marketing'],
  ['bank', 'Meezan Bank'],
]);

const txn = (over: Partial<LedgerRowInput>): LedgerRowInput => ({
  id: 't',
  accountId: 'car_sale',
  direction: 'IN',
  amount: 0,
  type: 'INCOME',
  dayKey: '2026-09-10',
  sourceModule: 'CAR_SALE',
  sourceLabel: 'Honda City — car sold',
  status: 'POSTED',
  ...over,
});

const transactions: LedgerRowInput[] = [
  txn({ id: 'car', amount: 87_500 }),
  txn({ id: 'mkt', accountId: 'mahziyar_marketing', sourceModule: 'MARKETING_INCOME', amount: 40_000, sourceLabel: 'Imran — sold lead' }),
  txn({ id: 'loss', amount: 2_500, direction: 'OUT', type: 'EXPENSE', sourceLabel: 'City 2006 — car sold at a loss' }),
  // Not income: an expense paid, a transfer, a committee pot filling up, last month's sale, a voided sale.
  txn({ id: 'paid', accountId: 'bank', direction: 'OUT', type: 'EXPENSE', sourceModule: 'OFFICE_EXPENSE', amount: 9_000 }),
  txn({ id: 'xfer', accountId: 'bank', type: 'TRANSFER', sourceModule: 'TRANSFER', amount: 100_000 }),
  txn({ id: 'aug', amount: 50_000, dayKey: '2026-08-31' }),
  txn({ id: 'void', amount: 10_000, status: 'VOIDED' }),
  // Income put into an account by hand counts.
  txn({ id: 'manual', accountId: 'bank', sourceModule: 'MANUAL', amount: 20_000, sourceLabel: 'Rent received' }),
];

const office = [
  { id: 'o1', dayKey: '2026-09-01', amount: 30_000, status: 'APPROVED' },
  { id: 'o2', dayKey: '2026-09-02', amount: 5_000 }, // predates approvals → approved
  { id: 'o3', dayKey: '2026-09-03', amount: 7_000, status: 'PENDING' },
  { id: 'o4', dayKey: '2026-09-04', amount: 8_000, status: 'REJECTED' },
  { id: 'o5', dayKey: '2026-10-01', amount: 99_000, status: 'APPROVED' },
];
const personal = [
  { id: 'p1', dayKey: '2026-09-06', amount: 40_150 },
  { id: 'p2', dayKey: '2026-09-14', amount: 7_000 },
];

const base = {
  monthKey: '2026-09',
  transactions,
  accountNames: names,
  officeExpenses: office,
  personalExpenses: personal,
  fields: DEFAULT_GROUP_FIELDS,
};

test('income is the income modules plus manual income, signed, for the month only', () => {
  const month = computeGroupMonth({ ...base, month: null });
  assert.deepEqual(month.incomeLines.map((line) => line.id).sort(), ['car', 'loss', 'manual', 'mkt']);
  assert.equal(month.columns.find((c) => c.key === 'income')!.value, 87_500 + 40_000 - 2_500 + 20_000);
  assert.equal(isIncomeMovement(txn({ sourceModule: 'TRANSFER', type: 'TRANSFER' })), false);
});

test('spent combines approved office and all personal; remaining is made − spent', () => {
  const month = computeGroupMonth({ ...base, month: null });
  assert.equal(month.columns.find((c) => c.key === 'office')!.value, 35_000);
  assert.equal(month.columns.find((c) => c.key === 'personal')!.value, 47_150);
  assert.equal(month.officeCount, 2);
  assert.equal(month.spent, 82_150);
  assert.equal(month.income, 145_000);
  assert.equal(month.remaining, 145_000 - 82_150);
});

test('lines added by hand fill their field, and an income field adds to total income', () => {
  const fields = [...DEFAULT_GROUP_FIELDS, { key: 'rent_in', label: 'Rent in', type: 'INCOME' as const }];
  const month = computeGroupMonth({
    ...base,
    fields,
    month: {
      ...EMPTY_MONTH,
      entries: [
        { id: 'e1', fieldKey: 'committee_kist', amount: 50_000, dayKey: '2026-09-05', note: null },
        { id: 'e2', fieldKey: 'committee_kist', amount: 25_000, dayKey: '2026-09-20', note: null },
        { id: 'e3', fieldKey: 'rent_in', amount: 15_000, dayKey: '2026-09-01', note: null },
      ],
    },
  });
  assert.equal(month.columns.find((c) => c.key === 'committee_kist')!.value, 75_000);
  assert.equal(month.income, 145_000 + 15_000);
  assert.equal(month.spent, 82_150 + 75_000);
});

test('an income line can be corrected, or set to 0 to leave it out, and it says so', () => {
  const month = computeGroupMonth({
    ...base,
    month: { ...EMPTY_MONTH, incomeEdits: { car: { amount: 80_000 }, manual: { amount: 0 } } },
  });
  const car = month.incomeLines.find((line) => line.id === 'car')!;
  assert.equal(car.auto, 87_500);
  assert.equal(car.amount, 80_000);
  assert.equal(car.edited, true);
  assert.equal(month.columns.find((c) => c.key === 'income')!.value, 80_000 + 40_000 - 2_500);
});

test('a cell override wins, keeps the automatic figure beside it, and moves the totals', () => {
  const month = computeGroupMonth({ ...base, month: { ...EMPTY_MONTH, cellOverrides: { office: 90_000 } } });
  const officeColumn = month.columns.find((c) => c.key === 'office')!;
  assert.equal(officeColumn.auto, 35_000);
  assert.equal(officeColumn.value, 90_000);
  assert.equal(officeColumn.overridden, true);
  assert.equal(month.spent, 47_150 + 90_000);
});

test('a closed month shows its frozen figures, and notices when the records moved since', () => {
  const live = computeGroupMonth({ ...base, month: null });
  const closing = closingFrom(live, 'Client Admin', new Date('2026-10-01T10:00:00Z'));
  const closed = { ...EMPTY_MONTH, status: 'CLOSED' as const, closing };
  assert.equal(displayedTotals(live, closed).drifted, false);
  assert.equal(displayedTotals(live, closed).column('office'), 35_000);

  const later = computeGroupMonth({
    ...base,
    officeExpenses: [...office, { id: 'o6', dayKey: '2026-09-30', amount: 1_000 }],
    month: closed,
  });
  const shown = displayedTotals(later, closed);
  assert.equal(shown.frozen, true);
  assert.equal(shown.spent, 82_150);
  assert.equal(shown.drifted, true);
});

test('columns read in sheet order, archived fields hidden, builtin labels editable', () => {
  const columns = columnDefinitions(
    [
      { key: 'investor', label: 'Investor', type: 'EXPENSE' },
      { key: 'rent_in', label: 'Rent in', type: 'INCOME' },
      { key: 'gone', label: 'Old', type: 'EXPENSE', archived: true },
    ],
    { office: 'OFFICE EXPENCE' }
  );
  assert.deepEqual(columns.map((c) => c.key), ['income', 'rent_in', 'personal', 'office', 'investor']);
  assert.equal(columns.find((c) => c.key === 'office')!.label, 'OFFICE EXPENCE');
});

test('fields: new keys never collide with each other or with the builtin columns', () => {
  const fields = normalizeGroupFields([{ label: 'Office' }, { label: 'office' }, { label: 'Income', type: 'INCOME' }, { label: '' }]);
  assert.deepEqual(fields.map((f) => f.key), ['office_2', 'office_3', 'income_2']);
  assert.equal(fields[2].type, 'INCOME');
});

test('month helpers', () => {
  assert.equal(monthLabel('2026-09'), 'September 2026');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(monthsOfYear(2026).length, 12);
  assert.equal(readGroupMonth({ status: 'CLOSED', entries: [{ id: 'x', fieldKey: 'misc', amount: '500' }] }).entries[0].amount, 500);
});
