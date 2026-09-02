/**
 * Leads one employee receives before the lane moves to the next priority.
 *
 * Defined here rather than imported: this module is deliberately dependency
 * free so the node test runner can load it directly, without a bundler to
 * resolve extensionless paths.
 */
export const LEADS_PER_TURN = 8;

export interface Employee {
  uid: string;
  priority: number;
  status: 'ACTIVE' | 'DISABLED';
  /**
   * Whether automatic distribution may hand this person a lead.
   *
   * Absent means yes — every record predating the setting stays in the lane,
   * so adding the field cannot silently empty the rotation. `false` is the
   * directory's "Manual assignment only": the employee keeps working leads and
   * an admin can still assign to them by hand, they simply stop receiving the
   * automatic ones.
   */
  autoAssign?: boolean;
}

/** In the lane unless an admin has taken them out of it. */
function takesAutoLeads(employee: Employee): boolean {
  return employee.status === 'ACTIVE' && employee.autoAssign !== false;
}

export interface CycleState {
  [uid: string]: number; // leads assigned to this employee in the current cycle
}

export interface AssigneeResolution {
  uid: string | null;
  newState: CycleState;
  /** True when the rotation wrapped around and every counter was cleared. */
  cycleReset: boolean;
}

/**
 * Resolves the next assignee under the priority + 8-lead rotation rule
 * (BR-6, architecture.md §4.2) and returns the updated cycle state.
 *
 * The rule as implemented: the highest-priority active employee receives eight
 * leads, then the next priority receives eight, and so on; once the lowest
 * priority completes their eight the cycle resets and it starts again from
 * priority 1. Disabled employees are skipped without breaking the sequence.
 *
 * NOTE (PRD §8 open question 1): only auto-assignments advance these counters —
 * a lead the admin hands out manually inside the 5-minute window does not
 * consume anyone's eight. That is the behaviour the system already had; it is
 * flagged for client confirmation rather than changed here.
 *
 * `excludeUids` covers reassignment: an employee who has already been offered
 * this lead and let it expire is skipped for subsequent passes, but keeps their
 * cycle counter so their place in the rotation is not lost.
 *
 * Pure and total — no I/O, no clock, no randomness. See distribution.test.ts.
 */
export function getNextAssigneeAndState(
  employees: Employee[],
  cycleState: CycleState,
  excludeUids: string[] = [],
  bypassRotation: boolean = false
): AssigneeResolution {
  const excluded = new Set(excludeUids);

  const activeEmployees = employees
    .filter(takesAutoLeads)
    .sort((a, b) => a.priority - b.priority || a.uid.localeCompare(b.uid));

  const eligible = activeEmployees.filter((e) => !excluded.has(e.uid));

  if (eligible.length === 0) {
    return { uid: null, newState: cycleState, cycleReset: false };
  }

  if (bypassRotation) {
    const selected = eligible[0];
    return {
      uid: selected.uid,
      newState: cycleState,
      cycleReset: false,
    };
  }

  // Whoever has not yet taken their eight, in priority order.
  const withCapacity = eligible.find((e) => (cycleState[e.uid] ?? 0) < LEADS_PER_TURN);

  if (withCapacity) {
    return {
      uid: withCapacity.uid,
      newState: { ...cycleState, [withCapacity.uid]: (cycleState[withCapacity.uid] ?? 0) + 1 },
      cycleReset: false,
    };
  }

  // Everyone eligible has taken their eight — wrap around and start a new cycle.
  //
  // Counters are cleared for the whole active roster, not just the eligible
  // subset. Clearing only the eligible ones would leave an excluded employee
  // sitting at 8 into the next cycle and silently cost them their turn.
  const selected = eligible[0];
  const newState: CycleState = {};
  for (const employee of activeEmployees) {
    newState[employee.uid] = 0;
  }
  newState[selected.uid] = 1;

  return { uid: selected.uid, newState, cycleReset: true };
}

/* -------------------------------------------------------------------------- */
/* Priority lane cascade                                                      */
/* -------------------------------------------------------------------------- */

export interface CascadeResolution {
  uid: string | null;
  /**
   * True when this employee is the end of the lane: nobody is left below them
   * to pass the lead to, so they take it without an accept window.
   */
  forced: boolean;
}

/**
 * Who receives a lead whose accept window just lapsed.
 *
 * The lane runs strictly by priority — 1 first, then 2, and so on — skipping
 * anyone who has already been offered this lead and let it expire. That
 * exclusion is what stops two employees handing a lead back and forth forever.
 *
 * The lane has a floor. When only one candidate is left, they are `forced`:
 * assigned with no accept window and no chance to decline, because there is
 * nobody below them to cascade to. If every active employee has already had a
 * turn, the lowest-priority active employee is the backstop and takes it on the
 * same terms — that is the "last employee is forced to accept" rule, and it is
 * why a lead can no longer fall out of the lane into UNASSIGNED_NO_CAPACITY
 * while an active roster exists.
 *
 * Rotation counters are deliberately not consulted or advanced here. A turn is
 * about sharing *incoming volume*; a cascade is about catching a miss, and
 * making a missed lead consume someone's turn would penalise the employee who
 * cleaned up after a colleague.
 *
 * Pure and total — no I/O, no clock, no randomness. See distribution.test.ts.
 */
export function resolveCascadeAssignee(
  employees: Employee[],
  attemptedUids: string[] = []
): CascadeResolution {
  const attempted = new Set(attemptedUids);

  const active = employees
    .filter(takesAutoLeads)
    .sort((a, b) => a.priority - b.priority || a.uid.localeCompare(b.uid));

  if (active.length === 0) return { uid: null, forced: false };

  const eligible = active.filter((e) => !attempted.has(e.uid));

  // Everyone has had a turn — the lowest-priority active employee is the floor.
  if (eligible.length === 0) {
    return { uid: active[active.length - 1].uid, forced: true };
  }

  // One candidate left: they are the end of the lane.
  if (eligible.length === 1) {
    return { uid: eligible[0].uid, forced: true };
  }

  return { uid: eligible[0].uid, forced: false };
}
