import test from 'node:test';
import assert from 'node:assert/strict';

import { ADMIN_ALERT_TYPES, isAdminAlert } from './adminAlerts.ts';

test("the admin's panel carries exactly the five the owner asked for", () => {
  assert.deepEqual(ADMIN_ALERT_TYPES, [
    'ATTENDANCE_CHECK_IN',
    'ATTENDANCE_LATE',
    'ATTENDANCE_ABSENT',
    'DEAL_CLOSED_REVIEW',
    'LEAD_PROMOTED',
  ]);
});

test('every other alert is kept out of it', () => {
  // These still exist, are still written, and still reach the people they are
  // about — they are simply not what the admin's bell is for any more.
  for (const type of [
    'RED_FLAG',
    'NO_FOLLOWUP',
    'LEAD_NO_CONTACT',
    'UNASSIGNED_LEAD',
    'NEW_LEAD_ASSIGNED',
    'COLD_REVIEW_REQUIRED',
    'EXPENSE_APPROVAL',
    'LEAVE_REQUESTED',
    'PERSONAL_LEAD_ADDED',
    'ATTENDANCE_OFF_NETWORK',
  ]) {
    assert.equal(isAdminAlert(type), false, `${type} should not reach the admin's panel`);
  }
});

test('it is an allow-list, so a new type added next month is silent until somebody decides', () => {
  // The opposite shape leaks by default, which is how the panel filled up.
  assert.equal(isAdminAlert('SOME_ALERT_INVENTED_LATER'), false);
});

test('junk is not an alert', () => {
  assert.equal(isAdminAlert(undefined), false);
  assert.equal(isAdminAlert(null), false);
  assert.equal(isAdminAlert(''), false);
  assert.equal(isAdminAlert(42), false);
  // Case matters: the stored values are the constants, not free text.
  assert.equal(isAdminAlert('attendance_late'), false);
});
