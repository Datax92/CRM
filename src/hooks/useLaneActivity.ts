'use client';

/**
 * This month's lead activity for a set of people, keyed by uid.
 *
 * **The same documents `recalcPriorities` reads.** The lane screen has to be
 * able to explain the order the nightly job produced, so it asks the same
 * question of the same records — `users/{uid}/kpiMonths/{YYYY-MM}` — rather
 * than re-deriving connects and follow-ups from the leads collection. Two
 * derivations of one number is how a screen ends up contradicting the job it
 * is describing.
 *
 * One listener per person, which is what `useTeamKpi` already does for the
 * dashboard: the roster is small, each person's month is a single document,
 * and a collection-group query would need its own index *and* its own rule.
 *
 * `passes` is here and nowhere else — it is not a KPI, it is the lane's own
 * counter, written by `passLead`.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  doc,
} from 'firebase/firestore';
// Metered: counts the reads Google bills, into the server log only.
import { onSnapshot } from '@/lib/firebase/meteredFirestore';
import { db } from '@/lib/firebase/client';
import { karachiMonthKey } from '@/lib/dates';
import { readLeadActivity, EMPTY_LEAD_ACTIVITY, type LeadActivity } from '@/lib/leadPriority';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';

interface LaneState {
  /** Who these rows are about — see the reset below. */
  key: string;
  rows: Record<string, LeadActivity>;
  settled: number;
}

export function useLaneActivity(
  uids: string[],
  enabled = true
): { activity: Record<string, LeadActivity>; loading: boolean } {
  const demoState = useDemoState();

  /*
    A fresh array every render would tear down and rebuild every listener on
    every render. The sorted join is the actual dependency — who is in the set,
    not which array object happens to hold them.
  */
  const key = useMemo(() => [...uids].sort().join(','), [uids]);
  const expected = key === '' ? 0 : key.split(',').length;

  const [state, setState] = useState<LaneState>({ key, rows: {}, settled: 0 });

  /*
    **Reset during render, not in an effect.** The rows belong to a particular
    set of people; when that set changes they are stale and must not be shown
    for even one frame beside the new roster. An effect would paint the old
    numbers first. (The project's lint rule refuses `setState` in an effect
    body for exactly this reason — see CLAUDE.md.)
  */
  if (state.key !== key) setState({ key, rows: {}, settled: 0 });

  useEffect(() => {
    if (IS_DEMO || !enabled || key === '') return;

    const monthKey = karachiMonthKey();
    const people = key.split(',');

    const record = (uid: string, activity: LeadActivity) =>
      setState((current) =>
        // A late callback from a torn-down set must not revive it.
        current.key !== key
          ? current
          : { ...current, rows: { ...current.rows, [uid]: activity }, settled: current.settled + 1 }
      );

    const stops = people.map((uid) =>
      onSnapshot(
        doc(db, 'users', uid, 'kpiMonths', monthKey),
        (snap) => record(uid, readLeadActivity(snap.data() as Record<string, unknown> | undefined)),
        () =>
          // A month nobody has worked yet is a missing document, and a refused
          // read is a rule problem the lane cannot fix. Either way the person
          // scores zero rather than dropping off the ranking entirely.
          record(uid, EMPTY_LEAD_ACTIVITY)
      )
    );

    return () => stops.forEach((stop) => stop());
  }, [key, enabled]);

  if (IS_DEMO) {
    const activity: Record<string, LeadActivity> = {};
    for (const employee of demoState.employees) {
      activity[employee.uid] = readLeadActivity(
        (employee as unknown as { laneActivity?: Record<string, unknown> }).laneActivity
      );
    }
    return { activity, loading: false };
  }

  return {
    activity: state.rows,
    // Every listener has reported at least once. A person with no document
    // counts as reported — that is the zero month, not a pending read.
    loading: enabled && state.settled < expected,
  };
}
