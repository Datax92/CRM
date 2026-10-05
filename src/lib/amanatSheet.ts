/**
 * Amanat (Trust & Safekeeping Sheet) — what trust money arrived, what was spent/disbursed, and what remains.
 *
 * An Amanat record represents either:
 * - `RECEIVED`: Trust money given by a party/person (held in an account or safekeeping).
 * - `EXPENSE`: An expense or disbursement paid against the Amanat, payable from any account.
 */

export type AmanatType = 'RECEIVED' | 'EXPENSE';

/**
 * ## Amanat is an account
 *
 * Trust money received is **held in an account**, by default the Amanat
 * account (`AMANAT_ACCOUNT_ID`, kind `AMANAT`, made on the first receipt).
 * Because it is an account, every "Pay from…" in the CRM offers it — an office
 * expense, a salary, an investment round — and that payment lands on the
 * Amanat account's statement by itself. Nothing in those modules knows Amanat
 * exists, which is the same reason a committee needs no code of its own.
 *
 * Three figures, and they answer different questions:
 *
 * - **held on trust** = received − returned: what is still owed back;
 * - **used** = what other modules have paid out of the Amanat accounts, less
 *   anything put back (`amanatUsage`);
 * - **in hand** = held on trust − used.
 *
 * Spending Amanat on an office expense does not reduce what is owed to the
 * person who placed it, which is why *used* is its own figure rather than
 * being folded into *returned*.
 */
export const AMANAT_ACCOUNT_ID = 'amanat_main';
export const AMANAT_ACCOUNT_NAME = 'Amanat';

/** The one ledger row an Amanat receipt posts. Deterministic, so an edit rewrites it in place. */
export const amanatReceiptLegId = (entryId: string): string => `amanat_${entryId}_in`;

/** A ledger row as these functions need it — the client's and the server's both fit. */
export interface AmanatLedgerRow {
  id: string;
  accountId: string;
  direction: 'IN' | 'OUT';
  amount: number;
  status?: string;
  sourceModule?: string;
  sourceId?: string | null;
  reversalOf?: string | null;
  reversedBy?: string | null;
}

const cents = (value: number): number => Math.round(value * 100) / 100;

/**
 * The rows of a receipt that are really holding money: posted, incoming, and
 * not one half of a reversal pair (those two cancel and are history).
 */
export function liveReceiptLegs<T extends AmanatLedgerRow>(rows: readonly T[]): T[] {
  return rows.filter(
    (row) =>
      row.direction === 'IN' &&
      (row.status ?? 'POSTED') === 'POSTED' &&
      !row.reversalOf &&
      !row.reversedBy
  );
}

export interface ReceiptLegPlan {
  /** Rows to delete: every live leg that is not the one being rewritten. */
  removeIds: string[];
  /** The leg to write at `amanatReceiptLegId`, or null when it is held in no account. */
  write: { id: string; accountId: string; amount: number } | null;
  /** Account → how far its balance moves. Zero movements are left out. */
  deltas: Map<string, number>;
}

/**
 * What saving a receipt does to the ledger, from **what is actually posted**
 * rather than from the entry's stored account — an entry can say one thing
 * while its row sits somewhere else (one live entry did), and moving balances
 * by the stored field would then correct the wrong account.
 */
export function planReceiptLeg(
  entryId: string,
  posted: readonly AmanatLedgerRow[],
  desired: { accountId: string | null; amount: number }
): ReceiptLegPlan {
  const legId = amanatReceiptLegId(entryId);
  const live = liveReceiptLegs(posted);
  const deltas = new Map<string, number>();
  const move = (accountId: string, by: number) =>
    deltas.set(accountId, cents((deltas.get(accountId) ?? 0) + by));

  for (const leg of live) move(leg.accountId, -leg.amount);

  const write =
    desired.accountId && desired.amount > 0
      ? { id: legId, accountId: desired.accountId, amount: cents(desired.amount) }
      : null;
  if (write) move(write.accountId, write.amount);

  for (const [accountId, by] of deltas) if (by === 0) deltas.delete(accountId);

  return {
    removeIds: live.filter((leg) => !(write && leg.id === legId)).map((leg) => leg.id),
    write,
    deltas,
  };
}

export interface AmanatUsage<T> {
  /** Paid out of the Amanat accounts by other modules, less what was put back. */
  used: number;
  /** Those movements, in the order given. */
  lines: T[];
}

/**
 * What the rest of the CRM has done with the Amanat accounts: an office
 * expense paid from one, a salary, a transfer out — and a transfer back in,
 * which takes the figure down again. Amanat's own rows (the receipts, and
 * money returned to the person) are left out; the entries already count them.
 */
export function amanatUsage<T extends AmanatLedgerRow>(
  amanatAccountIds: ReadonlySet<string>,
  rows: readonly T[]
): AmanatUsage<T> {
  let used = 0;
  const lines: T[] = [];
  for (const row of rows) {
    if (!amanatAccountIds.has(row.accountId)) continue;
    if ((row.status ?? 'POSTED') !== 'POSTED') continue;
    if (row.sourceModule === 'AMANAT') continue;
    used += row.direction === 'OUT' ? row.amount : -row.amount;
    lines.push(row);
  }
  return { used: cents(used), lines };
}

/** Where a receipt is held: the ledger's answer first, the entry's stored one as the fallback. */
export function heldInAccountId(
  entry: Pick<AmanatEntry, 'id' | 'depositAccountId'>,
  rows: readonly AmanatLedgerRow[]
): string | null {
  const leg = liveReceiptLegs(rows).find((row) => row.sourceModule === 'AMANAT' && row.sourceId === entry.id);
  return leg?.accountId ?? entry.depositAccountId ?? null;
}

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
  const history: AmanatHistoryLeg[] = historyRaw.map((h: Record<string, unknown> | null) => ({
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
