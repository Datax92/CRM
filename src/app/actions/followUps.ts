"use server";

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { isConnect, normalizeDurationSeconds } from "@/lib/kpi";
import { meetsColdRule } from "@/lib/pipelineStage";
import { entryAllowance } from "@/lib/followUpKind";
import { FieldValue, Transaction } from "firebase-admin/firestore";

export interface FollowUpInput {
  message: string;
  callMade: boolean;
  callCount?: number;
  /**
   * How long the call lasted, in seconds, as typed by the employee.
   *
   * There is no telephony integration — nothing in this system can observe a
   * real call — so this is self-reported, and the Connect rule below is only
   * as honest as the person entering it.
   */
  durationSeconds?: number;
  /** Whether a meeting actually took place during this contact. */
  meetingHeld?: boolean;
  /** Whether the client visited the site. Counted separately in Reports (§4). */
  siteVisit?: boolean;
  whatsappNote?: string;
  /** ISO datetime — lets an employee log a call they made earlier (FR-15). */
  occurredAt?: string;
}

/**
 * Adds a follow-up (FR-14, FR-15).
 *
 * This is the only write path for follow-ups and it only ever creates. There is
 * deliberately no update or delete action anywhere in this codebase, and the
 * Security Rules deny both for every role including admin — BR-13/BR-14 make
 * that a two-layer guarantee. Corrections are made by adding a new entry.
 *
 * Two rules layered on top of that:
 *
 *  - A call counts as a **Connect** only at CONNECT_MIN_SECONDS or longer. The
 *    flag is computed here from the duration and never read from the client,
 *    so the KPI cannot be inflated by a crafted request.
 *  - An employee may log **one follow-up per lead per calendar day**. Admins
 *    are exempt, because an admin correcting or back-filling a record is a
 *    different act from an employee padding their activity count.
 */
export async function addFollowUp(
  token: string,
  leadId: string,
  input: FollowUpInput
): Promise<ActionResult<{ followUpId: string; connect: boolean; kind: "REMARK" | "FOLLOW_UP" }>> {
  return runAction("addFollowUp", async () => {
    const auth = await verifyAuth(token);

    const message = (input.message ?? "").trim();
    if (!message) {
      throw new UserFacingError("Write what happened before saving the follow-up.");
    }
    if (message.length > 5000) {
      throw new UserFacingError("That note is too long — keep it under 5000 characters.");
    }

    const callMade = Boolean(input.callMade);
    const callCount = callMade ? clampCallCount(input.callCount) : 0;
    const durationSeconds = callMade ? normalizeDurationSeconds(input.durationSeconds) : 0;
    const meetingHeld = Boolean(input.meetingHeld);
    const siteVisit = Boolean(input.siteVisit);

    if (callMade && durationSeconds === 0) {
      throw new UserFacingError(
        "Enter how long the call lasted — it decides whether this counts as a connect."
      );
    }

    const connect = callMade && isConnect(durationSeconds);
    const occurredAt = parseOccurredAt(input.occurredAt);
    const dayKey = karachiDayKey(occurredAt);
    const monthKey = karachiMonthKey(occurredAt);

    return adminDb.runTransaction(async (t: Transaction) => {
      const leadRef = adminDb.collection("leads").doc(leadId);
      const followUpsRef = leadRef.collection("followUps");

      // Every read happens before any write — Firestore transactions require
      // it. `sameDaySnap` is what the day rule is decided on; the lead's own
      // `followUpCount` says whether this is the very first entry.
      const [leadSnap, sameDaySnap] = await Promise.all([
        t.get(leadRef),
        t.get(followUpsRef.where("dayKey", "==", dayKey)),
      ]);

      if (!leadSnap.exists) {
        throw new UserFacingError("That lead no longer exists.");
      }

      const lead = leadSnap.data()!;
      if (!canWorkLead(auth, lead)) {
        throw new UserFacingError("This lead is not assigned to you.");
      }
      if (lead.status === "ASSIGNED") {
        throw new UserFacingError("Accept this lead before logging a remark.");
      }

      const totalEntries = Number(lead.followUpCount ?? 0);
      const allowance = entryAllowance(
        totalEntries,
        sameDaySnap.size,
        // A lead with any entry at all has its Remark: there is exactly one,
        // and it is always the first.
        totalEntries > 0
      );

      // An admin is exempt from the day limit for the same reason they always
      // were: an admin correcting or back-filling a record is a different act
      // from an employee padding their activity count. The *kind* still
      // follows the rule, so an admin cannot invent a second Remark.
      if (!allowance.allowed && auth.role !== "admin") {
        throw new UserFacingError(allowance.reason!);
      }

      const followUpRef = followUpsRef.doc();

      t.create(followUpRef, {
        // **Stored, not derived.** Position told us this before, and position
        // is fine for reading a list — but the day rule has to know whether a
        // lead's Remark exists before writing, and an ordering read at write
        // time is both slower and racier than a field.
        kind: allowance.kind,
        message,
        callMade,
        callCount,
        durationSeconds,
        connect,
        meetingHeld,
        siteVisit,
        whatsappNote: (input.whatsappNote ?? "").trim() || null,
        occurredAt,
        // Stored rather than derived so the day check is an indexed equality
        // match instead of a scan over the whole subcollection.
        dayKey,
        createdAt: FieldValue.serverTimestamp(),
        authorUid: auth.uid,
        authorEmail: auth.email ?? null,
        // Who the activity counts for. The author may be an admin filing on
        // somebody's behalf, and Reports must credit the person who did the
        // work — the same rule the KPI counters below follow.
        creditUid: lead.assignedUserId ?? auth.uid,
        // Set by `updateFollowUp` when this entry is edited while it is still
        // the latest. Absent means it has never been touched.
        revisions: [],
      });

      // Denormalised onto the lead so the no-follow-up scan (FR-18) is a single
      // query instead of a subcollection read per active lead.
      t.update(leadRef, {
        lastFollowUpAt: FieldValue.serverTimestamp(),
        lastActivityAt: FieldValue.serverTimestamp(),
        followUpCount: FieldValue.increment(1),
        callCount: FieldValue.increment(callCount),
        connectCount: FieldValue.increment(connect ? 1 : 0),
        meetingCount: FieldValue.increment(meetingHeld ? 1 : 0),
        siteVisitCount: FieldValue.increment(siteVisit ? 1 : 0),
        // The id of the entry that is still editable (§2). Writing a new one
        // locks whatever came before by simply no longer naming it.
        latestFollowUpId: followUpRef.id,
        // A flag as well as a count, because the Pipeline Stage rule asks a
        // yes/no question — "has a meeting happened" lifts a lead to P2 — and
        // reading a counter to answer it would mean every consumer repeating
        // the same `> 0` comparison. Written only when it becomes true, so a
        // later follow-up without a meeting cannot unset it: a meeting that
        // happened stays happened.
        ...(meetingHeld ? { meetingHeld: true } : {}),
        ...(siteVisit ? { siteVisit: true } : {}),
      });

      // KPI counters are credited to whoever works the lead, not whoever typed
      // the form — an admin filing on someone's behalf must not move their own
      // numbers. Mirrors how closeDeal credits revenue.
      const creditUid: string | null = lead.assignedUserId ?? null;
      if (creditUid) {
        t.set(
          adminDb.collection("users").doc(creditUid).collection("kpiMonths").doc(monthKey),
          {
            monthKey,
            calls: FieldValue.increment(callMade ? 1 : 0),
            connects: FieldValue.increment(connect ? 1 : 0),
            meetings: FieldValue.increment(meetingHeld ? 1 : 0),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      t.create(leadRef.collection("events").doc(), {
        type: allowance.kind === "REMARK" ? "REMARK_ADDED" : "FOLLOW_UP_ADDED",
        actorUid: auth.uid,
        at: FieldValue.serverTimestamp(),
        meta: {
          followUpId: followUpRef.id,
          kind: allowance.kind,
          callMade,
          callCount,
          durationSeconds,
          connect,
          meetingHeld,
          siteVisit,
        },
      });

      // §3 — a lead that has met the Cold rule is put up for review rather
      // than written off silently. Raised once: `coldReviewRequestedAt` is the
      // guard, so chasing a lead to its fifteenth follow-up does not notify
      // five more times.
      const nextCount = totalEntries + 1;
      const nowCold = meetsColdRule({ status: lead.status, followUpCount: nextCount });
      if (nowCold && !lead.coldReviewRequestedAt && !lead.pipelineStageOverride) {
        t.update(leadRef, { coldReviewRequestedAt: FieldValue.serverTimestamp() });

        const payload = {
          message: `${lead.name ?? "A lead"} has had ${nextCount} follow-ups with no progress. Lead requires verification before being moved to Cold.`,
          followUpCount: nextCount,
        };

        // The admin, and the manager who runs the employee holding the lead.
        // Not the employee: this is a review *of* their work, and the decision
        // is not theirs to make.
        t.create(adminDb.collection("notifications").doc(), {
          type: "COLD_REVIEW_REQUIRED",
          leadId,
          targetRole: "admin",
          targetUid: null,
          payload,
          createdAt: FieldValue.serverTimestamp(),
          readAt: null,
        });

        if (lead.subAdminUid) {
          t.create(adminDb.collection("notifications").doc(), {
            type: "COLD_REVIEW_REQUIRED",
            leadId,
            targetRole: "subadmin",
            targetUid: lead.subAdminUid,
            payload,
            createdAt: FieldValue.serverTimestamp(),
            readAt: null,
          });
        }
      }

      return { followUpId: followUpRef.id, connect, kind: allowance.kind };
    });
  });
}

/**
 * Edits the newest entry on a lead (§2).
 *
 * **Only the newest.** Once another entry exists after it, the record is
 * locked — for every role, admin included. That is the line BR-13/BR-14 drew
 * and the reason the log is worth anything: a history somebody can go back and
 * tidy is not a history. The lead names its editable entry in
 * `latestFollowUpId`, so "is this the newest" is one field comparison rather
 * than an ordering read — and where that field is **missing**, on leads whose
 * entries predate it, the newest is resolved from the subcollection and the
 * pointer is written back, so each such lead is repaired the first time
 * anybody edits it.
 *
 * **Nothing is overwritten.** Every edit appends the previous values to a
 * `revisions` array on the entry, with who changed it and when, so the pane can
 * show what it said before. §2 asks for exactly that, and it is also what makes
 * the edit safe to allow at all.
 *
 * The KPI counters move with the edit. A call that turns out to have been long
 * enough to be a Connect, or a meeting the rep forgot to tick, has to reach the
 * same counters the original write touched — otherwise editing would be a way
 * to log work that no report can see.
 */
export interface FollowUpEditInput {
  message?: string;
  callMade?: boolean;
  callCount?: number;
  durationSeconds?: number;
  meetingHeld?: boolean;
  siteVisit?: boolean;
  whatsappNote?: string;
}

export async function updateFollowUp(
  token: string,
  leadId: string,
  followUpId: string,
  input: FollowUpEditInput
): Promise<ActionResult<{ connect: boolean }>> {
  return runAction("updateFollowUp", async () => {
    const auth = await verifyAuth(token);

    return adminDb.runTransaction(async (t: Transaction) => {
      const leadRef = adminDb.collection("leads").doc(leadId);
      const followUpsRef = leadRef.collection("followUps");
      const entryRef = followUpsRef.doc(followUpId);

      /**
       * The newest entry, read the same way the pane orders the list.
       *
       * Only needed when the lead carries no `latestFollowUpId` — see below —
       * but Firestore transactions require **every read before any write**, so
       * it cannot be fetched conditionally after the pointer has been checked.
       * One extra read on the edit path is the price of that rule.
       */
      const [leadSnap, entrySnap, newestSnap] = await Promise.all([
        t.get(leadRef),
        t.get(entryRef),
        t.get(followUpsRef.orderBy("occurredAt", "desc").limit(1)),
      ]);

      if (!leadSnap.exists) throw new UserFacingError("That lead no longer exists.");
      if (!entrySnap.exists) throw new UserFacingError("That entry no longer exists.");

      const lead = leadSnap.data()!;
      const entry = entrySnap.data()!;

      if (!canWorkLead(auth, lead)) {
        throw new UserFacingError("This lead is not assigned to you.");
      }

      /**
       * The lock. Deliberately not role-exempt.
       *
       * **`latestFollowUpId` is not always there.** Entries written before that
       * field existed left the lead without one, and the guard used to read
       * `if (lead.latestFollowUpId && …)` — so on exactly those leads it
       * evaluated to false and the rule stopped existing: every entry in the
       * history was editable by anyone who could reach the action. Six leads on
       * the live project are in that state, which is six leads whose permanent
       * record was not permanent.
       *
       * The fallback resolves the newest entry from the subcollection instead,
       * ordered by `occurredAt` — **the same order the pane displays**, so the
       * entry the server accepts is the one showing an Edit button rather than
       * a padlock. Ordering by write time here would be defensible in isolation
       * and would disagree with the screen the moment anybody back-dated a
       * call, which FR-15 explicitly lets them do.
       */
      const newestId = lead.latestFollowUpId ?? newestSnap.docs[0]?.id ?? null;

      if (newestId && newestId !== followUpId) {
        throw new UserFacingError(
          "Only the latest entry can be edited. Older ones are part of the permanent record."
        );
      }

      const message = input.message === undefined ? entry.message : input.message.trim();
      if (!message) throw new UserFacingError("Write what happened before saving.");
      if (message.length > 5000) {
        throw new UserFacingError("That note is too long — keep it under 5000 characters.");
      }

      const callMade = input.callMade === undefined ? Boolean(entry.callMade) : Boolean(input.callMade);
      const callCount = callMade
        ? clampCallCount(input.callCount === undefined ? entry.callCount : input.callCount)
        : 0;
      const durationSeconds = callMade
        ? normalizeDurationSeconds(
            input.durationSeconds === undefined ? entry.durationSeconds : input.durationSeconds
          )
        : 0;

      if (callMade && durationSeconds === 0) {
        throw new UserFacingError(
          "Enter how long the call lasted — it decides whether this counts as a connect."
        );
      }

      const meetingHeld =
        input.meetingHeld === undefined ? Boolean(entry.meetingHeld) : Boolean(input.meetingHeld);
      const siteVisit =
        input.siteVisit === undefined ? Boolean(entry.siteVisit) : Boolean(input.siteVisit);
      const connect = callMade && isConnect(durationSeconds);

      // What it said before, kept beside what it says now.
      const revision = {
        message: entry.message ?? null,
        callMade: Boolean(entry.callMade),
        callCount: Number(entry.callCount ?? 0),
        durationSeconds: Number(entry.durationSeconds ?? 0),
        connect: Boolean(entry.connect),
        meetingHeld: Boolean(entry.meetingHeld),
        siteVisit: Boolean(entry.siteVisit),
        whatsappNote: entry.whatsappNote ?? null,
        editedByUid: auth.uid,
        editedByEmail: auth.email ?? null,
        // `serverTimestamp()` cannot be used inside an array, so this is the
        // request's own clock. It is only ever displayed, never compared.
        editedAt: new Date(),
      };

      t.update(entryRef, {
        message,
        callMade,
        callCount,
        durationSeconds,
        connect,
        meetingHeld,
        siteVisit,
        whatsappNote:
          input.whatsappNote === undefined
            ? (entry.whatsappNote ?? null)
            : input.whatsappNote.trim() || null,
        revisions: FieldValue.arrayUnion(revision),
        editedAt: FieldValue.serverTimestamp(),
        editedByUid: auth.uid,
      });

      // Deltas, so the lead counters and the KPI month stay true to the entry.
      const dCalls = callCount - Number(entry.callCount ?? 0);
      const dConnect = (connect ? 1 : 0) - (entry.connect ? 1 : 0);
      const dMeeting = (meetingHeld ? 1 : 0) - (entry.meetingHeld ? 1 : 0);
      const dVisit = (siteVisit ? 1 : 0) - (entry.siteVisit ? 1 : 0);

      t.update(leadRef, {
        lastActivityAt: FieldValue.serverTimestamp(),
        callCount: FieldValue.increment(dCalls),
        connectCount: FieldValue.increment(dConnect),
        meetingCount: FieldValue.increment(dMeeting),
        siteVisitCount: FieldValue.increment(dVisit),
        // Heals a lead whose entries predate the pointer. Written only when it
        // was missing, so this never overwrites a live one, and each such lead
        // is repaired the first time anybody edits it rather than by a
        // migration nobody would remember to run.
        ...(lead.latestFollowUpId ? {} : { latestFollowUpId: followUpId }),
        // One-way, as on the write path: a meeting that happened stays
        // happened, so un-ticking it here does not erase the lead-level flag.
        ...(meetingHeld ? { meetingHeld: true } : {}),
        ...(siteVisit ? { siteVisit: true } : {}),
      });

      const creditUid: string | null = entry.creditUid ?? lead.assignedUserId ?? null;
      if (creditUid && (dConnect !== 0 || dMeeting !== 0)) {
        const monthKey = karachiMonthKey(entry.occurredAt?.toDate?.() ?? new Date());
        t.set(
          adminDb.collection("users").doc(creditUid).collection("kpiMonths").doc(monthKey),
          {
            monthKey,
            connects: FieldValue.increment(dConnect),
            meetings: FieldValue.increment(dMeeting),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      t.create(leadRef.collection("events").doc(), {
        type: "FOLLOW_UP_EDITED",
        actorUid: auth.uid,
        at: FieldValue.serverTimestamp(),
        meta: { followUpId, kind: entry.kind ?? "FOLLOW_UP", connect, meetingHeld, siteVisit },
      });

      return { connect };
    });
  });
}

/**
 * Who may work a lead: the assigned employee, their manager, or an admin.
 * The same test `setLeadStatus` and the KYC action apply.
 */
function canWorkLead(auth: DecodedAuth, lead: Record<string, unknown>): boolean {
  if (auth.role === "admin") return true;
  if (auth.role === "subadmin") return lead.subAdminUid === auth.uid;
  return lead.assignedUserId === auth.uid;
}

function clampCallCount(value: unknown): number {
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(count, 100);
}

/**
 * A follow-up can be backdated — an employee logging this morning's calls at
 * lunchtime is normal — but not postdated, which would corrupt the timeline.
 */
function parseOccurredAt(raw: string | undefined): Date {
  if (!raw) return new Date();

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return new Date();

  if (parsed.getTime() > Date.now() + 60_000) {
    throw new UserFacingError("A follow-up cannot be dated in the future.");
  }
  return parsed;
}
