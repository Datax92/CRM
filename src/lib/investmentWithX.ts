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
 * - **The net profit lands in the book's income account**, and a round that
 *   lost money takes its loss back out. The shares are facts on the sheet.
 * - **The amount comes out of an account and goes back into it** — out on the
 *   date, back on the return date (`checkRoundFunding`, below). It was a fact
 *   on the sheet only until 2026-09-16, when the owner asked where the money
 *   came from; a round saved without an account still reads that way.
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

/* -------------------------------------------------------------------------- */
/* Where a round's amount came from                                            */
/* -------------------------------------------------------------------------- */

/**
 * One account a round's AMOUNT was taken out of.
 *
 * **The money goes out and comes back** (the owner's choice, 2026-09-16). The
 * amount leaves these accounts on the round's DATE and goes back into the same
 * accounts on its RETURN DATE — the sheet's own point that "the same capital
 * goes round again": 350,000 three times is one 350,000, not 1,050,000 spent.
 * A round with no return date yet is money still out with the partner.
 *
 * The profit is a separate question and is unchanged: the net lands in the
 * book's own account.
 */
export interface FundingLine {
  accountId: string;
  amount: number;
}

export interface FundingCheck {
  /** The lines as they will be saved: blanks dropped, a lone line's amount filled in. */
  lines: FundingLine[];
  allocated: number;
  errors: string[];
  valid: boolean;
}

const rupees = new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 });

/**
 * Whether a round's funding lines account for its amount.
 *
 * - **No account at all is allowed**: the amount is then a fact on the sheet
 *   only, which is what every round saved before this existed is.
 * - **One account takes the whole amount** without anybody typing it twice.
 * - Split across several, **the lines must come to the amount exactly** —
 *   short leaves part of it from nowhere, over takes money the partner never
 *   received. Neither is trimmed to fit; the same account twice is refused.
 */
export function checkRoundFunding(
  amount: number,
  raw: ReadonlyArray<{ accountId?: string | null; amount?: unknown }>
): FundingCheck {
  const total = parseAmount(amount);
  const picked = raw
    .map((line) => ({ accountId: (line.accountId ?? '').trim(), amount: parseAmount(line.amount) }))
    .filter((line) => line.accountId);

  if (picked.length === 0) return { lines: [], allocated: 0, errors: [], valid: true };

  const lines = picked.length === 1 ? [{ accountId: picked[0].accountId, amount: total }] : picked;
  const errors: string[] = [];

  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.accountId)) {
      errors.push('The same account is listed twice. Put its whole share on one line.');
      break;
    }
    seen.add(line.accountId);
  }
  if (lines.some((line) => line.amount <= 0)) {
    errors.push('Enter how much came out of each account.');
  }

  const allocated = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  if (total > 0 && errors.length === 0) {
    if (allocated > total) {
      errors.push(`The accounts come to ${rupees.format(allocated)}, more than the ${rupees.format(total)} amount.`);
    } else if (allocated < total) {
      errors.push(
        `The accounts come to ${rupees.format(allocated)} — ${rupees.format(roundMoney(total - allocated))} of the ${rupees.format(total)} amount is not from any account.`
      );
    }
  }

  return { lines, allocated, errors, valid: errors.length === 0 };
}

/** Reads `funding` off a stored round. Anything malformed is dropped, never guessed. */
export function readFunding(raw: unknown): FundingLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((line) => {
      const entry = (line ?? {}) as { accountId?: unknown; amount?: unknown };
      return {
        accountId: typeof entry.accountId === 'string' ? entry.accountId : '',
        amount: parseAmount(entry.amount),
      };
    })
    .filter((line) => line.accountId && line.amount > 0);
}

export type FundingLegKind = 'OUT' | 'BACK';

export interface FundingLeg {
  /** Deterministic, so an edit rewrites the leg it already posted. */
  id: string;
  kind: FundingLegKind;
  accountId: string;
  direction: 'IN' | 'OUT';
  amount: number;
  dayKey: string;
}

export function fundingLegId(roundId: string, accountId: string, kind: FundingLegKind): string {
  return `invx_${roundId}_${kind === 'OUT' ? 'out' : 'back'}_${accountId}`;
}

/** Every leg id a set of lines could have posted, returned or not — what an edit must clear. */
export function possibleFundingLegIds(roundId: string, lines: readonly FundingLine[]): string[] {
  return lines.flatMap((line) => [fundingLegId(roundId, line.accountId, 'OUT'), fundingLegId(roundId, line.accountId, 'BACK')]);
}

/**
 * The movements a round's funding posts: out of each account on the date, and
 * — once there is a return date — the same amount back in on that date.
 */
export function fundingLegs(
  roundId: string,
  lines: readonly FundingLine[],
  dayKey: string,
  returnDayKey: string | null
): FundingLeg[] {
  const legs: FundingLeg[] = [];
  for (const line of lines) {
    legs.push({ id: fundingLegId(roundId, line.accountId, 'OUT'), kind: 'OUT', accountId: line.accountId, direction: 'OUT', amount: line.amount, dayKey });
    if (returnDayKey) {
      legs.push({ id: fundingLegId(roundId, line.accountId, 'BACK'), kind: 'BACK', accountId: line.accountId, direction: 'IN', amount: line.amount, dayKey: returnDayKey });
    }
  }
  return legs;
}

/**
 * How far each account's balance moves when `before` is replaced by `after`.
 *
 * `before` is what is actually posted — read back from the ledger, not from the
 * round — so a leg somebody deleted from a statement is not taken off twice.
 */
export function fundingDeltas(
  before: ReadonlyArray<Pick<FundingLeg, 'accountId' | 'direction' | 'amount'>>,
  after: ReadonlyArray<Pick<FundingLeg, 'accountId' | 'direction' | 'amount'>>
): Map<string, number> {
  const deltas = new Map<string, number>();
  const add = (leg: Pick<FundingLeg, 'accountId' | 'direction' | 'amount'>, sign: 1 | -1) => {
    const effect = leg.direction === 'IN' ? leg.amount : -leg.amount;
    deltas.set(leg.accountId, roundMoney((deltas.get(leg.accountId) ?? 0) + sign * effect));
  };
  for (const leg of before) add(leg, -1);
  for (const leg of after) add(leg, 1);
  for (const [accountId, delta] of deltas) if (delta === 0) deltas.delete(accountId);
  return deltas;
}
