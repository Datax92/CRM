'use client';

/**
 * The whole-pipeline lead list, fetched in full only when it has to be.
 *
 * The admin's and an HR manager's `useLeads` is every lead in the business —
 * ~570 documents on 2026-09-23, growing ~25 a day — and a cold listener is
 * billed for all of them. The plan and its reasoning are in `lib/leadSyncPlan`;
 * this is the runtime:
 *
 * - **FULL** — the ordinary listener, as before, which also refreshes the
 *   device's IndexedDB copy and records when it did.
 * - **DELTA** — the leads come out of that IndexedDB copy (`getDocsFromCache`,
 *   no billed read), and the only live query is `updatedAt > watermark`, which
 *   returns the leads changed since this device last looked and then every
 *   change as it happens. A lead that changes arrives with its new data; one
 *   deleted inside the delta's view arrives as `removed`.
 *
 * Anything that goes wrong in DELTA — no cached copy (a private window, a
 * cleared browser, a first visit), a cache read that throws — falls back to
 * FULL. The failure mode of this module is paying for the reads, never showing
 * a partial list.
 *
 * Shaped like `lib/liveCollection` on purpose — one subscription per key, a
 * keep-alive after the last screen closes, the same `LiveState` — so
 * `useLeads` hands its screens exactly what it handed them before.
 *
 * **Only the whole pipeline uses this.** An employee's or a Sales manager's
 * list is scoped by a `where`, and a lead reassigned *out* of their scope
 * would never appear in their delta — they would keep a lead that is no longer
 * theirs. The admin and HR see everything, so for them a lead can leave the
 * list only by being deleted, which the periodic full sync covers.
 */

import {
  getDocsFromCache,
  onSnapshot,
  Timestamp,
  type DocumentData,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import { timestampMillis } from '@/lib/dates';
import { advanceWatermark, planSync, readSyncMeta, type SyncMeta } from '@/lib/leadSyncPlan';
import type { LiveRow, LiveState } from '@/lib/liveCollection';

const KEEP_ALIVE_MS = 60_000;
const STORAGE_PREFIX = 'crm:leadSync:v1:';
const LOADING: LiveState = { rows: [], loading: true, error: null };

interface Entry {
  state: LiveState;
  byId: Map<string, LiveRow>;
  listeners: Set<() => void>;
  stop: (() => void) | null;
  reap: ReturnType<typeof setTimeout> | null;
  /** A sync has been started — FULL sets `stop` at once, DELTA only after its cache read. */
  started: boolean;
  /** Set when the entry is torn down, so a cache read resolving later does nothing. */
  closed: boolean;
}

const registry = new Map<string, Entry>();

function readMeta(key: string): SyncMeta | null {
  try {
    return readSyncMeta(window.localStorage.getItem(STORAGE_PREFIX + key));
  } catch {
    return null;
  }
}

function writeMeta(key: string, meta: SyncMeta): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(meta));
  } catch {
    // Storage blocked: the next visit simply syncs in full.
  }
}

/** Newest first — the order the full query returns, which every screen assumes. */
function publish(entry: Entry): void {
  const rows = [...entry.byId.values()].sort(
    (a, b) => (timestampMillis(b.createdAt) ?? 0) - (timestampMillis(a.createdAt) ?? 0)
  );
  entry.state = { rows, loading: false, error: null };
  for (const listener of entry.listeners) listener();
}

function fail(entry: Entry, message: string): void {
  entry.state = { rows: [], loading: false, error: message };
  for (const listener of entry.listeners) listener();
}

function stampsIn(snap: QuerySnapshot<DocumentData>): Array<number | null> {
  return snap.docs.map((doc) => timestampMillis(doc.get('updatedAt')));
}

function startFull(key: string, entry: Entry, fullQuery: Query<DocumentData>, onError: (e: unknown) => string): void {
  const startedAt = Date.now();
  let meta: SyncMeta | null = null;
  entry.stop = onSnapshot(
    fullQuery,
    (snap) => {
      entry.byId = new Map(snap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
      // Recorded only from the server's answer — a snapshot served from the
      // cache alone has not proved the device is current.
      if (!snap.metadata.fromCache) {
        const seen = advanceWatermark(meta?.watermark ?? 0, stampsIn(snap));
        meta = { fullAt: startedAt, watermark: seen > 0 ? seen : startedAt };
        writeMeta(key, meta);
      }
      publish(entry);
    },
    (error) => {
      console.error(`[leadSync:${key}] full`, error);
      fail(entry, onError(error));
    }
  );
}

async function startDelta(
  key: string,
  entry: Entry,
  meta: SyncMeta,
  since: number,
  fullQuery: Query<DocumentData>,
  deltaQuery: (since: Timestamp) => Query<DocumentData>,
  onError: (e: unknown) => string
): Promise<void> {
  let cached: QuerySnapshot<DocumentData> | null = null;
  try {
    cached = await getDocsFromCache(fullQuery);
  } catch {
    cached = null;
  }
  if (entry.closed) return;
  if (!cached || cached.empty) {
    startFull(key, entry, fullQuery, onError);
    return;
  }

  entry.byId = new Map(cached.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
  publish(entry);

  let watermark = meta.watermark;
  entry.stop = onSnapshot(
    deltaQuery(Timestamp.fromMillis(since)),
    (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === 'removed') entry.byId.delete(change.doc.id);
        else entry.byId.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
      }
      if (!snap.metadata.fromCache) {
        watermark = advanceWatermark(watermark, stampsIn(snap));
        writeMeta(key, { fullAt: meta.fullAt, watermark });
      }
      publish(entry);
    },
    (error) => {
      // A delta that cannot run (a missing index, a rule) must not leave the
      // screen on a stale copy: fall back to the full listener.
      console.error(`[leadSync:${key}] delta, falling back to a full sync`, error);
      if (entry.closed) return;
      entry.stop = null;
      startFull(key, entry, fullQuery, onError);
    }
  );
}

export function subscribeSyncedLeads(
  key: string,
  fullQuery: () => Query<DocumentData>,
  deltaQuery: (since: Timestamp) => Query<DocumentData>,
  onError: (error: unknown) => string,
  notify: () => void
): () => void {
  let entry = registry.get(key);
  if (!entry) {
    entry = { state: LOADING, byId: new Map(), listeners: new Set(), stop: null, reap: null, started: false, closed: false };
    registry.set(key, entry);
  }
  const current = entry;
  current.listeners.add(notify);

  if (current.reap) {
    clearTimeout(current.reap);
    current.reap = null;
  }

  if (!current.started) {
    current.started = true;
    const meta = readMeta(key);
    const plan = planSync(meta, Date.now());
    if (plan.mode === 'DELTA' && meta) {
      void startDelta(key, current, meta, plan.since, fullQuery(), deltaQuery, onError);
    } else {
      startFull(key, current, fullQuery(), onError);
    }
  }

  return () => {
    current.listeners.delete(notify);
    if (current.listeners.size > 0 || current.reap) return;
    current.reap = setTimeout(() => {
      if (current.listeners.size > 0) {
        current.reap = null;
        return;
      }
      current.closed = true;
      current.stop?.();
      current.stop = null;
      current.reap = null;
      registry.delete(key);
    }, KEEP_ALIVE_MS);
  };
}

export function syncedLeadsState(key: string): LiveState {
  return registry.get(key)?.state ?? LOADING;
}
