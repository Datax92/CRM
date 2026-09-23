'use client';

/**
 * One listener per query, shared by every screen that wants it.
 *
 * **The problem this solves is reads, and it is a real bill.** Every screen in
 * the Accounts section calls `useLedger`, and each call used to open its own
 * `onSnapshot` on `accounts` and on `transactions`. Firestore charges a read
 * per document in a listener's **initial** result, so opening Office Expenses,
 * going back, and opening StateLife paid for the whole transaction collection
 * three times over — and on a phone, where the section is a tab somebody taps
 * in and out of, that is the normal way to use it.
 *
 * Two mechanisms, both cheap:
 *
 * 1. **One subscription per key.** Ten components asking for `transactions` get
 *    one listener and one copy of the data. Nothing re-fetches because a second
 *    screen mounted.
 * 2. **A keep-alive after the last unmount.** Navigating away does not tear the
 *    listener down for `KEEP_ALIVE_MS`; coming back inside that window is free
 *    and instant. Beyond it the listener closes, so a session left on another
 *    part of the app is not holding streams open for ever.
 *
 * The SDK's own IndexedDB cache (`persistentLocalCache`, wired up in
 * `firebase/client`) sits underneath this and makes a *cold* re-subscribe cheap
 * too — but only this stops a warm one happening at all.
 *
 * Snapshot identity matters: `useSyncExternalStore` re-renders whenever the
 * snapshot is a new object, so the store hands back **the same array** until
 * Firestore actually sends something new.
 */

import {
  type Query,
  type DocumentData,
} from 'firebase/firestore';
// Metered: counts the reads Google bills, into the server log only.
import { onSnapshot } from '@/lib/firebase/meteredFirestore';

/** How long a listener outlives its last subscriber. */
const KEEP_ALIVE_MS = 60_000;

export interface LiveRow {
  id: string;
  [field: string]: unknown;
}

export interface LiveState {
  rows: LiveRow[];
  loading: boolean;
  error: string | null;
}

const LOADING: LiveState = { rows: [], loading: true, error: null };

interface Entry {
  state: LiveState;
  listeners: Set<() => void>;
  stop: (() => void) | null;
  reap: ReturnType<typeof setTimeout> | null;
}

const registry = new Map<string, Entry>();

function entryFor(key: string): Entry {
  let entry = registry.get(key);
  if (!entry) {
    entry = { state: LOADING, listeners: new Set(), stop: null, reap: null };
    registry.set(key, entry);
  }
  return entry;
}

function publish(entry: Entry, next: LiveState): void {
  entry.state = next;
  for (const listener of entry.listeners) listener();
}

/**
 * Subscribes to a query, or joins the subscription that already exists.
 *
 * `buildQuery` is called **only when a listener actually has to be opened**, so
 * a component joining a live subscription never constructs a query object it
 * will not use.
 */
export function subscribeLive(
  key: string,
  buildQuery: () => Query<DocumentData>,
  onError: (error: unknown) => string,
  notify: () => void
): () => void {
  const entry = entryFor(key);
  entry.listeners.add(notify);

  // A subscriber arriving inside the keep-alive window cancels the teardown and
  // gets the data that is already here — no query, no read, no loading state.
  if (entry.reap) {
    clearTimeout(entry.reap);
    entry.reap = null;
  }

  if (!entry.stop) {
    entry.stop = onSnapshot(
      buildQuery(),
      (snap) => publish(entry, {
        rows: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
        loading: false,
        error: null,
      }),
      (error) => {
        console.error(`[live:${key}]`, error);
        publish(entry, { rows: [], loading: false, error: onError(error) });
      }
    );
  }

  return () => {
    entry.listeners.delete(notify);
    if (entry.listeners.size > 0 || entry.reap) return;

    entry.reap = setTimeout(() => {
      // Re-checked at the moment it fires: somebody may have subscribed and
      // unsubscribed again in between, and a stale timer must not close a
      // listener that is in use.
      if (entry.listeners.size > 0) {
        entry.reap = null;
        return;
      }
      entry.stop?.();
      entry.stop = null;
      entry.reap = null;
      // The data is dropped with the listener. Keeping it would mean a screen
      // opened tomorrow rendering yesterday's balances for a frame before the
      // first snapshot lands, which is worse than a skeleton.
      entry.state = LOADING;
      registry.delete(key);
    }, KEEP_ALIVE_MS);
  };
}

export function liveState(key: string): LiveState {
  return registry.get(key)?.state ?? LOADING;
}

/** The server render has no listener and no data — never `loading`, or the
 *  markup would hydrate into a skeleton the client immediately replaces. */
export const SERVER_STATE: LiveState = { rows: [], loading: true, error: null };

/** Test seam: drops every listener. Not called by the app. */
export function resetLive(): void {
  for (const entry of registry.values()) {
    if (entry.reap) clearTimeout(entry.reap);
    entry.stop?.();
  }
  registry.clear();
}
