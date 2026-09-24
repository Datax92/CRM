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
  /** Minutes worked in the range, from attendance. 0 while loading. */
  workedMinutes: number;
  /** Activity entries written in this date range. */
  items?: ActivityItem[];
  loading: boolean;
  error: string | null;
  /** Set when the collection-group index is missing and the slow path ran. */
  warning: string | null;
}

/**
 * **Answers remembered for five minutes, per range and set of people** (owner,
 * 2026-09-24: "we are already deficient in reads"). Opening the same person
 * twice, flicking between tabs, or going back and forth between two people
 * costs nothing the second time. Module memory, so it lasts for the tab and
 * is gone on reload — which is also how somebody forces a fresh answer.
 */
const CACHE_MS = 5 * 60_000;
type Answer = {
  key: string;
  tallies: Map<string, EntryTally> | null;
  totals: EntryTally;
  workedMinutes: number;
  items: ActivityItem[];
  error: string | null;
  warning: string | null;
};
const remembered = new Map<string, { at: number; answer: Answer }>();

export function useDossierActivity(
  /** Whose work: one employee, or a manager and their team. */
  uids: string[],
  range: { from: string; to: string },
  getIdToken: () => Promise<string>,
  enabled = true
): DossierActivity {
  const [state, setState] = useState<Answer | null>(null);

  // The uid list is rebuilt on every render by its caller, so the subscription
  // is keyed by its *contents* — depending on the array itself would refetch
  // on every keystroke anywhere in the modal.
  const key = enabled ? `${range.from}|${range.to}|${[...uids].sort().join(',')}` : 'idle';

  const run = useCallback(async (): Promise<Answer> => {
    const hit = remembered.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.answer;
    const [from, to, joined] = key.split('|');
    const token = await getIdToken().catch(() => '');
    if (!token) {
      return {
        key,
        tallies: null,
        totals: { ...EMPTY_TALLY },
        workedMinutes: 0,
        items: [],
        error: 'Your session has ended. Please sign in again.',
        warning: null,
      };
    }

    const result = await buildActivityBreakdown(token, joined.split(','), from, to);
    if (!result.ok) {
      return { key, tallies: null, totals: { ...EMPTY_TALLY }, workedMinutes: 0, items: [], error: result.error, warning: null };
    }

    const answer: Answer = {
      key,
      tallies: new Map(Object.entries(result.data.byLead)),
      totals: { ...EMPTY_TALLY, ...result.data.totals },
      workedMinutes: result.data.workedMinutes ?? 0,
      items: (result.data.items as ActivityItem[] | undefined) ?? [],
      error: null,
      warning: result.data.warning ?? null,
    };
    // Only a real answer is remembered — never an error, which should retry.
    remembered.set(key, { at: Date.now(), answer });
    return answer;
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
    workedMinutes: current?.workedMinutes ?? 0,
    items: current?.items ?? [],
    loading: key !== 'idle' && current === null,
    error: current?.error ?? null,
    warning: current?.warning ?? null,
  };
}
