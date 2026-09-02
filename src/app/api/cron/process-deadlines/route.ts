import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/server';
import { FieldValue, Transaction, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  getNextAssigneeAndState,
  resolveCascadeAssignee,
  type Employee,
  type CycleState,
} from '@/lib/distribution';
import { ACCEPT_WINDOW_MS, ACCEPT_WINDOW_MINUTES } from '@/lib/constants/distribution';
import { ACTIVE_STATUSES } from '@/lib/leadStatus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_NO_FOLLOWUP_HOURS = 24; // FR-18 default, overridable via config
const BATCH_LIMIT = 200;

/**
 * The deadline sweep — the engine behind BR-4 through BR-9 and FR-18.
 *
 * architecture.md §6 specifies Cloud Tasks, one durable job per deadline. This
 * build runs on Vercel without Cloud Functions, so the equivalent guarantee is
 * achieved differently: deadlines are stored as timestamps on the lead document
 * and a scheduled sweep acts on whatever has expired. That survives redeploys
 * for the same reason Cloud Tasks does — nothing is held in memory — but it
 * trades precision for simplicity: a deadline fires on the next sweep, so the
 * effective window is the SLA plus up to one cron interval.
 *
 * Every handler re-checks the lead's current state inside a transaction, so
 * overlapping or repeated invocations are harmless.
 */
export async function GET(request: Request) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  const startedAt = Date.now();

  try {
    const [autoAssigned, reassigned, reminded] = await Promise.all([
      processExpiredNewLeads(),
      processExpiredAssignments(),
      processStaleLeads(),
    ]);

    return NextResponse.json({
      ok: true,
      autoAssigned,
      reassigned,
      noFollowUpAlerts: reminded,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('[cron:process-deadlines]', error);
    return NextResponse.json({ ok: false, error: 'Sweep failed' }, { status: 500 });
  }
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when the
 * environment variable is set. Any other scheduler must send the same header.
 *
 * Fails closed when the secret is missing: an unauthenticated endpoint here
 * would let anyone on the internet trigger mass lead reassignment.
 */
function rejectUnauthorized(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — refusing to run.');
    return NextResponse.json(
      { ok: false, error: 'Scheduler is not configured.' },
      { status: 503 }
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

/** BR-5: the admin's 5 minutes elapsed, so auto-distribution takes over. */
async function processExpiredNewLeads(): Promise<number> {
  const expired = await adminDb
    .collection('leads')
    .where('status', '==', 'NEW')
    .where('adminAssignDeadlineAt', '<', new Date())
    .limit(BATCH_LIMIT)
    .get();

  let count = 0;
  for (const doc of expired.docs) {
    try {
      if (await autoAssignLead(doc.id)) count++;
    } catch (error) {
      console.error(`[cron] Auto-assign failed for lead ${doc.id}:`, error);
    }
  }
  return count;
}

/** BR-8/BR-9: the employee's accept window elapsed without acceptance. */
async function processExpiredAssignments(): Promise<number> {
  const expired = await adminDb
    .collection('leads')
    .where('status', '==', 'ASSIGNED')
    .where('acceptDeadlineAt', '<', new Date())
    .limit(BATCH_LIMIT)
    .get();

  let count = 0;
  for (const doc of expired.docs) {
    try {
      if (await reassignExpiredLead(doc.id)) count++;
    } catch (error) {
      console.error(`[cron] Reassignment failed for lead ${doc.id}:`, error);
    }
  }
  return count;
}

async function autoAssignLead(leadId: string): Promise<boolean> {
  return adminDb.runTransaction(async (t: Transaction) => {
    const leadRef = adminDb.collection('leads').doc(leadId);
    const leadSnap = await t.get(leadRef);

    // Idempotency guard: an admin may have assigned it since the query ran.
    if (!leadSnap.exists || leadSnap.data()?.status !== 'NEW') return false;

    const lead = leadSnap.data()!;
    const { employees, cycleState, configRef } = await readDistributionState(t);

    const { uid: assignee, newState } = getNextAssigneeAndState(employees, cycleState);

    if (!assignee) {
      // PRD §8 open question 4: rather than looping, park it for the admin.
      t.update(leadRef, {
        status: 'UNASSIGNED_NO_CAPACITY',
        adminAssignDeadlineAt: FieldValue.delete(),
      });
      t.create(leadRef.collection('events').doc(), {
        type: 'AUTO_ASSIGN_FAILED',
        actorUid: 'system:cron',
        at: FieldValue.serverTimestamp(),
        meta: { reason: 'No active employee available' },
      });
      createNotification(t, {
        type: 'UNASSIGNED_LEAD',
        leadId,
        message: `No active employee was available for "${lead.name ?? leadId}". Assign it manually.`,
      });
      return true;
    }

    const now = FieldValue.serverTimestamp();
    t.update(leadRef, {
      assignedUserId: assignee,
      assignedAt: now,
      lastActivityAt: now,
      distributionMethod: 'AUTO',
      status: 'ASSIGNED',
      acceptDeadlineAt: new Date(Date.now() + ACCEPT_WINDOW_MS),
      adminAssignDeadlineAt: FieldValue.delete(),
      autoRotationCycleSnapshot: newState,
      attemptedAssignees: FieldValue.arrayUnion(assignee),
    });

    t.create(leadRef.collection('events').doc(), {
      type: 'AUTO_ASSIGNED',
      actorUid: 'system:cron',
      at: now,
      meta: { assignedTo: assignee, rotationCounts: newState },
    });

    createNotification(t, {
      type: 'NEW_LEAD_ASSIGNED',
      leadId,
      targetRole: 'employee',
      targetUid: assignee,
      message: `You have been assigned a new lead: ${lead.name ?? leadId}. You have ${ACCEPT_WINDOW_MINUTES} minutes to accept.`,
    });

    t.set(configRef, { cycleState: newState, updatedAt: now }, { merge: true });
    return true;
  });
}

async function reassignExpiredLead(leadId: string): Promise<boolean> {
  return adminDb.runTransaction(async (t: Transaction) => {
    const leadRef = adminDb.collection('leads').doc(leadId);
    const leadSnap = await t.get(leadRef);

    if (!leadSnap.exists || leadSnap.data()?.status !== 'ASSIGNED') return false;

    const lead = leadSnap.data()!;
    const previousAssignee: string | null = lead.assignedUserId ?? null;

    // Everyone who has already been offered this lead and let it lapse. Without
    // this, two employees hand a lead back and forth indefinitely, raising a red
    // flag on every pass.
    const attempted: string[] = Array.isArray(lead.attemptedAssignees)
      ? lead.attemptedAssignees
      : previousAssignee
        ? [previousAssignee]
        : [];

    const { employees } = await readDistributionState(t);
    // The cascade runs on priority alone and never touches the rotation
    // counters: a missed lead must not consume the turn of whoever cleans it up.
    const { uid: nextAssignee, forced } = resolveCascadeAssignee(employees, attempted);

    const now = FieldValue.serverTimestamp();

    let employeeName = 'Unknown Employee';
    if (previousAssignee) {
      const employeeRef = adminDb.collection('users').doc(previousAssignee);
      const employeeSnap = await t.get(employeeRef);
      if (employeeSnap.exists) {
        employeeName = employeeSnap.data()?.name ?? previousAssignee;
      }
      t.update(employeeRef, {
        missedLeadsCount: FieldValue.increment(1),
      });
    }

    // BR-9: every non-acceptance raises a red flag, whether or not a new
    // assignee was found.
    t.create(leadRef.collection('events').doc(), {
      type: 'EXPIRED',
      actorUid: 'system:cron',
      at: now,
      meta: { previousAssignee, employeeName, attemptedCount: attempted.length },
    });

    createNotification(t, {
      type: 'RED_FLAG',
      leadId,
      message: `"${lead.name ?? leadId}" assigned to ${employeeName} was not accepted within ${ACCEPT_WINDOW_MINUTES} minutes.`,
      extra: {
        employeeName,
        employeeUid: previousAssignee,
        leadName: lead.name ?? leadId,
        timeAssigned: lead.assignedAt ?? null,
        acceptanceDeadline: lead.acceptDeadlineAt ?? null,
        reason: 'Expired',
      },
    });

    // Only reachable when the roster has no active employee at all — the
    // cascade's floor covers every other case.
    if (!nextAssignee) {
      t.update(leadRef, {
        status: 'UNASSIGNED_NO_CAPACITY',
        assignedUserId: null,
        acceptDeadlineAt: FieldValue.delete(),
        adminAssignDeadlineAt: FieldValue.delete(),
      });

      createNotification(t, {
        type: 'UNASSIGNED_LEAD',
        leadId,
        message: `"${lead.name ?? leadId}" could not be reassigned — there is no active employee. Assign it manually.`,
      });
      return true;
    }

    // End of the lane. Nobody is left below this employee, so the lead is
    // theirs outright — accepted on assignment, no window, nothing to decline.
    if (forced) {
      t.update(leadRef, {
        assignedUserId: nextAssignee,
        assignedAt: now,
        acceptedAt: now,
        lastActivityAt: now,
        distributionMethod: 'AUTO_REASSIGN',
        status: 'ACCEPTED',
        acceptDeadlineAt: FieldValue.delete(),
        attemptedAssignees: FieldValue.arrayUnion(nextAssignee),
      });

      t.create(leadRef.collection('events').doc(), {
        type: 'FORCE_ACCEPTED',
        actorUid: 'system:cron',
        at: now,
        meta: { from: previousAssignee, to: nextAssignee, reason: 'End of priority lane' },
      });

      createNotification(t, {
        type: 'NEW_LEAD_ASSIGNED',
        leadId,
        targetRole: 'employee',
        targetUid: nextAssignee,
        message: `"${lead.name ?? leadId}" was assigned to you and accepted automatically — it reached the end of the priority lane.`,
      });

      return true;
    }

    t.update(leadRef, {
      assignedUserId: nextAssignee,
      assignedAt: now,
      lastActivityAt: now,
      distributionMethod: 'AUTO_REASSIGN',
      status: 'ASSIGNED',
      acceptDeadlineAt: new Date(Date.now() + ACCEPT_WINDOW_MS),
      attemptedAssignees: FieldValue.arrayUnion(nextAssignee),
    });

    t.create(leadRef.collection('events').doc(), {
      type: 'AUTO_REASSIGNED',
      actorUid: 'system:cron',
      at: now,
      meta: { from: previousAssignee, to: nextAssignee },
    });

    createNotification(t, {
      type: 'NEW_LEAD_ASSIGNED',
      leadId,
      targetRole: 'employee',
      targetUid: nextAssignee,
      message: `You have been reassigned a lead: ${lead.name ?? leadId}. You have ${ACCEPT_WINDOW_MINUTES} minutes to accept.`,
    });

    return true;
  });
}

/**
 * FR-18 / BR-21: a lead sitting with an employee and no logged activity.
 *
 * `lastActivityAt` is stamped at assignment and refreshed by every follow-up,
 * so this is one indexed query rather than a subcollection read per lead.
 * The notification id is derived from the lead, so a lead that stays stale
 * across many sweeps updates a single alert instead of flooding the panel.
 */
async function processStaleLeads(): Promise<number> {
  const hours = await readMonitoringWindowHours();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const stale = await adminDb
    .collection('leads')
    .where('status', 'in', ACTIVE_STATUSES)
    .where('lastActivityAt', '<', cutoff)
    .limit(BATCH_LIMIT)
    .get();

  if (stale.empty) return 0;

  const batch = adminDb.batch();
  let count = 0;

  for (const doc of stale.docs) {
    const lead = doc.data();
    const ref = adminDb.collection('notifications').doc(`nofollowup_${doc.id}`);

    batch.set(
      ref,
      {
        type: 'NO_FOLLOWUP',
        leadId: doc.id,
        targetRole: 'admin',
        payload: {
          message: `No follow-up logged on "${lead.name ?? doc.id}" for over ${hours} hours.`,
          assignedUserId: lead.assignedUserId ?? null,
          campaignName: lead.campaignName ?? null,
          leadStatus: lead.status,
          assignedAt: lead.assignedAt ?? null,
        },
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      },
      { merge: true }
    );
    count++;
  }

  await batch.commit();
  return count;
}

async function readDistributionState(t: Transaction) {
  const usersSnap = await t.get(adminDb.collection('users').where('role', '==', 'employee'));

  const employees: Employee[] = [];
  usersSnap.forEach((doc: QueryDocumentSnapshot) => {
    const data = doc.data();
    employees.push({
      uid: doc.id,
      priority: typeof data.priority === 'number' ? data.priority : 99,
      status: data.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    });
  });

  const configRef = adminDb.collection('config').doc('distribution');
  const configSnap = await t.get(configRef);
  const cycleState: CycleState = configSnap.exists ? (configSnap.data()?.cycleState ?? {}) : {};

  return { employees, cycleState, configRef };
}

/** FR-18 says the monitoring period is configurable; this is where it comes from. */
async function readMonitoringWindowHours(): Promise<number> {
  try {
    const snap = await adminDb.collection('config').doc('monitoring').get();
    const value = Number(snap.data()?.noFollowUpHours);
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_NO_FOLLOWUP_HOURS;
}

function createNotification(
  t: Transaction,
  input: { type: string; leadId: string; message: string; targetRole?: string; targetUid?: string; extra?: Record<string, unknown> }
) {
  t.create(adminDb.collection('notifications').doc(), {
    type: input.type,
    leadId: input.leadId,
    targetRole: input.targetRole ?? 'admin',
    ...(input.targetUid ? { targetUid: input.targetUid } : {}),
    payload: { message: input.message, ...(input.extra ?? {}) },
    createdAt: FieldValue.serverTimestamp(),
    readAt: null,
  });
}
