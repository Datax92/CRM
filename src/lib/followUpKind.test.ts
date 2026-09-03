import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  nextEntryKind,
  nextEntryLabel,
  entryKindAt,
  entryLabelAt,
  historyTabLabel,
  entryAllowance,
  toChronological,
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

/* -------------------------------------------------------------------------- */
/* What the log allows today (§1)                                              */
/* -------------------------------------------------------------------------- */

test('day one takes a Remark and then a Follow-Up', () => {
  // Nothing logged: the opening remark.
  const first = entryAllowance(0, 0, false);
  assert.deepEqual([first.kind, first.allowed], ['REMARK', true]);

  // Remark written, same day: the follow-up is still allowed.
  const second = entryAllowance(1, 1, true);
  assert.deepEqual([second.kind, second.allowed], ['FOLLOW_UP', true]);
});

test('day one takes no third entry', () => {
  const third = entryAllowance(2, 2, true);
  assert.equal(third.allowed, false);
  assert.match(third.reason ?? '', /today/i);
});

test('a later day takes one Follow-Up and no Remark', () => {
  const nextDay = entryAllowance(2, 0, true);
  assert.deepEqual([nextDay.kind, nextDay.allowed], ['FOLLOW_UP', true]);

  const secondToday = entryAllowance(3, 1, true);
  assert.equal(secondToday.kind, 'FOLLOW_UP');
  assert.equal(secondToday.allowed, false);
});

test('there is exactly one Remark in a lead’s whole history', () => {
  // Every allowance after the first entry is a Follow-Up, whatever the day.
  for (const [total, today] of [[1, 1], [1, 0], [5, 0], [9, 0]] as const) {
    assert.equal(entryAllowance(total, today, true).kind, 'FOLLOW_UP', `${total}/${today}`);
  }
});

test('history renders oldest first — Remark, then each Follow-Up after it', () => {
  // The query hands the app newest-first; the display order is the reverse.
  const newestFirst = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
  const shown = toChronological(newestFirst);

  assert.deepEqual(
    shown.map((entry) => entry.id),
    ['a', 'b', 'c'],
    'a Follow-Up added after a Remark appears directly after it, never above'
  );

  // And the badge follows the same order: index 0 is now the oldest.
  assert.equal(entryLabelAt(0, shown.length, false), 'Remark');
  assert.equal(entryLabelAt(1, shown.length, false), 'Follow-Up');
  assert.equal(entryLabelAt(2, shown.length, false), 'Follow-Up');
});

test('reversing for display does not disturb the source array', () => {
  const source = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
  toChronological(source);
  assert.equal(source[0].id, 'c', 'latestFollowUpId and the edit rule still read index 0');
});

test('a lead with a single entry shows it as the Remark either way round', () => {
  assert.equal(entryLabelAt(0, 1, false), 'Remark');
  assert.equal(entryLabelAt(0, 1, true), 'Remark');
});
