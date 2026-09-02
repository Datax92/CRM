/**
 * How a closed deal is classified for the portfolio panel.
 *
 * The dashboard's "Current Portfolio (YTD)" breaks revenue down these three
 * ways, so the category has to be captured at the point of sale — it cannot be
 * inferred afterwards from the amounts or the service description.
 */
export const DEAL_CATEGORIES = ['Rental', 'Installment', 'Investment'] as const;

export type DealCategory = (typeof DEAL_CATEGORIES)[number];

export const DEFAULT_DEAL_CATEGORY: DealCategory = 'Investment';

/** Deals recorded before this field existed still have to land somewhere. */
export function normalizeDealCategory(value: unknown): DealCategory {
  const text = typeof value === 'string' ? value.trim() : '';
  return (DEAL_CATEGORIES as readonly string[]).includes(text)
    ? (text as DealCategory)
    : DEFAULT_DEAL_CATEGORY;
}
