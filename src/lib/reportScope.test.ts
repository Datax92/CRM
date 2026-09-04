import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_EMPLOYEES,
  ALL_MANAGERS,
  addMetrics,
  blankMetrics,
  describeSubject,
  parseSubject,
  rowsForSubject,
  shortId,
  sumMetrics,
  teamLabel,
  teamOf,
  METRIC_KEYS,
  type PersonMetrics,
  type ReportPerson,
} from './reportScope.ts';

/**
 * Two managers, four employees, one admin, and one employee reporting to
 * nobody — which is the case that exposes double-counting and phantom teams.
 */
const people: ReportPerson[] = [
  { uid: 'admin', name: 'Usman', role: 'admin', subAdminUid: null },
  { uid: 'm1', name: 'Hina', role: 'subadmin', subAdminUid: null },
  { uid: 'm2', name: 'Faraz', role: 'subadmin', subAdminUid: null },
  { uid: 'e1', name: 'Ayesha', role: 'employee', subAdminUid: 'm1' },
  { uid: 'e2', name: 'Bilal', role: 'employee', subAdminUid: 'm1' },
  { uid: 'e3', name: 'Sana', role: 'employee', subAdminUid: 'm2' },
  { uid: 'e4', name: 'Direct', role: 'employee', subAdminUid: null },
];

function metrics(newConnects: number): PersonMetrics {
  return { ...blankMetrics(), newConnects };
}

/* -------------------------------------------------------------------------- */
/* Arithmetic                                                                  */
/* -------------------------------------------------------------------------- */

test('a blank row is zero in every column, and there are no columns missing', () => {
  const blank = blankMetrics();
  for (const key of METRIC_KEYS) assert.equal(blank[key], 0, `${key} should start at 0`);
  assert.equal(Object.keys(blank).length, METRIC_KEYS.length);
});

test('adding two rows adds every column', () => {
  const a: PersonMetrics = {
    newConnects: 1, followUpConnects: 2, meetings: 3, siteVisits: 4,
    dealsClosed: 5, tokensReceived: 6, p1: 7, p2: 8, p3: 9,
  };
  const total = addMetrics(blankMetrics(), a);
  addMetrics(total, a);

  for (const key of METRIC_KEYS) assert.equal(total[key], a[key] * 2, key);
});

test('summing nothing is a blank row rather than a crash', () => {
  assert.deepEqual(sumMetrics([]), blankMetrics());
});

/* -------------------------------------------------------------------------- */
/* Who a subject covers                                                        */
/* -------------------------------------------------------------------------- */

test("a manager's team is the manager first, then their own employees", () => {
  assert.deepEqual(
    teamOf(people, 'm1').map((person) => person.uid),
    ['m1', 'e1', 'e2']
  );
});

test("another manager's employees are never in the team", () => {
  const uids = teamOf(people, 'm1').map((person) => person.uid);
  assert.equal(uids.includes('e3'), false);
  assert.equal(uids.includes('e4'), false, 'an employee under nobody belongs to no team');
});

test('one employee is one row', () => {
  assert.deepEqual(
    rowsForSubject(people, parseSubject('e1')).map((person) => person.uid),
    ['e1']
  );
});

test('one manager breaks down into themselves plus their team', () => {
  assert.deepEqual(
    rowsForSubject(people, parseSubject('m2')).map((person) => person.uid),
    ['m2', 'e3']
  );
});

test('the admin is their own activity, not the company total', () => {
  assert.deepEqual(
    rowsForSubject(people, parseSubject('admin')).map((person) => person.uid),
    ['admin']
  );
});

test('All Employees is every employee and no manager', () => {
  const uids = rowsForSubject(people, parseSubject(ALL_EMPLOYEES)).map((person) => person.uid);
  assert.deepEqual(uids, ['e1', 'e2', 'e3', 'e4']);
});

test('All Managers is every manager with their own team, and nobody twice', () => {
  const uids = rowsForSubject(people, parseSubject(ALL_MANAGERS)).map((person) => person.uid);

  assert.deepEqual(uids, ['m1', 'e1', 'e2', 'm2', 'e3']);
  assert.equal(new Set(uids).size, uids.length, 'no uid appears twice');
  assert.equal(uids.includes('e4'), false, 'an employee under no manager is in no team');
});

test('an employee moved between managers moves with their figures, not into both', () => {
  const moved = people.map((person) =>
    person.uid === 'e1' ? { ...person, subAdminUid: 'm2' } : person
  );

  assert.deepEqual(teamOf(moved, 'm1').map((p) => p.uid), ['m1', 'e2']);
  // Roster order, not the order they joined the team — `teamOf` filters the
  // list it is given rather than re-sorting it.
  assert.deepEqual(teamOf(moved, 'm2').map((p) => p.uid), ['m2', 'e1', 'e3']);

  const all = rowsForSubject(moved, parseSubject(ALL_MANAGERS)).map((p) => p.uid);
  assert.equal(new Set(all).size, all.length);
});

test('a subject nobody matches is no rows rather than everybody', () => {
  assert.deepEqual(rowsForSubject(people, parseSubject('ghost')), []);
});

/* -------------------------------------------------------------------------- */
/* No double-counting, stated as arithmetic                                    */
/* -------------------------------------------------------------------------- */

test("a manager's total is their own work plus their team's, counted once each", () => {
  const work = new Map([
    ['m1', metrics(5)],
    ['e1', metrics(10)],
    ['e2', metrics(20)],
    ['e3', metrics(100)],
  ]);

  const rows = rowsForSubject(people, parseSubject('m1'));
  const total = sumMetrics(rows.map((person) => work.get(person.uid) ?? blankMetrics()));

  assert.equal(total.newConnects, 35, "5 + 10 + 20, and nothing of m2's team");
});

test('All Managers totals every team once, and skips the unmanaged employee', () => {
  const work = new Map([
    ['m1', metrics(5)],
    ['m2', metrics(7)],
    ['e1', metrics(10)],
    ['e2', metrics(20)],
    ['e3', metrics(30)],
    ['e4', metrics(1000)],
  ]);

  const rows = rowsForSubject(people, parseSubject(ALL_MANAGERS));
  const total = sumMetrics(rows.map((person) => work.get(person.uid) ?? blankMetrics()));

  assert.equal(total.newConnects, 72, '5 + 7 + 10 + 20 + 30');
});

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

test('the subject line says whether a manager row includes their team', () => {
  assert.match(describeSubject(people, parseSubject('m1')), /Hina and their team/);
  assert.match(describeSubject(people, parseSubject('m1')), /2 employees/);
  assert.match(describeSubject(people, parseSubject('e1')), /^Ayesha$/);
  assert.match(describeSubject(people, parseSubject('admin')), /admin's own activity/);
  assert.match(describeSubject(people, parseSubject(ALL_EMPLOYEES)), /4 people/);
  assert.match(describeSubject(people, parseSubject(ALL_MANAGERS)), /2 teams/);
});

test('the team column names the manager, or the admin when there is none', () => {
  const names = new Map([['m1', 'Hina'], ['m2', 'Faraz']]);

  assert.equal(teamLabel(people[3], names), 'Hina');
  assert.equal(teamLabel(people[6], names), 'Admin', 'an employee under nobody reports to the admin');
  assert.equal(teamLabel(people[1], names), 'Manager');
  assert.equal(teamLabel(people[0], names), 'Admin');
});

test('the short id is stable, readable and never empty', () => {
  assert.equal(shortId('aBc123XYZ456'), 'ABC12');
  assert.equal(shortId('ab'), 'AB000', 'padded rather than ragged');
  assert.equal(shortId(''), '—');
  assert.equal(shortId('demo-emp-1'), shortId('demo-emp-1'), 'same uid, same id');
});

test('an empty or unknown subject defaults to All Employees', () => {
  assert.deepEqual(parseSubject(null), { id: ALL_EMPLOYEES, kind: 'ALL_EMPLOYEES' });
  assert.deepEqual(parseSubject(''), { id: ALL_EMPLOYEES, kind: 'ALL_EMPLOYEES' });
  assert.deepEqual(parseSubject(ALL_MANAGERS), { id: ALL_MANAGERS, kind: 'ALL_MANAGERS' });
  assert.deepEqual(parseSubject('e1'), { id: 'e1', kind: 'PERSON' });
});
