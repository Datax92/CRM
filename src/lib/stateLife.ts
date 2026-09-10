/**
 * StateLife — the commission sheet, as a module.
 *
 * Transcribed from `statelife.xlsx`, sheet **STATE LIFE RECORD**, header row 3.
 * Nothing here is inferred: the multipliers are the ones in the workbook's own
 * formulas (rows 4, 5 and 8 carry formulas; the rest are pasted values).
 *
 * **Every commission is a percentage of `PASS`, not of `FYP`.** They sit next
 * to each other on the sheet and are nearly equal — 300,000 against 299,900 on
 * the first row — which is exactly why guessing would have looked right and
 * been wrong on every row where a policy passed for less than it was proposed
 * at (row 10: 260,000 proposed, 253,019 passed).
 *
 * **The 8% tax is folded into the multiplier**, which is why the numbers look
 * odd until you factor them:
 *
 * | sheet column | rate | multiplier |
 * |---|---|---|
 * | `30% - TAX8%` | 30% less 8% tax | `0.30 × 0.92 = 0.276` |
 * | `10%-TAX 8%` | 10% less 8% tax | `0.10 × 0.92 = 0.092` |
 * | `QUARTER COMMISSION 2.5%` | 2.5% less 8% | `0.025 × 0.92 = 0.023` |
 * | `DEC COMMISION 7.5%` | 7.5% less 8% | `0.075 × 0.92 = 0.069` |
 *
 * Then `REMAINING = 30% + 10% − DISCOUNT` and `NET = REMAINING + QUARTER + DEC`.
 *
 * Dependency-free so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

/** 8% withholding, applied to every rate below. */
export const STATELIFE_TAX_RATE = 0.08;

/** The four commission rates, before tax. */
export const STATELIFE_RATES = {
  first: 0.30,
  second: 0.10,
  quarter: 0.025,
  december: 0.075,
} as const;

/** A rate with the tax taken off — what the sheet actually multiplies by. */
export function afterTax(rate: number): number {
  return Math.round(rate * (1 - STATELIFE_TAX_RATE) * 1e6) / 1e6;
}

/** The typed columns of one policy row. */
export interface StateLifeInput {
  /** First-year premium, column D. Recorded, but never the commission base. */
  fyp: number;
  /** **The commission base**, column E. */
  pass: number;
  /** Column O, typed — what was given back to the client. */
  discount: number;
}

/** Everything the sheet derives from those three. */
export interface StateLifeCommission {
  /** `PASS × 0.276` — column M. */
  firstCommission: number;
  /** `PASS × 0.092` — column N. */
  secondCommission: number;
  discount: number;
  /** `M + N − O` — column P. May be negative; the sheet has such rows. */
  remainingCommission: number;
  /** `PASS × 0.023` — column Q. */
  quarterCommission: number;
  /** `PASS × 0.069` — column R. */
  decemberCommission: number;
  /** `P + Q + R` — column S. What the business is owed on this policy. */
  netCommission: number;
}

function money(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * One row's commission, exactly as the sheet computes it.
 *
 * `remainingCommission` is **not** clamped at zero: row 15 of the source is
 * −2,592, where a 14,000 discount exceeded the commission earned. Forcing it
 * positive would quietly turn a loss into a break-even and the sheet's total
 * would stop matching.
 */
export function stateLifeCommission(input: Partial<StateLifeInput>): StateLifeCommission {
  const pass = Math.max(0, money(input.pass));
  const discount = Math.max(0, money(input.discount));

  const firstCommission = round(pass * afterTax(STATELIFE_RATES.first));
  const secondCommission = round(pass * afterTax(STATELIFE_RATES.second));
  const quarterCommission = round(pass * afterTax(STATELIFE_RATES.quarter));
  const decemberCommission = round(pass * afterTax(STATELIFE_RATES.december));
  const remainingCommission = round(firstCommission + secondCommission - discount);

  return {
    firstCommission,
    secondCommission,
    discount,
    remainingCommission,
    quarterCommission,
    decemberCommission,
    netCommission: round(remainingCommission + quarterCommission + decemberCommission),
  };
}

/** The sheet's own column headings, in order, for the table and the CSV. */
export const STATELIFE_COLUMNS = [
  'Sr', 'Proposal No', 'Name', 'FYP', 'PASS', 'SR Code', 'Date', 'Paid Amount',
  'Paid Date', 'Policy Number', 'Description', 'Sr Name', '30% - Tax 8%',
  '10% - Tax 8%', 'Discount', 'Remaining Commission', 'Quarter Commission 2.5%',
  'Dec Commission 7.5%', 'Net Commission', 'Income Note',
] as const;

/** A stored policy row. The typed half; the rest is derived on read. */
export interface StateLifePolicy extends StateLifeInput {
  id: string;
  proposalNo: string;
  name: string;
  srCode: string | null;
  /** `YYYY-MM-DD` Karachi. The sheet mixes text dates and Excel serials. */
  dayKey: string | null;
  paidAmount: number;
  paidDayKey: string | null;
  policyNumber: string | null;
  /** Free text, as on the sheet: "PAYMENT CLEARED", "5K PENDING", … */
  description: string | null;
  /** The salesperson — "Sr Name" on the sheet. */
  srName: string | null;
  /** Column T: which month's income this belongs to. */
  incomeNote: string | null;
}

/** Column totals, the sheet's own summary row. */
export function stateLifeTotals(rows: Array<StateLifeInput & { paidAmount?: number }>) {
  const totals = {
    fyp: 0, pass: 0, paidAmount: 0, firstCommission: 0, secondCommission: 0,
    discount: 0, remainingCommission: 0, quarterCommission: 0,
    decemberCommission: 0, netCommission: 0,
  };
  for (const row of rows) {
    const c = stateLifeCommission(row);
    totals.fyp += money(row.fyp);
    totals.pass += money(row.pass);
    totals.paidAmount += money(row.paidAmount);
    totals.firstCommission += c.firstCommission;
    totals.secondCommission += c.secondCommission;
    totals.discount += c.discount;
    totals.remainingCommission += c.remainingCommission;
    totals.quarterCommission += c.quarterCommission;
    totals.decemberCommission += c.decemberCommission;
    totals.netCommission += c.netCommission;
  }
  for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] = round(totals[k]);
  return totals;
}
