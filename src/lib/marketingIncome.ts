/**
 * Mahziyar Marketing — the split, and what the company is left with.
 *
 * **The same shape as a deal's profit distribution, deliberately.** The owner's
 * instruction was that the cut here should work "like in the profit
 * distribution section": a percentage per recipient, the rupees computed from
 * it, as many recipients as the sale needs, and **everything left over is the
 * company's**. So this module follows `lib/profitDistribution`'s rules and
 * reuses its two pure helpers rather than restating them — one reading of
 * "what is 4% of this" across the whole app.
 *
 * What is *not* shared is the record: `dealPayouts` is a closed CRM deal's
 * ledger, and routing a marketing receipt through it would give that collection
 * a second meaning and make every commission report ambiguous about which kind
 * of earning it was counting.
 *
 * Three rules carry the weight:
 *
 * - **The company is not a recipient.** It has no percentage box, because a
 *   number it typed could disagree with the arithmetic; it keeps
 *   `received − Σ cuts`, which is the only figure that always adds up.
 * - **Over-allocation is refused, never trimmed.** Cuts totalling more than the
 *   receipt would pay out money that never arrived, and silently scaling them
 *   down would pay people an amount nobody agreed to.
 * - **Amounts are derived from percentages every time they are shown.** Nothing
 *   stores a rupee figure that a percentage could later contradict.
 *
 * Dependency-free so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

/** Who a cut can go to. The company is deliberately absent — see above. */
export const CUT_ROLES = ['STAFF', 'MANAGER'] as const;
export type CutRole = (typeof CUT_ROLES)[number];

export const CUT_ROLE_LABELS: Record<CutRole, string> = {
  STAFF: 'Staff',
  MANAGER: 'Manager',
};

/** One recipient's share of a sale. */
export interface MarketingCut {
  /** Who it is. Blank while a freshly added row is still being filled in. */
  uid: string | null;
  name: string | null;
  role: CutRole;
  /** 0–100, to two decimals. */
  percent: number;
}

export interface MarketingCutLine extends MarketingCut {
  /** `received × percent / 100`, rounded to the paisa. */
  amount: number;
}

export interface MarketingSplit {
  lines: MarketingCutLine[];
  /** What the sale costs in commission — every cut, added. */
  totalCost: number;
  /** The percentages, added. Shown so 100% is recognisable at a glance. */
  totalPercent: number;
  /** `received − totalCost`. **Everything left is the company's.** */
  companyKeeps: number;
  /** The share the company keeps, as a percentage. */
  companyPercent: number;
  errors: string[];
  valid: boolean;
}

/** Percentages are entered to at most two decimals; rupees to the paisa. */
export function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Accepts whatever a text input produced and yields a usable percentage.
 *
 * A blank field is 0, not NaN — clearing a box means "no share", and NaN
 * propagating into the totals would blank the whole panel mid-edit.
 */
export function parsePercent(input: unknown): number {
  if (input === null || input === undefined) return 0;
  const text = String(input).trim().replace(/%$/, '');
  if (!text) return 0;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return 0;
  return roundPercent(Math.min(value, 100));
}

export function amountForPercent(received: number, percent: number): number {
  if (!Number.isFinite(received) || !Number.isFinite(percent)) return 0;
  return roundMoney((received * percent) / 100);
}

/**
 * The whole split, recomputed from scratch on every keystroke.
 *
 * Cheap enough to run per render — a handful of multiplications over a few
 * lines — so there is no memoisation and no chance of a displayed amount
 * lagging a character behind the percentage that produced it.
 *
 * **A cut with no recipient is an error, not a silent zero.** A row somebody
 * typed 5% into and never named is 5% of the sale going nowhere; refusing it is
 * the only reading that cannot lose money quietly.
 */
export function calculateMarketingSplit(
  amountReceived: number,
  cuts: MarketingCut[]
): MarketingSplit {
  const received = Number.isFinite(amountReceived) ? Math.max(0, roundMoney(amountReceived)) : 0;

  const lines: MarketingCutLine[] = (cuts ?? []).map((cut) => {
    const percent = parsePercent(cut.percent);
    return {
      uid: cut.uid ?? null,
      name: (cut.name ?? '').trim() || null,
      role: cut.role === 'MANAGER' ? 'MANAGER' : 'STAFF',
      percent,
      amount: amountForPercent(received, percent),
    };
  });

  const totalCost = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const totalPercent = roundPercent(lines.reduce((sum, line) => sum + line.percent, 0));
  const companyKeeps = roundMoney(received - totalCost);

  const errors: string[] = [];
  if (received <= 0) errors.push('Enter the amount received.');
  if (totalPercent > 100) {
    errors.push(`The cuts come to ${totalPercent}% — more than the whole sale.`);
  }
  if (lines.some((line) => line.percent > 0 && !line.uid)) {
    errors.push('Every cut needs somebody to pay it to.');
  }
  // Two rows for one person is two answers to "what is their share".
  const named = lines.filter((line) => line.uid).map((line) => line.uid);
  if (new Set(named).size !== named.length) {
    errors.push('Somebody appears twice. Give each person one cut.');
  }

  return {
    lines,
    totalCost,
    totalPercent,
    companyKeeps,
    companyPercent: roundPercent(100 - totalPercent),
    errors,
    valid: errors.length === 0,
  };
}

/** A blank row, ready to be filled in. */
export function emptyCut(role: CutRole = 'STAFF'): MarketingCut {
  return { uid: null, name: null, role, percent: 0 };
}

/**
 * Reads whatever is stored, old shape or new.
 *
 * The module used to hold three typed rupee figures — `staffCommission`,
 * `teamCommission`, `companyCommission`. Those are converted back to
 * percentages of the receipt so an existing record keeps its numbers and shows
 * them the new way, with **no migration**: the company figure is dropped
 * outright, because under the new rule the company's share is not a cut, it is
 * what is left.
 */
export function readCuts(raw: Record<string, unknown>): MarketingCut[] {
  if (Array.isArray(raw.cuts)) {
    return (raw.cuts as Record<string, unknown>[]).map((cut) => ({
      uid: typeof cut.uid === 'string' && cut.uid ? cut.uid : null,
      name: typeof cut.name === 'string' && cut.name ? cut.name : null,
      role: cut.role === 'MANAGER' ? 'MANAGER' : 'STAFF',
      percent: parsePercent(cut.percent),
    }));
  }

  const received = typeof raw.amountReceived === 'number' ? raw.amountReceived : 0;
  if (received <= 0) return [];
  const asPercent = (amount: unknown): number =>
    typeof amount === 'number' && amount > 0 ? roundPercent((amount / received) * 100) : 0;

  const legacy: MarketingCut[] = [];
  const staff = asPercent(raw.staffCommission);
  if (staff > 0) {
    legacy.push({
      uid: (raw.staffUid as string) ?? (raw.soldByUid as string) ?? null,
      name: (raw.staffName as string) ?? (raw.soldByName as string) ?? null,
      role: 'STAFF',
      percent: staff,
    });
  }
  const team = asPercent(raw.teamCommission);
  if (team > 0) {
    legacy.push({
      uid: (raw.teamUid as string) ?? null,
      name: (raw.teamName as string) ?? null,
      role: 'MANAGER',
      percent: team,
    });
  }
  return legacy;
}
