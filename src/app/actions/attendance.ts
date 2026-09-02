"use server";

import { headers } from "next/headers";
import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, requireAdmin } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import {
  classifyNetwork,
  clientIpFromHeaders,
  isValidIp,
  normalizeIp,
  type AttendanceNetwork,
  type AttendanceStatus,
} from "@/lib/attendance";
import { FieldValue, Transaction } from "firebase-admin/firestore";

export interface AttendanceConfig {
  /** Public IPs that count as the office. Empty means "not configured". */
  officeIps: string[];
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
  const snap = await adminDb.collection("config").doc("attendance").get();
  const raw = snap.data()?.officeIps;
  return Array.isArray(raw) ? raw.map((v: unknown) => normalizeIp(String(v))).filter(Boolean) : [];
}

export type PunchKind = "IN" | "OUT";

export interface AttendancePunchResult extends AttendancePingResult {
  kind: PunchKind;
  /** True when the punch changed nothing — a second Check In on the same day. */
  alreadyDone: boolean;
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
    const network = classifyNetwork(ip, await readOfficeIps());

    const now = new Date();
    const dayKey = karachiDayKey(now);
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
      };
    });

    return {
      kind,
      alreadyDone: saved.alreadyDone,
      dayKey,
      network: saved.network,
      ip,
      firstActionAt: saved.firstAt.toISOString(),
      lastActionAt: (saved.lastAt ?? saved.firstAt).toISOString(),
    };
  });
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

/** The office network settings, for the admin Settings page. */
export async function getAttendanceConfig(
  token: string
): Promise<ActionResult<AttendanceConfig & { yourIp: string }>> {
  return runAction("getAttendanceConfig", async () => {
    await requireAdmin(token);
    const requestHeaders = await headers();

    return {
      officeIps: await readOfficeIps(),
      // Surfaced so the admin can fill the field with one click instead of
      // hunting for "what is my IP" on a third-party site.
      yourIp: clientIpFromHeaders(requestHeaders),
    };
  });
}

export async function setAttendanceConfig(
  token: string,
  officeIps: string[]
): Promise<ActionResult<AttendanceConfig>> {
  return runAction("setAttendanceConfig", async () => {
    await requireAdmin(token);

    const cleaned = Array.from(
      new Set((officeIps ?? []).map((ip) => normalizeIp(String(ip))).filter(Boolean))
    );

    for (const ip of cleaned) {
      if (!isValidIp(ip)) {
        throw new UserFacingError(`"${ip}" is not a valid IP address.`);
      }
    }
    if (cleaned.length > 10) {
      throw new UserFacingError("Ten office addresses is the maximum.");
    }

    await adminDb
      .collection("config")
      .doc("attendance")
      .set({ officeIps: cleaned, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    return { officeIps: cleaned };
  });
}
