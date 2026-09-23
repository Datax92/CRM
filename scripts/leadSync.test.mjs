/**
 * End-to-end check of "only what changed" lead syncing, against the Firestore
 * emulator with the real `firestore.rules` (2026-09-23, the day the free read
 * quota ran out). Run with `npm run test:sync`.
 *
 * What it proves, in the order the feature depends on it:
 *  1. Every firebase-admin write to `leads/{id}` is stamped `updatedAt` by
 *     `lib/server/leadStampInstall` — create, update, merge, and inside a
 *     transaction — and a write to a subcollection or another collection is not.
 *  2. The delta query the browser runs (`updatedAt > watermark`, ordered by it)
 *     returns only the leads written since, and nothing else.
 *  3. The security rules allow that unscoped query for the admin and an HR
 *     manager — the only two who use it — and refuse it for an employee.
 *  4. The client SDK can answer the full query from its own cache
 *     (`getDocsFromCache`), which is what DELTA mode shows before the network.
 */

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import {
  collection, query, where, orderBy, getDocs, getDocsFromCache, Timestamp,
} from 'firebase/firestore';
import { initializeApp as initAdmin } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'leadway-sync-test';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

// The install module imports `@/lib/leadStamp`, an alias only the bundler
// understands; the raw loader gets a copy pointing at the file directly.
const installSrc = new URL('../src/lib/server/leadStampInstall.ts', import.meta.url);
const installCopy = new URL('../src/lib/server/_leadStampInstall.synctest.ts', import.meta.url);
writeFileSync(
  installCopy,
  readFileSync(installSrc, 'utf8')
    .replace('"@/lib/leadStamp"', '"../leadStamp.ts"')
    .replace('"@/lib/server/serverCache"', '"./serverCache.ts"')
);
const { installLeadStamp } = await import(installCopy.href);
const serverCache = await import(new URL('../src/lib/server/serverCache.ts', import.meta.url).href);
rmSync(installCopy);

installLeadStamp();
const admin = getAdminFirestore(initAdmin({ projectId: PROJECT_ID }, 'sync-test'));

let env;
const asAdmin = () => env.authenticatedContext('admin-uid', { role: 'admin' }).firestore();
const asHr = () => env.authenticatedContext('hr-uid', { role: 'subadmin', managerKind: 'HR' }).firestore();
const asEmployee = () => env.authenticatedContext('emp-uid', { role: 'employee' }).firestore();

const millis = (value) => (value && typeof value.toMillis === 'function' ? value.toMillis() : null);
const delta = (db, since) =>
  query(collection(db, 'leads'), where('updatedAt', '>', since), orderBy('updatedAt', 'asc'));
const full = (db) => query(collection(db, 'leads'), orderBy('createdAt', 'desc'));

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
  await env.clearFirestore();
  // The HR check in the rules reads the caller's profile.
  await admin.doc('users/hr-uid').set({ role: 'subadmin', managerKind: 'HR', status: 'ACTIVE' });
  await admin.doc('users/admin-uid').set({ role: 'admin', status: 'ACTIVE' });
  await admin.doc('users/emp-uid').set({ role: 'employee', status: 'ACTIVE' });
});

after(async () => {
  await env?.cleanup();
});

test('every server write to a lead is stamped, and nothing else is', async () => {
  const created = new Date('2026-09-20T10:00:00Z');
  await admin.doc('leads/L1').create({ name: 'One', createdAt: created, assignedUserId: 'emp-uid' });
  await admin.doc('leads/L2').set({ name: 'Two', createdAt: created, assignedUserId: 'emp-uid' });
  await admin.doc('leads/L3').set({ name: 'Three', createdAt: created }, { merge: true });
  await admin.doc('leads/L1/followUps/F1').set({ message: 'hi' });
  await admin.doc('notifications/N1').set({ text: 'x' });

  for (const id of ['L1', 'L2', 'L3']) {
    assert.ok(millis((await admin.doc(`leads/${id}`).get()).get('updatedAt')), `${id} stamped`);
  }
  assert.equal((await admin.doc('leads/L1/followUps/F1').get()).get('updatedAt'), undefined);
  assert.equal((await admin.doc('notifications/N1').get()).get('updatedAt'), undefined);
});

test('the delta returns only the leads written since the watermark', async () => {
  const snaps = await Promise.all(['L1', 'L2', 'L3'].map((id) => admin.doc(`leads/${id}`).get()));
  const watermark = Math.max(...snaps.map((s) => millis(s.get('updatedAt'))));

  // Two kinds of later write: a plain update and one inside a transaction.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await admin.doc('leads/L2').update({ status: 'ACCEPTED' });
  await admin.runTransaction(async (t) => {
    const ref = admin.doc('leads/L3');
    await t.get(ref);
    t.update(ref, { status: 'CONTACTED' });
  });

  const db = asAdmin();
  const changed = await getDocs(delta(db, Timestamp.fromMillis(watermark)));
  assert.deepEqual(changed.docs.map((d) => d.id).sort(), ['L2', 'L3']);
  assert.equal(changed.docs.find((d) => d.id === 'L2').get('status'), 'ACCEPTED');
});

test('the rules allow the delta for the admin and HR, and refuse it for an employee', async () => {
  const since = Timestamp.fromMillis(0);
  assert.equal((await getDocs(delta(asAdmin(), since))).size, 3);
  assert.equal((await getDocs(delta(asHr(), since))).size, 3);
  await assertFails(getDocs(delta(asEmployee(), since)));
});

test('the full list can be answered from the device copy without the server', async () => {
  const db = asAdmin();
  const fromServer = await getDocs(full(db));
  assert.equal(fromServer.size, 3);
  const fromCache = await getDocsFromCache(full(db));
  assert.deepEqual(fromCache.docs.map((d) => d.id).sort(), ['L1', 'L2', 'L3']);
});

test('a cached document is dropped when the server writes it, in a transaction too', async () => {
  const key = serverCache.docKey('users/admin-uid');
  let loads = 0;
  const load = async () => ++loads;
  await serverCache.cached(key, 60_000, load);
  await admin.doc('users/admin-uid').update({ name: 'Changed' });
  assert.equal(await serverCache.cached(key, 60_000, load), 2, 'dropped after a plain update');

  await admin.runTransaction(async (t) => {
    await t.get(admin.doc('users/admin-uid'));
    t.update(admin.doc('users/admin-uid'), { name: 'Again' });
  });
  assert.equal(await serverCache.cached(key, 60_000, load), 3, 'dropped after a transaction commits');

  await serverCache.cached('roster:everyone', 60_000, load);
  await admin.doc('users/emp-uid').set({ status: 'DISABLED' }, { merge: true });
  assert.equal(await serverCache.cached('roster:everyone', 60_000, load), 5, 'a profile write drops the roster');
});
