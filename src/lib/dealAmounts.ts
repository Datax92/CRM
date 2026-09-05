/**
 * What a closed deal is worth, and what the commission is a percentage of.
 *
 * A deal is recorded as four figures, and only the first three are typed:
 *
 * | field | meaning |
 * |---|---|
 * | **Total Price** | the sale price agreed with the client |
 * | **Down Payment** | what they have actually paid so far — the cash the payouts come out of |
 * | **Adjustment** | anything knocked off the price: a discount, or an old file traded in |
 * | **Remaining** | `Total Price − Adjustment`, calculated, never typed |
 *
 * **The commission is a percentage of `Remaining`, and that is one rule, not
 * two.** The owner described it as two cases — "the cut is calculated from the
 * total price; if there is an adjustment it is calculated from the remaining" —
 * but with no adjustment `Remaining` *is* `Total Price`, so a single expression
 * covers both and there is no branch to get the wrong way round. On their own
 * example: 50 lakh total, 10 lakh adjustment, so 40 lakh is the base; 1% to the
 * employee is 40,000, paid out of the 10 lakh down payment.
 *
 * **The down payment is the funding, not the base.** It is what the business
 * has in hand to pay people from, so a split that comes to more than it holds
 * is worth pointing at — but it never changes what anybody is owed.
 *
 * ## Why `amountReceived` and `payableAmount` are still written
 *
 * Those two fields were the whole money model before this, and something like
 * thirty places read them: every revenue rollup, the KPI portfolio, the income
 * sheet, campaign ROI, the employee metrics, the reports. They are now written
 * as **mirrors** of the new fields rather than being ripped out:
 *
 * ```
 *   amountReceived := totalPrice     (the deal's value — the role it always had)
 *   payableAmount  := adjustment     (what comes off that value)
 *   profit          = received − payable = totalPrice − adjustment = remaining
 * ```
 *
 * The old formula therefore lands on exactly the new base, every existing
 * aggregate keeps the meaning it had, and no historical deal has to be
 * migrated. Nothing new should read the mirrors — use the accessors below,
 * which fall back to them for deals recorded before this shape existed.
 *
 * Dependency-free so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

/** The three figures a person types on the Deal Entry form. */
export interface DealAmountsInput {
  totalPrice: number;
  downPayment: number;
  adjustment: number;
}

/** Those three, plus everything derived from them. */
export interface DealAmounts extends DealAmountsInput {
  /** `totalPrice − adjustment`. What the commission percentages apply to. */
  remaining: number;
  /** The commission base, named for what the distribution screen calls it. */
  profit: number;
  /** Written for the ~30 readers that predate this shape. See the module note. */
  amountReceived: number;
  payableAmount: number;
}

function money(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  // Rupees to two places, and never negative: a negative price is not a deal,
  // and letting one through would flip the sign of somebody's commission.
  return Math.max(0, Math.round(n * 100) / 100);
}

/**
 * The complete set of figures for a deal, from the three that are typed.
 *
 * Pure, so the form can show the operator what they are about to save and the
 * Server Action can compute the same numbers without trusting the payload.
 */
export function dealAmounts(input: Partial<DealAmountsInput>): DealAmounts {
  const totalPrice = money(input.totalPrice);
  const downPayment = money(input.downPayment);
  // An adjustment larger than the price would make the base negative. Clamped
  // rather than rejected here — `validateDealAmounts` is where a person is told
  // about it; this function has to return usable numbers for a live preview
  // while they are still typing.
  const adjustment = Math.min(money(input.adjustment), totalPrice);
  const remaining = Math.round((totalPrice - adjustment) * 100) / 100;

  return {
    totalPrice,
    downPayment,
    adjustment,
    remaining,
    profit: remaining,
    amountReceived: totalPrice,
    payableAmount: adjustment,
  };
}

/**
 * What is wrong with these figures, in the words the person needs.
 *
 * Returns an empty array when the deal can be saved. Shared by the form and the
 * action so a deal the screen accepts is never refused by the server, and one
 * the screen refuses could not have been saved anyway.
 */
export function validateDealAmounts(input: Partial<DealAmountsInput>): string[] {
  const totalPrice = money(input.totalPrice);
  const downPayment = money(input.downPayment);
  const adjustment = money(input.adjustment);
  const errors: string[] = [];

  if (totalPrice <= 0) {
    errors.push('Enter the total price.');
  }
  if (adjustment > totalPrice) {
    errors.push('The adjustment cannot be more than the total price.');
  }
  if (downPayment > totalPrice) {
    // Not a rounding slip — somebody has typed the price into the wrong box,
    // and saving it would put a wrong figure into the ledger permanently.
    errors.push('The down payment cannot be more than the total price.');
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* Reading a stored deal                                                       */
/* -------------------------------------------------------------------------- */

/** The shape every stored deal has, old or new. */
export interface StoredDealAmounts {
  totalPrice?: number | null;
  downPayment?: number | null;
  adjustment?: number | null;
  remaining?: number | null;
  amountReceived?: number | null;
  payableAmount?: number | null;
  profit?: number | null;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * A deal's total price.
 *
 * Falls back to `amountReceived` for deals closed before the four-field form:
 * that field held the deal's value, which is the same role `totalPrice` has now.
 */
export function readTotalPrice(deal: StoredDealAmounts): number {
  return deal.totalPrice != null ? num(deal.totalPrice) : num(deal.amountReceived);
}

/**
 * What the client has actually paid.
 *
 * **Null for a deal recorded before this existed**, rather than 0 — the older
 * form never asked, so the honest answer is "not recorded", and showing a
 * confident `Rs 0` would read as a client who paid nothing.
 */
export function readDownPayment(deal: StoredDealAmounts): number | null {
  return deal.downPayment != null ? num(deal.downPayment) : null;
}

/** What came off the price. Old deals carry it in `payableAmount`. */
export function readAdjustment(deal: StoredDealAmounts): number {
  return deal.adjustment != null ? num(deal.adjustment) : num(deal.payableAmount);
}

/**
 * The commission base.
 *
 * Prefers the stored `remaining`, then the stored `profit` — which for every
 * historical deal is `received − payable`, arithmetically the same thing — and
 * only then recomputes.
 */
export function readRemaining(deal: StoredDealAmounts): number {
  if (deal.remaining != null) return num(deal.remaining);
  if (deal.profit != null) return num(deal.profit);
  return num(deal.amountReceived) - num(deal.payableAmount);
}
