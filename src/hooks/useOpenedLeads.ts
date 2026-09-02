"use client";

/**
 * Which leads this person has already opened, so the list can shade them.
 *
 * Deliberately **local to the browser**, not a Firestore field. "I have looked
 * at this" is a reading state, not a business fact: it changes on every click,
 * it differs per person, and nobody audits it. Writing it to the lead document
 * would mean a write on every row you click, a rules change to let employees
 * write to leads at all, and a per-user map on a document five people share.
 *
 * The cost of keeping it local is that the shading resets on a new browser or
 * a cleared cache — every lead reads as unopened again. That is the right
 * failure: it over-reports work to do rather than hiding a lead someone has
 * never seen.
 *
 * Keyed by uid so two people sharing a machine do not inherit each other's
 * read state.
 *
 * Exposed through `useSyncExternalStore` rather than an effect that seeds
 * state, for two reasons: localStorage does not exist while the page is being
 * server-rendered, and the server snapshot is empty by construction, so React
 * hydrates against markup that matches and swaps in the real set immediately
 * afterwards. It also means two open tabs of the workspace share one set
 * in memory.
 */

import { useCallback, useSyncExternalStore } from "react";

const KEY_PREFIX = "leadway:openedLeads:";

/**
 * Ids are capped so a long-lived account cannot grow the entry without bound.
 * Oldest-opened are dropped first, which at worst makes an ancient lead look
 * unopened again.
 */
const MAX_REMEMBERED = 2000;

/** One shared instance, so an unchanged snapshot is reference-equal. */
const EMPTY: ReadonlySet<string> = new Set();

/** uid → the ids that uid has opened. Populated on first read. */
const cache = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();

function storageKey(uid: string): string {
  return `${KEY_PREFIX}${uid}`;
}

function readStored(uid: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(uid));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    // Private mode, a full quota, or someone else's malformed value. Reading
    // state is not worth an error boundary — start from empty.
    return [];
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function snapshotFor(uid: string | null | undefined): ReadonlySet<string> {
  if (!uid) return EMPTY;
  const cached = cache.get(uid);
  if (cached) return cached;

  const loaded: ReadonlySet<string> = new Set(readStored(uid));
  cache.set(uid, loaded);
  return loaded;
}

/** Nothing is opened yet as far as the server is concerned — it cannot know. */
function serverSnapshot(): ReadonlySet<string> {
  return EMPTY;
}

function remember(uid: string, leadId: string): void {
  const current = snapshotFor(uid);
  if (current.has(leadId)) return;

  const next = new Set(current);
  next.add(leadId);
  cache.set(uid, next);

  try {
    // Re-read before writing so a second tab's opens are not clobbered.
    const merged = readStored(uid).filter((id) => id !== leadId);
    merged.push(leadId);
    window.localStorage.setItem(storageKey(uid), JSON.stringify(merged.slice(-MAX_REMEMBERED)));
  } catch {
    // Quota or private mode — the shading still works for this session.
  }

  for (const listener of listeners) listener();
}

export function useOpenedLeads(uid: string | null | undefined) {
  const opened = useSyncExternalStore(
    subscribe,
    () => snapshotFor(uid),
    serverSnapshot
  );

  const markOpened = useCallback(
    (leadId: string) => {
      if (uid) remember(uid, leadId);
    },
    [uid]
  );

  const isOpened = useCallback((leadId: string) => opened.has(leadId), [opened]);

  return { isOpened, markOpened };
}
