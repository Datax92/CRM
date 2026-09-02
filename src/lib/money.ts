/**
 * Currency formatting. The business operates in Pakistan, so everything is PKR
 * (PRD §8 open question 3 assumes a single currency for Phase 1).
 *
 * Amounts are held as whole rupees — PKR is rarely quoted in paisa for deal
 * values, so the default display carries no decimals.
 */

export const CURRENCY = 'PKR';
export const LOCALE = 'en-PK';

const full = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  maximumFractionDigits: 0,
});

const plain = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 0,
});

/** `Rs 8,500` — for tables, tiles and ledgers. */
export function formatMoney(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return full.format(0);
  return full.format(amount);
}

/** `-Rs 1,250` — expenses and anything that reduces a total. */
export function formatNegativeMoney(amount: number | null | undefined): string {
  const value = amount == null || !Number.isFinite(amount) ? 0 : Math.abs(amount);
  return `-${full.format(value)}`;
}

/** `8,500` — when the unit is already shown in a column header or label. */
export function formatAmount(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return plain.format(0);
  return plain.format(amount);
}

/**
 * Validates a money input from a form. Rejects NaN, negatives and absurd values
 * so a typo can't poison the financial rollups.
 */
export function parseMoney(input: unknown): number {
  // Number('') and Number(null) are both 0, so a blank form field would sail
  // through as a legitimate zero. Reject empties before coercing.
  if (input === null || input === undefined) {
    throw new Error('Enter a valid amount.');
  }
  if (typeof input === 'string' && input.trim() === '') {
    throw new Error('Enter a valid amount.');
  }

  const value = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(value)) {
    throw new Error('Enter a valid amount.');
  }
  if (value < 0) {
    throw new Error('Amount cannot be negative.');
  }
  if (value > 1_000_000_000_000) {
    throw new Error('That amount looks wrong — please check it.');
  }
  return Math.round(value * 100) / 100;
}

/**
 * Compact money for dashboard panels — `PKR 5.9M`, `PKR 740.2K`.
 *
 * Deliberately separate from `formatMoney`: a ledger must show the exact
 * figure, but a portfolio bar that reads "Rs 15,444,500" crowds out the bar it
 * is labelling. Only ever used where the precise number is available elsewhere.
 */
export function formatCompactMoney(amount: number | null | undefined): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 'PKR 0';

  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1_000_000) return `${sign}PKR ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}PKR ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}PKR ${Math.round(abs)}`;
}
