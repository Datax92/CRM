import { test } from "node:test";
import assert from "node:assert/strict";
import { planSync, readSyncMeta, advanceWatermark, FULL_RESYNC_MS, DELTA_SKEW_MS } from "./leadSyncPlan.ts";

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

test("a device that has never synced, or whose record is junk, syncs in full", () => {
  assert.deepEqual(planSync(null, NOW), { mode: "FULL" });
  assert.equal(readSyncMeta(null), null);
  assert.equal(readSyncMeta("not json"), null);
  assert.equal(readSyncMeta(JSON.stringify({ fullAt: "x", watermark: 1 })), null);
  assert.equal(readSyncMeta(JSON.stringify({ fullAt: 0, watermark: 0 })), null);
});

test("inside the six hours it fetches only what changed, from a little before the last stamp it saw", () => {
  const meta = { fullAt: NOW - 2 * 3600_000, watermark: NOW - 3600_000 };
  assert.deepEqual(planSync(meta, NOW), { mode: "DELTA", since: meta.watermark - DELTA_SKEW_MS });
});

test("after six hours it syncs in full again — deletes and unstamped writes cannot linger longer", () => {
  assert.deepEqual(planSync({ fullAt: NOW - FULL_RESYNC_MS, watermark: NOW - 60_000 }, NOW), { mode: "FULL" });
});

test("a record from the future is not trusted", () => {
  assert.deepEqual(planSync({ fullAt: NOW - 60_000, watermark: NOW + 3600_000 }, NOW), { mode: "FULL" });
  assert.deepEqual(planSync({ fullAt: NOW + 3600_000, watermark: NOW }, NOW), { mode: "FULL" });
});

test("the watermark only moves forward, and only to stamps actually seen", () => {
  assert.equal(advanceWatermark(100, [50, null, undefined, 150, 120]), 150);
  assert.equal(advanceWatermark(100, []), 100);
  assert.equal(advanceWatermark(100, [NaN as unknown as number]), 100);
});
