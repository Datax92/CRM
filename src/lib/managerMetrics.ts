/**
 * Manager totals — a manager's numbers are their team's numbers.
 *
 * **A manager has no figures of their own.** They take no leads, log no calls
 * and close no deals, so their performance *is* the sum of the employees
 * assigned to them. That is not a shortcut: a second, independently-maintained
 * set of totals would drift from the team's the first time somebody changed
 * team, and nothing could then say which was right.
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

/** Sums one manager's team. `team` is already filtered to their employees. */
export function buildManagerMetrics(
  manager: Pick<EmployeeMetrics, 'uid' | 'name' | 'email' | 'status'>,
  team: EmployeeMetrics[]
): ManagerMetrics {
  const assigned = sumOf(team, (m) => m.assigned);
  const closedWon = sumOf(team, (m) => m.closedWon);

  return {
    uid: manager.uid,
    name: manager.name,
    email: manager.email,
    status: manager.status,
    team,
    headcount: team.length,

    assigned,
    accepted: sumOf(team, (m) => m.accepted),
    missed: sumOf(team, (m) => m.missed),
    active: sumOf(team, (m) => m.active),
    closedWon,
    lost: sumOf(team, (m) => m.lost),
    followUps: sumOf(team, (m) => m.followUps),
    calls: sumOf(team, (m) => m.calls),
    revenue: sumOf(team, (m) => m.revenue),
    payable: sumOf(team, (m) => m.payable),
    profit: sumOf(team, (m) => m.profit),
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
  managers: Array<Pick<EmployeeMetrics, 'uid' | 'name' | 'email' | 'status'>>,
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
