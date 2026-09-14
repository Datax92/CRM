import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  karachiDayKey,
  karachiDayRange,
  offsetDayKey,
  formatDayKeyDisplay,
  resolveRange,
  withinRange,
  timestampMillis,
} from './dates.ts';

test('offsetDayKey steps days forward and backward across month boundaries', () => {
  assert.equal(offsetDayKey('2026-07-07', -1), '2026-07-06');
  assert.equal(offsetDayKey('2026-07-07', 1), '2026-07-08');
  assert.equal(offsetDayKey('2026-07-01', -1), '2026-06-30');
  assert.equal(offsetDayKey('2026-01-01', -1), '2025-12-31');
  assert.equal(offsetDayKey('2026-12-31', 1), '2027-01-01');
});

test('karachiDayRange creates exact 24-hour boundaries for a specific day', () => {
  const range = karachiDayRange('2026-07-07');
  assert.ok(range.from);
  assert.ok(range.to);

  // Exact 24 hours = 86,400,000 ms
  assert.equal(range.to.getTime() - range.from.getTime(), 24 * 60 * 60 * 1000);

  // 7 July 2026 in Karachi (+05:00):
  // 2026-07-07T00:00:00+05:00 is 2026-07-06T19:00:00Z
  assert.equal(range.from.toISOString(), '2026-07-06T19:00:00.000Z');
  assert.equal(range.to.toISOString(), '2026-07-07T19:00:00.000Z');
});

test('withinRange strictly accepts instants on that day and rejects neighbouring days', () => {
  const range = karachiDayRange('2026-07-07');

  // Start of day (00:00:00 Karachi)
  assert.equal(withinRange(new Date('2026-07-06T19:00:00.000Z'), range), true);
  // Noon Karachi (07:00:00 UTC)
  assert.equal(withinRange(new Date('2026-07-07T07:00:00.000Z'), range), true);
  // Last millisecond of 7 July Karachi (23:59:59.999 Karachi = 18:59:59.999 UTC)
  assert.equal(withinRange(new Date('2026-07-07T18:59:59.999Z'), range), true);

  // 1 millisecond before 7 July Karachi (6 July 23:59:59.999 Karachi)
  assert.equal(withinRange(new Date('2026-07-06T18:59:59.999Z'), range), false);
  // Midnight 8 July Karachi (next day start, exclusive)
  assert.equal(withinRange(new Date('2026-07-07T19:00:00.000Z'), range), false);
});

test('resolveRange TODAY has a defined 24h upper bound', () => {
  const todayRange = resolveRange('TODAY');
  assert.ok(todayRange.from);
  assert.ok(todayRange.to);
  assert.equal(todayRange.to.getTime() - todayRange.from.getTime(), 24 * 60 * 60 * 1000);
});

test('formatDayKeyDisplay labels Today, Yesterday, and past dates clearly', () => {
  const today = karachiDayKey();
  const yesterday = offsetDayKey(today, -1);

  assert.match(formatDayKeyDisplay(today), /^Today · /);
  assert.match(formatDayKeyDisplay(yesterday), /^Yesterday · /);
  assert.equal(formatDayKeyDisplay('2026-07-07'), '07 Jul 2026');
});

/* -------------------------------------------------------------------------- */
/* timestampMillis — the same field, three transports                          */
/* -------------------------------------------------------------------------- */

test('a live Timestamp, a serialised one and a date string all read the same instant', () => {
  const instant = Date.UTC(2026, 8, 14, 9, 30, 0);
  const asDate = new Date(instant);

  // What onSnapshot hands back.
  assert.equal(timestampMillis({ toDate: () => asDate }), instant);
  // What survives a Server Action's serialisation, or arrives over REST.
  assert.equal(timestampMillis({ seconds: instant / 1000, nanoseconds: 0 }), instant);
  // What the demo store writes, and what JSON round-trips to.
  assert.equal(timestampMillis(asDate.toISOString()), instant);
  assert.equal(timestampMillis(asDate), instant);
  assert.equal(timestampMillis(instant), instant);
});

test('absent reads as null, not as the epoch', () => {
  // Zero would be a real instant — 1970 — and a countdown given it would
  // report a window that closed 56 years ago rather than no window at all.
  assert.equal(timestampMillis(null), null);
  assert.equal(timestampMillis(undefined), null);
});

test('junk reads as null rather than NaN', () => {
  // NaN propagates silently through every comparison as `false`, so a lead
  // would simply stop appearing with nothing to show for it.
  assert.equal(timestampMillis('not a date'), null);
  assert.equal(timestampMillis({}), null);
  assert.equal(timestampMillis(new Date('nonsense')), null);
  assert.equal(timestampMillis({ seconds: Number.NaN }), null);
  assert.equal(timestampMillis(Number.NaN), null);
});

test('a toDate that returns something useless does not throw', () => {
  // A half-deserialised Timestamp has the method and no value behind it.
  assert.equal(timestampMillis({ toDate: () => new Date('nonsense') }), null);
});
