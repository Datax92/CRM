/**
 * Car Sale — a car bought with partners, sold, and what the owner is left with.
 *
 * Transcribed from the owner's own `car sale.xlsx` (`CAR SALE PURCHASE`), whose
 * columns are the whole specification:
 *
 * ```
 * CAR NAME | PARTNERSHIP STATUS | PURCHASING DATE | PURCHASING RATE + COST |
 * MY PAYMENT | SELLING DATE | SALE PRICE | DESCRIPTION IF ANY |
 * GROSS PROFIT | INVESTOR | CC CHARGES | MISC | NET PROFIT | DESCRIPTION
 * ```
 *
 * Four rules carry the weight, and all four come from reading the rows rather
 * than from a convention:
 *
 * - **GROSS PROFIT in that sheet is the owner's share, not the whole profit.**
 *   The Honda City 2022 sold for 2,80,000 more than it cost and the sheet says
 *   93,000, because the partnership is `ME / QALBE / KHAJI`. So the profit is
 *   shared out by named partner and **the owner is one of the partners** — the
 *   line marked `mine` is what becomes gross profit.
 *
 * - **A share may be typed as a percentage or as rupees, and each fills in the
 *   other.** The owner's instruction, and the sheet is why: a 75,000 profit
 *   split three ways is three round 25,000s in his book, where 33.33% would
 *   come to 24,997.50. `basis` records which column was typed, so the figure a
 *   person actually chose is the one kept and the other is derived from it —
 *   never two stored numbers that can drift apart.
 *
 * - **A loss is a real outcome and is never clamped to zero.** Two rows in the
 *   sheet are losses (−2,500 on the City 2006, −4,900 net on the Corolla once
 *   the investor was paid). Everything here works in both directions, including
 *   the over-allocation check, which asks "more than there was" rather than
 *   "more than zero".
 *
 * - **MY PAYMENT is recorded, not moved.** What the owner put into buying the
 *   car is a fact about the purchase; at his instruction it touches no account.
 *   Only the **net profit** reaches the ledger.
 *
 * `netProfit = grossProfit − investor − ccCharges − misc`, which reproduces
 * every row of the sheet and its totals exactly — see `carSale.test.ts`.
 *
 * Depends only on `marketingIncome`'s numeric helpers (itself dependency-free),
 * with an explicit extension so the raw `--experimental-strip-types` test
 * loader can resolve it.
 */

import { roundMoney, roundPercent, parsePercent } from './marketingIncome.ts';

/**
 * One name in the `PARTNERSHIP STATUS` column, and what they take.
 *
 * `percent` and `amount` are both held because both are shown; `basis` says
 * which of them the person typed and is therefore the one that survives an edit
 * to the sale price. Without it, changing the sale price would silently either
 * restate what a partner was promised or leave a percentage that no longer
 * matches its own rupees.
 */
export interface CarPartner {
  name: string | null;
  /** 0–100. Meaningful in its own right only when `basis` is `PERCENT`. */
  percent: number;
  /** Rupees. Meaningful in its own right only when `basis` is `AMOUNT`. */
  amount: number;
  basis: CarShareBasis;
  /** **Exactly one partner is the owner** — that line becomes gross profit. */
  mine: boolean;
}

export const CAR_SHARE_BASES = ['PERCENT', 'AMOUNT'] as const;
export type CarShareBasis = (typeof CAR_SHARE_BASES)[number];

export function isCarShareBasis(value: unknown): value is CarShareBasis {
  return value === 'PERCENT' || value === 'AMOUNT';
}

/** A partner line with both columns resolved against the profit. */
export interface CarPartnerLine extends CarPartner {
  /** The figure the other column shows, whichever way round it was typed. */
  percent: number;
  amount: number;
}

/** The three columns the sheet takes off gross profit before net. */
export interface CarDeductions {
  /** `INVESTOR` — a financing partner's cut, paid out of the owner's share. */
  investor: number;
  /** `CC CHARGES` — the credit-card cost of the round. */
  ccCharges: number;
  /** `MISC` — anything else that came out of this car. */
  misc: number;
}

export const EMPTY_DEDUCTIONS: CarDeductions = { investor: 0, ccCharges: 0, misc: 0 };

export interface CarSaleSplit {
  purchaseCost: number;
  salePrice: number;
  /** `SALE PRICE − PURCHASING RATE + COST`. Negative on a loss, as it should be. */
  totalProfit: number;
  lines: CarPartnerLine[];
  /** Every partner's rupees, added. */
  allocated: number;
  /** Every partner's percentage, added. */
  allocatedPercent: number;
  /** `totalProfit − allocated` — what nobody has been given yet. */
  unallocated: number;
  /** The owner's own line. 0 when no partner is marked as the owner. */
  grossProfit: number;
  /** The owner's share as a percentage, for the caption. */
  myPercent: number;
  deductions: CarDeductions;
  totalDeductions: number;
  /** `grossProfit − totalDeductions`. **This is what reaches the ledger.** */
  netProfit: number;
  errors: string[];
  valid: boolean;
}

/** Blank partner row, ready to type into. */
export function emptyPartner(mine = false): CarPartner {
  return { name: null, percent: 0, amount: 0, basis: 'PERCENT', mine };
}

/**
 * Accepts whatever a money input produced.
 *
 * **Negatives are kept**, unlike a percentage: a partner can carry part of a
 * loss, and clamping that to zero would quietly hand it to somebody else.
 */
export function parseAmount(input: unknown): number {
  if (input === null || input === undefined) return 0;
  const text = String(input).trim().replace(/,/g, '');
  if (!text || text === '-') return 0;
  const value = Number(text);
  return Number.isFinite(value) ? roundMoney(value) : 0;
}

/** `total × percent / 100`, to the paisa. Works for a negative total. */
export function amountFromPercent(total: number, percent: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(percent)) return 0;
  return roundMoney((total * percent) / 100);
}

/**
 * `amount ÷ total × 100`.
 *
 * **A zero profit yields 0%, not infinity.** A car sold for exactly what it
 * cost has no profit to be a percentage of, and `Infinity%` on the screen is
 * worse than a blank.
 */
export function percentFromAmount(total: number, amount: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(amount) || total === 0) return 0;
  return roundPercent((amount / total) * 100);
}

/** Fills in whichever column the person did not type. */
export function resolvePartner(total: number, partner: CarPartner): CarPartnerLine {
  return partner.basis === 'AMOUNT'
    ? { ...partner, amount: roundMoney(partner.amount), percent: percentFromAmount(total, partner.amount) }
    : { ...partner, percent: roundPercent(partner.percent), amount: amountFromPercent(total, partner.percent) };
}

/**
 * Everything a car sale comes to, recomputed from scratch on every keystroke.
 *
 * Cheap enough to run per render, so no memoisation and no chance of a rupee
 * figure lagging the percentage that produced it.
 *
 * **A car with no partners at all is entirely the owner's.** That is not a
 * special case bolted on: a solo purchase has nobody to share with, and
 * demanding a single partner row saying "me, 100%" would be a box whose only
 * correct value is the one the app already knows.
 */
export function calculateCarSale(input: {
  purchaseCost: number;
  salePrice: number;
  partners: CarPartner[];
  deductions?: Partial<CarDeductions>;
}): CarSaleSplit {
  const purchaseCost = roundMoney(Number(input.purchaseCost) || 0);
  const salePrice = roundMoney(Number(input.salePrice) || 0);
  const totalProfit = roundMoney(salePrice - purchaseCost);

  const partners = input.partners ?? [];
  const lines = partners.map((partner) => resolvePartner(totalProfit, partner));

  const allocated = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const allocatedPercent = roundPercent(lines.reduce((sum, line) => sum + line.percent, 0));
  const unallocated = roundMoney(totalProfit - allocated);

  const mine = lines.filter((line) => line.mine);
  const grossProfit = lines.length === 0 ? totalProfit : mine.length === 1 ? mine[0].amount : 0;
  const myPercent =
    lines.length === 0 ? 100 : mine.length === 1 ? mine[0].percent : 0;

  const deductions: CarDeductions = {
    investor: roundMoney(Number(input.deductions?.investor) || 0),
    ccCharges: roundMoney(Number(input.deductions?.ccCharges) || 0),
    misc: roundMoney(Number(input.deductions?.misc) || 0),
  };
  const totalDeductions = roundMoney(deductions.investor + deductions.ccCharges + deductions.misc);
  const netProfit = roundMoney(grossProfit - totalDeductions);

  const errors: string[] = [];

  for (const line of lines) {
    if ((line.amount !== 0 || line.percent !== 0) && !(line.name ?? '').trim()) {
      errors.push('One of the partners has a share but no name. Name them, or clear the share.');
      break;
    }
  }

  if (mine.length > 1) {
    errors.push('Two partners are marked as you. Only one line can be your own share.');
  } else if (lines.length > 0 && mine.length === 0) {
    errors.push('Mark which partner is you — that share is what the car earns you.');
  }

  /*
    **"More than there was", in whichever direction the car went.** A 75,000
    profit cannot be shared out as 90,000, and a 2,500 loss cannot be shared out
    as a 5,000 one — the second is the same mistake and a plain `> 0` test would
    miss it entirely. Refused rather than trimmed: scaling the lines down would
    pay somebody an amount nobody agreed.
  */
  if (totalProfit >= 0 ? allocated > totalProfit : allocated < totalProfit) {
    errors.push(
      `The partners' shares come to ${allocated.toLocaleString()} out of ${totalProfit.toLocaleString()}. Reduce a share, or correct the sale price.`
    );
  }

  if (deductions.investor < 0 || deductions.ccCharges < 0 || deductions.misc < 0) {
    errors.push('Investor, CC charges and misc are amounts taken off — they cannot be negative.');
  }

  return {
    purchaseCost,
    salePrice,
    totalProfit,
    lines,
    allocated,
    allocatedPercent,
    unallocated,
    grossProfit,
    myPercent,
    deductions,
    totalDeductions,
    netProfit,
    errors,
    valid: errors.length === 0,
  };
}

/**
 * Reads partners off a stored record.
 *
 * Anything unrecognisable is dropped rather than defaulted: a half-read partner
 * with a name and no share would silently take nothing, which on this screen
 * looks exactly like a partner who agreed to nothing.
 */
export function readPartners(raw: unknown): CarPartner[] {
  if (!Array.isArray(raw)) return [];
  const partners: CarPartner[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    partners.push({
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : null,
      percent: parsePercent(row.percent),
      amount: parseAmount(row.amount),
      basis: isCarShareBasis(row.basis) ? row.basis : 'PERCENT',
      mine: row.mine === true,
    });
  }
  return partners;
}

export function readDeductions(raw: Record<string, unknown> | null | undefined): CarDeductions {
  return {
    investor: parseAmount(raw?.investor),
    ccCharges: parseAmount(raw?.ccCharges),
    misc: parseAmount(raw?.misc),
  };
}

/**
 * The `PARTNERSHIP STATUS` cell, rebuilt from the partner list.
 *
 * The sheet writes it as `ME / QALBE / KHAJI`, and that is the fastest way to
 * read a row at a glance — so the app prints it the same way rather than making
 * somebody open the record to see who was in on the car.
 */
export function partnershipLabel(partners: CarPartner[]): string {
  const names = partners.map((partner) => (partner.mine ? 'ME' : partner.name)).filter(Boolean);
  return names.length > 0 ? names.join(' / ') : 'Mine alone';
}
