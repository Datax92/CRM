/**
 * The central ledger: **every movement of money in this business, in one place.**
 *
 * ## Why this module exists
 *
 * Before it, "Accounts" was five independent lists — `committee`,
 * `investments`, `capitalInvestments`, `personalExpenses`, `receivables` — each
 * holding `{ title, amount, description, date }` and nothing else. No account,
 * no balance, no link to what caused the entry, no status, no audit. Office
 * expenses lived somewhere else again, under Money, with their own richer
 * shape. Nothing reconciled against anything, because there was no ledger to
 * reconcile against.
 *
 * The owner's own spreadsheets say what the shape should be. `COMMITTE 2025`,
 * `CAPITAL INVESTMENT` and `INVESTMENT WITH AUN` are the *same* layout: a named
 * pot — "DECEMBER COMMITTEE", "CAR INVESTMENT", "STATE LIFE LOAN" — with
 * `Amount Received | Description` down one side and `SPENDINGS: Amount Spent |
 * Description` down the other, each totalled. That is an account statement,
 * drawn by hand, once per pot. So Committee is not a module: **it is an
 * account**, and so is Capital Investment.
 *
 * ## The shape
 *
 * ```
 *   Account  ──<  Transaction  >──  Source module + record
 * ```
 *
 * An account holds no running total anybody types. A balance is
 * `openingBalance + Σ inflows − Σ outflows` over its posted transactions, and
 * `accountBalance` below is the only function that computes it.
 *
 * ## Split payments, and why they cannot double-count
 *
 * A 50,000 expense paid 30,000 from one account, 10,000 from another and
 * 10,000 from a third is **one obligation and three movements**. The expense
 * record stays 50,000; the ledger holds three transactions of 30/10/10 whose
 * sum is 50,000. Nothing is duplicated because the two answer different
 * questions:
 *
 * - *what do we owe / what did this cost* — the module record;
 * - *where did the money actually come from* — the ledger.
 *
 * A report that adds both is the double count, and the rule that prevents it is
 * stated once here: **money movement is read from transactions, obligations are
 * read from module records.** Never sum the two together.
 *
 * ## Committee "automatically receiving" its share is not a feature
 *
 * The owner asked that selecting Committee as a payment source anywhere posts a
 * matching −10,000 against Committee. That falls out of the model rather than
 * being built: an allocation names an `accountId`, and Committee is an account
 * like any other. There is no Committee branch in this file, and there must
 * never be one — the same mechanism serves Bank, Cash, Wallet, Investment and
 * anything added later.
 *
 * Dependency-free so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

/* -------------------------------------------------------------------------- */
/* Accounts                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What kind of pot this is.
 *
 * `COMMITTEE` and `INVESTMENT` are here because the owner's sheets treat them
 * as pots money sits in and moves out of, exactly like a bank account — see the
 * module note. The kind changes how an account is *presented*, never how it is
 * posted to.
 */
export const ACCOUNT_KINDS = [
  'BANK',
  'CASH',
  'WALLET',
  'INVESTMENT',
  'COMMITTEE',
  /**
   * A pot that **earns** rather than one that holds — a StateLife commission
   * book, a rental round, anything whose money arrives in instalments and is
   * then spent from.
   *
   * It is an ordinary account and gets no special handling anywhere: that is
   * the point. Because it is one, an office expense or a committee bill can be
   * paid out of it through the same split control as any other account, with
   * no module knowing StateLife exists.
   */
  'INCOME',
  'OTHER',
] as const;

export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  BANK: 'Bank',
  CASH: 'Cash',
  WALLET: 'Wallet',
  INVESTMENT: 'Investment',
  COMMITTEE: 'Committee',
  INCOME: 'Income',
  OTHER: 'Other',
};

export function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === 'string' && (ACCOUNT_KINDS as readonly string[]).includes(value);
}

export function normalizeAccountKind(value: unknown): AccountKind {
  return isAccountKind(value) ? value : 'OTHER';
}

export interface LedgerAccount {
  id: string;
  name: string;
  kind: AccountKind;
  /**
   * What the account held before the ledger started. Part of the balance and
   * **not** a transaction: it has no date, no source and no counterparty, and
   * making it one would put a fictional movement in every statement.
   */
  openingBalance: number;
  /** `ACTIVE` accounts may be posted to; `ARCHIVED` may only be read. */
  status: 'ACTIVE' | 'ARCHIVED';
}

/* -------------------------------------------------------------------------- */
/* Transactions                                                                */
/* -------------------------------------------------------------------------- */

/** Which way the money went. Amounts are always positive; this carries the sign. */
export type LedgerDirection = 'IN' | 'OUT';

/**
 * What the movement *was*, which is what the reports group by.
 *
 * `TRANSFER` is deliberately its own type: money moving between two accounts of
 * the same business is neither income nor expense, and counting it as either
 * inflates both sides by the same amount and makes net movement look right
 * while every other figure is wrong.
 */
export const TRANSACTION_TYPES = [
  'INCOME',
  'EXPENSE',
  'INVESTMENT',
  'TRANSFER',
  'REIMBURSEMENT',
  'ADJUSTMENT',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: 'Income',
  EXPENSE: 'Expense',
  INVESTMENT: 'Investment',
  TRANSFER: 'Transfer',
  REIMBURSEMENT: 'Reimbursement',
  ADJUSTMENT: 'Adjustment',
};

/**
 * The modules allowed to move money.
 *
 * Named rather than free text so a ledger row can always be opened back to the
 * record that caused it, and so a typo cannot orphan a transaction from its
 * source. `MANUAL` is the one entry a person makes directly against an account.
 */
export const SOURCE_MODULES = [
  'OFFICE_EXPENSE',
  'PERSONAL_EXPENSE',
  'DEAL_PAYOUT',
  'MARKETING_INCOME',
  'CAR_SALE',
  'STATELIFE',
  'CAPITAL_INVESTMENT',
  'RECEIVABLE',
  'PAYROLL',
  'TRANSFER',
  'MANUAL',
] as const;

export type SourceModule = (typeof SOURCE_MODULES)[number];

export function isSourceModule(value: unknown): value is SourceModule {
  return typeof value === 'string' && (SOURCE_MODULES as readonly string[]).includes(value);
}

export interface LedgerTransaction {
  id: string;
  accountId: string;
  direction: LedgerDirection;
  /** Always positive. `direction` carries the sign — see `signedAmount`. */
  amount: number;
  type: TransactionType;
  /** `YYYY-MM-DD` in Karachi. String comparison is date comparison. */
  dayKey: string;
  /** Which module caused this, and which record in it. */
  sourceModule: SourceModule;
  sourceId: string | null;
  /** What to show in the statement, denormalised so a row needs no join. */
  sourceLabel: string | null;
  /** Groups the legs of one split payment, and the two legs of one transfer. */
  groupId: string | null;
  /** The other side of a transfer, so a statement can name it. */
  counterAccountId?: string | null;
  /**
   * `POSTED` counts; `VOIDED` does not.
   *
   * **A correction does not void.** It leaves the original posted and adds an
   * equal, opposite leg, so the two cancel and the balance is right while both
   * rows stay on the statement. Voiding the original *and* reversing it would
   * correct the same mistake twice — the balance would move by the amount
   * again, in the wrong direction. `VOIDED` exists only for a row that should
   * never have been counted at all and has no reversal.
   */
  status: 'POSTED' | 'VOIDED';
  /** Set on the reversal, naming what it reverses. */
  reversalOf?: string | null;
  /** Set on the original once a reversal exists. A marker, never a status. */
  reversedBy?: string | null;
  note?: string | null;
  createdByUid: string;
}

/** The amount as it affects a balance: negative for an outflow. */
export function signedAmount(txn: Pick<LedgerTransaction, 'direction' | 'amount'>): number {
  return txn.direction === 'OUT' ? -txn.amount : txn.amount;
}

/** Voided rows are history, not money. Every total below starts here. */
export function isPosted(txn: Pick<LedgerTransaction, 'status'>): boolean {
  return txn.status === 'POSTED';
}

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

/** Rupees to two places. Never negative — `direction` carries the sign. */
export function money(value: unknown): number {
  const n =
    typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100) / 100);
}

const round = (value: number): number => Math.round(value * 100) / 100;

/* -------------------------------------------------------------------------- */
/* Balances                                                                    */
/* -------------------------------------------------------------------------- */

export interface AccountBalance {
  accountId: string;
  openingBalance: number;
  inflow: number;
  outflow: number;
  /** `opening + inflow − outflow`. The only definition of a balance there is. */
  balance: number;
  transactionCount: number;
}

/**
 * An account's balance, **derived** — never a number somebody typed.
 *
 * The whole point of the rebuild: a balance that is stored and updated by hand
 * in several modules will disagree with the movements behind it, and there is
 * then no way to tell which is wrong. Here there is only one answer, and it is
 * recomputable from the transactions at any time.
 */
export function accountBalance(
  account: Pick<LedgerAccount, 'id' | 'openingBalance'>,
  transactions: LedgerTransaction[]
): AccountBalance {
  let inflow = 0;
  let outflow = 0;
  let count = 0;

  for (const txn of transactions) {
    if (txn.accountId !== account.id || !isPosted(txn)) continue;
    count += 1;
    if (txn.direction === 'IN') inflow += txn.amount;
    else outflow += txn.amount;
  }

  const opening = round(account.openingBalance);
  return {
    accountId: account.id,
    openingBalance: opening,
    inflow: round(inflow),
    outflow: round(outflow),
    balance: round(opening + inflow - outflow),
    transactionCount: count,
  };
}

/* -------------------------------------------------------------------------- */
/* Split payments                                                              */
/* -------------------------------------------------------------------------- */

/** One line of "where are we paying this from?". */
export interface PaymentAllocation {
  accountId: string;
  amount: number;
}

export interface AllocationCheck {
  /** What the allocations come to. */
  allocated: number;
  /** `payable − allocated`. Negative is an over-allocation. */
  unallocated: number;
  /** True only when the allocations exactly fund the obligation. */
  fullyFunded: boolean;
  errors: string[];
  valid: boolean;
}

/**
 * Whether a set of allocations may fund an obligation of `payable`.
 *
 * Three rules, and the first is the one that keeps the books straight:
 *
 * 1. **The obligation never changes.** A 50,000 expense funded 30/10/10 is
 *    still a 50,000 expense; the allocations only explain where the money came
 *    from. Nothing here alters `payable`.
 * 2. **Over-allocation is refused, never trimmed.** Paying out more than is
 *    owed is either a typo or a duplicate payment, and silently reducing
 *    somebody's line to make the arithmetic work would hide both.
 * 3. **Fully paid means allocated === payable**, to the paisa. A part-funded
 *    obligation stays part-funded rather than rounding itself closed.
 *
 * An account may appear only once: two lines against one account are the same
 * movement entered twice, and they are the shape a duplicate payment arrives in.
 */
export function checkAllocations(
  payable: number,
  allocations: PaymentAllocation[],
  /** Already funded by earlier payments against the same obligation. */
  alreadyPaid = 0
): AllocationCheck {
  const errors: string[] = [];
  const target = round(money(payable));
  const paid = round(money(alreadyPaid));

  let allocated = 0;
  const seen = new Set<string>();

  for (const line of allocations) {
    const amount = money(line.amount);
    if (!line.accountId) {
      errors.push('Choose the account each payment comes from.');
      continue;
    }
    if (amount <= 0) {
      errors.push('Every payment line needs an amount greater than zero.');
      continue;
    }
    if (seen.has(line.accountId)) {
      errors.push('The same account is listed twice. Combine those lines into one.');
      continue;
    }
    seen.add(line.accountId);
    allocated += amount;
  }

  allocated = round(allocated);
  const outstanding = round(target - paid);
  const unallocated = round(outstanding - allocated);

  if (target <= 0) {
    errors.push('There is nothing to pay on this record.');
  }
  if (allocations.length === 0) {
    errors.push('Add at least one account to pay from.');
  }
  if (allocated > outstanding && outstanding >= 0) {
    errors.push(
      `The payment lines come to ${allocated.toLocaleString('en-PK')}, more than the ` +
        `${outstanding.toLocaleString('en-PK')} outstanding. Reduce them before paying.`
    );
  }

  return {
    allocated,
    unallocated,
    fullyFunded: errors.length === 0 && unallocated === 0,
    errors,
    valid: errors.length === 0,
  };
}

/**
 * The transactions a set of allocations becomes — one per funding account.
 *
 * Every leg carries the same `groupId` and the same source, so the statement on
 * each account can name what it was for and open the record, and so the three
 * legs of one split can be recognised as one payment rather than three.
 *
 * `idempotencyKey` is what stops a double-click, a retry or a second tab paying
 * an obligation twice: it is derived from the source record and the funding
 * accounts, so the identical payment submitted again collides instead of
 * posting a second set of legs.
 */
export function allocationsToTransactions(input: {
  allocations: PaymentAllocation[];
  direction: LedgerDirection;
  type: TransactionType;
  dayKey: string;
  sourceModule: SourceModule;
  sourceId: string;
  sourceLabel: string;
  groupId: string;
  createdByUid: string;
  note?: string | null;
}): Array<Omit<LedgerTransaction, 'id'> & { idempotencyKey: string }> {
  return input.allocations.map((line) => ({
    accountId: line.accountId,
    direction: input.direction,
    amount: money(line.amount),
    type: input.type,
    dayKey: input.dayKey,
    sourceModule: input.sourceModule,
    sourceId: input.sourceId,
    sourceLabel: input.sourceLabel,
    groupId: input.groupId,
    status: 'POSTED' as const,
    note: input.note ?? null,
    createdByUid: input.createdByUid,
    idempotencyKey: `${input.sourceModule}:${input.sourceId}:${line.accountId}`,
  }));
}

/* -------------------------------------------------------------------------- */
/* Transfers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A transfer is **two legs and one group**, and it is neither income nor
 * expense.
 *
 * Both legs carry `type: 'TRANSFER'`, which is what keeps them out of the
 * income and expense totals — counting a transfer as both would inflate each
 * side by the same amount, leaving net movement correct and every other figure
 * on the report wrong.
 */
export function transferTransactions(input: {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  dayKey: string;
  groupId: string;
  createdByUid: string;
  note?: string | null;
}): Array<Omit<LedgerTransaction, 'id'>> {
  const amount = money(input.amount);
  const shared = {
    amount,
    type: 'TRANSFER' as const,
    dayKey: input.dayKey,
    sourceModule: 'TRANSFER' as const,
    sourceId: input.groupId,
    groupId: input.groupId,
    status: 'POSTED' as const,
    note: input.note ?? null,
    createdByUid: input.createdByUid,
  };

  return [
    {
      ...shared,
      accountId: input.fromAccountId,
      direction: 'OUT',
      counterAccountId: input.toAccountId,
      sourceLabel: 'Transfer out',
    },
    {
      ...shared,
      accountId: input.toAccountId,
      direction: 'IN',
      counterAccountId: input.fromAccountId,
      sourceLabel: 'Transfer in',
    },
  ];
}

/** What is wrong with a proposed transfer, in the words the person needs. */
export function validateTransfer(input: {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
}): string[] {
  const errors: string[] = [];
  if (!input.fromAccountId || !input.toAccountId) {
    errors.push('Choose both accounts.');
  } else if (input.fromAccountId === input.toAccountId) {
    // Posts two legs that cancel, leaving a statement full of movements that
    // never happened.
    errors.push('An account cannot transfer to itself.');
  }
  if (money(input.amount) <= 0) errors.push('Enter an amount greater than zero.');
  return errors;
}

/* -------------------------------------------------------------------------- */
/* Corrections                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The reversal of a posted transaction.
 *
 * **Financial history is never rewritten.** Correcting a mistake leaves the
 * original **posted** and adds this equal, opposite leg on the correction's own
 * date. The two cancel, so the balance is right, and both rows stay on the
 * statement — what was believed, and when it was put right.
 *
 * The original must *not* also be voided. Voiding removes its effect from the
 * balance and the reversal removes it again: a 10,000 outflow corrected that
 * way moves the account by 10,000 in the wrong direction. Caught by the live
 * end-to-end run, having first been written into a unit test that asserted the
 * wrong number.
 */
export function reversalOf(
  txn: LedgerTransaction,
  input: { dayKey: string; createdByUid: string; note?: string | null }
): Omit<LedgerTransaction, 'id'> {
  return {
    accountId: txn.accountId,
    direction: txn.direction === 'IN' ? 'OUT' : 'IN',
    amount: txn.amount,
    type: txn.type,
    dayKey: input.dayKey,
    sourceModule: txn.sourceModule,
    sourceId: txn.sourceId,
    sourceLabel: txn.sourceLabel ? `Reversal — ${txn.sourceLabel}` : 'Reversal',
    groupId: txn.groupId,
    counterAccountId: txn.counterAccountId ?? null,
    status: 'POSTED',
    reversalOf: txn.id,
    note: input.note ?? null,
    createdByUid: input.createdByUid,
  };
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                   */
/* -------------------------------------------------------------------------- */

export interface LedgerSummary {
  income: number;
  expenses: number;
  investments: number;
  reimbursements: number;
  /** Moved between own accounts. Counted apart, never as income or expense. */
  transfersIn: number;
  transfersOut: number;
  adjustments: number;
  /** Inflow − outflow across every posted transaction, transfers included. */
  netMovement: number;
}

/**
 * Totals over a set of posted transactions, grouped the way the reports read.
 *
 * **Transfers are counted apart from everything else.** They are movements
 * between the business's own pots, so they belong in neither income nor
 * expenses; they still appear in net movement because across a single account
 * they genuinely are a movement, and across all accounts they cancel.
 */
export function summarize(transactions: LedgerTransaction[]): LedgerSummary {
  const totals: LedgerSummary = {
    income: 0,
    expenses: 0,
    investments: 0,
    reimbursements: 0,
    transfersIn: 0,
    transfersOut: 0,
    adjustments: 0,
    netMovement: 0,
  };

  for (const txn of transactions) {
    if (!isPosted(txn)) continue;
    totals.netMovement += signedAmount(txn);

    switch (txn.type) {
      case 'INCOME':
        totals.income += txn.amount;
        break;
      case 'EXPENSE':
        totals.expenses += txn.amount;
        break;
      case 'INVESTMENT':
        totals.investments += txn.amount;
        break;
      case 'REIMBURSEMENT':
        totals.reimbursements += txn.amount;
        break;
      case 'TRANSFER':
        if (txn.direction === 'IN') totals.transfersIn += txn.amount;
        else totals.transfersOut += txn.amount;
        break;
      default:
        totals.adjustments += txn.amount;
    }
  }

  for (const key of Object.keys(totals) as Array<keyof LedgerSummary>) {
    totals[key] = round(totals[key]);
  }
  return totals;
}

/** Totals per account, for the dashboard's list and the grand total. */
export function balancesFor(
  accounts: Array<Pick<LedgerAccount, 'id' | 'openingBalance'>>,
  transactions: LedgerTransaction[]
): { byAccount: Map<string, AccountBalance>; total: number } {
  const byAccount = new Map<string, AccountBalance>();
  let total = 0;
  for (const account of accounts) {
    const balance = accountBalance(account, transactions);
    byAccount.set(account.id, balance);
    total += balance.balance;
  }
  return { byAccount, total: round(total) };
}

/* -------------------------------------------------------------------------- */
/* Movement and trend                                                          */
/* -------------------------------------------------------------------------- */

export interface AccountMovement extends AccountBalance {
  /** Net change today: inflow − outflow over transactions carrying today's key. */
  today: number;
  /** Net change this calendar month, Karachi. */
  month: number;
  /** The same figure for the month before, or `null` when there is none. */
  previousMonth: number | null;
  /**
   * Month-on-month change as a percentage, **or `null`**.
   *
   * `null` whenever there is nothing honest to compare against: no prior
   * month's data at all, or a prior month of exactly zero, where a percentage
   * is undefined rather than infinite. The brief is explicit that a
   * comparison must not be invented, and a card showing "↑ 100%" because last
   * month happened to be blank is exactly that.
   */
  changePct: number | null;
  /** `up` · `down` · `flat`, for the arrow beside the figure. */
  direction: 'up' | 'down' | 'flat';
}

/** `YYYY-MM` from a `YYYY-MM-DD` day key. */
export function monthOfDayKey(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/**
 * One account's balance plus how it has moved.
 *
 * Everything is derived from the transactions — there is no stored "today's
 * movement" to go stale. `todayKey` and `monthKey` are passed in rather than
 * read from the clock so the whole dashboard renders against one instant and
 * two cards cannot straddle midnight.
 */
export function accountMovement(
  account: Pick<LedgerAccount, 'id' | 'openingBalance'>,
  transactions: LedgerTransaction[],
  now: { todayKey: string; monthKey: string; previousMonthKey: string }
): AccountMovement {
  const base = accountBalance(account, transactions);

  let today = 0;
  let month = 0;
  let previous = 0;
  let sawPrevious = false;

  for (const txn of transactions) {
    if (txn.accountId !== account.id || !isPosted(txn)) continue;
    const signed = signedAmount(txn);
    if (txn.dayKey === now.todayKey) today += signed;

    const bucket = monthOfDayKey(txn.dayKey);
    if (bucket === now.monthKey) month += signed;
    else if (bucket === now.previousMonthKey) {
      previous += signed;
      sawPrevious = true;
    }
  }

  today = round(today);
  month = round(month);
  const previousMonth = sawPrevious ? round(previous) : null;

  // No prior month, or a prior month of zero: a percentage would be invented.
  const changePct =
    previousMonth === null || previousMonth === 0
      ? null
      : round(((month - previousMonth) / Math.abs(previousMonth)) * 100);

  return {
    ...base,
    today,
    month,
    previousMonth,
    changePct,
    direction: month > 0 ? 'up' : month < 0 ? 'down' : 'flat',
  };
}

/**
 * A period-on-period comparison for a summary card, or `null`.
 *
 * Same rule as above and the same reason: with no comparable prior period, the
 * card shows the figure and no trend rather than a number nobody can trust.
 */
export function compareToPrevious(current: number, previous: number | null): {
  changePct: number | null;
  direction: 'up' | 'down' | 'flat';
} {
  if (previous === null || previous === 0) {
    return { changePct: null, direction: current === 0 ? 'flat' : current > 0 ? 'up' : 'down' };
  }
  const changePct = round(((current - previous) / Math.abs(previous)) * 100);
  return { changePct, direction: changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat' };
}

/** Totals for one month, so the dashboard can compare it with the last. */
export function summarizeMonth(transactions: LedgerTransaction[], monthKey: string): LedgerSummary {
  return summarize(transactions.filter((txn) => monthOfDayKey(txn.dayKey) === monthKey));
}
