/**
 * Personal expenses — one person's own spending, and whether it has been paid
 * back out of an account.
 *
 * **There is no approval workflow and no second person.** It had both — draft,
 * submitted, approved, rejected, cancelled, a claimant picker, a manager to
 * decide it — and the owner's instruction was to remove them: *"whats claim and
 * claimant, make the wording simple, remove employees and manager, it should be
 * personal expense only."* What is left is what the screen is actually for:
 * I spent this, and this account paid it back.
 *
 * In a plain module, not in `app/actions/accountModules.ts`, because a
 * `"use server"` file may only export async functions — anything else is
 * rejected at runtime with *"A 'use server' file can only export async
 * functions, found object"*, which the type checker and the production build
 * both let through.
 */

/**
 * The only three states, and **none of them is stored**.
 *
 * Each is `paidAmount` against `amount`, so every existing record classifies
 * the moment this ships, there is no backfill, and nothing can go stale — the
 * project's derive-on-read rule. The five stored statuses that used to live
 * here (`DRAFT`, `SUBMITTED`, …) are simply not read any more; the two live
 * records carry `SUBMITTED` and read correctly as Unpaid.
 */
export const PAYMENT_STATES = ['UNPAID', 'PART_PAID', 'PAID'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  UNPAID: 'Unpaid',
  PART_PAID: 'Part paid',
  PAID: 'Paid',
};

export function paymentState(expense: { amount: number; paidAmount: number }): PaymentState {
  const amount = Number(expense.amount) || 0;
  const paid = Number(expense.paidAmount) || 0;
  if (amount > 0 && paid >= amount) return 'PAID';
  if (paid > 0) return 'PART_PAID';
  return 'UNPAID';
}

/** The categories the form offers. */
export const PERSONAL_EXPENSE_CATEGORIES = [
  'Travel',
  'Fuel',
  'Meals',
  'Client entertainment',
  'Supplies',
  'Phone',
  'Other',
] as const;
