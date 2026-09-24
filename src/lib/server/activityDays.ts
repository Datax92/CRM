import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/server";
import { cached, docKey } from "@/lib/server/serverCache";
import {
  ACTIVITY_DAYS,
  ACTIVITY_TOTALS_FROM,
  activityDayId,
  activityDelta,
  readWorkedMinutes,
  splitRange,
  type EntryFacts,
} from "@/lib/activityDays";

/**
 * Moves one person's day document by what an entry adds or an edit changes,
 * inside the caller's transaction. The rules and the reason are in
 * `lib/activityDays`.
 *
 * `set(…, { merge: true })` with increments needs no read, so it adds nothing
 * to the transaction's read set and cannot conflict with the reads the entry
 * write already depends on.
 */
export function writeActivityDelta(
  t: Transaction,
  uid: string,
  dayKey: string,
  before: EntryFacts | null,
  after: EntryFacts
): void {
  if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return;
  const delta = activityDelta(before, after);
  const fields = Object.entries(delta);
  if (fields.length === 0) return;
  t.set(
    adminDb.collection(ACTIVITY_DAYS).doc(activityDayId(uid, dayKey)),
    {
      uid,
      dayKey,
      ...Object.fromEntries(fields.map(([field, change]) => [field, FieldValue.increment(change as number)])),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Copies a day's worked minutes onto the person's day document, inside the
 * attendance transaction that computed them (owner, 2026-09-24: "total hours"
 * in Team and the dossier, without spending reads). Absolute, not an increment
 * — the attendance record is the truth and this is a mirror of it.
 */
export function writeWorkedMinutes(t: Transaction, uid: string, dayKey: string, minutes: number): void {
  if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return;
  t.set(
    adminDb.collection(ACTIVITY_DAYS).doc(activityDayId(uid, dayKey)),
    {
      uid,
      dayKey,
      workedMinutes: Math.max(0, Math.round(Number(minutes) || 0)),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Minutes worked per person over a range, read from `attendance` — only for
 * days before the day documents start (see `readActivityTotalsFrom`). One
 * `dayKey` range scan, bucketed in memory, the same shape the attendance report
 * uses. Remembered for ten minutes: a closed past range does not change.
 */
export async function attendanceMinutes(from: string, to: string): Promise<Map<string, number>> {
  const rows = await cached(`attendanceMinutes:${from}:${to}`, 10 * 60_000, async () => {
    const snap = await adminDb
      .collection("attendance")
      .where("dayKey", ">=", from)
      .where("dayKey", "<=", to)
      .get();
    const out: Array<[string, number]> = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      const uid = String(data.uid ?? "");
      if (!uid) continue;
      let minutes = Number(data.workedMinutes ?? 0);
      if (!(minutes > 0)) {
        // Same fallback the attendance report uses for a record written before
        // `workedMinutes` was stored.
        const first = data.firstActionAt?.toDate?.() as Date | undefined;
        const last = data.lastActionAt?.toDate?.() as Date | undefined;
        minutes = first && last ? Math.max(0, Math.round((last.getTime() - first.getTime()) / 60000)) : 0;
      }
      if (minutes > 0) out.push([uid, minutes]);
    }
    return out;
  });
  const byUid = new Map<string, number>();
  for (const [uid, minutes] of rows) byUid.set(uid, (byUid.get(uid) ?? 0) + minutes);
  return byUid;
}

/**
 * Minutes worked per person over a range: the day documents from the start
 * date on (one small document per person-day, and only days with a check-out
 * have one), attendance before it.
 */
export async function loadWorkedMinutes(uids: string[], from: string, to: string): Promise<Map<string, number>> {
  const wanted = new Set(uids);
  const byUid = new Map<string, number>();
  const add = (uid: string, minutes: number) => {
    if (wanted.has(uid) && minutes > 0) byUid.set(uid, (byUid.get(uid) ?? 0) + minutes);
  };
  const range = splitRange(from, to, await readActivityTotalsFrom());
  const list = [...wanted];
  const slices: string[][] = [];
  for (let index = 0; index < list.length; index += 30) slices.push(list.slice(index, index + 30));
  const [daySnaps, before] = await Promise.all([
    range.totals
      ? Promise.all(
          slices.map((slice) =>
            adminDb
              .collection(ACTIVITY_DAYS)
              .where("uid", "in", slice)
              .where("dayKey", ">=", range.totals!.from)
              .where("dayKey", "<=", range.totals!.to)
              .get()
          )
        )
      : Promise.resolve([]),
    range.entries ? attendanceMinutes(range.entries.from, range.entries.to) : Promise.resolve(new Map<string, number>()),
  ]);
  for (const snap of daySnaps) for (const doc of snap.docs) add(String(doc.get("uid") ?? ""), readWorkedMinutes(doc.data()));
  for (const [uid, minutes] of before) add(uid, minutes);
  return byUid;
}

/**
 * The first day Reports may read from `activityDays` — `config/activityTotals`
 * once the backfill has run, `ACTIVITY_TOTALS_FROM` until then. A read that
 * fails falls back to the default rather than failing the report: the default
 * is only ever later, which means more days read from entries, never fewer.
 */
export async function readActivityTotalsFrom(): Promise<string> {
  try {
    // Cached ten minutes: it moves once, when the backfill runs.
    const value = await cached(docKey("config/activityTotals"), 10 * 60_000, async () =>
      (await adminDb.collection("config").doc("activityTotals").get()).get("from") as unknown
    );
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  } catch {
    // fall through
  }
  return ACTIVITY_TOTALS_FROM;
}
