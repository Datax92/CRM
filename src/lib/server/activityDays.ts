import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/server";
import { cached, docKey } from "@/lib/server/serverCache";
import { ACTIVITY_DAYS, ACTIVITY_TOTALS_FROM, activityDayId, activityDelta, type EntryFacts } from "@/lib/activityDays";

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
