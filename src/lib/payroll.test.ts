import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SALARY_PROFILE,
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

test('payroll moves one step at a time, forward or back', () => {
  assert.deepEqual(allowedTransitions('DRAFT'), ['REVIEWED']);
  assert.deepEqual(allowedTransitions('REVIEWED'), ['APPROVED', 'DRAFT']);
  assert.deepEqual(allowedTransitions('APPROVED'), ['PAID', 'REVIEWED']);
});

test('paid is terminal — money has left the building', () => {
  assert.deepEqual(allowedTransitions('PAID'), []);
  assert.equal(canTransition('PAID', 'APPROVED'), false);
  assert.equal(canTransition('PAID', 'DRAFT'), false);
});

test('a draft cannot jump straight to paid, skipping both reviews', () => {
  assert.equal(canTransition('DRAFT', 'PAID'), false);
  assert.equal(canTransition('DRAFT', 'APPROVED'), false);
  assert.equal(canTransition('DRAFT', 'REVIEWED'), true);
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
