/**
 * Reproduces `buildTeamReport`'s query sequence against the live project,
 * timing each step and printing the real error when one fails.
 *
 *   npm run diagnose:report
 *
 * The action itself only ever reaches the browser as "Something went wrong on
 * our side" — `runAction` logs the cause to the server terminal and returns a
 * generic message, which is right for users and useless for a bug report. This
 * runs the same steps with the same credentials so the cause is on screen.
 *
 * Read-only. Counts first, so the cost of running it is known before the
 * queries that could be large.
 */

import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId =
  process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';

if (getApps().length === 0) {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  initializeApp(
    clientEmail && privateKey
      ? { credential: cert({ projectId, clientEmail, privateKey }), projectId }
      : { credential: applicationDefault(), projectId }
  );
}

const db = getFirestore();
db.settings({ preferRest: process.env.FIREBASE_PREFER_REST !== 'false', ignoreUndefinedProperties: true });

const from = process.argv[2] ?? '2026-09-01';
const to = process.argv[3] ?? '2026-09-04';

async function step<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  const started = Date.now();
  try {
    const value = await run();
    console.log(`  ok    ${String(Date.now() - started).padStart(6)}ms  ${label}`);
    return value;
  } catch (error) {
    console.log(`  FAIL  ${String(Date.now() - started).padStart(6)}ms  ${label}`);
    const err = error as { code?: unknown; message?: string; stack?: string };
    console.log(`        code:    ${JSON.stringify(err.code)}`);
    console.log(`        message: ${err.message}`);
    return null;
  }
}

function chunk<T>(all: T[], size = 30): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size));
  return out;
}

console.log(`\nProject: ${projectId}   Range: ${from} → ${to}\n`);

/* ---------------------------------------------------------------- */
console.log('1. Size of the collections this touches');

for (const name of ['users', 'leads', 'closedDeals']) {
  await step(`count ${name}`, async () => {
    const snap = await db.collection(name).count().get();
    console.log(`        ${snap.data().count} documents`);
    return snap;
  });
}

await step('count followUps (collection group)', async () => {
  const snap = await db.collectionGroup('followUps').count().get();
  console.log(`        ${snap.data().count} documents`);
  return snap;
});

/* ---------------------------------------------------------------- */
console.log('\n2. The roster read');

const users = await step('users.get()', () => db.collection('users').get());
if (!users) process.exit(1);

const people = users.docs.map((d) => ({
  uid: d.id,
  name: (d.data().name as string) || (d.data().email as string) || 'Unnamed',
  role: (d.data().role as string) ?? 'employee',
}));
const byRole = people.reduce<Record<string, number>>((acc, p) => {
  acc[p.role] = (acc[p.role] ?? 0) + 1;
  return acc;
}, {});
console.log(`        ${people.length} users:`, byRole);

const employees = people.filter((p) => p.role === 'employee');
const uids = (employees.length ? employees : people).map((p) => p.uid);

/* ---------------------------------------------------------------- */
console.log(`\n3. Leads for ${uids.length} people (chunked 30)`);

const leadIds: string[] = [];
for (const [i, slice] of chunk(uids).entries()) {
  const snap = await step(`leads where assignedUserId in [chunk ${i + 1}: ${slice.length}]`, () =>
    db.collection('leads').where('assignedUserId', 'in', slice).get()
  );
  if (snap) snap.docs.forEach((d) => leadIds.push(d.id));
}
console.log(`        ${leadIds.length} leads`);

/* ---------------------------------------------------------------- */
console.log('\n4. Closed deals (the query added this round)');

for (const [i, slice] of chunk(uids).entries()) {
  await step(`closedDeals where userId in [chunk ${i + 1}]`, () =>
    db.collection('closedDeals').where('userId', 'in', slice).get()
  );
}

/* ---------------------------------------------------------------- */
console.log('\n5. The collection-group activity query');

const group = await step('collectionGroup(followUps).where(dayKey, >=, <=)', () =>
  db.collectionGroup('followUps').where('dayKey', '>=', from).where('dayKey', '<=', to).get()
);
if (group) console.log(`        ${group.size} entries in range`);

/* ---------------------------------------------------------------- */
if (!group) {
  console.log(`\n6. The per-lead fallback over ${leadIds.length} leads, batched 25`);
  const started = Date.now();
  let entries = 0;
  let batches = 0;

  for (let i = 0; i < leadIds.length; i += 25) {
    const slice = leadIds.slice(i, i + 25);
    try {
      const snaps = await Promise.all(
        slice.map((leadId) =>
          db
            .collection('leads')
            .doc(leadId)
            .collection('followUps')
            .where('dayKey', '>=', from)
            .where('dayKey', '<=', to)
            .get()
        )
      );
      snaps.forEach((s) => (entries += s.size));
      batches += 1;
    } catch (error) {
      const err = error as { code?: unknown; message?: string };
      console.log(`  FAIL at batch ${batches + 1}`);
      console.log(`        code:    ${JSON.stringify(err.code)}`);
      console.log(`        message: ${err.message}`);
      break;
    }
  }

  console.log(
    `  ${batches} batches, ${entries} entries, ${Date.now() - started}ms — this is the whole cost of a missing index.`
  );
}

console.log('\nDone.\n');
process.exit(0);
