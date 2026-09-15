/**
 * Investment with X — money put to work with a partner, a round at a time.
 *
 * Transcribed from the owner's `MAYSAM PERSONAL.xlsx`, tab **INVESTMENT WITH
 * X** (and the empty `INVESTMENT WITH XYZ` template in `MAHZIYAR DATA FOR
 * CRM.xlsx`), whose columns are the specification:
 *
 * ```
 * AMOUNT | DATE | RETURN DATE | PROFIT | GROSS PROFIT |
 * AARYJ | INVESTOR | CC | ALI | MISC | NET PROFIT | DESCRIPTION
 * ```
 *
 * Each row is one **round**: an amount handed to the partner on a date, due
 * back on a return date with a profit. The same capital goes round again —
 * 330,000 twice, 350,000 three times — which is why a round and not an account
 * is the unit.
 *
 * The rules, read off the rows rather than assumed:
 *
 * - **NET PROFIT = PROFIT − every share column.** Sixteen of the eighteen rows
 *   in the photographed sheet reproduce exactly that way, including the ones
 *   where GROSS PROFIT differs from PROFIT (18,500 profit, 3,500 to the
 *   investor → 15,000 net, while gross reads 24,500). The last two rows were
 *   still being filled in. A book can be switched to take net from GROSS
 *   PROFIT instead (`netBasis`) — the owner asked for everything to be
 *   editable, and this is the one rule a different partner might keep
 *   differently.
 * - **The share columns are named per book, and editable.** AARYJ, INVESTOR,
 *   CC, ALI and MISC are this sheet's people; the template has no ALI. A column
 *   is a key and a label, so renaming "ALI" to "MAISAM ALI" rewrites nothing.
 * - **Only the net profit touches an account** (the owner's choice). The amount
 *   and the shares are facts on the sheet; the net lands in the book's income
 *   account, and a round that lost money takes its loss back out.
 *
 * Dependency-free so the raw `--experimental-strip-types` test loader runs it.
 */

/** A share column: who or what takes a cut before the net. */
export interface ShareColumn {
  /** Generated, permanent — rounds store amounts against it. */
  key: string;
  label: string;
}

export const NET_BASES = ['PROFIT', 'GROSS'] as const;
export type NetBasis = (typeof NET_BASES)[number];

export const NET_BASIS_LABELS: Record<NetBasis, string> = {
  PROFIT: 'Profit',
  GROSS: 'Gross profit',
};

/** The sheet's own five, in its order. */
export const DEFAULT_SHARE_COLUMNS: ShareColumn[] = [
  { key: 'aaryj', label: 'AARYJ' },
  { key: 'investor', label: 'INVESTOR' },
  { key: 'cc', label: 'CC' },
  { key: 'ali', label: 'ALI' },
  { key: 'misc', label: 'MISC' },
];

export const MAX_SHARE_COLUMNS = 12;

export interface RoundInput {
  amount: number;
  profit: number;
  grossProfit: number;
  /** Column key → rupees. Keys not in the book are ignored. */
  shares: Record<string, number>;
}

export interface RoundFigures {
  amount: number;
  profit: number;
  grossProfit: number;
  shares: Record<string, number>;
  totalShares: number;
  /** The figure the shares come off — profit or gross, per the book. */
  base: number;
  netProfit: number;
}

export function roundMoney(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

/** A typed amount: commas, spaces and a leading `Rs` are allowed; junk is 0. */
export function parseAmount(input: unknown): number {
  if (typeof input === 'number') return roundMoney(input);
  const cleaned = String(input ?? '')
    .replace(/rs\.?/i, '')
    .replace(/[,\s]/g, '');
  if (!cleaned || cleaned === '-') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? roundMoney(n) : 0;
}

export function normalizeNetBasis(raw: unknown): NetBasis {
  return raw === 'GROSS' ? 'GROSS' : 'PROFIT';
}

/** One round's figures. A loss is a real outcome and is never clamped. */
export function calculateRound(
  input: RoundInput,
  columns: readonly ShareColumn[],
  netBasis: NetBasis = 'PROFIT'
): RoundFigures {
  const shares: Record<string, number> = {};
  let totalShares = 0;
  for (const column of columns) {
    const value = parseAmount(input.shares?.[column.key]);
    shares[column.key] = value;
    totalShares += value;
  }
  totalShares = roundMoney(totalShares);
  const profit = parseAmount(input.profit);
  const grossProfit = parseAmount(input.grossProfit);
  const base = netBasis === 'GROSS' ? grossProfit : profit;
  return {
    amount: parseAmount(input.amount),
    profit,
    grossProfit,
    shares,
    totalShares,
    base,
    netProfit: roundMoney(base - totalShares),
  };
}

export interface BookTotals {
  amount: number;
  profit: number;
  grossProfit: number;
  shares: Record<string, number>;
  totalShares: number;
  netProfit: number;
  rounds: number;
}

/** The sheet's totals row. */
export function bookTotals(rounds: readonly RoundFigures[], columns: readonly ShareColumn[]): BookTotals {
  const totals: BookTotals = {
    amount: 0,
    profit: 0,
    grossProfit: 0,
    shares: Object.fromEntries(columns.map((column) => [column.key, 0])),
    totalShares: 0,
    netProfit: 0,
    rounds: rounds.length,
  };
  for (const round of rounds) {
    totals.amount += round.amount;
    totals.profit += round.profit;
    totals.grossProfit += round.grossProfit;
    totals.totalShares += round.totalShares;
    totals.netProfit += round.netProfit;
    for (const column of columns) totals.shares[column.key] += round.shares[column.key] ?? 0;
  }
  totals.amount = roundMoney(totals.amount);
  totals.profit = roundMoney(totals.profit);
  totals.grossProfit = roundMoney(totals.grossProfit);
  totals.totalShares = roundMoney(totals.totalShares);
  totals.netProfit = roundMoney(totals.netProfit);
  for (const column of columns) totals.shares[column.key] = roundMoney(totals.shares[column.key]);
  return totals;
}

/**
 * A key for a new column, from its label, unique within the book.
 * `MAISAM ALI` → `maisam_ali`, then `maisam_ali_2`.
 */
export function shareKeyFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'share';
  let key = base;
  let n = 2;
  while (used.has(key)) key = `${base}_${n++}`;
  return key;
}

/**
 * The columns a book is saved with: blank labels dropped, existing keys kept,
 * new ones generated. Keys are permanent so renaming never orphans an amount.
 */
export function normalizeShareColumns(input: ReadonlyArray<{ key?: string | null; label?: string | null }>): ShareColumn[] {
  const out: ShareColumn[] = [];
  const taken = new Set<string>();
  for (const raw of input) {
    const label = (raw.label ?? '').trim().slice(0, 40);
    if (!label) continue;
    const key = raw.key && /^[a-z0-9_]+$/.test(raw.key) && !taken.has(raw.key) ? raw.key : shareKeyFor(label, taken);
    taken.add(key);
    out.push({ key, label });
    if (out.length >= MAX_SHARE_COLUMNS) break;
  }
  return out;
}

export function readShareColumns(raw: unknown): ShareColumn[] {
  if (!Array.isArray(raw)) return DEFAULT_SHARE_COLUMNS;
  const columns = normalizeShareColumns(raw as Array<{ key?: string; label?: string }>);
  return columns;
}

/** The account a book's net profit lands in. Fixed, so a rename never makes a second one. */
export function investmentAccountId(bookId: string): string {
  return `invx_${bookId}`;
}
