/**
 * Writes `phoneKey` onto Data Bank leads that predate it.
 *
 *   npm run backfill:lead-phone-keys            # dry run — counts, writes nothing
 *   npm run backfill:lead-phone-keys -- --confirm
 *
 * **Why it exists.** A Data Bank folder refuses a number it already holds, but
 * a promoted row leaves the folder, so the folder used to forget the number the
 * moment it was worked — and re-importing the same sheet put the same client in
 * the pipeline twice. The folder now also asks the leads it has handed out,
 * which it can only do by `leads.phoneKey`. Promotion writes that field from
 * 2026-09-13 on; this fills it in on every Data Bank lead written before.
 *
 * One read per lead and one write per lead that needs it. Safe to run again:
 * a lead that already carries the right key is skipped. It changes nothing
 * else on the lead, and the key is the same normalisation the folder uses
 * (`phoneKey` in `lib/dataBank`), imported rather than restated.
 */

import { initializeApp, cert } from "firebase-admin/app";
import { initializeFirestore } from "firebase-admin/firestore";
import { phoneKey } from "../src/lib/dataBank.ts";

const confirm = process.argv.includes("--confirm");

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
if (!clientEmail || !privateKey) {
  console.error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are not set in .env.local.");
  process.exit(1);
}

const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
// REST, for the reason recorded in CLAUDE.md: over gRPC a spent quota retries
// forever instead of failing.
const db = initializeFirestore(app, { preferRest: true });

const snap = await db.collection("leads").select("phone", "phoneKey", "dataBankFolderId").get();

const pending: Array<{ id: string; key: string }> = [];
let already = 0;
let notDataBank = 0;
let unusable = 0;

for (const doc of snap.docs) {
  const data = doc.data();
  if (!data.dataBankFolderId) {
    notDataBank += 1;
    continue;
  }
  const key = phoneKey(data.phone as string | undefined);
  if (!key) {
    unusable += 1;
    continue;
  }
  if (data.phoneKey === key) {
    already += 1;
    continue;
  }
  pending.push({ id: doc.id, key });
}

console.log(`project        ${projectId}`);
console.log(`leads read     ${snap.size}`);
console.log(`not Data Bank  ${notDataBank}`);
console.log(`no usable no.  ${unusable}`);
console.log(`already set    ${already}`);
console.log(`to write       ${pending.length}`);

if (!confirm) {
  console.log("\nDry run. Re-run with -- --confirm to write.");
  process.exit(0);
}

let written = 0;
for (let i = 0; i < pending.length; i += 400) {
  const batch = db.batch();
  for (const { id, key } of pending.slice(i, i + 400)) {
    batch.update(db.collection("leads").doc(id), { phoneKey: key });
  }
  await batch.commit();
  written += Math.min(400, pending.length - i);
}
console.log(`\nwrote          ${written}`);
process.exit(0);
