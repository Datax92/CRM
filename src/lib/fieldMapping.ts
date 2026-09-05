/**
 * Carrying a Data Bank column through to the rest of the lead.
 *
 * A source sheet already knows things the app would otherwise ask for again: a
 * society transfer list has the plot's total price and what the buyer has paid,
 * an F2F sheet has the CNIC and the address. Retyping those on the KYC tab and
 * again on Deal Entry is not just slow — it is where the two records start to
 * disagree, because the sheet says one number and somebody's memory says
 * another.
 *
 * So each folder field may name **one place its value belongs**. The mapping is
 * per folder, because the columns are: `Total Amount` in one export and
 * `Package Price` in another are the same fact under two labels, and the label
 * is the source's own word for it (see `DataBankField`).
 *
 * **Applied once, at promotion.** The values are copied onto the lead when the
 * record becomes one, not read live from the record afterwards. A cold row is
 * provenance — what the sheet said on the day it was imported — and a lead is a
 * working record somebody edits. Reading through to the row would mean a
 * corrected KYC silently reverting to whatever the spreadsheet said, and a
 * re-import rewriting a lead nobody touched. Same rule `lib/leadSource` follows.
 *
 * **Nothing is overwritten later.** Promotion is the only writer; from then on
 * the KYC tab and Deal Entry own their own values.
 *
 * **Deliberately importing nothing.** The KYC field list lives in `lib/kyc`,
 * and importing it here would break the raw `--experimental-strip-types` test
 * loader, which cannot resolve extensionless imports (CLAUDE.md). So this
 * module validates a target by its *shape*, and `lib/fieldMappingTargets`
 * builds the picker's option list from the real KYC fields.
 */

/** The Deal Entry fields a column may fill. */
export const DEAL_TARGET_KEYS = ['totalPrice', 'downPayment', 'adjustment'] as const;

/**
 * The lead columns a sheet may fill.
 *
 * Name and phone are absent on purpose — every folder already nominates those
 * through `roles`, and a second way to set them would be a second answer to
 * "which column is the phone number".
 */
export const LEAD_TARGET_KEYS = ['email', 'city'] as const;

/**
 * Whether a stored `mapsTo` is one this build understands.
 *
 * `deal:` and `lead:` are checked against their closed lists — those are code,
 * not data, and a typo would silently write into nothing. `kyc:` accepts any
 * non-empty key: KYC fields are a longer, more open list, and an unrecognised
 * one simply lands in `lead.kyc` where nothing reads it, which is harmless.
 *
 * **`deal:remaining` is not valid.** Remaining is Total Price minus Adjustment
 * and is calculated; a column filling it could contradict the two fields it is
 * derived from.
 */
export function normalizeMapsTo(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;

  const at = text.indexOf(':');
  if (at <= 0) return null;

  const kind = text.slice(0, at);
  const key = text.slice(at + 1);
  if (!key) return null;

  if (kind === 'deal') return (DEAL_TARGET_KEYS as readonly string[]).includes(key) ? text : null;
  if (kind === 'lead') return (LEAD_TARGET_KEYS as readonly string[]).includes(key) ? text : null;
  if (kind === 'kyc') return text;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Applying a folder's mapping to one record                                   */
/* -------------------------------------------------------------------------- */

export interface MappedField {
  key: string;
  mapsTo?: string | null;
}

export interface MappedValues {
  /** Written to `lead.kyc`, and shown pre-filled on the KYC tab. */
  kyc: Record<string, string>;
  /** Written to `lead.dealDefaults`, and pre-fills Deal Entry. */
  deal: Record<string, number>;
  /** Written onto the lead itself. */
  lead: Record<string, string>;
}

/**
 * A number out of a spreadsheet cell.
 *
 * Sheets carry money as `"5,000,000"`, `"Rs 5000000"`, `"50,00,000/-"` and
 * every other shape a person can type into Excel. Anything that is not a digit
 * or a decimal point is stripped; a cell with no digits at all yields null, so
 * the field is simply left unmapped rather than defaulting a price to zero.
 */
export function parseSheetNumber(raw: string | null | undefined): number | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * What one record's values become, given the folder's mapping.
 *
 * Empty cells are skipped entirely rather than written as `""`: an unfilled KYC
 * field and one somebody deliberately blanked look the same in Firestore, and
 * only one of them should count toward `kycCompleteness`.
 */
export function applyFieldMapping(
  fields: MappedField[],
  values: Record<string, string>
): MappedValues {
  const out: MappedValues = { kyc: {}, deal: {}, lead: {} };

  for (const field of fields) {
    const target = normalizeMapsTo(field.mapsTo);
    if (!target) continue;

    const raw = (values[field.key] ?? '').trim();
    if (!raw) continue;

    const at = target.indexOf(':');
    const kind = target.slice(0, at);
    const key = target.slice(at + 1);

    if (kind === 'deal') {
      const amount = parseSheetNumber(raw);
      // A price column holding "TBC" is not a price. Left unmapped so Deal
      // Entry asks, rather than pre-filling a confident zero.
      if (amount !== null) out.deal[key] = amount;
    } else if (kind === 'kyc') {
      out.kyc[key] = raw;
    } else if (kind === 'lead') {
      out.lead[key] = raw;
    }
  }

  return out;
}

/** True when a folder has at least one column pointed somewhere. */
export function hasAnyMapping(fields: MappedField[]): boolean {
  return fields.some((field) => normalizeMapsTo(field.mapsTo) !== null);
}
