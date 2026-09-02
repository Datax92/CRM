/**
 * Runtime constants shared between client components and "use server" action
 * files. A "use server" file may only export async functions, so plain value
 * exports (arrays, objects, etc.) live here instead and get imported by both
 * sides.
 */

/** FR-27 — the categories are fixed by the spec, not free text. */
export const EXPENSE_CATEGORIES = [
  "Rent",
  "Salaries",
  "Internet",
  "Electricity",
  "Water",
  "Bills",
  "Marketing",
  "Software",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const RECEIVABLE_SIZES = ["Large", "Small"] as const;
export type ReceivableSize = (typeof RECEIVABLE_SIZES)[number];

export const PAYMENT_METHODS = [
  "Cash",
  "Bank Transfer",
  "Cheque",
  "Easypaisa",
  "JazzCash",
  "Card",
  "Other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
