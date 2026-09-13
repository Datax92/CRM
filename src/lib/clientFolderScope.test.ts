import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countOwnClientLeads, isOwnClientFolder, ownClientLeadIds } from './clientFolderScope.ts';

const admin = { role: 'admin', uid: 'A' };
const hr = { role: 'subadmin', uid: 'HR' };
const sales = { role: 'subadmin', uid: 'S' };

test("an HR manager's folder is not in the admin's Clients", () => {
  assert.equal(isOwnClientFolder({ subAdminUid: 'HR', ownerUid: 'HR' }, admin), false);
});

test("the admin's own folders are, with or without ownerUid", () => {
  assert.equal(isOwnClientFolder({ ownerUid: 'A' }, admin), true);
  assert.equal(isOwnClientFolder({}, admin), true);
});

test("a folder owned by some other admin account is not this admin's", () => {
  assert.equal(isOwnClientFolder({ ownerUid: 'A2' }, admin), false);
});

test('a manager sees their own folders and nobody else’s', () => {
  assert.equal(isOwnClientFolder({ subAdminUid: 'HR' }, hr), true);
  assert.equal(isOwnClientFolder({ subAdminUid: 'HR' }, sales), false);
  assert.equal(isOwnClientFolder({}, sales), false);
});

test('an employee, or nobody signed in, owns no Client folder', () => {
  assert.equal(isOwnClientFolder({}, { role: 'employee', uid: 'E' }), false);
  assert.equal(isOwnClientFolder({}, { role: 'admin', uid: '' }), false);
});

test("a folder shows only the leads still assigned to its owner", () => {
  const assignee: Record<string, string> = { l1: 'A', l2: 'Sundus', l3: 'A' };
  const ids = ownClientLeadIds(['l1', 'l2', 'l3', 'gone'], 'A', (id) => assignee[id]);
  assert.deepEqual([...ids].sort(), ['l1', 'l3']);
});

test('folder counts agree with what each folder shows', () => {
  const assignee: Record<string, string> = { l1: 'A', l2: 'Sundus', l3: 'A', l4: 'A' };
  const members = [
    { folderId: 'f1', leadId: 'l1' },
    { folderId: 'f1', leadId: 'l2' },
    { folderId: 'f1', leadId: 'l1' },
    { folderId: 'f2', leadId: 'l3' },
    { folderId: 'f2', leadId: 'l4' },
  ];
  const counts = countOwnClientLeads(members, 'A', (id) => assignee[id]);
  assert.equal(counts.get('f1'), 1);
  assert.equal(counts.get('f2'), 2);
  const shown = ownClientLeadIds(members.filter((m) => m.folderId === 'f2').map((m) => m.leadId), 'A', (id) => assignee[id]);
  assert.equal(shown.size, counts.get('f2'));
});
