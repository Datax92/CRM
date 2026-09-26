import { test } from "node:test";
import assert from "node:assert/strict";
import { cached, forgetCached, noteWrite, docKey } from "./serverCache.ts";

test("a value is loaded once and reused inside its window", async () => {
  let loads = 0;
  const load = async () => ++loads;
  assert.equal(await cached("t:a", 60_000, load), 1);
  assert.equal(await cached("t:a", 60_000, load), 1);
  assert.equal(loads, 1);
});

test("simultaneous callers share one load", async () => {
  let loads = 0;
  const load = () => new Promise<number>((resolve) => setTimeout(() => resolve(++loads), 10));
  const [a, b] = await Promise.all([cached("t:b", 60_000, load), cached("t:b", 60_000, load)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(loads, 1);
});

test("an expired value is loaded again", async () => {
  let loads = 0;
  await cached("t:c", 1, async () => ++loads);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await cached("t:c", 1, async () => ++loads), 2);
});

test("a failed load is not remembered", async () => {
  await assert.rejects(cached("t:d", 60_000, async () => { throw new Error("down"); }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await cached("t:d", 60_000, async () => "up"), "up");
});

test("a write drops its document, and a profile write drops the rosters", async () => {
  let loads = 0;
  const load = async () => ++loads;
  await cached(docKey("users/u1"), 60_000, load);
  await cached("roster:everyone", 60_000, load);
  await cached(docKey("config/attendance"), 60_000, load);
  noteWrite("users/u1");
  assert.equal(await cached(docKey("users/u1"), 60_000, load), 4);
  assert.equal(await cached("roster:everyone", 60_000, load), 5);
  assert.equal(await cached(docKey("config/attendance"), 60_000, load), 3); // untouched
  forgetCached("doc:config/");
  assert.equal(await cached(docKey("config/attendance"), 60_000, load), 6);
});

test("an attendance write drops every cached month, and only those", async () => {
  // Payroll and the team calendar share `attendanceMonth:` copies
  // (`lib/server/attendanceMonth`); a punch or a correction must never leave
  // either showing the day as it was.
  forgetCached(""); // the cache is module memory, shared with the tests above
  let loads = 0;
  const load = async () => ++loads;
  await cached("attendanceMonth:2026-09", 60_000, load);
  await cached("attendanceMonth:2026-08", 60_000, load);
  await cached("roster:everyone", 60_000, load);
  noteWrite("attendance/u1_2026-09-26");
  assert.equal(await cached("attendanceMonth:2026-09", 60_000, load), 4);
  // The record's month is in its data, not its path, so every month goes.
  assert.equal(await cached("attendanceMonth:2026-08", 60_000, load), 5);
  assert.equal(await cached("roster:everyone", 60_000, load), 3); // untouched
});

test("a write elsewhere leaves the cached months alone", async () => {
  let loads = 0;
  const load = async () => ++loads;
  forgetCached("attendanceMonth:");
  await cached("attendanceMonth:2026-09", 60_000, load);
  noteWrite("leads/abc");
  noteWrite("attendancePeriods/2026-09");
  assert.equal(await cached("attendanceMonth:2026-09", 60_000, load), 1);
});
