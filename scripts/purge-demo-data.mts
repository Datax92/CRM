/**
 * Removes the demo records that scratch/seed_live_database.ts wrote into the
 * live project.
 *
 * That seed created four fictional leads, three expenses, a fictional closed
 * deal, and three employee profile documents with no matching Firebase Auth
 * accounts — so those "employees" can never sign in, yet leads are assigned to
 * them and they appear in performance reports.
 *
 * Runs a dry run by default. Nothing is deleted until you pass --confirm.
 *
 *   npm run purge-demo-data
 *   npm run purge-demo-data -- --confirm
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const DEMO_LEAD_IDS = ['lead-meta-101', 'lead-meta-102', 'lead-meta-103', 'lead-meta-104'];
const DEMO_EXPENSE_IDS = ['exp-meta-ads', 'exp-fiber-net', 'exp-software'];
const DEMO_DEAL_IDS = ['deal-chen-104'];
const DEMO_NOTIFICATION_IDS = ['notif-sla-102'];
const DEMO_USER_IDS = ['emp-sarah-1', 'emp-michael-2', 'emp-james-3', 'admin-master-uid'];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing ${name}. Run with: node --env-file=.env.local --experimental-strip-types scripts/purge-demo-data.ts\n`);
    process.exit(1);
  }
  return value;
}

async function deleteSubcollections(db: Firestore, path: string) {
  const ref = db.doc(path);
  const collections = await ref.listCollections();
  for (const collection of collections) {
    const docs = await collection.listDocuments();
    for (const doc of docs) {
      await doc.delete();
    }
  }
}

async function main() {
  const confirm = process.argv.includes('--confirm');

  const projectId = requireEnv('FIREBASE_PROJECT_ID');
  const clientEmail = requireEnv('FIREBASE_CLIENT_EMAIL');
  const privateKey = requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');

  if (!getApps().length) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  const db = getFirestore();

  console.log(`Project: ${projectId}`);
  console.log(confirm ? 'Mode:    DELETING\n' : 'Mode:    dry run (pass --confirm to delete)\n');

  const targets: Array<{ collection: string; ids: string[] }> = [
    { collection: 'leads', ids: DEMO_LEAD_IDS },
    { collection: 'expenses', ids: DEMO_EXPENSE_IDS },
    { collection: 'closedDeals', ids: DEMO_DEAL_IDS },
    { collection: 'notifications', ids: DEMO_NOTIFICATION_IDS },
    { collection: 'users', ids: DEMO_USER_IDS },
  ];

  let found = 0;
  let removed = 0;

  for (const { collection, ids } of targets) {
    for (const id of ids) {
      const path = `${collection}/${id}`;
      const snap = await db.doc(path).get();
      if (!snap.exists) continue;

      found++;
      const label = snap.data()?.name ?? snap.data()?.title ?? snap.data()?.email ?? '';
      console.log(`  ${confirm ? 'deleting' : 'would delete'}  ${path}${label ? `  (${label})` : ''}`);

      if (confirm) {
        await deleteSubcollections(db, path);
        await db.doc(path).delete();
        removed++;
      }
    }
  }

  if (found === 0) {
    console.log('  Nothing found — the demo records are already gone.\n');
    return;
  }

  console.log(
    confirm
      ? `\nDeleted ${removed} document(s) and their subcollections.\n`
      : `\n${found} document(s) would be deleted. Re-run with --confirm.\n`
  );

  if (confirm) {
    console.log('Note: the demo employee profiles had no Firebase Auth accounts,');
    console.log('so there is nothing to remove on the Auth side.\n');
  }
}

main().catch((error) => {
  console.error('\nFailed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
