import { useState, useEffect } from 'react';
import { collection, doc, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError, type FirestoreTimestamp } from './useLeads';
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

interface EmployeeState {
  employees: EmployeeData[];
  error: string | null;
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
  scope?: { role?: 'admin' | 'subadmin' | 'employee' | null; uid?: string }
) {
  const [state, setState] = useState<EmployeeState | null>(null);
  const demoState = useDemoState();

  const teamOf = scope?.role === 'subadmin' ? (scope.uid ?? null) : null;
  // A sub admin with no uid yet would otherwise fall through to the admin
  // query and be denied, which reads on screen as an empty team.
  const ready = enabled && (scope?.role !== 'subadmin' || Boolean(teamOf));

  useEffect(() => {
    if (IS_DEMO || !ready) return;

    const q = teamOf
      ? query(collection(db, 'users'), where('subAdminUid', '==', teamOf))
      : query(collection(db, 'users'), where('role', '==', 'employee'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const employees = snapshot.docs.map((doc) => {
          const raw = doc.data();
          return {
            uid: doc.id,
            name: raw.name || raw.email || 'Unnamed',
            email: raw.email || '—',
            priority: typeof raw.priority === 'number' ? raw.priority : 99,
            jobTitle: normalizeJobTitle(raw.jobTitle),
            status: raw.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
            phone: typeof raw.phone === 'string' ? raw.phone : null,
            joinedAt: raw.joinedAt ?? null,
            notes: typeof raw.notes === 'string' ? raw.notes : null,
            // Absent means in the lane. Only an explicit `false` takes someone
            // out of automatic distribution, so records predating the field
            // keep receiving leads.
            autoAssign: raw.autoAssign !== false,
            targets: raw.targets as KpiTargets | undefined,
            autoPriority: raw.autoPriority !== false,
            accessRole: raw.role === 'subadmin' ? 'subadmin' : 'employee',
            subAdminUid: typeof raw.subAdminUid === 'string' ? raw.subAdminUid : null,
            managerKind: raw.managerKind === 'HR' ? 'HR' : 'SALES',
            monthlySalary: typeof raw.monthlySalary === 'number' ? raw.monthlySalary : 0,
            kpiScore: typeof raw.kpiScore === 'number' ? raw.kpiScore : undefined,
            priorityRecalculatedAt: raw.priorityRecalculatedAt,
            createdAt: raw.createdAt,
          } as EmployeeData;
        });

        // Active first, then by rotation priority, then by name.
        employees.sort((a, b) => {
          if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
          if (a.priority !== b.priority) return a.priority - b.priority;
          return a.name.localeCompare(b.name);
        });

        setState({ employees, error: null });
      },
      (err) => {
        console.error('[useEmployees]', err);
        setState({ employees: [], error: describeFirestoreError(err) });
      }
    );

    return () => unsubscribe();
  }, [ready, teamOf]);

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
    employees: ready ? (state?.employees ?? []) : [],
    loading: ready && state === null,
    error: ready ? (state?.error ?? null) : null,
  };
}

/**
 * The sub admins, for the admin's assignment controls.
 *
 * Admin-only: nobody else has a reason to enumerate the management layer, and
 * a sub admin listing their peers is exactly the visibility §22 forbids.
 */
export function useSubAdmins(enabled = true) {
  const [state, setState] = useState<EmployeeState | null>(null);
  const demoState = useDemoState();

  useEffect(() => {
    if (IS_DEMO || !enabled) return;

    const unsubscribe = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'subadmin')),
      (snapshot) => {
        const employees = snapshot.docs.map((doc) => {
          const raw = doc.data();
          return {
            uid: doc.id,
            name: raw.name || raw.email || 'Unnamed',
            email: raw.email || '—',
            priority: typeof raw.priority === 'number' ? raw.priority : 99,
            jobTitle: normalizeJobTitle(raw.jobTitle),
            status: raw.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
            phone: typeof raw.phone === 'string' ? raw.phone : null,
            joinedAt: raw.joinedAt ?? null,
            notes: typeof raw.notes === 'string' ? raw.notes : null,
            autoAssign: raw.autoAssign !== false,
            targets: raw.targets as KpiTargets | undefined,
            autoPriority: raw.autoPriority !== false,
            accessRole: 'subadmin',
            subAdminUid: null,
            createdAt: raw.createdAt,
          } as EmployeeData;
        });

        employees.sort((a, b) => a.name.localeCompare(b.name));
        setState({ employees, error: null });
      },
      (err) => {
        console.error('[useSubAdmins]', err);
        setState({ employees: [], error: describeFirestoreError(err) });
      }
    );

    return () => unsubscribe();
  }, [enabled]);

  if (IS_DEMO) {
    return {
      subAdmins: enabled ? demoState.employees.filter((e) => e.accessRole === 'subadmin') : [],
      loading: false,
      error: null,
    };
  }

  return {
    subAdmins: enabled ? (state?.employees ?? []) : [],
    loading: enabled && state === null,
    error: enabled ? (state?.error ?? null) : null,
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
  const [state, setState] = useState<{ key: string; name: string | null; targets?: KpiTargets } | null>(null);
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
          targets: raw?.targets as KpiTargets | undefined,
        });
      },
      (err) => {
        // An admin may legitimately have no profile document; that is not an
        // error worth surfacing, the greeting just falls back to their email.
        console.error('[useMyProfile]', err);
        setState({ key: uid, name: null });
      }
    );

    return () => unsubscribe();
  }, [uid]);

  if (IS_DEMO) {
    const account = demoState.employees.find((employee) => employee.uid === uid);
    return { name: account?.name ?? null, targets: account?.targets, loading: false };
  }

  const current = state?.key === key ? state : null;
  return { name: current?.name ?? null, targets: current?.targets, loading: Boolean(uid) && current === null };
}
