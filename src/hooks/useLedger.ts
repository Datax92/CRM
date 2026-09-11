'use client';

/**
 * Reading the ledger.
 *
 * Accounts and transactions are two live queries and everything on screen is
 * derived from them — balances, statements, dashboard totals, reports. There is
 * no second source: if a figure is wrong here it is wrong in the database, and
 * the fix is a transaction, not a patched-up display.
 *
 * Both are admin/HR-only reads and both clauses test the caller rather than the
 * document, so neither query has to carry a scope. See `firestore.rules`.
 */

import { useCallback, useMemo } from 'react';
import { collection, query, orderBy, limit, where } from 'firebase/firestore';
import { useLive } from './useLive';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError, type FirestoreTimestamp } from './useLeads';

/** Stable across renders, so it never resubscribes anything. */
const describe = (error: unknown) => describeFirestoreError(error as { code?: string; message?: string });
import {
  balancesFor,
  summarize,
  type AccountKind,
  type LedgerTransaction,
} from '@/lib/ledger';

export interface AccountDoc {
  id: string;
  name: string;
  kind: AccountKind;
  openingBalance: number;
  note?: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  /** A cache the server refreshes. `balancesFor` is the answer — see below. */
  cachedBalance?: number;
  createdAt?: FirestoreTimestamp;
}

export interface TransactionDoc extends Omit<LedgerTransaction, 'id'> {
  id: string;
  createdByName?: string | null;
  createdAt?: FirestoreTimestamp;
  voidedByName?: string | null;
}

/** Guards against an unbounded read once the ledger has years in it. */
const TRANSACTION_PAGE = 2000;

export function useLedger(enabled = true) {
  const buildAccounts = useCallback(() => query(collection(db, 'accounts'), orderBy('name')), []);
  const buildTxns = useCallback(
    () => query(collection(db, 'transactions'), orderBy('dayKey', 'desc'), limit(TRANSACTION_PAGE)),
    []
  );

  const accountsLive = useLive('accounts', buildAccounts, enabled, describe);
  const txnsLive = useLive('transactions', buildTxns, enabled, describe);

  const list = useMemo(() => accountsLive.rows as unknown as AccountDoc[], [accountsLive.rows]);
  const rows = useMemo(() => txnsLive.rows as unknown as TransactionDoc[], [txnsLive.rows]);

  /**
   * **Balances are recomputed here, not read from `cachedBalance`.**
   *
   * The cache exists so a list of accounts does not have to wait on the whole
   * transaction history; but once the transactions are in hand, deriving is
   * both free and the only answer that cannot drift. If the two ever disagree,
   * this one is right.
   */
  const balances = useMemo(() => balancesFor(list, rows as LedgerTransaction[]), [list, rows]);
  const summary = useMemo(() => summarize(rows as LedgerTransaction[]), [rows]);

  return {
    accounts: list,
    transactions: rows,
    balances: balances.byAccount,
    totalBalance: balances.total,
    summary,
    loading: enabled && (accountsLive.loading || txnsLive.loading),
    error: accountsLive.error ?? txnsLive.error,
  };
}

/** One employee's own claims — the only financial list an employee may read. */
export function useMyPersonalExpenses(uid: string | undefined, enabled = true) {
  // Keyed by the uid, or two people on one device would share one list. The
  // clause is the one the Security Rule checks: an unscoped query here is
  // refused outright rather than filtered — see the note in `firestore.rules`.
  const build = useCallback(
    () => query(collection(db, 'personalExpenses'), where('employeeUid', '==', uid)),
    [uid]
  );
  const live = useLive(`personalExpenses:${uid ?? ''}`, build, enabled && Boolean(uid), describe);
  return { records: live.rows as Record<string, unknown>[], loading: enabled && Boolean(uid) && live.loading };
}

/** Every claim, for the approvers. */
export function usePersonalExpenses(enabled = true) {
  const build = useCallback(
    () => query(collection(db, 'personalExpenses'), orderBy('dayKey', 'desc'), limit(1000)),
    []
  );
  const live = useLive('personalExpenses:all', build, enabled, describe);
  return { records: live.rows as Record<string, unknown>[], loading: enabled && live.loading };
}

/** A simple live collection read, for the two record-keeping modules. */
export function useFinanceCollection(name: string, enabled = true) {
  const build = useCallback(
    () => query(collection(db, name), orderBy('dayKey', 'desc'), limit(2000)),
    [name]
  );
  const live = useLive(`finance:${name}`, build, enabled, describe);
  return { records: live.rows as Record<string, unknown>[], loading: enabled && live.loading };
}
