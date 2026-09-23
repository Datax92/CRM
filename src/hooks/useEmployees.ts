import { useCallback, useMemo, useState, useEffect } from 'react';
import {
  collection,
  doc,
  query,
  where,
} from 'firebase/firestore';
// Metered: counts the reads Google bills, into the server log only.
import { onSnapshot } from '@/lib/firebase/meteredFirestore';
import { db } from '@/lib/firebase/client';
import { useLive } from './useLive';
import { laneMembership, normalizeLeadsPerTurn } from '@/lib/distribution';
import { describeLiveError } from './useLeads';
import { type FirestoreTimestamp } from './useLeads';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';
import { normalizeJobTitle } from '@/lib/constants/roles';

import type { KpiTargets } from '@/lib/kpi';
import type { SalaryProfile } from '@/lib/payroll';

export interface EmployeeData {
  uid: string;
  name: string;
  email: string;
  priority: number;
  status: 'ACTIVE' | 'DISABLED';
  /** Human job title. Distinct from the auth role on the same document. */
  jobTitle: string;
  /** Contact number. Optional — the directory collects it, nothing requires it. */
  phone?: string | null;
  /**
   * The day they actually started, which is not the day their account was
   * made — a directory backfilled months later would otherwise show everyone
   * joining on the same afternoon. Falls back to `createdAt` for display.
   */
  joinedAt?: FirestoreTimestamp | null;
  /** Free text: territory, reporting line, anything worth recording. */
  notes?: string | null;
  /**
   * Whether automatic distribution may hand them a lead. Absent means yes, so
   * adding this field cannot empty the rotation for existing records. See
   * `lib/distribution`.
   */
  autoAssign?: boolean;
  /** Leads they take per turn before the lane moves on (1 to `MAX_LEADS_PER_TURN`). */
  leadsPerTurn?: number;
  /** Monthly KPI targets. Absent on records predating the KPI module. */
  targets?: KpiTargets;
  /** False once an admin pins the priority by hand. Absent means automatic. */
  autoPriority?: boolean;
  /** Access role. `subadmin` accounts appear in the same directory. */
  accessRole?: 'employee' | 'subadmin';
  /** The sub admin who manages them. Absent means the admin directly. */
  subAdminUid?: string | null;
  /** Sales or HR (§13). Only meaningful on a manager account. */
  managerKind?: 'SALES' | 'HR';
  /** Base for percentage late deductions and payroll (§5, §12). 0 = unrecorded. */
  monthlySalary?: number;
  /**
   * Recurring pay — allowances, bonus, standing deductions, and the two
   * switches that decide whether commission and attendance deductions apply.
   * `basic` mirrors `monthlySalary`: one salary figure, not two.
   */
  salaryProfile?: SalaryProfile;
  /** Every change to the profile, with who made it — the brief asks for it. */
  salaryHistory?: { at: string; byUid: string; from: SalaryProfile; to: SalaryProfile }[];
  /** A manager the admin has explicitly granted salary visibility. */
  salaryAccess?: boolean;
  /** 0–1, from the last recalculation. */
  kpiScore?: number;
  priorityRecalculatedAt?: FirestoreTimestamp;
  createdAt?: FirestoreTimestamp;
}

/**
 * The roster.
 *
 * An admin reads every employee. A sub admin reads their own team, by the same
 * `subAdminUid` constraint their Security Rule checks — filtering the full
 * roster in JavaScript would not work, because Firestore refuses a list query
 * it cannot prove safe before running it.
 *
 * `scope` is optional so every existing admin call site keeps working
 * unchanged.
 */
export function useEmployees(
  enabled = true,
  scope?: {
    role?: 'admin' | 'subadmin' | 'employee' | null;
    uid?: string;
    /**
     * Read the whole roster rather than one team. True for an **HR manager**,
     * who may hand a lead to any active employee whatever team they are on —
     * an assignment list scoped to their own team could not offer the people
     * the owner asked them to be able to reach. The `users` rule carries the
     * matching `isHr()` clause; without it this query is refused, not trimmed.
     */
    companyWide?: boolean;
  }
) {
  const demoState = useDemoState();

  const teamOf =
    scope?.role === 'subadmin' && !scope.companyWide ? (scope.uid ?? null) : null;
  // A sub admin with no uid yet would otherwise fall through to the roster-wide
  // query and be denied, which reads on screen as an empty team. An HR manager
  // is asking for that query on purpose, so they are exempt from the wait.
  const ready =
    enabled && (scope?.role !== 'subadmin' || scope.companyWide === true || Boolean(teamOf));

  /*
    **Shared.** `users` is read by the leads workspace, the directory, the
    dashboard, the Data Bank and every assign control — one question, opened
    five times. `useLive` gives them one listener and holds it briefly between
    screens; see `lib/liveCollection` for the measurement that prompted it.
  */
  const build = useCallback(
    () =>
      teamOf
        ? query(collection(db, 'users'), where('subAdminUid', '==', teamOf))
        : query(collection(db, 'users'), where('role', '==', 'employee')),
    [teamOf]
  );

  const live = useLive(`users:${teamOf ?? 'employees'}`, build, !IS_DEMO && ready, describeLiveError);
  const employees = useMemo(() => live.rows.map(readEmployee), [live.rows]);

  if (IS_DEMO) {
    // The live query is `role == "employee"`, so the demo roster must exclude
    // sub admins too — otherwise a manager would appear in the distribution
    // lane and in every "assign to" list.
    const roster = teamOf
      ? demoState.employees.filter((employee) => employee.subAdminUid === teamOf)
      : demoState.employees.filter((employee) => employee.accessRole !== 'subadmin');
    return { employees: enabled ? roster : [], loading: false, error: null };
  }

  return {
    employees: ready ? employees : [],
    loading: ready && live.loading,
    error: ready ? live.error : null,
  };
}

/**
 * One stored `users` document, made legible.
 *
 * Hoisted out of the listener so `useEmployees` and `useSubAdmins` read a
 * person the same way. **This is the mapper this project has shipped six bugs
 * in** — a field typed on the interface and never taken out of the snapshot —
 * and two copies of it was how five of them happened. One copy cannot disagree
 * with itself.
 */
function readEmployee(raw: Record<string, unknown>): EmployeeData {
  return {
    name: raw.name || raw.email || 'Unnamed',
    email: raw.email || '—',
    priority: typeof raw.priority === 'number' ? raw.priority : 99,
    jobTitle: normalizeJobTitle(raw.jobTitle),
    status: raw.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    phone: typeof raw.phone === 'string' ? raw.phone : null,
    joinedAt: raw.joinedAt ?? null,
    notes: typeof raw.notes === 'string' ? raw.notes : null,
    // In the rotation or not, by the same predicate the server's roster uses:
    // an employee is in unless marked out, a manager is out unless marked in.
    // Reading a manager's absent field as "in" would show them in rotation
    // on the lane screen while the server skipped them.
    autoAssign: laneMembership(raw),
    leadsPerTurn: normalizeLeadsPerTurn(raw.leadsPerTurn),
    targets: raw.targets as KpiTargets | undefined,
    autoPriority: raw.autoPriority !== false,
    accessRole: raw.role === 'subadmin' ? 'subadmin' : 'employee',
    subAdminUid: typeof raw.subAdminUid === 'string' ? raw.subAdminUid : null,
    managerKind: raw.managerKind === 'HR' ? 'HR' : 'SALES',
    monthlySalary: typeof raw.monthlySalary === 'number' ? raw.monthlySalary : 0,
    kpiScore: typeof raw.kpiScore === 'number' ? raw.kpiScore : undefined,
    priorityRecalculatedAt: raw.priorityRecalculatedAt,
    createdAt: raw.createdAt,
    uid: String(raw.id ?? ''),
  } as EmployeeData;
}

/**
 * The sub admins, for the admin's assignment controls.
 *
 * Admin-only: nobody else has a reason to enumerate the management layer, and
 * a sub admin listing their peers is exactly the visibility §22 forbids.
 */
export function useSubAdmins(enabled = true) {
  const demoState = useDemoState();

  /*
    Shared with every other reader of this query — the leads assign control, the
    Data Bank hand-off, the directory and the marketing income form all ask for
    it, and each used to open its own listener.
  */
  const build = useCallback(
    () => query(collection(db, 'users'), where('role', '==', 'subadmin')),
    []
  );
  const live = useLive('users:subadmins', build, !IS_DEMO && enabled, describeLiveError);

  const subAdmins = useMemo(() => {
    /*
      **`accessRole` and `subAdminUid` are forced, not read.** This query is
      `role == 'subadmin'` by construction, and a manager reports to the admin —
      so taking either off the document would let one bad record put a manager
      in somebody's team.
    */
    const rows = live.rows.map((raw) => ({
      ...readEmployee(raw),
      accessRole: 'subadmin' as const,
      subAdminUid: null,
    }));
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [live.rows]);

  if (IS_DEMO) {
    return {
      subAdmins: enabled ? demoState.employees.filter((e) => e.accessRole === 'subadmin') : [],
      loading: false,
      error: null,
    };
  }

  return {
    subAdmins: enabled ? subAdmins : [],
    loading: enabled && live.loading,
    error: enabled ? live.error : null,
  };
}

/**
 * The signed-in user's own profile document.
 *
 * Security Rules allow `isSelf`, so this works for an employee as well as an
 * admin — the roster query above does not, because it reads the whole team.
 * Used for the dashboard greeting, which needs the person's real name rather
 * than the local part of their email address.
 */
export function useMyProfile(uid: string | undefined) {
  const [state, setState] = useState<{
    key: string;
    name: string | null;
    jobTitle: string | null;
    targets?: KpiTargets;
  } | null>(null);
  const demoState = useDemoState();
  const key = uid ?? 'idle';

  useEffect(() => {
    if (IS_DEMO || !uid) return;

    const unsubscribe = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const raw = snap.data();
        setState({
          key: uid,
          name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : null,
          // Read out of the snapshot, for the same reason `name` is: a screen
          // that has to invent somebody's role prints a hardcoded default, and
          // "Sales Executive" on every manager is how that goes wrong.
          jobTitle: typeof raw?.jobTitle === 'string' && raw.jobTitle.trim() ? raw.jobTitle.trim() : null,
          targets: raw?.targets as KpiTargets | undefined,
        });
      },
      (err) => {
        // An admin may legitimately have no profile document; that is not an
        // error worth surfacing, the greeting just falls back to their email.
        console.error('[useMyProfile]', err);
        setState({ key: uid, name: null, jobTitle: null });
      }
    );

    return () => unsubscribe();
  }, [uid]);

  if (IS_DEMO) {
    const account = demoState.employees.find((employee) => employee.uid === uid);
    return {
      name: account?.name ?? null,
      jobTitle: account?.jobTitle ?? null,
      targets: account?.targets,
      loading: false,
    };
  }

  const current = state?.key === key ? state : null;
  return {
    name: current?.name ?? null,
    jobTitle: current?.jobTitle ?? null,
    targets: current?.targets,
    loading: Boolean(uid) && current === null,
  };
}
