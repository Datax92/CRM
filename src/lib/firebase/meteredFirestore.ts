'use client';

/**
 * The browser half of the read meter (owner, 2026-09-23): `onSnapshot`,
 * `getDocs` and `getDoc` exactly as `firebase/firestore` has them, plus a
 * count of the documents that **came from Google's servers** — which is what
 * is billed — kept in memory and sent every few minutes to `/api/readmeter`,
 * which writes it to the server log. **Nothing is read from or written to
 * Firestore to do this, and nothing is shown on screen.** The server half is
 * `lib/server/readMeter`.
 *
 * Every client file that reads imports these three from here instead of from
 * `firebase/firestore`. Behaviour is unchanged: same arguments, same
 * callbacks, same unsubscribe.
 *
 * **What is counted, and how close it is to the bill:**
 *
 * - A query listener's **first answer from the server** counts every document
 *   in it (`initial`). That is exact for a cold listen and an over-count when
 *   Firestore resumes a listen from under 30 minutes ago and bills only what
 *   changed — the meter cannot tell the two apart, so it reports them
 *   separately and the daily total can be checked against Firebase's own.
 * - Every later answer counts the documents that changed (`update`).
 * - An answer served from the device's own copy counts nothing — it costs
 *   nothing.
 * - **The silent re-send is caught.** When a page reopens, the listener first
 *   answers from the device's copy; the server then re-sends the same result,
 *   billed in full, and by default the app is never told because nothing
 *   changed. So query listeners are opened with metadata changes on, counted,
 *   and only the answers the screen would have received are passed on.
 * - `getDocs` counts its size (one for an empty result); `getDoc` one.
 * - `getCountFromServer` is billed differently by Google — **one read per up to
 *   a thousand index entries matched**, not one per document — so it is counted
 *   that way rather than as its own answer. Today's pipeline is one read. It is
 *   here at all because a read source the meter cannot see is worse than an
 *   expensive one it can.
 */

import {
  onSnapshot as fsOnSnapshot,
  getDocs as fsGetDocs,
  getDoc as fsGetDoc,
  getDocsFromCache as fsGetDocsFromCache,
  getDocFromCache as fsGetDocFromCache,
  getCountFromServer as fsGetCountFromServer,
  DocumentReference,
  type DocumentData,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
  type SnapshotListenOptions,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth } from '@/lib/firebase/client';
import { isQuotaExhausted } from '@/lib/quotaError';

/* -------------------------------------------------------------------------- */
/* The tally, and getting it to the server log                                 */
/* -------------------------------------------------------------------------- */

const FLUSH_MS = 5 * 60_000;
const tally = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let hooked = false;

/** `/admin/data-bank/abc123…` → `/admin/data-bank/:id`, so one screen is one row. */
function pageKey(): string {
  if (typeof window === 'undefined') return '?';
  return window.location.pathname.replace(/\/[A-Za-z0-9_-]{15,}/g, '/:id');
}

/** A query's or a reference's collection path, ids dropped: `leads/*\/followUps`. */
function collectionKey(target: unknown): string {
  try {
    if (target instanceof DocumentReference) {
      return target.path.split('/').filter((_, index) => index % 2 === 0).join('/*/');
    }
    const internal = (target as { _query?: { path?: { segments?: string[] }; collectionGroup?: string | null } })._query;
    if (internal?.collectionGroup) return `**/${internal.collectionGroup}`;
    const segments = internal?.path?.segments ?? [];
    return segments.filter((_, index) => index % 2 === 0).join('/*/') || '?';
  } catch {
    return '?';
  }
}

function count(target: unknown, kind: 'initial' | 'update' | 'get', reads: number): void {
  if (reads <= 0 || typeof window === 'undefined') return;
  const key = `${pageKey()}|${collectionKey(target)}|${kind}`;
  tally.set(key, (tally.get(key) ?? 0) + reads);
  if (!hooked) {
    hooked = true;
    // Sent when the tab is hidden or closed as well, or a quick visit is lost.
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

function flush(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (tally.size === 0) return;
  const items = Object.fromEntries(tally);
  tally.clear();
  const body = JSON.stringify({ uid: auth?.currentUser?.uid ?? null, items });
  try {
    const sent = typeof navigator !== 'undefined' && navigator.sendBeacon?.('/api/readmeter', new Blob([body], { type: 'application/json' }));
    if (!sent) void fetch('/api/readmeter', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
  } catch {
    // The meter must never break a screen.
  }
}

/* -------------------------------------------------------------------------- */
/* Quiet hours (2026-09-25 night → 2026-09-26 12:00 Karachi)                    */
/* -------------------------------------------------------------------------- */

/**
 * Until the daily read allowance resets at noon Karachi, every screen answers
 * from the device's own copy and opens no live connection; it goes to the
 * server only when the device holds nothing for that query. Deliberately
 * silent on screen, at the owner's instruction. The new-lead offer stays live
 * (`onSnapshotLive`). It ends by itself at `QUIET_UNTIL`, and a tab left open
 * reloads the next time it is shown after that.
 */
const QUIET_UNTIL = Date.parse('2026-09-26T12:00:00+05:00');

/** Quiet hours by the clock alone — `leadSync` asks this to avoid a full sync before noon. */
export function inQuietHours(): boolean {
  if ((globalThis as { __quietHoursOff?: boolean }).__quietHoursOff) return false; // tests
  return typeof window !== 'undefined' && Date.now() < QUIET_UNTIL;
}

/**
 * The admin and HR add expenses, payments and deals at any hour, so for them
 * the money lists they write to stay live (`MONEY_LIVE`) and what they add
 * shows at once; every other list they open is served from the device's copy
 * like everybody else's. Set by `AuthContext` when the role is known.
 */
let financeRole = false;
export function setQuietHoursExempt(isFinanceRole: boolean): void {
  financeRole = isFinanceRole;
}

const MONEY_LIVE = new Set([
  'expenses', 'personalExpenses', 'accounts', 'transactions',
  'receivables', 'receivableEntries', 'receivableSheetConfig',
  'investmentBooks', 'investmentRounds', 'groupMonths', 'groupFinanceConfig',
  'closedDeals', 'dealDistributions', 'dealPayouts',
  'capitalSpendings', 'carSales', 'marketingIncome', 'stateLifePolicies',
  'committee', 'investments', 'capitalInvestments',
]);

function quiet(): boolean {
  return inQuietHours();
}

/**
 * Small, per-person lists that must reflect somebody's own action at once —
 * a remark, a leave request, a personal expense. Single documents are always
 * live too (one read each) — which is how today's attendance record stays live.
 */
const LIVE_IN_QUIET = new Set(['leads/*/followUps', 'leads/*/events', 'personalExpenses', 'leaveRequests']);

function quietFor(target: unknown): boolean {
  if (!quiet() || target instanceof DocumentReference) return false;
  const path = collectionKey(target);
  if (financeRole && MONEY_LIVE.has(path)) return false;
  return !LIVE_IN_QUIET.has(path);
}

let reloadArmed = false;
function armNoonReload(): void {
  if (reloadArmed || typeof window === 'undefined') return;
  reloadArmed = true;
  const reloadWhenSeen = () => {
    if (Date.now() >= QUIET_UNTIL && document.visibilityState === 'visible') window.location.reload();
  };
  document.addEventListener('visibilitychange', reloadWhenSeen);
  setTimeout(() => {
    // Hidden tabs reload when next shown; a hidden one is reloaded then.
    if (document.visibilityState === 'hidden') return;
    reloadWhenSeen();
  }, Math.max(0, QUIET_UNTIL - Date.now()) + 60_000 + Math.random() * 240_000);
}

/** One answer for a listener during quiet hours: the device's copy, else one server read. */
function quietAnswer<T>(target: Query<T> | DocumentReference<T>, observer: Observer<unknown>): Unsubscribe {
  armNoonReload();
  let cancelled = false;
  void (async () => {
    try {
      let snap: QuerySnapshot<T> | DocumentSnapshot<T> | null = null;
      if (target instanceof DocumentReference) {
        try {
          snap = await fsGetDocFromCache(target);
        } catch {
          snap = null;
        }
        if (!snap) snap = await getDoc(target);
      } else {
        try {
          const cached = await fsGetDocsFromCache(target);
          snap = cached.empty ? null : cached;
        } catch {
          snap = null;
        }
        if (!snap) snap = await getDocs(target);
      }
      if (!cancelled) observer.next?.(snap);
    } catch (error) {
      if (!cancelled) observer.error?.(error as Error);
    }
  })();
  return () => {
    cancelled = true;
  };
}

/**
 * **A spent read allowance never shows as an error on a screen that loads
 * data** (owner, 2026-09-25): the listener or read is answered from the
 * device's copy instead, and the screen simply does not update. Saving still
 * reports its own failure — a save that did not happen must not look done.
 */
function quotaFallback<T>(target: Query<T> | DocumentReference<T>, observer: Observer<unknown>): (error: Error) => void {
  return (error: Error) => {
    if (!isQuotaExhausted(error)) {
      observer.error?.(error);
      return;
    }
    void (async () => {
      try {
        const snap = target instanceof DocumentReference ? await fsGetDocFromCache(target) : await fsGetDocsFromCache(target);
        observer.next?.(snap);
      } catch {
        // nothing on the device either: stay as the screen is, without an error
      }
    })();
  };
}

/* -------------------------------------------------------------------------- */
/* The three reads                                                             */
/* -------------------------------------------------------------------------- */

type NextFn<T> = (snapshot: T) => void;
type ErrorFn = (error: Error) => void;
interface Observer<T> {
  next?: NextFn<T>;
  error?: ErrorFn;
  complete?: () => void;
}

function isOptions(value: unknown): value is SnapshotListenOptions {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Observer<unknown>).next !== 'function' &&
    ('includeMetadataChanges' in value || 'source' in value)
  );
}

/** Set for the duration of a `withLive` call: listeners opened inside it stay live in quiet hours. */
let liveThrough = false;

/** Opens listeners that stay live during quiet hours — the lead lists' own delta sync. */
export function withLive<R>(open: () => R): R {
  liveThrough = true;
  try {
    return open();
  } finally {
    liveThrough = false;
  }
}

/** `onSnapshot` that stays live during quiet hours — the new-lead offer. */
export function onSnapshotLive<T = DocumentData>(
  query: Query<T>,
  onNext: (snapshot: QuerySnapshot<T>) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return withLive(() => onSnapshot(query, onNext, onError));
}

// The same call shapes as `firebase/firestore`'s own, so every caller's
// callbacks stay typed.
export function onSnapshot<T = DocumentData>(
  reference: DocumentReference<T>,
  onNext: (snapshot: DocumentSnapshot<T>) => void,
  onError?: (error: Error) => void,
  onCompletion?: () => void
): Unsubscribe;
export function onSnapshot<T = DocumentData>(
  reference: DocumentReference<T>,
  options: SnapshotListenOptions,
  onNext: (snapshot: DocumentSnapshot<T>) => void,
  onError?: (error: Error) => void,
  onCompletion?: () => void
): Unsubscribe;
export function onSnapshot<T = DocumentData>(
  query: Query<T>,
  onNext: (snapshot: QuerySnapshot<T>) => void,
  onError?: (error: Error) => void,
  onCompletion?: () => void
): Unsubscribe;
export function onSnapshot<T = DocumentData>(
  query: Query<T>,
  options: SnapshotListenOptions,
  onNext: (snapshot: QuerySnapshot<T>) => void,
  onError?: (error: Error) => void,
  onCompletion?: () => void
): Unsubscribe;
export function onSnapshot<T = DocumentData>(
  target: Query<T> | DocumentReference<T>,
  ...args: unknown[]
): Unsubscribe {
  // Unpack the SDK's overloads: [options?] then an observer or (next, error, complete).
  let options: SnapshotListenOptions = {};
  if (isOptions(args[0])) options = args.shift() as SnapshotListenOptions;
  let observer: Observer<unknown>;
  if (typeof args[0] === 'function') {
    observer = { next: args[0] as NextFn<unknown>, error: args[1] as ErrorFn | undefined, complete: args[2] as (() => void) | undefined };
  } else {
    observer = (args[0] ?? {}) as Observer<unknown>;
  }

  if (!liveThrough && quietFor(target)) return quietAnswer(target, observer);

  if (target instanceof DocumentReference) {
    let seenServer = false;
    return fsOnSnapshot(target, options, {
      next: (snap: DocumentSnapshot<T>) => {
        if (!snap.metadata.fromCache) {
          count(target, seenServer ? 'update' : 'initial', 1);
          seenServer = true;
        }
        observer.next?.(snap);
      },
      error: quotaFallback(target, observer),
      complete: observer.complete,
    });
  }

  const wantsMetadata = options.includeMetadataChanges === true;
  let delivered = false;
  let seenServer = false;
  return fsOnSnapshot(target, { ...options, includeMetadataChanges: true }, {
    next: (snap: QuerySnapshot<T>) => {
      const changes = snap.docChanges();
      if (!snap.metadata.fromCache) {
        if (!seenServer) {
          count(target, 'initial', Math.max(1, snap.size));
          seenServer = true;
        } else {
          count(target, 'update', changes.filter((change) => change.type !== 'removed').length);
        }
      }
      // Pass on only what the screen would have received without metadata
      // changes: the first answer, and any answer in which documents changed.
      if (wantsMetadata || !delivered || changes.length > 0) {
        delivered = true;
        observer.next?.(snap);
      }
    },
    error: quotaFallback(target, observer),
    complete: observer.complete,
  });
}

export async function getDocs<T = DocumentData>(query: Query<T>): Promise<QuerySnapshot<T>> {
  if (quietFor(query)) {
    try {
      const cached = await fsGetDocsFromCache(query);
      if (!cached.empty) return cached;
    } catch {
      // not on the device — fall through to one server read
    }
  }
  let snap: QuerySnapshot<T>;
  try {
    snap = await fsGetDocs(query);
  } catch (error) {
    if (isQuotaExhausted(error)) return fsGetDocsFromCache(query);
    throw error;
  }
  if (!snap.metadata.fromCache) count(query, 'get', Math.max(1, snap.size));
  return snap;
}

export async function getDoc<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
  let snap: DocumentSnapshot<T>;
  try {
    snap = await fsGetDoc(ref);
  } catch (error) {
    if (isQuotaExhausted(error)) return fsGetDocFromCache(ref);
    throw error;
  }
  if (!snap.metadata.fromCache) count(ref, 'get', 1);
  return snap;
}

/**
 * `getCountFromServer`, counted the way Google bills it: one read per up to a
 * thousand index entries matched, and never fewer than one.
 */
export async function getCountFromServer<T = DocumentData>(query: Query<T>) {
  // Quiet hours: refused, which `liveCount` already treats as "use the floor".
  if (inQuietHours()) throw new Error('count skipped until noon');
  const snap = await fsGetCountFromServer(query);
  count(query, 'get', Math.max(1, Math.ceil(snap.data().count / 1000)));
  return snap;
}
