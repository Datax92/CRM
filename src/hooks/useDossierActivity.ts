'use client';

/**
 * What the people in a dossier actually wrote, between the dossier's dates.
 *
 * One hook for both surfaces — the desktop `EmployeeDetailModal` and the
 * phone's — for the same reason `DossierFilterBar` is one component: two
 * copies would let the phone's idea of "Today" drift from the desktop's, and
 * the whole point of this data is that the two screens agree.
 *
 * **What it fixes.** The dossier's activity cuts used to be answered from the
 * lead's all-time counters (`followUpCount`, `connectCount`) with only the
 * lead's *last touch* filtered to the period. So "Connected · Today" returned
 * every lead touched today that had ever had an answered call — measured on
 * 2026-09-09, one employee's dossier read 7 connects on a day she made 3.
 * These tallies count entries on the day they were written instead, which is
 * what Reports has always done.
 *
 * The entries come from a Server Action: they live in a subcollection per
 * lead, so a range across a whole pipeline is a collection-group query, and
 * that is the one shape Security Rules cannot scope safely. See
 * `app/actions/activity.ts`.
 */

import { useCallback, useEffect, useState } from 'react';
import { buildActivityBreakdown } from '@/lib/clientActions';
import { EMPTY_TALLY, type EntryTally } from '@/lib/leadBuckets';
import type { ActivityItem } from '@/app/actions/activity';

export interface DossierActivity {
  /**
   * Per lead id. **`null` while loading or after a failure** — never an empty
   * map, because "no entries in this range" and "we could not find out" must
   * not look the same to the filter, which would show a confident zero for
   * both.
   */
  tallies: Map<string, EntryTally> | null;
  /** The four figures for the range, the same ones Reports shows. */
  totals: EntryTally;
  /** Activity entries written in this date range. */
  items?: ActivityItem[];
  loading: boolean;
  error: string | null;
  /** Set when the collection-group index is missing and the slow path ran. */
  warning: string | null;
}

export function useDossierActivity(
  /** Whose work: one employee, or a manager and their team. */
  uids: string[],
  range: { from: string; to: string },
  getIdToken: () => Promise<string>,
  enabled = true
): DossierActivity {
  const [state, setState] = useState<{
    key: string;
    tallies: Map<string, EntryTally> | null;
    totals: EntryTally;
    items: ActivityItem[];
    error: string | null;
    warning: string | null;
  } | null>(null);

  // The uid list is rebuilt on every render by its caller, so the subscription
  // is keyed by its *contents* — depending on the array itself would refetch
  // on every keystroke anywhere in the modal.
  const key = enabled ? `${range.from}|${range.to}|${[...uids].sort().join(',')}` : 'idle';

  const run = useCallback(async () => {
    const [from, to, joined] = key.split('|');
    const token = await getIdToken().catch(() => '');
    if (!token) {
      return {
        key,
        tallies: null,
        totals: { ...EMPTY_TALLY },
        items: [],
        error: 'Your session has ended. Please sign in again.',
        warning: null,
      };
    }

    const result = await buildActivityBreakdown(token, joined.split(','), from, to);
    if (!result.ok) {
      return { key, tallies: null, totals: { ...EMPTY_TALLY }, items: [], error: result.error, warning: null };
    }

    return {
      key,
      tallies: new Map(Object.entries(result.data.byLead)),
      totals: result.data.totals,
      items: (result.data.items as ActivityItem[] | undefined) ?? [],
      error: null,
      warning: result.data.warning ?? null,
    };
  }, [key, getIdToken]);

  useEffect(() => {
    if (key === 'idle') return;
    // The first statement is an await, so nothing sets state synchronously
    // inside the effect — the lint rule this project runs rejects that.
    let cancelled = false;
    void (async () => {
      const next = await run();
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, run]);

  const current = state?.key === key ? state : null;

  return {
    tallies: current?.tallies ?? null,
    totals: current?.totals ?? { ...EMPTY_TALLY },
    items: current?.items ?? [],
    loading: key !== 'idle' && current === null,
    error: current?.error ?? null,
    warning: current?.warning ?? null,
  };
}
