import { adminDb } from "@/lib/firebase/server";
import { cached } from "@/lib/server/serverCache";

/**
 * A month of attendance, and the roster, read once and shared for a minute by
 * the screens that each used to read them in full (owner, 2026-09-26).
 *
 * The read meter's walkthrough: the team calendar (~270), payroll (~140) and
 * the attendance summary each read **every attendance record of the month**
 * and **every user**, one after another, for the same answer. They now share
 * one copy per server for `TTL_MS`.
 *
 * **Current on this server, a minute behind at worst on others.** Any write to
 * an `attendance/` document drops the cached months here at once (`noteWrite`
 * in `lib/server/serverCache`, called for every write by the central
 * `WriteBatch` hook), and a profile write drops the roster. Another warm
 * server keeps its copy until the minute is up.
 *
 * **`fresh` for anything that decides a write.** Paying a salary writes a
 * payslip with that moment's figures, so `payPayrollLine` reads the database
 * directly — a correction made a moment ago on another server must be the one
 * that is paid. This follows the cache's own rule: never for a read that
 * decides a write.
 */

const TTL_MS = 60_000;

export interface CachedDoc {
  id: string;
  data: FirebaseFirestore.DocumentData;
}

/** Every attendance record dated in `monthKey` (`YYYY-MM`). */
export function readAttendanceMonth(monthKey: string, fresh = false): Promise<CachedDoc[]> {
  const load = async () =>
    (
      await adminDb
        .collection("attendance")
        .where("dayKey", ">=", `${monthKey}-01`)
        .where("dayKey", "<=", `${monthKey}-31`)
        .get()
    ).docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  return fresh ? load() : cached(`attendanceMonth:${monthKey}`, TTL_MS, load);
}

/**
 * Every user. The same key and shape Reports fills (`roster:everyone`), so a
 * report, the calendar and payroll opened within a minute share one read.
 */
export function readRoster(fresh = false): Promise<CachedDoc[]> {
  const load = async () =>
    (await adminDb.collection("users").get()).docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  return fresh ? load() : cached("roster:everyone", TTL_MS, load);
}
