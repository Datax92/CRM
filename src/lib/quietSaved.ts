'use client';

/**
 * The last answer a heavy server screen gave on this browser — Payroll, the
 * attendance reports, an employee's activity figures — kept in `localStorage`
 * so that during quiet hours (`inQuietHours`, until 2026-09-26 12:00 Karachi)
 * the screen shows it instead of asking the server again. Nothing saved yet
 * means one ordinary load, which is then saved. Every successful load is
 * saved, before and after quiet hours, so the copy is as fresh as the last
 * visit. Keyed by the signed-in person and the arguments, so two people on one
 * browser never see each other's figures.
 */

import { auth } from '@/lib/firebase/client';
import { inQuietHours } from '@/lib/firebase/meteredFirestore';
import type { ActionResult } from '@/lib/actionResult';

const PREFIX = 'crm:saved:v1:';

export async function savedOrLoad<T>(name: string, args: unknown[], load: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  let key = '';
  try {
    key = `${PREFIX}${auth?.currentUser?.uid ?? 'anon'}:${name}:${JSON.stringify(args)}`;
  } catch {
    key = '';
  }

  if (key && inQuietHours()) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) return { ok: true, data: JSON.parse(raw) as T } as ActionResult<T>;
    } catch {
      // unreadable — load it
    }
  }

  const result = await load();
  // A spent allowance shows the last saved answer rather than an error.
  if (!result.ok && key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) return { ok: true, data: JSON.parse(raw) as T } as ActionResult<T>;
    } catch {
      // nothing saved — the caller shows its failure
    }
  }
  if (key && result.ok) {
    try {
      window.localStorage.setItem(key, JSON.stringify((result as { data: T }).data));
    } catch {
      // storage full or blocked — the screen still has its answer
    }
  }
  return result;
}

/**
 * Drops the saved answers of the named screens for the signed-in person, after
 * a change that makes them wrong — a salary saved, a salary paid, a day
 * corrected — so the next open loads the new figures.
 */
export function forgetSaved(...names: string[]): void {
  try {
    const mine = `${PREFIX}${auth?.currentUser?.uid ?? 'anon'}:`;
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(mine) && names.some((name) => key.startsWith(`${mine}${name}:`))) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // storage blocked — nothing was saved either
  }
}
