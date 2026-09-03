"use server";

import { headers } from "next/headers";
import { adminDb } from "@/lib/firebase/server";
import {
  verifyAuth,
  requireAdmin,
  requireManager,
  type DecodedAuth,
} from "@/lib/firebase/serverAuth";
import { isHrManager } from "@/lib/constants/hierarchy";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import {
  classifyNetwork,
  clientIpFromHeaders,
  deriveStatus,
  isValidIp,
  normalizeIp,
  type AttendanceNetwork,
  type AttendanceStatus,
} from "@/lib/attendance";
import {
  DEFAULT_ATTENDANCE_POLICY,
  classifyCheckIn,
  lateDeduction,
  formatClockValue,
  monthDeductions,
  parseClock,
  normalizePolicy,
  type AttendancePolicy,
} from "@/lib/attendancePolicy";
import { FieldValue, Transaction } from "firebase-admin/firestore";

/**
 * The stored settings.
 *
 * `AttendancePolicy` carries every configurable rule (§2, §4, §5, §6); this
 * alias keeps the older name working for the callers that already use it.
 */
export type AttendanceConfig = AttendancePolicy;

/**
 * Reads the policy, filling anything unset with the default.
 *
 * The document predates this module — it held only `officeIps` — so every read
 * goes through `normalizePolicy`, and an installation that has never opened
 * Attendance Settings behaves exactly as the defaults describe rather than
 * with half a policy.
 */
export async function readPolicy(): Promise<AttendancePolicy> {
  const snap = await adminDb.collection("config").doc("attendance").get();
  const raw = (snap.data() ?? {}) as Partial<AttendancePolicy>;

  const officeIps = Array.isArray(raw.officeIps)
    ? raw.officeIps.map((value: unknown) => normalizeIp(String(value))).filter(Boolean)
    : [];

  return normalizePolicy({ ...raw, officeIps }, DEFAULT_ATTENDANCE_POLICY);
}

/**
 * Who may run attendance for somebody other than themselves.
 *
 * The admin and an **HR** manager reach everybody (§13). A **Sales** manager
 * reaches their own team and no further — and reaches none of the settings,
 * which is the line §13 draws between the two kinds of manager.
 */
async function attendanceScope(auth: DecodedAuth): Promise<{
  hr: boolean;
  /** `null` when the reader may see everyone. */
  teamOf: string | null;
}> {
  if (auth.role === "admin") return { hr: true, teamOf: null };

  const profile = await adminDb.collection("users").doc(auth.uid).get();
  const hr = isHrManager(auth.role, profile.data()?.managerKind);

  return { hr, teamOf: hr ? null : auth.uid };
}

/** Rejects anyone who is not the admin or an HR manager. */
async function requireHr(token: string): Promise<DecodedAuth> {
  const auth = await requireManager(token);
  const { hr } = await attendanceScope(auth);
  if (!hr) {
    throw new UserFacingError("Only an admin or an HR manager can change attendance settings.");
  }
  return auth;
}

export interface AttendancePingResult {
  dayKey: string;
  network: AttendanceNetwork;
  /** What the server saw the request come from — shown in Settings. */
  ip: string;
  firstActionAt: string;
  lastActionAt: string;
}

/** Document id per employee per day, so a ping is a single-document upsert. */
function attendanceDocId(uid: string, dayKey: string): string {
  return `${uid}_${dayKey}`;
}

async function readOfficeIps(): Promise<string[]> {
  return (await readPolicy()).officeIps;
}

export type PunchKind = "IN" | "OUT";

export interface AttendancePunchResult extends AttendancePingResult {
  kind: PunchKind;
  /** True when the punch changed nothing — a second Check In on the same day. */
  alreadyDone: boolean;
  /** Whether this check-in was after the configured time (§5). */
  late: boolean;
  lateByMinutes: number;
  /** The time after which a check-in counts as late, `HH:MM`. */
  lateAfter: string;
}

/**
 * The employee's own Check In / Check Out.
 *
 * Replaces the old activity heartbeat at the owner's request. The trade is
 * explicit: presence is now **declared** rather than observed, so the times are
 * whatever the employee says they are. What still cannot be faked is *where*
 * the punch came from — the network is classified **here**, from the request's
 * own address, exactly as before. Doing that in the browser would let anyone
 * claim to be in the office by editing a request.
 *
 * **A punch off the office network is recorded, not refused.** Blocking would
 * be worse than useless in two common cases: the allow-list starts empty, which
 * would lock the whole company out of attendance until Settings is filled in,
 * and field staff genuinely work away from the office. The day is stamped
 * `OFFICE` / `REMOTE` / `UNKNOWN` and the admin can see and override it.
 *
 * Both directions only ever move outward: a second Check In keeps the earlier
 * time, and a Check Out never rewinds an existing one. That way a stray tap
 * cannot shorten a day that has already been recorded.
 */
export async function punchAttendance(
  token: string,
  kind: PunchKind
): Promise<ActionResult<AttendancePunchResult>> {
  return runAction("punchAttendance", async () => {
    const [auth, requestHeaders] = await Promise.all([verifyAuth(token), headers()]);

    const ip = clientIpFromHeaders(requestHeaders);
    const policy = await readPolicy();
    const network = classifyNetwork(ip, policy.officeIps);

    /*
     * §2 — the IP restriction, enforced here and nowhere else.
     *
     * It is **off by default and refuses to bite with an empty allow-list**:
     * turning it on before Settings is filled in would otherwise lock the
     * whole company out of attendance, which is a worse failure than a punch
     * from the wrong network. An employee on the exemption list punches from
     * anywhere, which is §2's "unless Admin/HR has explicitly allowed an
     * exception".
     *
     * The check is server-side because the address is read from the request
     * itself. A browser-side version would be bypassed in seconds.
     */
    const exempt = policy.ipExemptUids.includes(auth.uid);

    /**
     * **Check In is refused off the office network. Check Out never is.**
     *
     * They are not symmetric acts. Arriving is the claim the restriction
     * exists to police; leaving is the employee closing a day they have
     * already been recorded as working, and blocking that would leave open
     * days behind whenever somebody finishes at a client site — which is
     * worse than useless, because an open day is graded as a half day.
     *
     * The check is skipped when there is nothing to check against: an empty
     * allow-list means the office IP has never been configured, and refusing
     * every check-in on that basis would lock the whole company out of
     * attendance until Settings is filled in. Same for anyone on the
     * exemption list, which is §2's explicit "unless Admin/HR has allowed an
     * exception".
     *
     * Server-side because the address is read from the request itself. A
     * browser-side version would be bypassed in seconds.
     */
    const enforced =
      kind === "IN" && policy.ipRestriction && policy.officeIps.length > 0 && !exempt;

    if (enforced && network !== "OFFICE") {
      throw new UserFacingError(
        `You are not on the office network — this request came from ${ip || "an unknown address"}, ` +
          "which is not one of the approved office addresses, so your check-in was not recorded. " +
          "Check in from the office, or ask an admin or HR to add this address or grant you an exception. " +
          "You can still check out from anywhere."
      );
    }

    const now = new Date();
    const dayKey = karachiDayKey(now);
    const verdict = classifyCheckIn(now, policy);
    const ref = adminDb.collection("attendance").doc(attendanceDocId(auth.uid, dayKey));

    const saved = await adminDb.runTransaction(async (t: Transaction) => {
      const snap = await t.get(ref);
      const existing = snap.data();

      const existingFirst: Date | null = existing?.firstActionAt?.toDate?.() ?? null;
      const existingLast: Date | null = existing?.lastActionAt?.toDate?.() ?? null;

      if (kind === "OUT" && !existingFirst) {
        throw new UserFacingError("Check in first — there is no open day to close.");
      }

      // Check In keeps the earliest time of the day; Check Out keeps the latest.
      const firstAt = kind === "IN" ? (existingFirst ?? now) : existingFirst!;
      const lastAt =
        kind === "OUT" ? (existingLast && existingLast > now ? existingLast : now) : existingLast;

      const alreadyDone =
        (kind === "IN" && existingFirst !== null) ||
        (kind === "OUT" && existingLast !== null && existingLast >= now);

      /*
       * Lateness is decided **once, on the check-in that opened the day**, and
       * never recomputed. A second Check In at 4pm keeps the earlier time, so
       * it must also keep the earlier verdict — otherwise an employee who
       * arrived at 08:55 and tapped again after lunch would be marked late by
       * their own second tap.
       */
      const openingLate =
        kind === "IN" && existingFirst === null ? verdict.late : Boolean(existing?.late);
      const firstIsNew = kind === "IN" && existingFirst === null;

      t.set(
        ref,
        {
          uid: auth.uid,
          email: auth.email ?? null,
          dayKey,
          monthKey: karachiMonthKey(now),
          firstActionAt: firstAt,
          ...(lastAt ? { lastActionAt: lastAt } : null),
          workedMinutes: lastAt
            ? Math.max(0, Math.floor((lastAt.getTime() - firstAt.getTime()) / 60_000))
            : 0,
          // Whether the day has been closed, which "lastActionAt is set" alone
          // no longer tells you now that nothing writes it in the background.
          checkedOut: kind === "OUT" ? true : (existing?.checkedOut ?? false),
          late: openingLate,
          ...(firstIsNew
            ? {
                lateByMinutes: verdict.lateByMinutes,
                // The threshold as it stood at the punch. A policy changed next
                // month must not silently re-judge a day already recorded.
                lateAfter: verdict.lateAfter,
                // The address the day was opened from (§2), kept beside the
                // last one so a check-out elsewhere does not erase it.
                checkInIp: ip || null,
              }
            : null),
          // The first network of the day is the one that counts. Someone who
          // starts in the office and checks out from a phone still attended.
          network: existing?.network ?? network,
          lastNetwork: network,
          lastIp: ip || null,
          punchedBy: "SELF",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        firstAt,
        lastAt,
        network: (existing?.network as AttendanceNetwork) ?? network,
        alreadyDone,
        late: openingLate,
        raisedLate: firstIsNew && verdict.late,
      };
    });

    // §5 — a late arrival tells the admin and the managers responsible. Sent
    // after the transaction, and only when this punch is what made the day
    // late: a second tap must not send a second alert.
    if (saved.raisedLate) {
      await notifyLate(auth, dayKey, verdict.lateByMinutes, verdict.lateAfter, policy);
    }

    return {
      kind,
      alreadyDone: saved.alreadyDone,
      dayKey,
      network: saved.network,
      ip,
      late: saved.late,
      lateByMinutes: verdict.lateByMinutes,
      lateAfter: verdict.lateAfter,
      firstActionAt: saved.firstAt.toISOString(),
      lastActionAt: (saved.lastAt ?? saved.firstAt).toISOString(),
    };
  });
}

/**
 * Tells the admin and the responsible managers that somebody arrived late.
 *
 * The message carries the employee, the day, how late, and what this late costs
 * — §8 asks for enough to identify the record, and "your third late this month,
 * which is a deduction" is the part that actually needs a decision.
 *
 * The occurrence count is read from the month's own records rather than a
 * counter, so it cannot drift from what the reports show.
 */
async function notifyLate(
  auth: DecodedAuth,
  dayKey: string,
  lateByMinutes: number,
  lateAfter: string,
  policy: AttendancePolicy
): Promise<void> {
  const monthKey = dayKey.slice(0, 7);

  const [monthLates, profile, hrManagers] = await Promise.all([
    adminDb
      .collection("attendance")
      .where("uid", "==", auth.uid)
      .where("monthKey", "==", monthKey)
      .where("late", "==", true)
      .get(),
    adminDb.collection("users").doc(auth.uid).get(),
    adminDb.collection("users").where("role", "==", "subadmin").get(),
  ]);

  const occurrence = Math.max(1, monthLates.size);
  const outcome = lateDeduction(occurrence, policy, Number(profile.data()?.monthlySalary ?? 0));
  const name = (profile.data()?.name as string) ?? auth.email ?? "An employee";

  const payload = {
    message:
      `${name} checked in late on ${dayKey} — ${lateByMinutes} min after ${lateAfter}. ` +
      `Late #${occurrence} this month.` +
      (outcome.deducted ? ` A deduction of ${outcome.amount} applies.` : " No deduction yet."),
    occurrence,
    lateByMinutes,
    deducted: outcome.deducted,
    amount: outcome.amount,
    uid: auth.uid,
    dayKey,
  };

  const batch = adminDb.batch();
  const notify = (targetRole: string, targetUid: string | null) =>
    batch.set(adminDb.collection("notifications").doc(), {
      type: "ATTENDANCE_LATE",
      leadId: null,
      attendanceId: attendanceDocId(auth.uid, dayKey),
      targetRole,
      targetUid,
      payload,
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
    });

  notify("admin", null);

  // Every HR manager, plus the employee's own manager whatever kind they are —
  // §8 names both, and a Sales manager needs to know their own team is late
  // even though the policy is not theirs to set.
  const seen = new Set<string>();
  const ownManager = profile.data()?.subAdminUid as string | undefined;

  for (const doc of hrManagers.docs) {
    const isHr = doc.data()?.managerKind === "HR";
    if (!isHr && doc.id !== ownManager) continue;
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    notify("subadmin", doc.id);
  }

  if (ownManager && !seen.has(ownManager)) notify("subadmin", ownManager);

  await batch.commit();
}

/**
 * Records that this employee was working, right now.
 *
 * **No longer called by the app** — attendance is now the employee's own Check
 * In / Check Out above. Kept because it is the only writer that can reconstruct
 * a day from observed activity, which is what a future auto-close sweep would
 * need, and because removing it would strand the demo store's equivalent.
 */
export async function recordAttendancePing(
  token: string
): Promise<ActionResult<AttendancePingResult>> {
  return runAction("recordAttendancePing", async () => {
    const auth = await verifyAuth(token);

    const requestHeaders = await headers();
    const ip = clientIpFromHeaders(requestHeaders);
    const network = classifyNetwork(ip, await readOfficeIps());

    const now = new Date();
    const dayKey = karachiDayKey(now);
    const ref = adminDb.collection("attendance").doc(attendanceDocId(auth.uid, dayKey));

    const saved = await adminDb.runTransaction(async (t: Transaction) => {
      const snap = await t.get(ref);
      const existing = snap.data();

      // Only ever moves forward. A stale request arriving late must not rewind
      // someone's check-out and shorten their day.
      const firstAt: Date = existing?.firstActionAt?.toDate?.() ?? now;
      const lastAt: Date =
        existing?.lastActionAt?.toDate?.() && existing.lastActionAt.toDate() > now
          ? existing.lastActionAt.toDate()
          : now;

      const minutes = Math.max(0, Math.floor((lastAt.getTime() - firstAt.getTime()) / 60_000));

      t.set(
        ref,
        {
          uid: auth.uid,
          email: auth.email ?? null,
          dayKey,
          monthKey: karachiMonthKey(now),
          firstActionAt: existing?.firstActionAt ?? now,
          lastActionAt: lastAt,
          workedMinutes: minutes,
          pingCount: FieldValue.increment(1),
          // The first network of the day is the one that counts. Someone who
          // starts in the office and later works from a phone still attended.
          network: existing?.network ?? network,
          lastNetwork: network,
          lastIp: ip || null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { firstAt, lastAt, network: (existing?.network as AttendanceNetwork) ?? network };
    });

    return {
      dayKey,
      network: saved.network,
      ip,
      firstActionAt: saved.firstAt.toISOString(),
      lastActionAt: saved.lastAt.toISOString(),
    };
  });
}

/**
 * An admin correction — leave, a client-site day, a public holiday.
 *
 * The derived status is a default, not a verdict: only a person knows that a
 * quiet day was a site visit rather than an absence. The override is stored
 * beside the observed times, never over them, so the raw record stays intact.
 */
export async function setAttendanceOverride(
  token: string,
  uid: string,
  dayKey: string,
  status: AttendanceStatus | null,
  note?: string
): Promise<ActionResult> {
  return runAction("setAttendanceOverride", async () => {
    const admin = await requireAdmin(token);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      throw new UserFacingError("That is not a valid date.");
    }

    const ref = adminDb.collection("attendance").doc(attendanceDocId(uid, dayKey));

    await ref.set(
      {
        uid,
        dayKey,
        monthKey: dayKey.slice(0, 7),
        overrideStatus: status ?? FieldValue.delete(),
        overrideNote: note?.trim() || FieldValue.delete(),
        overrideByUid: status ? admin.uid : FieldValue.delete(),
        overrideAt: status ? FieldValue.serverTimestamp() : FieldValue.delete(),
      },
      { merge: true }
    );
  });
}

/**
 * The whole attendance policy, for the Settings screen.
 *
 * Admin or **HR** only (§13) — a Sales manager runs their team's attendance but
 * not the company's rules.
 */
export async function getAttendanceConfig(
  token: string
): Promise<ActionResult<AttendancePolicy & { yourIp: string }>> {
  return runAction("getAttendanceConfig", async () => {
    await requireHr(token);
    const requestHeaders = await headers();

    return {
      ...(await readPolicy()),
      // Surfaced so the admin can fill the field with one click instead of
      // hunting for "what is my IP" on a third-party site.
      yourIp: clientIpFromHeaders(requestHeaders),
    };
  });
}

/**
 * Saves the policy.
 *
 * **Every value here is a setting, not a constant** — §5 is explicit that the
 * deduction must not be hard-coded, and the same goes for the start time, the
 * grace, the absence cutoff and the leave allowance. `normalizePolicy` keeps a
 * mistyped field from resetting the rest, and the previous version is written
 * to `configHistory` so §11's "who changed what, and when" holds for settings
 * as well as for attendance rows.
 */
export async function setAttendanceConfig(
  token: string,
  input: Partial<AttendancePolicy>
): Promise<ActionResult<AttendancePolicy>> {
  return runAction("setAttendanceConfig", async () => {
    const auth = await requireHr(token);
    const current = await readPolicy();

    const cleanedIps = Array.from(
      new Set((input.officeIps ?? current.officeIps).map((ip) => normalizeIp(String(ip))).filter(Boolean))
    );

    for (const ip of cleanedIps) {
      if (!isValidIp(ip)) throw new UserFacingError(`"${ip}" is not a valid IP address.`);
    }
    if (cleanedIps.length > 20) {
      throw new UserFacingError("Twenty office addresses is the maximum.");
    }

    const next = normalizePolicy({ ...input, officeIps: cleanedIps }, current);

    // Turning the restriction on with nothing to allow would lock every
    // employee out of attendance — refused rather than saved and regretted.
    if (next.ipRestriction && next.officeIps.length === 0) {
      throw new UserFacingError(
        "Add at least one office IP before switching the restriction on, or nobody will be able to check in."
      );
    }

    await adminDb
      .collection("config")
      .doc("attendance")
      .set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedByUid: auth.uid }, { merge: true });

    // The previous policy, kept. §12 requires that a finalised period is not
    // rewritten when settings change later, and the first thing anybody asks
    // when a figure looks wrong is what the rules were at the time.
    await adminDb.collection("configHistory").add({
      configId: "attendance",
      previous: current,
      next,
      changedByUid: auth.uid,
      changedByName: auth.name ?? auth.email ?? null,
      changedAt: FieldValue.serverTimestamp(),
    });

    return next;
  });
}

/* -------------------------------------------------------------------------- */
/* Manual adjustment (§11)                                                     */
/* -------------------------------------------------------------------------- */

export interface AttendanceAdjustment {
  status?: AttendanceStatus;
  /** `HH:MM` in Karachi, or null to leave the recorded time alone. */
  checkIn?: string | null;
  checkOut?: string | null;
  late?: boolean;
  note?: string;
}

/**
 * Corrects one employee's day.
 *
 * **The observed times are never overwritten.** An adjustment is stored beside
 * them — `overrideStatus`, `adjustedCheckIn` — so the record still says what
 * actually happened as well as what HR decided about it. A correction that
 * destroyed the original would leave nothing to check the correction against.
 *
 * Every change appends to `adjustments` with who, when and what (§11), and
 * notifies the employee: their attendance changing without a word is exactly
 * how a payroll dispute starts.
 */
export async function adjustAttendance(
  token: string,
  uid: string,
  dayKey: string,
  change: AttendanceAdjustment
): Promise<ActionResult> {
  return runAction("adjustAttendance", async () => {
    const auth = await requireManager(token);
    const { hr, teamOf } = await attendanceScope(auth);

    const employeeSnap = await adminDb.collection("users").doc(uid).get();
    if (!employeeSnap.exists) throw new UserFacingError("That employee no longer exists.");

    // A Sales manager may correct their own team and nobody else's.
    if (!hr && employeeSnap.data()?.subAdminUid !== teamOf) {
      throw new UserFacingError("That employee is not on your team.");
    }

    const ref = adminDb.collection("attendance").doc(attendanceDocId(uid, dayKey));

    await adminDb.runTransaction(async (t: Transaction) => {
      const snap = await t.get(ref);
      const existing = snap.data() ?? {};

      const entry = {
        at: new Date(),
        byUid: auth.uid,
        byName: auth.name ?? auth.email ?? null,
        from: {
          status: (existing.overrideStatus as AttendanceStatus) ?? null,
          late: Boolean(existing.late),
          checkIn: existing.adjustedCheckIn ?? null,
          checkOut: existing.adjustedCheckOut ?? null,
        },
        to: {
          status: change.status ?? null,
          late: change.late ?? Boolean(existing.late),
          checkIn: change.checkIn ?? null,
          checkOut: change.checkOut ?? null,
        },
        note: (change.note ?? "").trim() || null,
      };

      t.set(
        ref,
        {
          uid,
          dayKey,
          monthKey: dayKey.slice(0, 7),
          ...(change.status ? { overrideStatus: change.status } : null),
          ...(change.late === undefined ? null : { late: change.late }),
          ...(change.checkIn === undefined ? null : { adjustedCheckIn: change.checkIn }),
          ...(change.checkOut === undefined ? null : { adjustedCheckOut: change.checkOut }),
          overrideNote: (change.note ?? "").trim() || null,
          adjustedAt: FieldValue.serverTimestamp(),
          adjustedByUid: auth.uid,
          adjustments: FieldValue.arrayUnion(entry),
        },
        { merge: true }
      );

      t.set(adminDb.collection("notifications").doc(), {
        type: "ATTENDANCE_ADJUSTED",
        leadId: null,
        attendanceId: attendanceDocId(uid, dayKey),
        targetRole: "employee",
        targetUid: uid,
        payload: {
          message: `Your attendance for ${dayKey} was updated by ${auth.name ?? "an administrator"}.`,
          dayKey,
        },
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });
    });
  });
}

/* -------------------------------------------------------------------------- */
/* The absence sweep (§4)                                                      */
/* -------------------------------------------------------------------------- */

export interface AbsenceSweepResult {
  dayKey: string;
  marked: number;
  skipped: number;
}

/**
 * Marks everyone who has not checked in by the cutoff as absent.
 *
 * Run from the cron route after the configured time. Three things it
 * deliberately does **not** do:
 *
 * - It does not touch a day that already has a record, so a check-in at 11:59
 *   is never overwritten by a sweep at 12:00.
 * - It does not mark anyone on **approved leave** absent (§7). Leave days are
 *   written when the leave is approved, and the sweep steps over them.
 * - It does not run on the weekly off day, because nobody was expected.
 *
 * Idempotent by construction: the document id is `uid_dayKey`, and an existing
 * record is skipped. Running it twice marks nobody twice.
 */
export async function sweepAbsentees(dayKey?: string): Promise<AbsenceSweepResult> {
  const policy = await readPolicy();
  const now = new Date();
  const day = dayKey ?? karachiDayKey(now);

  const [roster, existing] = await Promise.all([
    adminDb.collection("users").where("role", "==", "employee").get(),
    adminDb.collection("attendance").where("dayKey", "==", day).get(),
  ]);

  const recorded = new Set(existing.docs.map((doc) => doc.data().uid as string));

  let marked = 0;
  let skipped = 0;
  const batch = adminDb.batch();

  for (const doc of roster.docs) {
    const employee = doc.data();
    if (employee.status === "DISABLED" || recorded.has(doc.id)) {
      skipped += 1;
      continue;
    }

    batch.set(adminDb.collection("attendance").doc(attendanceDocId(doc.id, day)), {
      uid: doc.id,
      email: employee.email ?? null,
      dayKey: day,
      monthKey: day.slice(0, 7),
      overrideStatus: "ABSENT" as AttendanceStatus,
      // Recorded as the system's own conclusion rather than an HR decision, so
      // the calendar and the audit trail can tell the two apart.
      markedAbsentBy: "SYSTEM",
      markedAbsentAt: FieldValue.serverTimestamp(),
      absenceCutoff: policy.absentCutoff,
      updatedAt: FieldValue.serverTimestamp(),
    });

    batch.set(adminDb.collection("notifications").doc(), {
      type: "ATTENDANCE_ABSENT",
      leadId: null,
      attendanceId: attendanceDocId(doc.id, day),
      targetRole: "admin",
      targetUid: null,
      payload: {
        message: `${employee.name ?? "An employee"} did not check in by ${policy.absentCutoff} on ${day}.`,
        uid: doc.id,
        dayKey: day,
      },
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
    });

    marked += 1;
  }

  if (marked > 0) await batch.commit();
  return { dayKey: day, marked, skipped };
}

/* -------------------------------------------------------------------------- */
/* Reading a team's attendance (§9, §10, §11)                                  */
/* -------------------------------------------------------------------------- */

/** One employee's day, flattened for the reports and the calendar. */
export interface TeamAttendanceDay {
  dayKey: string;
  status: AttendanceStatus;
  late: boolean;
  lateByMinutes: number;
  minutes: number;
  network: AttendanceNetwork;
  checkIn: string | null;
  checkOut: string | null;
  leaveType: string | null;
  note: string | null;
  adjusted: boolean;
}

/** One employee's whole range, with the figures §9 asks the report to show. */
export interface TeamAttendanceRow {
  uid: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  subAdminUid: string | null;
  managerName: string | null;
  monthlySalary: number;
  days: TeamAttendanceDay[];
  present: number;
  late: number;
  absent: number;
  leave: number;
  halfDay: number;
  off: number;
  workedMinutes: number;
  /** Present + half-days counted as half, over the days that could be worked. */
  rate: number;
  /** What the lates in this range cost under the policy as it stands today. */
  deduction: number;
}

export interface TeamAttendanceResult {
  from: string;
  to: string;
  rows: TeamAttendanceRow[];
  policy: AttendancePolicy;
  /** True when the reader is seeing the whole company rather than one team. */
  companyWide: boolean;
}

/**
 * A date range of attendance for everyone the reader is allowed to see.
 *
 * **This is a Server Action rather than a listener on purpose.** The Security
 * Rule can prove two cases without a lookup — the admin, and a person's own
 * days — but a Sales manager's team is a property of each *employee's* profile,
 * not of the attendance row, so a rule for it would need a document read per
 * day per employee. The action does that check once against the roster instead.
 * It is also the right shape for the feature: a report with a From/To and a set
 * of filters is a query someone runs, not a feed that should stream.
 *
 * The range is read in one `dayKey` scan and bucketed in memory. Employees
 * outside the reader's scope are dropped **after** the read rather than queried
 * per person: a per-employee query would be one round trip each, and the whole
 * point of a report is that it comes back at once.
 */
export async function getTeamAttendance(
  token: string,
  input: { from: string; to: string; uid?: string }
): Promise<ActionResult<TeamAttendanceResult>> {
  return runAction("getTeamAttendance", async () => {
    const auth = await requireManager(token);
    const { hr, teamOf } = await attendanceScope(auth);

    const from = input.from.slice(0, 10);
    const to = input.to.slice(0, 10);
    if (!from || !to || from > to) {
      throw new UserFacingError("Pick a start date on or before the end date.");
    }

    const [policy, usersSnap] = await Promise.all([
      readPolicy(),
      adminDb.collection("users").get(),
    ]);

    const profiles = new Map(usersSnap.docs.map((doc) => [doc.id, doc.data()]));

    // Managers appear in the report as a name, not a uid — the person reading
    // it thinks in names.
    const nameOf = (uid: string | null | undefined) =>
      uid ? ((profiles.get(uid)?.name as string) ?? null) : null;

    const visible = usersSnap.docs.filter((doc) => {
      const data = doc.data();
      if (data.role === "admin") return false;
      if (hr) return true;
      // A Sales manager sees their own team, and themselves.
      return data.subAdminUid === teamOf || doc.id === teamOf;
    });

    const wanted = input.uid
      ? visible.filter((doc) => doc.id === input.uid)
      : visible;

    if (input.uid && wanted.length === 0) {
      throw new UserFacingError("That employee is not on your team.");
    }

    const records = await adminDb
      .collection("attendance")
      .where("dayKey", ">=", from)
      .where("dayKey", "<=", to)
      .get();

    const byUid = new Map<string, TeamAttendanceDay[]>();
    for (const doc of records.docs) {
      const data = doc.data();
      const uid = String(data.uid ?? "");
      if (!uid) continue;

      const first = data.firstActionAt?.toDate?.() ?? null;
      const last = data.lastActionAt?.toDate?.() ?? null;
      const minutes = Number(data.workedMinutes ?? 0) || workedMinutesFrom(first, last);

      const status: AttendanceStatus =
        (data.overrideStatus as AttendanceStatus) ??
        (data.late ? "LATE" : deriveStatus(minutes, Boolean(first ?? data.checkedOut)));

      const list = byUid.get(uid) ?? [];
      list.push({
        dayKey: String(data.dayKey ?? ""),
        status,
        late: Boolean(data.late),
        lateByMinutes: Number(data.lateByMinutes ?? 0),
        minutes,
        network: (data.network as AttendanceNetwork) ?? "UNKNOWN",
        checkIn: data.adjustedCheckIn ?? formatKarachiClock(first),
        checkOut: data.adjustedCheckOut ?? formatKarachiClock(last),
        leaveType: (data.leaveType as string) ?? null,
        note: (data.overrideNote as string) ?? null,
        adjusted: Array.isArray(data.adjustments) && data.adjustments.length > 0,
      });
      byUid.set(uid, list);
    }

    const rows: TeamAttendanceRow[] = wanted.map((doc) => {
      const data = doc.data();
      const days = (byUid.get(doc.id) ?? []).sort((a, b) => a.dayKey.localeCompare(b.dayKey));

      const count = (status: AttendanceStatus) =>
        days.filter((day) => day.status === status).length;

      const present = count("PRESENT");
      const late = count("LATE");
      const halfDay = count("HALF_DAY");
      const absent = count("ABSENT");
      const leave = count("LEAVE");
      const off = count("OFF");

      // Approved leave leaves the denominator rather than counting against the
      // employee — the same rule `attendanceRate` applies, kept identical here
      // so the report and the employee's own screen cannot disagree.
      const considered = present + late + halfDay + absent;
      const credited = present + late + halfDay * 0.5;

      return {
        uid: doc.id,
        name: (data.name as string) ?? (data.email as string) ?? "Unnamed",
        email: (data.email as string) ?? null,
        jobTitle: (data.jobTitle as string) ?? null,
        subAdminUid: (data.subAdminUid as string) ?? null,
        managerName: nameOf(data.subAdminUid as string | undefined),
        monthlySalary: Number(data.monthlySalary ?? 0),
        days,
        present,
        late,
        absent,
        leave,
        halfDay,
        off,
        workedMinutes: days.reduce((sum, day) => sum + day.minutes, 0),
        rate: considered === 0 ? 0 : Math.round((credited / considered) * 100),
        deduction: monthDeductions(late, policy, Number(data.monthlySalary ?? 0)).total,
      };
    });

    rows.sort((a, b) => a.name.localeCompare(b.name));

    return { from, to, rows, policy, companyWide: hr };
  });
}

/** Minutes between two stamps, or 0 when the day never closed. */
function workedMinutesFrom(first: Date | null, last: Date | null): number {
  if (!first || !last) return 0;
  return Math.max(0, Math.round((last.getTime() - first.getTime()) / 60000));
}

/** `HH:MM` in Karachi, which is the only timezone this business runs in. */
function formatKarachiClock(date: Date | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/* -------------------------------------------------------------------------- */
/* One person's month (§10)                                                    */
/* -------------------------------------------------------------------------- */

/** The parts of the policy an employee is entitled to know about themselves. */
export interface AttendanceRules {
  startTime: string;
  graceMinutes: number;
  lateAfter: string;
  absentCutoff: string;
  allowedLates: number;
  deductionMode: AttendancePolicy["deductionMode"];
  deductionValue: number;
  ipRestriction: boolean;
}

export interface AttendanceSummary {
  uid: string;
  monthKey: string;
  present: number;
  late: number;
  absent: number;
  leave: number;
  halfDay: number;
  workedMinutes: number;
  rate: number;
  /** Every late in the month, with the rule each was charged under. */
  deductions: { occurrence: number; deducted: boolean; amount: number; basis: string }[];
  deductionTotal: number;
  rules: AttendanceRules;
}

/**
 * One employee's month, with the deduction working shown.
 *
 * Callable by the person themselves — this is the only attendance action an
 * employee may run for their own record, and §10 needs it: the figures behind
 * "you were late three times and it cost you 1,000" are a policy read and a
 * count, neither of which the browser may do for itself.
 *
 * Each late carries the **rule it was charged under, in words**. §12 requires
 * that changing the policy does not rewrite a finalised period, and a figure
 * that cannot explain itself is one nobody can check.
 */
export async function getAttendanceSummary(
  token: string,
  uid?: string,
  monthKey?: string
): Promise<ActionResult<AttendanceSummary>> {
  return runAction("getAttendanceSummary", async () => {
    const auth = await verifyAuth(token);
    const target = (uid ?? "").trim() || auth.uid;

    if (target !== auth.uid) {
      if (auth.role === "employee") {
        throw new UserFacingError("You can only see your own attendance.");
      }
      const { hr, teamOf } = await attendanceScope(auth);
      if (!hr) {
        const employee = await adminDb.collection("users").doc(target).get();
        if (employee.data()?.subAdminUid !== teamOf) {
          throw new UserFacingError("That employee is not on your team.");
        }
      }
    }

    const month = (monthKey ?? karachiMonthKey()).slice(0, 7);

    const [policy, profile, snap] = await Promise.all([
      readPolicy(),
      adminDb.collection("users").doc(target).get(),
      adminDb
        .collection("attendance")
        .where("uid", "==", target)
        .where("dayKey", ">=", `${month}-01`)
        .where("dayKey", "<=", `${month}-31`)
        .get(),
    ]);

    let present = 0;
    let late = 0;
    let absent = 0;
    let leave = 0;
    let halfDay = 0;
    let minutesTotal = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const first = data.firstActionAt?.toDate?.() ?? null;
      const last = data.lastActionAt?.toDate?.() ?? null;
      const minutes = Number(data.workedMinutes ?? 0) || workedMinutesFrom(first, last);
      minutesTotal += minutes;

      const status: AttendanceStatus =
        (data.overrideStatus as AttendanceStatus) ??
        (data.late ? "LATE" : deriveStatus(minutes, Boolean(first ?? data.checkedOut)));

      if (status === "PRESENT") present += 1;
      else if (status === "LATE") late += 1;
      else if (status === "ABSENT") absent += 1;
      else if (status === "LEAVE") leave += 1;
      else if (status === "HALF_DAY") halfDay += 1;
    }

    // Approved leave leaves the denominator rather than counting against the
    // employee — the same rule `attendanceRate` uses, so this figure and the
    // one on their own calendar cannot disagree.
    const considered = present + late + halfDay + absent;
    const credited = present + late + halfDay * 0.5;

    const { outcomes, total } = monthDeductions(
      late,
      policy,
      Number(profile.data()?.monthlySalary ?? 0)
    );

    return {
      uid: target,
      monthKey: month,
      present,
      late,
      absent,
      leave,
      halfDay,
      workedMinutes: minutesTotal,
      rate: considered === 0 ? 0 : Math.round((credited / considered) * 100),
      deductions: outcomes,
      deductionTotal: total,
      rules: {
        startTime: policy.startTime,
        graceMinutes: policy.graceMinutes,
        lateAfter: formatClockValue((parseClock(policy.startTime) ?? 0) + policy.graceMinutes),
        absentCutoff: policy.absentCutoff,
        allowedLates: policy.allowedLates,
        deductionMode: policy.deductionMode,
        deductionValue: policy.deductionValue,
        ipRestriction: policy.ipRestriction,
      },
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Finalising a month's deductions (§12)                                       */
/* -------------------------------------------------------------------------- */

/** One employee's frozen line in a closed month. */
export interface PayrollDeductionLine {
  uid: string;
  name: string;
  monthlySalary: number;
  lateCount: number;
  amount: number;
  /** The rule each charge was made under, in words, as it stood at closing. */
  basis: string[];
}

export interface AttendancePeriod {
  monthKey: string;
  finalized: boolean;
  finalizedAt: string | null;
  finalizedByUid: string | null;
  finalizedByName: string | null;
  lines: PayrollDeductionLine[];
  total: number;
  /** The policy as it stood when the month was closed. */
  policy: AttendancePolicy | null;
}

/**
 * Closes a month's attendance deductions.
 *
 * **This is the whole of §12's "without rewriting finalised records".** The
 * figures on the Late / Absence screen are recomputed from the live policy on
 * every read, which is right while a month is open and wrong the moment it has
 * been paid: raising the deduction from Rs 1,000 to Rs 2,000 in October must
 * not silently change what September cost. So finalising **copies** the lines
 * into `attendancePeriods/{YYYY-MM}` — the amounts, the salaries they were
 * computed from, and the rule each charge was made under, in words — and every
 * later read of a closed month returns that copy rather than a fresh
 * calculation.
 *
 * Re-finalising is refused rather than silently overwriting. Reopening is its
 * own action, so undoing a payroll decision is a deliberate act with its own
 * audit line rather than a side effect of pressing Finalise twice.
 */
export async function finalizeAttendanceDeductions(
  token: string,
  monthKey: string
): Promise<ActionResult<{ monthKey: string; total: number; people: number }>> {
  return runAction("finalizeAttendanceDeductions", async () => {
    const auth = await requireHr(token);
    const month = monthKey.slice(0, 7);

    if (month >= karachiMonthKey()) {
      // A month still running would be closed on partial data, and every
      // remaining day of it would then be uncharged with nothing on screen to
      // say so.
      throw new UserFacingError("Wait until the month is over before closing it.");
    }

    const ref = adminDb.collection("attendancePeriods").doc(month);
    const existing = await ref.get();
    if (existing.exists && existing.data()?.finalized) {
      throw new UserFacingError(
        `${month} was already finalised. Reopen it first if the figures need to change.`
      );
    }

    const [policy, usersSnap, records] = await Promise.all([
      readPolicy(),
      adminDb.collection("users").get(),
      adminDb
        .collection("attendance")
        .where("dayKey", ">=", `${month}-01`)
        .where("dayKey", "<=", `${month}-31`)
        .get(),
    ]);

    const lateCounts = new Map<string, number>();
    for (const doc of records.docs) {
      const data = doc.data();
      // An override wins: a late HR has excused is not a late any more, and
      // charging for it after somebody corrected it would be the exact bug
      // this whole module's audit trail exists to prevent.
      const excused = data.overrideStatus && data.overrideStatus !== "LATE";
      if (!data.late || excused) continue;
      const uid = String(data.uid ?? "");
      if (uid) lateCounts.set(uid, (lateCounts.get(uid) ?? 0) + 1);
    }

    const lines: PayrollDeductionLine[] = [];
    for (const doc of usersSnap.docs) {
      const data = doc.data();
      if (data.role === "admin") continue;

      const lateCount = lateCounts.get(doc.id) ?? 0;
      if (lateCount === 0) continue;

      const salary = Number(data.monthlySalary ?? 0);
      const { outcomes, total } = monthDeductions(lateCount, policy, salary);
      if (total === 0) continue;

      lines.push({
        uid: doc.id,
        name: (data.name as string) ?? (data.email as string) ?? "Unnamed",
        monthlySalary: salary,
        lateCount,
        amount: total,
        basis: outcomes.filter((outcome) => outcome.deducted).map((outcome) => outcome.basis),
      });
    }

    const total = lines.reduce((sum, line) => sum + line.amount, 0);

    await ref.set({
      monthKey: month,
      finalized: true,
      finalizedAt: FieldValue.serverTimestamp(),
      finalizedByUid: auth.uid,
      finalizedByName: auth.name ?? auth.email ?? null,
      lines,
      total,
      // The rule the figures were produced under, stored beside them.
      policy,
    });

    // Everybody charged is told, because a deduction nobody was told about is
    // the thing people find out about on payday.
    const batch = adminDb.batch();
    for (const line of lines) {
      batch.set(adminDb.collection("notifications").doc(), {
        type: "ATTENDANCE_DEDUCTION_FINALIZED",
        leadId: null,
        targetRole: "employee",
        targetUid: line.uid,
        payload: {
          message: `A late deduction of Rs ${line.amount.toLocaleString(
            "en-PK"
          )} was recorded for ${month} (${line.lateCount} late arrival${
            line.lateCount === 1 ? "" : "s"
          }).`,
          monthKey: month,
        },
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });
    }
    await batch.commit();

    return { monthKey: month, total, people: lines.length };
  });
}

/**
 * Reopens a closed month.
 *
 * Kept apart from finalising on purpose: undoing a payroll decision is not
 * something anybody should reach by pressing the same button again. The frozen
 * lines are left in place and simply marked not final, so what was approved is
 * still readable after it has been undone.
 */
export async function reopenAttendancePeriod(
  token: string,
  monthKey: string
): Promise<ActionResult> {
  return runAction("reopenAttendancePeriod", async () => {
    const auth = await requireHr(token);
    const month = monthKey.slice(0, 7);
    const ref = adminDb.collection("attendancePeriods").doc(month);

    const snap = await ref.get();
    if (!snap.exists || !snap.data()?.finalized) {
      throw new UserFacingError(`${month} is not closed.`);
    }

    await ref.update({
      finalized: false,
      reopenedAt: FieldValue.serverTimestamp(),
      reopenedByUid: auth.uid,
    });
  });
}

/** The frozen record of a month, or an open month's empty shell. */
export async function getAttendancePeriod(
  token: string,
  monthKey: string
): Promise<ActionResult<AttendancePeriod>> {
  return runAction("getAttendancePeriod", async () => {
    await requireManager(token);
    const month = monthKey.slice(0, 7);

    const snap = await adminDb.collection("attendancePeriods").doc(month).get();
    if (!snap.exists) {
      return {
        monthKey: month,
        finalized: false,
        finalizedAt: null,
        finalizedByUid: null,
        finalizedByName: null,
        lines: [],
        total: 0,
        policy: null,
      };
    }

    const data = snap.data() ?? {};
    return {
      monthKey: month,
      finalized: Boolean(data.finalized),
      finalizedAt: data.finalizedAt?.toDate?.()?.toISOString() ?? null,
      finalizedByUid: (data.finalizedByUid as string) ?? null,
      finalizedByName: (data.finalizedByName as string) ?? null,
      lines: (data.lines as PayrollDeductionLine[]) ?? [],
      total: Number(data.total ?? 0),
      policy: (data.policy as AttendancePolicy) ?? null,
    };
  });
}
