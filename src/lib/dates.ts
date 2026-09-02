/**
 * Reporting date ranges, pinned to Asia/Karachi.
 *
 * The business is in Pakistan but the app runs on Vercel (UTC) and Firestore
 * stores UTC instants. Without an explicit zone, a "today" rollup computed on
 * the server would start at 05:00 local time and quietly split the working day
 * in two. Everything user-facing goes through here.
 */

export const BUSINESS_TIMEZONE = 'Asia/Karachi';

export type RangeKey = 'TODAY' | 'WEEK' | 'MONTH' | 'ALL';

export interface DateRange {
  key: RangeKey;
  label: string;
  /** Inclusive lower bound. null means "no lower bound" (ALL). */
  from: Date | null;
  /** Exclusive upper bound. null means "up to now". */
  to: Date | null;
}

export const RANGE_LABELS: Record<RangeKey, string> = {
  TODAY: 'Today',
  WEEK: 'This week',
  MONTH: 'This month',
  ALL: 'All time',
};

/**
 * The wall-clock date parts in Karachi for a given instant.
 */
function karachiParts(at: Date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  ) as Record<string, string>;

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * The UTC instant corresponding to midnight in Karachi on the day containing
 * `at`, optionally shifted back by `daysBack` calendar days.
 *
 * Pakistan has observed no DST since 2009, but this derives the offset from the
 * instant itself rather than hard-coding +05:00, so it stays correct if that
 * ever changes.
 */
export function startOfKarachiDay(at: Date, daysBack = 0): Date {
  const p = karachiParts(at);
  const localMidnightAsUtc = Date.UTC(p.year, p.month - 1, p.day - daysBack, 0, 0, 0);
  const localNowAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMs = localNowAsUtc - at.getTime();
  return new Date(localMidnightAsUtc - offsetMs);
}

/** Midnight in Karachi on the 1st of the month containing `at`. */
export function startOfKarachiMonth(at: Date): Date {
  const p = karachiParts(at);
  return startOfKarachiDay(at, p.day - 1);
}

/**
 * Midnight in Karachi on the most recent Monday.
 * Pakistan's working week runs Monday to Saturday, so weeks start on Monday.
 */
export function startOfKarachiWeek(at: Date): Date {
  const p = karachiParts(at);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (dow + 6) % 7;
  return startOfKarachiDay(at, daysSinceMonday);
}

/** Midnight in Karachi on 1 January of the year containing `at`. */
export function startOfKarachiYear(at: Date): Date {
  const p = karachiParts(at);
  const localMidnightAsUtc = Date.UTC(p.year, 0, 1, 0, 0, 0);
  const localNowAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return new Date(localMidnightAsUtc - (localNowAsUtc - at.getTime()));
}

/**
 * The `YYYY-MM` bucket an instant belongs to, in business-local terms.
 *
 * KPI counters are keyed by this, so a follow-up logged at 2am Karachi on the
 * 1st lands in the new month rather than in the previous one via UTC.
 */
export function karachiMonthKey(at: Date = new Date()): string {
  const p = karachiParts(at);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

export function karachiYear(at: Date = new Date()): number {
  return karachiParts(at).year;
}

/** 1 in January, 12 in December — the divisor for a year-to-date target. */
export function karachiMonthsElapsed(at: Date = new Date()): number {
  return karachiParts(at).month;
}

/** The calendar day an instant falls on in Karachi, as `YYYY-MM-DD`. */
export function karachiDayKey(at: Date = new Date()): string {
  const p = karachiParts(at);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function resolveRange(key: RangeKey, now: Date = new Date()): DateRange {
  switch (key) {
    case 'TODAY':
      return { key, label: RANGE_LABELS.TODAY, from: startOfKarachiDay(now), to: null };
    case 'WEEK':
      return { key, label: RANGE_LABELS.WEEK, from: startOfKarachiWeek(now), to: null };
    case 'MONTH':
      return { key, label: RANGE_LABELS.MONTH, from: startOfKarachiMonth(now), to: null };
    case 'ALL':
    default:
      return { key: 'ALL', label: RANGE_LABELS.ALL, from: null, to: null };
  }
}

/** Whether a Firestore Timestamp-ish value falls inside the range. */
export function withinRange(value: { toDate?: () => Date } | Date | null | undefined, range?: DateRange): boolean {
  if (!range || (range.from === null && range.to === null)) return true;
  if (!value) return false;
  const date = value instanceof Date ? value : value.toDate?.();
  if (!date) return false;
  if (range.from && date < range.from) return false;
  if (range.to && date >= range.to) return false;
  return true;
}

/** Consistent date display in business-local time. */
export function formatBusinessDate(value: { toDate?: () => Date } | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : value.toDate?.();
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Date plus time, business-local — for audit trails and follow-up timestamps. */
export function formatBusinessDateTime(value: { toDate?: () => Date } | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : value.toDate?.();
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}
