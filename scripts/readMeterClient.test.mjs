/**
 * The browser read meter against the emulator, with the real `firebase/firestore`
 * client SDK: what it counts, and that screens still get exactly the snapshots
 * they got before. Run as part of `npm run test:sync`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, query, where, setDoc, updateDoc } from 'firebase/firestore';

// A page, a clock for the flush, and a beacon that records what it was given.
const beacons = [];
const listeners = [];
globalThis.window = { location: { pathname: '/admin/leads' }, addEventListener: (_type, fn) => listeners.push(fn) };
globalThis.document = { addEventListener: (_type, fn) => listeners.push(fn), visibilityState: 'visible' };
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { sendBeacon: (_url, blob) => { beacons.push(blob); return true; } },
});

// Counting is tested with quiet hours off; the last test turns them on.
globalThis.__quietHoursOff = true;

// The module imports the app's own auth; the test gives it none.
const src = new URL('../src/lib/firebase/meteredFirestore.ts', import.meta.url);
const copy = new URL('../src/lib/firebase/_metered.clienttest.ts', import.meta.url);
writeFileSync(copy, readFileSync(src, 'utf8').replace("import { auth } from '@/lib/firebase/client';", 'const auth = null as { currentUser?: { uid?: string } } | null;'));
const metered = await import(copy.href);
rmSync(copy);

// This test is about counting, not the rules — its own project gets open ones.
const env = await initializeTestEnvironment({
  projectId: 'leadway-meter-client-test',
  firestore: {
    host: '127.0.0.1',
    port: 8080,
    rules: "rules_version = '2'; service cloud.firestore { match /databases/{d}/documents { match /{x=**} { allow read, write: if true; } } }",
  },
});
const db = env.unauthenticatedContext().firestore();

/**
 * Sends the tally now — the way the app does when the tab is hidden — and
 * returns what was in it.
 */
async function flushed() {
  document.visibilityState = 'hidden';
  const before = beacons.length;
  for (const listener of listeners) listener();
  document.visibilityState = 'visible';
  if (beacons.length === before) return {};
  return JSON.parse(await beacons.at(-1).text()).items;
}

before(async () => {
  await Promise.all(['a', 'b', 'c'].map((id) => setDoc(doc(db, 'meterc', id), { tag: 'x', n: id })));
  await flushed(); // clear anything counted while seeding
});

after(async () => {
  await env.cleanup();
});

test('a listener counts its first answer in full, then only what changes', async () => {
  const delivered = [];
  let resolveFirst;
  const first = new Promise((resolve) => (resolveFirst = resolve));
  // The first answer may come from this client's own copy (it wrote the
  // documents); the server's identical answer is then billed but, as without
  // the meter, not passed to the screen — so wait for the first answer and
  // give the server time.
  const stop = metered.onSnapshot(query(collection(db, 'meterc'), where('tag', '==', 'x')), (snap) => {
    delivered.push(snap.size);
    resolveFirst();
  });
  await first;
  await new Promise((resolve) => setTimeout(resolve, 800));
  await updateDoc(doc(db, 'meterc', 'b'), { n: 'bb' });
  await new Promise((resolve) => setTimeout(resolve, 400));
  stop();

  const items = await flushed();
  assert.equal(items['/admin/leads|meterc|initial'], 3);
  assert.equal(items['/admin/leads|meterc|update'], 1);
  // The screen got the first answer and the change — no metadata-only extras.
  assert.ok(delivered.length >= 2 && delivered.length <= 3, `delivered ${delivered.length}`);
});

test('getDocs counts its size, and an empty result still counts one', async () => {
  await metered.getDocs(query(collection(db, 'meterc'), where('tag', '==', 'x')));
  await metered.getDocs(query(collection(db, 'meterc'), where('tag', '==', 'none')));
  const items = await flushed();
  assert.equal(items['/admin/leads|meterc|get'], 3 + 1);
});

test('getDoc counts one', async () => {
  await metered.getDoc(doc(db, 'meterc', 'a'));
  const items = await flushed();
  assert.equal(items['/admin/leads|meterc|get'], 1);
});

test('quiet hours: a listener answers once from the device copy and reads nothing from the server', async () => {
  // Warm this client's copy with a live listener first.
  await new Promise((resolve) => {
    const stop = metered.onSnapshot(query(collection(db, 'meterc'), where('tag', '==', 'x')), () => { stop(); resolve(); });
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await flushed();

  globalThis.__quietHoursOff = false;
  try {
    const delivered = [];
    const stop = metered.onSnapshot(query(collection(db, 'meterc'), where('tag', '==', 'x')), (snap) => delivered.push(snap));
    await new Promise((resolve) => setTimeout(resolve, 600));
    await updateDoc(doc(db, 'meterc', 'c'), { n: 'cc' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    stop();

    assert.equal(delivered.length, 1, 'one answer, no live updates');
    assert.equal(delivered[0].metadata.fromCache, true);
    assert.equal(delivered[0].size, 3);
    const items = await flushed();
    assert.deepEqual(Object.keys(items).filter((key) => !key.endsWith('|get')), [], 'no listener reads counted');
  } finally {
    globalThis.__quietHoursOff = true;
  }
});
