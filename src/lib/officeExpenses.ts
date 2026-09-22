/**
 * Office expenses — statuses, categories and the summaries the dashboard draws.
 *
 * Pure and dependency-free, so the test loader can reach it and so the
 * dashboard's figures and the report's figures come from one function rather
 * than two that drift.
 *
 * **This extends the existing `expenses` collection rather than starting a new
 * one.** Records written before this module have no `status`, no `paidBy` and
 * no receipt; every reader here treats an absent status as `APPROVED`, because
 * an expense that was recorded when there was no approval step *was* the
 * business's spending, and re-opening a year of history as "Pending" would be
 * a fiction that also breaks every total that has ever been reported.
 */

export const EXPENSE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

/**
 * The categories the brief names, kept as the *defaults*.
 *
 * Admin and HR can add their own (`config/expenseCategories`), so this is a
 * starting list rather than a closed set — but the four that predate this
 * module (`Salaries`, `Electricity`, `Water`, `Bills`) stay valid too, or
 * every historical record would fail validation on its next edit.
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Utilities',
  'Internet',
  'Office Supplies',
  'Equipment',
  'Maintenance',
  'Transport',
  'Marketing',
  'Software/Subscriptions',
  'Other',
] as const;

/** Categories used by records written before this module existed. */
export const LEGACY_EXPENSE_CATEGORIES = [
  'Salaries',
  'Electricity',
  'Water',
  'Bills',
] as const;

export const PAYMENT_METHODS = [
  'Cash',
  'Bank Transfer',
  'Cheque',
  'Card',
  'Mobile Wallet',
  'Other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * An expense as the module reads it — the stored document plus the defaults
 * that make an older record legible.
 */
export interface OfficeExpense {
  id: string;
  title: string;
  category: string;
  amount: number;
  description: string | null;
  status: ExpenseStatus;
  /** Who actually paid — a person's name, not necessarily who recorded it. */
  paidBy: string | null;
  paymentMethod: string | null;
  /** Asset id in the receipts store, plus what it was called when uploaded. */
  receiptUrl: string | null;
  receiptName: string | null;
  addedByUid: string;
  addedByEmail: string | null;
  /** `YYYY-MM-DD` in Karachi — the day the money went out. */
  dayKey: string;
  decidedByUid: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  /**
   * **How much of this expense the ledger has actually funded.**
   *
   * Written by `payFromAccounts`, which is also the only thing that may write
   * it — the obligation (`amount`) never changes when it is paid. An expense
   * recorded before the ledger has no field at all, and absent means *nothing
   * paid*, not *broken*: `readPaid` is the single reader so that reading stays
   * one decision.
   */
  paidAmount: number;
  paymentStatus: PaymentStatus;
  /**
   * The audit trail every write path appends to — created, edited, decided,
   * paid, un-paid. It has been written since the module shipped and had **no
   * reader**: the row shows a title, a date and a status, so who approved this
   * and which accounts funded it were facts the database held and the screen
   * could not show. The detail panel is that reader.
   */
  history: ExpenseHistoryEntry[];
}

export interface ExpenseHistoryEntry {
  /** ISO, or a Firestore timestamp already turned into one. */
  at: string;
  action: string;
  byName: string | null;
  detail: string | null;
  amount: number | null;
}

/**
 * One history entry, from whatever shape it was written in.
 *
 * Three writers have appended to this array over the module's life and they do
 * not agree: `at` is an ISO string from the ledger and a `Date` from
 * `officeExpenses`, the name is `byName` or `decidedByName`, and the ledger's
 * `PAID` rows carry an `amount` nothing else does. Reading them one way here is
 * what stops the panel rendering "Invalid Date" against the older half.
 */
export function readHistoryEntry(raw: unknown): ExpenseHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const at = row.at;
  const stamp =
    typeof at === 'string'
      ? at
      : at instanceof Date
        ? at.toISOString()
        : typeof (at as { toDate?: () => Date })?.toDate === 'function'
          ? (at as { toDate: () => Date }).toDate().toISOString()
          : '';

  return {
    at: stamp,
    action: typeof row.action === 'string' ? row.action : 'Recorded',
    byName:
      (typeof row.byName === 'string' && row.byName) ||
      (typeof row.decidedByName === 'string' && row.decidedByName) ||
      null,
    detail:
      (typeof row.detail === 'string' && row.detail) ||
      (typeof row.note === 'string' && row.note) ||
      null,
    amount: typeof row.amount === 'number' ? row.amount : null,
  };
}

/** The stored action words, made readable. Anything else is shown as written. */
export const HISTORY_LABELS: Record<string, string> = {
  CREATED: 'Recorded',
  EDITED: 'Edited',
  PAID: 'Paid',
  PAYMENT_REMOVED: 'Payment removed',
  STATUS_APPROVED: 'Approved',
  STATUS_REJECTED: 'Rejected',
  STATUS_PENDING: 'Moved back to pending',
  SUBMITTED: 'Submitted for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/** Unpaid is the absence of a payment, so it is what an absent field reads as. */
export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export function normalizePaymentStatus(raw: unknown): PaymentStatus {
  return raw === 'PAID' || raw === 'PARTIALLY_PAID' ? raw : 'UNPAID';
}

/**
 * What has been paid against an expense, and what is still owed.
 *
 * The paid figure is **clamped to the amount**: an expense edited down after it
 * was paid would otherwise report a negative outstanding, and "Rs -2,000 still
 * owed" is a sentence nobody can act on. The clamp is display-only — the
 * stored figure and the transactions behind it are untouched.
 */
export function readPaid(expense: Pick<OfficeExpense, 'amount' | 'paidAmount'>): {
  paid: number;
  outstanding: number;
  settled: boolean;
} {
  const paid = Math.max(0, Math.min(round2(expense.paidAmount), round2(expense.amount)));
  const outstanding = round2(expense.amount - paid);
  return { paid, outstanding, settled: outstanding <= 0 && expense.amount > 0 };
}

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** An absent status means the record predates approvals — see the note above. */
export function normalizeExpenseStatus(raw: unknown): ExpenseStatus {
  return raw === 'PENDING' || raw === 'REJECTED' ? raw : 'APPROVED';
}

/**
 * Which statuses an expense may move to.
 *
 * A decision can be reversed — the wrong button gets pressed, and a rejected
 * invoice that turns out to be legitimate has to be payable. What cannot
 * happen is a decided expense quietly becoming undecided with no record: every
 * change appends to the expense's own history.
 */
export function allowedExpenseTransitions(from: ExpenseStatus): ExpenseStatus[] {
  return EXPENSE_STATUSES.filter((status) => status !== from);
}

export interface ExpenseSummary {
  total: number;
  count: number;
  pending: number;
  pendingCount: number;
  approved: number;
  approvedCount: number;
  rejected: number;
  rejectedCount: number;
  /** Approved spend only — a rejected invoice is not money the company spent. */
  spend: number;
}

/**
 * The dashboard's figures.
 *
 * `total` is every record's amount and `spend` is the approved ones only. Both
 * are shown, because "we were invoiced 1.4M and approved 1.1M" is two facts and
 * collapsing them into one number hides whichever half the reader needed.
 */
export function summarizeExpenses(expenses: OfficeExpense[]): ExpenseSummary {
  return expenses.reduce<ExpenseSummary>(
    (sum, expense) => {
      const amount = Math.max(0, Math.round(expense.amount) || 0);
      sum.total += amount;
      sum.count += 1;

      if (expense.status === 'PENDING') {
        sum.pending += amount;
        sum.pendingCount += 1;
      } else if (expense.status === 'REJECTED') {
        sum.rejected += amount;
        sum.rejectedCount += 1;
      } else {
        sum.approved += amount;
        sum.approvedCount += 1;
        sum.spend += amount;
      }

      return sum;
    },
    {
      total: 0,
      count: 0,
      pending: 0,
      pendingCount: 0,
      approved: 0,
      approvedCount: 0,
      rejected: 0,
      rejectedCount: 0,
      spend: 0,
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Whose expenses                                                             */
/* -------------------------------------------------------------------------- */

/** Where an expense with no recorder on it is gathered. */
export const UNATTRIBUTED_RECORDER = '';

export interface ExpenseRecorder {
  /** `UNATTRIBUTED_RECORDER` for records written before the field existed. */
  uid: string;
  label: string;
  count: number;
  isSelf: boolean;
}

/**
 * Who has actually recorded expenses, for the "Recorded by" selector.
 *
 * **Derived from the expenses, never from the roster.** A list built from every
 * account would offer a dozen people who have never submitted anything, and
 * picking one would empty the screen — a choice that can only produce nothing is
 * worse than no choice. What is here is what somebody can usefully select.
 *
 * **Records with no recorder are gathered rather than dropped.** A handful of
 * expenses predate `addedByUid`, and leaving them out of the options while they
 * still counted under *Everyone* would make the per-person figures quietly fail
 * to add up to the total — the kind of discrepancy that costs an afternoon.
 *
 * Names come from the caller (`names`), because this module is dependency-free
 * and unit-tested under the raw type-strip loader; the stored email is the
 * fallback, and the uid itself the last resort, so an option is never blank.
 */
export function expenseRecorders(
  expenses: Array<{ addedByUid?: string | null; addedByEmail?: string | null }>,
  options: { selfUid?: string | null; names?: Record<string, string> } = {}
): ExpenseRecorder[] {
  const names = options.names ?? {};
  const self = (options.selfUid ?? '').trim();
  const buckets = new Map<string, { count: number; email: string | null }>();

  for (const expense of expenses) {
    const uid = String(expense.addedByUid ?? '').trim();
    const bucket = buckets.get(uid) ?? { count: 0, email: null };
    bucket.count += 1;
    bucket.email = bucket.email ?? (expense.addedByEmail ? String(expense.addedByEmail) : null);
    buckets.set(uid, bucket);
  }

  const rows: ExpenseRecorder[] = [];
  for (const [uid, bucket] of buckets) {
    const isSelf = Boolean(self) && uid === self;
    rows.push({
      uid,
      count: bucket.count,
      isSelf,
      label: uid === UNATTRIBUTED_RECORDER
        ? 'Not recorded'
        : isSelf
          ? 'Me'
          : names[uid] || bucket.email || uid.slice(0, 8),
    });
  }

  /*
    Mine first — it is the one an admin opens this for — then whoever has
    submitted most, so the person with two claims does not sit above the person
    with two hundred. Alphabetical within a tie keeps the order stable between
    renders, and `Not recorded` sits last because it is a residue, not a person.
  */
  rows.sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    const aResidue = a.uid === UNATTRIBUTED_RECORDER;
    const bResidue = b.uid === UNATTRIBUTED_RECORDER;
    if (aResidue !== bResidue) return aResidue ? 1 : -1;
    return b.count - a.count || a.label.localeCompare(b.label);
  });

  return rows;
}

export interface CategoryTotal {
  category: string;
  amount: number;
  count: number;
  /** Share of approved spend, 0–100. */
  share: number;
}

/**
 * Category breakdown, largest first.
 *
 * Counts **approved spend only**. A pending invoice is not yet a cost, and a
 * category chart that included rejected claims would overstate every line on
 * it — which is the chart somebody takes to a budget meeting.
 */
export function expensesByCategory(expenses: OfficeExpense[]): CategoryTotal[] {
  const buckets = new Map<string, { amount: number; count: number }>();

  for (const expense of expenses) {
    if (expense.status !== 'APPROVED') continue;
    const key = expense.category || 'Other';
    const bucket = buckets.get(key) ?? { amount: 0, count: 0 };
    bucket.amount += Math.max(0, Math.round(expense.amount) || 0);
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const total = [...buckets.values()].reduce((sum, bucket) => sum + bucket.amount, 0);

  return [...buckets.entries()]
    .map(([category, bucket]) => ({
      category,
      amount: bucket.amount,
      count: bucket.count,
      share: total === 0 ? 0 : Math.round((bucket.amount / total) * 100),
    }))
    .sort((a, b) => b.amount - a.amount);
}

export interface PeriodTotal {
  key: string;
  amount: number;
  count: number;
}

/**
 * Approved spend grouped by day, month or year.
 *
 * Grouping is a string slice of the `YYYY-MM-DD` key: those strings sort as
 * dates, so the trend comes out in order without parsing a single date.
 */
export function expensesByPeriod(
  expenses: OfficeExpense[],
  grain: 'day' | 'month' | 'year'
): PeriodTotal[] {
  const width = grain === 'day' ? 10 : grain === 'month' ? 7 : 4;
  const buckets = new Map<string, { amount: number; count: number }>();

  for (const expense of expenses) {
    if (expense.status !== 'APPROVED') continue;
    const key = expense.dayKey.slice(0, width);
    if (!key) continue;
    const bucket = buckets.get(key) ?? { amount: 0, count: 0 };
    bucket.amount += Math.max(0, Math.round(expense.amount) || 0);
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, ...bucket }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The change between the last two periods, as a percentage.
 *
 * `null` rather than 0 when there is nothing to compare against — a first
 * month has no trend, and printing "0%" would claim it was flat.
 */
export function trendPercent(periods: PeriodTotal[]): number | null {
  if (periods.length < 2) return null;

  const previous = periods[periods.length - 2].amount;
  const latest = periods[periods.length - 1].amount;
  if (previous === 0) return null;

  return Math.round(((latest - previous) / previous) * 100);
}
