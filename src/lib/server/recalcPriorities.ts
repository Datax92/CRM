import 'server-only';

import { adminDb } from '@/lib/firebase/server';
import { FieldValue } from 'firebase-admin/firestore';
import { MIN_PRIORITY, MAX_PRIORITY } from '@/lib/constants/distribution';
import { karachiMonthKey } from '@/lib/dates';
import {
  DEFAULT_KPI_TARGETS,
  EMPTY_KPI_COUNTS,
  kpiScore,
  priorityFromScores,
  type KpiCounts,
  type KpiTargets,
} from '@/lib/kpi';

export interface PriorityChange {
  uid: string;
  name: string;
  from: number;
  to: number;
  score: number;
}

export interface RecalcResult {
  changes: PriorityChange[];
  /** How many employees were in scope — not how many moved. */
  evaluated: number;
  monthKey: string;
}

/** Targets are the denominator of every KPI, so a missing one falls back. */
export function normalizeTargets(input: Partial<KpiTargets> | undefined): KpiTargets {
  // Revenue targets are in rupees, so they need a far higher ceiling than a
  // count of calls — one shared cap would silently clamp every money target.
  const pick = (value: unknown, fallback: number, max = 100_000) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
  };
  return {
    connects: pick(input?.connects, DEFAULT_KPI_TARGETS.connects),
    registrations: pick(input?.registrations, DEFAULT_KPI_TARGETS.registrations),
    meetings: pick(input?.meetings, DEFAULT_KPI_TARGETS.meetings),
    revenue: pick(input?.revenue, DEFAULT_KPI_TARGETS.revenue, 1_000_000_000),
  };
}

/**
 * Re-ranks the lead-distribution lane from this month's KPI performance.
 *
 * The best performer this month takes priority 1 and therefore sees new leads
 * first. Only employees left on automatic are moved: anyone an admin has
 * pinned by setting a priority by hand keeps it, and a duplicate priority
 * between a pinned and an auto-ranked employee is harmless because the
 * rotation already sorts by priority and then by uid.
 *
 * Shared by the admin's "Recalculate" button and the nightly cron so the two
 * can never diverge. Safe to run repeatedly — when nothing has moved it writes
 * only the score and the timestamp.
 */
export async function recalculatePriorities(actorUid: string): Promise<RecalcResult> {
  const monthKey = karachiMonthKey();

  const snap = await adminDb
    .collection('users')
    .where('role', '==', 'employee')
    .where('status', '==', 'ACTIVE')
    .get();

  const employees = snap.docs.map((doc) => ({
    uid: doc.id,
    name: (doc.data().name as string) ?? doc.id,
    priority: Number(doc.data().priority) || MAX_PRIORITY,
    targets: normalizeTargets(doc.data().targets),
    // Absent means automatic: employees created before this feature existed
    // have never been pinned.
    auto: doc.data().autoPriority !== false,
  }));

  const autoEmployees = employees.filter((employee) => employee.auto);
  if (autoEmployees.length === 0) {
    return { changes: [], evaluated: 0, monthKey };
  }

  const monthDocs = await adminDb.getAll(
    ...autoEmployees.map((employee) =>
      adminDb.collection('users').doc(employee.uid).collection('kpiMonths').doc(monthKey)
    )
  );

  const scored = autoEmployees.map((employee, index) => {
    const counts: KpiCounts = { ...EMPTY_KPI_COUNTS, ...(monthDocs[index].data() ?? {}) };
    return { ...employee, score: kpiScore(counts, employee.targets) };
  });

  const assigned = priorityFromScores(
    scored.map(({ uid, score }) => ({ uid, score })),
    MIN_PRIORITY,
    MAX_PRIORITY
  );

  const changes: PriorityChange[] = [];
  const batch = adminDb.batch();

  for (const employee of scored) {
    const next = assigned.get(employee.uid);
    if (next === undefined) continue;

    batch.update(adminDb.collection('users').doc(employee.uid), {
      kpiScore: employee.score,
      priorityRecalculatedAt: FieldValue.serverTimestamp(),
      ...(next === employee.priority ? {} : { priority: next }),
    });

    if (next !== employee.priority) {
      changes.push({
        uid: employee.uid,
        name: employee.name,
        from: employee.priority,
        to: next,
        score: employee.score,
      });
    }
  }

  await batch.commit();

  // Only a change is worth an alert; a run that confirmed the existing order
  // is not news, and a nightly "nothing happened" notification would train
  // the admin to ignore the ones that matter.
  if (changes.length > 0) {
    await adminDb.collection('notifications').add({
      type: 'PRIORITY_RECALCULATED',
      leadId: '',
      targetRole: 'admin',
      payload: {
        message: `Lane priority updated for ${changes.length} employee${
          changes.length === 1 ? '' : 's'
        } from ${monthKey} KPIs.`,
        changes,
      },
      actorUid,
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
    });
  }

  return { changes, evaluated: scored.length, monthKey };
}
