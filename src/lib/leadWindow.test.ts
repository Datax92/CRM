import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  leadWindowSize,
  windowIsFull,
  missingFromWindow,
  idBatches,
  LEAD_WINDOW_FLOOR,
  LEAD_WINDOW_CEILING,
  ID_BATCH,
} from './leadWindow.ts';

test('an unknown count leaves the window at the floor, never at zero', () => {
  // The count is an optimisation. If it never answers, nothing may shrink.
  for (const bad of [null, undefined, NaN, -1, 0, Infinity]) {
    assert.equal(leadWindowSize(bad as number), LEAD_WINDOW_FLOOR, `for ${String(bad)}`);
  }
});

test("today's pipeline sits inside the floor, so nothing re-keys", () => {
  // 537 leads on 2026-09-23. 537 x 1.25 is well under the floor.
  assert.equal(leadWindowSize(537), LEAD_WINDOW_FLOOR);
  assert.equal(leadWindowSize(1599), LEAD_WINDOW_FLOOR);
});

test('the window grows with the collection, in steps', () => {
  // 1600 x 1.25 = 2000 exactly; the next lead must push it up a step.
  assert.equal(leadWindowSize(1600), 2000);
  assert.equal(leadWindowSize(1601), 2500);
  assert.equal(leadWindowSize(3000), 4000);
  // Stepping means a lead a minute does not resubscribe a minute.
  assert.equal(leadWindowSize(3000), leadWindowSize(3100));
});

test('the ceiling clamps, and the clamped window still covers the count', () => {
  // 5000 leads: headroom would ask 6500, the ceiling gives 6000 — which still
  // holds every lead, so this is not yet truncation.
  assert.equal(leadWindowSize(5000), LEAD_WINDOW_CEILING);
  assert.ok(leadWindowSize(5000) > 5000, 'a clamped window may still be complete');
  assert.equal(windowIsFull(5000, leadWindowSize(5000)), false);
});

test('past the ceiling the window is full and says so, rather than silently dropping leads', () => {
  const size = leadWindowSize(9000);
  assert.equal(size, LEAD_WINDOW_CEILING);
  // The subscription returns `size` rows out of 9000 — the exact condition that
  // hid 20 of a folder's 34 clients, now reported instead of hidden.
  assert.equal(windowIsFull(size, size), true);
});

test('a window that is not full is not reported as truncated', () => {
  assert.equal(windowIsFull(537, 2000), false);
  assert.equal(windowIsFull(1999, 2000), false);
  assert.equal(windowIsFull(2000, 2000), true);
  // Over-full can only mean a bigger snapshot than asked for; still truncated.
  assert.equal(windowIsFull(2001, 2000), true);
});

test('a folder asks only for the members the window does not hold', () => {
  const loaded = new Set(['a', 'b']);
  assert.deepEqual(
    missingFromWindow(['a', 'b', 'c', 'd'], (id) => loaded.has(id)),
    ['c', 'd']
  );
  // The common case: the window holds everything, so no listener is opened.
  assert.deepEqual(missingFromWindow(['a', 'b'], (id) => loaded.has(id)), []);
});

test('missing ids are deduped and keep their order, because they key subscriptions', () => {
  assert.deepEqual(missingFromWindow(['c', 'a', 'c', 'b', 'a'], () => false), ['c', 'a', 'b']);
  // A blank id would become a query for the document at path `leads/`.
  assert.deepEqual(missingFromWindow(['', 'a', ''], () => false), ['a']);
});

test('batches never exceed what Firestore accepts in one `in` filter', () => {
  const ids = Array.from({ length: 300 }, (_, i) => `lead-${i}`);
  const batches = idBatches(ids);
  assert.equal(batches.length, Math.ceil(300 / ID_BATCH));
  assert.ok(batches.every((batch) => batch.length <= ID_BATCH));
  // Every id appears exactly once, or a folder would drop or double a client.
  assert.deepEqual(batches.flat(), ids);
});

test('nothing missing opens no listener at all', () => {
  assert.deepEqual(idBatches([]), []);
});
