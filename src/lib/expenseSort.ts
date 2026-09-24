/**
 * Sorting an expense list — Office and Personal Expenses both use it (owner,
 * 2026-09-24).
 *
 * **By the date typed on the expense (`dayKey`), never by when it was entered.**
 * An expense recorded on the 20th for a bill paid on the 3rd belongs on the
 * 3rd. Ties keep the order they arrived in (`Array.prototype.sort` is stable).
 *
 * A sort only reorders the list; it changes no figure, so the headline, the
 * charts and the export totals are the same whichever is chosen.
 *
 * Dependency-free so the raw `--experimental-strip-types` test loader runs it.
 */

export const EXPENSE_SORTS = [
  'DATE_DESC',
  'DATE_ASC',
  'AMOUNT_DESC',
  'AMOUNT_ASC',
  'TITLE_ASC',
  'CATEGORY_ASC',
] as const;

export type ExpenseSort = (typeof EXPENSE_SORTS)[number];

export const DEFAULT_EXPENSE_SORT: ExpenseSort = 'DATE_DESC';

export const EXPENSE_SORT_LABELS: Record<ExpenseSort, string> = {
  DATE_DESC: 'Date — newest first',
  DATE_ASC: 'Date — oldest first',
  AMOUNT_DESC: 'Amount — highest first',
  AMOUNT_ASC: 'Amount — lowest first',
  TITLE_ASC: 'Title — A to Z',
  CATEGORY_ASC: 'Category — A to Z',
};

export interface SortableExpense {
  dayKey: string;
  amount: number;
  title: string;
  category?: string | null;
}

const text = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

/** A new, sorted copy. The input is never reordered in place. */
export function sortExpenses<T extends SortableExpense>(list: readonly T[], sort: ExpenseSort): T[] {
  const byDate = (a: T, b: T) => a.dayKey.localeCompare(b.dayKey);
  const out = [...list];
  switch (sort) {
    case 'DATE_ASC':
      return out.sort(byDate);
    case 'AMOUNT_DESC':
      return out.sort((a, b) => b.amount - a.amount || byDate(b, a));
    case 'AMOUNT_ASC':
      return out.sort((a, b) => a.amount - b.amount || byDate(b, a));
    case 'TITLE_ASC':
      return out.sort((a, b) => text(a.title).localeCompare(text(b.title)) || byDate(b, a));
    case 'CATEGORY_ASC':
      return out.sort((a, b) => text(a.category).localeCompare(text(b.category)) || byDate(b, a));
    default:
      return out.sort((a, b) => byDate(b, a));
  }
}

export function isExpenseSort(value: unknown): value is ExpenseSort {
  return typeof value === 'string' && (EXPENSE_SORTS as readonly string[]).includes(value);
}
