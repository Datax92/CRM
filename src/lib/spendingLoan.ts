/**
 * A spending that is really a loan — money lent out of an account, owed back.
 *
 * The owner's case (2026-10-19): FAYSAL CC paid 37,500 and UBL CC 14,879 to
 * Muhammad Hussain. They were typed as ordinary spendings, so Group Income
 * read them as October's Investor expense (Rs 52,379). They are not spent:
 * the money is with Hussain and is coming back.
 *
 * A loan is marked **on the spending itself** — a hand-typed outflow
 * (`transactions`) or a spending record (`capitalSpendings`) — with the
 * person's name in `loanTo`. Its money then moves as `type: 'LOAN'`, which
 * every income and spending reading already leaves out (a debt is neither).
 * Repayments are `LOAN_RETURN` rows into whichever account the money came back
 * to, and `loanReturned` on the spending is their total.
 *
 * What is lent is what actually left: a typed outflow's amount, or what a
 * spending record has been paid. An unpaid spending record has lent nothing.
 *
 * Imports nothing at runtime, so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

/** Longest name kept, so a pasted paragraph cannot become a borrower. */
export const BORROWER_MAX = 80;

const round = (value: number): number => Math.round(value * 100) / 100;
const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? round(parsed) : 0;
};

/** A borrower's name as stored: trimmed, single-spaced, capped. Empty when junk. */
export function normalizeBorrower(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, BORROWER_MAX).trim();
}

export interface LoanReading {
  isLoan: boolean;
  /** Who it was lent to; empty when not a loan. */
  to: string;
  /** What actually left the account. */
  lent: number;
  /** Repaid so far, clamped to what was lent. */
  returned: number;
  /** Still with the borrower. */
  owed: number;
  /** Lent something and all of it is back. */
  settled: boolean;
}

/**
 * Reads a spending's loan state.
 *
 * `lent` is passed in because the two kinds of spending answer it differently
 * (a typed outflow's `amount`, a spending record's `paidAmount`).
 */
export function readLoan(record: { loanTo?: unknown; loanReturned?: unknown }, lent: unknown): LoanReading {
  const to = normalizeBorrower(record.loanTo);
  const out = num(lent);
  if (!to) return { isLoan: false, to: '', lent: out, returned: 0, owed: 0, settled: false };
  const returned = Math.min(num(record.loanReturned), out);
  const owed = round(out - returned);
  return { isLoan: true, to, lent: out, returned, owed, settled: out > 0 && owed <= 0 };
}

/** What is wrong with a proposed repayment, in the words the person needs. */
export function checkLoanReturn(input: { owed: number; amount: unknown; borrower: string }): string[] {
  const amount = typeof input.amount === 'number' ? input.amount : Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return ['Enter the amount that came back.'];
  if (input.owed <= 0) return [`Nothing is owed by ${input.borrower || 'them'} on this.`];
  if (round(amount) > round(input.owed)) {
    return [`Only ${round(input.owed).toLocaleString('en-PK')} is still owed. Enter that or less.`];
  }
  return [];
}

/**
 * Whether marking or un-marking a loan is allowed, and why not.
 *
 * Un-marking a loan that has repayments would leave money arriving as
 * "loan returned" against a plain spending, so it is refused until the
 * repayments are removed. A typed outflow that was paid back from another of
 * the company's own accounts is a different story already; it cannot also be
 * a loan.
 */
export function checkLoanToggle(input: {
  makeLoan: boolean;
  borrower: string;
  returned: number;
  paidBack?: number;
}): string[] {
  if (input.makeLoan) {
    if (!input.borrower) return ['Say who the money was lent to.'];
    if ((input.paidBack ?? 0) > 0) {
      return ['This has been paid back from another account. Remove those pay-backs before marking it as a loan.'];
    }
    return [];
  }
  if (input.returned > 0) {
    return ['Money has already come back on this loan. Remove those returns before marking it as a plain spending.'];
  }
  return [];
}

/** The label a repayment row carries on the statement it lands on. */
export function loanReturnLabel(borrower: string, spendingLabel: string): string {
  const what = spendingLabel.trim();
  return `Loan returned — ${borrower}${what ? ` — ${what}` : ''}`;
}
