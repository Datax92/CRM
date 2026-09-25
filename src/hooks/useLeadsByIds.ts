'use client';

/**
 * Specific leads, by document id — whatever the pipeline window holds.
 *
 * **Why a Client folder needs this.** A folder's contents are its membership
 * rows narrowed to the leads still assigned to its owner, and that narrowing
 * asks `useLeads` who holds each lead. `useLeads` is a *window* over the newest
 * leads, so a member older than the window is not absent from the folder because
 * it was reassigned — it is absent because nobody loaded it. On 2026-09-23 that
 * showed 14 clients in a folder holding 34.
 *
 * The window now sizes itself (`lib/leadWindow`), so below its ceiling this hook
 * has nothing to do and opens no listener at all. Above the ceiling it is what
 * keeps a folder honest: the leads it is missing are fetched by the ids it
 * already knows, so the folder no longer depends on the pipeline's size.
 *
 * **Bounded on purpose.** One folder's membership is capped at 300 rows, which
 * is ten `in` queries at worst and normally none. It is deliberately not used
 * for the *whole* Clients section at once — that is unbounded, and above the
 * ceiling the honest answer there is server-side paging, which is what
 * `truncated` and `LeadWindowNotice` ask for.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, documentId, query, where } from 'firebase/firestore';
// Metered: counts the reads Google bills, into the server log only.
import { onSnapshot } from '@/lib/firebase/meteredFirestore';
import { db } from '@/lib/firebase/client';
import { IS_DEMO } from '@/lib/demo/store';
import { idBatches, missingFromWindow } from '@/lib/leadWindow';
import type { Lead } from './useLeads';

/**
 * The leads among `ids` that `loaded` does not already account for.
 *
 * `scope` mirrors `useLeads`: a Sales manager's query carries their own uid,
 * because the `leads` rule is `subAdminUid == me` and Firestore refuses a list
 * query that cannot prove its clause. An admin and an HR manager read the whole
 * pipeline by rule, so theirs carries the id filter alone.
 */
export function useLeadsByIds(
  ids: readonly string[],
  loaded: (leadId: string) => boolean,
  enabled: boolean,
  scope: { role?: string | null; uid?: string; managerKind?: string | null }
) {
  const [state, setState] = useState<{ key: string; leads: Lead[] }>({ key: '', leads: [] });

  const teamOf = scope.role === 'subadmin' && scope.managerKind !== 'HR' ? (scope.uid ?? '') : '';
  const waiting = scope.role === 'subadmin' && scope.managerKind !== 'HR' && !teamOf;

  // Only what is actually missing, so the common case costs nothing. Joined into
  // the key as well, so a folder whose window coverage has not changed does not
  // resubscribe when its membership list is re-created by a render.
  const missing = useMemo(
    () => (enabled && !IS_DEMO && !waiting ? missingFromWindow(ids, loaded) : []),
    // `loaded` is rebuilt whenever the window changes, which is exactly when
    // this must be recomputed.
    [enabled, waiting, ids, loaded]
  );
  const key = missing.length ? `${teamOf}|${missing.join(',')}` : '';

  const clausesFor = useCallback(
    (batch: string[]) =>
      teamOf
        ? [where('subAdminUid', '==', teamOf), where(documentId(), 'in', batch)]
        : [where(documentId(), 'in', batch)],
    [teamOf]
  );

  useEffect(() => {
    if (!key) return;

    const byBatch = new Map<number, Lead[]>();
    const publish = () =>
      setState({ key, leads: Array.from(byBatch.values()).flat() });

    const stops = idBatches(missing).map((batch, index) =>
      onSnapshot(
        query(collection(db, 'leads'), ...clausesFor(batch)),
        (snap) => {
          byBatch.set(index, snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Lead[]);
          publish();
        },
        (error) => {
          // Non-fatal by design: without these the folder shows what the window
          // holds, which is what it did before this hook existed. Breaking the
          // screen to report a missing index would be worse than being short.
          console.warn('[useLeadsByIds] batch refused', error);
          byBatch.set(index, []);
          publish();
        }
      )
    );

    return () => stops.forEach((stop) => stop());
    // `missing` and `teamOf` are both encoded in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Results from a previous id set must never be shown against a new one.
  return state.key === key ? state.leads : [];
}
