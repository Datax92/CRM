/**
 * What a closed deal is worth, what the Cut is a percentage **of**, and what
 * the Cut is paid **out of**.
 *
 * ## Four deal types, and they are not variations on one shape
 *
 * | type | the client's payment | what is calculated |
 * |---|---|---|
 * | **Down Payment** | Down Payment against a Total Price | `Remaining = Total Price − Adjustment` |
 * | **Confirmation** | a Confirmation amount against a Total Price | `Remaining = Total Price − Adjustment` |
 * | **Installments** | an Amount Received, less a Payable Amount | `Remaining = Received − Payable` |
 * | **Lump Sum** | an Amount Received that goes to the **builder** | nothing — the **Commission** is typed |
 *
 * ## The rule this module exists to hold: the Cut has two different numbers
 *
 * **The base is what the percentage multiplies. The source is where the money
 * comes from. They are deliberately not the same field**, and reading one for
 * the other is the mistake this whole file is arranged to make impossible:
 *
 * | type | Cut calculated on | Cut paid out of |
 * |---|---|---|
 * | Down Payment | **Total Price** | Remaining |
 * | Confirmation | **Total Price** | Remaining |
 * | Installments | **Amount Received** | Remaining |
 * | Lump Sum | **Amount Received** | **Commission** |
 *
 * On the owner's own examples: a 50 lakh sale with a 10 lakh adjustment leaves
 * 40 lakh Remaining, and a 1% Cut is **1% of 50 lakh = 50,000** — taken out of
 * that 40 lakh. A Lump Sum where the client pays 40 lakh and the builder pays
 * the company 4 lakh gives a 1% Cut of **40,000**, out of the 4 lakh Commission,
 * leaving the company 3.6 lakh.
 *
 * **This module never decides the percentage.** The Cut is finalised by the
 * admin in Profit Distribution; all that is stored here is the two numbers that
 * screen needs, so there is exactly one source of truth for each.
 *
 * ### It supersedes the single-base rule
 *
 * Until 2026-09-09 the base was `Remaining` for every deal — recorded here as a
 * deliberate decision, on the reasoning that `Remaining` collapses to
 * `Total Price` when there is no adjustment, so one expression covered both. The
 * owner has since specified it as the table above, which is a different rule
 * whenever an adjustment exists: the same 50 lakh deal used to give a 1% Cut of
 * 40,000 and now gives 50,000. Nothing had to be migrated — see below.
 *
 * ## Lump Sum revenue is the Commission, not the client's money
 *
 * The 40 lakh a Lump Sum client pays goes to the builder. It is not the
 * company's revenue and must never be booked as such — so for a Lump Sum the
 * legacy mirrors below carry the **Commission**, which is what the company
 * actually earns.
 *
 * ## Why `amountReceived` and `payableAmount` are still written
 *
 * Those two fields were the whole money model before any of this, and about
 * thirty places read them: every revenue rollup, the KPI portfolio, the income
 * sheet, campaign ROI, the employee metrics, the reports. They are written as
 * **mirrors**, per type, chosen so `profit = received − payable` still lands on
 * the number the company actually books:
 *
 * ```
 *   Down Payment  amountReceived := totalPrice   payableAmount := adjustment
 *   Confirmation  amountReceived := totalPrice   payableAmount := adjustment
 *   Installments  amountReceived := received     payableAmount := payable
 *   Lump Sum      amountReceived := commission   payableAmount := 0
 * ```
 *
 * Every existing aggregate therefore keeps the meaning it had, and no
 * historical deal needs migrating. Nothing new should read the mirrors — use
 * the accessors at the foot of this file, which fall back to them.
 *
 * ## Reading a deal recorded before any of this
 *
 * A deal with no `dealType` is an **Installments** deal: `amountReceived`
 * minus `payableAmount` is literally the Installments formula, so every one of
 * them keeps displaying exactly what it displays today. Its Cut base becomes
 * `Amount Received` like any other Installments deal — the owner's instruction,
 * so that one deal type does not carry two rules depending on when it was
 * entered. Splits **already finalised** are frozen records and are never
 * recomputed.
 *
 * Dependency-free so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

/* -------------------------------------------------------------------------- */
/* The four types                                                              */
/* -------------------------------------------------------------------------- */

export const DEAL_TYPES = ['DOWN_PAYMENT', 'CONFIRMATION', 'INSTALLMENTS', 'LUMP_SUM'] as const;

export type DealType = (typeof DEAL_TYPES)[number];

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  DOWN_PAYMENT: 'Down Payment',
  CONFIRMATION: 'Confirmation',
  INSTALLMENTS: 'Installments',
  LUMP_SUM: 'Lump Sum',
};

/** One line under each option on the form, in the terms the business uses. */
export const DEAL_TYPE_HINTS: Record<DealType, string> = {
  DOWN_PAYMENT: 'A price agreed, with a down payment against it.',
  CONFIRMATION: 'A price agreed, with a confirmation amount paid and more due later.',
  INSTALLMENTS: 'Money received this cycle, less what is payable out of it.',
  LUMP_SUM: 'The client pays the builder; the builder pays us a commission.',
};

/** What the Cut percentage multiplies, per type — shown beside the figure. */
export const CUT_BASE_LABELS: Record<DealType, string> = {
  DOWN_PAYMENT: 'Total Price',
  CONFIRMATION: 'Total Price',
  INSTALLMENTS: 'Amount Received',
  LUMP_SUM: 'Amount Received',
};

/** Where the finalised Cut is taken from, per type. */
export const CUT_SOURCE_LABELS: Record<DealType, string> = {
  DOWN_PAYMENT: 'Remaining',
  CONFIRMATION: 'Remaining',
  INSTALLMENTS: 'Remaining',
  LUMP_SUM: 'Commission',
};

export function isDealType(value: unknown): value is DealType {
  return typeof value === 'string' && (DEAL_TYPES as readonly string[]).includes(value);
}

/** Falls back to Installments — see the module note on legacy deals. */
export function normalizeDealType(value: unknown): DealType {
  return isDealType(value) ? value : 'INSTALLMENTS';
}

/** Whether this type is priced against a Total Price rather than a receipt. */
export function isPricedType(type: DealType): boolean {
  return type === 'DOWN_PAYMENT' || type === 'CONFIRMATION';
}

/* -------------------------------------------------------------------------- */
/* The figures                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Everything a person can type on the form. Which of these are shown — and
 * which are read at all — is decided entirely by `dealType`.
 */
export interface DealAmountsInput {
  dealType?: DealType | string | null;

  /** Down Payment / Confirmation. */
  totalPrice?: number;
  downPayment?: number;
  confirmationAmount?: number;
  adjustment?: number;

  /** Installments / Lump Sum. */
  receivedAmount?: number;
  payableAmount?: number;

  /** Lump Sum only, and **typed, never derived**. */
  commission?: number;
}

/** The typed figures plus everything derived from them. */
export interface DealAmounts {
  dealType: DealType;

  totalPrice: number;
  downPayment: number;
  confirmationAmount: number;
  adjustment: number;
  receivedAmount: number;
  payableAmount: number;
  commission: number;

  /**
   * `null` for a Lump Sum, which has no Remaining at all — the client's money
   * goes to the builder, so there is nothing left over to name. The field is
   * absent from the form for that type and absent from the record.
   */
  remaining: number | null;

  /** What a Cut percentage multiplies. Never the same question as below. */
  cutBase: number;
  /** What the finalised Cut is taken out of. */
  payoutSource: number;

  /** What the company books before any Cut. Equals the `profit` mirror. */
  companyRevenue: number;

  /** The three fields ~30 existing readers use. Mirrors, never inputs. */
  amountReceived: number;
  legacyPayableAmount: number;
  profit: number;
}

function money(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  // Rupees to two places, and never negative: a negative price is not a deal,
  // and letting one through would flip the sign of somebody's Cut.
  return Math.max(0, Math.round(n * 100) / 100);
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * The complete set of figures for a deal, from the ones that are typed.
 *
 * Pure, so the form can show the operator exactly what it is about to save and
 * the Server Action can compute the same numbers without trusting the payload.
 * Every branch here is the deal type and nothing else — there is no case where
 * a figure means one thing on one screen and another elsewhere.
 */
export function dealAmounts(input: DealAmountsInput): DealAmounts {
  const dealType = normalizeDealType(input.dealType);

  const totalPrice = money(input.totalPrice);
  const downPayment = money(input.downPayment);
  const confirmationAmount = money(input.confirmationAmount);
  // An adjustment larger than the price would make Remaining negative. Clamped
  // here rather than rejected — `validateDealAmounts` is where a person is told
  // about it; this function has to return usable numbers for a live preview
  // while they are still typing.
  const adjustment = Math.min(money(input.adjustment), totalPrice);
  const receivedAmount = money(input.receivedAmount);
  const payableAmount = Math.min(money(input.payableAmount), receivedAmount);
  const commission = money(input.commission);

  if (dealType === 'LUMP_SUM') {
    // No Remaining, by rule. The Commission is typed and is the company's
    // revenue; the client's money is the builder's and is only ever the base
    // the Cut percentage multiplies.
    return {
      dealType,
      totalPrice, downPayment, confirmationAmount, adjustment,
      receivedAmount, payableAmount, commission,
      remaining: null,
      cutBase: receivedAmount,
      payoutSource: commission,
      companyRevenue: commission,
      amountReceived: commission,
      legacyPayableAmount: 0,
      profit: commission,
    };
  }

  if (dealType === 'INSTALLMENTS') {
    const remaining = round(receivedAmount - payableAmount);
    return {
      dealType,
      totalPrice, downPayment, confirmationAmount, adjustment,
      receivedAmount, payableAmount, commission,
      remaining,
      cutBase: receivedAmount,
      payoutSource: remaining,
      companyRevenue: remaining,
      amountReceived: receivedAmount,
      legacyPayableAmount: payableAmount,
      profit: remaining,
    };
  }

  // Down Payment and Confirmation are one shape with one field renamed: the
  // client's payment is a Down Payment in the first and a Confirmation in the
  // second. Everything derived is identical, and saying so once here is what
  // keeps them from drifting apart.
  const remaining = round(totalPrice - adjustment);
  return {
    dealType,
    totalPrice, downPayment, confirmationAmount, adjustment,
    receivedAmount, payableAmount, commission,
    remaining,
    cutBase: totalPrice,
    payoutSource: remaining,
    companyRevenue: remaining,
    amountReceived: totalPrice,
    legacyPayableAmount: adjustment,
    profit: remaining,
  };
}

/**
 * What is wrong with these figures, in the words the person needs.
 *
 * Returns an empty array when the deal can be saved. Shared by both forms and
 * the Server Action, so a deal the screen accepts is never refused by the
 * server and one the screen refuses could not have been saved anyway.
 *
 * Only the fields the chosen type actually uses are checked. Validating a
 * Total Price on an Installments deal would refuse a perfectly good deal over a
 * box that is not on the screen.
 */
export function validateDealAmounts(input: DealAmountsInput): string[] {
  const dealType = normalizeDealType(input.dealType);
  const errors: string[] = [];

  if (dealType === 'LUMP_SUM') {
    const received = money(input.receivedAmount);
    const payable = money(input.payableAmount);
    const commission = money(input.commission);

    if (received <= 0) errors.push('Enter the amount received from the client.');
    if (commission <= 0) errors.push('Enter the commission — it is what the company earns on a lump sum.');
    if (payable > received) {
      errors.push('The payable amount cannot be more than the amount received.');
    }
    // Catches the transposition that would otherwise book a 40 lakh commission
    // on a 4 lakh receipt, and with it a 10× Cut base.
    if (commission > received && received > 0) {
      errors.push('The commission cannot be more than the amount received. Check the two figures are the right way round.');
    }
    return errors;
  }

  if (dealType === 'INSTALLMENTS') {
    const received = money(input.receivedAmount);
    const payable = money(input.payableAmount);

    if (received <= 0) errors.push('Enter the amount received.');
    if (payable > received) {
      // Remaining is Received − Payable, so this is the only way to reach a
      // negative Remaining, and it is always a typing error.
      errors.push('The payable amount cannot be more than the amount received.');
    }
    return errors;
  }

  const totalPrice = money(input.totalPrice);
  const adjustment = money(input.adjustment);
  const paid = dealType === 'CONFIRMATION' ? money(input.confirmationAmount) : money(input.downPayment);
  const paidLabel = dealType === 'CONFIRMATION' ? 'confirmation amount' : 'down payment';

  if (totalPrice <= 0) errors.push('Enter the total price.');
  if (adjustment > totalPrice) {
    errors.push('The adjustment cannot be more than the total price.');
  }
  if (paid > totalPrice) {
    // Not a rounding slip — somebody has typed the price into the wrong box,
    // and saving it would put a wrong figure into the ledger permanently.
    errors.push(`The ${paidLabel} cannot be more than the total price.`);
  }

  return errors;
}

/**
 * One line describing a deal's money, in the terms its own type uses.
 *
 * Shared by the admin's "deal waiting to be split" notification and anywhere
 * else a deal has to be summarised in a sentence. Written once because the
 * previous version was hard-coded to the down-payment wording, and on an
 * Installments or Lump Sum deal it would have described boxes that were never
 * on the form.
 */
export function describeDealAmounts(amounts: DealAmounts): string {
  const rs = (value: number) => value.toLocaleString('en-PK');
  const cut = `Cut is a percentage of ${CUT_BASE_LABELS[amounts.dealType].toLowerCase()} ` +
    `${rs(amounts.cutBase)}, paid from ${CUT_SOURCE_LABELS[amounts.dealType].toLowerCase()} ` +
    `${rs(amounts.payoutSource)}.`;

  switch (amounts.dealType) {
    case 'LUMP_SUM':
      return `Lump sum — client paid ${rs(amounts.receivedAmount)} to the builder, ` +
        `commission to us ${rs(amounts.commission)}. ${cut}`;
    case 'INSTALLMENTS':
      return `Installments — received ${rs(amounts.receivedAmount)}, ` +
        `payable ${rs(amounts.payableAmount)}, remaining ${rs(amounts.remaining ?? 0)}. ${cut}`;
    case 'CONFIRMATION':
      return `Confirmation — total ${rs(amounts.totalPrice)}, ` +
        `confirmation paid ${rs(amounts.confirmationAmount)}` +
        (amounts.adjustment > 0 ? `, adjustment ${rs(amounts.adjustment)}` : '') +
        `, remaining ${rs(amounts.remaining ?? 0)}. ${cut}`;
    default:
      return `Down payment — total ${rs(amounts.totalPrice)}, ` +
        `down payment ${rs(amounts.downPayment)}` +
        (amounts.adjustment > 0 ? `, adjustment ${rs(amounts.adjustment)}` : '') +
        `, remaining ${rs(amounts.remaining ?? 0)}. ${cut}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Reading a stored deal                                                       */
/* -------------------------------------------------------------------------- */

/** The shape a stored deal may have, at any age. */
export interface StoredDealAmounts {
  dealType?: string | null;
  totalPrice?: number | null;
  downPayment?: number | null;
  confirmationAmount?: number | null;
  adjustment?: number | null;
  remaining?: number | null;
  receivedAmount?: number | null;
  commission?: number | null;
  cutBase?: number | null;
  payoutSource?: number | null;
  amountReceived?: number | null;
  payableAmount?: number | null;
  profit?: number | null;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * Which of the four types a stored deal is.
 *
 * A deal with no `dealType` predates the selector. If it carries a
 * `totalPrice` it came from the four-field form that briefly existed and is a
 * **Down Payment**; otherwise it is the original `amountReceived` /
 * `payableAmount` shape, which is **Installments**.
 */
export function readDealType(deal: StoredDealAmounts): DealType {
  if (isDealType(deal.dealType)) return deal.dealType;
  return deal.totalPrice != null ? 'DOWN_PAYMENT' : 'INSTALLMENTS';
}

/**
 * A deal's total price. Only meaningful for the two priced types.
 *
 * Falls back to `amountReceived` for a deal closed before the type selector:
 * that field held the deal's value, which is the role `totalPrice` has now.
 */
export function readTotalPrice(deal: StoredDealAmounts): number {
  return deal.totalPrice != null ? num(deal.totalPrice) : num(deal.amountReceived);
}

/**
 * What the client has actually handed over on a priced deal.
 *
 * **Null for a deal recorded before the field existed**, rather than 0 — the
 * older form never asked, so the honest answer is "not recorded", and a
 * confident `Rs 0` reads as a client who paid nothing.
 */
export function readDownPayment(deal: StoredDealAmounts): number | null {
  const type = readDealType(deal);
  const value = type === 'CONFIRMATION' ? deal.confirmationAmount : deal.downPayment;
  return value != null ? num(value) : null;
}

/** What came off the price. Old deals carry it in `payableAmount`. */
export function readAdjustment(deal: StoredDealAmounts): number {
  return deal.adjustment != null ? num(deal.adjustment) : num(deal.payableAmount);
}

/** The "Amount Received" typed on an Installments or Lump Sum deal. */
export function readReceivedAmount(deal: StoredDealAmounts): number {
  return deal.receivedAmount != null ? num(deal.receivedAmount) : num(deal.amountReceived);
}

/** The manually entered commission. Lump Sum only; 0 elsewhere. */
export function readCommission(deal: StoredDealAmounts): number {
  return num(deal.commission);
}

/**
 * Remaining. **Null for a Lump Sum**, which has none — a screen showing one
 * would be inventing a figure the business does not have.
 */
export function readRemaining(deal: StoredDealAmounts): number | null {
  if (readDealType(deal) === 'LUMP_SUM') return null;
  if (deal.remaining != null) return num(deal.remaining);
  // For every historical deal `profit` is `received − payable`, which is
  // arithmetically the Installments Remaining.
  if (deal.profit != null) return num(deal.profit);
  return num(deal.amountReceived) - num(deal.payableAmount);
}

/**
 * **What a Cut percentage multiplies.** Never `readPayoutSource`.
 *
 * Stored on new deals; derived for older ones by the same table, so a legacy
 * Installments deal gets `Amount Received` exactly as a new one does.
 */
export function readCutBase(deal: StoredDealAmounts): number {
  if (deal.cutBase != null) return num(deal.cutBase);
  const type = readDealType(deal);
  if (isPricedType(type)) return readTotalPrice(deal);
  return readReceivedAmount(deal);
}

/**
 * **What the finalised Cut is taken out of.** Never `readCutBase`.
 *
 * The Commission on a Lump Sum, and Remaining on everything else.
 */
export function readPayoutSource(deal: StoredDealAmounts): number {
  if (deal.payoutSource != null) return num(deal.payoutSource);
  if (readDealType(deal) === 'LUMP_SUM') return readCommission(deal);
  return readRemaining(deal) ?? 0;
}

/**
 * The figures to show for a stored deal, in the fields **its own type** uses.
 *
 * One implementation for the four surfaces that display a recorded deal — the
 * lead pane, the phone's lead sheet, the Closed Deals record and the Profit
 * Distribution header. Four copies of "which boxes does a lump sum have" is
 * four chances to print a Remaining that does not exist.
 *
 * `value` is `null` where the figure was never recorded, which callers render
 * as an em dash: an older deal's down payment was not asked for, and a
 * confident `Rs 0` would read as a client who paid nothing.
 */
export function dealFigureRows(
  deal: StoredDealAmounts
): Array<{ label: string; value: number | null; strong?: boolean }> {
  const type = readDealType(deal);

  if (type === 'LUMP_SUM') {
    return [
      // Named for where it went. Calling it "Amount Received" on a record
      // invites it being read as ours, and it is the builder's.
      { label: 'To the builder', value: readReceivedAmount(deal) },
      { label: 'Commission', value: readCommission(deal), strong: true },
    ];
  }

  if (type === 'INSTALLMENTS') {
    return [
      { label: 'Amount Received', value: readReceivedAmount(deal) },
      { label: 'Payable', value: readAdjustment(deal) },
      { label: 'Remaining', value: readRemaining(deal), strong: true },
    ];
  }

  return [
    { label: 'Total Price', value: readTotalPrice(deal) },
    { label: type === 'CONFIRMATION' ? 'Confirmation' : 'Down Payment', value: readDownPayment(deal) },
    { label: 'Adjustment', value: readAdjustment(deal) },
    { label: 'Remaining', value: readRemaining(deal), strong: true },
  ];
}

/**
 * The two Cut figures as display rows, for the same four surfaces.
 *
 * Always both, always in this order, always labelled with the field each one
 * comes from — an admin cannot check an arithmetic whose base is not on screen.
 */
export function dealCutRows(
  deal: StoredDealAmounts
): Array<{ label: string; value: number; note: string }> {
  const type = readDealType(deal);
  return [
    {
      label: `Cut base — ${CUT_BASE_LABELS[type]}`,
      value: readCutBase(deal),
      note: "the admin's percentage applies to this",
    },
    {
      label: `Paid from — ${CUT_SOURCE_LABELS[type]}`,
      value: readPayoutSource(deal),
      note: 'the company keeps what is left of this',
    },
  ];
}
