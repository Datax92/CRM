'use client';

import { useSyncExternalStore } from 'react';
import { inQuietHours } from '@/lib/firebase/meteredFirestore';

/** Re-checked every minute, so a screen open at noon notices without a reload. */
function subscribe(notify: () => void): () => void {
  const timer = setInterval(notify, 60_000);
  return () => clearInterval(timer);
}

/**
 * Whether quiet hours are on (until 2026-09-26 12:00 Karachi). False on the
 * server render, so the first paint matches and the switch lands after it.
 */
export function useQuietHours(): boolean {
  return useSyncExternalStore(subscribe, inQuietHours, () => false);
}

/** The Team → Reports screens, taken out of the menus during quiet hours (owner, 2026-09-25). */
export const HIDDEN_IN_QUIET = new Set(['/admin/team/reports', '/subadmin/reports']);
