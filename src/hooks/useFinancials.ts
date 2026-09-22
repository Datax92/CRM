import { useCallback, useState, useEffect, useMemo } from 'react';
import { collection, doc, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeLiveError, type FirestoreTimestamp } from './useLeads';
import { useLive } from './useLive';

/**
 * How many unread alerts the bell's panel holds.
 *
 * Twenty rather than a hundred: the panel shows the most recent few and the
 * badge says "20+" beyond that. Measured on 2026-09-11 there were 291 unread,
 * so the old cap pulled a hundred documents on **every screen** and displayed
 * a handful of them.
 *
 * **The admin's window is wider, because theirs is filtered after the read.**
 * Only five types reach their panel (`lib/adminAlerts`) and the rest are
 * discarded here, so a window of twenty could be twenty rows of red flags and
 * an empty bell. Sixty is still a third of what this used to pull, and it is
 * read once per screen, not per row.
 */
const NOTIFICATION_PAGE = 20;
const ADMIN_NOTIFICATION_PAGE = 60;
import { withinRange, type DateRange } from '@/lib/dates';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';
import { isAdminAlert } from '@/lib/adminAlerts';

export interface ExpenseRecord {
  id: string;
  title: string;
  category: string;
  amount: number;
  description?: string | null;
  addedByUid: string;
  addedByEmail?: string | null;
  date?: FirestoreTimestamp;
  /**
   * Everything below arrived with the Office Expenses module. All optional:
   * records written before it have none of them, and an absent `status` reads
   * as approved — see `lib/officeExpenses`.
   */
  dayKey?: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  paidBy?: string | null;
  paymentMethod?: string | null;
  receiptUrl?: string | null;
  receiptName?: string | null;
  updatedByUid?: string;
  decidedByUid?: string | null;
  decidedByName?: string | null;
  decisionNote?: string | null;
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
  /**
   * Which of the four types this deal is, and therefore which of the figures
   * below mean anything. Absent on every deal closed before the selector —
   * `readDealType` calls those Installments, which is the shape they are in.
   */
  dealType?: string;
  /**
   * The typed figures, all optional because which ones exist depends on the
   * type and on when the deal was entered. **Read them through
   * `lib/dealAmounts`**, whose accessors fall back correctly for older deals;
   * reading these directly is how a Lump Sum ends up displaying a Remaining it
   * does not have.
   */
  totalPrice?: number;
  downPayment?: number;
  confirmationAmount?: number;
  adjustment?: number;
  /** Null for a Lump Sum, which has no Remaining. */
  remaining?: number | null;
  receivedAmount?: number;
  commission?: number;
  /**
   * **The two Cut numbers, and they are different questions.** `cutBase` is
   * what the admin's percentage multiplies; `payoutSource` is the pot the
   * finalised Cut comes out of. Absent on older deals, where `readCutBase` and
   * `readPayoutSource` derive them from the same table.
   */
  cutBase?: number;
  payoutSource?: number;
  /**
   * The original two fields, still written as per-type mirrors so every revenue
   * rollup keeps working: `amountReceived − payableAmount` is what the company
   * books. For a Lump Sum they carry the **Commission**, because the client's
   * money goes to the builder. Nothing new should read them.
   */
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
export function useFinancials(
  range: DateRange,
  enabled = true,
  /**
   * Who is reading.
   *
   * **Omitting this reads the whole company**, which only an admin may do.
   * Firestore checks a *list* query against the rules before running it and
   * refuses one it cannot prove safe — so an unscoped `closedDeals` read by a
   * sub admin is denied outright, and the screen shows zero revenue with a
   * `permission-denied` in the console. That is exactly what the sub admin's
   * team page was doing.
   *
   * Passing `{ role: 'subadmin', uid }` adds the `subAdminUid == me` clause the
   * rule checks, which is also the only thing that makes the query legal.
   * Expenses stay admin-only and are simply not read.
   */
  scope?: { role?: string | null; uid?: string }
) {
  const demoState = useDemoState();

  const teamOf = scope?.role === 'subadmin' ? (scope.uid ?? null) : null;
  // A sub admin with no uid yet would issue the unscoped query and be refused,
  // so wait for it rather than firing one that cannot succeed.
  const ready = enabled && (scope?.role !== 'subadmin' || Boolean(teamOf));

  /*
    Both shared. `closedDeals` is read by the dashboard, the deals screen, the
    directory and Reports; `expenses` by the dashboard and the income sheet.
    One listener each, held briefly between screens — see `lib/liveCollection`.
  */
  const buildDeals = useCallback(
    () =>
      teamOf
        ? query(collection(db, 'closedDeals'), where('subAdminUid', '==', teamOf), orderBy('enteredAt', 'desc'), limit(1000))
        : query(collection(db, 'closedDeals'), orderBy('enteredAt', 'desc'), limit(1000)),
    [teamOf]
  );
  const dealsLive = useLive(`closedDeals:${teamOf ?? 'all'}`, buildDeals, !IS_DEMO && ready, describeLiveError);

  // Expenses are the company's, not a team's — there is no scoped form of this
  // query, so a sub admin simply does not read them.
  const buildExpenses = useCallback(
    () => query(collection(db, 'expenses'), orderBy('date', 'desc'), limit(1000)),
    []
  );
  const expensesLive = useLive('expenses:byDate', buildExpenses, !IS_DEMO && ready && !teamOf, describeLiveError);

  const deals = dealsLive.rows as unknown as DealRecord[];
  const expenses = expensesLive.rows as unknown as ExpenseRecord[];
  const error = dealsLive.error ?? expensesLive.error;

  const allDeals = useMemo(() => {
    if (!enabled) return [];
    if (!IS_DEMO) return deals;
    // Demo mode is scoped the same way, or it would demonstrate the leak the
    // live rules forbid.
    return teamOf ? demoState.deals.filter((deal) => deal.subAdminUid === teamOf) : demoState.deals;
  }, [enabled, deals, demoState.deals, teamOf]);

  const allExpenses = useMemo(
    () => (!enabled || teamOf ? [] : IS_DEMO ? demoState.expenses : expenses),
    [enabled, teamOf, expenses, demoState.expenses]
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
    // A sub admin never reads expenses, so waiting on that listener would
    // leave their screen loading for ever.
    loading: IS_DEMO ? false : ready && (dealsLive.loading || (!teamOf && expensesLive.loading)),
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
  const demoState = useDemoState();

  const isAdmin = role === 'admin';
  const scopeKey = !enabled || !role || (!isAdmin && !uid) ? 'idle' : isAdmin ? 'admin' : `employee:${uid}`;

  /*
    **Shared, and capped far lower than it was.**

    Measured on 2026-09-11: 291 unread admin alerts, so the old `limit(100)`
    pulled a hundred documents back **on every screen that draws the bell** —
    which is all of them. That was the second-largest read on the whole app
    after `leads`, and none of it was looked at: the bell shows a count and the
    panel shows the most recent few.

    Twenty is more than the panel can display without scrolling, and the count
    beside the bell says "20+" past that rather than pretending to be exact.
    An exact badge would cost a `count()` aggregation per screen — cheaper than
    a hundred documents but not free, and nobody acts differently on 291 than
    on "20+".
  */
  const build = useCallback(
    () =>
      query(
        collection(db, 'notifications'),
        // Admins read the alerts addressed to the role; an employee reads the
        // ones addressed to them by uid. Both mirror a clause in the rule, so
        // both are provable.
        scopeKey === 'admin' ? where('targetRole', '==', 'admin') : where('targetUid', '==', uid),
        where('readAt', '==', null),
        orderBy('createdAt', 'desc'),
        limit(scopeKey === 'admin' ? ADMIN_NOTIFICATION_PAGE : NOTIFICATION_PAGE)
      ),
    // `uid` is encoded in `scopeKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeKey]
  );

  const live = useLive(`notifications:${scopeKey}`, build, !IS_DEMO && scopeKey !== 'idle', describeLiveError);

  if (IS_DEMO) {
    // Scoped exactly as the live query is — admin by role, employee by uid.
    // An `|| targetRole === role` here would show one employee another's
    // alerts, which is the leak the live rule now forbids; the demo must not
    // demonstrate behaviour the product does not have.
    return {
      notifications:
        enabled && role
          ? demoState.notifications.filter((n) =>
              isAdmin
                ? n.targetRole === 'admin' && isAdminAlert(n.type)
                : n.targetUid === uid
            )
          : [],
      loading: false,
    };
  }

  /*
    **The admin's five, filtered here rather than in the query.**

    Here, because a `type in [...]` clause would need a composite index this
    project cannot deploy from a developer machine, and a query whose index is
    missing is **refused outright** — the bell would render empty, which is this
    codebase's most-repeated symptom. Filtering the page we already read costs
    nothing and cannot fail.

    One place for both the list and the badge: filtering only the panel would
    leave a bell reading 12 over an empty list, which reads as a broken screen.
    The window is larger for an admin than it was, because the rows that do not
    qualify are read and discarded — see `NOTIFICATION_PAGE`.
  */
  const rows = enabled ? (live.rows as unknown as AppNotification[]) : [];

  return {
    notifications: isAdmin ? rows.filter((row) => isAdminAlert(row.type)) : rows,
    loading: enabled && live.loading,
  };
}

function sum<T>(items: T[], pick: (item: T) => number | undefined): number {
  return items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
}
