/**
 * Lead distribution timings and the employee priority scale.
 *
 * These four numbers used to be re-declared in five files — `leads.ts`, the
 * cron sweep, the Meta webhook, the demo store and the LeadCard timer — which
 * is how the accept window ended up documented as 10 minutes in one place and
 * rendered as 10 minutes in a countdown that the sweep expired at a different
 * moment. One definition now, imported everywhere, including the copy shown to
 * users so the text can never drift from the clock.
 */

/** BR-4: how long a new lead waits in the admin queue before auto-distribution. */
export const ADMIN_ASSIGN_WINDOW_MS = 5 * 60_000;

/** BR-7: how long an assigned employee has to accept before the lane cascades. */
export const ACCEPT_WINDOW_MS = 5 * 60_000;

/*
 * LEADS_PER_TURN lives in `src/lib/distribution.ts` alongside the rotation it
 * governs — that module stays dependency free so the test runner can import it
 * without a bundler.
 */

/** Employee priority scale. 1 is the front of the lane. */
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 10;

/** Minutes, for user-facing copy. Derived so the words track the clock. */
export const ACCEPT_WINDOW_MINUTES = Math.round(ACCEPT_WINDOW_MS / 60_000);
export const ADMIN_ASSIGN_WINDOW_MINUTES = Math.round(ADMIN_ASSIGN_WINDOW_MS / 60_000);
