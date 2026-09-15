/**
 * Mahziyar Group — what the business made, what it spent, and what is left,
 * month by month.
 *
 * Two screens read this one module, so they can never disagree:
 *
 * - **Group Expense** — one month: every income line, office and personal
 *   spending combined, anything else added by hand, and a **closing** that
 *   freezes "this much was made, this much was spent, this much remains".
 * - **Group Income** — the year: the owner's `MAHZIYAR 2026 PERFORMANCE` sheet
 *   (`MAHZIYAR DATA FOR CRM.xlsx`), whose columns are the specification —
 *   `MONTH | TOTAL INCOME | PERSONAL EXPENCE | OFFICE EXPENCE |
 *   COMMITTEE / KIST | INVESTOR | DADDY MEDIA | MISC / PLOT / TOUR |
 *   DESCRIPTION | TOTAL EXPENCE | REMAINING`.
 *
 * ## Where each figure comes from
 *
 * | column | source |
 * |---|---|
 * | Total income | **every income account, automatically** — posted ledger movements from Marketing Income, Car Sale, StateLife and Investment with X, plus manual income put into an account |
 * | Personal expense | Personal Expenses dated in the month |
 * | Office expense | approved Office Expenses dated in the month |
 * | Committee / Kist, Investor, Daddy Media, Misc… | lines added to the month by hand, one field each — **fields can be added, renamed and removed** |
 *
 * **Spending is read from the obligation records, income from the ledger.**
 * That is the ledger's own rule (`lib/ledger`): an expense is 50,000 however it
 * was funded, and income is what actually landed in an account. Reading
 * expenses from the ledger would count only what has been *paid*, and a month's
 * spending does not shrink because a bill is still unpaid.
 *
 * ## Everything is editable, and every edit is visible
 *
 * An income line can be corrected (or set to 0 to leave it out) without
 * touching the sale or the car it came from, and any cell of the performance
 * sheet can be overridden. Both are stored on the month beside the automatic
 * figure, never instead of it, so the screen can show "edited from 92,500" and
 * a reset brings the automatic value back.
 *
 * ## Closing
 *
 * Closing a month copies its figures — every income line and every total —
 * into the month's own document. A closed month shows those frozen figures from
 * then on, even if a record behind them is edited later; the screen says when
 * the live figures have moved since. Reopening is its own action.
 *
 * Dependency-free so the raw `--experimental-strip-types` test loader runs it.
 */

/* -------------------------------------------------------------------------- */
/* Fields                                                                      */
/* -------------------------------------------------------------------------- */

export type GroupFieldType = 'INCOME' | 'EXPENSE';

/** A column a person added: a kind of income or spending the modules do not record. */
export interface GroupField {
  /** Generated, permanent — month lines and overrides are stored against it. */
  key: string;
  label: string;
  type: GroupFieldType;
  /** Removed from the sheet. Its lines are kept, and it can be brought back. */
  archived?: boolean;
}

/** The three columns the modules fill. Their labels are editable; they cannot be removed. */
export const BUILTIN_COLUMNS = ['income', 'personal', 'office'] as const;
export type BuiltinColumn = (typeof BUILTIN_COLUMNS)[number];

export const DEFAULT_BUILTIN_LABELS: Record<BuiltinColumn, string> = {
  income: 'Total Income',
  personal: 'Personal Expense',
  office: 'Office Expense',
};

/** The owner's sheet's own hand-filled columns, in its order. */
export const DEFAULT_GROUP_FIELDS: GroupField[] = [
  { key: 'committee_kist', label: 'Committee / Kist', type: 'EXPENSE' },
  { key: 'investor', label: 'Investor', type: 'EXPENSE' },
  { key: 'daddy_media', label: 'Daddy Media', type: 'EXPENSE' },
  { key: 'misc', label: 'Misc / Plot / Tour', type: 'EXPENSE' },
];

export const MAX_GROUP_FIELDS = 20;

/* -------------------------------------------------------------------------- */
/* Income                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The modules whose money is income.
 *
 * Deliberately **not** "every IN movement": a transfer into Cash is not income,
 * a committee pot filling up is not income, and a reimbursement is not income.
 * These four earn; anything else that earns arrives as a manual `INCOME`
 * movement, which is counted too.
 */
export const INCOME_SOURCE_MODULES = ['MARKETING_INCOME', 'CAR_SALE', 'STATELIFE', 'INVESTMENT_WITH_X'] as const;

export const INCOME_SOURCE_LABELS: Record<string, string> = {
  MARKETING_INCOME: 'Marketing Income',
  CAR_SALE: 'Car Sale',
  STATELIFE: 'StateLife',
  INVESTMENT_WITH_X: 'Investment with X',
  MANUAL: 'Added to an account',
};

export interface LedgerRowInput {
  id: string;
  accountId: string;
  direction: 'IN' | 'OUT';
  amount: number;
  type: string;
  dayKey: string;
  sourceModule: string;
  sourceLabel?: string | null;
  note?: string | null;
  status?: string;
}

/** Whether a ledger row is income, as the group sheets count it. */
export function isIncomeMovement(txn: LedgerRowInput): boolean {
  if (txn.status && txn.status !== 'POSTED') return false;
  if ((INCOME_SOURCE_MODULES as readonly string[]).includes(txn.sourceModule)) return true;
  return txn.sourceModule === 'MANUAL' && txn.type === 'INCOME' && txn.direction === 'IN';
}

export interface IncomeEdit {
  /** What this line should count as. 0 leaves it out. */
  amount: number;
  note?: string | null;
}

export interface IncomeLine {
  /** The ledger row's id — what an edit is stored against. */
  id: string;
  label: string;
  accountId: string;
  accountName: string;
  sourceModule: string;
  dayKey: string;
  /** Signed: a car sold at a loss is a negative line. */
  auto: number;
  /** After any edit. */
  amount: number;
  edited: boolean;
  note: string | null;
}

/* -------------------------------------------------------------------------- */
/* A month                                                                     */
/* -------------------------------------------------------------------------- */

/** A line added to a month by hand — "Committee kist 50,000", "Rent received 20,000". */
export interface GroupEntry {
  id: string;
  fieldKey: string;
  amount: number;
  dayKey: string;
  note: string | null;
}

export interface GroupClosing {
  closedAt: string;
  closedByName: string | null;
  /** Every column's final value, by column key (builtins and fields). */
  columns: Record<string, number>;
  income: number;
  spent: number;
  remaining: number;
  incomeLines: Array<{ id: string; label: string; accountName: string; dayKey: string; amount: number }>;
}

export interface GroupMonthDoc {
  status: 'OPEN' | 'CLOSED';
  entries: GroupEntry[];
  incomeEdits: Record<string, IncomeEdit>;
  /** Column key → the value a person typed over the automatic one. */
  cellOverrides: Record<string, number>;
  description: string | null;
  closing: GroupClosing | null;
}

export const EMPTY_MONTH: GroupMonthDoc = {
  status: 'OPEN',
  entries: [],
  incomeEdits: {},
  cellOverrides: {},
  description: null,
  closing: null,
};

export interface ExpenseRowInput {
  id: string;
  dayKey: string;
  amount: number;
  /** Office expenses only. Pending and rejected do not count as spent. */
  status?: string | null;
}

export interface ColumnValue {
  key: string;
  label: string;
  type: GroupFieldType;
  /** What the modules or the added lines say. */
  auto: number;
  /** What is shown and counted — the override when there is one. */
  value: number;
  overridden: boolean;
  builtin: boolean;
}

export interface GroupMonthFigures {
  monthKey: string;
  incomeLines: IncomeLine[];
  columns: ColumnValue[];
  /** Total income: the income column plus every income field. */
  income: number;
  /** Office + personal + every expense field. */
  spent: number;
  remaining: number;
  officeCount: number;
  personalCount: number;
}

export function roundMoney(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** `2026-09-14` → `2026-09`. */
export function monthOfDayKey(dayKey: string): string {
  return typeof dayKey === 'string' ? dayKey.slice(0, 7) : '';
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `2026-09` → `September 2026`. */
export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const name = MONTH_NAMES[(month || 1) - 1] ?? monthKey;
  return year ? `${name} ${year}` : name;
}

/** `2026-09` → `SEPTEMBER`, as the performance sheet writes it. */
export function monthName(monthKey: string): string {
  const month = Number(monthKey.split('-')[1]);
  return MONTH_NAMES[(month || 1) - 1] ?? monthKey;
}

export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
}

/** The month before or after, as a key. */
export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** The columns in sheet order: income, the income fields, personal, office, the expense fields. */
export function columnDefinitions(
  fields: readonly GroupField[],
  labels: Partial<Record<BuiltinColumn, string>> = {}
): Array<{ key: string; label: string; type: GroupFieldType; builtin: boolean }> {
  const live = fields.filter((field) => !field.archived);
  const label = (key: BuiltinColumn) => (labels[key] ?? '').trim() || DEFAULT_BUILTIN_LABELS[key];
  return [
    { key: 'income', label: label('income'), type: 'INCOME' as const, builtin: true },
    ...live.filter((f) => f.type === 'INCOME').map((f) => ({ key: f.key, label: f.label, type: f.type, builtin: false })),
    { key: 'personal', label: label('personal'), type: 'EXPENSE' as const, builtin: true },
    { key: 'office', label: label('office'), type: 'EXPENSE' as const, builtin: true },
    ...live.filter((f) => f.type === 'EXPENSE').map((f) => ({ key: f.key, label: f.label, type: f.type, builtin: false })),
  ];
}

/**
 * One month's figures, live.
 *
 * Every screen and the closing action call this, so "made / spent / remaining"
 * is one computation. The inputs may hold more than the month — they are
 * narrowed here by `dayKey`.
 */
export function computeGroupMonth(input: {
  monthKey: string;
  transactions: readonly LedgerRowInput[];
  accountNames: ReadonlyMap<string, string>;
  officeExpenses: readonly ExpenseRowInput[];
  personalExpenses: readonly ExpenseRowInput[];
  month: GroupMonthDoc | null;
  fields: readonly GroupField[];
  labels?: Partial<Record<BuiltinColumn, string>>;
}): GroupMonthFigures {
  const { monthKey } = input;
  const month = input.month ?? EMPTY_MONTH;
  const inMonth = (dayKey: string) => monthOfDayKey(dayKey) === monthKey;

  const incomeLines: IncomeLine[] = input.transactions
    .filter((txn) => inMonth(txn.dayKey) && isIncomeMovement(txn))
    .map((txn) => {
      const auto = roundMoney(txn.direction === 'OUT' ? -num(txn.amount) : num(txn.amount));
      const edit = month.incomeEdits?.[txn.id];
      const edited = Boolean(edit) && Number.isFinite(edit!.amount);
      return {
        id: txn.id,
        label: (txn.sourceLabel ?? '').trim() || INCOME_SOURCE_LABELS[txn.sourceModule] || 'Income',
        accountId: txn.accountId,
        accountName: input.accountNames.get(txn.accountId) ?? 'A deleted account',
        sourceModule: txn.sourceModule,
        dayKey: txn.dayKey,
        auto,
        amount: edited ? roundMoney(edit!.amount) : auto,
        edited,
        note: edit?.note ?? txn.note ?? null,
      };
    })
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.id.localeCompare(b.id));

  const autoByKey: Record<string, number> = {
    income: roundMoney(incomeLines.reduce((sum, line) => sum + line.amount, 0)),
    personal: 0,
    office: 0,
  };

  let officeCount = 0;
  for (const expense of input.officeExpenses) {
    if (!inMonth(expense.dayKey)) continue;
    // An absent status predates approvals and reads as approved.
    if (expense.status === 'PENDING' || expense.status === 'REJECTED') continue;
    autoByKey.office += num(expense.amount);
    officeCount += 1;
  }
  let personalCount = 0;
  for (const expense of input.personalExpenses) {
    if (!inMonth(expense.dayKey)) continue;
    autoByKey.personal += num(expense.amount);
    personalCount += 1;
  }
  autoByKey.office = roundMoney(autoByKey.office);
  autoByKey.personal = roundMoney(autoByKey.personal);

  for (const entry of month.entries ?? []) {
    autoByKey[entry.fieldKey] = roundMoney((autoByKey[entry.fieldKey] ?? 0) + num(entry.amount));
  }

  const columns: ColumnValue[] = columnDefinitions(input.fields, input.labels).map((definition) => {
    const auto = autoByKey[definition.key] ?? 0;
    const override = month.cellOverrides?.[definition.key];
    const overridden = typeof override === 'number' && Number.isFinite(override);
    return { ...definition, auto, value: overridden ? roundMoney(override) : auto, overridden };
  });

  const income = roundMoney(columns.filter((c) => c.type === 'INCOME').reduce((sum, c) => sum + c.value, 0));
  const spent = roundMoney(columns.filter((c) => c.type === 'EXPENSE').reduce((sum, c) => sum + c.value, 0));

  return {
    monthKey,
    incomeLines,
    columns,
    income,
    spent,
    remaining: roundMoney(income - spent),
    officeCount,
    personalCount,
  };
}

/** The frozen copy a closing writes. */
export function closingFrom(figures: GroupMonthFigures, closedByName: string | null, at = new Date()): GroupClosing {
  return {
    closedAt: at.toISOString(),
    closedByName,
    columns: Object.fromEntries(figures.columns.map((column) => [column.key, column.value])),
    income: figures.income,
    spent: figures.spent,
    remaining: figures.remaining,
    incomeLines: figures.incomeLines.map((line) => ({
      id: line.id,
      label: line.label,
      accountName: line.accountName,
      dayKey: line.dayKey,
      amount: line.amount,
    })),
  };
}

/** What a month shows: the frozen closing when it is closed, the live figures otherwise. */
export function displayedTotals(figures: GroupMonthFigures, month: GroupMonthDoc | null): {
  income: number;
  spent: number;
  remaining: number;
  column: (key: string) => number;
  frozen: boolean;
  /** Closed, but a record behind it has changed since. */
  drifted: boolean;
} {
  const closing = month?.status === 'CLOSED' ? month.closing : null;
  if (!closing) {
    const byKey = new Map(figures.columns.map((column) => [column.key, column.value]));
    return {
      income: figures.income,
      spent: figures.spent,
      remaining: figures.remaining,
      column: (key) => byKey.get(key) ?? 0,
      frozen: false,
      drifted: false,
    };
  }
  return {
    income: closing.income,
    spent: closing.spent,
    remaining: closing.remaining,
    column: (key) => num(closing.columns?.[key]),
    frozen: true,
    drifted:
      roundMoney(closing.income) !== figures.income ||
      roundMoney(closing.spent) !== figures.spent,
  };
}

/* -------------------------------------------------------------------------- */
/* Reading stored documents                                                    */
/* -------------------------------------------------------------------------- */

export function readGroupMonth(raw: Record<string, unknown> | null | undefined): GroupMonthDoc {
  if (!raw) return EMPTY_MONTH;
  const entries = Array.isArray(raw.entries)
    ? (raw.entries as Array<Record<string, unknown>>)
        .map((row) => ({
          id: String(row.id ?? ''),
          fieldKey: String(row.fieldKey ?? ''),
          amount: roundMoney(num(row.amount)),
          dayKey: typeof row.dayKey === 'string' ? row.dayKey : '',
          note: typeof row.note === 'string' && row.note ? row.note : null,
        }))
        .filter((row) => row.id && row.fieldKey)
    : [];
  const incomeEdits: Record<string, IncomeEdit> = {};
  if (raw.incomeEdits && typeof raw.incomeEdits === 'object') {
    for (const [id, value] of Object.entries(raw.incomeEdits as Record<string, Record<string, unknown>>)) {
      if (value && Number.isFinite(Number(value.amount))) {
        incomeEdits[id] = { amount: roundMoney(Number(value.amount)), note: typeof value.note === 'string' ? value.note : null };
      }
    }
  }
  const cellOverrides: Record<string, number> = {};
  if (raw.cellOverrides && typeof raw.cellOverrides === 'object') {
    for (const [key, value] of Object.entries(raw.cellOverrides as Record<string, unknown>)) {
      if (value !== null && Number.isFinite(Number(value))) cellOverrides[key] = roundMoney(Number(value));
    }
  }
  const closingRaw = raw.closing as Record<string, unknown> | null | undefined;
  return {
    status: raw.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
    entries,
    incomeEdits,
    cellOverrides,
    description: typeof raw.description === 'string' && raw.description ? raw.description : null,
    closing: closingRaw
      ? {
          closedAt: String(closingRaw.closedAt ?? ''),
          closedByName: typeof closingRaw.closedByName === 'string' ? closingRaw.closedByName : null,
          columns: (closingRaw.columns as Record<string, number>) ?? {},
          income: roundMoney(num(closingRaw.income)),
          spent: roundMoney(num(closingRaw.spent)),
          remaining: roundMoney(num(closingRaw.remaining)),
          incomeLines: Array.isArray(closingRaw.incomeLines)
            ? (closingRaw.incomeLines as GroupClosing['incomeLines'])
            : [],
        }
      : null,
  };
}

/** A field key from a label, unique among the ones taken. */
export function fieldKeyFor(label: string, taken: Iterable<string>): string {
  const used = new Set([...taken, ...BUILTIN_COLUMNS]);
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'field';
  let key = base;
  let n = 2;
  while (used.has(key)) key = `${base}_${n++}`;
  return key;
}

/** Fields as saved: labels trimmed, blanks dropped, keys kept, new keys generated. */
export function normalizeGroupFields(
  input: ReadonlyArray<{ key?: string | null; label?: string | null; type?: string | null; archived?: boolean | null }>
): GroupField[] {
  const out: GroupField[] = [];
  const taken = new Set<string>();
  for (const raw of input) {
    const label = (raw.label ?? '').trim().slice(0, 40);
    if (!label) continue;
    const keyOk =
      raw.key && /^[a-z0-9_]+$/.test(raw.key) && !taken.has(raw.key) && !(BUILTIN_COLUMNS as readonly string[]).includes(raw.key);
    const key = keyOk ? (raw.key as string) : fieldKeyFor(label, taken);
    taken.add(key);
    out.push({ key, label, type: raw.type === 'INCOME' ? 'INCOME' : 'EXPENSE', ...(raw.archived ? { archived: true } : {}) });
    if (out.length >= MAX_GROUP_FIELDS) break;
  }
  return out;
}

export function readGroupConfig(raw: Record<string, unknown> | null | undefined): {
  fields: GroupField[];
  labels: Record<BuiltinColumn, string>;
} {
  const fields = Array.isArray(raw?.fields)
    ? normalizeGroupFields(raw!.fields as GroupField[])
    : DEFAULT_GROUP_FIELDS;
  const rawLabels = (raw?.labels ?? {}) as Record<string, unknown>;
  const labels = Object.fromEntries(
    BUILTIN_COLUMNS.map((key) => [
      key,
      typeof rawLabels[key] === 'string' && (rawLabels[key] as string).trim()
        ? (rawLabels[key] as string).trim()
        : DEFAULT_BUILTIN_LABELS[key],
    ])
  ) as Record<BuiltinColumn, string>;
  return { fields, labels };
}
