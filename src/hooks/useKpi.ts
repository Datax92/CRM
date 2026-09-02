'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError } from './useLeads';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';
import { karachiMonthKey, karachiMonthsElapsed, karachiYear } from '@/lib/dates';
import {
  DEFAULT_KPI_TARGETS,
  EMPTY_KPI_COUNTS,
  MONTH_SHORT_LABELS,
  monthKey,
  parseMonthKey,
  overallAttainment,
  readAllKpis,
  sumCounts,
  ytdTargets,
  type KpiCounts,
  type KpiReading,
  type KpiTargets,
} from '@/lib/kpi';

export interface KpiMonthRecord extends KpiCounts {
  monthKey: string;
  /** Revenue split by deal category — Rental / Installment / Investment. */
  portfolio?: Record<string, number>;
}

export interface MonthlyPoint {
  monthKey: string;
  label: string;
  counts: KpiCounts;
}

export interface KpiSummary {
  mtd: KpiCounts;
  ytd: KpiCounts;
  mtdTargets: KpiTargets;
  ytdTargets: KpiTargets;
  mtdReadings: KpiReading[];
  ytdReadings: KpiReading[];
  /** All twelve months of the current year, January first; future months zero. */
  byMonth: MonthlyPoint[];
  /** Weighted, uncapped attainment across the three KPIs. 1 = on target. */
  mtdOverall: number;
  ytdOverall: number;
  /** The year these figures cover. */
  year: number;
  /** Year-to-date revenue by deal category. */
  portfolio: Record<string, number>;
  loading: boolean;
  error: string | null;
}

/** Firestore documents arrive untyped; coerce every counter to a real number. */
function toRecord(id: string, data: Record<string, unknown>): KpiMonthRecord {
  const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const rawPortfolio = (data.portfolio ?? {}) as Record<string, unknown>;

  return {
    monthKey: typeof data.monthKey === 'string' ? data.monthKey : id,
    calls: num(data.calls),
    connects: num(data.connects),
    registrations: num(data.registrations),
    meetings: num(data.meetings),
    revenue: num(data.revenue),
    portfolio: Object.fromEntries(
      Object.entries(rawPortfolio).map(([key, value]) => [key, num(value)])
    ),
  };
}

/**
 * One employee's KPI history for the current year.
 *
 * Reads the pre-aggregated `users/{uid}/kpiMonths` counters rather than
 * scanning follow-ups and deals. Those counters are written inside the same
 * transaction as the work they count, so they cannot drift, and reading a
 * year costs one small query instead of a collection-group scan across every
 * lead the employee has ever touched.
 */
export function useEmployeeKpi(uid: string | undefined, targets?: KpiTargets): KpiSummary {
  const [state, setState] = useState<{ key: string; months: KpiMonthRecord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const demoState = useDemoState();
  const key = uid ?? 'idle';

  useEffect(() => {
    if (IS_DEMO || !uid) return;

    const unsubscribe = onSnapshot(
      collection(db, 'users', uid, 'kpiMonths'),
      (snap) => {
        setState({
          key: uid,
          months: snap.docs.map((doc) => toRecord(doc.id, doc.data())),
        });
      },
      (err) => {
        console.error('[useEmployeeKpi]', err);
        setState({ key: uid, months: [] });
        setError(describeFirestoreError(err));
      }
    );

    return () => unsubscribe();
  }, [uid]);

  const months = useMemo<KpiMonthRecord[]>(() => {
    if (IS_DEMO) {
      return uid ? Object.values(demoState.kpiMonths[uid] ?? {}) : [];
    }
    return state?.key === key ? state.months : [];
  }, [state, key, uid, demoState.kpiMonths]);

  const loading = IS_DEMO ? false : Boolean(uid) && state?.key !== key;

  return useSummary(months, targets, loading, IS_DEMO ? null : error);
}

/**
 * The whole team's KPI history, summed — what an admin sees on the dashboard.
 *
 * Targets add up too: a company target of "8 registrations" means nothing, but
 * eight employees on eight each is a company target of 64.
 */
/**
 * The whole team's KPI, or one sub admin's slice of it.
 *
 * `teamOf` narrows the roster query to `subAdminUid == uid`, which is the same
 * constraint the Security Rule checks — a sub admin's browser cannot list the
 * full roster, so filtering afterwards would not merely be wasteful, the query
 * would be refused outright.
 */
export function useTeamKpi(
  enabled: boolean,
  teamOf?: string | null
): KpiSummary & { headcount: number } {
  const [months, setMonths] = useState<KpiMonthRecord[] | null>(null);
  const [teamTargets, setTeamTargets] = useState<KpiTargets | null>(null);
  const [headcountState, setHeadcount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const demoState = useDemoState();

  useEffect(() => {
    if (IS_DEMO || !enabled) return;

    // Per-employee listeners are torn down and rebuilt whenever the roster
    // changes. They are held here rather than returned from the roster
    // callback: a value returned from an onSnapshot handler is discarded, so
    // doing it that way would leak a listener per roster update.
    const perUser = new Map<string, KpiMonthRecord[]>();
    let childUnsubscribers: Array<() => void> = [];

    const stopChildren = () => {
      childUnsubscribers.forEach((fn) => fn());
      childUnsubscribers = [];
    };

    // The roster is small, and each employee's counters are a handful of docs,
    // so this fans out per employee rather than needing a collection-group
    // index that would also have to be secured separately.
    const unsubscribeRoster = onSnapshot(
      teamOf
        ? query(collection(db, 'users'), where('subAdminUid', '==', teamOf))
        : query(collection(db, 'users'), where('role', '==', 'employee')),
      (rosterSnap) => {
        const uids = rosterSnap.docs.map((doc) => doc.id);
        setHeadcount(uids.length);
        setTeamTargets(
          rosterSnap.docs.reduce<KpiTargets>(
            (total, doc) => {
              const own = (doc.data().targets ?? {}) as Partial<KpiTargets>;
              return {
                connects: total.connects + (Number(own.connects) || DEFAULT_KPI_TARGETS.connects),
                registrations:
                  total.registrations + (Number(own.registrations) || DEFAULT_KPI_TARGETS.registrations),
                meetings: total.meetings + (Number(own.meetings) || DEFAULT_KPI_TARGETS.meetings),
                revenue: total.revenue + (Number(own.revenue) || DEFAULT_KPI_TARGETS.revenue),
              };
            },
            { connects: 0, registrations: 0, meetings: 0, revenue: 0 }
          )
        );

        stopChildren();
        for (const uid of [...perUser.keys()]) {
          if (!uids.includes(uid)) perUser.delete(uid);
        }

        if (uids.length === 0) {
          setMonths([]);
          return;
        }

        childUnsubscribers = uids.map((uid) =>
          onSnapshot(
            collection(db, 'users', uid, 'kpiMonths'),
            (snap) => {
              perUser.set(uid, snap.docs.map((doc) => toRecord(doc.id, doc.data())));
              setMonths([...perUser.values()].flat());
            },
            (err) => {
              console.error('[useTeamKpi]', err);
              perUser.set(uid, []);
              setMonths([...perUser.values()].flat());
              setError(describeFirestoreError(err));
            }
          )
        );
      },
      (err) => {
        console.error('[useTeamKpi:roster]', err);
        setMonths([]);
        setError(describeFirestoreError(err));
      }
    );

    return () => {
      unsubscribeRoster();
      stopChildren();
    };
  }, [enabled, teamOf]);

  const allMonths = useMemo<KpiMonthRecord[]>(() => {
    if (!enabled) return [];
    if (IS_DEMO) return Object.values(demoState.kpiMonths).flatMap((byMonth) => Object.values(byMonth));
    return months ?? [];
  }, [enabled, months, demoState.kpiMonths]);

  const targets = useMemo<KpiTargets | undefined>(() => {
    if (!enabled) return undefined;
    if (IS_DEMO) {
      return demoState.employees.reduce<KpiTargets>(
        (total, employee) => ({
          connects: total.connects + (employee.targets?.connects ?? DEFAULT_KPI_TARGETS.connects),
          registrations:
            total.registrations + (employee.targets?.registrations ?? DEFAULT_KPI_TARGETS.registrations),
          meetings: total.meetings + (employee.targets?.meetings ?? DEFAULT_KPI_TARGETS.meetings),
          revenue: total.revenue + (employee.targets?.revenue ?? DEFAULT_KPI_TARGETS.revenue),
        }),
        { connects: 0, registrations: 0, meetings: 0, revenue: 0 }
      );
    }
    return teamTargets ?? undefined;
  }, [enabled, teamTargets, demoState.employees]);

  const loading = IS_DEMO ? false : enabled && months === null;
  const summary = useSummary(allMonths, targets, loading, IS_DEMO ? null : error);

  return {
    ...summary,
    headcount: IS_DEMO ? demoState.employees.length : headcountState,
  };
}

/** Shared reduction: month documents in, dashboard-ready figures out. */
function useSummary(
  months: KpiMonthRecord[],
  targets: KpiTargets | undefined,
  loading: boolean,
  error: string | null
): KpiSummary {
  return useMemo(() => {
    const now = new Date();
    const year = karachiYear(now);
    const currentKey = karachiMonthKey(now);
    const monthsElapsed = karachiMonthsElapsed(now);
    const effectiveTargets = targets ?? DEFAULT_KPI_TARGETS;

    const thisYear = months.filter((month) => parseMonthKey(month.monthKey)?.year === year);

    // Several employees can contribute a document for the same month, so this
    // sums by key rather than assuming one document per month.
    // All twelve months, not just the elapsed ones: the year chart in the
    // design runs Jan–Dec, and a chart that grew a column each month would
    // rescale its bars every four weeks.
    const byMonth: MonthlyPoint[] = Array.from({ length: 12 }, (_, index) => {
      const key = monthKey(year, index + 1);
      return {
        monthKey: key,
        label: MONTH_SHORT_LABELS[index],
        counts: sumCounts(thisYear.filter((month) => month.monthKey === key)),
      };
    });

    const mtd = sumCounts(thisYear.filter((month) => month.monthKey === currentKey));
    const ytd = sumCounts(thisYear);

    const portfolio: Record<string, number> = {};
    for (const month of thisYear) {
      for (const [category, amount] of Object.entries(month.portfolio ?? {})) {
        portfolio[category] = (portfolio[category] ?? 0) + amount;
      }
    }

    const yearTargets = ytdTargets(effectiveTargets, monthsElapsed);

    return {
      mtd: mtd ?? EMPTY_KPI_COUNTS,
      ytd,
      mtdTargets: effectiveTargets,
      ytdTargets: yearTargets,
      mtdReadings: readAllKpis(mtd, effectiveTargets),
      ytdReadings: readAllKpis(ytd, yearTargets),
      mtdOverall: overallAttainment(mtd, effectiveTargets),
      ytdOverall: overallAttainment(ytd, yearTargets),
      year,
      byMonth,
      portfolio,
      loading,
      error,
    };
  }, [months, targets, loading, error]);
}
