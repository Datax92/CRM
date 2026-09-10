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

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { collection, query, orderBy, limit, where, type Query, type DocumentData } from 'firebase/firestore';
import { subscribeLive, liveState, SERVER_STATE } from '@/lib/liveCollection';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError, type FirestoreTimestamp } from './useLeads';
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

/**
 * One shared subscription per collection, joined rather than opened.
 *
 * Every screen in this section wants the same two lists, and each used to open
 * its own listener — so tabbing between Office Expenses, StateLife and Committee
 * paid for the whole transaction collection once per visit. `useLive` joins the
 * subscription that already exists, and `lib/liveCollection` keeps it alive for
 * a minute after the last screen closes, which makes moving around the section
 * free. See that module for why.
 */
function useLive(key: string, build: () => Query<DocumentData>, enabled: boolean) {
  /*
    **`build` must be stable** — every call site wraps it in `useCallback`.
    An unstable one would resubscribe on every render and undo the whole point
    of sharing, so it is a dependency here rather than something smuggled past
    the linter in a ref.
  */
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!enabled) return () => {};
      return subscribeLive(key, build, (error) => describeFirestoreError(error as { code?: string; message?: string }), notify);
    },
    [key, enabled, build]
  );

  const read = useCallback(() => (enabled ? liveState(key) : SERVER_STATE), [key, enabled]);
  return useSyncExternalStore(subscribe, read, () => SERVER_STATE);
}

export function useLedger(enabled = true) {
  const buildAccounts = useCallback(() => query(collection(db, 'accounts'), orderBy('name')), []);
  const buildTxns = useCallback(
    () => query(collection(db, 'transactions'), orderBy('dayKey', 'desc'), limit(TRANSACTION_PAGE)),
    []
  );

  const accountsLive = useLive('accounts', buildAccounts, enabled);
  const txnsLive = useLive('transactions', buildTxns, enabled);

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
  const live = useLive(`personalExpenses:${uid ?? ''}`, build, enabled && Boolean(uid));
  return { records: live.rows as Record<string, unknown>[], loading: enabled && Boolean(uid) && live.loading };
}

/** Every claim, for the approvers. */
export function usePersonalExpenses(enabled = true) {
  const build = useCallback(
    () => query(collection(db, 'personalExpenses'), orderBy('dayKey', 'desc'), limit(1000)),
    []
  );
  const live = useLive('personalExpenses:all', build, enabled);
  return { records: live.rows as Record<string, unknown>[], loading: enabled && live.loading };
}

/** A simple live collection read, for the two record-keeping modules. */
export function useFinanceCollection(name: string, enabled = true) {
  const build = useCallback(
    () => query(collection(db, name), orderBy('dayKey', 'desc'), limit(2000)),
    [name]
  );
  const live = useLive(`finance:${name}`, build, enabled);
  return { records: live.rows as Record<string, unknown>[], loading: enabled && live.loading };
}
