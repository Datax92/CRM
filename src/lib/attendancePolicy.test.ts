import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ATTENDANCE_POLICY,
  classifyCheckIn,
  pastAbsentCutoff,
  lateDeduction,
  monthDeductions,
  leaveBalances,
  leaveDayCount,
  leaveDayKeys,
  normalizePolicy,
  parseClock,
  formatClockValue,
  formatClockLabel,
  karachiMinutesOfDay,
  type AttendancePolicy,
} from './attendancePolicy.ts';

/** A Karachi wall-clock time as a real instant. PKT is UTC+5. */
const atKarachi = (hhmm: string, day = '2026-09-02') => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${day}T00:00:00Z`) + (h * 60 + m - 300) * 60_000);
};

/* -------------------------------------------------------------------------- */
/* Clock                                                                       */
/* -------------------------------------------------------------------------- */

test('a configured time round-trips', () => {
  assert.equal(parseClock('09:00'), 540);
  assert.equal(parseClock('9:05'), 545);
  assert.equal(formatClockValue(545), '09:05');
  assert.equal(formatClockLabel('09:05'), '9:05 AM');
  assert.equal(formatClockLabel('12:00'), '12:00 PM');
  assert.equal(formatClockLabel('00:30'), '12:30 AM');
});

test('a junk time is rejected rather than read as midnight', () => {
  for (const bad of ['', 'nine', '25:00', '09:99', '9', null, undefined]) {
    assert.equal(parseClock(bad as string), null, String(bad));
  }
});

test('the clock is read in Karachi, whatever the server thinks', () => {
  // 04:00 UTC is 09:00 in Karachi.
  assert.equal(karachiMinutesOfDay(new Date('2026-09-02T04:00:00Z')), 540);
  // And an instant late in the UTC day is still the same Karachi morning.
  assert.equal(karachiMinutesOfDay(atKarachi('09:30')), 570);
});

/* -------------------------------------------------------------------------- */
/* Lateness                                                                    */
/* -------------------------------------------------------------------------- */

test('grace is part of the threshold, so there is one number to understand', () => {
  const verdict = classifyCheckIn(atKarachi('09:10'), DEFAULT_ATTENDANCE_POLICY);
  assert.equal(verdict.late, false);
  assert.equal(verdict.lateAfter, '09:15');
});

test('late begins after the grace period, not at it', () => {
  assert.equal(classifyCheckIn(atKarachi('09:15'), DEFAULT_ATTENDANCE_POLICY).late, false);

  const late = classifyCheckIn(atKarachi('09:16'), DEFAULT_ATTENDANCE_POLICY);
  assert.equal(late.late, true);
  assert.equal(late.lateByMinutes, 1);
});

test('an early check-in is never late', () => {
  assert.equal(classifyCheckIn(atKarachi('07:45'), DEFAULT_ATTENDANCE_POLICY).late, false);
});

test('the threshold follows the configured start time', () => {
  const policy: AttendancePolicy = { ...DEFAULT_ATTENDANCE_POLICY, startTime: '10:30', graceMinutes: 0 };
  assert.equal(classifyCheckIn(atKarachi('10:30'), policy).late, false);
  assert.equal(classifyCheckIn(atKarachi('10:31'), policy).late, true);
});

test('the absent cutoff is configurable and inclusive', () => {
  assert.equal(pastAbsentCutoff(atKarachi('11:59'), DEFAULT_ATTENDANCE_POLICY), false);
  assert.equal(pastAbsentCutoff(atKarachi('12:00'), DEFAULT_ATTENDANCE_POLICY), true);

  const early: AttendancePolicy = { ...DEFAULT_ATTENDANCE_POLICY, absentCutoff: '10:00' };
  assert.equal(pastAbsentCutoff(atKarachi('10:30'), early), true);
});

/* -------------------------------------------------------------------------- */
/* Deductions                                                                  */
/* -------------------------------------------------------------------------- */

test("the owner's rule: two free, deduction from the third", () => {
  const { outcomes } = monthDeductions(5, DEFAULT_ATTENDANCE_POLICY);

  assert.deepEqual(
    outcomes.map((outcome) => outcome.deducted),
    [false, false, true, true, true]
  );
});

test('the deduction amount is configured, never assumed', () => {
  const policy: AttendancePolicy = { ...DEFAULT_ATTENDANCE_POLICY, deductionValue: 2500 };
  assert.equal(lateDeduction(3, policy).amount, 2500);

  const percent: AttendancePolicy = {
    ...DEFAULT_ATTENDANCE_POLICY,
    deductionMode: 'PERCENT',
    deductionValue: 2,
  };
  // 2% of 150,000.
  assert.equal(lateDeduction(3, percent, 150_000).amount, 3000);
});

test('a percent rule with no salary on record charges nothing rather than guessing', () => {
  const percent: AttendancePolicy = {
    ...DEFAULT_ATTENDANCE_POLICY,
    deductionMode: 'PERCENT',
    deductionValue: 5,
  };
  assert.equal(lateDeduction(4, percent, 0).amount, 0);
});

test('a zero allowance charges from the first late', () => {
  const strict: AttendancePolicy = { ...DEFAULT_ATTENDANCE_POLICY, allowedLates: 0 };
  assert.equal(lateDeduction(1, strict).deducted, true);
});

test('every deduction carries the rule it was charged under', () => {
  const outcome = lateDeduction(3, DEFAULT_ATTENDANCE_POLICY);
  // §12: changing the policy later must not rewrite a finalised period, and the
  // record has to be able to explain itself without the current settings.
  assert.match(outcome.basis, /Late #3/);
  assert.match(outcome.basis, /1000/);
});

test('the month total is the sum of its occurrences', () => {
  const { total } = monthDeductions(5, DEFAULT_ATTENDANCE_POLICY);
  assert.equal(total, 3000);
  assert.equal(monthDeductions(2, DEFAULT_ATTENDANCE_POLICY).total, 0);
  assert.equal(monthDeductions(0, DEFAULT_ATTENDANCE_POLICY).total, 0);
});

/* -------------------------------------------------------------------------- */
/* Leave                                                                       */
/* -------------------------------------------------------------------------- */

test('the default allowance is one of each', () => {
  const balances = leaveBalances(DEFAULT_ATTENDANCE_POLICY, {});
  assert.deepEqual(
    balances.map((balance) => [balance.type, balance.allowed, balance.remaining]),
    [
      ['CASUAL', 1, 1],
      ['MEDICAL', 1, 1],
    ]
  );
});

test('an admin adjustment moves one employee’s allowance without touching the policy', () => {
  const balances = leaveBalances(DEFAULT_ATTENDANCE_POLICY, { CASUAL: 1 }, { CASUAL: 4 });
  const casual = balances.find((balance) => balance.type === 'CASUAL')!;

  assert.equal(casual.allowed, 5);
  assert.equal(casual.used, 1);
  assert.equal(casual.remaining, 4);
});

test('a balance never goes negative, however much was taken', () => {
  const casual = leaveBalances(DEFAULT_ATTENDANCE_POLICY, { CASUAL: 9 })[0];
  assert.equal(casual.remaining, 0);
});

test('leave days are counted inclusively, and a backwards range is zero', () => {
  assert.equal(leaveDayCount('2026-09-02', '2026-09-02'), 1);
  assert.equal(leaveDayCount('2026-09-02', '2026-09-04'), 3);
  assert.equal(leaveDayCount('2026-09-04', '2026-09-02'), 0);
});

test('leave spans every day it covers, month boundary included', () => {
  assert.deepEqual(leaveDayKeys('2026-08-31', '2026-09-02'), [
    '2026-08-31',
    '2026-09-01',
    '2026-09-02',
  ]);
});

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

test('one mistyped field does not reset the others', () => {
  const current: AttendancePolicy = {
    ...DEFAULT_ATTENDANCE_POLICY,
    startTime: '10:00',
    allowedLates: 4,
    deductionValue: 750,
  };

  const saved = normalizePolicy({ startTime: 'half nine', graceMinutes: 20 }, current);

  assert.equal(saved.startTime, '10:00', 'the bad value falls back to what was set');
  assert.equal(saved.graceMinutes, 20);
  assert.equal(saved.allowedLates, 4, 'untouched fields survive');
  assert.equal(saved.deductionValue, 750);
});

test('out-of-range numbers are refused rather than clamped into nonsense', () => {
  const saved = normalizePolicy(
    { graceMinutes: -5, allowedLates: 999, deductionValue: -1 },
    DEFAULT_ATTENDANCE_POLICY
  );

  assert.equal(saved.graceMinutes, DEFAULT_ATTENDANCE_POLICY.graceMinutes);
  assert.equal(saved.allowedLates, DEFAULT_ATTENDANCE_POLICY.allowedLates);
  assert.equal(saved.deductionValue, DEFAULT_ATTENDANCE_POLICY.deductionValue);
});

test('IP restriction is off until somebody turns it on', () => {
  // Defaulting it on with an empty allow-list would lock the whole company out
  // of attendance the moment the module ships.
  assert.equal(DEFAULT_ATTENDANCE_POLICY.ipRestriction, false);
  assert.deepEqual(DEFAULT_ATTENDANCE_POLICY.officeIps, []);
});

/* -------------------------------------------------------------------------- */
/* The office-network rule                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `punchAttendance` decides this from the request's own IP, which a unit test
 * cannot supply — so the predicate itself is pulled out here and asserted.
 * The asymmetry is the whole point and is the thing most likely to be
 * "simplified" back into a bug later.
 */
function enforcesNetwork(
  kind: 'IN' | 'OUT',
  policy: { ipRestriction: boolean; officeIps: string[] },
  exempt: boolean
): boolean {
  return kind === 'IN' && policy.ipRestriction && policy.officeIps.length > 0 && !exempt;
}

const restricted = { ipRestriction: true, officeIps: ['203.0.113.9'] };

test('check-in is policed off the office network; check-out never is', () => {
  assert.equal(enforcesNetwork('IN', restricted, false), true);
  // Blocking a check-out would leave an open day behind whenever somebody
  // finishes at a client site — and an open day is graded as a half day.
  assert.equal(enforcesNetwork('OUT', restricted, false), false);
});

test('an unconfigured allow-list polices nothing', () => {
  // Otherwise turning the restriction on with no address recorded would lock
  // the entire company out of attendance.
  assert.equal(enforcesNetwork('IN', { ipRestriction: true, officeIps: [] }, false), false);
});

test('the restriction switched off polices nothing', () => {
  assert.equal(enforcesNetwork('IN', { ipRestriction: false, officeIps: ['203.0.113.9'] }, false), false);
});

test('an exempt employee checks in from anywhere', () => {
  assert.equal(enforcesNetwork('IN', restricted, true), false);
});

/* -------------------------------------------------------------------------- */
/* Configuring an office IP is the decision to enforce it                      */
/* -------------------------------------------------------------------------- */

test('a stored policy with office IPs but no flag enforces them', () => {
  // The bug this fixes: `config/attendance` written before `ipRestriction`
  // existed held only `officeIps`, fell through to the default `false`, and
  // accepted every check-in from anywhere while the addresses sat in Settings
  // looking as though they were doing something.
  const policy = normalizePolicy({ officeIps: ['119.73.100.106'] }, DEFAULT_ATTENDANCE_POLICY);
  assert.equal(policy.ipRestriction, true);
});

test('no office IPs means nothing to enforce, so nothing is enforced', () => {
  // Refusing every check-in because nobody has configured an address yet
  // would lock the whole company out of attendance.
  const policy = normalizePolicy({ officeIps: [] }, DEFAULT_ATTENDANCE_POLICY);
  assert.equal(policy.ipRestriction, false);
});

test('an explicit false wins, even with addresses configured', () => {
  // Settings always sends the field, so an admin who wants the network
  // recorded but not policed makes that choice once and it sticks.
  const policy = normalizePolicy(
    { officeIps: ['119.73.100.106'], ipRestriction: false },
    DEFAULT_ATTENDANCE_POLICY
  );
  assert.equal(policy.ipRestriction, false);
});

test('an explicit true wins with no addresses — and still polices nothing', () => {
  const policy = normalizePolicy({ officeIps: [], ipRestriction: true }, DEFAULT_ATTENDANCE_POLICY);
  assert.equal(policy.ipRestriction, true);
  // `punchAttendance` also requires a non-empty list before it refuses
  // anybody, which is what stops this combination locking people out.
  assert.equal(policy.officeIps.length, 0);
});
