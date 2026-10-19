/**
 * Capital Investment — what a pot's rows mean, and the cash figures read from
 * them.
 *
 * A pot's statement mixes rows that answer different questions, and the
 * screen has to tell them apart:
 *
 * - a **contribution** is money somebody put in — "UBL CREDIT CARD 950,000";
 * - a **round return** is capital an Investment with X round brought back;
 * - a **pass-through** row only crosses the pot on its way somewhere else — an
 *   office or personal expense it paid, a transfer, a receivable, an Amanat
 *   receipt, a pay-back, or the reversal of any of those;
 * - a **direct spending** is money that went out of the pot and stayed out —
 *   or, when typed `LOAN`, money lent out that is owed back (`isLentOut`).
 *
 * **"Still in hand" is the pot's cash, and it equals the account's balance.**
 * It used to be contributions less every outflow plus round returns only, so
 * any other money coming back — a reversed personal-expense payment, a
 * transfer in — was never counted. Measured 2026-10-17: UBL CC read 22,879 in
 * hand while its account held 66,000; the 43,121 gap was ten personal-expense
 * payments reversed back into it on 2026-10-12. A pay-back would have
 * vanished the same way.
 *
 * Imports nothing at runtime, so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

/** Modules whose rows only pass through a pot. Never a contribution, never a cost. */
export const PASS_THROUGH_MODULES: ReadonlySet<string> = new Set([
  'OFFICE_EXPENSE',
  'PERSONAL_EXPENSE',
  'PAYROLL',
  'TRANSFER',
  'RECEIVABLE',
  'AMANAT',
  'PAY_BACK',
  // A borrower repaying a loan: the pot's own money coming home, not new money.
  'LOAN_RETURN',
]);

export interface PotRow {
  direction: 'IN' | 'OUT';
  amount: number;
  sourceModule: string;
  groupId?: string | null;
  reversalOf?: string | null;
  status?: string | null;
}

export function isPassThrough(row: Pick<PotRow, 'sourceModule' | 'reversalOf'>): boolean {
  return PASS_THROUGH_MODULES.has(row.sourceModule) || Boolean(row.reversalOf);
}

/** Capital an Investment with X round brought back into the pot. */
export function isRoundReturn(row: Pick<PotRow, 'direction' | 'sourceModule' | 'groupId'>): boolean {
  return (
    row.direction === 'IN' &&
    (row.sourceModule === 'INVESTMENT_WITH_X' || Boolean(row.groupId?.startsWith('invx_')))
  );
}

/** Money somebody put into the pot. */
export function isContribution(row: PotRow): boolean {
  return row.direction === 'IN' && !isRoundReturn(row) && !isPassThrough(row);
}

/** Money that left the pot on something of its own, not on another module's record. */
export function isDirectSpending(row: PotRow): boolean {
  return row.direction === 'OUT' && row.sourceModule !== 'CAPITAL_INVESTMENT' && !isPassThrough(row);
}

/** Money lent out of the pot and owed back, rather than spent (`lib/spendingLoan`). */
export function isLentOut(row: PotRow & { type?: string | null }): boolean {
  return isDirectSpending(row) && row.type === 'LOAN';
}

export interface PotCash {
  /** Opening balance plus contributions — "Put In". */
  received: number;
  /** Everything that came back in that was not a contribution. */
  cameBack: number;
  /** Every outflow, less what came back. */
  paidFromPot: number;
  /** `received − paidFromPot`, which is the account's balance. */
  inHand: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * The pot's cash, from **this pot's own rows**. Voided rows are history and are
 * left out, exactly as `lib/ledger.accountBalance` leaves them out.
 */
export function potCash(openingBalance: number, rows: readonly PotRow[]): PotCash {
  let contributions = 0;
  let cameBack = 0;
  let out = 0;
  for (const row of rows) {
    if ((row.status ?? 'POSTED') !== 'POSTED') continue;
    const amount = Number(row.amount) || 0;
    if (row.direction === 'OUT') out += amount;
    else if (isContribution(row)) contributions += amount;
    else cameBack += amount;
  }
  const received = round((Number(openingBalance) || 0) + contributions);
  const paidFromPot = round(out - cameBack);
  return { received, cameBack: round(cameBack), paidFromPot, inHand: round(received - paidFromPot) };
}
