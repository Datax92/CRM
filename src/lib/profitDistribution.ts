/**
 * Splitting a closed deal's net profit.
 *
 * When an employee closes a deal the money is not yet anybody's: the admin
 * decides, deal by deal, what share the employee takes, what their sub admin
 * takes, whether another sub admin is cut in, and what the company books. This
 * module is that arithmetic — nothing else. It has no Firestore, no React and
 * no formatting, so the admin's screen and the Server Action that finalises the
 * split run **the same function** and cannot disagree about what a percentage
 * came to.
 *
 * Three rules decide the shape of everything below.
 *
 * **1. Percentages are the input; amounts are always derived.** The admin types
 * `2`, the screen shows `Rs 2,000` as they type, and the stored record keeps
 * both. Storing an amount the client calculated would let a crafted request pay
 * someone a figure that has no relationship to the percentage beside it.
 *
 * **2. The remainder is the company's.** After every named share the leftover
 * belongs to the business, and it is reported as its own line rather than
 * quietly folded into the company's base percentage — the admin has to be able
 * to see that the company got 4% *plus* the 91% nobody was allocated, because
 * those two numbers mean different things next month.
 *
 * **3. Over-allocation is refused, not clamped.** Shares totalling 105% cannot
 * be silently reduced to fit; that would pay people amounts nobody chose. The
 * result carries an error and the finalise button stays disabled.
 *
 * Dependency-free so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

export type PayoutRole = 'employee' | 'subadmin' | 'company';

/** One named share, as the admin entered it. */
export interface DistributionShare {
  /** `uid` for a person; the company line has none. */
  recipientUid: string | null;
  recipientName: string;
  recipientRole: PayoutRole;
  /** Percent of net profit, 0–100. */
  percentage: number;
  /**
   * Which slot this share fills, so the screen can label it and the reader can
   * tell the employee's own sub admin from a second one who was cut in.
   */
  kind: 'EMPLOYEE' | 'OWN_SUBADMIN' | 'OTHER_SUBADMIN' | 'COMPANY_BASE';
}

export interface DistributionLine extends DistributionShare {
  /** Percentage of the net profit, in rupees. */
  amount: number;
}

export interface DistributionResult {
  netProfit: number;
  lines: DistributionLine[];
  /** Sum of every named percentage, company base included. */
  distributedPercentage: number;
  distributedAmount: number;
  /** What is left after the named shares. Never negative in a valid result. */
  remainingPercentage: number;
  remainingAmount: number;
  /** The company's base share alone. */
  companyBaseAmount: number;
  /** Base plus remainder — what the business actually banks. */
  companyTotalAmount: number;
  /** Empty when the split can be finalised. */
  errors: string[];
  valid: boolean;
}

/** Percentages are entered to at most two decimals; rupees to the whole. */
export function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Accepts whatever a text input produced and yields a usable percentage.
 *
 * A blank field is 0, not NaN — an admin clearing a box means "no share", and
 * NaN propagating into the totals would blank the entire screen while they were
 * mid-edit.
 */
export function parsePercentage(input: unknown): number {
  if (input === null || input === undefined) return 0;
  const text = String(input).trim().replace(/%$/, '');
  if (!text) return 0;

  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return 0;
  return roundPercent(Math.min(value, 100));
}

export function amountForPercentage(netProfit: number, percentage: number): number {
  if (!Number.isFinite(netProfit) || !Number.isFinite(percentage)) return 0;
  return roundMoney((netProfit * percentage) / 100);
}

/**
 * The whole split, recomputed from scratch on every keystroke.
 *
 * Cheap enough to run per render — a handful of multiplications over at most
 * four lines — so there is no memoisation and no chance of the displayed
 * amounts lagging a character behind the percentages that produced them.
 */
export function calculateDistribution(
  netProfit: number,
  shares: DistributionShare[]
): DistributionResult {
  const profit = Number.isFinite(netProfit) ? roundMoney(netProfit) : 0;
  const errors: string[] = [];

  const lines: DistributionLine[] = shares.map((share) => {
    const percentage = roundPercent(Math.max(0, share.percentage || 0));
    return { ...share, percentage, amount: amountForPercentage(profit, percentage) };
  });

  const distributedPercentage = roundPercent(
    lines.reduce((total, line) => total + line.percentage, 0)
  );
  const distributedAmount = roundMoney(
    lines.reduce((total, line) => total + line.amount, 0)
  );

  const remainingPercentage = roundPercent(100 - distributedPercentage);
  const remainingAmount = roundMoney(profit - distributedAmount);

  const companyBaseAmount = roundMoney(
    lines
      .filter((line) => line.kind === 'COMPANY_BASE')
      .reduce((total, line) => total + line.amount, 0)
  );

  if (distributedPercentage > 100) {
    errors.push(
      `The shares add up to ${distributedPercentage}%. Reduce them to 100% or less before finalising.`
    );
  }

  for (const line of lines) {
    if (line.percentage > 100) {
      errors.push(`${line.recipientName} cannot take more than 100%.`);
    }
    if (line.recipientRole !== 'company' && !line.recipientUid) {
      errors.push(`${line.recipientName} has no account selected.`);
    }
  }

  if (profit <= 0) {
    errors.push('This deal made no profit, so there is nothing to distribute.');
  }

  return {
    netProfit: profit,
    lines,
    distributedPercentage,
    distributedAmount,
    remainingPercentage,
    remainingAmount,
    companyBaseAmount,
    // The remainder is the company's by rule, so the business's real total is
    // its base share plus everything nobody was allocated.
    companyTotalAmount: roundMoney(companyBaseAmount + Math.max(0, remainingAmount)),
    errors,
    valid: errors.length === 0,
  };
}

/**
 * The company's default cut, used to seed the form.
 *
 * A starting figure rather than a fixed rule: the admin can change it per deal,
 * and the value they finalise is what the record keeps. Four percent is the
 * owner's own example.
 */
export const DEFAULT_COMPANY_PERCENTAGE = 4;
export const DEFAULT_EMPLOYEE_PERCENTAGE = 2;
export const DEFAULT_SUBADMIN_PERCENTAGE = 2;

/**
 * The stored form of a finalised split.
 *
 * Written once and never edited. Re-finalising a deal appends a **new** record
 * that supersedes the previous one rather than overwriting it, so the question
 * "who approved that payout, and when" always has an answer — the requirement
 * in §24 that historical distribution data is not overwritten.
 */
export interface FinalizedDistribution {
  dealId: string;
  leadId: string;
  netProfit: number;
  lines: DistributionLine[];
  distributedPercentage: number;
  distributedAmount: number;
  remainingPercentage: number;
  remainingAmount: number;
  companyBaseAmount: number;
  companyTotalAmount: number;
  finalizedByUid: string;
  /** Set on the superseded record when a later split replaces it. */
  supersededAt?: unknown;
}
