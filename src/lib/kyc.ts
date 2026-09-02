/**
 * Know Your Client — the confirmed record of who the client actually is.
 *
 * **Why this exists as its own thing.** A lead's name, phone, email and city
 * are whatever arrived from a Meta ad form or a bought spreadsheet: half
 * blank, frequently wrong, sometimes an entire address typed into the name
 * field. The rep finds out the truth on the first real call. Before KYC there
 * was nowhere to put it — the deal entry form asked for it again at the point
 * of sale, months later, and the leads list went on showing the ad form's
 * version forever.
 *
 * So KYC is the **authoritative client record**, and it flows outward:
 *
 * ```
 *   KYC  ──►  lead columns (name / phone / email / city)
 *      └────►  deal entry (name / phone / email / city / cnic / address)
 * ```
 *
 * Filling it in once updates the lead row immediately and pre-fills the deal
 * form when the sale eventually happens. Nobody types the same CNIC twice.
 *
 * The mirrored columns stay on the lead rather than being read through a join
 * because every list query, search and sort in the app already reads them —
 * moving them behind a nested map would mean touching every screen and would
 * cost a document read per row.
 *
 * Dependency-free so the unit tests can run it under raw
 * `node --experimental-strip-types`.
 */

export interface KycField {
  key: string;
  label: string;
  /** Drives the input type and the validation below. */
  kind: 'text' | 'phone' | 'email' | 'cnic' | 'date' | 'longtext' | 'money';
  placeholder?: string;
  /** Which lead column this value is mirrored onto, if any. */
  syncsTo?: 'name' | 'phone' | 'email' | 'city';
  hint?: string;
}

/**
 * The form, in display order.
 *
 * **Every field is optional, including the name.** A rep fills this in from a
 * phone call, and the point at which they know the client's CNIC is rarely the
 * point at which they know their budget. Requiring anything would push people
 * back to not filling it in at all, which is the state this feature exists to
 * end — so the form saves whatever is there and asks for nothing.
 *
 * The commercial half of the list — Investment, Budget, Project, Interest,
 * Trust — is what the sales team actually asks on the first call. They are free
 * text rather than pickers on purpose: a fixed list of projects would be wrong
 * within a month, and "budget" is quoted in ranges, plots and instalment plans
 * as often as it is in a single figure.
 *
 * Grouped for the two-column layout by `KYC_SECTIONS` below rather than by a
 * `group` field on each entry, so the order on screen is readable in one place.
 */
export const KYC_FIELDS: KycField[] = [
  { key: 'name', label: 'Full Name', kind: 'text', syncsTo: 'name', placeholder: 'As written on the CNIC' },
  { key: 'phone', label: 'Phone Number', kind: 'phone', syncsTo: 'phone', placeholder: '03xx xxxxxxx' },
  { key: 'email', label: 'Email', kind: 'email', syncsTo: 'email', placeholder: 'name@example.com' },
  { key: 'city', label: 'City', kind: 'text', syncsTo: 'city', placeholder: 'Islamabad' },
  { key: 'country', label: 'Country', kind: 'text', placeholder: 'Pakistan, UAE, UK…', hint: 'Overseas clients are worked differently.' },
  { key: 'cnic', label: 'CNIC', kind: 'cnic', placeholder: '35201-1234567-8', hint: 'Carried into Deal Entry automatically.' },
  { key: 'address', label: 'Address', kind: 'longtext', placeholder: 'House / street / sector' },
  { key: 'occupation', label: 'Occupation', kind: 'text', placeholder: 'Business, salaried, overseas…' },
  { key: 'company', label: 'Company / Organisation', kind: 'text' },
  { key: 'altPhone', label: 'Alternate Phone', kind: 'phone', placeholder: 'Optional second number' },
  { key: 'dateOfBirth', label: 'Date of Birth', kind: 'date' },
  { key: 'nextOfKin', label: 'Next of Kin', kind: 'text', placeholder: 'Name and relation' },

  // What they want and what they can spend.
  { key: 'project', label: 'Project', kind: 'text', placeholder: 'Capital Smart City, Park View…' },
  { key: 'interest', label: 'Interest', kind: 'text', placeholder: '5 Marla, commercial, file, plot…' },
  { key: 'investment', label: 'Investment', kind: 'money', placeholder: 'Amount they are placing' },
  { key: 'budget', label: 'Budget', kind: 'money', placeholder: 'What they can go up to' },
  { key: 'trust', label: 'Trust', kind: 'text', placeholder: 'How confident are we in this client?' },

  { key: 'notes', label: 'Client Notes', kind: 'longtext', placeholder: 'Anything worth remembering' },
];

export const KYC_SECTIONS: Array<{ title: string; keys: string[] }> = [
  { title: 'Identity', keys: ['name', 'cnic', 'dateOfBirth', 'occupation'] },
  { title: 'Contact', keys: ['phone', 'altPhone', 'email', 'city', 'country', 'address'] },
  { title: 'Requirement', keys: ['project', 'interest', 'investment', 'budget', 'trust'] },
  { title: 'Background', keys: ['company', 'nextOfKin', 'notes'] },
];

export type KycValues = Record<string, string>;

const FIELD_BY_KEY = new Map(KYC_FIELDS.map((field) => [field.key, field]));

export function kycField(key: string): KycField | undefined {
  return FIELD_BY_KEY.get(key);
}

/**
 * Fields whose value is mirrored onto the lead's own columns.
 *
 * Exported because the server action writes the mirror and the client shows
 * "this will also update the lead" — both have to agree on which fields those
 * are, and a second hardcoded list would eventually disagree.
 */
export const KYC_SYNCED_FIELDS = KYC_FIELDS.filter((field) => field.syncsTo);

/** Digits only, so `35201-1234567-8` and `3520112345678` compare equal. */
export function cnicDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/** The conventional 5-7-1 grouping, applied to whatever digits are present. */
export function formatCnic(value: string | null | undefined): string {
  const digits = cnicDigits(value);
  if (digits.length !== 13) return (value ?? '').trim();
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

export interface KycValidationResult {
  values: KycValues;
  errors: string[];
}

/**
 * Trims, drops unknown keys, and checks the three fields that have a shape.
 *
 * Runs on the client for instant feedback **and** on the server for the write,
 * which is why it lives here rather than in either one.
 *
 * **Nothing is required.** The only errors this can produce are malformed
 * values in a field somebody actually filled in — a CNIC that is not 13 digits,
 * an email with no `@`. An empty form is a valid save: it means the rep opened
 * the record and had nothing to add yet, which is a real state and not a
 * mistake to block.
 */
export function validateKyc(input: KycValues): KycValidationResult {
  const values: KycValues = {};
  const errors: string[] = [];

  for (const field of KYC_FIELDS) {
    const raw = (input?.[field.key] ?? '').toString().trim();
    if (!raw) continue;
    values[field.key] = field.kind === 'cnic' ? formatCnic(raw) : raw;
  }

  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.push("That email address doesn't look right.");
  }

  if (values.cnic && cnicDigits(values.cnic).length !== 13) {
    errors.push('A CNIC is 13 digits — check the number.');
  }

  for (const key of ['phone', 'altPhone']) {
    const digits = (values[key] ?? '').replace(/\D/g, '');
    if (values[key] && (digits.length < 10 || digits.length > 15)) {
      errors.push(`${kycField(key)?.label ?? key} does not look like a phone number.`);
    }
  }

  return { values, errors };
}

/**
 * The lead columns a set of KYC values should overwrite.
 *
 * Only non-empty values are returned: clearing the KYC email must not wipe the
 * email the ad form supplied, which may be the only one anybody has.
 */
export function leadPatchFromKyc(values: KycValues): Partial<Record<'name' | 'phone' | 'email' | 'city', string>> {
  const patch: Partial<Record<'name' | 'phone' | 'email' | 'city', string>> = {};

  for (const field of KYC_SYNCED_FIELDS) {
    const value = (values[field.key] ?? '').trim();
    if (value && field.syncsTo) patch[field.syncsTo] = value;
  }

  return patch;
}

/**
 * Deal-entry defaults for a lead, KYC first.
 *
 * The deal form used to start from the lead's raw columns, so the rep re-typed
 * the CNIC and address they had already recorded. Now KYC wins wherever it has
 * an answer and the lead fills the gaps.
 */
export function dealCustomerFromKyc(
  values: KycValues | null | undefined,
  lead: { name?: string | null; phone?: string | null; email?: string | null; city?: string | null }
): { name: string; phone: string; email: string; cnic: string; address: string; city: string } {
  const kyc = values ?? {};
  const pick = (key: string, fallback?: string | null) =>
    (kyc[key] ?? '').trim() || (fallback ?? '').trim();

  return {
    name: pick('name', lead.name),
    phone: pick('phone', lead.phone),
    email: pick('email', lead.email),
    cnic: pick('cnic'),
    address: pick('address'),
    city: pick('city', lead.city),
  };
}

/** How much of the record is filled in — shown as "7 of 12" on the tab. */
export function kycCompleteness(values: KycValues | null | undefined): {
  filled: number;
  total: number;
} {
  const kyc = values ?? {};
  const filled = KYC_FIELDS.filter((field) => (kyc[field.key] ?? '').trim()).length;
  return { filled, total: KYC_FIELDS.length };
}
