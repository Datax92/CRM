"use server";

/**
 * Leave (§6, §7).
 *
 * A request is a document in `leaveRequests`; approving it writes the leave
 * days onto the employee's own attendance records, which is what makes the
 * calendar yellow (§3), keeps the absence sweep off those days (§7) and lets
 * the reports count leave without a second source of truth.
 *
 * **Approval is never automatic.** §7 is explicit, and the shape enforces it:
 * a request is created `PENDING` and only `approveLeave` — admin or HR — can
 * move it. Nothing else in this file writes `APPROVED`.
 *
 * **The balance is derived, not stored.** Used days are counted from approved
 * requests; the allowance comes from the policy plus any per-employee
 * adjustment. A stored "remaining" counter would drift the first time a request
 * was cancelled or a day was corrected, and there would be no way to tell which
 * number was right.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, requireManager, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { isHrManager } from "@/lib/constants/hierarchy";
import { readPolicy } from "./attendance";
import {
  LEAVE_TYPES,
  LEAVE_TYPE_LABELS,
  leaveBalances,
  leaveDayCount,
  leaveDayKeys,
  type LeaveBalance,
  type LeaveStatus,
  type LeaveType,
} from "@/lib/attendancePolicy";
import { FieldValue, Transaction } from "firebase-admin/firestore";

const REQUESTS = "leaveRequests";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function normalizeType(value: unknown): LeaveType {
  return value === "MEDICAL" ? "MEDICAL" : "CASUAL";
}

/** Same reach rule the attendance actions use — HR everyone, Sales their team. */
async function leaveScope(auth: DecodedAuth): Promise<{ hr: boolean; teamOf: string | null }> {
  if (auth.role === "admin") return { hr: true, teamOf: null };
  const profile = await adminDb.collection("users").doc(auth.uid).get();
  const hr = isHrManager(auth.role, profile.data()?.managerKind);
  return { hr, teamOf: hr ? null : auth.uid };
}

/* -------------------------------------------------------------------------- */
/* Requesting                                                                  */
/* -------------------------------------------------------------------------- */

export interface LeaveRequestInput {
  type: LeaveType;
  from: string;
  to: string;
  reason: string;
  /** HR filing on somebody's behalf. Absent means the caller's own leave. */
  uid?: string;
}

export async function requestLeave(
  token: string,
  input: LeaveRequestInput
): Promise<ActionResult<{ requestId: string; days: number }>> {
  return runAction("requestLeave", async () => {
    const auth = await verifyAuth(token);

    const type = normalizeType(input.type);
    const from = (input.from ?? "").trim();
    const to = (input.to ?? "").trim();
    const reason = (input.reason ?? "").trim();

    if (!DAY.test(from) || !DAY.test(to)) throw new UserFacingError("Choose the dates.");
    if (!reason) throw new UserFacingError("Say why — an approver has to decide on something.");

    const days = leaveDayCount(from, to);
    if (days <= 0) throw new UserFacingError("The end date is before the start date.");
    if (days > 60) throw new UserFacingError("That is longer than any single request should be.");

    // Filing for somebody else is a manager's act, and only HR or the admin may
    // do it — §6's "manually create or modify leave records when necessary".
    const forUid = (input.uid ?? "").trim() || auth.uid;
    if (forUid !== auth.uid) {
      const { hr } = await leaveScope(auth);
      if (!hr) throw new UserFacingError("Only an admin or HR can file leave for someone else.");
    }

    const employeeSnap = await adminDb.collection("users").doc(forUid).get();
    if (!employeeSnap.exists) throw new UserFacingError("That employee no longer exists.");

    const ref = await adminDb.collection(REQUESTS).add({
      uid: forUid,
      employeeName: employeeSnap.data()?.name ?? null,
      subAdminUid: employeeSnap.data()?.subAdminUid ?? null,
      type,
      from,
      to,
      days,
      reason,
      // §7 — a request is never approved by the act of submitting it.
      status: "PENDING" as LeaveStatus,
      requestedByUid: auth.uid,
      requestedAt: FieldValue.serverTimestamp(),
      decidedByUid: null,
      decidedByName: null,
      decidedAt: null,
      decisionNote: null,
    });

    // §8 — the people who can act on it are told it exists.
    const managers = await adminDb.collection("users").where("role", "==", "subadmin").get();
    const ownManager = employeeSnap.data()?.subAdminUid as string | undefined;

    const batch = adminDb.batch();
    const payload = {
      message: `${employeeSnap.data()?.name ?? "An employee"} requested ${days} day${days === 1 ? "" : "s"} of ${LEAVE_TYPE_LABELS[type]} (${from} → ${to}).`,
      uid: forUid,
      requestId: ref.id,
      days,
    };

    batch.set(adminDb.collection("notifications").doc(), {
      type: "LEAVE_REQUESTED",
      leadId: null,
      leaveRequestId: ref.id,
      targetRole: "admin",
      targetUid: null,
      payload,
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
    });

    for (const doc of managers.docs) {
      const isHr = doc.data()?.managerKind === "HR";
      if (!isHr && doc.id !== ownManager) continue;
      batch.set(adminDb.collection("notifications").doc(), {
        type: "LEAVE_REQUESTED",
        leadId: null,
        leaveRequestId: ref.id,
        targetRole: "subadmin",
        targetUid: doc.id,
        payload,
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });
    }

    await batch.commit();
    return { requestId: ref.id, days };
  });
}

/* -------------------------------------------------------------------------- */
/* Deciding                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Approves or rejects a request (§7).
 *
 * Approving writes a `LEAVE` day onto each attendance record the request
 * covers, in the same transaction as the decision. That is what makes §7's
 * three consequences true at once — the calendar turns yellow, the balance
 * moves, and the absence sweep steps over the day — without any of them being a
 * separate job that could fail on its own.
 *
 * A day that already has a check-in keeps it: the leave is recorded, but a day
 * somebody actually worked is not rewritten into an absence-shaped record.
 */
export async function decideLeave(
  token: string,
  requestId: string,
  decision: "APPROVED" | "REJECTED",
  note?: string
): Promise<ActionResult<{ status: LeaveStatus; days: number }>> {
  return runAction("decideLeave", async () => {
    const auth = await requireManager(token);
    const { hr, teamOf } = await leaveScope(auth);

    const ref = adminDb.collection(REQUESTS).doc(requestId);

    const result = await adminDb.runTransaction(async (t: Transaction) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new UserFacingError("That request no longer exists.");

      const request = snap.data()!;
      if (!hr && request.subAdminUid !== teamOf) {
        throw new UserFacingError("That request is not from your team.");
      }
      if (request.status !== "PENDING") {
        throw new UserFacingError(`This request has already been ${String(request.status).toLowerCase()}.`);
      }

      t.update(ref, {
        status: decision,
        decidedByUid: auth.uid,
        decidedByName: auth.name ?? auth.email ?? null,
        decidedAt: FieldValue.serverTimestamp(),
        decisionNote: (note ?? "").trim() || null,
      });

      if (decision === "APPROVED") {
        for (const dayKey of leaveDayKeys(request.from as string, request.to as string)) {
          t.set(
            adminDb.collection("attendance").doc(`${request.uid}_${dayKey}`),
            {
              uid: request.uid,
              dayKey,
              monthKey: dayKey.slice(0, 7),
              overrideStatus: "LEAVE",
              leaveType: request.type,
              leaveRequestId: requestId,
              overrideNote: `${LEAVE_TYPE_LABELS[normalizeType(request.type)]} approved by ${auth.name ?? "an administrator"}`,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      t.set(adminDb.collection("notifications").doc(), {
        type: decision === "APPROVED" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
        leadId: null,
        leaveRequestId: requestId,
        targetRole: "employee",
        targetUid: request.uid,
        payload: {
          message:
            decision === "APPROVED"
              ? `Your ${LEAVE_TYPE_LABELS[normalizeType(request.type)]} for ${request.from} → ${request.to} was approved.`
              : `Your ${LEAVE_TYPE_LABELS[normalizeType(request.type)]} for ${request.from} → ${request.to} was rejected.` +
                ((note ?? "").trim() ? ` ${note!.trim()}` : ""),
          requestId,
        },
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });

      return { status: decision as LeaveStatus, days: Number(request.days ?? 0) };
    });

    return result;
  });
}

/**
 * Withdraws a request that has not been decided.
 *
 * The employee's own, or HR acting for them. A decided request is not
 * cancellable here — reversing an approval means writing a new decision, so
 * the record shows what was approved and then changed rather than losing it.
 */
export async function cancelLeave(token: string, requestId: string): Promise<ActionResult> {
  return runAction("cancelLeave", async () => {
    const auth = await verifyAuth(token);
    const ref = adminDb.collection(REQUESTS).doc(requestId);

    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That request no longer exists.");

    const request = snap.data()!;
    if (request.uid !== auth.uid) {
      const { hr } = await leaveScope(auth);
      if (!hr) throw new UserFacingError("That is not your request.");
    }
    if (request.status !== "PENDING") {
      throw new UserFacingError("Only a request still awaiting a decision can be withdrawn.");
    }

    await ref.update({
      status: "CANCELLED" as LeaveStatus,
      decidedByUid: auth.uid,
      decidedAt: FieldValue.serverTimestamp(),
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Balances                                                                    */
/* -------------------------------------------------------------------------- */

export interface LeaveSummary {
  uid: string;
  year: string;
  balances: LeaveBalance[];
  /** Days requested and not yet decided — not deducted, but worth showing. */
  pendingDays: number;
}

/**
 * What one employee has left, for a calendar year.
 *
 * Counted from approved requests rather than a stored total, so a cancelled or
 * corrected request is reflected the moment it changes.
 */
export async function getLeaveSummary(
  token: string,
  uid?: string,
  year?: string
): Promise<ActionResult<LeaveSummary>> {
  return runAction("getLeaveSummary", async () => {
    const auth = await verifyAuth(token);
    const target = (uid ?? "").trim() || auth.uid;

    if (target !== auth.uid) {
      const { hr, teamOf } = await leaveScope(auth);
      if (auth.role === "employee") throw new UserFacingError("You can only see your own leave.");
      if (!hr) {
        const employee = await adminDb.collection("users").doc(target).get();
        if (employee.data()?.subAdminUid !== teamOf) {
          throw new UserFacingError("That employee is not on your team.");
        }
      }
    }

    const yearKey = (year ?? new Date().toISOString().slice(0, 4)).slice(0, 4);
    const [policy, requests, profile] = await Promise.all([
      readPolicy(),
      adminDb
        .collection(REQUESTS)
        .where("uid", "==", target)
        .where("from", ">=", `${yearKey}-01-01`)
        .where("from", "<=", `${yearKey}-12-31`)
        .get(),
      adminDb.collection("users").doc(target).get(),
    ]);

    const used: Partial<Record<LeaveType, number>> = {};
    let pendingDays = 0;

    for (const doc of requests.docs) {
      const request = doc.data();
      const type = normalizeType(request.type);
      if (request.status === "APPROVED") {
        used[type] = (used[type] ?? 0) + Number(request.days ?? 0);
      } else if (request.status === "PENDING") {
        pendingDays += Number(request.days ?? 0);
      }
    }

    // A per-employee adjustment lives on their profile, so HR can grant one
    // person extra days without moving the company allowance (§6).
    const adjustments = (profile.data()?.leaveAdjustments ?? {}) as Partial<Record<LeaveType, number>>;

    return {
      uid: target,
      year: yearKey,
      balances: leaveBalances(policy, used, adjustments),
      pendingDays,
    };
  });
}

/**
 * Grants or removes days for one employee (§6).
 *
 * Stored as an **adjustment on top of the policy**, not as a replacement
 * allowance: when HR later raises the company allowance from 1 to 2, everybody
 * who was granted an extra day still has it, which is what "adjust an
 * employee's balance" has to mean for it to be usable.
 */
export async function adjustLeaveBalance(
  token: string,
  uid: string,
  type: LeaveType,
  delta: number
): Promise<ActionResult<{ adjustment: number }>> {
  return runAction("adjustLeaveBalance", async () => {
    const auth = await requireManager(token);
    const { hr } = await leaveScope(auth);
    if (!hr) throw new UserFacingError("Only an admin or HR can adjust a leave balance.");

    const step = Math.trunc(Number(delta));
    if (!Number.isFinite(step) || step === 0) throw new UserFacingError("Enter how many days to add or remove.");
    if (Math.abs(step) > 365) throw new UserFacingError("That is more days than a year holds.");

    const ref = adminDb.collection("users").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That employee no longer exists.");

    const key = LEAVE_TYPES.includes(type) ? type : "CASUAL";
    const current = Number((snap.data()?.leaveAdjustments ?? {})[key] ?? 0);
    const next = current + step;

    await ref.update({
      [`leaveAdjustments.${key}`]: next,
      leaveAdjustedAt: FieldValue.serverTimestamp(),
      leaveAdjustedByUid: auth.uid,
    });

    await adminDb.collection("notifications").add({
      type: "LEAVE_BALANCE_ADJUSTED",
      leadId: null,
      targetRole: "employee",
      targetUid: uid,
      payload: {
        message: `Your ${LEAVE_TYPE_LABELS[key]} allowance was ${step > 0 ? "increased" : "reduced"} by ${Math.abs(step)} day${Math.abs(step) === 1 ? "" : "s"}.`,
      },
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
    });

    return { adjustment: next };
  });
}
