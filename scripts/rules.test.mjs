/**
 * Security Rules tests, run against the Firestore emulator.
 *
 * These exist because the same class of bug has now shipped three times, and
 * none of it is catchable by typecheck, lint, unit tests or a browser click —
 * the rules only run inside Firestore.
 *
 * Two failure modes they pin down:
 *
 * 1. **A list query is rejected unless its own constraints prove every
 *    document it could return is readable.** Filtering after the fact in
 *    JavaScript does not count. This is what broke the notification bell for
 *    employees.
 *
 * 2. **A `get` on a document that does not exist has a null `resource`**, so a
 *    rule that dereferences `resource.data.x` errors, and Firestore reports
 *    that to the client as `permission-denied` rather than an empty snapshot.
 *    This is what made the Deal Entry tab log an error on every open lead.
 *
 * Run with:  npm run test:rules
 */

import { readFileSync } from 'node:fs';
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, collection, query, where, getDocs, orderBy, limit,
} from 'firebase/firestore';

const PROJECT_ID = 'leadway-rules-test';
const ADMIN = 'admin-uid';
const EMP_A = 'employee-a';
const EMP_B = 'employee-b';
// Sub admin S manages EMP_A; sub admin T manages nobody. The pair is what makes
// "a sub admin sees their own team and no other" testable rather than asserted.
const SUB_S = 'subadmin-s';
const SUB_T = 'subadmin-t';

let env;

const asAdmin = () => env.authenticatedContext(ADMIN, { role: 'admin' }).firestore();
const asEmployee = (uid) => env.authenticatedContext(uid, { role: 'employee' }).firestore();
const asSubAdmin = (uid) => env.authenticatedContext(uid, { role: 'subadmin' }).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();

  // Seed through a context with rules disabled — the server writes all of this.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'users', SUB_S), { role: 'subadmin', name: 'S' });
    await setDoc(doc(db, 'users', SUB_T), { role: 'subadmin', name: 'T' });
    await setDoc(doc(db, 'users', EMP_A), { role: 'employee', name: 'A', priority: 1, subAdminUid: SUB_S });
    await setDoc(doc(db, 'users', EMP_B), { role: 'employee', name: 'B', priority: 2 });

    await setDoc(doc(db, 'leads', 'lead-a'), {
      name: 'Lead A', assignedUserId: EMP_A, status: 'CONTACTED', subAdminUid: SUB_S,
    });
    await setDoc(doc(db, 'leads', 'lead-b'), { name: 'Lead B', assignedUserId: EMP_B, status: 'CONTACTED' });

    // Only lead-b has been closed. lead-a deliberately has no deal document —
    // that absence is the case that used to read as permission-denied.
    await setDoc(doc(db, 'closedDeals', 'lead-b'), {
      leadId: 'lead-b', userId: EMP_B, amountReceived: 100, enteredAt: new Date(),
    });
    // A deal on S's team, so the sub admin financial scope has something to
    // return — and so the *other* sub admin has something to be refused.
    await setDoc(doc(db, 'closedDeals', 'lead-a'), {
      leadId: 'lead-a', userId: EMP_A, subAdminUid: SUB_S, amountReceived: 500,
      profit: 200, enteredAt: new Date(),
    });

    // The two halves of the profit split. The whole picture is admin-only; each
    // person's own row is not.
    await setDoc(doc(db, 'dealDistributions', 'dist-a'), {
      dealId: 'lead-a', leadId: 'lead-a', current: true, netProfit: 200,
      employeeUid: EMP_A, subAdminUid: SUB_S, finalizedAt: new Date(),
    });
    await setDoc(doc(db, 'dealPayouts', 'pay-emp-a'), {
      dealId: 'lead-a', recipientUid: EMP_A, recipientRole: 'employee',
      subAdminUid: SUB_S, percentage: 2, amount: 4, current: true, finalizedAt: new Date(),
    });
    await setDoc(doc(db, 'dealPayouts', 'pay-sub-s'), {
      dealId: 'lead-a', recipientUid: SUB_S, recipientRole: 'subadmin',
      subAdminUid: SUB_S, percentage: 2, amount: 4, current: true, finalizedAt: new Date(),
    });
    await setDoc(doc(db, 'dealPayouts', 'pay-emp-b'), {
      dealId: 'lead-b', recipientUid: EMP_B, recipientRole: 'employee',
      subAdminUid: null, percentage: 3, amount: 3, current: true, finalizedAt: new Date(),
    });

    await setDoc(doc(db, 'dataBankFolders', 'folder-s'), { name: 'S list', subAdminUid: SUB_S });
    await setDoc(doc(db, 'dataBankFolders', 'folder-admin'), { name: 'Admin list' });
    await setDoc(doc(db, 'dataBankRecords', 'rec-s'), { folderId: 'folder-s', name: 'Row', phoneKey: '1' });
    await setDoc(doc(db, 'dataBankRecords', 'rec-admin'), { folderId: 'folder-admin', name: 'Row', phoneKey: '2' });

    await setDoc(doc(db, 'notifications', 'n-admin'), {
      type: 'RED_FLAG', leadId: 'lead-a', targetRole: 'admin', readAt: null, createdAt: new Date(),
    });
    await setDoc(doc(db, 'notifications', 'n-emp-a'), {
      type: 'NEW_LEAD_ASSIGNED', leadId: 'lead-a', targetRole: 'employee', targetUid: EMP_A,
      readAt: null, createdAt: new Date(),
    });
    await setDoc(doc(db, 'notifications', 'n-emp-b'), {
      type: 'NEW_LEAD_ASSIGNED', leadId: 'lead-b', targetRole: 'employee', targetUid: EMP_B,
      readAt: null, createdAt: new Date(),
    });

    await setDoc(doc(db, 'attendance', `${EMP_A}_2026-08-29`), {
      uid: EMP_A, dayKey: '2026-08-29', monthKey: '2026-08', workedMinutes: 400,
    });
  });
});

/* -------------------------------------------------------------------------- */

describe('notifications — the query must mirror the rule', () => {
  test('the unscoped query the app used to send is refused for an employee', async () => {
    const db = asEmployee(EMP_A);
    await assertFails(
      getDocs(query(
        collection(db, 'notifications'),
        where('readAt', '==', null),
        orderBy('createdAt', 'desc'),
        limit(100)
      ))
    );
  });

  test('scoped by targetUid, the same read succeeds', async () => {
    const db = asEmployee(EMP_A);
    const snap = await assertSucceeds(
      getDocs(query(
        collection(db, 'notifications'),
        where('targetUid', '==', EMP_A),
        where('readAt', '==', null),
        orderBy('createdAt', 'desc'),
        limit(100)
      ))
    );
    assert.deepEqual(snap.docs.map((d) => d.id), ['n-emp-a']);
  });

  test('an employee cannot ask for a colleague’s alerts', async () => {
    const db = asEmployee(EMP_A);
    await assertFails(
      getDocs(query(collection(db, 'notifications'), where('targetUid', '==', EMP_B)))
    );
  });

  test('an employee cannot sweep the employee role, which used to be allowed', async () => {
    const db = asEmployee(EMP_A);
    await assertFails(
      getDocs(query(collection(db, 'notifications'), where('targetRole', '==', 'employee')))
    );
  });

  test('an admin reads the admin alerts', async () => {
    const db = asAdmin();
    const snap = await assertSucceeds(
      getDocs(query(
        collection(db, 'notifications'),
        where('targetRole', '==', 'admin'),
        where('readAt', '==', null),
        orderBy('createdAt', 'desc')
      ))
    );
    assert.deepEqual(snap.docs.map((d) => d.id), ['n-admin']);
  });

  test('a signed-out visitor gets nothing', async () => {
    await assertFails(getDocs(collection(asAnon(), 'notifications')));
  });
});

describe('closedDeals — a missing deal must read as absent, not as denied', () => {
  test('the owner reads their own deal', async () => {
    const snap = await assertSucceeds(getDoc(doc(asEmployee(EMP_B), 'closedDeals', 'lead-b')));
    assert.equal(snap.exists(), true);
  });

  test('a lead with no deal returns an empty snapshot for its owner', async () => {
    // The regression: this used to be permission-denied, because the rule
    // dereferenced resource.data.userId on a null resource.
    const snap = await assertSucceeds(getDoc(doc(asEmployee(EMP_A), 'closedDeals', 'lead-a')));
    assert.equal(snap.exists(), false);
  });

  test('a missing deal is also merely absent for an admin', async () => {
    const snap = await assertSucceeds(getDoc(doc(asAdmin(), 'closedDeals', 'lead-a')));
    assert.equal(snap.exists(), false);
  });

  test('an employee still cannot read a colleague’s deal', async () => {
    await assertFails(getDoc(doc(asEmployee(EMP_A), 'closedDeals', 'lead-b')));
  });

  test('the unscoped ledger list is refused for an employee', async () => {
    await assertFails(getDocs(query(collection(asEmployee(EMP_B), 'closedDeals'), orderBy('enteredAt', 'desc'))));
  });

  test('scoped by userId it succeeds — this is what useMyDeals sends', async () => {
    const snap = await assertSucceeds(
      getDocs(query(
        collection(asEmployee(EMP_B), 'closedDeals'),
        where('userId', '==', EMP_B),
        orderBy('enteredAt', 'desc')
      ))
    );
    assert.deepEqual(snap.docs.map((d) => d.id), ['lead-b']);
  });

  test('an admin reads the whole ledger', async () => {
    const snap = await assertSucceeds(
      getDocs(query(collection(asAdmin(), 'closedDeals'), orderBy('enteredAt', 'desc')))
    );
    assert.equal(snap.size, 1);
  });

  test('nobody writes a deal from the client', async () => {
    await assertFails(setDoc(doc(asAdmin(), 'closedDeals', 'lead-c'), { userId: ADMIN }));
  });
});

describe('leads — employees are scoped to their own', () => {
  test('an employee reads a lead assigned to them', async () => {
    await assertSucceeds(getDoc(doc(asEmployee(EMP_A), 'leads', 'lead-a')));
  });

  test('an employee cannot read a colleague’s lead', async () => {
    await assertFails(getDoc(doc(asEmployee(EMP_A), 'leads', 'lead-b')));
  });

  test('the unscoped lead list is refused for an employee', async () => {
    await assertFails(getDocs(query(collection(asEmployee(EMP_A), 'leads'), orderBy('createdAt', 'desc'))));
  });

  test('scoped by assignedUserId it succeeds — this is what useLeads sends', async () => {
    const snap = await assertSucceeds(
      getDocs(query(collection(asEmployee(EMP_A), 'leads'), where('assignedUserId', '==', EMP_A)))
    );
    assert.deepEqual(snap.docs.map((d) => d.id), ['lead-a']);
  });

  test('an admin reads every lead', async () => {
    const snap = await assertSucceeds(getDocs(collection(asAdmin(), 'leads')));
    assert.equal(snap.size, 2);
  });

  test('leads are never client-writable', async () => {
    await assertFails(setDoc(doc(asAdmin(), 'leads', 'lead-a'), { status: 'CLOSED_WON' }, { merge: true }));
  });
});

describe('attendance and KPI counters', () => {
  test('an employee reads their own attendance month', async () => {
    const snap = await assertSucceeds(
      getDocs(query(
        collection(asEmployee(EMP_A), 'attendance'),
        where('uid', '==', EMP_A),
        where('monthKey', '==', '2026-08')
      ))
    );
    assert.equal(snap.size, 1);
  });

  test('an employee cannot read a colleague’s attendance', async () => {
    await assertFails(
      getDocs(query(collection(asEmployee(EMP_B), 'attendance'), where('uid', '==', EMP_A)))
    );
  });

  test('attendance is never client-writable — the whole feature depends on it', async () => {
    await assertFails(
      setDoc(doc(asEmployee(EMP_A), 'attendance', `${EMP_A}_2026-08-29`), { workedMinutes: 999 }, { merge: true })
    );
  });

  test('an employee reads their own KPI counters and not a colleague’s', async () => {
    await assertSucceeds(getDocs(collection(asEmployee(EMP_A), 'users', EMP_A, 'kpiMonths')));
    await assertFails(getDocs(collection(asEmployee(EMP_A), 'users', EMP_B, 'kpiMonths')));
  });

  test('an employee cannot promote themselves in the lane', async () => {
    await assertFails(setDoc(doc(asEmployee(EMP_A), 'users', EMP_A), { priority: 1 }, { merge: true }));
  });

  test('the roster listing is admin-only', async () => {
    await assertSucceeds(getDocs(query(collection(asAdmin(), 'users'), where('role', '==', 'employee'))));
    await assertFails(getDocs(query(collection(asEmployee(EMP_A), 'users'), where('role', '==', 'employee'))));
  });
});


/* -------------------------------------------------------------------------- */

describe('sub admin — scoped to their own team, and nothing beside it', () => {
  test('their lead list is provable only when it carries the team constraint', async () => {
    const db = asSubAdmin(SUB_S);

    // Unscoped: the rule cannot prove every document is readable, so the query
    // is refused before it runs. This is the failure mode that broke the
    // notification bell, in a new place.
    await assertFails(getDocs(collection(db, 'leads')));

    const snap = await assertSucceeds(
      getDocs(query(collection(db, 'leads'), where('subAdminUid', '==', SUB_S)))
    );
    assert.deepEqual(snap.docs.map((d) => d.id), ['lead-a']);
  });

  test('a sub admin cannot read another team’s lead', async () => {
    await assertFails(getDoc(doc(asSubAdmin(SUB_T), 'leads', 'lead-a')));
    await assertFails(
      getDocs(query(collection(asSubAdmin(SUB_S), 'leads'), where('subAdminUid', '==', SUB_T)))
    );
  });

  test('they read their own team’s roster, not the whole one', async () => {
    const db = asSubAdmin(SUB_S);
    await assertFails(getDocs(query(collection(db, 'users'), where('role', '==', 'employee'))));

    const snap = await assertSucceeds(
      getDocs(query(collection(db, 'users'), where('subAdminUid', '==', SUB_S)))
    );
    assert.deepEqual(snap.docs.map((d) => d.id), [EMP_A]);
  });

  test('they read their team’s KPI counters and not another team’s', async () => {
    await assertSucceeds(getDocs(collection(asSubAdmin(SUB_S), 'users', EMP_A, 'kpiMonths')));
    await assertFails(getDocs(collection(asSubAdmin(SUB_S), 'users', EMP_B, 'kpiMonths')));
  });

  test('they read their team’s deals and not another team’s', async () => {
    const db = asSubAdmin(SUB_S);
    const snap = await assertSucceeds(
      getDocs(query(collection(db, 'closedDeals'), where('subAdminUid', '==', SUB_S)))
    );
    assert.deepEqual(snap.docs.map((d) => d.id), ['lead-a']);

    await assertFails(getDoc(doc(asSubAdmin(SUB_T), 'closedDeals', 'lead-a')));
  });

  test('a folder assigned to them is readable; one that is not, is not', async () => {
    const db = asSubAdmin(SUB_S);
    const snap = await assertSucceeds(
      getDocs(query(collection(db, 'dataBankFolders'), where('subAdminUid', '==', SUB_S)))
    );
    assert.deepEqual(snap.docs.map((d) => d.id), ['folder-s']);

    await assertFails(getDoc(doc(db, 'dataBankFolders', 'folder-admin')));
  });

  test('records follow their folder', async () => {
    const db = asSubAdmin(SUB_S);
    await assertSucceeds(getDoc(doc(db, 'dataBankRecords', 'rec-s')));
    await assertFails(getDoc(doc(db, 'dataBankRecords', 'rec-admin')));
  });

  test('an employee still cannot see the Data Bank at all', async () => {
    await assertFails(getDocs(collection(asEmployee(EMP_A), 'dataBankFolders')));
    await assertFails(getDoc(doc(asEmployee(EMP_A), 'dataBankRecords', 'rec-s')));
  });
});

describe('profit distribution — the privacy model is the collection split', () => {
  test('the full split is admin-only', async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), 'dealDistributions', 'dist-a')));
    // Not even the sub admin whose team earned it: the document names every
    // recipient's percentage, including other sub admins'.
    await assertFails(getDoc(doc(asSubAdmin(SUB_S), 'dealDistributions', 'dist-a')));
    await assertFails(getDoc(doc(asEmployee(EMP_A), 'dealDistributions', 'dist-a')));
  });

  test('an employee reads their own payout and no-one else’s', async () => {
    const db = asEmployee(EMP_A);
    const snap = await assertSucceeds(
      getDocs(query(collection(db, 'dealPayouts'), where('recipientUid', '==', EMP_A)))
    );
    assert.deepEqual(snap.docs.map((d) => d.id), ['pay-emp-a']);

    await assertFails(getDocs(query(collection(db, 'dealPayouts'), where('recipientUid', '==', EMP_B))));
    await assertFails(getDocs(collection(db, 'dealPayouts')));
  });

  test('a sub admin reads their team’s payouts — their own included', async () => {
    const db = asSubAdmin(SUB_S);
    const snap = await assertSucceeds(
      getDocs(query(collection(db, 'dealPayouts'), where('subAdminUid', '==', SUB_S)))
    );
    assert.deepEqual(snap.docs.map((d) => d.id).sort(), ['pay-emp-a', 'pay-sub-s']);
  });

  test('a sub admin cannot read another team’s payouts', async () => {
    await assertFails(
      getDocs(query(collection(asSubAdmin(SUB_T), 'dealPayouts'), where('subAdminUid', '==', SUB_S)))
    );
    await assertFails(getDoc(doc(asSubAdmin(SUB_T), 'dealPayouts', 'pay-emp-a')));
  });

  test('neither collection is client-writable', async () => {
    await assertFails(setDoc(doc(asAdmin(), 'dealPayouts', 'pay-emp-a'), { amount: 999 }, { merge: true }));
    await assertFails(
      setDoc(doc(asAdmin(), 'dealDistributions', 'dist-a'), { netProfit: 999 }, { merge: true })
    );
  });
});
