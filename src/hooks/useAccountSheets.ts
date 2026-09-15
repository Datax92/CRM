'use client';

/**
 * Live reads for the owner's sheets: Investment with X, Mahziyar Group and
 * Receivables / Payables.
 *
 * Every one is an admin/HR read whose rule tests the caller rather than the
 * document (`firestore.rules`), so no query carries a scope. They go through
 * `useLive`, so two screens asking the same question share one listener.
 *
 * Config documents are read as one-document collections rather than `getDoc`,
 * so they are live too: renaming a column on one screen renames it on the
 * other without a reload.
 */

import { useCallback, useMemo } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useLive } from './useLive';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError } from './useLeads';
import { readShareColumns, normalizeNetBasis, type NetBasis, type ShareColumn } from '@/lib/investmentWithX';
import { readGroupConfig, readGroupMonth, type GroupMonthDoc } from '@/lib/groupFinance';
import {
  DEFAULT_PAYABLE_GROUPS,
  DEFAULT_RECEIVABLE_GROUPS,
  normalizeGroups,
  readSheetEntry,
  type SheetEntry,
} from '@/lib/receivableSheet';

const describe = (error: unknown) => describeFirestoreError(error as { code?: string; message?: string });

type Row = Record<string, unknown> & { id: string };

/* -------------------------------------------------------------------------- */

export interface InvestmentBook {
  id: string;
  name: string;
  partner: string | null;
  columns: ShareColumn[];
  netBasis: NetBasis;
  description: string | null;
  accountId: string;
}

export function useInvestmentBooks(enabled: boolean) {
  const build = useCallback(() => query(collection(db, 'investmentBooks'), orderBy('name')), []);
  const live = useLive('investmentBooks', build, enabled, describe);
  const books = useMemo<InvestmentBook[]>(
    () =>
      (live.rows as Row[]).map((raw) => ({
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name : 'Investment',
        partner: typeof raw.partner === 'string' && raw.partner ? raw.partner : null,
        columns: readShareColumns(raw.columns),
        netBasis: normalizeNetBasis(raw.netBasis),
        description: typeof raw.description === 'string' && raw.description ? raw.description : null,
        accountId: typeof raw.accountId === 'string' ? raw.accountId : `invx_${raw.id}`,
      })),
    [live.rows]
  );
  return { books, loading: enabled && live.loading, error: live.error };
}

export function useInvestmentRounds(enabled: boolean) {
  const build = useCallback(
    () => query(collection(db, 'investmentRounds'), orderBy('dayKey', 'desc'), limit(2000)),
    []
  );
  const live = useLive('investmentRounds', build, enabled, describe);
  return { rounds: live.rows as Row[], loading: enabled && live.loading, error: live.error };
}

/* -------------------------------------------------------------------------- */

export function useGroupConfig(enabled: boolean) {
  const build = useCallback(() => query(collection(db, 'groupFinanceConfig'), limit(5)), []);
  const live = useLive('groupFinanceConfig', build, enabled, describe);
  const config = useMemo(
    () => readGroupConfig((live.rows as Row[]).find((row) => row.id === 'main') ?? null),
    [live.rows]
  );
  return { ...config, loading: enabled && live.loading, error: live.error };
}

/** Every month document in a year, by month key. */
export function useGroupMonths(year: number, enabled: boolean) {
  const build = useCallback(
    () =>
      query(
        collection(db, 'groupMonths'),
        where('monthKey', '>=', `${year}-01`),
        where('monthKey', '<=', `${year}-12`)
      ),
    [year]
  );
  const live = useLive(`groupMonths:${year}`, build, enabled, describe);
  const months = useMemo(() => {
    const map = new Map<string, GroupMonthDoc & { history: Array<Record<string, unknown>> }>();
    for (const row of live.rows as Row[]) {
      map.set(row.id, {
        ...readGroupMonth(row),
        history: Array.isArray(row.history) ? (row.history as Array<Record<string, unknown>>) : [],
      });
    }
    return map;
  }, [live.rows]);
  return { months, loading: enabled && live.loading, error: live.error };
}

/* -------------------------------------------------------------------------- */

export function useSheetEntries(enabled: boolean) {
  const build = useCallback(
    () => query(collection(db, 'receivableEntries'), orderBy('dayKey', 'desc'), limit(2000)),
    []
  );
  const live = useLive('receivableEntries', build, enabled, describe);
  const entries = useMemo<Array<SheetEntry & { history: Array<Record<string, unknown>> }>>(
    () =>
      (live.rows as Row[]).map((raw) => ({
        ...readSheetEntry(raw),
        history: Array.isArray(raw.history) ? (raw.history as Array<Record<string, unknown>>) : [],
      })),
    [live.rows]
  );
  return { entries, loading: enabled && live.loading, error: live.error };
}

export function useSheetGroups(enabled: boolean) {
  const build = useCallback(() => query(collection(db, 'receivableSheetConfig'), limit(5)), []);
  const live = useLive('receivableSheetConfig', build, enabled, describe);
  return useMemo(() => {
    const main = (live.rows as Row[]).find((row) => row.id === 'main');
    return {
      receivableGroups: normalizeGroups(
        Array.isArray(main?.receivableGroups) ? (main!.receivableGroups as unknown[]) : [],
        DEFAULT_RECEIVABLE_GROUPS
      ),
      payableGroups: normalizeGroups(
        Array.isArray(main?.payableGroups) ? (main!.payableGroups as unknown[]) : [],
        DEFAULT_PAYABLE_GROUPS
      ),
      loading: enabled && live.loading,
    };
  }, [live.rows, live.loading, enabled]);
}
