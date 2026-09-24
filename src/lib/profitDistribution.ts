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
 * Four rules decide the shape of everything below.
 *
 * **1. Percentages are the input; amounts are always derived.** The admin types
 * `2`, the screen shows `Rs 2,000` as they type, and the stored record keeps
 * both. Storing an amount the client calculated would let a crafted request pay
 * someone a figure that has no relationship to the percentage beside it.
 *
 * **2. The percentage multiplies the Cut base; the money leaves the payment
 * source; the two are different numbers.** This is the rule the whole module
 * now turns on. A 50 lakh sale with a 10 lakh adjustment has a Cut base of
 * **50 lakh** and a payment source of **40 lakh**: a 1% Cut is 50,000, and
 * those 50,000 come out of the 40 lakh. A lump sum where the client paid the
 * builder 40 lakh and the builder paid us a 4 lakh commission has a base of
 * 40 lakh and a source of 4 lakh — 1% is 40,000, out of the commission. See
 * the table in `lib/dealAmounts`; this module is handed the two figures and
 * never works out which is which.
 *
 * **3. The company keeps what is left of the source, and may name a cut of its
 * own** (owner, 2026-09-24). A `COMPANY_BASE` line is a percentage of the base
 * like any other, shown with its own meter; it counts in the rupee test below,
 * because the company cannot keep more than the pot holds. The company's total
 * is its cut **plus** everything unallocated: `companyRetained = payoutSource −
 * what people are paid`. No payout row is written for it — it has nobody to
 * show it to. (From 2026-09-09 to 2026-09-24 there was no company percentage.)
 *
 * **4. Over-allocation is refused, not clamped.** Cuts totalling more than the
 * payment source cannot be silently reduced to fit; that would pay people
 * amounts nobody chose. The result carries an error and the finalise button
 * stays disabled. Note this is a **rupee** test, not a percentage one: with a
 * base larger than the source, cuts well under 100% can still exceed the pot.
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

/** The two figures a split is computed from. They are never interchangeable. */
export interface DistributionPot {
  /** What each percentage multiplies. */
  cutBase: number;
  /** What the finalised Cuts are paid out of, and what the company keeps. */
  payoutSource: number;
}

export interface DistributionResult {
  /** What the percentages multiply. */
  cutBase: number;
  /** What they are paid from. */
  payoutSource: number;
  lines: DistributionLine[];
  /** Sum of every named percentage. */
  distributedPercentage: number;
  /**
   * Every Cut in rupees — percentages of `cutBase` — **including the
   * company's own cut**. This is what the rupee test compares with the source.
   */
  distributedAmount: number;
  /** What is paid to people: `distributedAmount` less the company's cut. */
  peopleAmount: number;
  /** The company's named cut, in rupees and in percent of the base. */
  companyCutAmount: number;
  companyCutPercentage: number;
  /** What nobody was given: `payoutSource − distributedAmount`. The company's too. */
  unallocatedAmount: number;
  /**
   * What the company ends up with: its own cut plus the unallocated rest, i.e.
   * `payoutSource − peopleAmount`. Negative only in an invalid result.
   */
  companyRetained: number;
  /**
   * The Cuts as a share of the pot they actually come out of. Worth showing
   * because it is the number that surprises: a 1% Cut on a 50 lakh base is
   * 1.25% of a 40 lakh source.
   */
  sourceUsedPercentage: number;
  /**
   * Kept so a **finalised record written before 2026-09-09 still renders**.
   * `netProfit` was the single pot, `companyTotalAmount` what the business
   * banked. Nothing new should read them.
   */
  netProfit: number;
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
  pot: DistributionPot,
  shares: DistributionShare[]
): DistributionResult {
  const cutBase = Number.isFinite(pot?.cutBase) ? roundMoney(pot.cutBase) : 0;
  const payoutSource = Number.isFinite(pot?.payoutSource) ? roundMoney(pot.payoutSource) : 0;
  const errors: string[] = [];

  // **Every amount is a percentage of the base**, including on a deal where the
  // base is larger than the pot it is paid from. That is the whole point: a 1%
  // Cut on a 50 lakh sale is 50,000 whether the money comes out of 50 lakh or
  // out of the 40 lakh left after an adjustment.
  const lines: DistributionLine[] = shares.map((share) => {
    const percentage = roundPercent(Math.max(0, share.percentage || 0));
    return { ...share, percentage, amount: amountForPercentage(cutBase, percentage) };
  });

  const distributedPercentage = roundPercent(
    lines.reduce((total, line) => total + line.percentage, 0)
  );
  const distributedAmount = roundMoney(
    lines.reduce((total, line) => total + line.amount, 0)
  );
  const isCompany = (line: DistributionLine) => line.recipientRole === 'company';
  const companyCutAmount = roundMoney(
    lines.filter(isCompany).reduce((total, line) => total + line.amount, 0)
  );
  const companyCutPercentage = roundPercent(
    lines.filter(isCompany).reduce((total, line) => total + line.percentage, 0)
  );
  const peopleAmount = roundMoney(distributedAmount - companyCutAmount);

  // **The company's total is its own cut plus everything nobody was given**
  // (owner, 2026-09-24) — i.e. the source less what people are paid. The
  // company cut is a named slice of that, not money on top of it.
  const companyRetained = roundMoney(payoutSource - peopleAmount);
  const unallocatedAmount = roundMoney(payoutSource - distributedAmount);
  const sourceUsedPercentage =
    payoutSource > 0 ? roundPercent((distributedAmount / payoutSource) * 100) : 0;

  for (const line of lines) {
    if (line.percentage > 100) {
      errors.push(`${line.recipientName} cannot take more than 100%.`);
    }
    if (line.recipientRole !== 'company' && !line.recipientUid) {
      errors.push(`${line.recipientName} has no account selected.`);
    }
  }

  if (cutBase <= 0) {
    errors.push('This deal has nothing to calculate a cut from.');
  }
  if (payoutSource <= 0) {
    // A deal that made a loss, or a lump sum with no commission recorded. There
    // is no pot, so there is nothing to pay anybody out of.
    errors.push('There is nothing left on this deal to pay a cut from.');
  }

  // **The rupee test, not a percentage one.** Percentages of a base bigger than
  // the source can exceed the source at well under 100%, so comparing
  // percentages would let through a split that pays out more than exists.
  if (payoutSource > 0 && distributedAmount > payoutSource) {
    errors.push(
      `The cuts come to Rs ${Math.round(distributedAmount).toLocaleString('en-PK')}, ` +
        `more than the Rs ${Math.round(payoutSource).toLocaleString('en-PK')} available. ` +
        'Reduce them before finalising.'
    );
  }

  return {
    cutBase,
    payoutSource,
    lines,
    distributedPercentage,
    distributedAmount,
    peopleAmount,
    companyCutAmount,
    companyCutPercentage,
    unallocatedAmount,
    companyRetained,
    sourceUsedPercentage,
    // Kept only so a record written before this shape still renders.
    netProfit: payoutSource,
    companyTotalAmount: Math.max(0, companyRetained),
    errors,
    valid: errors.length === 0,
  };
}

/**
 * Starting figures for the form. The admin changes them per deal and the value
 * they finalise is what the record keeps.
 *
 * There is deliberately **no company percentage** any more: the company is not
 * a recipient, it keeps whatever is left of the payment source. The constant
 * stays exported at 0 because superseded records still carry a `COMPANY_BASE`
 * line and a reader may want to name the field it came from.
 */
export const DEFAULT_COMPANY_PERCENTAGE = 0;
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
  /** Which of the four types the deal was, frozen with the rest. */
  dealType?: string;
  /** What the percentages multiplied. */
  cutBase: number;
  /** What they were paid from, and what the company kept the rest of. */
  payoutSource: number;
  companyRetained: number;
  lines: DistributionLine[];
  distributedPercentage: number;
  distributedAmount: number;
  /** Written by splits finalised before 2026-09-09. Read, never written now. */
  netProfit?: number;
  remainingPercentage?: number;
  remainingAmount?: number;
  companyBaseAmount?: number;
  companyTotalAmount: number;
  finalizedByUid: string;
  /** Set on the superseded record when a later split replaces it. */
  supersededAt?: unknown;
}
