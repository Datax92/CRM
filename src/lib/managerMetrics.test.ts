import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildManagerMetrics, buildAllManagerMetrics } from './managerMetrics.ts';
import type { EmployeeMetrics } from './metrics.ts';

const member = (uid: string, subAdminUid: string | null, over: Partial<EmployeeMetrics> = {}) =>
  ({
    uid,
    name: uid,
    email: `${uid}@crm.com`,
    priority: 1,
    status: 'ACTIVE',
    jobTitle: 'Sales Executive',
    subAdminUid,
    assigned: 0,
    accepted: 0,
    missed: 0,
    active: 0,
    closedWon: 0,
    lost: 0,
    followUps: 0,
    calls: 0,
    revenue: 0,
    payable: 0,
    profit: 0,
    conversionRate: 0,
    ...over,
  }) as EmployeeMetrics;

const manager = (uid: string) => ({ uid, name: uid, email: `${uid}@crm.com`, status: 'ACTIVE' as const });

test("a manager's figures are the sum of their team's", () => {
  const team = [
    member('e1', 'm1', { assigned: 10, closedWon: 3, revenue: 300_000, profit: 60_000, calls: 40 }),
    member('e2', 'm1', { assigned: 6, closedWon: 1, revenue: 100_000, profit: 20_000, calls: 15 }),
  ];

  const totals = buildManagerMetrics(manager('m1'), team);

  assert.equal(totals.headcount, 2);
  assert.equal(totals.assigned, 16);
  assert.equal(totals.closedWon, 4);
  assert.equal(totals.revenue, 400_000);
  assert.equal(totals.profit, 80_000);
  assert.equal(totals.calls, 55);
});

test('a manager with no team reads zero, not NaN', () => {
  const totals = buildManagerMetrics(manager('m1'), []);
  assert.equal(totals.headcount, 0);
  assert.equal(totals.assigned, 0);
  assert.equal(totals.conversionRate, 0);
});

test('conversion is team-wide, not an average of per-person rates', () => {
  const team = [
    // 1 of 1 = 100% on its own…
    member('e1', 'm1', { assigned: 1, closedWon: 1, conversionRate: 100 }),
    // …against 1 of 19.
    member('e2', 'm1', { assigned: 19, closedWon: 1, conversionRate: 5 }),
  ];

  const totals = buildManagerMetrics(manager('m1'), team);

  // 2 of 20 = 10%. Averaging the two rates would report 52.5% and flatter the
  // team enormously.
  assert.equal(totals.conversionRate, 10);
});

test('each manager gets only their own team, and unmanaged employees count for nobody', () => {
  const employees = [
    member('e1', 'm1', { assigned: 5, revenue: 100 }),
    member('e2', 'm1', { assigned: 5, revenue: 100 }),
    member('e3', 'm2', { assigned: 7, revenue: 500 }),
    // Managed by the admin directly.
    member('e4', null, { assigned: 99, revenue: 999 }),
  ];

  const [m1, m2] = buildAllManagerMetrics([manager('m1'), manager('m2')], employees);

  assert.equal(m1.headcount, 2);
  assert.equal(m1.assigned, 10);
  assert.equal(m1.revenue, 200);

  assert.equal(m2.headcount, 1);
  assert.equal(m2.assigned, 7);

  // The unmanaged employee is in nobody's totals — an admin-managed rep is not
  // silently credited to whichever manager happens to be listed first.
  assert.equal(m1.assigned + m2.assigned, 17);
});

test('reassigning an employee moves the totals with them, with nothing to recalculate', () => {
  const before = buildAllManagerMetrics(
    [manager('m1'), manager('m2')],
    [member('e1', 'm1', { assigned: 8, revenue: 400 })]
  );
  assert.equal(before[0].assigned, 8);
  assert.equal(before[1].assigned, 0);

  const after = buildAllManagerMetrics(
    [manager('m1'), manager('m2')],
    [member('e1', 'm2', { assigned: 8, revenue: 400 })]
  );
  assert.equal(after[0].assigned, 0);
  assert.equal(after[1].assigned, 8);
});

test('a disabled team member still counts — their history did happen', () => {
  const totals = buildManagerMetrics(manager('m1'), [
    member('e1', 'm1', { status: 'DISABLED', closedWon: 4, revenue: 900 }),
  ]);
  assert.equal(totals.closedWon, 4);
  assert.equal(totals.revenue, 900);
});

test("a manager's own leads count in their total, and headcount stays the team", () => {
  // A manager can hold leads: a Data Bank record promoted into their Client
  // section is assigned to them and credited to them. Leaving it out made the
  // directory card and the manager's dossier disagree about the same manager —
  // 70 leads on one, 78 on the other.
  const working = {
    uid: 'm1',
    name: 'm1',
    email: 'm1@crm.com',
    status: 'ACTIVE' as const,
    assigned: 8,
    closedWon: 1,
    revenue: 100_000,
  };

  const team = [
    member('e1', 'm1', { assigned: 10, closedWon: 3, revenue: 300_000 }),
    member('e2', 'm1', { assigned: 60, closedWon: 0, revenue: 0 }),
  ];

  const totals = buildManagerMetrics(working, team);

  assert.equal(totals.assigned, 78);
  assert.equal(totals.closedWon, 4);
  assert.equal(totals.revenue, 400_000);
  // Three people's work, two people on the team. The two questions have two
  // answers and must not be given the same one.
  assert.equal(totals.headcount, 2);
});

test('an identity-only manager contributes nothing, as before', () => {
  const team = [member('e1', 'm1', { assigned: 10, closedWon: 3 })];
  const totals = buildManagerMetrics(manager('m1'), team);

  assert.equal(totals.assigned, 10);
  assert.equal(totals.closedWon, 3);
});
