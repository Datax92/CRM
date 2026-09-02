import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError, type FirestoreTimestamp } from './useLeads';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';
import type { DistributionLine } from '@/lib/profitDistribution';

/**
 * Reading profit splits.
 *
 * Two collections, and which one a hook reads *is* the privacy model (§22):
 *
 * - `dealDistributions` holds the whole split — every recipient, every
 *   percentage. Admin-only, because Firestore grants a document or none of it
 *   and a sub admin must never see another sub admin's cut.
 * - `dealPayouts` holds one row per person, carrying only that person's own
 *   number. An employee reads their own; a sub admin reads their own and their
 *   team's; the company's share is never written here at all.
 *
 * Every query below mirrors a clause of its Security Rule rather than filtering
 * afterwards, because Firestore rejects a list query it cannot prove safe
 * before running it.
 */

export interface DealDistribution {
  id: string;
  dealId: string;
  leadId: string;
  employeeUid: string | null;
  subAdminUid: string | null;
  customerName: string | null;
  amountReceived: number;
  payableAmount: number;
  netProfit: number;
  lines: DistributionLine[];
  distributedPercentage: number;
  distributedAmount: number;
  remainingPercentage: number;
  remainingAmount: number;
  companyBaseAmount: number;
  companyTotalAmount: number;
  finalizedByUid: string;
  finalizedAt?: FirestoreTimestamp;
  current: boolean;
  supersededAt?: FirestoreTimestamp | null;
}

export interface DealPayout {
  id: string;
  dealId: string;
  leadId: string;
  distributionId: string;
  recipientUid: string;
  recipientName: string;
  recipientRole: 'employee' | 'subadmin';
  kind: string;
  subAdminUid: string | null;
  percentage: number;
  amount: number;
  netProfit: number;
  customerName: string | null;
  dealDate?: FirestoreTimestamp;
  finalizedAt?: FirestoreTimestamp;
  current: boolean;
}

const PAGE = 200;

/**
 * The split currently in force for one deal, for the admin's screen.
 *
 * Reopening a deal supersedes rather than deletes, so `current == true` is what
 * separates the live split from the record of what was approved before it.
 */
export function useDealDistribution(dealId: string | null, enabled = true) {
  const [state, setState] = useState<{ key: string; distribution: DealDistribution | null } | null>(
    null
  );
  const demoState = useDemoState();
  const key = enabled && dealId ? dealId : 'idle';

  useEffect(() => {
    if (IS_DEMO || key === 'idle') return;

    const unsubscribe = onSnapshot(
      query(
        collection(db, 'dealDistributions'),
        where('current', '==', true),
        where('dealId', '==', dealId),
        limit(1)
      ),
      (snap) => {
        const doc = snap.docs[0];
        setState({
          key,
          distribution: doc ? ({ id: doc.id, ...doc.data() } as DealDistribution) : null,
        });
      },
      (err) => {
        console.error('[useDealDistribution]', err);
        setState({ key, distribution: null });
      }
    );

    return () => unsubscribe();
  }, [key, dealId]);

  if (IS_DEMO) {
    const distribution =
      (demoState.distributions ?? []).find((d) => d.dealId === dealId && d.current) ?? null;
    return { distribution: (distribution as DealDistribution | null), loading: false };
  }

  const current = state?.key === key ? state : null;
  return { distribution: current?.distribution ?? null, loading: key !== 'idle' && current === null };
}

/**
 * Everything an admin has ever approved, newest first.
 *
 * Superseded records are included deliberately: §24 keeps the history, and a
 * history nobody can read is the same as no history.
 */
export function useAllDistributions(enabled = true) {
  const [state, setState] = useState<{ rows: DealDistribution[]; error: string | null } | null>(null);
  const demoState = useDemoState();

  useEffect(() => {
    if (IS_DEMO || !enabled) return;

    const unsubscribe = onSnapshot(
      query(collection(db, 'dealDistributions'), orderBy('finalizedAt', 'desc'), limit(PAGE)),
      (snap) => {
        setState({
          rows: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as DealDistribution[],
          error: null,
        });
      },
      (err) => {
        console.error('[useAllDistributions]', err);
        setState({ rows: [], error: describeFirestoreError(err) });
      }
    );

    return () => unsubscribe();
  }, [enabled]);

  if (IS_DEMO) {
    return {
      distributions: enabled ? ((demoState.distributions ?? []) as DealDistribution[]) : [],
      loading: false,
      error: null,
    };
  }

  return {
    distributions: enabled ? (state?.rows ?? []) : [],
    loading: enabled && state === null,
    error: enabled ? (state?.error ?? null) : null,
  };
}

/**
 * One person's earnings — their own, or their team's.
 *
 * `scope: 'team'` is for a sub admin, and reads `subAdminUid == uid`, which
 * returns their own payouts as well: `finalizeProfitDistribution` stamps a sub
 * admin's own row with their own uid precisely so one query answers both
 * halves of §22's sub admin clause.
 */
export function useMyPayouts(
  uid: string | undefined,
  scope: 'self' | 'team' = 'self',
  enabled = true
) {
  const [state, setState] = useState<{ key: string; rows: DealPayout[]; error: string | null } | null>(
    null
  );
  const demoState = useDemoState();
  const key = enabled && uid ? `${scope}:${uid}` : 'idle';

  useEffect(() => {
    if (IS_DEMO || key === 'idle') return;

    const field = scope === 'team' ? 'subAdminUid' : 'recipientUid';

    const unsubscribe = onSnapshot(
      query(
        collection(db, 'dealPayouts'),
        where('current', '==', true),
        where(field, '==', uid),
        orderBy('finalizedAt', 'desc'),
        limit(PAGE)
      ),
      (snap) => {
        setState({
          key,
          rows: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as DealPayout[],
          error: null,
        });
      },
      (err) => {
        console.error('[useMyPayouts]', err);
        setState({ key, rows: [], error: describeFirestoreError(err) });
      }
    );

    return () => unsubscribe();
  }, [key, uid, scope]);

  if (IS_DEMO) {
    const rows = ((demoState.payouts ?? []) as DealPayout[]).filter((payout) =>
      scope === 'team' ? payout.subAdminUid === uid : payout.recipientUid === uid
    );
    return { payouts: enabled ? rows : [], loading: false, error: null };
  }

  const current = state?.key === key ? state : null;
  return {
    payouts: current?.rows ?? [],
    loading: key !== 'idle' && current === null,
    error: current?.error ?? null,
  };
}
