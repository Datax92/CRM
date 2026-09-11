import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canAssignLeadTo,
  isHrManager,
  normalizeManagerKind,
  owningSubAdminFor,
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

/* -------------------------------------------------------------------------- */
/* Handing a lead to a manager                                                 */
/* -------------------------------------------------------------------------- */

const hr = { role: 'subadmin', uid: 'hr1', managerKind: 'HR' };
const sales = { role: 'subadmin', uid: 'sales1', managerKind: 'SALES' };
const admin = { role: 'admin', uid: 'admin1' };

test('HR may hand a lead to another manager', () => {
  assert.equal(canAssignLeadTo(hr, { role: 'subadmin', subAdminUid: null }), true);
});

test('the admin may hand a lead to a manager', () => {
  assert.equal(canAssignLeadTo(admin, { role: 'subadmin', subAdminUid: null }), true);
});

test('a Sales manager may not hand a lead to another manager', () => {
  // Cross-team distribution is the admin's and HR's to do.
  assert.equal(canAssignLeadTo(sales, { role: 'subadmin', subAdminUid: null }), false);
});

test('a Sales manager may not hand a lead to themselves through this route', () => {
  // The trap: a manager's own `subAdminUid` is normally absent, and so is an
  // unmanaged employee's — `undefined === undefined` would have said yes.
  assert.equal(canAssignLeadTo(sales, { role: 'subadmin', subAdminUid: undefined }), false);
});

test("a Sales manager still reaches their own team, and nobody else's", () => {
  assert.equal(canAssignLeadTo(sales, { role: 'employee', subAdminUid: 'sales1' }), true);
  assert.equal(canAssignLeadTo(sales, { role: 'employee', subAdminUid: 'sales2' }), false);
});

test("an employee with no manager is not everybody's to assign", () => {
  // Both sides absent used to compare equal. An unmanaged employee belongs to
  // the admin, not to whichever manager happens to ask.
  assert.equal(canAssignLeadTo(sales, { role: 'employee', subAdminUid: null }), false);
  assert.equal(canAssignLeadTo(sales, { role: 'employee' }), false);
  assert.equal(canAssignLeadTo(admin, { role: 'employee', subAdminUid: null }), true);
  assert.equal(canAssignLeadTo(hr, { role: 'employee', subAdminUid: null }), true);
});

test('an employee may still assign to nobody', () => {
  assert.equal(canAssignLeadTo({ role: 'employee', uid: 'e1' }, { role: 'employee', subAdminUid: 'e1' }), false);
});

/* -------------------------------------------------------------------------- */
/* Which manager the lead files under                                          */
/* -------------------------------------------------------------------------- */

test("an employee's lead files under their manager", () => {
  assert.equal(owningSubAdminFor({ uid: 'e1', role: 'employee', subAdminUid: 'sales1' }), 'sales1');
});

test("a manager's lead files under themselves", () => {
  // Their leads query is `where('subAdminUid','==',me)` and the Security Rule
  // checks that clause, so anything else is a lead they cannot see.
  assert.equal(owningSubAdminFor({ uid: 'mgr1', role: 'subadmin', subAdminUid: null }), 'mgr1');
});

test('a manager who somehow carries another uid still files under themselves', () => {
  assert.equal(owningSubAdminFor({ uid: 'mgr1', role: 'subadmin', subAdminUid: 'mgr2' }), 'mgr1');
});

test('an unmanaged employee files under nobody, which means the admin', () => {
  assert.equal(owningSubAdminFor({ uid: 'e9', role: 'employee' }), null);
});
