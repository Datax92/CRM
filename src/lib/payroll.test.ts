import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SALARY_PROFILE,
  buildMonthLine,
  joiningShare,
  readSalary,
  allowedTransitions,
  buildPayrollLine,
  canTransition,
  computeLineTotals,
  isEditable,
  normalizeSalaryProfile,
  payrollTotals,
  repriceLine,
  type PayrollLine,
  type SalaryProfile,
} from './payroll.ts';

const profile = (patch: Partial<SalaryProfile> = {}): SalaryProfile => ({
  ...DEFAULT_SALARY_PROFILE,
  basic: 100_000,
  allowances: 15_000,
  ...patch,
});

/* -------------------------------------------------------------------------- */
/* The arithmetic                                                              */
/* -------------------------------------------------------------------------- */

test('net salary is basic plus additions minus deductions', () => {
  const totals = computeLineTotals({
    basic: 100_000,
    allowances: 15_000,
    bonus: 5_000,
    extraAdditions: 2_000,
    commission: 30_000,
    attendanceDeduction: 3_000,
    otherDeductions: 1_000,
  });

  assert.equal(totals.additions, 152_000);
  assert.equal(totals.deductions, 4_000);
  assert.equal(totals.net, 148_000);
});

test('a net salary never goes negative', () => {
  // A month of no pay and a standing loan repayment must not print a minus
  // sign on a payslip. The shortfall stays visible as the deduction figure.
  const totals = computeLineTotals({
    basic: 5_000,
    allowances: 0,
    bonus: 0,
    extraAdditions: 0,
    commission: 0,
    attendanceDeduction: 4_000,
    otherDeductions: 6_000,
  });

  assert.equal(totals.deductions, 10_000);
  assert.equal(totals.net, 0, 'floored at zero, not −5,000');
});

test('money is whole rupees — payroll in paisa is an argument nobody wins', () => {
  const totals = computeLineTotals({
    basic: 100_000.4,
    allowances: 0.5,
    bonus: 0,
    extraAdditions: 0,
    commission: 0,
    attendanceDeduction: 0,
    otherDeductions: 0,
  });

  assert.equal(totals.additions, 100_001, '100000.4 rounds down, 0.5 rounds up');
});

test('junk in a figure counts as zero rather than poisoning the total', () => {
  const totals = computeLineTotals({
    basic: 50_000,
    allowances: Number.NaN,
    bonus: Infinity as unknown as number,
    extraAdditions: 0,
    commission: 0,
    attendanceDeduction: 0,
    otherDeductions: 0,
  });

  assert.equal(totals.net, 50_000);
});

/* -------------------------------------------------------------------------- */
/* Building a line from a profile                                              */
/* -------------------------------------------------------------------------- */

test('commission and attendance deductions come in from the other modules', () => {
  const line = buildPayrollLine({
    uid: 'u1',
    name: 'Ayesha Khan',
    profile: profile(),
    commission: 42_000,
    attendanceDeduction: 2_000,
    lateCount: 3,
  });

  assert.equal(line.commission, 42_000);
  assert.equal(line.attendanceDeduction, 2_000);
  assert.equal(line.lateCount, 3);
  assert.equal(line.net, 100_000 + 15_000 + 42_000 - 2_000);
});

test('an employee whose commission is settled elsewhere gets none on the line', () => {
  const line = buildPayrollLine({
    uid: 'u1',
    name: 'Ayesha Khan',
    profile: profile({ includeCommission: false }),
    commission: 42_000,
    attendanceDeduction: 0,
  });

  assert.equal(line.commission, 0, 'the switch is honoured here, not at the call site');
  assert.equal(line.net, 115_000);
});

test('attendance deductions can be switched off per person', () => {
  const line = buildPayrollLine({
    uid: 'u1',
    name: 'Ayesha Khan',
    profile: profile({ applyAttendanceDeductions: false }),
    commission: 0,
    attendanceDeduction: 9_000,
  });

  assert.equal(line.attendanceDeduction, 0);
  assert.equal(line.net, 115_000);
});

test('a standing deduction and a one-off deduction add up rather than replace', () => {
  const line = buildPayrollLine({
    uid: 'u1',
    name: 'Ayesha Khan',
    profile: profile({ otherDeductions: 5_000 }),
    commission: 0,
    attendanceDeduction: 0,
    extraDeductions: 2_000,
  });

  assert.equal(line.otherDeductions, 7_000);
  assert.equal(line.net, 108_000);
});

test('editing a figure reprices the line', () => {
  const line = buildPayrollLine({
    uid: 'u1',
    name: 'Ayesha Khan',
    profile: profile(),
    commission: 10_000,
    attendanceDeduction: 1_000,
  });
  assert.equal(line.net, 124_000);

  const adjusted = repriceLine(line, { attendanceDeduction: 0, note: 'Late excused' });
  assert.equal(adjusted.net, 125_000);
  assert.equal(adjusted.note, 'Late excused');
  assert.equal(adjusted.commission, 10_000, 'untouched fields survive the patch');
});

/* -------------------------------------------------------------------------- */
/* Totals                                                                      */
/* -------------------------------------------------------------------------- */

test('a period totals every line', () => {
  const lines: PayrollLine[] = [
    buildPayrollLine({ uid: 'a', name: 'A', profile: profile(), commission: 10_000, attendanceDeduction: 1_000 }),
    buildPayrollLine({ uid: 'b', name: 'B', profile: profile({ basic: 60_000, allowances: 0 }), commission: 0, attendanceDeduction: 0 }),
  ];

  const totals = payrollTotals(lines);
  assert.equal(totals.people, 2);
  assert.equal(totals.commission, 10_000);
  assert.equal(totals.attendanceDeduction, 1_000);
  assert.equal(totals.net, 124_000 + 60_000);
});

/* -------------------------------------------------------------------------- */
/* The state machine                                                           */
/* -------------------------------------------------------------------------- */

/*
  **These two tests asserted a single chain and have been rewritten**, because
  the rule changed on the owner's instruction: *"for HR he sends approval to
  admin; admin doesn't need approval."* The admin approving their own draft used
  to be refused — three presses to say one thing, for one person.

  What has *not* changed, and is still asserted below: PAID is terminal, and
  nothing reaches PAID through a status change at all.
*/
test('the admin approves a draft directly — no review step for one person', () => {
  assert.deepEqual(allowedTransitions('DRAFT', true), ['APPROVED']);
  assert.equal(canTransition('DRAFT', 'APPROVED', true), true);
  // And can still send an approved month back to be corrected.
  assert.deepEqual(allowedTransitions('APPROVED', true), ['REVIEWED']);
});

test('HR prepares and sends up; HR never approves', () => {
  assert.deepEqual(allowedTransitions('DRAFT', false), ['REVIEWED']);
  assert.equal(canTransition('DRAFT', 'APPROVED', false), false);
  assert.equal(canTransition('REVIEWED', 'APPROVED', false), false);
  // They can take back something they sent, and nothing more.
  assert.deepEqual(allowedTransitions('REVIEWED', false), ['DRAFT']);
  assert.deepEqual(allowedTransitions('APPROVED', false), []);
});

test('paid is terminal — money has left the building', () => {
  assert.deepEqual(allowedTransitions('PAID', true), []);
  assert.deepEqual(allowedTransitions('PAID', false), []);
  assert.equal(canTransition('PAID', 'APPROVED', true), false);
  assert.equal(canTransition('PAID', 'DRAFT', true), false);
});

test('nothing reaches paid through a status change — the status follows the money', () => {
  // A month becomes paid when the last salary is actually paid out of an
  // account, so no role may declare it paid.
  for (const from of ['DRAFT', 'REVIEWED', 'APPROVED'] as const) {
    assert.equal(canTransition(from, 'PAID', true), false, from);
    assert.equal(canTransition(from, 'PAID', false), false, from);
  }
});

test('only a working period may be edited', () => {
  assert.equal(isEditable('DRAFT'), true);
  assert.equal(isEditable('REVIEWED'), true);
  // The whole of "finalised records must not be recalculated later" rests on
  // these two being false.
  assert.equal(isEditable('APPROVED'), false);
  assert.equal(isEditable('PAID'), false);
});

/* -------------------------------------------------------------------------- */
/* Stored profiles                                                             */
/* -------------------------------------------------------------------------- */

test('an older profile with no switches still gets commission and deductions', () => {
  const stored = normalizeSalaryProfile({ basic: 80_000 });
  assert.equal(stored.includeCommission, true);
  assert.equal(stored.applyAttendanceDeductions, true);
  assert.equal(stored.allowances, 0);
});

test('an explicit false is kept', () => {
  const stored = normalizeSalaryProfile({ basic: 1, includeCommission: false });
  assert.equal(stored.includeCommission, false);
});

test('a missing profile is a zero profile, not a crash', () => {
  const stored = normalizeSalaryProfile(undefined);
  assert.equal(stored.basic, 0);
  assert.equal(stored.allowances, 0);
  assert.equal(stored.otherDeductions, 0);
});

/* ---- the simple payroll (2026-09-25) ---- */

test('no joining date, or one before the month, is the whole month', () => {
  assert.deepEqual(joiningShare(null, '2026-09'), { paidDays: 30, monthDays: 30 });
  assert.deepEqual(joiningShare('2025-09-01', '2026-09'), { paidDays: 30, monthDays: 30 });
  assert.deepEqual(joiningShare('junk', '2026-02'), { paidDays: 28, monthDays: 28 });
});

test('joining mid-month pays from the joining day, counted inclusively', () => {
  assert.deepEqual(joiningShare('2026-09-01', '2026-09'), { paidDays: 30, monthDays: 30 });
  assert.deepEqual(joiningShare('2026-09-04', '2026-09'), { paidDays: 27, monthDays: 30 });
  assert.deepEqual(joiningShare('2026-10-31', '2026-10'), { paidDays: 1, monthDays: 31 });
});

test('somebody who joins after the month is not on it', () => {
  assert.equal(joiningShare('2026-10-01', '2026-09'), null);
  assert.equal(buildMonthLine({ uid: 'a', name: 'A', monthKey: '2026-09', salary: 30000, allowance: 0, joinedDayKey: '2026-10-02', commission: 0, attendanceDeduction: 0 }), null);
});

test('a month line is salary + allowance + commission − attendance, cut for joining', () => {
  // Sundus: 32,000 + 3,000, joined the 4th of a 30-day month → 27/30.
  const line = buildMonthLine({
    uid: 's', name: 'Sundus', monthKey: '2026-09', salary: 32000, allowance: 3000,
    joinedDayKey: '2026-09-04', commission: 5000, attendanceDeduction: 1000, deductionBasis: ['Late #3'],
  })!;
  assert.equal(line.basic, 28800);
  assert.equal(line.allowances, 2700);
  assert.equal(line.net, 28800 + 2700 + 5000 - 1000);
  assert.equal(line.salary, 32000);
  assert.equal(line.paidDays, 27);
  assert.deepEqual(line.deductionBasis, ['Late #3']);
});

test('deductions larger than the pay give a net of zero, never negative', () => {
  const line = buildMonthLine({ uid: 'x', name: 'X', monthKey: '2026-09', salary: 1000, allowance: 0, commission: 0, attendanceDeduction: 5000 })!;
  assert.equal(line.net, 0);
});

test('the allowance gathers every extra the old profile held', () => {
  assert.deepEqual(readSalary({ monthlySalary: 22000, salaryProfile: { basic: 22000, allowances: 1000, bonus: 2000, otherAdditions: 0 } }), { salary: 22000, allowance: 3000 });
  assert.deepEqual(readSalary({ monthlySalary: 18000 }), { salary: 18000, allowance: 0 });
  assert.deepEqual(readSalary({}), { salary: 0, allowance: 0 });
});
