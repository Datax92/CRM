/**
 * Names the one failure on this project that never named itself.
 *
 * Firestore's free (Spark) plan allows 50,000 document reads, 20,000 writes and
 * 20,000 deletes per project per day, resetting at midnight US/Pacific. Past
 * that ceiling Firestore answers writes with `RESOURCE_EXHAUSTED` — and neither
 * SDK reports that as a failure. Both **retry it with backoff**, so what the
 * user sees is not an error but a delay: a button that spins for twenty-five
 * seconds and then says the server did not answer, while the browser keeps
 * reading the same data instantly (reads have a separate, larger allowance).
 * That is precisely the "sometimes it works, sometimes it hangs" signature that
 * was reported here four times over, and none of the code paths involved was at
 * fault.
 *
 * A 40,000-row Data Bank import is 40,000 writes — twice a whole day's free
 * allowance in one operation — so on this project the ceiling is reachable in a
 * single afternoon. The fix is not in the code: it is either the Blaze plan
 * (pay-as-you-go, about $0.18 per 100,000 writes) or waiting for the reset.
 * What the code owes the user is to say so instead of blaming the network.
 */

/** Documents the free plan may be written per project per day. */
export const FREE_TIER_DAILY_WRITES = 20_000;

export const QUOTA_MESSAGE =
  "This project has used up its Firestore free-tier quota for today " +
  "(20,000 writes / 20,000 deletes / 50,000 reads). Writes will keep timing " +
  "out until the quota resets at midnight US/Pacific. To lift the ceiling now, " +
  "upgrade the project to the Blaze pay-as-you-go plan in the Firebase console " +
  "→ Usage and billing.";

/**
 * True when an error is Firestore refusing work because a quota is spent.
 *
 * The same condition arrives in three shapes and all three have to be caught:
 * the browser SDK's string code, the Admin SDK's gRPC status 8, and — when
 * `FIREBASE_PREFER_REST=true` — an HTTP 429. Message matching is the backstop,
 * because the SDKs sometimes surface the status only in the text.
 */
export function isQuotaExhausted(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const { code, message } = error as { code?: unknown; message?: unknown };

  if (code === "resource-exhausted" || code === 8 || code === 429) return true;

  return typeof message === "string" && /RESOURCE_EXHAUSTED|Quota exceeded/i.test(message);
}
