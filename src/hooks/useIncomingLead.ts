'use client';

/**
 * The lead currently being *offered* to the signed-in employee.
 *
 * **Driven by the lead, not by the notification.** A notification is a record
 * that something happened; this question is "is there a lead waiting for an
 * answer right now", and only the lead document knows — it is `ASSIGNED` with
 * an `acceptDeadlineAt` still in the future, and it stops being true the
 * instant somebody accepts it, the window lapses, or the cascade moves it on.
 * Reading the notification instead would leave the popup on screen offering a
 * lead that had already gone to the next person.
 *
 * **Its own query, not `useLeads`.** This runs on every screen, and an
 * employee's full pipeline is hundreds of documents; two equality filters with
 * no `orderBy` narrow it to the handful actually awaiting an answer and are
 * served by the automatic single-field indexes, so nothing has to be deployed.
 * Both clauses are also exactly what the `leads` rule checks, so the query is
 * provable rather than refused.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useLive } from './useLive';
import { describeLiveError, type Lead } from './useLeads';
import { ACCEPT_WINDOW_MS } from '@/lib/constants/distribution';
import { timestampMillis } from '@/lib/dates';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';

export interface LeadOffer {
  lead: Lead;
  /** When the window closes. Null on a lead with no deadline recorded. */
  expiresAt: number | null;
}

export function useIncomingLead(
  uid: string | undefined,
  role: string | undefined,
  enabled = true
): { offer: LeadOffer | null; loading: boolean } {
  const demoState = useDemoState();
  // Managers and admins hand leads out; they are never in the accept window.
  const active = enabled && role === 'employee' && Boolean(uid);

  const build = useCallback(
    () =>
      query(
        collection(db, 'leads'),
        where('assignedUserId', '==', uid),
        where('status', '==', 'ASSIGNED')
      ),
    [uid]
  );

  const live = useLive(`leads:offered:${uid ?? 'none'}`, build, !IS_DEMO && active, describeLiveError);

  /*
    A ticking clock, so the offer disappears from the screen the moment the
    window closes rather than at the next unrelated re-render. One interval for
    the whole app — the popup's own countdown reads off the same value.
  */
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    // Set from the timer rather than in the effect body: `Date.now()` in a
    // render or effect body is what the project's lint rule refuses.
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [active]);

  const rows = useMemo<Lead[]>(
    () =>
      IS_DEMO
        ? demoState.leads.filter(
            (lead) => lead.assignedUserId === uid && lead.status === 'ASSIGNED'
          )
        : (live.rows as unknown as Lead[]),
    [demoState.leads, live.rows, uid]
  );

  const offer = useMemo<LeadOffer | null>(() => {
    if (!active || now === 0) return null;

    const open = rows
      .map((lead) => ({ lead, expiresAt: timestampMillis(lead.acceptDeadlineAt) }))
      /*
        A lead with no deadline is still a live offer — the admin assigned it by
        hand, or the record predates the field — so it is kept rather than
        filtered out. Only a deadline that has actually passed removes one: the
        cron sweep will move it on, and until then there is nothing useful the
        employee can do with it.
      */
      .filter((row) => row.expiresAt === null || row.expiresAt > now);

    if (open.length === 0) return null;

    // Soonest to expire first — that is the one needing an answer. A missing
    // deadline sorts last; it is not under a clock.
    open.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
    return open[0];
  }, [rows, active, now]);

  return { offer, loading: active && !IS_DEMO && live.loading };
}

/** The accept window in whole seconds, for the countdown ring. */
export const ACCEPT_WINDOW_SECONDS = Math.round(ACCEPT_WINDOW_MS / 1000);
