import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError, type FirestoreTimestamp } from './useLeads';
import { withinRange, type DateRange } from '@/lib/dates';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';

export interface ReceivableRecord {
  id: string;
  title: string;
  size: string;
  amount: number;
  addedByUid: string;
  addedByEmail?: string | null;
  date?: FirestoreTimestamp;
}

export function useReceivables(range: DateRange, enabled = true) {
  const [receivables, setReceivables] = useState<ReceivableRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const demoState = useDemoState();

  useEffect(() => {
    if (IS_DEMO || !enabled) {
      return;
    }

    const unsub = onSnapshot(
      query(collection(db, 'receivables'), orderBy('date', 'desc'), limit(1000)),
      (snap) => {
        setReceivables(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ReceivableRecord[]);
      },
      (err) => {
        console.error('[useReceivables]', err);
        setReceivables([]);
        setError(describeFirestoreError(err));
      }
    );

    return () => unsub();
  }, [enabled]);

  const allReceivables = useMemo(
    () => (!enabled ? [] : IS_DEMO ? demoState.receivables : (receivables ?? [])),
    [enabled, receivables, demoState.receivables]
  );

  const receivablesInRange = useMemo(
    () => allReceivables.filter((rec) => withinRange(rec.date, range)),
    [allReceivables, range]
  );

  return {
    receivables: receivablesInRange,
    allReceivables,
    loading: IS_DEMO ? false : enabled && receivables === null,
    error: IS_DEMO ? null : enabled ? error : null,
  };
}
