'use client';

/**
 * The outbox (owner, 2026-09-25 night): while the day's read allowance is
 * spent, the everyday saves — a remark or follow-up, editing one, a status
 * change, accepting or passing a lead — are kept on the device,
 * shown on screen at once as if saved, and sent to the server after the
 * allowance resets at 12:00 Karachi. Only a save refused **because the
 * allowance is spent** is queued (`QUOTA_MESSAGE`); any other refusal still
 * reaches the person, because nothing sending it later would change the answer.
 *
 * Deliberately narrow and temporary: nothing is queued after `OUTBOX_UNTIL`,
 * and the queue lives in this browser's `localStorage` — clearing the browser
 * before noon loses it, which the owner accepted. A remark keeps its real time
 * (`occurredAt`), so sending it late does not re-date it. **Check in / out is
 * not queued**: the server stamps a punch with its own clock and must not take
 * a time from the device, so a punch refused for the allowance still says so.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { auth } from '@/lib/firebase/client';
import { QUOTA_MESSAGE } from '@/lib/quotaError';
export { overlayFollowUps, overlayLeads, pendingStamp } from '@/lib/outboxOverlay';

export const OUTBOX_UNTIL = Date.parse('2026-09-26T12:00:00+05:00');
const KEY = 'crm:outbox:v1';

export interface OutboxItem {
  id: string;
  uid: string;
  name: string;
  args: unknown[];
  at: number;
}

type Replayer = (token: string, args: unknown[]) => Promise<{ ok: boolean; error?: string }>;

let replayers: Record<string, Replayer> = {};
const listeners = new Set<() => void>();
let version = 0;
let flushing = false;
let started = false;

function readAll(): OutboxItem[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items: OutboxItem[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // storage full or blocked: the item is lost, as it would have been anyway
  }
  version += 1;
  for (const listener of listeners) listener();
}

function me(): string {
  return auth?.currentUser?.uid ?? '';
}

/** Whether a failed save should be kept for later rather than reported. */
export function shouldQueue(result: { ok: boolean; error?: string }): boolean {
  return !result.ok && result.error === QUOTA_MESSAGE && Date.now() < OUTBOX_UNTIL && Boolean(me());
}

export function enqueue(name: string, args: unknown[]): OutboxItem {
  const item: OutboxItem = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    uid: me(),
    name,
    args,
    at: Date.now(),
  };
  writeAll([...readAll(), item]);
  return item;
}

/** This person's queued saves, oldest first. */
export function pendingItems(): OutboxItem[] {
  if (typeof window === 'undefined') return [];
  const uid = me();
  return readAll().filter((item) => item.uid === uid);
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function outboxVersion(): number {
  return version;
}

export function registerReplayers(next: Record<string, Replayer>): void {
  replayers = next;
}

/**
 * Sends what is queued, oldest first, once the allowance has reset. An item the
 * server accepts, or refuses for any reason other than the allowance, leaves
 * the queue (a refusal is logged — there is nobody left to show it to); a spent
 * allowance stops the run and it tries again a minute later.
 */
export async function flushOutbox(): Promise<void> {
  if (flushing || Date.now() < OUTBOX_UNTIL || !auth?.currentUser) return;
  flushing = true;
  try {
    for (;;) {
      const next = pendingItems()[0];
      if (!next) return;
      const replay = replayers[next.name];
      let drop = true;
      if (replay) {
        try {
          const token = await auth.currentUser.getIdToken();
          const result = await replay(token, next.args);
          if (!result.ok && result.error === QUOTA_MESSAGE) drop = false;
          else if (!result.ok) console.warn('[outbox] refused on replay', next.name, result.error);
        } catch (error) {
          console.warn('[outbox] replay failed, will retry', next.name, error);
          drop = false;
        }
      }
      if (!drop) return;
      writeAll(readAll().filter((item) => item.id !== next.id));
    }
  } finally {
    flushing = false;
  }
}

/** Starts trying to send once a minute, and whenever the tab is shown. Idempotent. */
export function startOutboxFlusher(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const tick = () => void flushOutbox();
  setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  setTimeout(tick, 5_000);
}


/** Edits a remark that is still waiting in the queue, in place. */
export function patchQueuedFollowUp(pendingId: string, patch: Record<string, unknown>): boolean {
  const itemId = pendingId.replace(/^pending-/, '');
  const items = readAll();
  const item = items.find((entry) => entry.id === itemId && entry.name === 'addFollowUp');
  if (!item) return false;
  item.args = [item.args[0], { ...(item.args[1] as Record<string, unknown>), ...patch }];
  writeAll(items);
  return true;
}

/** This person's queued saves, re-read whenever the queue changes. */
export function useOutbox(): OutboxItem[] {
  const current = useSyncExternalStore(subscribeOutbox, outboxVersion, () => 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => pendingItems(), [current]);
}
