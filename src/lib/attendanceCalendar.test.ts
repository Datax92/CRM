import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dayNumber,
  daysInMonth,
  leadingBlanks,
  monthDayKeys,
  monthLabel,
  monthRange,
  shiftMonth,
} from './attendanceCalendar.ts';

/**
 * The month arithmetic behind the calendar.
 *
 * Small functions, but every one of them has an off-by-one that only shows up
 * on one day of the year — a leading blank that is wrong every January, a
 * `to` bound that silently drops the 31st, a December that steps into month 13.
 * Those are exactly the bugs nobody catches by looking at this month.
 */

test('a month knows how many days it holds, leap year included', () => {
  assert.equal(daysInMonth('2026-01'), 31);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2024-02'), 29, 'a leap February');
  assert.equal(daysInMonth('2026-04'), 30);
  assert.equal(daysInMonth('2026-12'), 31);
});

test('stepping forward from December lands in the next January', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-09', 0), '2026-09');
  assert.equal(shiftMonth('2026-09', -13), '2025-08');
});

test('a month range covers the whole month, both ends included', () => {
  assert.deepEqual(monthRange('2026-09'), { from: '2026-09-01', to: '2026-09-30' });
  // The bug this exists to prevent: a hard-coded `-31` bound would read a
  // February range as ending on the 31st, and a hard-coded `-30` would drop
  // the 31st of every long month.
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
});

test('the leading blanks are the weekday the 1st falls on', () => {
  // 1 September 2026 is a Tuesday, so two blanks (Sunday, Monday) precede it.
  assert.equal(leadingBlanks('2026-09'), 2);
  // 1 February 2026 is a Sunday — no blanks at all.
  assert.equal(leadingBlanks('2026-02'), 0);
});

test('a month label reads as a person would say it', () => {
  assert.equal(monthLabel('2026-09'), 'September 2026');
  assert.equal(monthLabel('2026-01'), 'January 2026');
});

test('day keys run 01 through the last day, padded, in order', () => {
  const keys = monthDayKeys('2026-02');
  assert.equal(keys.length, 28);
  assert.equal(keys[0], '2026-02-01');
  assert.equal(keys.at(-1), '2026-02-28');
  assert.deepEqual([...keys].sort(), keys, 'string order is date order');
});

test('a day number survives the leading zero', () => {
  assert.equal(dayNumber('2026-09-01'), 1);
  assert.equal(dayNumber('2026-09-30'), 30);
});
