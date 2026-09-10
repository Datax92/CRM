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

/* -------------------------------------------------------------------------- */
/* Rates are editable, and every policy remembers its own                       */
/* -------------------------------------------------------------------------- */

/**
 * The five numbers a policy's commission is built from.
 *
 * They were constants transcribed from the workbook, and the owner asked for
 * them to be editable. **The important part of granting that is not the form,
 * it is the freezing**: a policy stores the rates it was written under, so
 * changing the rate next month cannot restate what an existing policy earned —
 * or what somebody has already been paid on it. Exactly the rule
 * `lib/dealAmounts` follows for `cutBase` and `payoutSource`.
 *
 * A policy written before rates were editable has none stored, and falls back
 * to the workbook's own figures — so every existing row keeps the numbers it
 * has always shown and there is no migration to run.
 */
export interface StateLifeRates {
  /** The first-year slab, before tax. `0.30` is the workbook's. */
  first: number;
  second: number;
  quarter: number;
  december: number;
  /** Withholding, taken off every slab above. `0.08` is the workbook's. */
  tax: number;
}

export const DEFAULT_STATELIFE_RATES: StateLifeRates = {
  first: STATELIFE_RATES.first,
  second: STATELIFE_RATES.second,
  quarter: STATELIFE_RATES.quarter,
  december: STATELIFE_RATES.december,
  tax: STATELIFE_TAX_RATE,
};

export const RATE_LABELS: Record<keyof StateLifeRates, string> = {
  first: 'First year',
  second: 'Second',
  quarter: 'Quarter',
  december: 'December',
  tax: 'Withholding tax',
};

/**
 * A stored or typed rate set, made safe.
 *
 * **A missing field falls back to the workbook's figure, one field at a time**
 * — not to the whole default set. A policy that stored only a corrected tax
 * rate must keep its four commission rates, and replacing the lot because one
 * was absent would silently rewrite the other four.
 *
 * Every rate is clamped to 0–1 and the tax below 1, because a tax of 1 or more
 * makes every commission zero or negative and no arithmetic downstream would
 * say so — it would just quietly report a book earning nothing.
 */
export function normalizeRates(raw: unknown): StateLifeRates {
  const source = (raw ?? {}) as Partial<Record<keyof StateLifeRates, unknown>>;
  const read = (key: keyof StateLifeRates): number => {
    const value = typeof source[key] === 'number' ? (source[key] as number) : Number(source[key]);
    if (!Number.isFinite(value) || value < 0) return DEFAULT_STATELIFE_RATES[key];
    const ceiling = key === 'tax' ? 0.999999 : 1;
    return Math.round(Math.min(value, ceiling) * 1e6) / 1e6;
  };
  return {
    first: read('first'),
    second: read('second'),
    quarter: read('quarter'),
    december: read('december'),
    tax: read('tax'),
  };
}

/** `0.025` ⇄ `2.5` — the form types percentages, the arithmetic uses fractions. */
export function toPercent(rate: number): number {
  return Math.round(rate * 1e6) / 1e4;
}

export function fromPercent(percent: number): number {
  const value = Number(percent);
  return Number.isFinite(value) ? Math.round(value * 1e4) / 1e6 : 0;
}

/**
 * A rate with the tax taken off — what the sheet actually multiplies by.
 *
 * With the workbook's own numbers this returns exactly the multipliers in its
 * formulas: `0.30 → 0.276`, `0.10 → 0.092`, `0.025 → 0.023`, `0.075 → 0.069`.
 */
export function afterTax(rate: number, tax: number = STATELIFE_TAX_RATE): number {
  return Math.round(rate * (1 - tax) * 1e6) / 1e6;
}

/** The typed columns of one policy row. */
export interface StateLifeInput {
  /** First-year premium, column D. Recorded, but never the commission base. */
  fyp: number;
  /** **The commission base**, column E. */
  pass: number;
  /** Column O, typed — what was given back to the client. */
  discount: number;
  /**
   * The rates this policy was written under. Absent on every policy recorded
   * before they became editable, which reads as the workbook's own figures.
   */
  rates?: Partial<StateLifeRates> | null;
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
export function stateLifeCommission(
  input: Partial<StateLifeInput>,
  /** The policy's own rates. Absent means the workbook's, unchanged. */
  rates?: Partial<StateLifeRates> | null
): StateLifeCommission {
  const r = normalizeRates(rates ?? input.rates);
  const pass = Math.max(0, money(input.pass));
  const discount = Math.max(0, money(input.discount));

  const firstCommission = round(pass * afterTax(r.first, r.tax));
  const secondCommission = round(pass * afterTax(r.second, r.tax));
  const quarterCommission = round(pass * afterTax(r.quarter, r.tax));
  const decemberCommission = round(pass * afterTax(r.december, r.tax));
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

/* -------------------------------------------------------------------------- */
/* Slabs — the commission does not arrive in one go                            */
/* -------------------------------------------------------------------------- */

/**
 * **The commission on a policy arrives in three slabs, months apart**, and the
 * sheet says so in its own words. Column T on the workbook reads *"42.5%
 * JANUARY INCOME"* on one row and *"40% FEB + 2.5% JAN INCOM"* on the next —
 * so 42.5% is not a rate, it is **40% and 2.5% that happened to land in the
 * same month**, and the row below had them land in different ones.
 *
 * That is why the slabs are 40 / 2.5 / 7.5 and not 30 / 10 / 2.5 / 7.5: the
 * sheet never separates the 30 and the 10. They are one payment, and the
 * discount comes off that payment — which is exactly what column P
 * (`REMAINING COMMISION = M + N − O`) is. So:
 *
 * | slab | the sheet's column | what it is |
 * |---|---|---|
 * | `FORTY` | **P** — Remaining Commission | 30% + 10%, less what was given back |
 * | `QUARTER` | Q | the 2.5% quarterly |
 * | `DECEMBER` | R | the 7.5% December |
 *
 * and the three sum to **S, Net Commission**, which a test asserts on the
 * workbook's own first row (125,354).
 *
 * **`FORTY` is the answer to "money should be paid from remaining
 * commission".** The discount is money handed back to the client; it never
 * arrives, so it is not money anything can be paid out of. The pot is P, not
 * M + N.
 */
export const STATELIFE_SLABS = ['FORTY', 'QUARTER', 'DECEMBER'] as const;
export type StateLifeSlab = (typeof STATELIFE_SLABS)[number];

/**
 * The slab names, at the workbook's own rates.
 *
 * **The names are computed from the rates wherever a policy is on screen**
 * (`slabMeta`), because "40%" is not a name, it is `first + second` — a book
 * written at 25% and 10% must not have its slabs labelled 40%. This constant is
 * the fallback for the places that have no policy in hand.
 */
export const STATELIFE_SLAB_META: Record<
  StateLifeSlab,
  { label: string; short: string; hint: string }
> = {
  FORTY: {
    label: 'Remaining commission (40%)',
    short: '40%',
    hint: '30% + 10%, less the discount given back',
  },
  QUARTER: {
    label: 'Quarter commission (2.5%)',
    short: '2.5%',
    hint: 'The quarterly slab',
  },
  DECEMBER: {
    label: 'December commission (7.5%)',
    short: '7.5%',
    hint: 'Paid out in December',
  },
};

/** The slab names for one rate set — `40%` is `first + second`, not a constant. */
export function slabMeta(
  rates?: Partial<StateLifeRates> | null
): Record<StateLifeSlab, { label: string; short: string; hint: string }> {
  const r = normalizeRates(rates);
  const pct = (value: number) => `${toPercent(value)}%`;
  const combined = pct(Math.round((r.first + r.second) * 1e6) / 1e6);
  return {
    FORTY: {
      label: `Remaining commission (${combined})`,
      short: combined,
      hint: `${pct(r.first)} + ${pct(r.second)}, less the discount given back`,
    },
    QUARTER: {
      label: `Quarter commission (${pct(r.quarter)})`,
      short: pct(r.quarter),
      hint: 'The quarterly slab',
    },
    DECEMBER: {
      label: `December commission (${pct(r.december)})`,
      short: pct(r.december),
      hint: 'Paid out in December',
    },
  };
}

export interface SlabAmount {
  slab: StateLifeSlab;
  label: string;
  short: string;
  hint: string;
  /** What this slab is worth. **May be negative** for `FORTY` — see below. */
  amount: number;
}

/**
 * The three slabs of one policy, with what each is worth.
 *
 * `FORTY` is **not clamped at zero**: row 15 of the workbook is −2,592, where a
 * 14,000 discount exceeded the commission earned. Forcing it positive would
 * turn a loss into a break-even and the sheet's total would stop matching.
 * Receiving a negative slab is refused elsewhere — you cannot be paid it — but
 * the figure is reported as it is.
 */
export function stateLifeSlabs(
  input: Partial<StateLifeInput>,
  rates?: Partial<StateLifeRates> | null
): SlabAmount[] {
  const c = stateLifeCommission(input, rates);
  const amounts: Record<StateLifeSlab, number> = {
    FORTY: c.remainingCommission,
    QUARTER: c.quarterCommission,
    DECEMBER: c.decemberCommission,
  };
  const meta = slabMeta(rates ?? input.rates);
  return STATELIFE_SLABS.map((slab) => ({
    slab,
    ...meta[slab],
    amount: amounts[slab],
  }));
}

/** What a policy records about one slab once the money has come in. */
export interface SlabReceipt {
  /** What actually arrived. Normally the slab amount, but the sheet's own
   *  descriptions ("5K PENDING", "22K PENDING") show part payments happen. */
  amount: number;
  /** `YYYY-MM-DD` Karachi — the day it landed. */
  dayKey: string;
  /** Which account it landed in, so the money is findable afterwards. */
  accountId: string;
  accountName: string | null;
}

export type SlabReceipts = Partial<Record<StateLifeSlab, SlabReceipt>>;

export interface SlabPosition {
  slabs: Array<SlabAmount & { received: SlabReceipt | null; outstanding: number }>;
  /** Everything the policy will eventually pay — column S. */
  net: number;
  /** What has actually landed. */
  received: number;
  /** Still to come. Never negative: a slab worth less than zero owes nothing. */
  outstanding: number;
}

/**
 * Where one policy stands, slab by slab.
 *
 * **A slab worth nothing or less is not outstanding.** A policy whose discount
 * swallowed the 40% is not owed a negative amount by StateLife; it is simply
 * owed nothing on that slab, and reporting −2,592 as "still to come" would make
 * every total on the screen wrong in the safe-looking direction.
 */
export function slabPosition(
  input: Partial<StateLifeInput>,
  receipts: SlabReceipts | undefined,
  rates?: Partial<StateLifeRates> | null
): SlabPosition {
  const slabs = stateLifeSlabs(input, rates).map((entry) => {
    const received = receipts?.[entry.slab] ?? null;
    const paid = received ? money(received.amount) : 0;
    return {
      ...entry,
      received,
      outstanding: round(Math.max(0, entry.amount - paid)),
    };
  });

  return {
    slabs,
    net: round(slabs.reduce((sum, entry) => sum + entry.amount, 0)),
    received: round(slabs.reduce((sum, entry) => sum + (entry.received ? money(entry.received.amount) : 0), 0)),
    outstanding: round(slabs.reduce((sum, entry) => sum + entry.outstanding, 0)),
  };
}

/**
 * The slab note the sheet writes by hand, generated.
 *
 * Column T is *"40% FEB + 2.5% JAN INCOM"* — the slabs that have landed and the
 * month each landed in. Nothing reads it; it is written so the exported sheet
 * still says what the owner's own sheet said.
 */
export function slabNote(
  receipts: SlabReceipts | undefined,
  rates?: Partial<StateLifeRates> | null
): string | null {
  const meta = slabMeta(rates);
  const parts: string[] = [];
  for (const slab of STATELIFE_SLABS) {
    const receipt = receipts?.[slab];
    if (!receipt) continue;
    parts.push(`${meta[slab].short} ${monthName(receipt.dayKey)}`);
  }
  return parts.length ? `${parts.join(' + ')} INCOME` : null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function monthName(dayKey: string): string {
  const index = Number((dayKey ?? '').slice(5, 7)) - 1;
  return MONTHS[index] ?? '';
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
  /** Which slabs have actually come in, and where the money went. */
  slabReceipts?: SlabReceipts;
}

/** Column totals, the sheet's own summary row. */
export function stateLifeTotals(
  rows: Array<Partial<StateLifeInput> & { paidAmount?: number }>
) {
  const totals = {
    fyp: 0, pass: 0, paidAmount: 0, firstCommission: 0, secondCommission: 0,
    discount: 0, remainingCommission: 0, quarterCommission: 0,
    decemberCommission: 0, netCommission: 0,
  };
  for (const row of rows) {
    // Each row at **its own** rates: a book part-written at one rate and part
    // at another must total to what its rows actually say.
    const c = stateLifeCommission(row, row.rates);
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
