'use client';

/**
 * How many documents a query matches, asked once and shared.
 *
 * This exists so a live subscription can size itself to the data instead of to a
 * constant somebody chose — see `lib/leadWindow`. Three things make it safe to
 * put on the path of every leads screen:
 *
 * 1. **It is cheap.** An aggregate count bills one read per thousand index
 *    entries matched, so today's pipeline costs a single read — against the 500
 *    a window of leads costs anyway.
 * 2. **It is shared and cached.** Four components ask `useLeads` on one page
 *    (the dashboard, the workspace, the directory, the deals screen); one count
 *    answers all of them, and a second mount inside `TTL_MS` asks nothing. The
 *    in-flight promise is held too, so four simultaneous mounts make one call.
 * 3. **Its failure is invisible.** A refusal, an exhausted quota or an offline
 *    browser leaves the count `null`, which `leadWindowSize` reads as the floor.
 *    Nothing renders differently and nothing waits: the count can only ever make
 *    the window *bigger* than it would have been, never smaller or later.
 *
 * Staleness is deliberately tolerated. The window carries headroom, so a count
 * a few minutes old still covers the leads that have arrived since; asking again
 * on every mount would spend reads to sharpen a number that is already rounded
 * to the nearest 500.
 */

import type { Query, DocumentData } from 'firebase/firestore';
// Metered: counts the reads Google bills, into the server log only.
import { getCountFromServer } from '@/lib/firebase/meteredFirestore';

/**
 * How long a count is reused before it is asked again.
 *
 * Thirty minutes, not five, because this project's free read quota ran out at
 * 17:15 on 2026-09-23 and `lib/leadSync` exists to answer that. The window
 * carries 25% headroom over the count, so at ~25 leads a day a half-hour-old
 * answer is out by well under one lead — there is nothing to buy by asking more
 * often, and ~20 reads a day is what this costs at that interval.
 */
const TTL_MS = 30 * 60_000;

interface Entry {
  count: number | null;
  at: number;
  listeners: Set<() => void>;
  inflight: Promise<void> | null;
}

const registry = new Map<string, Entry>();

function entryFor(key: string): Entry {
  let entry = registry.get(key);
  if (!entry) {
    entry = { count: null, at: 0, listeners: new Set(), inflight: null };
    registry.set(key, entry);
  }
  return entry;
}

function ask(key: string, entry: Entry, buildQuery: () => Query<DocumentData>): void {
  if (entry.inflight) return;
  if (entry.count !== null && Date.now() - entry.at < TTL_MS) return;

  entry.inflight = getCountFromServer(buildQuery())
    .then((snap) => {
      entry.count = snap.data().count;
      entry.at = Date.now();
      for (const listener of entry.listeners) listener();
    })
    .catch((error) => {
      // Deliberately swallowed past a log line. A window sized from the floor is
      // a working screen; a thrown error here would break one that does not need
      // this answer at all.
      console.warn(`[count:${key}] unavailable, falling back to the floor`, error);
      entry.at = Date.now();
    })
    .finally(() => {
      entry.inflight = null;
    });
}

/** Subscribes to a key's count, asking for it if nobody has recently. */
export function subscribeCount(
  key: string,
  buildQuery: () => Query<DocumentData>,
  notify: () => void
): () => void {
  const entry = entryFor(key);
  entry.listeners.add(notify);
  ask(key, entry, buildQuery);

  return () => {
    entry.listeners.delete(notify);
    // The value is kept after the last listener leaves: it is one number, it is
    // what stops the next mount asking again, and it cannot go stale in a way
    // that matters (see the module note).
  };
}

/** The count for a key, or `null` when it has not arrived or could not be had. */
export function countState(key: string): number | null {
  return registry.get(key)?.count ?? null;
}

/** Test seam: forgets every count. Not called by the app. */
export function resetCounts(): void {
  registry.clear();
}
