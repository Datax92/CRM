/**
 * Receivables and Payables — who owes the business, and whom it owes.
 *
 * Transcribed from `MAHZIYAR DATA FOR CRM.xlsx`:
 *
 * ```
 * RECEIEVEABLES  DATE | PENDING AMOUNT | CUSTOMER NAME | AMOUNT RECEIVED | AMOUNT PENDING
 *                (two blocks: "OFFICIAL / UNOFFICIAL" and "OFFICIAL / REGULAR")
 * PAYABLES       DATE | NAME | PENDING AMOUNT | RETURN DATE | BORROW PURPOSE | AMOUNT GIVEN | AMOUNT PENDING
 * ```
 *
 * In plain words:
 *
 * - a **receivable** is money somebody owes *us* — a customer who has not paid
 *   in full, a staff member who took an advance. `PENDING AMOUNT` is what they
 *   owed, `AMOUNT RECEIVED` is what has come back, `AMOUNT PENDING` is the rest.
 * - a **payable** is money *we* owe — borrowed from somebody, for a purpose, to
 *   be returned by a date. `AMOUNT GIVEN` is what has been paid back.
 *
 * **Just a sheet, by the owner's choice**: recording or settling one moves no
 * account. `AMOUNT PENDING` is never typed — it is `amount − settled`, derived
 * on read, so it cannot disagree with the two figures it comes from.
 *
 * The blocks ("Official / Unofficial", "Official / Regular") are **groups**,
 * named in a list the owner can extend, rather than two hardcoded tables.
 *
 * Dependency-free so the raw `--experimental-strip-types` test loader runs it.
 */

export const LEDGER_SIDES = ['RECEIVABLE', 'PAYABLE'] as const;
export type LedgerSide = (typeof LEDGER_SIDES)[number];

export const DEFAULT_RECEIVABLE_GROUPS = ['Official / Unofficial', 'Official / Regular'];
export const DEFAULT_PAYABLE_GROUPS = ['Official / Unofficial'];

export interface SheetEntry {
  id: string;
  side: LedgerSide;
  group: string;
  /** `DATE`. */
  dayKey: string;
  /** Customer or person. */
  name: string;
  /** `PENDING AMOUNT` as the sheet heads it — what was owed at the start. */
  amount: number;
  /** `AMOUNT RECEIVED` (receivable) or `AMOUNT GIVEN` (payable). */
  settled: number;
  /** Payables: `RETURN DATE`. */
  returnDayKey: string | null;
  /** Payables: `BORROW PURPOSE`. Receivables: what it was for. */
  purpose: string | null;
  description: string | null;
}

export type EntryState = 'OPEN' | 'PART' | 'SETTLED' | 'OVERDUE';

export const ENTRY_STATE_LABELS: Record<EntryState, string> = {
  OPEN: 'Pending',
  PART: 'Part settled',
  SETTLED: 'Settled',
  OVERDUE: 'Overdue',
};

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

/** `AMOUNT PENDING`. Never negative: settling more than was owed reads as settled. */
export function pendingOf(entry: Pick<SheetEntry, 'amount' | 'settled'>): number {
  return Math.max(0, round((Number(entry.amount) || 0) - (Number(entry.settled) || 0)));
}

/** Where an entry stands. A payable past its return date and not settled is overdue. */
export function entryState(entry: Pick<SheetEntry, 'amount' | 'settled' | 'returnDayKey' | 'side'>, today: string): EntryState {
  const pending = pendingOf(entry);
  if (pending <= 0 && (Number(entry.amount) || 0) > 0) return 'SETTLED';
  if (entry.side === 'PAYABLE' && entry.returnDayKey && entry.returnDayKey < today) return 'OVERDUE';
  return (Number(entry.settled) || 0) > 0 ? 'PART' : 'OPEN';
}

export interface SheetTotals {
  amount: number;
  settled: number;
  pending: number;
  count: number;
}

/** The sheet's TOTAL row. */
export function sheetTotals(entries: readonly Pick<SheetEntry, 'amount' | 'settled'>[]): SheetTotals {
  let amount = 0;
  let settled = 0;
  let pending = 0;
  for (const entry of entries) {
    amount += Number(entry.amount) || 0;
    settled += Number(entry.settled) || 0;
    pending += pendingOf(entry);
  }
  return { amount: round(amount), settled: round(settled), pending: round(pending), count: entries.length };
}

/** Groups as saved: trimmed, de-duplicated case-insensitively, blanks dropped. */
export function normalizeGroups(input: readonly unknown[], fallback: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const label = String(raw ?? '').trim().slice(0, 50);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
  }
  return out.length > 0 ? out : [...fallback];
}

export function readSheetEntry(raw: Record<string, unknown>): SheetEntry {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const side: LedgerSide = raw.side === 'PAYABLE' ? 'PAYABLE' : 'RECEIVABLE';
  return {
    id: String(raw.id ?? ''),
    side,
    group: text(raw.group) ?? (side === 'PAYABLE' ? DEFAULT_PAYABLE_GROUPS[0] : DEFAULT_RECEIVABLE_GROUPS[0]),
    dayKey: typeof raw.dayKey === 'string' ? raw.dayKey : '',
    name: text(raw.name) ?? 'Unnamed',
    amount: round(Number(raw.amount) || 0),
    settled: round(Number(raw.settled) || 0),
    returnDayKey: text(raw.returnDayKey),
    purpose: text(raw.purpose),
    description: text(raw.description),
  };
}
