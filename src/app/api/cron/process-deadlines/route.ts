import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/server';
import { FieldValue, Transaction, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  getNextAssigneeAndState,
  resolveCascadeAssignee,
  laneDisplayName,
  normalizeLaneUids,
  type CycleState,
} from '@/lib/distribution';
import { readLaneRoster } from '@/lib/server/laneRoster';
import { ACCEPT_WINDOW_MS, ACCEPT_WINDOW_MINUTES } from '@/lib/constants/distribution';
import { ACTIVE_STATUSES } from '@/lib/leadStatus';
import { karachiDayKey } from '@/lib/dates';
import { DEFAULT_NO_CONTACT_DAYS } from '@/lib/constants/monitoring';
import { owningSubAdminFor } from '@/lib/constants/hierarchy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
      remindUncontactedLeads(),
    ]);

    return NextResponse.json({
      ok: true,
      autoAssigned,
      reassigned,
      noContactReminders: reminded,
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
    // The lead's own routing, if it came from a folder restricted to certain
    // people — see `lib/server/laneRoster`.
    const { employees, recipients, cycleState, configRef, cyclePatch } =
      await readDistributionState(t, lead);

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
      ...stampFor(recipients, assignee),
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
      targetRole: recipients.get(assignee)?.targetRole ?? 'employee',
      targetUid: assignee,
      message: `You have been assigned a new lead: ${lead.name ?? leadId}. You have ${ACCEPT_WINDOW_MINUTES} minutes to accept.`,
    });

    t.set(configRef, cyclePatch(newState, now), { merge: true });
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

    // Restricted to the folder's own people when the lead carries them, so a
    // lead the admin routed to one desk never cascades off it.
    const { employees, recipients } = await readDistributionState(t, lead);
    // The cascade runs on priority alone and never touches the rotation
    // counters: a missed lead must not consume the turn of whoever cleans it up.
    const { uid: nextAssignee, wrapped } = resolveCascadeAssignee(employees, attempted);

    const now = FieldValue.serverTimestamp();

    /*
      **A miss is flagged and charged once per person per lead, not once per
      hop** — the change the loop forces.

      The lane no longer ends: a lead nobody accepts goes round again, so at a
      five-minute sweep the same person can let the same lead lapse ~40 times a
      day. Red-flagging each one would bury the panel and multiply
      `missedLeadsCount` by however long the lead went unclaimed, which is a
      measure of the lane's luck rather than of the person. `missedAssignees`
      is the ledger of who has already been charged for this lead.
    */
    const alreadyMissed: string[] = Array.isArray(lead.missedAssignees) ? lead.missedAssignees : [];
    const firstMiss = Boolean(previousAssignee) && !alreadyMissed.includes(previousAssignee!);

    let employeeName = 'Unknown Employee';
    if (previousAssignee) {
      const employeeRef = adminDb.collection('users').doc(previousAssignee);
      const employeeSnap = await t.get(employeeRef);
      if (employeeSnap.exists) {
        employeeName = employeeSnap.data()?.name ?? previousAssignee;
      }
      if (firstMiss) {
        t.update(employeeRef, {
          missedLeadsCount: FieldValue.increment(1),
        });
      }
    }

    // The event is written every time: the audit trail is where "this lead has
    // been round the lane four times" has to be legible, and an event costs
    // one write with nobody's attention attached to it.
    t.create(leadRef.collection('events').doc(), {
      type: 'EXPIRED',
      actorUid: 'system:cron',
      at: now,
      meta: { previousAssignee, employeeName, attemptedCount: attempted.length, wrapped, repeat: !firstMiss },
    });

    // BR-9: a non-acceptance raises a red flag — the first time this person
    // lets this lead go, and not on every later lap.
    if (firstMiss) {
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
    }

    // Only reachable when the roster has no active employee at all. With
    // anybody in the lane the cascade loops instead, so this is the one way a
    // lead still reaches UNASSIGNED_NO_CAPACITY.
    if (!nextAssignee) {
      t.update(leadRef, {
        status: 'UNASSIGNED_NO_CAPACITY',
        assignedUserId: null,
        assigneeName: null,
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

    /*
      **Always an offer, never a forced hand-out.** The lead moves to the next
      person with a fresh window; when the lane wrapped, `attemptedAssignees`
      is replaced rather than added to, so the new lap starts with only the
      person now holding it and the lane can go round again.
    */
    const lap = (Number(lead.cascadeLap) || 0) + (wrapped ? 1 : 0);

    t.update(leadRef, {
      assignedUserId: nextAssignee,
      ...stampFor(recipients, nextAssignee),
      assignedAt: now,
      lastActivityAt: now,
      distributionMethod: 'AUTO_REASSIGN',
      status: 'ASSIGNED',
      acceptDeadlineAt: new Date(Date.now() + ACCEPT_WINDOW_MS),
      attemptedAssignees: wrapped ? [nextAssignee] : FieldValue.arrayUnion(nextAssignee),
      // How many complete laps of the lane this lead has been round. Nothing
      // acts on it — it is what makes "this has been going round for hours"
      // answerable from the record rather than from counting events.
      cascadeLap: lap,
      ...(firstMiss && previousAssignee
        ? { missedAssignees: FieldValue.arrayUnion(previousAssignee) }
        : {}),
    });

    t.create(leadRef.collection('events').doc(), {
      type: 'AUTO_REASSIGNED',
      actorUid: 'system:cron',
      at: now,
      meta: { from: previousAssignee, to: nextAssignee, wrapped, lap },
    });

    createNotification(t, {
      type: 'NEW_LEAD_ASSIGNED',
      leadId,
      targetRole: recipients.get(nextAssignee)?.targetRole ?? 'employee',
      targetUid: nextAssignee,
      message: `You have been reassigned a lead: ${lead.name ?? leadId}. You have ${ACCEPT_WINDOW_MINUTES} minutes to accept.`,
    });

    return true;
  });
}

/**
 * FR-18 / BR-21 - **the reminder for a lead that has gone quiet.**
 *
 * *"If on a lead that we contacted and forgot to contact again after 7 days of
 * no contact, a reminder should be sent to the person it is assigned to"* -
 * the owner, 2026-09-22. That is a change of recipient as much as of interval:
 * this swept at 24 hours and told the **admin**, which answered a management
 * question ("which leads are going quiet") rather than prompting the one person
 * who can pick up the phone. It now writes to the lead's owner, and the admin's
 * panel carries the five alerts they asked for instead.
 *
 * **Only leads somebody has actually spoken to.** A lead with no entries has
 * never been contacted, so it is not a forgotten one - it is waiting on its
 * first call, which the accept window and the lane already chase.
 *
 * **It runs at most once a Karachi day, whatever the schedule.** The deadline
 * half of this route has to run every few minutes - the accept window is five -
 * but this half asks a question about the last week and writes a document per
 * quiet lead every time it runs. Measured on the live project on 2026-09-12:
 * **165 stale leads**, so on a five-minute schedule it would spend ~47,500
 * writes a day against a 20,000 cap and take the whole app down. The gate is a
 * marker document rather than an hour comparison, so a missed run, a retry or a
 * schedule change cannot make it run twice or skip a day.
 *
 * **And a lead is reminded about at most once per window.**
 * `noContactRemindedAt` is what stops a seven-day silence producing seven
 * identical alerts; the notification id is derived from the lead as well, so
 * even a double run updates one row rather than stacking.
 */
async function remindUncontactedLeads(): Promise<number> {
  const today = karachiDayKey();
  const marker = adminDb.collection('config').doc('cronState');
  const swept = (await marker.get()).data()?.staleSweepDayKey;
  if (swept === today) return 0;

  const days = await readNoContactDays();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs);

  const quiet = await readQuietLeads(cutoff);
  const markSwept = () =>
    marker.set({ staleSweepDayKey: today, staleSweptAt: FieldValue.serverTimestamp() }, { merge: true });

  if (quiet.length === 0) {
    await markSwept();
    return 0;
  }

  // One roster read for the whole sweep: the alert has to carry the right
  // `targetRole`, and a manager working their own lead is a real case.
  const roster = await adminDb.collection('users').get();
  const roles = new Map(roster.docs.map((doc) => [doc.id, doc.data()?.role as string | undefined]));

  const batch = adminDb.batch();
  let count = 0;

  for (const doc of quiet) {
    const lead = doc.data();
    const owner: string | null = lead.assignedUserId ?? null;

    // Nobody to remind. An unassigned lead is the lane's problem rather than a
    // forgotten call, and inventing a recipient for it would be worse.
    if (!owner) continue;
    // Never contacted - see above.
    if ((Number(lead.followUpCount) || 0) < 1) continue;

    // Re-checked here whichever query found it, so the fallback below can be a
    // wider net without ever reminding somebody about a lead they rang today.
    const lastContact = millisOf(lead.lastFollowUpAt);
    if (lastContact === null || lastContact > cutoff.getTime()) continue;

    // Already reminded inside this window.
    const remindedAt = millisOf(lead.noContactRemindedAt);
    if (remindedAt !== null && Date.now() - remindedAt < windowMs) continue;

    const silentDays = Math.floor((Date.now() - lastContact) / (24 * 60 * 60 * 1000));

    batch.set(
      adminDb.collection('notifications').doc(`nocontact_${doc.id}`),
      {
        type: 'LEAD_NO_CONTACT',
        leadId: doc.id,
        targetRole: roles.get(owner) === 'subadmin' ? 'subadmin' : 'employee',
        targetUid: owner,
        payload: {
          message: `${lead.name ?? doc.id} has not been contacted for ${silentDays} days. Give them a call, or log where it stands.`,
          silentDays,
          // When it actually went quiet, from the lead itself. `createdAt`
          // below is rewritten by each reminder, so it says when the alert was
          // last raised rather than when the client was last spoken to.
          lastContactAt: lead.lastFollowUpAt ?? null,
          leadStatus: lead.status,
          leadName: lead.name ?? null,
        },
        createdAt: FieldValue.serverTimestamp(),
        // Reset, so a reminder that has come round again is unread again.
        readAt: null,
      },
      { merge: true }
    );
    batch.update(doc.ref, { noContactRemindedAt: FieldValue.serverTimestamp() });
    count++;
  }

  await batch.commit();
  // Marked after the commit: a failed sweep must be retried, not recorded as
  // done. Re-running the same day is idempotent anyway - the ids are derived.
  await markSwept();
  return count;
}

/**
 * The leads that have gone quiet, by the best query this project can serve.
 *
 * **`lastFollowUpAt` is the right field and its index is not deployed yet**, so
 * the ideal query is tried and a missing index degrades to the indexed
 * `lastActivityAt` one rather than taking the sweep - and with it the whole
 * cron route - down. The fallback is a **superset in time, never a wrong
 * answer**: `lastActivityAt` is refreshed by everything `lastFollowUpAt` is and
 * more, so it can miss a lead whose status was changed recently without anybody
 * ringing the client, and the caller re-checks every row against
 * `lastFollowUpAt` either way.
 *
 * `firestore.indexes.json` carries the `status, lastFollowUpAt` index - run
 * `npm run deploy:indexes` and this stops falling back.
 */
async function readQuietLeads(cutoff: Date): Promise<QueryDocumentSnapshot[]> {
  try {
    const snap = await adminDb
      .collection('leads')
      .where('status', 'in', ACTIVE_STATUSES)
      .where('lastFollowUpAt', '<', cutoff)
      .limit(BATCH_LIMIT)
      .get();
    return snap.docs;
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    const message = String((error as { message?: unknown })?.message ?? '');
    const missingIndex =
      code === 9 || code === 'failed-precondition' || /requires an index/i.test(message);
    if (!missingIndex) throw error;

    console.warn(
      '[cron] No `status, lastFollowUpAt` index - falling back to lastActivityAt. Run npm run deploy:indexes.'
    );
    const snap = await adminDb
      .collection('leads')
      .where('status', 'in', ACTIVE_STATUSES)
      .where('lastActivityAt', '<', cutoff)
      .limit(BATCH_LIMIT)
      .get();
    return snap.docs;
  }
}

/** A Firestore timestamp, a serialised one, or nothing - as milliseconds. */
function millisOf(value: unknown): number | null {
  const stamp = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number } | null;
  if (!stamp) return null;
  if (typeof stamp.toMillis === 'function') return stamp.toMillis();
  if (typeof stamp.toDate === 'function') {
    const date = stamp.toDate();
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  if (typeof stamp.seconds === 'number') return stamp.seconds * 1000;
  return null;
}

interface LeadRecipient {
  assigneeName: string | null;
  subAdminUid: string | null;
  /** `admin` is reachable only through a folder restricted to them by name. */
  targetRole: 'employee' | 'subadmin' | 'admin';
}

/** The fields a lead takes on when it lands with `uid`. */
function stampFor(recipients: Map<string, LeadRecipient>, uid: string) {
  const recipient = recipients.get(uid);
  return { assigneeName: recipient?.assigneeName ?? null, subAdminUid: recipient?.subAdminUid ?? null };
}

/**
 * The roster this lead moves within, and where its rotation counter lives.
 *
 * **`readLaneRoster`, not an inline copy.** This mapping used to be written out
 * here and never read `autoAssign`, so every employee arrived as "in the lane"
 * and the rule taking somebody out of distribution silently stopped existing.
 * It now lives in one module beside the rule it feeds, where the tests can
 * reach it — and it is the same module that applies a folder's restriction, so
 * a lead cannot cascade out of the group it was routed to.
 */
async function readDistributionState(
  t: Transaction,
  lead?: { laneUids?: unknown; dataBankFolderId?: unknown }
) {
  const restrictedTo = normalizeLaneUids(lead?.laneUids);
  const { employees, profiles } = await readLaneRoster(t, restrictedTo);

  // What a lead carries when it lands with somebody, from the same snapshot,
  // so moving a lead never costs another read.
  const recipients = new Map<string, LeadRecipient>();
  profiles.forEach((data, uid) => {
    recipients.set(uid, {
      assigneeName: laneDisplayName(data),
      // The lead files under the recipient's team — the manager's own uid when
      // the recipient is a manager, or a Sales manager could not read it.
      subAdminUid: owningSubAdminFor({ uid, role: data.role, subAdminUid: data.subAdminUid ?? null }),
      targetRole: data.role === 'subadmin' ? 'subadmin' : data.role === 'admin' ? 'admin' : 'employee',
    });
  });

  const configRef = adminDb.collection('config').doc('distribution');
  const configSnap = await t.get(configRef);
  const config = configSnap.exists ? (configSnap.data() ?? {}) : {};

  /*
    **A restricted folder counts its turns separately.** Spending somebody's
    lane turn on a lead that only ever went to their dedicated group would skip
    them for the next ordinary lead — a dedicated folder would quietly cost them
    their place in the general queue.
  */
  const folderKey = String(lead?.dataBankFolderId ?? '');
  const restricted = restrictedTo.length > 0 && Boolean(folderKey);
  const cycleState: CycleState =
    (restricted
      ? (config.folderCycleState as Record<string, CycleState> | undefined)?.[folderKey]
      : (config.cycleState as CycleState | undefined)) ?? {};

  /** The merge payload that records the advanced rotation, on the right counter. */
  const cyclePatch = (newState: CycleState, at: FieldValue) =>
    restricted
      ? { folderCycleState: { [folderKey]: newState }, updatedAt: at }
      : { cycleState: newState, updatedAt: at };

  return { employees, recipients, cycleState, configRef, cyclePatch };
}

/** FR-18 says the window is configurable; Settings writes it, this reads it. */
async function readNoContactDays(): Promise<number> {
  try {
    const snap = await adminDb.collection('config').doc('monitoring').get();
    const value = Number(snap.data()?.noContactDays);
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    // Fall through to the default: a config read that fails must neither
    // silence the reminder nor flood anybody.
  }
  return DEFAULT_NO_CONTACT_DAYS;
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
