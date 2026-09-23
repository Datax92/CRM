import { test } from "node:test";
import assert from "node:assert/strict";
import { countsOf, activityDelta, splitRange, previousDayKey, readCounts, activityDayId } from "./activityDays.ts";
import { entryTally } from "./leadBuckets.ts";

const bools = [false, true];

test("a day's counts are exactly entryTally's, for every kind of entry", () => {
  for (const kind of ["REMARK", "FOLLOW_UP", null]) {
    for (const connect of bools) {
      for (const meetingAligned of bools) {
        const ours = countsOf({ kind, connect, meetingAligned });
        const theirs = entryTally({ leadId: "L", uid: "U", kind, connect, meetingAligned });
        for (const field of ["remarks", "followUps", "newConnects", "followUpConnects", "meetingsAligned"] as const) {
          assert.equal(ours[field], theirs[field], `${field} for ${kind}/${connect}/${meetingAligned}`);
        }
      }
    }
  }
});

test("meetings held and site visits are Reports' own columns, counted from the entry", () => {
  assert.equal(countsOf({ kind: "FOLLOW_UP", meetingHeld: true }).meetings, 1);
  assert.equal(countsOf({ kind: "FOLLOW_UP", siteVisit: true }).siteVisits, 1);
  assert.equal(countsOf({ kind: "FOLLOW_UP" }).meetings, 0);
});

test("a new entry adds its counts; an edit moves only what changed", () => {
  assert.deepEqual(activityDelta(null, { kind: "REMARK", connect: true }), { remarks: 1, newConnects: 1 });
  const before = { kind: "FOLLOW_UP", connect: false, meetingHeld: false };
  assert.deepEqual(activityDelta(before, { ...before, connect: true, meetingHeld: true }), { followUpConnects: 1, meetings: 1 });
  assert.deepEqual(activityDelta({ ...before, connect: true }, before), { followUpConnects: -1 });
  assert.deepEqual(activityDelta(before, before), {});
});

test("a range splits into entries before the start date and day totals from it", () => {
  assert.deepEqual(splitRange("2026-09-01", "2026-09-30", "2026-09-24"), {
    entries: { from: "2026-09-01", to: "2026-09-23" },
    totals: { from: "2026-09-24", to: "2026-09-30" },
  });
  assert.deepEqual(splitRange("2026-09-25", "2026-09-25", "2026-09-24"), { entries: null, totals: { from: "2026-09-25", to: "2026-09-25" } });
  assert.deepEqual(splitRange("2026-09-24", "2026-09-24", "2026-09-24"), { entries: null, totals: { from: "2026-09-24", to: "2026-09-24" } });
  assert.deepEqual(splitRange("2026-08-01", "2026-08-31", "2026-09-24"), { entries: { from: "2026-08-01", to: "2026-08-31" }, totals: null });
});

test("the day before crosses months and years", () => {
  assert.equal(previousDayKey("2026-09-24"), "2026-09-23");
  assert.equal(previousDayKey("2026-10-01"), "2026-09-30");
  assert.equal(previousDayKey("2027-01-01"), "2026-12-31");
  assert.equal(previousDayKey("2028-03-01"), "2028-02-29");
});

test("stored counts read safely", () => {
  assert.deepEqual(readCounts({ remarks: 3, followUps: "x" }).followUps, 0);
  assert.equal(readCounts(null).remarks, 0);
  assert.equal(activityDayId("u1", "2026-09-24"), "u1_2026-09-24");
});
