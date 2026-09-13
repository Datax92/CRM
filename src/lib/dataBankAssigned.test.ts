import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_ASSIGNEE,
  filterByAssignee,
  filterBySource,
  folderScopeIds,
  groupByAssignee,
  isMirrorId,
  leadBelongsToFolder,
  mirrorOwner,
  managerMirrorId,
  matchesAssignedSearch,
  sortAssigned,
  sourceOptions,
  type AssignedItem,
} from './dataBankAssigned.ts';

const item = (over: Partial<AssignedItem>): AssignedItem => ({
  id: 'x',
  kind: 'LEAD',
  name: 'Imran Khan',
  phone: '0300 1234567',
  assigneeUid: 'u1',
  assigneeName: 'Aroosa',
  at: 0,
  ...over,
});

test('the mirror id matches the server shape', () => {
  assert.equal(managerMirrorId('m1', 'f1'), 'mgr_m1_f1');
  assert.equal(isMirrorId('mgr_m1_f1'), true);
  assert.equal(isMirrorId('qCKzjjDeNpB9G3PuPDKX'), false);
});

test('an original folder owns one possible mirror per manager', () => {
  assert.deepEqual(folderScopeIds('f1', ['m1', 'm2']), ['f1', 'mgr_m1_f1', 'mgr_m2_f1']);
});

test('a mirror owns only itself — rows are never handed on out of a mirror', () => {
  assert.deepEqual(folderScopeIds('mgr_m1_f1', ['m1', 'm2']), ['mgr_m1_f1']);
});

test('blank and repeated manager ids do not add ids', () => {
  assert.deepEqual(folderScopeIds('f1', ['m1', '', 'm1']), ['f1', 'mgr_m1_f1']);
});

test('grouping counts per person, most first, then by name', () => {
  const groups = groupByAssignee([
    item({ id: 'a', assigneeUid: 'u2', assigneeName: 'Sundus' }),
    item({ id: 'b', assigneeUid: 'u1', assigneeName: 'Aroosa' }),
    item({ id: 'c', assigneeUid: 'u2', assigneeName: 'Sundus' }),
    item({ id: 'd', assigneeUid: 'u3', assigneeName: 'Bilal' }),
  ]);
  assert.deepEqual(groups, [
    { uid: 'u2', name: 'Sundus', count: 2 },
    { uid: 'u1', name: 'Aroosa', count: 1 },
    { uid: 'u3', name: 'Bilal', count: 1 },
  ]);
});

test('the groups add up to the list — nothing is dropped or counted twice', () => {
  const items = [
    item({ id: 'a' }),
    item({ id: 'b', assigneeUid: null, assigneeName: '' }),
    item({ id: 'c', assigneeUid: 'u9', kind: 'HANDOFF' }),
  ];
  const total = groupByAssignee(items).reduce((sum, group) => sum + group.count, 0);
  assert.equal(total, items.length);
});

test('a row with no assignee is still counted, under its own entry', () => {
  const groups = groupByAssignee([item({ assigneeUid: null, assigneeName: '' })]);
  assert.deepEqual(groups, [{ uid: NO_ASSIGNEE, name: 'Unassigned', count: 1 }]);
  assert.equal(filterByAssignee([item({ assigneeUid: null })], NO_ASSIGNEE).length, 1);
});

test('picking a person shows only their rows; null shows everyone', () => {
  const items = [item({ id: 'a', assigneeUid: 'u1' }), item({ id: 'b', assigneeUid: 'u2' })];
  assert.deepEqual(filterByAssignee(items, 'u2').map((i) => i.id), ['b']);
  assert.equal(filterByAssignee(items, null).length, 2);
});

test('search matches inside the name, the assignee, or the whole number in any format', () => {
  const row = item({ name: 'Muhammad Aslam Baig', phone: '+92 300 1234567', assigneeName: 'Sundus' });
  assert.equal(matchesAssignedSearch(row, 'aslam'), true);
  assert.equal(matchesAssignedSearch(row, 'sundus'), true);
  assert.equal(matchesAssignedSearch(row, '0300-1234567'), true);
  assert.equal(matchesAssignedSearch(row, '0300 7654321'), false);
  assert.equal(matchesAssignedSearch(row, ''), true);
});

test('newest first, stable on id for a tie', () => {
  const sorted = sortAssigned([
    item({ id: 'b', at: 5 }),
    item({ id: 'a', at: 5 }),
    item({ id: 'c', at: 9 }),
  ]);
  assert.deepEqual(sorted.map((i) => i.id), ['c', 'a', 'b']);
});

test('source options list Data Bank sheets first, with counts', () => {
  const rows = ['Meta Ads (Ramadan)', 'Data Bank (GFS)', 'Data Bank (Faisal Town 2)', 'Data Bank (GFS)', 'Manual Entry'];
  assert.deepEqual(sourceOptions(rows, (r) => r), [
    { key: 'Data Bank (Faisal Town 2)', count: 1 },
    { key: 'Data Bank (GFS)', count: 2 },
    { key: 'Manual Entry', count: 1 },
    { key: 'Meta Ads (Ramadan)', count: 1 },
  ]);
});

test('the source filter keeps exactly the rows whose displayed source matches', () => {
  const rows = ['Data Bank (GFS)', 'Data Bank (GFS Sheet)', 'Data Bank (GFS)'];
  assert.equal(filterBySource(rows, 'Data Bank (GFS)', (r) => r).length, 2);
  assert.equal(filterBySource(rows, null, (r) => r).length, 3);
});

test('a lead belongs to its folder, and to it through any manager mirror', () => {
  assert.equal(leadBelongsToFolder('f1', 'f1'), true);
  assert.equal(leadBelongsToFolder('mgr_m1_f1', 'f1'), true);
  assert.equal(leadBelongsToFolder('mgr_m1_f2', 'f1'), false);
  assert.equal(leadBelongsToFolder('xf1', 'f1'), false);
  assert.equal(leadBelongsToFolder(null, 'f1'), false);
});

test("a mirror's view owns only its own leads, not its siblings'", () => {
  assert.equal(leadBelongsToFolder('mgr_m1_f1', 'mgr_m1_f1'), true);
  assert.equal(leadBelongsToFolder('mgr_m2_f1', 'mgr_m1_f1'), false);
  assert.equal(leadBelongsToFolder('f1', 'mgr_m1_f1'), false);
});

test('the manager is read back out of a mirror id', () => {
  assert.equal(mirrorOwner('mgr_RSP2c9_suPPi5', 'suPPi5'), 'RSP2c9');
  assert.equal(mirrorOwner('mgr_RSP2c9_other', 'suPPi5'), null);
  assert.equal(mirrorOwner('suPPi5', 'suPPi5'), null);
});
