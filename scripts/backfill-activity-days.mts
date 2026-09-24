/**
 * Fills `activityDays` for the days before Reports started reading them, then
 * moves `config/activityTotals.from` back so Reports reads every day from the
 * small day documents instead of the entries. See `src/lib/activityDays.ts`.
 *
 *   npm run backfill:activity-days            # dry run: counts, writes nothing
 *   npm run backfill:activity-days -- --confirm
 *
 * **Only days before the current start date are written**, and each is written
 * whole (`set`, not merge): those days have no live counter, so the entries
 * are the only truth for them. Days on or after it belong to the live counters
 * in `addFollowUp` / `updateFollowUp` and are never touched — a re-run cannot
 * double anything.
 *
 * Cost: one read per entry ever written (a few thousand), and one write per
 * person-day. Run it once, on a day with quota to spare.
 *
 * **Also fills the two fields added 2026-09-24** — `answeredCalls` (calls
 * under 1:10) and `workedMinutes` (from attendance). Days before the start date
 * get them as part of the whole write. Days on or after it already have live
 * documents that predate those fields, so for those days **only these two
 * fields** are recomputed and merged — absolute values from the entries and
 * attendance, so a re-run is still safe and the live counters are untouched.
 */

import { initializeApp, cert } from "firebase-admin/app";
import { initializeFirestore } from "firebase-admin/firestore";
import {
  ACTIVITY_DAYS,
  ACTIVITY_FIELDS,
  ACTIVITY_TOTALS_FROM,
  activityDayId,
  countsOf,
  emptyCounts,
  type ActivityCounts,
} from "../src/lib/activityDays.ts";

const confirm = process.argv.includes("--confirm");

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
if (!clientEmail || !privateKey) {
  console.error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are not set in .env.local.");
  process.exit(1);
}
const db = initializeFirestore(initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }), { preferRest: true });

const configRef = db.collection("config").doc("activityTotals");
const stored = (await configRef.get()).get("from");
const liveFrom = typeof stored === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stored) ? stored : ACTIVITY_TOTALS_FROM;

const snap = await db.collectionGroup("followUps").where("dayKey", "<", liveFrom).get();

// Worked minutes per person-day, from attendance — every day, both halves.
const attendance = await db.collection("attendance").get();
const worked = new Map<string, { uid: string; dayKey: string; minutes: number }>();
for (const doc of attendance.docs) {
  const data = doc.data();
  const uid = data.uid as string | undefined;
  const dayKey = data.dayKey as string | undefined;
  if (!uid || !dayKey) continue;
  let minutes = Number(data.workedMinutes ?? 0);
  if (!(minutes > 0)) {
    const first = data.firstActionAt?.toDate?.() as Date | undefined;
    const last = data.lastActionAt?.toDate?.() as Date | undefined;
    minutes = first && last ? Math.max(0, Math.round((last.getTime() - first.getTime()) / 60000)) : 0;
  }
  if (minutes > 0) worked.set(activityDayId(uid, dayKey), { uid, dayKey, minutes });
}
const days = new Map<string, { uid: string; dayKey: string; counts: ActivityCounts }>();
let skipped = 0;
let earliest = liveFrom;
for (const doc of snap.docs) {
  const entry = doc.data();
  // Credited exactly as Reports credits it — entries with neither field are
  // not counted there either.
  const uid = (entry.creditUid as string | undefined) ?? (entry.authorUid as string | undefined);
  const dayKey = entry.dayKey as string | undefined;
  if (!uid || !dayKey) {
    skipped++;
    continue;
  }
  if (dayKey < earliest) earliest = dayKey;
  const id = activityDayId(uid, dayKey);
  const day = days.get(id) ?? { uid, dayKey, counts: emptyCounts() };
  const add = countsOf({
    kind: entry.kind ?? null,
    connect: entry.connect === true,
    meetingAligned: entry.meetingAligned === true,
    meetingHeld: entry.meetingHeld === true,
    siteVisit: entry.siteVisit === true,
    callMade: entry.callMade === true,
  });
  for (const field of ACTIVITY_FIELDS) day.counts[field] += add[field];
  days.set(id, day);
}

// Days on or after the start date: only the two new fields, recomputed.
const liveSnap = await db.collectionGroup("followUps").where("dayKey", ">=", liveFrom).get();
const liveDays = new Map<string, { uid: string; dayKey: string; answeredCalls: number; workedMinutes: number }>();
for (const doc of liveSnap.docs) {
  const entry = doc.data();
  const uid = (entry.creditUid as string | undefined) ?? (entry.authorUid as string | undefined);
  const dayKey = entry.dayKey as string | undefined;
  if (!uid || !dayKey) continue;
  const id = activityDayId(uid, dayKey);
  const day = liveDays.get(id) ?? { uid, dayKey, answeredCalls: 0, workedMinutes: 0 };
  day.answeredCalls += countsOf({ connect: entry.connect === true, callMade: entry.callMade === true }).answeredCalls;
  liveDays.set(id, day);
}
for (const [id, day] of worked) {
  if (day.dayKey < liveFrom) continue;
  const entry = liveDays.get(id) ?? { uid: day.uid, dayKey: day.dayKey, answeredCalls: 0, workedMinutes: 0 };
  entry.workedMinutes = day.minutes;
  liveDays.set(id, entry);
}

console.log(`Live counters start ${liveFrom}.`);
console.log(`${snap.size} entries before it → ${days.size} person-days (earliest ${earliest}); ${skipped} with no owner or day, skipped as Reports skips them.`);
console.log(`${attendance.size} attendance days read for hours.`);
console.log(`${liveSnap.size} entries on or after it → ${liveDays.size} live person-days get answeredCalls + workedMinutes.`);

if (!confirm) {
  console.log("Dry run — nothing written. Re-run with --confirm to write.");
  process.exit(0);
}

let batch = db.batch();
let inBatch = 0;
for (const [id, day] of days) {
  batch.set(db.collection(ACTIVITY_DAYS).doc(id), {
    uid: day.uid,
    dayKey: day.dayKey,
    ...day.counts,
    workedMinutes: worked.get(id)?.minutes ?? 0,
    backfilled: true,
  });
  if (++inBatch === 400) {
    await batch.commit();
    batch = db.batch();
    inBatch = 0;
  }
}
// Hours for a pre-start day with attendance but no entries at all.
for (const [id, day] of worked) {
  if (day.dayKey >= liveFrom || days.has(id)) continue;
  batch.set(db.collection(ACTIVITY_DAYS).doc(id), { uid: day.uid, dayKey: day.dayKey, workedMinutes: day.minutes, backfilled: true }, { merge: true });
  if (++inBatch === 400) {
    await batch.commit();
    batch = db.batch();
    inBatch = 0;
  }
}
for (const [id, day] of liveDays) {
  batch.set(
    db.collection(ACTIVITY_DAYS).doc(id),
    { uid: day.uid, dayKey: day.dayKey, answeredCalls: day.answeredCalls, workedMinutes: day.workedMinutes },
    { merge: true }
  );
  if (++inBatch === 400) {
    await batch.commit();
    batch = db.batch();
    inBatch = 0;
  }
}
if (inBatch > 0) await batch.commit();
await configRef.set({ from: earliest, backfilledAt: new Date() }, { merge: true });
console.log(`Wrote ${days.size} day documents. Reports now reads day totals from ${earliest}.`);
