/**
 * The 5-minute deadline sweep, run from Railway.
 *
 * **Why this exists at all.** The CRM's accept window is 5 minutes: an employee
 * is offered a lead, and if they do not answer it must cascade to the next
 * person in the priority lane. The thing that actually moves it is
 * `/api/cron/process-deadlines` — and Vercel's Hobby plan allows **one cron run
 * per day**, so on Vercel the countdown reached 0:00 and the lead sat there
 * until the nightly sweep. That is the whole gap this closes.
 *
 * **It holds no logic of its own, deliberately.** Every rule — who is next in
 * the lane, the force-accept floor at the bottom, the transaction that re-checks
 * the lead before touching it — lives in the CRM. This is a scheduler and
 * nothing else. A second implementation of "who gets this lead" running on a
 * different host is exactly how two systems start disagreeing about the same
 * lead, so there isn't one: it makes an HTTP request and reports what came back.
 *
 * **Safe to run every five minutes, and safe to overlap.** Each handler
 * re-checks the lead's current state inside a Firestore transaction, so a
 * repeated or concurrent invocation is a no-op rather than a double
 * assignment. The two expiry queries are bounded and return nothing when
 * nothing is due, and the stale-lead alert is gated to once per Karachi day by
 * a marker document — about 860 Firestore reads a day in total, against a
 * 50,000/day cap.
 *
 * Exits non-zero when a target fails, so a broken run shows as failed in
 * Railway rather than as a green tick with an error in the logs.
 */

/** Where the CRM lives. No trailing slash. */
const BASE_URL = (process.env.CRM_URL ?? '').trim().replace(/\/+$/, '');

/**
 * The shared secret the route checks. **The same value as Vercel's
 * `CRON_SECRET`** — the route compares it byte for byte and fails closed, so a
 * mismatch is a 401 on every run rather than a silent no-op.
 */
const CRON_SECRET = (process.env.CRON_SECRET ?? '').trim();

/**
 * Which routes to sweep. One per run, comma-separated to override.
 *
 * Only `process-deadlines` needs five-minute precision — it is the one holding
 * a 5-minute SLA. `recalculate-priorities` and `mark-absentees` are daily by
 * nature and stay on Vercel's own scheduler, where a daily run is all the
 * Hobby plan allows and all they need.
 */
const TARGETS = (process.env.CRON_TARGETS ?? '/api/cron/process-deadlines')
  .split(',')
  .map((path) => path.trim())
  .filter(Boolean);

/** The route declares `maxDuration = 60`; allow it that plus the round trip. */
const TIMEOUT_MS = Number(process.env.CRON_TIMEOUT_MS ?? 75_000);

function fail(message) {
  console.error(`[sweep] ${message}`);
  process.exit(1);
}

if (!BASE_URL) fail('CRM_URL is not set. Set it to the deployed CRM, e.g. https://your-app.vercel.app');
if (!/^https:\/\//.test(BASE_URL)) {
  // The secret travels in a header. Over plain HTTP it travels in the clear,
  // and anyone holding it can trigger reassignment across the whole pipeline.
  fail(`CRM_URL must be https — got ${BASE_URL}`);
}
if (!CRON_SECRET) fail('CRON_SECRET is not set. It must match the CRON_SECRET in the CRM deployment.');

async function sweep(path) {
  const url = `${BASE_URL}${path}`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        // Exactly the header Vercel Cron sends, which is what the route checks.
        authorization: `Bearer ${CRON_SECRET}`,
        'user-agent': 'crm-railway-cron',
      },
      signal: controller.signal,
    });

    const elapsed = Date.now() - startedAt;
    const body = await response.text();

    if (!response.ok) {
      // 401 means the secrets differ; 503 means the CRM has no CRON_SECRET at
      // all. Both are configuration, and both print the body so the log says
      // which without anybody having to guess.
      console.error(`[sweep] ${path} → ${response.status} in ${elapsed}ms: ${body.slice(0, 400)}`);
      return false;
    }

    // The route answers with what it actually did — how many leads were
    // auto-assigned and how many cascaded — so the log is a record of the
    // lane working, not just of the request succeeding.
    console.log(`[sweep] ${path} → 200 in ${elapsed}ms: ${body.slice(0, 400)}`);
    return true;
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    const reason = error?.name === 'AbortError' ? `timed out after ${TIMEOUT_MS}ms` : String(error);
    // A timeout cannot cancel the request: the sweep may well have committed.
    // Every handler is idempotent, so the next run finishes whatever this one
    // started, and saying so stops anybody "fixing" a duplicate that is not one.
    console.error(`[sweep] ${path} failed in ${elapsed}ms — ${reason}. It may still have run; the next sweep is safe to repeat.`);
    return false;
  }
}

const results = [];
for (const path of TARGETS) {
  // Sequential on purpose: these hit one deployment, and firing them together
  // buys nothing while making a slow response look like a stalled service.
  results.push(await sweep(path));
}

if (results.some((ok) => !ok)) {
  fail(`${results.filter((ok) => !ok).length} of ${results.length} sweep(s) failed.`);
}

console.log(`[sweep] done — ${results.length} target(s) swept.`);
