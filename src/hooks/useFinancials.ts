import { useState, useEffect, useMemo } from 'react';
import { collection, doc, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError, type FirestoreTimestamp } from './useLeads';
import { withinRange, type DateRange } from '@/lib/dates';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';

export interface ExpenseRecord {
  id: string;
  title: string;
  category: string;
  amount: number;
  description?: string | null;
  addedByUid: string;
  addedByEmail?: string | null;
  date?: FirestoreTimestamp;
}

export interface DealCustomer {
  name: string;
  phone: string;
  email?: string | null;
  cnic?: string | null;
  address?: string | null;
  city?: string | null;
}

export interface DealRecord {
  id: string;
  leadId: string;
  /** The employee credited with the sale. */
  userId: string;
  /** Whoever filled in the entry form — may be an admin acting for them. */
  enteredByUid?: string;
  customer?: DealCustomer;
  serviceDescription?: string;
  paymentMethod?: string;
  /** Rental / Installment / Investment. Absent on deals predating the field. */
  dealCategory?: string;
  notes?: string | null;
  amountReceived: number;
  payableAmount: number;
  profit: number;
  campaignId?: string | null;
  campaignName?: string | null;
  /** Where the lead originally came from, denormalised — see `lib/leadSource`. */
  source?: string | null;
  dataBankFolderId?: string | null;
  dataBankFolderName?: string | null;
  /** Whose team earned it. Absent means the admin managed the employee directly. */
  subAdminUid?: string | null;
  /**
   * Whether the admin has split the profit yet (§12). Absent on deals closed
   * before the distribution step existed — those are treated as PENDING so
   * they surface for review rather than silently looking finished.
   */
  distributionStatus?: 'PENDING' | 'FINALIZED';
  distributionId?: string | null;
  distributionFinalizedAt?: FirestoreTimestamp;
  dealDate?: FirestoreTimestamp;
  enteredAt?: FirestoreTimestamp;
}

export interface AppNotification {
  id: string;
  type: string;
  leadId: string;
  targetRole?: string;
  targetUid?: string;
  payload?: { message?: string; [key: string]: unknown };
  createdAt?: FirestoreTimestamp;
  readAt?: FirestoreTimestamp | null;
}

export interface FinancialTotals {
  /** Σ amount received — the actual money in (FR-28). */
  totalRevenue: number;
  /** Σ payable — what has to go back out. */
  totalPayable: number;
  /** Revenue − payable (BR-19). */
  grossProfit: number;
  totalExpenses: number;
  /** Gross profit − expenses (FR-28). */
  netProfit: number;
  dealCount: number;
  expenseCount: number;
}

/**
 * Financial rollups for the admin dashboard (FR-28).
 *
 * Totals are derived from the loaded documents rather than accumulated inside
 * the snapshot callbacks. The previous version shared mutable running sums
 * between two listeners, so whichever fired second computed net profit against
 * whatever the other had left behind — a race that produced a different figure
 * depending on which query resolved first.
 */
export function useFinancials(range: DateRange, enabled = true) {
  const [deals, setDeals] = useState<DealRecord[] | null>(null);
  const [expenses, setExpenses] = useState<ExpenseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const demoState = useDemoState();

  useEffect(() => {
    if (IS_DEMO || !enabled) return;

    const unsubDeals = onSnapshot(
      query(collection(db, 'closedDeals'), orderBy('enteredAt', 'desc'), limit(1000)),
      (snap) => {
        setDeals(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as DealRecord[]);
      },
      (err) => {
        console.error('[useFinancials:deals]', err);
        setDeals([]);
        setError(describeFirestoreError(err));
      }
    );

    const unsubExpenses = onSnapshot(
      query(collection(db, 'expenses'), orderBy('date', 'desc'), limit(1000)),
      (snap) => {
        setExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ExpenseRecord[]);
      },
      (err) => {
        console.error('[useFinancials:expenses]', err);
        setExpenses([]);
        setError(describeFirestoreError(err));
      }
    );

    return () => {
      unsubDeals();
      unsubExpenses();
    };
  }, [enabled]);

  const allDeals = useMemo(
    () => (!enabled ? [] : IS_DEMO ? demoState.deals : (deals ?? [])),
    [enabled, deals, demoState.deals]
  );
  const allExpenses = useMemo(
    () => (!enabled ? [] : IS_DEMO ? demoState.expenses : (expenses ?? [])),
    [enabled, expenses, demoState.expenses]
  );

  // Filtering happens here rather than in the query so that changing the range
  // is instant and does not re-subscribe.
  const dealsInRange = useMemo(
    () => allDeals.filter((deal) => withinRange(deal.dealDate ?? deal.enteredAt, range)),
    [allDeals, range]
  );

  const expensesInRange = useMemo(
    () => allExpenses.filter((expense) => withinRange(expense.date, range)),
    [allExpenses, range]
  );

  const totals = useMemo<FinancialTotals>(() => {
    const totalRevenue = sum(dealsInRange, (d) => d.amountReceived);
    const totalPayable = sum(dealsInRange, (d) => d.payableAmount);
    const totalExpenses = sum(expensesInRange, (e) => e.amount);
    const grossProfit = totalRevenue - totalPayable;

    return {
      totalRevenue,
      totalPayable,
      grossProfit,
      totalExpenses,
      netProfit: grossProfit - totalExpenses,
      dealCount: dealsInRange.length,
      expenseCount: expensesInRange.length,
    };
  }, [dealsInRange, expensesInRange]);

  return {
    deals: dealsInRange,
    expenses: expensesInRange,
    allDeals,
    totals,
    loading: IS_DEMO ? false : enabled && (deals === null || expenses === null),
    error: IS_DEMO ? null : enabled ? error : null,
  };
}

/**
 * The deal entry for one lead, if it has been closed.
 * The deal document id is the lead id, so this is a direct lookup.
 */
export function useDealForLead(leadId: string | null) {
  const [state, setState] = useState<{ key: string; deal: DealRecord | null } | null>(null);
  const demoState = useDemoState();
  const key = leadId ?? 'idle';

  useEffect(() => {
    if (IS_DEMO || !leadId) return;

    const unsubscribe = onSnapshot(
      doc(db, 'closedDeals', leadId),
      (snap) => {
        setState({ key: leadId, deal: snap.exists() ? ({ id: snap.id, ...snap.data() } as DealRecord) : null });
      },
      (err) => {
        console.error('[useDealForLead]', err);
        setState({ key: leadId, deal: null });
      }
    );

    return () => unsubscribe();
  }, [leadId]);

  if (IS_DEMO) {
    return {
      deal: leadId ? (demoState.deals.find((d) => d.leadId === leadId) ?? null) : null,
      loading: false,
    };
  }

  const current = state?.key === key ? state : null;
  return { deal: current?.deal ?? null, loading: Boolean(leadId) && current === null };
}

/** An employee's own closed deals — Security Rules scope this to them. */
export function useMyDeals(uid: string | undefined, range: DateRange) {
  const [state, setState] = useState<{ key: string; deals: DealRecord[] } | null>(null);
  const demoState = useDemoState();
  const key = uid ?? 'idle';

  useEffect(() => {
    if (IS_DEMO || !uid) return;

    const unsubscribe = onSnapshot(
      query(
        collection(db, 'closedDeals'),
        where('userId', '==', uid),
        orderBy('enteredAt', 'desc'),
        limit(500)
      ),
      (snap) => {
        setState({ key: uid, deals: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as DealRecord[] });
      },
      (err) => {
        console.error('[useMyDeals]', err);
        setState({ key: uid, deals: [] });
      }
    );

    return () => unsubscribe();
  }, [uid]);

  const current = state?.key === key ? state : null;
  const allDeals = useMemo(
    () => (IS_DEMO ? demoState.deals.filter((d) => d.userId === uid) : (current?.deals ?? [])),
    [current, demoState.deals, uid]
  );

  const dealsInRange = useMemo(
    () => allDeals.filter((deal) => withinRange(deal.dealDate ?? deal.enteredAt, range)),
    [allDeals, range]
  );

  const totals = useMemo(
    () => ({
      revenue: sum(dealsInRange, (d) => d.amountReceived),
      profit: sum(dealsInRange, (d) => d.profit),
      count: dealsInRange.length,
    }),
    [dealsInRange]
  );

  return { deals: dealsInRange, totals, loading: IS_DEMO ? false : Boolean(uid) && current === null };
}

/**
 * Unread alerts for whoever is signed in — admin red flags and stale-lead
 * warnings (FR-19), an employee's own assignment and accept-window alerts
 * (BR-7 / BR-9).
 *
 * **The query is scoped to the reader, not filtered afterwards.** An earlier
 * version read the whole unread collection and narrowed it in JavaScript, to
 * avoid adding composite indexes. That cannot work: Firestore evaluates a list
 * query against the Security Rules *before* running it, and rejects the whole
 * query unless the constraints prove every document it could return is
 * readable. With no `targetUid` / `targetRole` constraint there is no such
 * proof, so an employee's bell threw `Missing or insufficient permissions` and
 * silently showed nothing. (An admin was unaffected — their rule passes for
 * every document, so the unconstrained query was provable for them, which is
 * why this only ever broke on one side.)
 *
 * Scoping the query also closes a leak the client-side filter had: matching on
 * `targetRole === 'employee'` meant every employee saw every *other*
 * employee's alerts. Employee notifications always carry `targetUid`, so
 * filtering on that alone loses nothing and shows each person only their own.
 *
 * **The composite indexes this needs list the equality fields alphabetically,
 * not in the order they are written below** — `readAt, targetRole, createdAt`
 * and `readAt, targetUid, createdAt` in `firestore.indexes.json`. Firestore
 * normalises equality filters that way when it matches a query to an index, so
 * an index declared in the query's own order is simply never used and the
 * query still fails with "requires an index". Range and `orderBy` fields keep
 * their position at the end.
 */
export function useNotifications(uid: string | undefined, role: string | undefined, enabled = true) {
  const [notifications, setNotifications] = useState<AppNotification[] | null>(null);
  const demoState = useDemoState();

  // The subscription depends on who is reading, so it is keyed on that rather
  // than on `enabled` alone — the old dependency list never re-subscribed when
  // the uid or role arrived after auth resolved.
  const isAdmin = role === 'admin';
  const scopeKey = !enabled || !role || (!isAdmin && !uid) ? 'idle' : isAdmin ? 'admin' : `employee:${uid}`;

  useEffect(() => {
    if (IS_DEMO || scopeKey === 'idle') return;

    const unsubscribe = onSnapshot(
      query(
        collection(db, 'notifications'),
        // Admins read the alerts addressed to the role; an employee reads the
        // ones addressed to them by uid. Both mirror a clause in the rule, so
        // both are provable.
        scopeKey === 'admin' ? where('targetRole', '==', 'admin') : where('targetUid', '==', uid),
        where('readAt', '==', null),
        orderBy('createdAt', 'desc'),
        limit(100)
      ),
      (snap) => {
        setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AppNotification[]);
      },
      (err) => {
        console.error('[useNotifications]', err);
        setNotifications([]);
      }
    );

    return () => unsubscribe();
    // `uid` and `role` are both encoded in `scopeKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  if (IS_DEMO) {
    // Scoped exactly as the live query is — admin by role, employee by uid.
    // An `|| targetRole === role` here would show one employee another's
    // alerts, which is the leak the live rule now forbids; the demo must not
    // demonstrate behaviour the product does not have.
    return {
      notifications:
        enabled && role
          ? demoState.notifications.filter((n) =>
              isAdmin ? n.targetRole === 'admin' : n.targetUid === uid
            )
          : [],
      loading: false,
    };
  }

  return {
    notifications: enabled ? (notifications ?? []) : [],
    loading: enabled && notifications === null,
  };
}

function sum<T>(items: T[], pick: (item: T) => number | undefined): number {
  return items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
}
