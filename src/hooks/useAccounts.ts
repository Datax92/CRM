import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError, type FirestoreTimestamp } from './useLeads';
import { withinRange, type DateRange } from '@/lib/dates';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';

export interface AccountRecord {
  id: string;
  title: string;
  amount: number;
  description?: string | null;
  addedByUid: string;
  addedByEmail?: string | null;
  date?: FirestoreTimestamp;
}

function useGenericAccountCollection(collectionName: string, range: DateRange, enabled = true) {
  const [records, setRecords] = useState<AccountRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const demoState = useDemoState();

  useEffect(() => {
    if (IS_DEMO || !enabled) {
      return;
    }

    const unsub = onSnapshot(
      query(collection(db, collectionName), orderBy('date', 'desc'), limit(1000)),
      (snap) => {
        setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AccountRecord[]);
      },
      (err) => {
        console.error(`[useGenericAccountCollection:${collectionName}]`, err);
        setRecords([]);
        setError(describeFirestoreError(err));
      }
    );

    return () => unsub();
  }, [collectionName, enabled]);

  const allRecords = useMemo(() => {
    if (!enabled) return [];
    if (IS_DEMO) {
      if (collectionName === "committee") return demoState.committee;
      if (collectionName === "investments") return demoState.investments;
      if (collectionName === "capitalInvestments") return demoState.capitalInvestments;
      if (collectionName === "personalExpenses") return demoState.personalExpenses;
      return [];
    }
    return records ?? [];
  }, [enabled, records, demoState.committee, demoState.investments, demoState.capitalInvestments, demoState.personalExpenses, collectionName]);

  const recordsInRange = useMemo(
    () => allRecords.filter((rec) => withinRange(rec.date, range)),
    [allRecords, range]
  );

  return {
    records: recordsInRange,
    allRecords,
    loading: IS_DEMO ? false : enabled && records === null,
    error: IS_DEMO ? null : enabled ? error : null,
  };
}

export function useCommitteeRecords(range: DateRange, enabled = true) {
  return useGenericAccountCollection("committee", range, enabled);
}

export function useInvestments(range: DateRange, enabled = true) {
  return useGenericAccountCollection("investments", range, enabled);
}

export function useCapitalInvestments(range: DateRange, enabled = true) {
  return useGenericAccountCollection("capitalInvestments", range, enabled);
}

export function usePersonalExpenses(range: DateRange, enabled = true) {
  return useGenericAccountCollection("personalExpenses", range, enabled);
}
