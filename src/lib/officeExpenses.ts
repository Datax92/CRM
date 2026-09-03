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
