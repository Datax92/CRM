/**
 * Amanat (Trust & Safekeeping Sheet) — what trust money arrived, what was spent/disbursed, and what remains.
 *
 * An Amanat record represents either:
 * - `RECEIVED`: Trust money given by a party/person (held in an account or safekeeping).
 * - `EXPENSE`: An expense or disbursement paid against the Amanat, payable from any account.
 */

export type AmanatType = 'RECEIVED' | 'EXPENSE';

export interface AmanatHistoryLeg {
  amount: number;
  accountId: string;
  accountName?: string;
  dayKey: string;
  note?: string | null;
  at: string;
}

export interface AmanatEntry {
  id: string;
  type: AmanatType;
  /** Name of the party/person who placed the Amanat, or for whom the expense is incurred */
  party: string;
  /** Title or description of the entry */
  title: string;
  /** Total obligation / received amount */
  amount: number;
  /** Amount settled or paid so far */
  paidAmount: number;
  /** Date of the entry: YYYY-MM-DD */
  dayKey: string;
  /** Optional purpose/category (e.g. "Safekeeping", "Property Deal", "Partner Fund") */
  purpose: string | null;
  /** Optional additional notes */
  notes: string | null;
  /** For RECEIVED: the account it was deposited into (if any), or null for cash/offline */
  depositAccountId?: string | null;
  depositAccountName?: string | null;
  /** For EXPENSE: history of payment legs through accounts */
  history: AmanatHistoryLeg[];
  createdAt?: string;
}

export type AmanatPaymentState = 'UNPAID' | 'PART' | 'PAID';

export function amanatPaymentState(entry: AmanatEntry): AmanatPaymentState {
  if (entry.amount <= 0 || entry.paidAmount >= entry.amount) return 'PAID';
  if (entry.paidAmount > 0) return 'PART';
  return 'UNPAID';
}

export function pendingOfAmanat(entry: AmanatEntry): number {
  return Math.max(0, entry.amount - entry.paidAmount);
}

export interface AmanatTotals {
  totalReceived: number;
  totalExpenses: number;
  totalPaid: number;
  pendingExpenses: number;
  trustBalance: number;
  pendingCount: number;
  totalCount: number;
}

export function readAmanatEntry(raw: Record<string, unknown>): AmanatEntry {
  const num = (v: unknown) => (typeof v === 'number' && !isNaN(v) ? v : Number(v) || 0);
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const historyRaw = Array.isArray(raw.history) ? raw.history : [];
  const history: AmanatHistoryLeg[] = historyRaw.map((h: any) => ({
    amount: num(h?.amount),
    accountId: String(h?.accountId ?? ''),
    accountName: text(h?.accountName) ?? undefined,
    dayKey: String(h?.dayKey ?? ''),
    note: text(h?.note),
    at: String(h?.at ?? ''),
  }));

  const type: AmanatType = raw.type === 'EXPENSE' ? 'EXPENSE' : 'RECEIVED';
  return {
    id: String(raw.id ?? ''),
    type,
    party: text(raw.party) || 'Unnamed Party',
    title: text(raw.title) || (type === 'RECEIVED' ? 'Amanat Received' : 'Amanat Expense'),
    amount: Math.max(0, num(raw.amount)),
    paidAmount: Math.max(0, num(raw.paidAmount)),
    dayKey: text(raw.dayKey) || '1970-01-01',
    purpose: text(raw.purpose),
    notes: text(raw.notes) || text(raw.description),
    depositAccountId: text(raw.depositAccountId),
    depositAccountName: text(raw.depositAccountName),
    history,
    createdAt: text(raw.createdAt) ?? undefined,
  };
}

export function calculateAmanatTotals(entries: readonly AmanatEntry[]): AmanatTotals {
  let totalReceived = 0;
  let totalExpenses = 0;
  let totalPaid = 0;
  let pendingCount = 0;

  for (const e of entries) {
    if (e.type === 'RECEIVED') {
      totalReceived += e.amount;
    } else {
      totalExpenses += e.amount;
      totalPaid += e.paidAmount;
      if (e.amount > e.paidAmount) {
        pendingCount += 1;
      }
    }
  }

  const pendingExpenses = Math.max(0, totalExpenses - totalPaid);
  const trustBalance = totalReceived - totalPaid;

  return {
    totalReceived,
    totalExpenses,
    totalPaid,
    pendingExpenses,
    trustBalance,
    pendingCount,
    totalCount: entries.length,
  };
}
