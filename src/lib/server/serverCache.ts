/**
 * A short-lived in-memory cache for data that is read on nearly every request
 * and changes rarely — a person's profile, the settings documents, the roster
 * (owner, 2026-09-23, the day the free read quota ran out).
 *
 * **Why these, and only these.** `verifyAuth` read the caller's profile on every
 * Server Action — one read per click, all day, for a document that changes a
 * few times a month. Attendance settings were read on every check-in and every
 * home-screen load. None of it needs to be current to the second.
 *
 * **Never inside a transaction.** Anything read to decide a write keeps reading
 * Firestore: a cached value there could write something wrong. This is only for
 * reads that decide what to show, or who is asking.
 *
 * **Kept current on this server by the write itself.** `noteWrite` is called by
 * the same `WriteBatch` hook that stamps leads (`lib/server/leadStampInstall`),
 * so any write to a cached document — by any action, now or added later —
 * drops it here at once. Other warm servers hold theirs until `ttlMs`, which is
 * why the windows are short: 30 seconds for a profile, so disabling an account
 * takes effect everywhere within half a minute.
 *
 * Per server instance, in memory: nothing is written anywhere, and a cold
 * instance simply reads.
 */

interface Entry {
  at: number;
  ttlMs: number;
  value: Promise<unknown>;
}

const entries = new Map<string, Entry>();

/**
 * The value under `key`, loaded by `load` when absent or older than `ttlMs`.
 * Concurrent callers share one load; a failed load is not remembered.
 */
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < hit.ttlMs) return hit.value as Promise<T>;
  const value = load();
  entries.set(key, { at: Date.now(), ttlMs, value });
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
}

/** Drops every entry whose key starts with `prefix`. */
export function forgetCached(prefix: string): void {
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
}

/** The cache key for one document, so readers and `noteWrite` agree. */
export function docKey(path: string): string {
  return `doc:${path}`;
}

/**
 * Called for every firebase-admin write on this server. A written document
 * drops its own entry; any write to a profile also drops the rosters built
 * from profiles.
 */
export function noteWrite(path: string | undefined): void {
  if (!path) return;
  forgetCached(docKey(path));
  if (path.startsWith("users/")) forgetCached("roster:");
  // Any attendance record written drops every cached month — see
  // `lib/server/attendanceMonth`. Months, not just the record's own, because a
  // record's month is in its data, not in its path.
  if (path.startsWith("attendance/")) forgetCached("attendanceMonth:");
}
