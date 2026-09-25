/**
 * How many leads a live subscription should hold.
 *
 * **The number is derived from the data, not chosen by a person.** It used to be
 * a constant, and on 2026-09-23 the pipeline outgrew it: `leads` passed 500, the
 * 36 oldest stopped being loaded, and a Client folder holding 34 rows displayed
 * 14 — with nothing deleted and nothing reassigned. A constant is a promise
 * somebody has to remember to renew, and the cost of forgetting is a screen that
 * reads as data loss.
 *
 * So `leadWindowSize` takes the collection's own count and adds headroom. What
 * it deliberately does **not** do is return whatever the count says:
 *
 * - `LEAD_WINDOW_FLOOR` — never smaller, so a count that fails, arrives late or
 *   comes back junk can only ever leave the window at the size it already was.
 *   A count is an optimisation; nothing may break when it does not answer.
 * - `LEAD_WINDOW_CEILING` — a **circuit breaker, not a limit**. The binding
 *   constraint above a few thousand leads is not Firestore's read bill, it is
 *   the browser: `onSnapshot` keeps every matched document in memory and
 *   republishes the whole array on any change, and the leads workspace then
 *   filters, searches, sorts and paginates that array in JavaScript, on a phone
 *   as well as a laptop. Past the ceiling the honest answer is server-side
 *   paging, and `truncated` says so on screen rather than quietly dropping the
 *   oldest leads — which is the failure this module exists to end.
 *
 * Imports nothing, so it runs under the raw `--experimental-strip-types` loader.
 */

/** The smallest window, and what an unknown or unusable count falls back to. */
export const LEAD_WINDOW_FLOOR = 2000;

/** The largest window. Beyond this, `truncated` is the answer — see above. */
export const LEAD_WINDOW_CEILING = 6000;

/** Windows are rounded up to this, so a lead a minute does not re-key the
 *  subscription a minute. */
export const LEAD_WINDOW_STEP = 500;

/** Room for the leads that arrive while a session is open. */
export const LEAD_WINDOW_HEADROOM = 1.25;

/** The most document ids Firestore accepts in one `in` filter. */
export const ID_BATCH = 30;

/**
 * The window for a collection of `count` leads.
 *
 * `null` — the count has not arrived, or failed — yields the floor, so a screen
 * renders at the size it would have had anyway rather than waiting on a number
 * it does not need.
 */
export function leadWindowSize(count: number | null | undefined): number {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
    return LEAD_WINDOW_FLOOR;
  }
  const wanted = Math.ceil((count * LEAD_WINDOW_HEADROOM) / LEAD_WINDOW_STEP) * LEAD_WINDOW_STEP;
  return Math.min(LEAD_WINDOW_CEILING, Math.max(LEAD_WINDOW_FLOOR, wanted));
}

/**
 * Whether a window came back full, so there are probably older leads outside it.
 *
 * A full window cannot *prove* more exist — the collection may be exactly that
 * long — which is why every reader words it as a possibility.
 */
export function windowIsFull(rowCount: number, size: number): boolean {
  return rowCount >= size;
}

/**
 * The ids a caller still needs: the ones the window does not hold.
 *
 * This is what keeps a Client folder correct **whatever the window is**. A
 * folder's contents are its membership rows, not the subset of them that
 * happens to be loaded, so the leads it is missing are fetched by id. Deduped
 * and order-preserving, because the result keys live subscriptions.
 */
export function missingFromWindow(
  memberIds: readonly string[],
  loaded: (leadId: string) => boolean
): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const id of memberIds) {
    if (!id || seen.has(id) || loaded(id)) continue;
    seen.add(id);
    missing.push(id);
  }
  return missing;
}

/** Splits ids into `in`-sized batches. An empty list yields no batches, so a
 *  folder that needs nothing opens no listener. */
export function idBatches(ids: readonly string[], size = ID_BATCH): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size) batches.push(ids.slice(i, i + size));
  return batches;
}
