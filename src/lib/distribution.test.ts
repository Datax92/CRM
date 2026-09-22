import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getNextAssigneeAndState,
  resolveCascadeAssignee,
  readLaneEmployee,
  laneDisplayName,
  laneMembership,
  normalizeLeadsPerTurn,
  normalizeLaneUids,
  readChosenLaneMember,
  MAX_LANE_UIDS,
  MAX_LEADS_PER_TURN,
  LEADS_PER_TURN,
  type Employee,
  type CycleState,
} from './distribution.ts';

const roster = (): Employee[] => [
  { uid: 'emp1', priority: 1, status: 'ACTIVE' },
  { uid: 'emp2', priority: 2, status: 'ACTIVE' },
  { uid: 'emp3', priority: 3, status: 'ACTIVE' },
];

/** Assigns `count` leads in sequence and returns who received each one. */
function drain(employees: Employee[], count: number, exclude: string[] = []) {
  let state: CycleState = {};
  const order: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    const result = getNextAssigneeAndState(employees, state, exclude);
    order.push(result.uid);
    state = result.newState;
  }
  return { order, state };
}

test('the highest priority employee takes the first turn of leads', () => {
  const { order } = drain(roster(), LEADS_PER_TURN);
  assert.deepEqual(order, Array(LEADS_PER_TURN).fill('emp1'));
});

test('the lead after a full turn rotates to the next priority', () => {
  const { order } = drain(roster(), LEADS_PER_TURN + 1);
  assert.equal(order[LEADS_PER_TURN], 'emp2');
});

test('a full cycle is one turn each in priority order, then wraps to the top', () => {
  const total = LEADS_PER_TURN * 3;
  const { order } = drain(roster(), total + 1);

  // Written against LEADS_PER_TURN rather than a literal: the turn was eight,
  // then five, and is now one, and a test that hardcodes the number only proves
  // what the number used to be.
  const n = LEADS_PER_TURN;
  assert.deepEqual(order.slice(0, n), Array(n).fill('emp1'));
  assert.deepEqual(order.slice(n, n * 2), Array(n).fill('emp2'));
  assert.deepEqual(order.slice(n * 2, n * 3), Array(n).fill('emp3'));
  assert.equal(order[n * 3], 'emp1', 'the next lead starts a new cycle at priority 1');
});

test('the wrap-around clears every counter, not just the selected one', () => {
  const { state } = drain(roster(), LEADS_PER_TURN * 3 + 1);
  assert.equal(state.emp1, 1);
  assert.equal(state.emp2, 0);
  assert.equal(state.emp3, 0);
});

test('priority order wins over roster order', () => {
  const shuffled: Employee[] = [
    { uid: 'low', priority: 5, status: 'ACTIVE' },
    { uid: 'high', priority: 1, status: 'ACTIVE' },
  ];
  const { uid } = getNextAssigneeAndState(shuffled, {});
  assert.equal(uid, 'high');
});

test('employees on the same priority resolve deterministically', () => {
  const tied: Employee[] = [
    { uid: 'zara', priority: 2, status: 'ACTIVE' },
    { uid: 'ahmed', priority: 2, status: 'ACTIVE' },
  ];
  assert.equal(getNextAssigneeAndState(tied, {}).uid, 'ahmed');
  assert.equal(getNextAssigneeAndState([...tied].reverse(), {}).uid, 'ahmed');
});

test('disabled employees are skipped without breaking the sequence', () => {
  const withDisabled: Employee[] = [
    { uid: 'emp1', priority: 1, status: 'DISABLED' },
    { uid: 'emp2', priority: 2, status: 'ACTIVE' },
    { uid: 'emp3', priority: 3, status: 'ACTIVE' },
  ];
  const n = LEADS_PER_TURN;
  const { order } = drain(withDisabled, n + 1);
  assert.deepEqual(order.slice(0, n), Array(n).fill('emp2'));
  assert.equal(order[n], 'emp3');
});

test('no active employees yields no assignee and leaves state untouched', () => {
  const allDisabled: Employee[] = [{ uid: 'emp1', priority: 1, status: 'DISABLED' }];
  const state: CycleState = { emp1: 3 };
  const result = getNextAssigneeAndState(allDisabled, state);
  assert.equal(result.uid, null);
  assert.deepEqual(result.newState, state);
});

test('an empty roster yields no assignee', () => {
  assert.equal(getNextAssigneeAndState([], {}).uid, null);
});

// --- reassignment (BR-8, architecture.md §4.3) --------------------------------

test('an excluded employee is skipped on a reassignment pass', () => {
  const result = getNextAssigneeAndState(roster(), {}, ['emp1']);
  assert.equal(result.uid, 'emp2');
});

test('excluding an employee preserves their place in the rotation', () => {
  // emp1 is mid-turn with three leads when a reassignment excludes them.
  const state: CycleState = { emp1: 3 };
  const result = getNextAssigneeAndState(roster(), state, ['emp1']);

  assert.equal(result.uid, 'emp2');
  assert.equal(result.newState.emp1, 3, 'emp1 keeps their count and does not lose their turn');
});

test('a lead nobody can take returns null rather than cycling forever', () => {
  const attempted = ['emp1', 'emp2', 'emp3'];
  const result = getNextAssigneeAndState(roster(), {}, attempted);
  assert.equal(result.uid, null, 'the caller parks the lead for manual assignment');
});

test('bypassRotation gets the next-priority employee without checking limits and preserves cycleState', () => {
  const state: CycleState = { emp1: 8, emp2: 8, emp3: 8 };
  const result = getNextAssigneeAndState(roster(), state, ['emp1'], true);

  assert.equal(result.uid, 'emp2', 'emp2 is the next highest-priority active employee');
  assert.deepEqual(result.newState, state, 'cycleState is preserved and not reset or incremented');
});

test('wrap-around triggered during a reassignment still resets the whole roster', () => {
  // Everyone eligible is full; emp1 is excluded but also at the cap.
  const state: CycleState = { emp1: 8, emp2: 8, emp3: 8 };
  const result = getNextAssigneeAndState(roster(), state, ['emp1']);

  assert.equal(result.uid, 'emp2', 'the first eligible employee starts the new cycle');
  assert.equal(result.cycleReset, true);
  assert.equal(result.newState.emp1, 0, 'the excluded employee is reset too, not left stranded at 8');
  assert.equal(result.newState.emp2, 1);
  assert.equal(result.newState.emp3, 0);
});

test('the input cycle state is never mutated', () => {
  const state: CycleState = { emp1: 2 };
  const snapshot = { ...state };
  getNextAssigneeAndState(roster(), state);
  assert.deepEqual(state, snapshot);
});

test('distribution across a long run stays even', () => {
  const { order } = drain(roster(), LEADS_PER_TURN * 3 * 4);
  const counts = order.reduce<Record<string, number>>((acc, uid) => {
    if (uid) acc[uid] = (acc[uid] ?? 0) + 1;
    return acc;
  }, {});
  // Four complete cycles: everybody gets exactly the same number of leads,
  // whatever the turn size happens to be.
  const each = LEADS_PER_TURN * 4;
  assert.deepEqual(counts, { emp1: each, emp2: each, emp3: each });
});

/* -------------------------------------------------------------------------- */
/* Priority lane cascade (resolveCascadeAssignee)                             */
/* -------------------------------------------------------------------------- */

const lane = (): Employee[] => [
  { uid: 'emp1', priority: 1, status: 'ACTIVE' },
  { uid: 'emp2', priority: 2, status: 'ACTIVE' },
  { uid: 'emp3', priority: 3, status: 'ACTIVE' },
];

test('cascade offers the lead to the highest priority employee first', () => {
  const { uid, wrapped } = resolveCascadeAssignee(lane(), []);
  assert.equal(uid, 'emp1');
  assert.equal(wrapped, false);
});

test('cascade steps down one priority per miss', () => {
  assert.deepEqual(resolveCascadeAssignee(lane(), ['emp1']), { uid: 'emp2', wrapped: false });
});

test('the last employee in the lane is offered it like anybody else', () => {
  // emp1 and emp2 have both let it lapse. emp3 gets an ordinary offer with a
  // window — the floor that used to force it on them is gone.
  assert.deepEqual(resolveCascadeAssignee(lane(), ['emp1', 'emp2']), { uid: 'emp3', wrapped: false });
});

test('when everyone has had a turn the lane wraps back to priority 1', () => {
  // The owner's instruction (2026-09-22): "if she is the last employee in queue
  // it should move back to the first one".
  assert.deepEqual(
    resolveCascadeAssignee(lane(), ['emp1', 'emp2', 'emp3']),
    { uid: 'emp1', wrapped: true }
  );
});

test('a sole active employee is offered it again rather than having it forced on them', () => {
  // First and last are the same person, so the rule taken literally re-offers
  // it to them with a fresh window.
  const solo: Employee[] = [{ uid: 'emp1', priority: 1, status: 'ACTIVE' }];
  assert.deepEqual(resolveCascadeAssignee(solo, []), { uid: 'emp1', wrapped: false });
  assert.deepEqual(resolveCascadeAssignee(solo, ['emp1']), { uid: 'emp1', wrapped: true });
});

test('disabled employees are never offered a cascaded lead', () => {
  const withDisabled: Employee[] = [
    { uid: 'emp1', priority: 1, status: 'ACTIVE' },
    { uid: 'emp2', priority: 2, status: 'DISABLED' },
    { uid: 'emp3', priority: 3, status: 'ACTIVE' },
  ];
  assert.deepEqual(resolveCascadeAssignee(withDisabled, ['emp1']), { uid: 'emp3', wrapped: false });
  // And the wrap skips them too — it starts again at the first *active* person.
  assert.deepEqual(
    resolveCascadeAssignee(withDisabled, ['emp1', 'emp3']),
    { uid: 'emp1', wrapped: true }
  );
});

test('an empty roster yields no assignee rather than a ghost', () => {
  // The one case that is not a loop: with nobody in the lane the caller parks
  // the lead for the admin.
  assert.deepEqual(resolveCascadeAssignee([], []), { uid: null, wrapped: false });
  assert.deepEqual(
    resolveCascadeAssignee([{ uid: 'emp1', priority: 1, status: 'DISABLED' }], []),
    { uid: null, wrapped: false }
  );
});

test('the lane goes round and round until somebody accepts', () => {
  const employees = lane();
  let attempted: string[] = [];
  const visited: string[] = [];

  // Seven expiries in a row: two full laps and one more hop. Nobody is ever
  // forced, and the lead never stops being offered.
  for (let i = 0; i < 7; i++) {
    const { uid, wrapped } = resolveCascadeAssignee(employees, attempted);
    assert.ok(uid, 'lane must always yield a holder while the roster is active');
    visited.push(uid!);
    // What the callers do: a wrap starts a new lap, so the exclusion list is
    // replaced rather than added to.
    attempted = wrapped ? [uid!] : attempted.concat(uid!);
  }

  assert.deepEqual(visited, ['emp1', 'emp2', 'emp3', 'emp1', 'emp2', 'emp3', 'emp1']);
});

test('a lap ends only when everybody active has been offered it', () => {
  // The exclusion is what stops two people passing it back and forth inside one
  // lap while a third never sees it.
  assert.equal(resolveCascadeAssignee(lane(), ['emp2']).uid, 'emp1');
  assert.equal(resolveCascadeAssignee(lane(), ['emp1', 'emp3']).uid, 'emp2');
});

test('cascade ignores rotation counters entirely', () => {
  // emp1 has taken a full turn; a missed lead must still cascade by priority
  // rather than skipping them because of volume already handled.
  const { uid } = resolveCascadeAssignee(lane(), []);
  assert.equal(uid, 'emp1');
});

test('manual-only: an employee out of the lane never receives an automatic lead', () => {
  const roster = [
    { uid: 'a', priority: 1, status: 'ACTIVE' as const, autoAssign: false },
    { uid: 'b', priority: 2, status: 'ACTIVE' as const },
  ];
  // `a` is first by priority, so without the flag every lead would be theirs.
  const result = getNextAssigneeAndState(roster, {});
  assert.equal(result.uid, 'b');
});

test('a record with no flag stays in the lane', () => {
  // The field is new; adding it must not silently empty the rotation for
  // every employee who predates it.
  const roster = [{ uid: 'a', priority: 1, status: 'ACTIVE' as const }];
  assert.equal(getNextAssigneeAndState(roster, {}).uid, 'a');
});

test('the lane can empty out, and says so rather than guessing', () => {
  const roster = [{ uid: 'a', priority: 1, status: 'ACTIVE' as const, autoAssign: false }];
  assert.equal(getNextAssigneeAndState(roster, {}).uid, null);
});

test('the cascade skips them too — a lapsed window must not land there', () => {
  const roster = [
    { uid: 'a', priority: 1, status: 'ACTIVE' as const },
    { uid: 'b', priority: 2, status: 'ACTIVE' as const, autoAssign: false },
    { uid: 'c', priority: 3, status: 'ACTIVE' as const },
  ];
  assert.deepEqual(resolveCascadeAssignee(roster, ['a']), { uid: 'c', wrapped: false });
});

/* -------------------------------------------------------------------------- */
/* readLaneEmployee — the mapper, because the mapper is where the bug was      */
/* -------------------------------------------------------------------------- */

test('an employee marked out of distribution is read as out', () => {
  // The whole point. The cron's inline copy of this mapping never read
  // `autoAssign`, so four people marked "Manual only" kept receiving
  // automatically distributed leads. See the module note.
  const employee = readLaneEmployee('u1', { priority: 1, status: 'ACTIVE', autoAssign: false });
  assert.equal(employee.autoAssign, false);
  assert.equal(getNextAssigneeAndState([employee], {}).uid, null, 'must not be offered a lead');
});

test('an absent autoAssign keeps somebody in the lane', () => {
  // Adding the field must never silently empty the rotation for every record
  // that predates it.
  const employee = readLaneEmployee('u1', { priority: 1, status: 'ACTIVE' });
  assert.equal(getNextAssigneeAndState([employee], {}).uid, 'u1');
});

test('only an explicit false takes somebody out', () => {
  for (const value of [true, undefined, null, 0, '', 'false']) {
    const employee = readLaneEmployee('u1', { priority: 1, status: 'ACTIVE', autoAssign: value });
    assert.equal(
      getNextAssigneeAndState([employee], {}).uid,
      'u1',
      `autoAssign=${JSON.stringify(value)} must not remove them from the lane`
    );
  }
});

test('a missing priority sorts to the back, never the front', () => {
  const noPriority = readLaneEmployee('nobody', { status: 'ACTIVE' });
  const first = readLaneEmployee('first', { priority: 1, status: 'ACTIVE' });
  assert.equal(noPriority.priority, 99);
  assert.equal(getNextAssigneeAndState([noPriority, first], {}).uid, 'first');
});

test('status is read, and anything but DISABLED is active', () => {
  assert.equal(readLaneEmployee('u1', { status: 'DISABLED' }).status, 'DISABLED');
  assert.equal(readLaneEmployee('u1', {}).status, 'ACTIVE');
  assert.equal(readLaneEmployee('u1', { status: 'ACTIVE' }).status, 'ACTIVE');
});

test('the cascade honours it too — a lapsed lead must not land on somebody out of the lane', () => {
  const roster = [
    readLaneEmployee('a', { priority: 1, status: 'ACTIVE' }),
    readLaneEmployee('b', { priority: 2, status: 'ACTIVE', autoAssign: false }),
    readLaneEmployee('c', { priority: 3, status: 'ACTIVE' }),
  ];
  assert.deepEqual(resolveCascadeAssignee(roster, ['a']), { uid: 'c', wrapped: false });
});

/* -------------------------------------------------------------------------- */
/* laneDisplayName — the name a moved lead carries                            */
/* -------------------------------------------------------------------------- */

test('a moved lead is named after the person it moved to', () => {
  // The cascade once moved the uid and kept the old name: Aroosa → Rafia still read "Aroosa".
  assert.equal(laneDisplayName({ name: 'Rafia Afsheen', email: 'rafia@x.pk' }), 'Rafia Afsheen');
});

test('an unnamed profile falls back to the email, and nothing to null — never an empty string', () => {
  assert.equal(laneDisplayName({ name: '   ', email: 'rafia@x.pk' }), 'rafia@x.pk');
  assert.equal(laneDisplayName({ email: '' }), null);
  assert.equal(laneDisplayName(undefined), null);
});

/* -------------------------------------------------------------------------- */
/* Per-person turns, and managers in the lane                                 */
/* -------------------------------------------------------------------------- */

test('each person takes their own number of leads per turn, then the lane moves on', () => {
  // Admin sets Aroosa to 2 and Rafia to 1: A, A, R, S, then back to the top.
  const lane: Employee[] = [
    { uid: 'aroosa', priority: 1, status: 'ACTIVE', leadsPerTurn: 2 },
    { uid: 'rafia', priority: 2, status: 'ACTIVE', leadsPerTurn: 1 },
    { uid: 'sundus', priority: 3, status: 'ACTIVE' },
  ];
  const { order } = drain(lane, 5);
  assert.deepEqual(order, ['aroosa', 'aroosa', 'rafia', 'sundus', 'aroosa']);
});

test('a turn size outside 1 to the ceiling falls back or is capped, never zero', () => {
  // Zero would take somebody out of the lane through a number rather than the switch.
  assert.equal(normalizeLeadsPerTurn(0), LEADS_PER_TURN);
  assert.equal(normalizeLeadsPerTurn(-3), LEADS_PER_TURN);
  assert.equal(normalizeLeadsPerTurn('4'), LEADS_PER_TURN);
  assert.equal(normalizeLeadsPerTurn(undefined), LEADS_PER_TURN);
  assert.equal(normalizeLeadsPerTurn(2.7), 2);
  assert.equal(normalizeLeadsPerTurn(500), MAX_LEADS_PER_TURN);
});

test('a manager is out of the lane unless an admin has put them in', () => {
  // Reading an absent field as "in" would hand leads to every manager on deploy.
  assert.equal(laneMembership({ role: 'subadmin' }), false);
  assert.equal(laneMembership({ role: 'subadmin', autoAssign: false }), false);
  assert.equal(laneMembership({ role: 'subadmin', autoAssign: true }), true);
  // An employee keeps the opposite default.
  assert.equal(laneMembership({ role: 'employee' }), true);
  assert.equal(laneMembership({ role: 'employee', autoAssign: false }), false);
});

test('a manager put in the lane takes their turn in priority order like anybody else', () => {
  const manager = readLaneEmployee('dilawar', { role: 'subadmin', autoAssign: true, priority: 2, status: 'ACTIVE' });
  const managerOut = readLaneEmployee('tayyab', { role: 'subadmin', priority: 1, status: 'ACTIVE' });
  const employee = readLaneEmployee('aroosa', { role: 'employee', priority: 1, status: 'ACTIVE' });
  const { order } = drain([managerOut, manager, employee], 3);
  assert.deepEqual(order, ['aroosa', 'dilawar', 'aroosa']);
  assert.equal(resolveCascadeAssignee([managerOut, manager, employee], ['aroosa']).uid, 'dilawar');
});

/* -------------------------------------------------------------------------- */
/* A folder's own lane (normalizeLaneUids / readChosenLaneMember)             */
/* -------------------------------------------------------------------------- */

test('an absent or junk routing list means the whole rotation, never an empty one', () => {
  // The failure this guards is the one that matters: a folder that quietly
  // routes a paid lead to nobody.
  assert.deepEqual(normalizeLaneUids(undefined), []);
  assert.deepEqual(normalizeLaneUids(null), []);
  assert.deepEqual(normalizeLaneUids('aroosa'), []);
  assert.deepEqual(normalizeLaneUids([]), []);
  assert.deepEqual(normalizeLaneUids([1, {}, null, '']), []);
});

test('a routing list is deduped, trimmed and capped', () => {
  assert.deepEqual(normalizeLaneUids([' aroosa ', 'aroosa', 'rafia']), ['aroosa', 'rafia']);
  const many = Array.from({ length: MAX_LANE_UIDS + 5 }, (_, i) => `uid${i}`);
  assert.equal(normalizeLaneUids(many).length, MAX_LANE_UIDS);
});

test('being chosen for a folder overrides being out of the general rotation', () => {
  // `autoAssign: false` says "not the ordinary flow"; naming somebody on one
  // folder is the later, narrower instruction and wins — otherwise the picker
  // would offer people it then silently skips.
  const chosen = readChosenLaneMember('aroosa', { autoAssign: false, priority: 3, status: 'ACTIVE' });
  assert.equal(chosen.autoAssign, undefined);
  assert.equal(getNextAssigneeAndState([chosen], {}).uid, 'aroosa');

  // A manager, who is out of the lane by default, is in when chosen.
  const manager = readChosenLaneMember('dilawar', { role: 'subadmin', priority: 2, status: 'ACTIVE' });
  assert.equal(getNextAssigneeAndState([manager], {}).uid, 'dilawar');
});

test('a paused account is still skipped, however it was chosen', () => {
  const paused = readChosenLaneMember('hussain', { status: 'DISABLED', priority: 1 });
  const active = readChosenLaneMember('rafia', { status: 'ACTIVE', priority: 2 });
  assert.equal(getNextAssigneeAndState([paused, active], {}).uid, 'rafia');
  assert.deepEqual(resolveCascadeAssignee([paused, active], []), { uid: 'rafia', wrapped: false });
});

test('the admin, with no priority, sorts to the back of a folder group rather than the front', () => {
  const admin = readChosenLaneMember('admin', { role: 'admin', status: 'ACTIVE' });
  const employee = readChosenLaneMember('aroosa', { priority: 1, status: 'ACTIVE' });
  assert.equal(admin.priority, 99);
  const { order } = drain([admin, employee], 2);
  assert.deepEqual(order, ['aroosa', 'admin']);
});

test('a restricted folder rotates within its group, and the loop stays inside it', () => {
  // The owner's case: this campaign's leads are for these three people, one
  // each in turn, and the last one left takes it rather than it escaping.
  const group = [
    readChosenLaneMember('aroosa', { priority: 1, status: 'ACTIVE' }),
    readChosenLaneMember('rafia', { priority: 2, status: 'ACTIVE' }),
    readChosenLaneMember('dilawar', { role: 'subadmin', priority: 3, status: 'ACTIVE' }),
  ];
  const { order } = drain(group, 4);
  assert.deepEqual(order, ['aroosa', 'rafia', 'dilawar', 'aroosa']);

  // Everybody has been offered it and let it lapse: the group wraps back to its
  // own first person, and nobody outside the group is ever consulted.
  assert.deepEqual(resolveCascadeAssignee(group, ['aroosa']), { uid: 'rafia', wrapped: false });
  assert.deepEqual(
    resolveCascadeAssignee(group, ['aroosa', 'rafia']),
    { uid: 'dilawar', wrapped: false }
  );
  assert.deepEqual(
    resolveCascadeAssignee(group, ['aroosa', 'rafia', 'dilawar']),
    { uid: 'aroosa', wrapped: true }
  );
});

test('a folder group of one keeps offering it back rather than leaving the lead unassigned', () => {
  const solo = [readChosenLaneMember('aroosa', { priority: 4, status: 'ACTIVE' })];
  assert.deepEqual(resolveCascadeAssignee(solo, ['aroosa']), { uid: 'aroosa', wrapped: true });
});

test('a folder whose chosen people have all gone yields nobody, so the record waits', () => {
  // The record stays in the Data Bank rather than becoming a lead with no owner.
  assert.equal(getNextAssigneeAndState([], {}).uid, null);
});
