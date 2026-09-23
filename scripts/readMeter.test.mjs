/**
 * The server read meter counts what Firestore bills, once each — checked
 * against the emulator with reads whose cost is known in advance. Run as part
 * of `npm run test:sync`.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { installReadMeter, meterReads } from '../src/lib/server/readMeter.ts';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const db = getFirestore(initializeApp({ projectId: 'leadway-meter-test' }, 'meter-test'));

/** Every `[readmeter]` line, by label — captured once, so concurrent scopes cannot steal each other's. */
const logged = new Map();
const original = console.info;
console.info = (line, ...rest) => {
  if (String(line).startsWith('[readmeter]')) {
    const entry = JSON.parse(String(line).slice(12));
    logged.set(entry.label, entry);
    return;
  }
  original(line, ...rest);
};
let counter = 0;

/** Runs `body` metered under a label of its own and returns the line it logged. */
async function measure(body) {
  const label = `test-${++counter}`;
  await meterReads(label, body);
  return logged.get(label) ?? { reads: 0, by: {} };
}

before(async () => {
  // Seeded before the meter is installed, so seeding is not counted.
  await Promise.all(
    ['a', 'b', 'c'].map((id) => db.doc(`meterLeads/${id}`).set({ n: id, tag: 'x' }))
  );
  await db.doc('meterLeads/a/followUps/f1').set({ m: 1 });
  installReadMeter(db);
});

test('a document read is one read', async () => {
  const line = await measure(() => db.doc('meterLeads/a').get());
  assert.equal(line.reads, 1);
  assert.deepEqual(line.by, { meterLeads: 1 });
});

test('a query is one read per document, and an empty one still costs one', async () => {
  assert.equal((await measure(() => db.collection('meterLeads').get())).reads, 3);
  assert.equal((await measure(() => db.collection('meterLeads').where('tag', '==', 'none').get())).reads, 1);
});

test('getAll counts each document, and a subcollection is named by its path', async () => {
  const line = await measure(() => db.getAll(db.doc('meterLeads/a'), db.doc('meterLeads/b'), db.doc('meterLeads/a/followUps/f1')));
  assert.equal(line.reads, 3);
  assert.deepEqual(line.by, { meterLeads: 2, 'meterLeads/*/followUps': 1 });
});

test('reads inside a transaction are counted once, not twice', async () => {
  const line = await measure(() =>
    db.runTransaction(async (t) => {
      await t.get(db.doc('meterLeads/a'));
      await t.get(db.collection('meterLeads'));
      await t.getAll(db.doc('meterLeads/b'), db.doc('meterLeads/c'));
    })
  );
  assert.deepEqual(line.by, { meterLeads: 1 + 3 + 2 });
  assert.equal(line.reads, 1 + 3 + 2);
});

test('a count query is one read per thousand matched', async () => {
  assert.equal((await measure(() => db.collection('meterLeads').count().get())).reads, 1);
});

test('concurrent scopes never mix', async () => {
  const [one, two] = await Promise.all([
    measure(() => db.doc('meterLeads/a').get()),
    measure(() => db.collection('meterLeads').get()),
  ]);
  assert.equal(one.reads, 1);
  assert.equal(two.reads, 3);
});
