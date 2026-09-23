import { test } from "node:test";
import assert from "node:assert/strict";
import { isLeadDocPath, stampData, stampSetOptions, LEAD_UPDATED_AT } from "./leadStamp.ts";

const STAMP = { serverTimestamp: true };

test("only the lead document itself is stamped, never its subcollections", () => {
  assert.equal(isLeadDocPath("leads/abc"), true);
  assert.equal(isLeadDocPath("leads/abc/followUps/f1"), false);
  assert.equal(isLeadDocPath("leads/abc/events/e1"), false);
  assert.equal(isLeadDocPath("users/abc"), false);
  assert.equal(isLeadDocPath("leadsArchive/abc"), false);
  assert.equal(isLeadDocPath("leads/"), false);
  assert.equal(isLeadDocPath(undefined), false);
});

test("a write gains the stamp, and a writer's own updatedAt is kept", () => {
  assert.deepEqual(stampData({ status: "ACCEPTED" }, STAMP), { status: "ACCEPTED", [LEAD_UPDATED_AT]: STAMP });
  assert.deepEqual(stampData({ status: "X", updatedAt: "mine" }, STAMP), { status: "X", updatedAt: "mine" });
});

test("anything that is not plain data passes through untouched", () => {
  assert.equal(stampData("status", STAMP), "status");
  assert.equal(stampData(null, STAMP), null);
  const arr = [1];
  assert.equal(stampData(arr, STAMP), arr);
});

test("mergeFields names the stamp, or it would be dropped", () => {
  assert.deepEqual(stampSetOptions({ mergeFields: ["name"] }), { mergeFields: ["name", LEAD_UPDATED_AT] });
  assert.deepEqual(stampSetOptions({ merge: true }), { merge: true });
  assert.equal(stampSetOptions(undefined), undefined);
});
