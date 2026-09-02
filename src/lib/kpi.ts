/**
 * The KPI model (Connects, Client Registrations, Meetings).
 *
 * Deliberately dependency-free — `npm test` runs this file's tests through raw
 * `node --experimental-strip-types`, with no bundler to resolve the `@/` alias.
 * Everything here is pure arithmetic over plain numbers so the rules can be
 * tested without Firestore, React, or a build step.
 *
 * The vocabulary, because it is not obvious from the code alone:
 *
 *   MTD  month-to-date — the 1st of the current month until now
 *   YTD  year-to-date  — 1 January until now
 *   KPI% actual ÷ target, expressed as a percentage
 *
 * A KPI is meaningless without a target, so every metric below is a pair: a
 * count this module derives from recorded work, and a target an admin sets.
 */

/**
 * A call counts as a "Connect" only at 1 minute 10 seconds or longer.
 *
 * Anything shorter is a ring-out, a wrong number, or a "call me back" — it is
 * activity, but it is not a conversation, and the business only pays for
 * conversations. The duration is typed in by the employee: the app has no
 * telephony integration and cannot observe call length itself.
 */
export const CONNECT_MIN_SECONDS = 70;

/** Four hours. Past this, someone has fat-fingered the minutes box. */
export const MAX_CALL_DURATION_SECONDS = 4 * 60 * 60;

export type KpiMetric = 'connects' | 'registrations' | 'meetings';

export const KPI_METRICS: readonly KpiMetric[] = ['connects', 'registrations', 'meetings'] as const;

export const KPI_METRIC_LABELS: Record<KpiMetric, string> = {
  connects: 'Connects',
  registrations: 'Client Registration',
  meetings: 'Meeting',
};

export type KpiTargets = Record<KpiMetric, number> & {
  /**
   * Monthly revenue target, in rupees. Drives the "Target Achieved" panel.
   *
   * Deliberately not one of KPI_METRICS: the three metrics measure activity
   * and are the ones with donuts and weights, while this measures the money
   * those activities produced.
   */
  revenue: number;
};

/**
 * Company-wide starting targets, per employee per month.
 *
 * These are defaults, not policy — every employee record carries its own
 * targets and an admin overrides them per person. They exist so a newly
 * created employee has a sensible denominator instead of dividing by zero.
 */
export const DEFAULT_KPI_TARGETS: KpiTargets = {
  connects: 200,
  registrations: 8,
  meetings: 20,
  revenue: 3_000_000,
};

/**
 * How much each metric moves the overall performance score.
 *
 * Connects and registrations carry the weight because they are the two ends of
 * the job — the work put in and the money that came out. Meetings are a
 * leading indicator and count for less.
 */
export const KPI_WEIGHTS: Record<KpiMetric, number> = {
  connects: 0.4,
  registrations: 0.4,
  meetings: 0.2,
};

/**
 * Attainment is capped at 150% before it enters the score.
 *
 * Without a cap, one employee logging 788% on meetings would swamp two failing
 * metrics and still come out top of the lane. The cap keeps the score a
 * measure of all-round performance rather than of a single runaway number.
 */
export const KPI_ATTAINMENT_CAP = 1.5;

/** A call the employee timed at or above the connect threshold. */
export function isConnect(durationSeconds: number | null | undefined): boolean {
  const seconds = Number(durationSeconds);
  return Number.isFinite(seconds) && seconds >= CONNECT_MIN_SECONDS;
}

/** Rejects nonsense durations; returns whole seconds, or 0 for "not a call". */
export function normalizeDurationSeconds(value: unknown): number {
  const seconds = Math.floor(Number(value));
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, MAX_CALL_DURATION_SECONDS);
}

/** `1:10`, `12:04`, `1:02:30` — the way a call log reads. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const seconds = normalizeDurationSeconds(totalSeconds);
  if (seconds === 0) return '—';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export interface KpiCounts {
  /** Every logged call, connected or not. */
  calls: number;
  /** Calls that reached CONNECT_MIN_SECONDS. */
  connects: number;
  /** Deals closed — a customer on the books. */
  registrations: number;
  /** Follow-ups where a meeting actually took place. */
  meetings: number;
  /** Σ amountReceived on those deals, for the portfolio panels. */
  revenue: number;
}

export const EMPTY_KPI_COUNTS: KpiCounts = {
  calls: 0,
  connects: 0,
  registrations: 0,
  meetings: 0,
  revenue: 0,
};

export function addCounts(a: KpiCounts, b: Partial<KpiCounts>): KpiCounts {
  return {
    calls: a.calls + (b.calls ?? 0),
    connects: a.connects + (b.connects ?? 0),
    registrations: a.registrations + (b.registrations ?? 0),
    meetings: a.meetings + (b.meetings ?? 0),
    revenue: a.revenue + (b.revenue ?? 0),
  };
}

export function sumCounts(all: Partial<KpiCounts>[]): KpiCounts {
  return all.reduce<KpiCounts>((total, next) => addCounts(total, next), EMPTY_KPI_COUNTS);
}

export interface KpiReading {
  metric: KpiMetric;
  label: string;
  actual: number;
  target: number;
  /** actual ÷ target as a fraction. 1 = on target. Uncapped, so 3.1 is real. */
  ratio: number;
  /** The same figure as a whole-number percentage, for display. */
  percent: number;
}

/**
 * A zero target would make attainment infinite, which renders as "Infinity%"
 * on a dashboard the client is going to look at. Treat it as "no target set"
 * and report 0% rather than dividing.
 */
function attainment(actual: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return actual / target;
}

export function readKpi(metric: KpiMetric, actual: number, target: number): KpiReading {
  const ratio = attainment(actual, target);
  return {
    metric,
    label: KPI_METRIC_LABELS[metric],
    actual,
    target,
    ratio,
    percent: Math.round(ratio * 100),
  };
}

/** The three readings for one period, in display order. */
export function readAllKpis(counts: KpiCounts, targets: KpiTargets): KpiReading[] {
  return [
    readKpi('connects', counts.connects, targets.connects),
    readKpi('registrations', counts.registrations, targets.registrations),
    readKpi('meetings', counts.meetings, targets.meetings),
  ];
}

/**
 * Scales monthly targets up to a year-to-date target.
 *
 * `monthsElapsed` is 1 in January and 12 in December — the current month
 * counts in full, matching how the MTD figure counts a part-month in full.
 * Anything else would show every employee failing on the 2nd of the month.
 */
export function ytdTargets(targets: KpiTargets, monthsElapsed: number): KpiTargets {
  const months = Math.max(1, Math.floor(monthsElapsed));
  return {
    connects: targets.connects * months,
    registrations: targets.registrations * months,
    meetings: targets.meetings * months,
    revenue: targets.revenue * months,
  };
}

/**
 * The headline "how am I doing overall" figure, as a fraction.
 *
 * The same weighted blend as `kpiScore` but **uncapped**, because this one is
 * read by a person rather than used to rank a lane: someone at 240% should see
 * 240%, while the ranking score deliberately caps each metric so one runaway
 * number cannot buy a top slot (see KPI_ATTAINMENT_CAP).
 */
export function overallAttainment(counts: KpiCounts, targets: KpiTargets): number {
  let weighted = 0;
  for (const metric of KPI_METRICS) {
    weighted += attainment(counts[metric], targets[metric]) * KPI_WEIGHTS[metric];
  }
  return weighted;
}

/**
 * One number, 0–1, summarising how an employee is doing this month.
 *
 * This is what drives automatic lane priority. Each metric's attainment is
 * capped first (see KPI_ATTAINMENT_CAP), then weighted, then normalised back
 * into 0–1 so a perfect-everywhere score is 1.0 and a cap-everywhere score is
 * also 1.0 — the cap limits influence, it does not grant a bonus.
 */
export function kpiScore(counts: KpiCounts, targets: KpiTargets): number {
  let weighted = 0;
  for (const metric of KPI_METRICS) {
    const ratio = attainment(counts[metric], targets[metric]);
    weighted += Math.min(ratio, KPI_ATTAINMENT_CAP) * KPI_WEIGHTS[metric];
  }
  return Math.min(weighted, 1);
}

export interface ScoredEmployee {
  uid: string;
  score: number;
}

/**
 * Turns this month's scores into lane priorities (1 = first in line for leads).
 *
 * Ranking, not banding: the best performer always gets priority 1 even in a
 * weak month, and the lane always ends up spread across distinct priorities
 * rather than collapsing everyone onto the same number — which is what the
 * distribution rotation needs to break ties predictably.
 *
 * Ties are broken by uid so the result is stable across runs; without that,
 * two employees on identical scores would swap lanes on every recalculation
 * and each swap would look like a real change in the audit trail.
 */
export function priorityFromScores(
  scored: ScoredEmployee[],
  minPriority: number,
  maxPriority: number
): Map<string, number> {
  const ranked = [...scored].sort(
    (a, b) => b.score - a.score || a.uid.localeCompare(b.uid)
  );

  const result = new Map<string, number>();
  ranked.forEach((employee, index) => {
    result.set(employee.uid, Math.min(minPriority + index, maxPriority));
  });
  return result;
}

/**
 * The Firestore document id for a month's counters: `2026-08`.
 *
 * Sortable as a string, which is what makes "every month this year" a single
 * range query instead of twelve lookups.
 */
export function monthKey(year: number, month1to12: number): string {
  return `${year}-${String(month1to12).padStart(2, '0')}`;
}

/** Splits `2026-08` back into its parts; null if it isn't a month key. */
export function parseMonthKey(key: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return { year, month };
}

export const MONTH_SHORT_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;
