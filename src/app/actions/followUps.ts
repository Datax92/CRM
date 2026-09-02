"use server";

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { isConnect, normalizeDurationSeconds } from "@/lib/kpi";
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
): Promise<ActionResult<{ followUpId: string; connect: boolean }>> {
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

      // Both reads happen before any write — Firestore transactions require it.
      const [leadSnap, sameDaySnap] = await Promise.all([
        t.get(leadRef),
        auth.role === "admin"
          ? Promise.resolve(null)
          : t.get(followUpsRef.where("dayKey", "==", dayKey).limit(1)),
      ]);

      if (!leadSnap.exists) {
        throw new UserFacingError("That lead no longer exists.");
      }

      const lead = leadSnap.data()!;
      if (auth.role !== "admin" && lead.assignedUserId !== auth.uid) {
        throw new UserFacingError("This lead is not assigned to you.");
      }
      if (lead.status === "ASSIGNED") {
        throw new UserFacingError("Accept this lead before logging a follow-up.");
      }
      if (sameDaySnap && !sameDaySnap.empty) {
        throw new UserFacingError(
          "You have already logged a follow-up for this lead today. Add the next one tomorrow."
        );
      }

      const followUpRef = followUpsRef.doc();

      t.create(followUpRef, {
        message,
        callMade,
        callCount,
        durationSeconds,
        connect,
        meetingHeld,
        whatsappNote: (input.whatsappNote ?? "").trim() || null,
        occurredAt,
        // Stored rather than derived so the one-per-day check is an indexed
        // equality match instead of a scan over the whole subcollection.
        dayKey,
        createdAt: FieldValue.serverTimestamp(),
        authorUid: auth.uid,
        authorEmail: auth.email ?? null,
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
        // A flag as well as a count, because the Pipeline Stage rule asks a
        // yes/no question — "has a meeting happened" lifts a lead to P2 — and
        // reading a counter to answer it would mean every consumer repeating
        // the same `> 0` comparison. Written only when it becomes true, so a
        // later follow-up without a meeting cannot unset it: a meeting that
        // happened stays happened.
        ...(meetingHeld ? { meetingHeld: true } : {}),
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
        type: "FOLLOW_UP_ADDED",
        actorUid: auth.uid,
        at: FieldValue.serverTimestamp(),
        meta: { followUpId: followUpRef.id, callMade, callCount, durationSeconds, connect, meetingHeld },
      });

      return { followUpId: followUpRef.id, connect };
    });
  });
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
