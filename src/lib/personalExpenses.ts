/**
 * Personal expense statuses.
 *
 * In a plain module, not in `app/actions/accountModules.ts`, because a
 * `"use server"` file may only export async functions — anything else is
 * rejected at runtime with *"A 'use server' file can only export async
 * functions, found object"*, which the type checker and the production build
 * both let through.
 */

export const PERSONAL_EXPENSE_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;

export type PersonalExpenseStatus = (typeof PERSONAL_EXPENSE_STATUSES)[number];

export const PERSONAL_EXPENSE_STATUS_LABELS: Record<PersonalExpenseStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/** The categories the claim form offers. */
export const PERSONAL_EXPENSE_CATEGORIES = [
  'Travel',
  'Fuel',
  'Meals',
  'Client entertainment',
  'Supplies',
  'Phone',
  'Other',
] as const;
