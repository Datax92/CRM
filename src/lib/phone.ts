/**
 * Phone helpers for a Pakistan-based business.
 *
 * wa.me and tel: links need an E.164 number with no punctuation and no leading
 * zero. Meta lead forms and manual entry produce every local variant of a PK
 * number — `0300-1234567`, `+92 300 1234567`, `92 300 1234567` — and the naive
 * "strip non-digits" approach turns the first of those into an unroutable
 * `03001234567`.
 */

const PK_COUNTRY_CODE = '92';

/**
 * Normalises a phone number to bare E.164 digits (no `+`), which is the format
 * wa.me expects. Returns null when the input can't be interpreted.
 *
 * Assumes a Pakistani number when no country code is present — change
 * DEFAULT_COUNTRY_CODE if the business expands.
 */
export function toE164Digits(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const hadPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  // Already carries the country code, with or without a leading +.
  if (digits.startsWith(PK_COUNTRY_CODE) && digits.length >= 11) {
    return digits;
  }

  // Local format: 03001234567 -> 923001234567
  if (digits.startsWith('0')) {
    digits = digits.replace(/^0+/, '');
    return PK_COUNTRY_CODE + digits;
  }

  // An explicit + with some other country code — trust it as given.
  if (hadPlus) return digits;

  // Bare 10-digit local number: 3001234567 -> 923001234567
  if (digits.length === 10) return PK_COUNTRY_CODE + digits;

  return digits;
}

/** A `wa.me` click-to-chat URL (BR-11 / FR-17), or null if the number is unusable. */
export function whatsAppUrl(raw: string | null | undefined): string | null {
  const digits = toE164Digits(raw);
  return digits ? `https://wa.me/${digits}` : null;
}

/** A `tel:` URL in international form. */
export function telUrl(raw: string | null | undefined): string | null {
  const digits = toE164Digits(raw);
  return digits ? `tel:+${digits}` : null;
}

/** Human-readable form for display: +92 300 1234567 */
export function formatPhone(raw: string | null | undefined): string {
  const digits = toE164Digits(raw);
  if (!digits) return raw ?? '—';
  if (digits.startsWith(PK_COUNTRY_CODE) && digits.length === 12) {
    const local = digits.slice(2);
    return `+${PK_COUNTRY_CODE} ${local.slice(0, 3)} ${local.slice(3)}`;
  }
  return `+${digits}`;
}
