import 'server-only';

import { adminDb } from '@/lib/firebase/server';
import { FieldValue } from 'firebase-admin/firestore';
import { MIN_PRIORITY, MAX_PRIORITY } from '@/lib/constants/distribution';
import { karachiMonthKey } from '@/lib/dates';
import {
  DEFAULT_KPI_TARGETS,
  type KpiTargets,
} from '@/lib/kpi';
import { assignPriorities, leadScore, readLeadActivity } from '@/lib/leadPriority';

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
 * first. Anyone an admin has pinned keeps the priority they were given — see
 * `assignPriorities`, which fills the remaining places around them so no two
 * people end up sharing one.
 *
 * **The score is connected calls and follow-ups, not the KPI blend.** It used
 * to run on `kpiScore`, which weighs connects, closed deals and meetings
 * 40/40/20 — a fair measure of a salesperson, and the wrong measure for *this*
 * question. The lane decides who gets the **next lead**, so it should reward
 * the person working the leads they already have: `connects × 2 + follow-ups −
 * passes × 2`. Closing a deal still matters everywhere else; it just does not
 * buy you a place at the front of the queue. See `lib/leadPriority`.
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

  const scored = autoEmployees.map((employee, index) => ({
    ...employee,
    score: leadScore(readLeadActivity(monthDocs[index].data())),
  }));

  /*
    Pinned employees are passed in too, even though they are not re-ranked:
    `assignPriorities` needs to know which places are already taken, or an
    automatic employee would be handed a number somebody is already holding.
  */
  const assigned = assignPriorities(
    [
      ...scored.map(({ uid, score }) => ({ uid, score })),
      ...employees
        .filter((employee) => !employee.auto)
        .map(({ uid, priority }) => ({ uid, score: 0, autoPriority: false as const, priority })),
    ],
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
        } from ${monthKey} connects and follow-ups.`,
        changes,
      },
      actorUid,
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
    });
  }

  return { changes, evaluated: scored.length, monthKey };
}
