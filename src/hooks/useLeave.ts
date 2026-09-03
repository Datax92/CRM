import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError, type FirestoreTimestamp } from './useLeads';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';
import type { LeaveStatus, LeaveType } from '@/lib/attendancePolicy';

/**
 * Leave requests, live (§6, §7).
 *
 * Three scopes, each mirroring a clause of the Security Rule rather than
 * filtering afterwards — Firestore rejects a list query it cannot prove safe
 * before running it:
 *
 * | who | query |
 * |---|---|
 * | employee | `uid == me` |
 * | manager | `subAdminUid == me` — their team's |
 * | admin / HR | everything, newest first |
 *
 * An **HR** manager needs company-wide reach that a rule cannot express (it
 * would have to read the manager's own profile to learn the kind), so the HR
 * screens pass `scope: 'all'` and rely on the admin clause. A Sales manager
 * passing that would simply be refused by Firestore, which is the correct
 * outcome rather than a silent widening.
 */

export interface LeaveRequestRecord {
  id: string;
  uid: string;
  employeeName?: string | null;
  subAdminUid?: string | null;
  type: LeaveType;
  from: string;
  to: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  requestedByUid: string;
  requestedAt?: FirestoreTimestamp;
  decidedByUid?: string | null;
  decidedByName?: string | null;
  decidedAt?: FirestoreTimestamp | null;
  decisionNote?: string | null;
}

const PAGE = 300;

export function useLeaveRequests(
  scope: 'self' | 'team' | 'all',
  uid: string | undefined,
  enabled = true
) {
  const [state, setState] = useState<{
    key: string;
    requests: LeaveRequestRecord[];
    error: string | null;
  } | null>(null);
  const demoState = useDemoState();

  const key = !enabled || (scope !== 'all' && !uid) ? 'idle' : `${scope}:${uid ?? 'all'}`;

  useEffect(() => {
    if (IS_DEMO || key === 'idle') return;

    const base = collection(db, 'leaveRequests');
    const q =
      scope === 'all'
        ? query(base, orderBy('requestedAt', 'desc'), limit(PAGE))
        : scope === 'team'
          ? query(base, where('subAdminUid', '==', uid), orderBy('requestedAt', 'desc'), limit(PAGE))
          : query(base, where('uid', '==', uid), orderBy('from', 'desc'), limit(PAGE));

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setState({
          key,
          requests: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as LeaveRequestRecord[],
          error: null,
        });
      },
      (err) => {
        console.error('[useLeaveRequests]', err);
        setState({ key, requests: [], error: describeFirestoreError(err) });
      }
    );

    return () => unsubscribe();
  }, [key, scope, uid]);

  if (IS_DEMO) {
    const all = demoState.leaveRequests ?? [];
    const requests =
      scope === 'all'
        ? all
        : scope === 'team'
          ? all.filter((row) => row.subAdminUid === uid)
          : all.filter((row) => row.uid === uid);
    return { requests: enabled ? requests : [], loading: false, error: null };
  }

  const current = state?.key === key ? state : null;
  return {
    requests: current?.requests ?? [],
    loading: key !== 'idle' && current === null,
    error: current?.error ?? null,
  };
}
