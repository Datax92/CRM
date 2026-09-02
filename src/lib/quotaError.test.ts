import { test } from "node:test";
import assert from "node:assert/strict";

import { isQuotaExhausted, QUOTA_MESSAGE, FREE_TIER_DAILY_WRITES } from "./quotaError.ts";

test("recognises the browser SDK's string code", () => {
  assert.equal(isQuotaExhausted({ code: "resource-exhausted" }), true);
});

test("recognises the Admin SDK's gRPC status 8", () => {
  assert.equal(isQuotaExhausted({ code: 8, message: "8 RESOURCE_EXHAUSTED: Quota exceeded." }), true);
});

test("recognises an HTTP 429 from the REST transport", () => {
  assert.equal(isQuotaExhausted({ code: 429 }), true);
});

test("recognises the condition from the message alone", () => {
  // Both SDKs sometimes carry the status only in the text.
  assert.equal(isQuotaExhausted(new Error("Quota exceeded for quota metric 'Writes'")), true);
  assert.equal(isQuotaExhausted({ message: "RESOURCE_EXHAUSTED" }), true);
});

test("leaves every other failure alone", () => {
  // These are the codes the app already explains for itself; misreading one of
  // them as a quota problem would send the user to the billing page over a
  // missing index.
  assert.equal(isQuotaExhausted({ code: "permission-denied" }), false);
  assert.equal(isQuotaExhausted({ code: "failed-precondition" }), false);
  assert.equal(isQuotaExhausted({ code: "unavailable" }), false);
  assert.equal(isQuotaExhausted(new Error("The server did not answer in time.")), false);
});

test("survives the shapes an error is not", () => {
  assert.equal(isQuotaExhausted(null), false);
  assert.equal(isQuotaExhausted(undefined), false);
  assert.equal(isQuotaExhausted("resource-exhausted"), false);
  assert.equal(isQuotaExhausted(8), false);
});

test("the message names both ways out", () => {
  assert.match(QUOTA_MESSAGE, /midnight US\/Pacific/);
  assert.match(QUOTA_MESSAGE, /Blaze/);
  assert.equal(FREE_TIER_DAILY_WRITES, 20_000);
});
