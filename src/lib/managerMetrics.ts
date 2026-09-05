/**
 * Manager totals — a manager's numbers are their team's, plus their own.
 *
 * **A manager's performance is mostly the sum of the employees assigned to
 * them.** They run a team rather than a pipeline. That is not a shortcut: a
 * second, independently-maintained set of totals would drift from the team's
 * the first time somebody changed team, and nothing could then say which was
 * right.
 *
 * **Their own work counts too, and it is not always zero.** A manager can hold
 * leads: a Data Bank record promoted into their Client section, or one handed
 * to them, is assigned to *them* and credited to *them* by the follow-up
 * transaction. So the sum runs over the manager and their team — which is
 * exactly the set `lib/reportScope.teamOf` builds for the same manager, so the
 * directory card, the manager's dossier and Reports agree on one number
 * instead of three.
 *
 * `headcount` stays the size of the **team**: how many people report to them is
 * a different question from whose work is in the total, and answering the first
 * with `team + 1` would say every manager has one more employee than they do.
 *
 * Because it is derived, adding, removing or reassigning an employee moves the
 * manager's figures on the next render, with nothing to recalculate and no job
 * to run.
 *
 * Kept out of `metrics.ts` deliberately: that module imports `./dates`, and
 * these functions are dependency-free so the unit tests can run them under raw
 * `node --experimental-strip-types`.
 */

import type { EmployeeMetrics } from './metrics';

export interface ManagerMetrics {
  uid: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'DISABLED';
  /** The employees this total is the sum of. */
  team: EmployeeMetrics[];
  headcount: number;

  assigned: number;
  accepted: number;
  missed: number;
  active: number;
  closedWon: number;
  lost: number;
  followUps: number;
  calls: number;
  revenue: number;
  payable: number;
  profit: number;
  /** Closed-won across the whole team, not an average of per-person rates. */
  conversionRate: number;
}

function sumOf(team: EmployeeMetrics[], pick: (member: EmployeeMetrics) => number): number {
  return team.reduce((total, member) => total + (Number(pick(member)) || 0), 0);
}

/**
 * Sums one manager's team, and the manager. `team` is already filtered to their
 * employees; the manager must not also be in it or their work counts twice.
 *
 * A caller holding only the manager's identity — a name and a uid, with no
 * figures — is fine: `sumOf` coerces a missing field to 0, so such a manager
 * contributes nothing and the total is the team's, as it was before.
 */
export function buildManagerMetrics(
  manager: Pick<EmployeeMetrics, 'uid' | 'name' | 'email' | 'status'> & Partial<EmployeeMetrics>,
  team: EmployeeMetrics[]
): ManagerMetrics {
  const counted = [manager as EmployeeMetrics, ...team];

  const assigned = sumOf(counted, (m) => m.assigned);
  const closedWon = sumOf(counted, (m) => m.closedWon);

  return {
    uid: manager.uid,
    name: manager.name,
    email: manager.email,
    status: manager.status,
    team,
    // The team, not everyone in the total — see the module note.
    headcount: team.length,

    assigned,
    accepted: sumOf(counted, (m) => m.accepted),
    missed: sumOf(counted, (m) => m.missed),
    active: sumOf(counted, (m) => m.active),
    closedWon,
    lost: sumOf(counted, (m) => m.lost),
    followUps: sumOf(counted, (m) => m.followUps),
    calls: sumOf(counted, (m) => m.calls),
    revenue: sumOf(counted, (m) => m.revenue),
    payable: sumOf(counted, (m) => m.payable),
    profit: sumOf(counted, (m) => m.profit),
    // Team-wide won ÷ handled. Averaging the individual rates would let a rep
    // with one lead and one win drag a ten-person team's rate to 50%.
    conversionRate: assigned > 0 ? Math.round((closedWon / assigned) * 100) : 0,
  };
}

/**
 * Every manager's totals in one pass.
 *
 * Employees are bucketed by `subAdminUid` once rather than filtered per
 * manager, so this stays linear as the roster grows.
 */
export function buildAllManagerMetrics(
  managers: Array<Pick<EmployeeMetrics, 'uid' | 'name' | 'email' | 'status'> & Partial<EmployeeMetrics>>,
  employees: EmployeeMetrics[]
): ManagerMetrics[] {
  const byManager = new Map<string, EmployeeMetrics[]>();
  for (const employee of employees) {
    const key = employee.subAdminUid;
    if (!key) continue;
    const bucket = byManager.get(key);
    if (bucket) bucket.push(employee);
    else byManager.set(key, [employee]);
  }

  return managers.map((manager) => buildManagerMetrics(manager, byManager.get(manager.uid) ?? []));
}
