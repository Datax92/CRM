"use server";

import { adminDb } from "@/lib/firebase/server";
import {
  verifyAuth,
  requireAdmin,
  requireManager,
  type DecodedAuth,
} from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { isTerminal, isUserSettable, type LeadStatus } from "@/lib/leadStatus";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/pipelineStage";
import { parseMoney } from "@/lib/money";
import { toE164Digits } from "@/lib/phone";
import { FieldValue, Transaction } from "firebase-admin/firestore";
import {
  ADMIN_ASSIGN_WINDOW_MS,
  ACCEPT_WINDOW_MINUTES,
} from "@/lib/constants/distribution";
import { startOfKarachiDay, karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { normalizeDealCategory } from "@/lib/constants/deals";

/**
 * Manual assignment inside the 5-minute window (FR-8, BR-4).
 *
 * Runs in a transaction with a status guard so it cannot race the cron sweep:
 * whichever of the two commits first wins, and the loser sees the changed
 * status and aborts. Without this, an admin clicking "Assign" at 4:59 could
 * overwrite an auto-assignment that landed at 5:00, leaving two employees
 * believing the lead is theirs.
 */
export async function assignLead(
  token: string,
  leadId: string,
  userId: string
): Promise<ActionResult> {
  return runAction("assignLead", async () => {
    // A sub admin hands out leads to their own team; the ownership check is in
    // `readAssignableEmployee` below, which refuses anyone else's employee.
    const actor = await requireManager(token);

    await adminDb.runTransaction(async (t: Transaction) => {
      const leadRef = adminDb.collection("leads").doc(leadId);
      const leadSnap = await t.get(leadRef);

      if (!leadSnap.exists) {
        throw new UserFacingError("That lead no longer exists.");
      }

      const lead = leadSnap.data()!;
      if (lead.status !== "NEW" && lead.status !== "UNASSIGNED_NO_CAPACITY") {
        throw new UserFacingError(
          `This lead has already moved on — it is now ${lead.status.replace(/_/g, " ").toLowerCase()}. Use Reassign instead.`
        );
      }

      const employee = await readAssignableEmployee(t, userId, actor);

      // An admin handing out a lead is a decision, not an offer: the lead is
      // accepted on the spot with no window to miss. Only the automatic lane
      // gives an employee a chance to decline.
      t.update(leadRef, {
        assignedUserId: userId,
        assignedAt: FieldValue.serverTimestamp(),
        acceptedAt: FieldValue.serverTimestamp(),
        // Baseline for the no-follow-up scan (FR-18) — the clock starts now.
        lastActivityAt: FieldValue.serverTimestamp(),
        distributionMethod: "MANUAL",
        status: "ACCEPTED",
        acceptDeadlineAt: FieldValue.delete(),
        adminAssignDeadlineAt: FieldValue.delete(),
        attemptedAssignees: FieldValue.arrayUnion(userId),
        ...assignmentStamp(actor, employee),
      });

      t.create(leadRef.collection("events").doc(), {
        type: "MANUALLY_ASSIGNED",
        actorUid: actor.uid,
        at: FieldValue.serverTimestamp(),
        meta: {
          assignedTo: userId,
          assigneeEmail: employee.email ?? null,
          assignedByRole: actor.role,
          assignedByName: actor.name ?? actor.email ?? null,
        },
      });

      t.create(adminDb.collection('notifications').doc(), {
        type: 'NEW_LEAD_ASSIGNED',
        leadId: leadId,
        targetRole: 'employee',
        targetUid: userId,
        payload: { message: `${lead.name ?? leadId} has been assigned to you by an admin.` },
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });
    });
  });
}

/**
 * Admin override, available at any time (FR-11, BR-22).
 *
 * Clears the attempted-assignee list: the admin is making a deliberate choice,
 * so the anti-ping-pong exclusions from earlier automatic passes no longer apply.
 */
export async function reassignLeadManual(
  token: string,
  leadId: string,
  newUserId: string
): Promise<ActionResult> {
  return runAction("reassignLeadManual", async () => {
    const actor = await requireManager(token);

    await adminDb.runTransaction(async (t: Transaction) => {
      const leadRef = adminDb.collection("leads").doc(leadId);
      const leadSnap = await t.get(leadRef);

      if (!leadSnap.exists) {
        throw new UserFacingError("That lead no longer exists.");
      }

      const lead = leadSnap.data()!;
      if (isTerminal(lead.status)) {
        throw new UserFacingError("This lead is closed and cannot be reassigned.");
      }
      if (lead.assignedUserId === newUserId) {
        throw new UserFacingError("This lead is already assigned to that employee.");
      }

      const employee = await readAssignableEmployee(t, newUserId, actor);

      // Admin override is a force accept, same as first assignment.
      t.update(leadRef, {
        assignedUserId: newUserId,
        assignedAt: FieldValue.serverTimestamp(),
        lastActivityAt: FieldValue.serverTimestamp(),
        acceptedAt: FieldValue.serverTimestamp(),
        distributionMethod: "MANUAL",
        status: "ACCEPTED",
        acceptDeadlineAt: FieldValue.delete(),
        adminAssignDeadlineAt: FieldValue.delete(),
        attemptedAssignees: [newUserId],
        ...assignmentStamp(actor, employee),
      });

      t.create(leadRef.collection("events").doc(), {
        type: "MANUALLY_REASSIGNED",
        actorUid: actor.uid,
        at: FieldValue.serverTimestamp(),
        meta: {
          previousAssignee: lead.assignedUserId ?? null,
          newAssignee: newUserId,
          assigneeEmail: employee.email ?? null,
          assignedByRole: actor.role,
          assignedByName: actor.name ?? actor.email ?? null,
        },
      });

      t.create(adminDb.collection('notifications').doc(), {
        type: 'NEW_LEAD_ASSIGNED',
        leadId: leadId,
        targetRole: 'employee',
        targetUid: newUserId,
        payload: { message: `${lead.name ?? leadId} has been reassigned to you by an admin.` },
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });
    });
  });
}

/**
 * Employee accepts a lead inside their accept window (FR-10, BR-7).
 *
 * Enforces three things the previous implementation left open: that the caller
 * is the assigned employee, that the lead is actually awaiting acceptance, and
 * that the window has not already closed.
 */
export async function acceptLead(token: string, leadId: string): Promise<ActionResult> {
  return runAction("acceptLead", async () => {
    const auth = await verifyAuth(token);

    await adminDb.runTransaction(async (t: Transaction) => {
      const leadRef = adminDb.collection("leads").doc(leadId);
      const leadSnap = await t.get(leadRef);

      if (!leadSnap.exists) {
        throw new UserFacingError("That lead no longer exists.");
      }

      const lead = leadSnap.data()!;

      if (auth.role !== "admin" && lead.assignedUserId !== auth.uid) {
        throw new UserFacingError("This lead is not assigned to you.");
      }
      if (lead.status === "ACCEPTED") {
        throw new UserFacingError("You have already accepted this lead.");
      }
      if (lead.status !== "ASSIGNED") {
        throw new UserFacingError("This lead is not waiting to be accepted.");
      }

      const deadline = lead.acceptDeadlineAt?.toDate?.() ?? lead.acceptDeadlineAt;
      if (deadline instanceof Date && deadline.getTime() < Date.now()) {
        throw new UserFacingError(
          `Your ${ACCEPT_WINDOW_MINUTES}-minute window for this lead has passed. It is being passed to the next employee.`
        );
      }

      t.update(leadRef, {
        status: "ACCEPTED",
        acceptedAt: FieldValue.serverTimestamp(),
        lastActivityAt: FieldValue.serverTimestamp(),
        acceptDeadlineAt: FieldValue.delete(),
      });

      t.create(leadRef.collection("events").doc(), {
        type: "LEAD_ACCEPTED",
        actorUid: auth.uid,
        at: FieldValue.serverTimestamp(),
        meta: { acceptedBy: auth.uid },
      });
    });
  });
}

/**
 * Status change by the assigned employee or an admin (FR-13).
 *
 * CLOSED_WON is rejected here on purpose: BR-18 requires every won deal to pass
 * through the Entry Module, so `closeDeal` is the only route into that status.
 */
export async function setLeadStatus(
  token: string,
  leadId: string,
  status: LeadStatus
): Promise<ActionResult> {
  return runAction("setLeadStatus", async () => {
    const auth = await verifyAuth(token);

    if (status === "CLOSED_WON") {
      throw new UserFacingError(
        "To mark a deal as won, use the Deal Entry tab so the customer record and amounts are captured."
      );
    }
    if (!isUserSettable(status)) {
      throw new UserFacingError("That status is managed by the system and cannot be set by hand.");
    }

    await adminDb.runTransaction(async (t: Transaction) => {
      const leadRef = adminDb.collection("leads").doc(leadId);
      const leadSnap = await t.get(leadRef);

      if (!leadSnap.exists) {
        throw new UserFacingError("That lead no longer exists.");
      }

      const lead = leadSnap.data()!;

      if (auth.role !== "admin" && lead.assignedUserId !== auth.uid) {
        throw new UserFacingError("This lead is not assigned to you.");
      }
      if (isTerminal(lead.status)) {
        throw new UserFacingError(
          "This lead is closed. Its record is kept as-is — add a follow-up note if something changed."
        );
      }
      if (lead.status === "ASSIGNED") {
        throw new UserFacingError("Accept this lead before updating its status.");
      }
      if (lead.status === status) {
        return;
      }

      t.update(leadRef, {
        status,
        // **When token money arrived**, stamped one-way the first time the
        // status reaches it — the same pattern `meetingHeld` follows, and for
        // the same reason: the Team report counts tokens over a date range,
        // and a lead that has since moved on to Deal Closed no longer carries
        // TOKEN_RECEIVED as its status. Reading the current status alone would
        // report the token as never having happened.
        //
        // Written only when it becomes true, so moving a lead back and forth
        // cannot re-date it, and it is never unset: a token that was taken
        // stays taken.
        ...(status === "TOKEN_RECEIVED" && !lead.tokenReceivedAt
          ? { tokenReceivedAt: FieldValue.serverTimestamp(), tokenReceived: true }
          : {}),
      });

      t.create(leadRef.collection("events").doc(), {
        type: "STATUS_CHANGED",
        actorUid: auth.uid,
        at: FieldValue.serverTimestamp(),
        meta: { from: lead.status, to: status },
      });
    });
  });
}

/**
 * Pins a lead's Pipeline Stage by hand, or clears the pin.
 *
 * The stage is normally derived on read (`lib/pipelineStage`), so nothing is
 * stored for a lead following the rule. This writes only the *exception* — the
 * rep who has just had a call the follow-up count knows nothing about. Passing
 * `null` deletes the field, which is what puts the lead back under the rule;
 * writing `null` instead would leave a tombstone reading as "someone made a
 * decision here" forever.
 *
 * The retired `temperatureOverride` is deleted alongside it, so a lead pinned
 * Hot under the old vocabulary cannot keep asserting itself once someone has
 * set a stage by hand.
 */
export async function setLeadPipelineStage(
  token: string,
  leadId: string,
  stage: PipelineStage | null
): Promise<ActionResult> {
  return runAction("setLeadPipelineStage", async () => {
    const auth = await verifyAuth(token);

    if (stage !== null && !PIPELINE_STAGES.includes(stage)) {
      throw new UserFacingError("Choose Cold, P3, P2 or P1 — or Auto to follow the rule.");
    }

    await adminDb.runTransaction(async (t: Transaction) => {
      const leadRef = adminDb.collection("leads").doc(leadId);
      const leadSnap = await t.get(leadRef);

      if (!leadSnap.exists) {
        throw new UserFacingError("That lead no longer exists.");
      }

      const lead = leadSnap.data()!;

      if (!canWorkLead(auth, lead)) {
        throw new UserFacingError("This lead is not assigned to you.");
      }
      if (isTerminal(lead.status)) {
        throw new UserFacingError("This lead is closed — its pipeline stage no longer applies.");
      }

      const current = (lead.pipelineStageOverride ?? null) as PipelineStage | null;
      if (current === stage) return;

      t.update(leadRef, {
        pipelineStageOverride: stage ?? FieldValue.delete(),
        temperatureOverride: FieldValue.delete(),
      });

      t.create(leadRef.collection("events").doc(), {
        type: "PIPELINE_STAGE_CHANGED",
        actorUid: auth.uid,
        at: FieldValue.serverTimestamp(),
        meta: { from: current ?? "auto", to: stage ?? "auto" },
      });
    });
  });
}

/**
 * The Cold review (§3).
 *
 * A lead that has met the Cold rule is not moved by the rule itself — it is
 * flagged, the admin and the lead's manager are notified, and one of them
 * decides here. `verified: true` writes the Cold stage; `false` dismisses the
 * review and lets the lead keep being worked, with the flag cleared so a later
 * run of the rule can raise it again.
 *
 * **Only a manager or the admin.** The employee holding the lead is the person
 * whose work is being reviewed; letting them write off their own lead would
 * make the review a formality.
 */
export async function reviewColdLead(
  token: string,
  leadId: string,
  verified: boolean
): Promise<ActionResult> {
  return runAction("reviewColdLead", async () => {
    const actor = await requireManager(token);

    await adminDb.runTransaction(async (t: Transaction) => {
      const leadRef = adminDb.collection("leads").doc(leadId);
      const leadSnap = await t.get(leadRef);

      if (!leadSnap.exists) throw new UserFacingError("That lead no longer exists.");
      const lead = leadSnap.data()!;

      if (actor.role === "subadmin" && lead.subAdminUid !== actor.uid) {
        throw new UserFacingError("That lead is not on your team.");
      }
      if (isTerminal(lead.status)) {
        throw new UserFacingError("This lead is already closed.");
      }

      t.update(leadRef, {
        // Verified: the stage is pinned Cold. Dismissed: the flag is cleared so
        // the rule can raise it again after more fruitless follow-ups, rather
        // than the lead being quietly exempt forever.
        ...(verified
          ? { pipelineStageOverride: "COLD" }
          : { pipelineStageOverride: FieldValue.delete() }),
        coldReviewRequestedAt: FieldValue.delete(),
        coldReviewedAt: FieldValue.serverTimestamp(),
        coldReviewedByUid: actor.uid,
        lastActivityAt: FieldValue.serverTimestamp(),
      });

      t.create(leadRef.collection("events").doc(), {
        type: verified ? "COLD_VERIFIED" : "COLD_REVIEW_DISMISSED",
        actorUid: actor.uid,
        at: FieldValue.serverTimestamp(),
        meta: { followUpCount: lead.followUpCount ?? 0, byRole: actor.role },
      });

      // Tell the employee either way. A lead disappearing from their working
      // filters with no explanation is how people stop trusting the pipeline.
      if (lead.assignedUserId) {
        t.create(adminDb.collection("notifications").doc(), {
          type: verified ? "LEAD_MARKED_COLD" : "COLD_REVIEW_DISMISSED",
          leadId,
          targetRole: "employee",
          targetUid: lead.assignedUserId,
          payload: {
            message: verified
              ? `${lead.name ?? "A lead"} has been verified as Cold.`
              : `${lead.name ?? "A lead"} stays in play — the Cold review was dismissed.`,
          },
          createdAt: FieldValue.serverTimestamp(),
          readAt: null,
        });
      }
    });
  });
}

/**
 * Assigns many leads to one employee in a single call (§9, §10).
 *
 * **The leads are not copied.** Each one keeps its id, its source, its Data
 * Bank folder and its whole history; only the assignment moves. That is what
 * §10 means by the employee "receiving those exact leads" — a bulk *copy*
 * would double every figure the reports read.
 *
 * Written in batches of 400 rather than one transaction: a transaction caps
 * out well below the 100 leads this is built for, and a partial run leaves some
 * leads assigned rather than corrupting anything. Re-running finishes the job.
 */
export async function assignLeadsBulk(
  token: string,
  leadIds: string[],
  userId: string
): Promise<ActionResult<{ assigned: number; skipped: number }>> {
  return runAction("assignLeadsBulk", async () => {
    const actor = await requireManager(token);

    const ids = [...new Set((leadIds ?? []).filter(Boolean))];
    if (ids.length === 0) throw new UserFacingError("Select at least one lead.");
    if (ids.length > 500) throw new UserFacingError("Assign at most 500 leads at a time.");

    const employeeSnap = await adminDb.collection("users").doc(userId).get();
    if (!employeeSnap.exists || employeeSnap.data()?.role !== "employee") {
      throw new UserFacingError("Choose a team member to assign these to.");
    }
    const employee = employeeSnap.data()!;
    if (employee.status === "DISABLED") {
      throw new UserFacingError("That employee is paused — resume them or choose someone else.");
    }
    if (actor.role === "subadmin" && employee.subAdminUid !== actor.uid) {
      throw new UserFacingError("That team member is not on your team.");
    }

    let assigned = 0;
    let skipped = 0;

    // 400 leads per batch: each one costs two writes (the lead and its audit
    // event) plus a notification, and Firestore caps a batch at 500 operations.
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100);
      const snaps = await adminDb.getAll(...slice.map((id) => adminDb.collection("leads").doc(id)));
      const batch = adminDb.batch();
      const now = FieldValue.serverTimestamp();

      for (const snap of snaps) {
        if (!snap.exists) {
          skipped += 1;
          continue;
        }
        const lead = snap.data()!;
        // A closed lead is history (BR-22) and a lead already with this person
        // needs no write.
        if (isTerminal(lead.status) || lead.assignedUserId === userId) {
          skipped += 1;
          continue;
        }

        batch.update(snap.ref, {
          assignedUserId: userId,
          assignedAt: now,
          acceptedAt: now,
          lastActivityAt: now,
          distributionMethod: "MANUAL",
          // A hand-out is a decision, not an offer — the same force-accept
          // every other admin assignment does.
          status: "ACCEPTED",
          acceptDeadlineAt: FieldValue.delete(),
          adminAssignDeadlineAt: FieldValue.delete(),
          attemptedAssignees: [userId],
          ...assignmentStamp(actor, employee),
        });

        batch.create(snap.ref.collection("events").doc(), {
          type: "BULK_ASSIGNED",
          actorUid: actor.uid,
          at: now,
          meta: {
            previousAssignee: lead.assignedUserId ?? null,
            newAssignee: userId,
            batchSize: ids.length,
            assignedByRole: actor.role,
          },
        });

        assigned += 1;
      }

      await batch.commit();
    }

    // One notification for the batch, not one per lead. Fifty separate alerts
    // would bury everything else in the employee's bell.
    if (assigned > 0) {
      await adminDb.collection("notifications").add({
        type: "NEW_LEAD_ASSIGNED",
        leadId: ids[0],
        targetRole: "employee",
        targetUid: userId,
        payload: {
          message: `${assigned} lead${assigned === 1 ? "" : "s"} assigned to you by ${actor.name ?? actor.email ?? "an admin"}.`,
          count: assigned,
        },
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });
    }

    return { assigned, skipped };
  });
}

/**
 * Whether this caller may work this lead.
 *
 * An admin may touch anything. A sub admin may touch a lead held by one of
 * their own employees — that is the whole point of the role, and the lead
 * carries `subAdminUid` so the test is one field comparison rather than a
 * second document read. An employee may touch only their own.
 */
function canWorkLead(auth: DecodedAuth, lead: Record<string, unknown>): boolean {
  if (auth.role === "admin") return true;
  if (auth.role === "subadmin") return lead.subAdminUid === auth.uid;
  return lead.assignedUserId === auth.uid;
}

/**
 * The provenance fields written on every hand-assignment.
 *
 * Answers §9 — "who gave this lead to whom, and under which sub admin" — from
 * the lead document alone, with no join. `subAdminUid` is taken from the
 * **employee**, not from the actor: an admin assigning to somebody on Sub Admin
 * A's team means the lead belongs to that team, and a sub admin's own uid is
 * the same value by definition.
 *
 * Names are denormalised beside the uids on purpose. The assignment history has
 * to stay readable after somebody leaves the company and their profile is
 * disabled or renamed — a row that reads "assigned by <deleted uid>" is not a
 * record, it is a puzzle.
 */
function assignmentStamp(
  actor: DecodedAuth,
  employee: Record<string, unknown>
): Record<string, unknown> {
  const subAdminUid = (employee.subAdminUid as string | undefined) ?? null;

  return {
    assignedByUid: actor.uid,
    assignedByRole: actor.role,
    assignedByName: actor.name ?? actor.email ?? null,
    subAdminUid,
    assigneeName: (employee.name as string | undefined) ?? (employee.email as string | undefined) ?? null,
  };
}

/**
 * Loads a user, confirms they can receive leads, and confirms the caller is
 * entitled to give them one.
 *
 * Reads through the transaction so every check is part of the same snapshot —
 * an employee moved to another sub admin's team mid-assignment cannot slip
 * through between the permission check and the write.
 */
async function readAssignableEmployee(t: Transaction, uid: string, actor?: DecodedAuth) {
  const userSnap = await t.get(adminDb.collection("users").doc(uid));
  if (!userSnap.exists) {
    throw new UserFacingError("That employee no longer exists.");
  }

  const user = userSnap.data()!;
  if (user.role !== "employee") {
    throw new UserFacingError("Leads can only be assigned to employees.");
  }
  if (user.status === "DISABLED") {
    throw new UserFacingError("That employee is disabled and cannot receive new leads.");
  }
  // A sub admin may only feed their own team. Checked here rather than at the
  // top of the action so it reads from the transaction's snapshot.
  if (actor && actor.role === "subadmin" && user.subAdminUid !== actor.uid) {
    throw new UserFacingError("That team member is not on your team.");
  }

  return user;
}

/**
 * Manually create a lead (e.g. for importing old leads).
 */
export async function createLead(
  token: string,
  input: {
    name: string;
    phone?: string;
    email?: string;
    city?: string;
    status: LeadStatus;
    assignedUserId?: string | null;
    campaignId?: string | null;
    campaignName?: string | null;
    createdAt?: string; // ISO date string for backdating
    followUps?: Array<{ message: string; callMade: boolean; occurredAt: string }>;
    deal?: {
      serviceDescription: string;
      amountReceived: number;
      payableAmount: number;
      paymentMethod: string;
      dealDate: string;
      dealCategory?: string;
      notes?: string;
    };
  }
): Promise<ActionResult<{ leadId: string }>> {
  return runAction("createLead", async () => {
    const admin = await requireAdmin(token);
    const name = input.name.trim();
    if (!name) throw new UserFacingError("Enter the lead's name.");
    const isTerminalStatus = input.status === "CLOSED_WON" || input.status === "CLOSED_LOST" || input.status === "NOT_INTERESTED";
    // Naming an assignee at creation is an admin decision, so the lead is
    // accepted immediately rather than offered with a window (BR-4 override).
    const effectiveStatus: LeadStatus = input.assignedUserId && !isTerminalStatus ? "ACCEPTED" : input.status;
    let employeeEmail: string | null = null;
    let assigneeProfile: Record<string, unknown> | null = null;

    // Validate assignee if provided
    if (input.assignedUserId) {
      const userSnap = await adminDb.collection("users").doc(input.assignedUserId).get();
      if (!userSnap.exists || userSnap.data()?.role !== "employee") {
        throw new UserFacingError("Selected assignee is not a valid employee.");
      }
      assigneeProfile = userSnap.data() ?? {};
      employeeEmail = (assigneeProfile.email as string | undefined) ?? null;
    }

    const leadRef = adminDb.collection("leads").doc();
    const leadId = leadRef.id;

    // Parse creation date
    const creationTime = input.createdAt ? new Date(input.createdAt) : new Date();

    /*
     * Manual entry covers two very different things, and only one of them
     * belongs in the automatic priority lane.
     *
     * A lead typed in today is a live lead the admin happens to be entering by
     * hand, so it joins the lane like a Meta lead: it sits in the admin queue
     * for the assign window, then auto-distributes. A lead stamped with an
     * earlier date is a historical backfill — auto-assigning a months-old
     * record would put a 5-minute clock on someone for a lead that is already
     * cold. Those stay parked until an admin places them deliberately.
     */
    const isBackdated =
      Boolean(input.createdAt) && creationTime < startOfKarachiDay(new Date());

    const campaignId = input.campaignId?.trim() || null;
    const campaignName = input.campaignName?.trim() || null;

    await adminDb.runTransaction(async (t: Transaction) => {
      t.create(leadRef, {
        name,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        city: input.city?.trim() || null,
        customFields: {},
        source: campaignId ? "CAMPAIGN_IMPORT" : "MANUAL_ENTRY",
        status: effectiveStatus,
        assignedUserId: input.assignedUserId || null,
        attemptedAssignees: input.assignedUserId ? [input.assignedUserId] : [],
        campaignId,
        campaignName,
        adId: null,
        adName: null,
        adsetName: null,
        formId: null,
        pageId: null,
        createdAt: creationTime,
        lastActivityAt: creationTime,
        metaCreatedTime: null,
        ...(input.assignedUserId && assigneeProfile ? {
          assignedAt: creationTime,
          distributionMethod: "MANUAL",
          acceptedAt: creationTime,
          // Same provenance every other assignment path writes, so a manually
          // created lead is not the one row in the history with no answer to
          // "who assigned this".
          ...assignmentStamp(admin, assigneeProfile),
        } : {}),
        ...(effectiveStatus === "NEW" && !input.assignedUserId && !isBackdated
          ? { adminAssignDeadlineAt: new Date(Date.now() + ADMIN_ASSIGN_WINDOW_MS) }
          : {}),
        ...(effectiveStatus === "CLOSED_WON" ? { closedAt: creationTime, closedDealId: leadId } : {})
      });

      // Write historical creation event
      t.create(leadRef.collection("events").doc(), {
        type: "MANUALLY_CREATED",
        actorUid: admin.uid,
        at: creationTime,
        meta: {
          leadId,
          assignedTo: input.assignedUserId || null,
          status: effectiveStatus
        },
      });

      if (input.assignedUserId) {
        t.create(leadRef.collection("events").doc(), {
          type: "MANUALLY_ASSIGNED",
          actorUid: admin.uid,
          at: creationTime,
          meta: { assignedTo: input.assignedUserId, assigneeEmail: employeeEmail },
        });
      }

      if (input.assignedUserId && effectiveStatus === "ACCEPTED") {
        t.create(adminDb.collection('notifications').doc(), {
          type: 'NEW_LEAD_ASSIGNED',
          leadId: leadId,
          targetRole: 'employee',
          targetUid: input.assignedUserId,
          payload: { message: `${name} has been assigned to you by an admin.` },
          createdAt: FieldValue.serverTimestamp(),
          readAt: null,
        });
      }

      // Write followups
      if (input.followUps && input.followUps.length > 0) {
        let lastActivity = creationTime;
        input.followUps.forEach((fu) => {
          const fuDate = new Date(fu.occurredAt);
          if (fuDate > lastActivity) lastActivity = fuDate;

          const fuRef = leadRef.collection("followUps").doc();
          t.create(fuRef, {
            message: fu.message.trim(),
            callMade: fu.callMade,
            callCount: fu.callMade ? 1 : 0,
            // An imported record has no timed duration, so it is activity but
            // never a Connect — the threshold cannot be verified after the fact.
            durationSeconds: 0,
            connect: false,
            meetingHeld: false,
            dayKey: karachiDayKey(fuDate),
            actorUid: input.assignedUserId || admin.uid,
            occurredAt: fuDate,
          });

          if (input.assignedUserId && fu.callMade) {
            t.set(
              adminDb
                .collection("users")
                .doc(input.assignedUserId)
                .collection("kpiMonths")
                .doc(karachiMonthKey(fuDate)),
              {
                monthKey: karachiMonthKey(fuDate),
                calls: FieldValue.increment(1),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }

          t.create(leadRef.collection("events").doc(), {
            type: "FOLLOW_UP_ADDED",
            actorUid: input.assignedUserId || admin.uid,
            at: fuDate,
            meta: { message: fu.message.trim(), callMade: fu.callMade },
          });
        });
        
        t.update(leadRef, { lastActivityAt: lastActivity });
      }

      // Write deal if CLOSED_WON
      if (input.status === "CLOSED_WON" && input.deal) {
        const dealRef = adminDb.collection("closedDeals").doc(leadId);

        const customerName = name;
        const phoneDigits = toE164Digits(input.phone) || null;
        const amountReceived = parseMoney(input.deal.amountReceived);
        const payableAmount = parseMoney(input.deal.payableAmount);
        const profit = amountReceived - payableAmount;
        
        let dealDate = creationTime;
        if (input.deal.dealDate) {
          const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.deal.dealDate.trim());
          if (match) {
             dealDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
          }
        }

        t.create(dealRef, {
          leadId,
          userId: input.assignedUserId || admin.uid,
          enteredByUid: admin.uid,
          customer: {
            name: customerName,
            phone: phoneDigits,
            email: input.email?.trim() || null,
            cnic: null,
            address: null,
            city: input.city?.trim() || null,
          },
          serviceDescription: input.deal.serviceDescription.trim(),
          paymentMethod: input.deal.paymentMethod || "Cash",
          dealCategory: normalizeDealCategory(input.deal.dealCategory),
          notes: input.deal.notes?.trim() || null,
          amountReceived,
          payableAmount,
          profit,
          campaignId,
          campaignName,
          source: campaignId ? "CAMPAIGN_IMPORT" : "MANUAL_ENTRY",
          dealDate,
          enteredAt: creationTime,
        });

        // Counted in the month the deal actually happened, so a backfilled
        // March sale lands in March rather than distorting this month's KPI.
        if (input.assignedUserId) {
          const dealMonth = karachiMonthKey(dealDate);
          t.set(
            adminDb
              .collection("users")
              .doc(input.assignedUserId)
              .collection("kpiMonths")
              .doc(dealMonth),
            {
              monthKey: dealMonth,
              registrations: FieldValue.increment(1),
              revenue: FieldValue.increment(amountReceived),
              portfolio: {
                [normalizeDealCategory(input.deal.dealCategory)]: FieldValue.increment(amountReceived),
              },
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }

        t.create(leadRef.collection("events").doc(), {
          type: "DEAL_CLOSED",
          actorUid: admin.uid,
          at: dealDate,
          meta: {
            dealId: leadId,
            creditedTo: input.assignedUserId || admin.uid,
            amountReceived,
            payableAmount,
            profit,
          },
        });
      }
    });

    return { leadId };
  });
}
