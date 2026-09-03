import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAssignOptions,
  describeAssignee,
  groupAssignOptions,
  type AssignablePerson,
} from './assignTargets.ts';

const roster: AssignablePerson[] = [
  { uid: 'e1', name: 'Ayesha Khan', accessRole: 'employee', priority: 1, status: 'ACTIVE' },
  { uid: 'e2', name: 'Bilal Ahmed', accessRole: 'employee', priority: 3, status: 'ACTIVE' },
  { uid: 'm1', name: 'Hina Raza', accessRole: 'subadmin', status: 'ACTIVE' },
  { uid: 'e3', name: 'Paused Person', accessRole: 'employee', priority: 5, status: 'DISABLED' },
];

const admin = { uid: 'a1', name: 'Usman Sheikh', role: 'admin' as const };

test('the admin is offered themselves, managers and employees', () => {
  const options = buildAssignOptions(roster, admin);

  assert.equal(options.length, 4, 'me, one manager, two active employees');

  assert.equal(options[0].label, 'Admin / Myself', 'spelled out, not just their name');
  assert.equal(options[0].uid, 'a1');
  assert.ok(options.some((option) => option.uid === 'm1' && option.group === 'MANAGERS'));
  assert.ok(options.some((option) => option.uid === 'e1' && option.group === 'EMPLOYEES'));
});

test('a paused account is never offered — the server would refuse it anyway', () => {
  const options = buildAssignOptions(roster, admin);
  assert.equal(options.some((option) => option.uid === 'e3'), false);
});

test('the viewer appears once, as Myself, never also in their own group', () => {
  const withAdmin = [...roster, { uid: 'a1', name: 'Usman Sheikh', accessRole: 'subadmin' as const, status: 'ACTIVE' }];
  const options = buildAssignOptions(withAdmin, admin);
  assert.equal(options.filter((option) => option.uid === 'a1').length, 1);
  assert.equal(options[0].group, 'MYSELF');
});

test('a manager sees themselves labelled by name, not as Admin', () => {
  const options = buildAssignOptions(roster, { uid: 'm1', name: 'Hina Raza', role: 'subadmin' });
  assert.equal(options[0].label, 'Hina Raza (Myself)');
  assert.equal(options.some((option) => option.uid === 'm1' && option.group === 'MANAGERS'), false);
});

test('an employee is offered nobody to assign to', () => {
  const options = buildAssignOptions(roster, { uid: 'e1', name: 'Ayesha', role: 'employee' });
  assert.equal(options.some((option) => option.group === 'MYSELF'), false);
});

test('the hint says where a lead actually goes, per group', () => {
  const options = buildAssignOptions(roster, admin);
  const manager = options.find((option) => option.uid === 'm1')!;
  const employee = options.find((option) => option.uid === 'e1')!;

  assert.match(manager.hint, /Client section/);
  assert.match(options[0].hint, /Client section/);
  assert.match(employee.hint, /lane P1/, 'an employee still shows their lane priority');
});

test('groups come out in a fixed order, and empty ones are dropped', () => {
  const sections = groupAssignOptions(buildAssignOptions(roster, admin));
  assert.deepEqual(sections.map((section) => section.group), ['MYSELF', 'MANAGERS', 'EMPLOYEES']);

  const noManagers = groupAssignOptions(
    buildAssignOptions(roster.filter((person) => person.accessRole !== 'subadmin'), admin)
  );
  assert.deepEqual(noManagers.map((section) => section.group), ['MYSELF', 'EMPLOYEES']);
});

test('the confirmation names the recipient, and says "you" for yourself', () => {
  const options = buildAssignOptions(roster, admin);
  assert.equal(describeAssignee(options, 'a1'), 'you');
  assert.equal(describeAssignee(options, 'e1'), 'Ayesha Khan');
  assert.equal(describeAssignee(options, 'nobody'), 'the team');
});
