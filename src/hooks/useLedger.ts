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

import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, limit, where, onSnapshot } from 'firebase/firestore';
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

export function useLedger(enabled = true) {
  const [accounts, setAccounts] = useState<AccountDoc[] | null>(null);
  const [transactions, setTransactions] = useState<TransactionDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const unsubAccounts = onSnapshot(
      query(collection(db, 'accounts'), orderBy('name')),
      (snap) => setAccounts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AccountDoc)),
      (err) => {
        console.error('[useLedger:accounts]', err);
        setAccounts([]);
        setError(describeFirestoreError(err));
      }
    );
    const unsubTxns = onSnapshot(
      query(collection(db, 'transactions'), orderBy('dayKey', 'desc'), limit(TRANSACTION_PAGE)),
      (snap) => setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TransactionDoc)),
      (err) => {
        console.error('[useLedger:transactions]', err);
        setTransactions([]);
        setError(describeFirestoreError(err));
      }
    );
    return () => {
      unsubAccounts();
      unsubTxns();
    };
  }, [enabled]);

  const rows = useMemo(() => transactions ?? [], [transactions]);
  const list = useMemo(() => accounts ?? [], [accounts]);

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
    loading: enabled && (accounts === null || transactions === null),
    error,
  };
}

/** One employee's own claims — the only financial list an employee may read. */
export function useMyPersonalExpenses(uid: string | undefined, enabled = true) {
  const [records, setRecords] = useState<Record<string, unknown>[] | null>(null);

  useEffect(() => {
    if (!enabled || !uid) return;
    // The clause the Security Rule checks. An unscoped query here is refused
    // outright rather than filtered — see the note in `firestore.rules`.
    const unsub = onSnapshot(
      query(collection(db, 'personalExpenses'), where('employeeUid', '==', uid)),
      (snap) => setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error('[useMyPersonalExpenses]', err);
        setRecords([]);
      }
    );
    return () => unsub();
  }, [uid, enabled]);

  return { records: records ?? [], loading: enabled && Boolean(uid) && records === null };
}

/** Every claim, for the approvers. */
export function usePersonalExpenses(enabled = true) {
  const [records, setRecords] = useState<Record<string, unknown>[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const unsub = onSnapshot(
      query(collection(db, 'personalExpenses'), orderBy('dayKey', 'desc'), limit(1000)),
      (snap) => setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error('[usePersonalExpenses]', err);
        setRecords([]);
      }
    );
    return () => unsub();
  }, [enabled]);
  return { records: records ?? [], loading: enabled && records === null };
}

/** A simple live collection read, for the two record-keeping modules. */
export function useFinanceCollection(name: string, enabled = true) {
  const [records, setRecords] = useState<Record<string, unknown>[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const unsub = onSnapshot(
      query(collection(db, name), orderBy('dayKey', 'desc'), limit(2000)),
      (snap) => setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error(`[useFinanceCollection:${name}]`, err);
        setRecords([]);
      }
    );
    return () => unsub();
  }, [name, enabled]);
  return { records: records ?? [], loading: enabled && records === null };
}
