/**
 * Puts a ceiling on how long a Server Action may leave a button spinning.
 *
 * A Server Action that never resolves — a cold function that overruns the
 * platform's limit, a dropped connection mid-flight — leaves the caller's
 * `finally` block unreached and the button stuck on "Working…" forever, with
 * no way to tell whether the work happened. That is the worst of both: the
 * user cannot retry safely and cannot walk away.
 *
 * This does **not** cancel the request. The server may well have committed the
 * write, which is why the message says so rather than claiming failure — and
 * why every operation that uses this must be safe to retry (promotion re-reads
 * the record and fails cleanly if it is already gone; imports skip numbers the
 * folder already holds).
 */
export const ACTION_TIMEOUT_MS = 25_000;

/**
 * A timeout here is usually not a network problem.
 *
 * When a project passes its Firestore daily quota, writes are refused with
 * `RESOURCE_EXHAUSTED` and the SDK *retries with backoff* rather than failing,
 * so the error never reaches this code — the request simply outlives the
 * ceiling below. That makes the quota the first thing worth checking, and
 * saying so here is the difference between a five-minute fix and another round
 * of hunting the wrong bug.
 */
export class ActionTimeout extends Error {
  constructor() {
    super(
      "The server did not answer in time. It may still have gone through — " +
        "refresh in a moment and check before trying again. If this keeps " +
        "happening, check Firebase console → Usage and billing first: once the " +
        "day's free quota is spent, every write stalls exactly like this."
    );
    this.name = "ActionTimeout";
  }
}

export function withTimeout<T>(work: Promise<T>, ms: number = ACTION_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ActionTimeout()), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
