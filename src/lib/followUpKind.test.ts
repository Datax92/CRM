import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  nextEntryKind,
  nextEntryLabel,
  entryKindAt,
  entryLabelAt,
  historyTabLabel,
} from './followUpKind.ts';

test('the first entry on a lead is a Remark, the rest are Follow-Ups', () => {
  assert.equal(nextEntryKind(0), 'REMARK');
  assert.equal(nextEntryKind(1), 'FOLLOW_UP');
  assert.equal(nextEntryKind(9), 'FOLLOW_UP');
});

test('the form label follows the same rule', () => {
  assert.equal(nextEntryLabel(0), 'Remark');
  assert.equal(nextEntryLabel(1), 'Follow-Up');
});

test('a junk count cannot produce a Follow-Up with no Remark before it', () => {
  assert.equal(nextEntryKind(-1), 'REMARK');
  assert.equal(nextEntryKind(NaN as unknown as number), 'FOLLOW_UP');
});

test('in a newest-first list the last row is the Remark', () => {
  // Three entries, rendered newest first: index 2 is the oldest.
  assert.equal(entryKindAt(0, 3), 'FOLLOW_UP');
  assert.equal(entryKindAt(1, 3), 'FOLLOW_UP');
  assert.equal(entryKindAt(2, 3), 'REMARK');
});

test('a lead with one entry has a Remark and no follow-ups', () => {
  assert.equal(entryLabelAt(0, 1), 'Remark');
});

test('oldest-first lists are supported explicitly, not by accident', () => {
  assert.equal(entryKindAt(0, 3, false), 'REMARK');
  assert.equal(entryKindAt(2, 3, false), 'FOLLOW_UP');
});

test('exactly one entry in any list is the Remark', () => {
  for (const total of [1, 2, 5, 12]) {
    const remarks = Array.from({ length: total }, (_, i) => entryKindAt(i, total)).filter(
      (kind) => kind === 'REMARK'
    );
    assert.equal(remarks.length, 1, `total ${total}`);
  }
});

test('the tab never calls a lone opening note a follow-up', () => {
  assert.equal(historyTabLabel(1), 'Remark');
  assert.doesNotMatch(historyTabLabel(0), /Follow/);
  assert.match(historyTabLabel(4), /Follow-Ups/);
});
