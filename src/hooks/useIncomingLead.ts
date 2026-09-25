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
import { LANE_HOLD_UNTIL, offerOpensAt } from '@/lib/distribution';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';
import { useOutbox } from '@/lib/outbox';

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
  const outbox = useOutbox();
  /*
    Employees, managers an admin has put in the rotation — **and the admin
    themselves, when a folder is routed to them by name** (`setFolderLane`).

    The admin used to be excluded on the reasoning that they hand leads out
    rather than receive them, which was true while every automatic lead came
    from the company-wide lane. A folder that names the admin breaks it: the
    lead lands `ASSIGNED` with a five-minute clock and, with no popup, nobody
    on that screen would ever know — it would lapse, raise a red flag against
    the admin and cascade to somebody else. An admin still never sees an offer
    they did not ask for, because a hand-assigned lead is written `ACCEPTED`
    outright and only a lane offer is ever `ASSIGNED`.
  */
  const isManager = role === 'subadmin';

  /*
    The morning hold (`LANE_HOLD_UNTIL`, 2026-09-26 11:00): no listener at all
    before it — nothing is offered until then anyway. Checked from a timer,
    because the lint rule refuses `Date.now()` in a render or effect body.
  */
  const [holdOver, setHoldOver] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const wait = LANE_HOLD_UNTIL - Date.now();
      if (wait <= 0) setHoldOver(true);
      else timer = setTimeout(check, Math.min(wait, 60_000));
    };
    timer = setTimeout(check, 0);
    return () => clearTimeout(timer);
  }, []);

  const active =
    enabled && holdOver && (role === 'employee' || isManager || role === 'admin') && Boolean(uid);

  const build = useCallback(
    () =>
      isManager
        ? /*
            A Sales manager's `leads` rule is `subAdminUid == me`, and a list
            query must prove it or it is refused outright. A lead offered to a
            manager files under their own uid, so the clause matches.
          */
          query(
            collection(db, 'leads'),
            where('subAdminUid', '==', uid),
            where('assignedUserId', '==', uid),
            where('status', '==', 'ASSIGNED')
          )
        : query(
            collection(db, 'leads'),
            where('assignedUserId', '==', uid),
            where('status', '==', 'ASSIGNED')
          ),
    [uid, isManager]
  );

  const live = useLive(`leads:offered:${isManager ? 'mgr' : 'emp'}:${uid ?? 'none'}`, build, !IS_DEMO && active, describeLiveError);

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
        : (live.rows as unknown as Lead[]).filter(
            // Accepted or passed from the outbox: no longer an offer.
            (lead) => !outbox.some((item) => (item.name === 'acceptLead' || item.name === 'passLead') && item.args[0] === lead.id)
          ),
    [demoState.leads, live.rows, uid, outbox]
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
      .filter((row) => row.expiresAt === null || row.expiresAt > now)
      // Not before its window opens: a held offer waits for its slot.
      .filter((row) => row.expiresAt === null || offerOpensAt(row.expiresAt, ACCEPT_WINDOW_MS) <= now);

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
