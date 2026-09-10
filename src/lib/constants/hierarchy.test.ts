import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canAssignLeadTo,
  isHrManager,
  normalizeManagerKind,
} from './hierarchy.ts';

/*
 * Lead-assignment reach.
 *
 * The rule is one sentence — a Sales manager feeds their own team, an HR
 * manager feeds anybody — and it is spread over three server actions and two
 * read hooks. These assertions exist because that is exactly the shape of rule
 * somebody tidies back into `subAdminUid === actor.uid` on a quiet afternoon.
 */

const ADMIN = { role: 'admin', uid: 'admin1' };
const HR = { role: 'subadmin', uid: 'hr1', managerKind: 'HR' };
const SALES = { role: 'subadmin', uid: 'sales1', managerKind: 'SALES' };
const OLD_MANAGER = { role: 'subadmin', uid: 'old1' }; // no kind ever written
const EMPLOYEE = { role: 'employee', uid: 'emp1' };

const MINE = { subAdminUid: 'sales1' };
const THEIRS = { subAdminUid: 'sales2' };
const UNMANAGED = { subAdminUid: null };

test('the admin may hand a lead to anybody', () => {
  assert.equal(canAssignLeadTo(ADMIN, MINE), true);
  assert.equal(canAssignLeadTo(ADMIN, THEIRS), true);
  assert.equal(canAssignLeadTo(ADMIN, UNMANAGED), true);
});

test('an HR manager may hand a lead to anybody, including another team', () => {
  assert.equal(canAssignLeadTo(HR, MINE), true);
  assert.equal(canAssignLeadTo(HR, THEIRS), true);
  assert.equal(canAssignLeadTo(HR, UNMANAGED), true);
});

test('a Sales manager may hand a lead only to their own team', () => {
  assert.equal(canAssignLeadTo(SALES, MINE), true);
  assert.equal(canAssignLeadTo(SALES, THEIRS), false);
  // Absent means "the admin manages them directly", which is not this manager.
  assert.equal(canAssignLeadTo(SALES, UNMANAGED), false);
});

test('a manager with no kind recorded reads as Sales, and keeps the reach they had', () => {
  assert.equal(normalizeManagerKind(undefined), 'SALES');
  assert.equal(canAssignLeadTo(OLD_MANAGER, THEIRS), false);
  assert.equal(canAssignLeadTo({ ...OLD_MANAGER, uid: 'sales1' }, MINE), true);
});

test('an employee hands out nothing, whatever else is true of them', () => {
  assert.equal(canAssignLeadTo(EMPLOYEE, MINE), false);
  assert.equal(canAssignLeadTo({ ...EMPLOYEE, managerKind: 'HR' }, MINE), false);
});

test('a junk manager kind is not HR — the reach falls back, it does not open up', () => {
  const junk = { role: 'subadmin', uid: 'x', managerKind: 'hr' };
  assert.equal(canAssignLeadTo(junk, THEIRS), false);
  assert.equal(isHrManager('subadmin', 'hr'), false);
});

test('isHrManager is the company-wide test the whole app shares', () => {
  assert.equal(isHrManager('admin', undefined), true);
  assert.equal(isHrManager('subadmin', 'HR'), true);
  assert.equal(isHrManager('subadmin', 'SALES'), false);
  assert.equal(isHrManager('employee', 'HR'), false);
});
