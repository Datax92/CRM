"use client";

import { useSyncExternalStore } from 'react';
import type { Lead, FollowUpRecord, AuditEventRecord, FirestoreTimestamp } from '@/hooks/useLeads';
import type { DealRecord, ExpenseRecord, AppNotification } from '@/hooks/useFinancials';
import type { EmployeeData } from '@/hooks/useEmployees';
import type { ReceivableRecord } from '@/hooks/useReceivables';
import type { AccountRecord } from '@/hooks/useAccounts';
import type { DataBankFolder, DataBankRecord } from '@/hooks/useDataBank';
import { fieldKeyFor, phoneKey, type DataBankStatus } from '@/lib/dataBank';
import type { CampaignRecord } from '@/hooks/useCampaigns';
import type { ClientFolder, ClientFolderMember } from '@/hooks/useClients';
import type { AttendanceRecord } from '@/hooks/useAttendance';
import { deriveStatus, isValidIp, normalizeIp, type AttendanceStatus } from '@/lib/attendance';
import {
  buildPayrollLine,
  canTransition,
  isEditable,
  normalizeSalaryProfile,
  payrollTotals,
  repriceLine,
  type PayrollLine,
  type PayrollStatus,
  type SalaryProfile,
} from '@/lib/payroll';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  LEGACY_EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  normalizeExpenseStatus,
  type ExpenseStatus,
} from '@/lib/officeExpenses';
import {
  DEFAULT_ATTENDANCE_POLICY,
  classifyCheckIn,
  formatClockValue,
  monthDeductions,
  parseClock,
  leaveBalances,
  leaveDayCount,
  leaveDayKeys,
  normalizePolicy,
  LEAVE_TYPE_LABELS,
  type AttendancePolicy,
  type LeaveStatus,
  type LeaveType,
} from '@/lib/attendancePolicy';
import { isTerminal, type LeadStatus } from '@/lib/leadStatus';
import type { DistributionLine } from '@/lib/profitDistribution';
import { calculateDistribution, type DistributionShare } from '@/lib/profitDistribution';
import { validateKyc, leadPatchFromKyc, type KycValues } from '@/lib/kyc';
import { PIPELINE_STAGES, meetsColdRule, pipelineStage, type PipelineStage } from '@/lib/pipelineStage';
import {
  ALL_EMPLOYEES, ALL_MANAGERS, blankMetrics, describeSubject, parseSubject, rowsForSubject,
  shortId, sumMetrics, teamLabel, type ReportPerson,
} from '@/lib/reportScope';
import type { ReportOption } from '@/app/actions/reports';
import { entryAllowance } from '@/lib/followUpKind';
import { ADMIN_ASSIGN_WINDOW_MS, MIN_PRIORITY, MAX_PRIORITY } from '@/lib/constants/distribution';
import { startOfKarachiDay, karachiDayKey, karachiMonthKey } from '@/lib/dates';
import { normalizeJobTitle } from '@/lib/constants/roles';
import { normalizeDealCategory } from '@/lib/constants/deals';
import {
  DEFAULT_KPI_TARGETS, EMPTY_KPI_COUNTS, isConnect, kpiScore, monthKey,
  normalizeDurationSeconds, priorityFromScores, type KpiCounts, type KpiTargets,
} from '@/lib/kpi';

/**
 * Demo mode — a fully interactive walkthrough with no backend at all.
 *
 * Everything lives in memory: sign-in, leads, follow-ups, deals, expenses. No
 * Firebase, no network, no credentials. Intended for showing the product to
 * someone before the real project is configured.
 *
 * Off unless NEXT_PUBLIC_DEMO_MODE=true. When it is on, a banner is pinned to
 * every screen so nobody can mistake this for live data — the previous build's
 * fatal flaw was a demo path that looked exactly like the real thing and issued
 * working admin tokens against a live database. This one cannot reach a
 * database at all.
 */

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export const DEMO_PASSWORD = 'Demo12345';

export interface DemoAccount {
  uid: string;
  email: string;
  name: string;
  role: 'admin' | 'subadmin' | 'employee';
  /** Sales or HR, for the manager accounts (§13). */
  managerKind?: 'SALES' | 'HR';
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { uid: 'demo-admin', email: 'admin@crm.com', name: 'Usman Sheikh', role: 'admin' },
  // A sub admin, so the hierarchy can actually be walked in demo mode rather
  // than only described. Ayesha and Bilal report to her; Sana does not, which
  // is what makes "a sub admin sees only their own team" visible on screen.
  { uid: 'demo-sub-1', email: 'hina@crm.com', name: 'Hina Raza', role: 'subadmin' },
  { uid: 'demo-emp-1', email: 'ayesha@crm.com', name: 'Ayesha Khan', role: 'employee' },
  { uid: 'demo-emp-2', email: 'bilal@crm.com', name: 'Bilal Ahmed', role: 'employee' },
  { uid: 'demo-emp-3', email: 'sana@crm.com', name: 'Sana Malik', role: 'employee' },
];

const SESSION_KEY = 'crm.demo.session';

/**
 * The signed-in demo account, held outside React.
 *
 * Restored from sessionStorage at module load rather than in an effect, and
 * exposed through useSyncExternalStore with a null server snapshot — which is
 * the pattern React documents for client-only state that must survive
 * hydration without a mismatch.
 */
let demoSession: DemoAccount | null = null;
const sessionListeners = new Set<() => void>();

if (IS_DEMO && typeof window !== 'undefined') {
  const stored = window.sessionStorage.getItem(SESSION_KEY);
  demoSession = DEMO_ACCOUNTS.find((a) => a.uid === stored) ?? null;
}

export function getDemoSession(): DemoAccount | null {
  return demoSession;
}

export function signInDemo(email: string, password: string): DemoAccount | null {
  const account = DEMO_ACCOUNTS.find(
    (a) => a.email.toLowerCase() === email.trim().toLowerCase()
  );
  if (!account || password !== DEMO_PASSWORD) return null;

  demoSession = account;
  window.sessionStorage.setItem(SESSION_KEY, account.uid);
  sessionListeners.forEach((fn) => fn());
  return account;
}

export function signOutDemo() {
  demoSession = null;
  window.sessionStorage.removeItem(SESSION_KEY);
  sessionListeners.forEach((fn) => fn());
}

export function useDemoSession(): DemoAccount | null {
  return useSyncExternalStore(
    (fn) => {
      sessionListeners.add(fn);
      return () => sessionListeners.delete(fn);
    },
    () => demoSession,
    () => null
  );
}

/** Firestore Timestamps are objects with these methods; the UI calls them everywhere. */
function ts(date: Date) {
  return {
    toDate: () => date,
    toMillis: () => date.getTime(),
    seconds: Math.floor(date.getTime() / 1000),
  };
}
/**
 * The report selector, mirroring `buildOptions` on the server.
 *
 * Kept beside the demo report rather than shared with the action: the action
 * is a `"use server"` module, so importing a value out of it into client code
 * would drag the Admin SDK into the browser bundle.
 */
function demoReportOptions(people: ReportPerson[], viewerUid: string): ReportOption[] {
  const employees = people.filter((person) => person.role === 'employee');
  const managers = people.filter((person) => person.role === 'subadmin');
  const admins = people.filter((person) => person.role === 'admin');
  const options: ReportOption[] = [];

  if (employees.length > 1) {
    options.push({
      value: ALL_EMPLOYEES,
      label: 'All Employees',
      group: 'OVERALL',
      hint: `Combined performance of ${employees.length} employees`,
    });
  }
  // Only when there is more than one team. With a single manager "All
  // Managers" and selecting that manager produce identical figures, and two
  // options that do the same thing read as though they do not.
  if (managers.length > 1) {
    options.push({
      value: ALL_MANAGERS,
      label: 'All Managers',
      group: 'OVERALL',
      hint: 'Every manager, each including their own team',
    });
  }
  for (const person of employees) {
    options.push({
      value: person.uid,
      label: person.name,
      group: 'EMPLOYEES',
      hint: person.uid === viewerUid ? 'You' : undefined,
    });
  }
  for (const person of managers) {
    options.push({
      value: person.uid,
      label: person.name,
      group: 'MANAGERS',
      hint: person.uid === viewerUid ? 'You — with your team' : 'Includes their team',
    });
  }
  for (const person of admins) {
    options.push({
      value: person.uid,
      label: person.uid === viewerUid ? `${person.name} (You)` : person.name,
      group: 'ADMIN',
      hint: "The admin's own activity",
    });
  }

  if (options.length === 0 && people.length > 0) {
    options.push({ value: people[0].uid, label: people[0].name, group: 'EMPLOYEES' });
  }
  return options;
}

/** Whatever a demo record holds for a date — Timestamp, Date or ISO — as a Date. */
function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  const stamp = (value as { toDate?: () => Date } | null | undefined)?.toDate?.();
  return stamp ?? new Date(0);
}

const minutesFromNow = (n: number) => ts(new Date(Date.now() + n * 60_000));
const hoursAgo = (n: number) => ts(new Date(Date.now() - n * 3_600_000));
const daysAgo = (n: number) => ts(new Date(Date.now() - n * 86_400_000));

const CAMPAIGNS = [
  { id: '23851', name: 'DHA Phase 6 — Plot Enquiry' },
  { id: '23852', name: 'Bahria Town — Apartments' },
  { id: '23853', name: 'Gulberg — Commercial Floors' },
];

/** Mirrors the `users/{uid}/kpiMonths/{YYYY-MM}` documents. */
export interface DemoKpiMonth extends KpiCounts {
  monthKey: string;
  portfolio: Record<string, number>;
}

interface DemoState {
  employees: EmployeeData[];
  attendance: AttendanceRecord[];
  /** Mirrors `config/attendance` — the whole policy, not just the IPs. */
  attendancePolicy: AttendancePolicy;
  /** Mirrors `leaveRequests`. */
  leaveRequests: DemoLeaveRequest[];
  /** Mirrors `attendancePeriods` — a closed month's frozen deductions (§12). */
  attendancePeriods: Record<string, DemoAttendancePeriod>;
  /** Mirrors `payrollPeriods` — one generated month each. */
  payrollPeriods: Record<string, DemoPayrollPeriod>;
  /** Mirrors `payslips`, keyed `{uid}_{YYYY-MM}`. */
  payslips: Record<string, DemoPayslip>;
  /** Mirrors the custom half of `config/expenseCategories`. */
  expenseCategories: string[];
  /** Per-employee allowance adjustments, as held on the user document. */
  leaveAdjustments: Record<string, Partial<Record<LeaveType, number>>>;
  /** uid -> monthKey -> counters. */
  kpiMonths: Record<string, Record<string, DemoKpiMonth>>;
  leads: Lead[];
  followUps: Record<string, FollowUpRecord[]>;
  events: Record<string, AuditEventRecord[]>;
  deals: DealRecord[];
  expenses: ExpenseRecord[];
  notifications: AppNotification[];
  receivables: ReceivableRecord[];
  committee: AccountRecord[];
  investments: AccountRecord[];
  capitalInvestments: AccountRecord[];
  personalExpenses: AccountRecord[];
  campaigns: CampaignRecord[];
  dataBankFolders: DataBankFolder[];
  dataBankRecords: DataBankRecord[];
  /** Finalised profit splits — the admin-only whole picture. */
  distributions: DemoDistribution[];
  /** One row per recipient, the way `dealPayouts` is scoped in production. */
  payouts: DemoPayout[];
  /** Client folders and their membership rows — never copies of leads. */
  clientFolders: ClientFolder[];
  clientFolderLeads: ClientFolderMember[];
}

/** Mirrors a `payrollPeriods` document. */
export interface DemoPayrollPeriod {
  monthKey: string;
  status: PayrollStatus;
  lines: PayrollLine[];
  generatedAt: string | null;
  generatedByUid: string | null;
  history: { at: string | null; byUid: string; byName: string | null; action: string; detail: string | null }[];
}

/** Mirrors a `payslips` document — one person, one month. */
export interface DemoPayslip {
  id: string;
  uid: string;
  monthKey: string;
  status: PayrollStatus;
  line: PayrollLine;
  current: boolean;
  approvedAt: string | null;
  approvedByName: string | null;
}

/** Mirrors an `attendancePeriods` document — one closed month. */
export interface DemoAttendancePeriod {
  monthKey: string;
  finalized: boolean;
  finalizedAt: string | null;
  finalizedByUid: string | null;
  finalizedByName: string | null;
  lines: {
    uid: string;
    name: string;
    monthlySalary: number;
    lateCount: number;
    amount: number;
    basis: string[];
  }[];
  total: number;
  policy: AttendancePolicy | null;
}

/** Mirrors a `leaveRequests` document. */
export interface DemoLeaveRequest {
  id: string;
  uid: string;
  employeeName: string | null;
  subAdminUid: string | null;
  type: LeaveType;
  from: string;
  to: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  requestedByUid: string;
  requestedAt?: FirestoreTimestamp;
  decidedByUid?: string | null;
  decidedByName?: string | null;
  decidedAt?: FirestoreTimestamp | null;
  decisionNote?: string | null;
}

/** Mirrors a `dealDistributions` document closely enough for the screens. */
export interface DemoDistribution {
  id: string;
  dealId: string;
  leadId: string;
  employeeUid: string | null;
  subAdminUid: string | null;
  customerName: string | null;
  amountReceived: number;
  payableAmount: number;
  netProfit: number;
  lines: DistributionLine[];
  distributedPercentage: number;
  distributedAmount: number;
  remainingPercentage: number;
  remainingAmount: number;
  companyBaseAmount: number;
  companyTotalAmount: number;
  finalizedByUid: string;
  finalizedAt?: FirestoreTimestamp;
  current: boolean;
}

/** Mirrors a `dealPayouts` document. */
export interface DemoPayout {
  id: string;
  dealId: string;
  leadId: string;
  distributionId: string;
  recipientUid: string;
  recipientName: string;
  recipientRole: 'employee' | 'subadmin';
  kind: string;
  subAdminUid: string | null;
  percentage: number;
  amount: number;
  netProfit: number;
  customerName: string | null;
  finalizedAt?: FirestoreTimestamp;
  current: boolean;
}

function seed(): DemoState {
  const employees: EmployeeData[] = [
    { uid: 'demo-sub-1', name: 'Hina Raza', email: 'hina@crm.com', priority: 1, status: 'ACTIVE', jobTitle: 'Team Lead', accessRole: 'subadmin', targets: { ...DEFAULT_KPI_TARGETS }, autoPriority: true, createdAt: daysAgo(150) },
    { uid: 'demo-emp-1', name: 'Ayesha Khan', email: 'ayesha@crm.com', priority: 1, status: 'ACTIVE', jobTitle: 'Senior Sales Executive', subAdminUid: 'demo-sub-1', targets: { ...DEFAULT_KPI_TARGETS }, autoPriority: true, createdAt: daysAgo(120) },
    { uid: 'demo-emp-2', name: 'Bilal Ahmed', email: 'bilal@crm.com', priority: 2, status: 'ACTIVE', jobTitle: 'Sales Executive', subAdminUid: 'demo-sub-1', targets: { ...DEFAULT_KPI_TARGETS }, autoPriority: true, createdAt: daysAgo(80) },
    { uid: 'demo-emp-3', name: 'Sana Malik', email: 'sana@crm.com', priority: 3, status: 'ACTIVE', jobTitle: 'Account Manager', targets: { ...DEFAULT_KPI_TARGETS }, autoPriority: true, createdAt: daysAgo(45), joinedAt: daysAgo(45), phone: '923004455661', autoAssign: false, notes: 'Handles walk-ins only — kept out of the automatic lane.' },
    { uid: 'demo-emp-4', name: 'Faisal Siddiqui', email: 'faisal@crm.com', priority: 4, status: 'DISABLED', jobTitle: 'Intern', targets: { ...DEFAULT_KPI_TARGETS }, autoPriority: true, createdAt: daysAgo(20) },
  ];

  // A year of KPI history, so the dashboard's YTD chart has something to draw.
  // Shaped rather than random: a build-up through the year, the current month
  // partial because it is still running, and one employee clearly ahead.
  const thisYear = new Date().getFullYear();
  const thisMonth = new Date().getMonth() + 1;
  const kpiMonths: DemoState['kpiMonths'] = {};

  const shape: Record<string, { pace: number; close: number }> = {
    'demo-emp-1': { pace: 1.18, close: 1.35 },
    'demo-emp-2': { pace: 0.86, close: 0.72 },
    'demo-emp-3': { pace: 0.64, close: 0.55 },
    'demo-emp-4': { pace: 0.3, close: 0.2 },
  };

  for (const employee of employees) {
    const { pace, close } = shape[employee.uid] ?? { pace: 0.8, close: 0.8 };
    const months: Record<string, DemoKpiMonth> = {};

    for (let month = 1; month <= thisMonth; month++) {
      // The current month is only part-run, so scale it by how far through it is.
      const partial = month === thisMonth ? Math.max(0.25, new Date().getDate() / 30) : 1;
      const ramp = 0.7 + (month / 12) * 0.6;
      const connects = Math.round(DEFAULT_KPI_TARGETS.connects * pace * ramp * partial);
      const registrations = Math.round(DEFAULT_KPI_TARGETS.registrations * close * ramp * partial);
      const meetings = Math.round(DEFAULT_KPI_TARGETS.meetings * pace * ramp * partial);
      const revenue = registrations * 425_000;

      months[monthKey(thisYear, month)] = {
        monthKey: monthKey(thisYear, month),
        calls: Math.round(connects * 1.7),
        connects,
        registrations,
        meetings,
        revenue,
        portfolio: {
          Rental: Math.round(revenue * 0.22),
          Installment: Math.round(revenue * 0.46),
          Investment: Math.round(revenue * 0.32),
        },
      };
    }

    kpiMonths[employee.uid] = months;
  }

  // A month of attendance, so the card and the rate are not empty on a first
  // look. Shaped like real days: in around 9, out around 7, the odd short day,
  // Sundays off, and one employee mostly remote.
  // Keyed off the Karachi calendar, not the server's. Seeding by UTC days
  // means that between 19:00 and midnight UTC the "today" the app asks for
  // does not exist in the seed, and the card renders an empty day.
  const attendance: AttendanceRecord[] = [];
  const attendanceMonth = karachiMonthKey();
  const todayNumber = Number(karachiDayKey().slice(-2));
  const [seedYear, seedMonth] = attendanceMonth.split('-').map(Number);

  for (const employee of employees) {
    const remoteLeaning = employee.uid === 'demo-emp-3';

    for (let day = 1; day <= todayNumber; day++) {
      if (new Date(Date.UTC(seedYear, seedMonth - 1, day)).getUTCDay() === 0) continue; // Sunday.

      // A couple of absences a month keeps the rate honest rather than 100%.
      if (day % 11 === 0) continue;

      const short = day % 7 === 0;
      // Karachi is UTC+5, so 09:xx local is 04:xx UTC.
      const plannedIn = new Date(Date.UTC(seedYear, seedMonth - 1, day, 4, 5 + (day % 25)));
      const plannedOut = new Date(
        Date.UTC(seedYear, seedMonth - 1, day, short ? 8 : 14, (day * 7) % 60)
      );

      // Neither end may be in the future — a demo that shows tomorrow's
      // check-out is worse than one that shows a short day. When the sample
      // working hours have not arrived yet (the demo is being viewed at 2am),
      // today is backdated a few hours so the card still demonstrates itself.
      const nowMs = Date.now();
      const lastAt = new Date(Math.min(plannedOut.getTime(), nowMs));
      const firstAt = new Date(
        Math.min(plannedIn.getTime(), lastAt.getTime() - 3 * 3_600_000)
      );
      if (lastAt.getTime() <= firstAt.getTime()) continue;

      const dayKey = `${attendanceMonth}-${String(day).padStart(2, '0')}`;

      attendance.push({
        id: `${employee.uid}_${dayKey}`,
        uid: employee.uid,
        dayKey,
        monthKey: attendanceMonth,
        firstActionAt: ts(firstAt),
        lastActionAt: ts(lastAt),
        workedMinutes: Math.floor((lastAt.getTime() - firstAt.getTime()) / 60_000),
        network: remoteLeaning && day % 3 === 0 ? 'REMOTE' : 'OFFICE',
        lastIp: remoteLeaning && day % 3 === 0 ? '203.0.113.42' : '198.51.100.7',
        // A check-in after the configured time is a late day (§5). The seed
        // computes it the same way the server does rather than hard-coding a
        // flag, so changing the demo start time moves the demo's lates too.
        ...(() => {
          const verdict = classifyCheckIn(firstAt, DEFAULT_ATTENDANCE_POLICY);
          return verdict.late
            ? {
                late: true,
                lateByMinutes: verdict.lateByMinutes,
                lateAfter: verdict.lateAfter,
              }
            : {};
        })(),
      });
    }
  }

  // Ayesha and Bilal report to Hina; Sana and Faisal report to the admin. That
  // split is what makes "a sub admin sees only their own team" visible on
  // screen rather than merely described.
  const TEAM_OF: Record<string, string> = {
    'demo-emp-1': 'demo-sub-1',
    'demo-emp-2': 'demo-sub-1',
  };

  const mk = (
    id: string, name: string, phone: string, email: string, city: string,
    status: Lead['status'], campaign: number, assigned: string | null,
    extra: Partial<Lead> = {}
  ): Lead => ({
    id, name, phone, email, city,
    status, source: 'META_ADS',
    campaignId: CAMPAIGNS[campaign].id,
    campaignName: CAMPAIGNS[campaign].name,
    assignedUserId: assigned,
    attemptedAssignees: assigned ? [assigned] : [],
    // Whose team holds it, derived from the assignee rather than repeated on
    // every seed row — the real `assignmentStamp` reads it off the employee
    // for the same reason, and a hand-written copy per lead would drift the
    // first time somebody changes team in the seed.
    subAdminUid: assigned ? (TEAM_OF[assigned] ?? null) : null,
    followUpCount: 0,
    callCount: 0,
    ...extra,
  });

  const leads: Lead[] = [
    mk('lead_1001', 'Hamza Tariq', '923001234567', 'hamza.tariq@gmail.com', 'Lahore', 'NEW', 0, null, {
      createdAt: hoursAgo(0.05), adminAssignDeadlineAt: minutesFromNow(3.5),
    }),
    mk('lead_1002', 'Fatima Noor', '923215558899', 'f.noor@outlook.com', 'Karachi', 'NEW', 1, null, {
      createdAt: hoursAgo(0.02), adminAssignDeadlineAt: minutesFromNow(4.6),
    }),
    mk('lead_1003', 'Imran Qureshi', '923334447788', 'imran.q@gmail.com', 'Islamabad', 'ASSIGNED', 0, 'demo-emp-1', {
      createdAt: hoursAgo(0.3), assignedAt: hoursAgo(0.05), acceptDeadlineAt: minutesFromNow(7.2),
      distributionMethod: 'AUTO',
    }),
    mk('lead_1004', 'Zainab Rashid', '923018887766', 'zainab.r@gmail.com', 'Lahore', 'NEGOTIATION', 2, 'demo-emp-1', {
      createdAt: daysAgo(3), assignedAt: daysAgo(3), acceptedAt: daysAgo(3),
      followUpCount: 3, callCount: 5, distributionMethod: 'AUTO',
    }),
    mk('lead_1005', 'Ahmed Raza', '923457778899', 'ahmed.raza@company.pk', 'Karachi', 'INTERESTED', 1, 'demo-emp-2', {
      createdAt: daysAgo(2), assignedAt: daysAgo(2), acceptedAt: daysAgo(2),
      followUpCount: 2, callCount: 2, distributionMethod: 'AUTO',
    }),
    mk('lead_1006', 'Sadia Iqbal', '923219994455', 'sadia.iqbal@gmail.com', 'Multan', 'CONTACTED', 0, 'demo-emp-3', {
      createdAt: daysAgo(1), assignedAt: daysAgo(1), acceptedAt: daysAgo(1),
      followUpCount: 1, callCount: 1, distributionMethod: 'MANUAL',
    }),
    mk('lead_1007', 'Kamran Butt', '923006665544', 'k.butt@gmail.com', 'Lahore', 'NO_RESPONSE', 1, 'demo-emp-2', {
      // Chased past the cold threshold and still silent — the archetype the
      // Cold filter exists for.
      createdAt: daysAgo(4), assignedAt: daysAgo(4), acceptedAt: daysAgo(4),
      followUpCount: 12, callCount: 16, distributionMethod: 'AUTO_REASSIGN',
    }),
    mk('lead_1008', 'Nida Aslam', '923331112233', 'nida.aslam@gmail.com', 'Faisalabad', 'CLOSED_WON', 2, 'demo-emp-1', {
      createdAt: daysAgo(9), assignedAt: daysAgo(9), acceptedAt: daysAgo(9), closedAt: daysAgo(2),
      followUpCount: 5, callCount: 8, distributionMethod: 'AUTO',
    }),
    mk('lead_1009', 'Yasir Mehmood', '923005554433', 'yasir.m@gmail.com', 'Rawalpindi', 'CLOSED_WON', 0, 'demo-emp-2', {
      createdAt: daysAgo(14), assignedAt: daysAgo(14), acceptedAt: daysAgo(14), closedAt: daysAgo(6),
      followUpCount: 3, callCount: 4, distributionMethod: 'AUTO',
    }),
    mk('lead_1010', 'Hina Javed', '923452223344', 'hina.javed@gmail.com', 'Lahore', 'CLOSED_LOST', 1, 'demo-emp-3', {
      createdAt: daysAgo(11), assignedAt: daysAgo(11), acceptedAt: daysAgo(11),
      followUpCount: 2, callCount: 3, distributionMethod: 'AUTO',
    }),
  ];

  const followUps: Record<string, FollowUpRecord[]> = {
    lead_1004: [
      { id: 'fu1', message: 'Client visited the Gulberg site. Wants a corner floor and asked for a payment plan over 18 months.', callMade: true, callCount: 2, whatsappNote: 'Sent floor plan PDF', occurredAt: hoursAgo(6), createdAt: hoursAgo(6), authorUid: 'demo-emp-1', authorEmail: 'ayesha@crm.com' },
      { id: 'fu2', message: 'Sent the revised quote. He is comparing against one other option and will confirm this week.', callMade: true, callCount: 2, whatsappNote: 'Shared revised quote', occurredAt: hoursAgo(30), createdAt: hoursAgo(30), authorUid: 'demo-emp-1', authorEmail: 'ayesha@crm.com' },
      { id: 'fu3', message: 'First contact. Confirmed his budget range and that this is for office use, not investment.', callMade: true, callCount: 1, whatsappNote: null, occurredAt: hoursAgo(70), createdAt: hoursAgo(70), authorUid: 'demo-emp-1', authorEmail: 'ayesha@crm.com' },
    ],
    lead_1005: [
      { id: 'fu4', message: 'Wants a 3-bed on a higher floor. Asked about possession timeline and maintenance charges.', callMade: true, callCount: 1, whatsappNote: 'Sent brochure', occurredAt: hoursAgo(20), createdAt: hoursAgo(20), authorUid: 'demo-emp-2', authorEmail: 'bilal@crm.com' },
      { id: 'fu5', message: 'Initial call. Interested, but travelling until next week.', callMade: true, callCount: 1, whatsappNote: null, occurredAt: hoursAgo(44), createdAt: hoursAgo(44), authorUid: 'demo-emp-2', authorEmail: 'bilal@crm.com' },
    ],
    lead_1008: [
      { id: 'fu6', message: 'Deal agreed. Paperwork signed at the office, payment received by bank transfer.', callMade: true, callCount: 1, whatsappNote: 'Confirmed transfer', occurredAt: hoursAgo(50), createdAt: hoursAgo(50), authorUid: 'demo-emp-1', authorEmail: 'ayesha@crm.com' },
      { id: 'fu7', message: 'Final negotiation on price. Agreed after a small discount.', callMade: true, callCount: 3, whatsappNote: null, occurredAt: hoursAgo(96), createdAt: hoursAgo(96), authorUid: 'demo-emp-1', authorEmail: 'ayesha@crm.com' },
    ],
  };

  const events: Record<string, AuditEventRecord[]> = {};
  for (const lead of leads) {
    const list: AuditEventRecord[] = [
      { id: `${lead.id}-e1`, type: 'LEAD_INGESTED', actorUid: 'system:meta-webhook', at: lead.createdAt, meta: { campaignName: lead.campaignName, contactDetailsRetrieved: true } },
    ];
    if (lead.assignedUserId) {
      list.unshift({ id: `${lead.id}-e2`, type: lead.distributionMethod === 'MANUAL' ? 'MANUALLY_ASSIGNED' : 'AUTO_ASSIGNED', actorUid: lead.distributionMethod === 'MANUAL' ? 'demo-admin' : 'system:cron', at: lead.assignedAt, meta: { assignedTo: lead.assignedUserId } });
    }
    if (lead.acceptedAt) {
      list.unshift({ id: `${lead.id}-e3`, type: 'LEAD_ACCEPTED', actorUid: lead.assignedUserId!, at: lead.acceptedAt, meta: {} });
    }
    if (lead.closedAt) {
      list.unshift({ id: `${lead.id}-e4`, type: 'DEAL_CLOSED', actorUid: lead.assignedUserId!, at: lead.closedAt, meta: { dealId: lead.id } });
    }
    events[lead.id] = list;
  }

  const deals: DealRecord[] = [
    {
      id: 'lead_1008', leadId: 'lead_1008', userId: 'demo-emp-1', enteredByUid: 'demo-emp-1',
      customer: { name: 'Nida Aslam', phone: '923331112233', email: 'nida.aslam@gmail.com', cnic: '33100-1234567-8', address: 'House 42, Block C, Peoples Colony', city: 'Faisalabad' },
      serviceDescription: 'Gulberg commercial floor — 2nd floor, 1,850 sq ft',
      paymentMethod: 'Bank Transfer', notes: null,
      amountReceived: 4850000, payableAmount: 3200000, profit: 1650000,
      campaignId: '23853', campaignName: CAMPAIGNS[2].name,
      dealDate: daysAgo(2), enteredAt: daysAgo(2),
    },
    {
      id: 'lead_1009', leadId: 'lead_1009', userId: 'demo-emp-2', enteredByUid: 'demo-emp-2',
      customer: { name: 'Yasir Mehmood', phone: '923005554433', email: 'yasir.m@gmail.com', cnic: '37405-7654321-1', address: 'Flat 7B, Askari 14', city: 'Rawalpindi' },
      serviceDescription: 'DHA Phase 6 — 10 marla residential plot',
      paymentMethod: 'Cheque', notes: null,
      amountReceived: 2750000, payableAmount: 1900000, profit: 850000,
      campaignId: '23851', campaignName: CAMPAIGNS[0].name,
      dealDate: daysAgo(6), enteredAt: daysAgo(6),
    },
  ];

  const expenses: ExpenseRecord[] = [
    { id: 'x1', title: 'Office rent — August', category: 'Rent', amount: 250000, description: null, addedByUid: 'demo-admin', date: daysAgo(12) },
    { id: 'x2', title: 'Team salaries — August', category: 'Salaries', amount: 920000, description: null, addedByUid: 'demo-admin', date: daysAgo(12) },
    { id: 'x3', title: 'Meta Ads — lead campaigns', category: 'Marketing', amount: 175000, description: 'Facebook and Instagram lead forms', addedByUid: 'demo-admin', date: daysAgo(8) },
    { id: 'x4', title: 'Fibre internet', category: 'Internet', amount: 12000, description: null, addedByUid: 'demo-admin', date: daysAgo(10) },
    { id: 'x5', title: 'Electricity bill', category: 'Electricity', amount: 46500, description: null, addedByUid: 'demo-admin', date: daysAgo(5) },
    { id: 'x6', title: 'CRM and software licences', category: 'Software', amount: 28000, description: null, addedByUid: 'demo-admin', date: daysAgo(3) },
  ];

  const notifications: AppNotification[] = [
    // `targetRole` is not decoration: the bell scopes by it, exactly as the
    // real query does, so the demo cannot show an employee an admin's alerts.
    { id: 'n1', type: 'RED_FLAG', leadId: 'lead_1007', targetRole: 'admin', payload: { message: 'Kamran Butt was not accepted within 5 minutes.' }, createdAt: hoursAgo(2), readAt: null },
    { id: 'n2', type: 'NO_FOLLOWUP', leadId: 'lead_1007', targetRole: 'admin', payload: { message: 'No follow-up logged on Kamran Butt for over 24 hours.' }, createdAt: hoursAgo(1), readAt: null },
    { id: 'n3', type: 'NEW_LEAD_ASSIGNED', leadId: 'lead_1003', targetRole: 'employee', targetUid: 'demo-emp-1', payload: { message: 'Imran Qureshi has been assigned to you. Accept within 5 minutes.' }, createdAt: hoursAgo(0.05), readAt: null },
  ];

  const receivables: ReceivableRecord[] = [
    { id: 'r1', title: 'Plot booking installment', size: 'Large', amount: 500000, addedByUid: 'demo-admin', addedByEmail: 'admin@crm.com', date: daysAgo(2) },
    { id: 'r2', title: 'Consultancy service fee', size: 'Small', amount: 75000, addedByUid: 'demo-admin', addedByEmail: 'admin@crm.com', date: daysAgo(5) },
  ];

  const committee: AccountRecord[] = [
    { id: 'c1', title: 'Committee payout Aug', amount: 150000, description: 'Monthly committee collection', addedByUid: 'demo-admin', addedByEmail: 'admin@crm.com', date: daysAgo(4) },
  ];

  const investments: AccountRecord[] = [
    { id: 'i1', title: 'Defense plots shares', amount: 1200000, description: 'Partnership share', addedByUid: 'demo-admin', addedByEmail: 'admin@crm.com', date: daysAgo(10) },
  ];

  const capitalInvestments: AccountRecord[] = [
    { id: 'ci1', title: 'Office computers upgrade', amount: 350000, description: 'Bought 3 core i7 systems', addedByUid: 'demo-admin', addedByEmail: 'admin@crm.com', date: daysAgo(15) },
  ];

  const personalExpenses: AccountRecord[] = [
    { id: 'pe1', title: 'Fuel for Usman Sheikh', amount: 18000, description: 'Usman travel expense', addedByUid: 'demo-admin', addedByEmail: 'admin@crm.com', date: daysAgo(1) },
    { id: 'pe2', title: 'Client dinner at Monal', amount: 24000, description: 'Client meeting dinner', addedByUid: 'demo-admin', addedByEmail: 'admin@crm.com', date: daysAgo(7) },
  ];

  const campaigns: CampaignRecord[] = [
    {
      id: '23851',
      name: 'DHA Phase 6 — Plot Enquiry',
      externalId: '23851',
      platform: 'Meta Ads',
      category: 'Real Estate / Plots',
      status: 'ACTIVE',
      startDate: daysAgo(30),
      endDate: null,
      budget: 150000,
      description: 'Facebook and Instagram lead gen campaign targeting DHA Phase 6 residential plots.',
      notes: 'High conversion rate from Lahore and Rawalpindi investors.',
      historicalLeadsCount: 0,
      historicalRevenue: 0,
      addedByUid: 'demo-admin',
      addedByEmail: 'admin@crm.com',
      createdAt: daysAgo(30),
    },
    {
      id: '23852',
      name: 'Bahria Town — Apartments',
      externalId: '23852',
      platform: 'Meta Ads',
      category: 'Real Estate / Apartments',
      status: 'ACTIVE',
      startDate: daysAgo(20),
      endDate: null,
      budget: 120000,
      description: 'Luxury 2-bed and 3-bed apartment promotion in Bahria Town.',
      notes: 'Targeting Karachi and Multan buyers.',
      historicalLeadsCount: 0,
      historicalRevenue: 0,
      addedByUid: 'demo-admin',
      addedByEmail: 'admin@crm.com',
      createdAt: daysAgo(20),
    },
    {
      id: '23853',
      name: 'Gulberg — Commercial Floors',
      externalId: '23853',
      platform: 'Meta Ads',
      category: 'Commercial Real Estate',
      status: 'ACTIVE',
      startDate: daysAgo(15),
      endDate: null,
      budget: 200000,
      description: 'High-end commercial floors and retail spaces in Gulberg III.',
      notes: 'Corporate clients and high net-worth investors.',
      historicalLeadsCount: 0,
      historicalRevenue: 0,
      addedByUid: 'demo-admin',
      addedByEmail: 'admin@crm.com',
      createdAt: daysAgo(15),
    },
    {
      id: 'old_camp_2025_q4',
      name: 'Q4 2025 Prime Housing Expo & Outdoor',
      externalId: 'EXPO-2025-Q4',
      platform: 'Print / Outdoor',
      category: 'Expo & Billboards',
      status: 'COMPLETED',
      startDate: daysAgo(90),
      endDate: daysAgo(45),
      budget: 350000,
      description: 'Major hoarding billboards on Main Boulevard and stall at Lahore Expo Center.',
      notes: 'Generated 42 historical leads and 3 closed commercial deals.',
      historicalLeadsCount: 42,
      historicalRevenue: 8500000,
      addedByUid: 'demo-admin',
      addedByEmail: 'admin@crm.com',
      createdAt: daysAgo(90),
    },
  ];

  // Two folders shaped like the owner's own examples, so the Data Bank has
  // something real to show: Capital Smart City with its four columns, and F2F
  // with a different set entirely — the whole point of per-folder fields.
  const dataBankFolders: DataBankFolder[] = [
    {
      id: 'folder_csc',
      name: 'Capital Smart City',
      code: 'CSC',
      description: 'Member list, 2024 registrations.',
      fields: [
        { key: 'member_name', label: 'Member Name' },
        { key: 'contact_number', label: 'Contact Number' },
        { key: 'address', label: 'Address' },
        { key: 'form_number', label: 'Form Number' },
      ],
      roles: { name: 'member_name', phone: 'contact_number' },
      columnMap: {},
      recordCount: 4,
      promotedCount: 1,
      createdAt: daysAgo(0),
    },
    {
      id: 'folder_f2f',
      name: 'Face to Face',
      code: 'F2F',
      description: 'Walk-ins and expo desks.',
      fields: [
        { key: 'full_name', label: 'Full Name' },
        { key: 'mobile', label: 'Mobile' },
        { key: 'city', label: 'City' },
        { key: 'interest', label: 'Interest' },
      ],
      roles: { name: 'full_name', phone: 'mobile' },
      columnMap: {},
      recordCount: 3,
      promotedCount: 0,
      createdAt: daysAgo(0),
    },
  ];

  const dataBankRecords: DataBankRecord[] = [
    {
      id: 'dbr_1', folderId: 'folder_csc', name: 'Tariq Mehmood', phone: '0300 4451122',
      phoneKey: '3004451122', status: 'NEW', notes: null, createdAt: daysAgo(0),
      values: { member_name: 'Tariq Mehmood', contact_number: '0300 4451122', address: 'House 12, Bahria Phase 4', form_number: 'CSC-10432' },
    },
    {
      id: 'dbr_2', folderId: 'folder_csc', name: 'Nadia Iqbal', phone: '0321 7788990',
      phoneKey: '3217788990', status: 'CONTACTED', notes: 'Asked to call back after Eid.', createdAt: daysAgo(0),
      values: { member_name: 'Nadia Iqbal', contact_number: '0321 7788990', address: 'Flat 9B, Gulberg III', form_number: 'CSC-10488' },
    },
    {
      id: 'dbr_3', folderId: 'folder_csc', name: 'Rehan Sheikh', phone: '0333 1122334',
      phoneKey: '3331122334', status: 'NOT_INTERESTED', notes: null, createdAt: daysAgo(0),
      values: { member_name: 'Rehan Sheikh', contact_number: '0333 1122334', address: 'Plot 55, DHA Phase 2', form_number: 'CSC-10501' },
    },
    {
      id: 'dbr_4', folderId: 'folder_csc', name: 'Saima Yousaf', phone: '0345 9988776',
      phoneKey: '3459988776', status: 'NEW', notes: null, createdAt: daysAgo(0),
      values: { member_name: 'Saima Yousaf', contact_number: '0345 9988776', address: 'Street 7, Johar Town', form_number: 'CSC-10555' },
    },
    {
      id: 'dbr_5', folderId: 'folder_f2f', name: 'Bilal Anwar', phone: '0301 2233445',
      phoneKey: '3012233445', status: 'NEW', notes: null, createdAt: daysAgo(0),
      values: { full_name: 'Bilal Anwar', mobile: '0301 2233445', city: 'Lahore', interest: '5 Marla' },
    },
    {
      id: 'dbr_6', folderId: 'folder_f2f', name: 'Hina Zafar', phone: '0308 5566778',
      phoneKey: '3085566778', status: 'NEW', notes: null, createdAt: daysAgo(0),
      values: { full_name: 'Hina Zafar', mobile: '0308 5566778', city: 'Islamabad', interest: 'Commercial' },
    },
    {
      id: 'dbr_7', folderId: 'folder_f2f', name: 'Kashif Raza', phone: '0312 4455667',
      phoneKey: '3124455667', status: 'CONTACTED', notes: null, createdAt: daysAgo(0),
      values: { full_name: 'Kashif Raza', mobile: '0312 4455667', city: 'Karachi', interest: '10 Marla' },
    },
  ];

  // One seeded folder, so the Clients screen demonstrates the reference model
  // rather than an empty state: these leads are in the folder *and* in the
  // pipeline — the same records in two places, exactly as §19 requires.
  const clientFolders: ClientFolder[] = [
    {
      id: 'cf_1',
      name: 'Interested Clients',
      description: 'Warm ones worth a second call this week.',
      color: null,
      subAdminUid: null,
      leadCount: 2,
      createdByUid: 'demo-admin',
      createdByName: 'Usman Sheikh',
      createdAt: daysAgo(6),
    },
  ];

  const clientFolderLeads: ClientFolderMember[] = [
    { id: 'cf_1__lead_1004', folderId: 'cf_1', leadId: 'lead_1004', leadName: 'Zainab Rashid', addedByUid: 'demo-admin', addedAt: daysAgo(6) },
    { id: 'cf_1__lead_1005', folderId: 'cf_1', leadId: 'lead_1005', leadName: 'Ahmed Raza', addedByUid: 'demo-admin', addedAt: daysAgo(5) },
  ];

  return { employees, kpiMonths, attendance, attendancePolicy: { ...DEFAULT_ATTENDANCE_POLICY, officeIps: ['198.51.100.7'] },
    leaveRequests: [
      {
        id: 'lv_1',
        uid: 'demo-emp-2',
        employeeName: 'Bilal Ahmed',
        subAdminUid: 'demo-sub-1',
        type: 'CASUAL',
        from: karachiDayKey(new Date()),
        to: karachiDayKey(new Date()),
        days: 1,
        reason: 'Family commitment.',
        status: 'PENDING',
        requestedByUid: 'demo-emp-2',
        // `ts(new Date())`, not `now()` — `now` is a const declared *after*
        // this function runs, so calling it from the seed is a temporal dead
        // zone error. It only shows up in a production build, where the seed
        // is evaluated during prerender.
        requestedAt: ts(new Date()),
        decidedByUid: null,
        decidedAt: null,
      },
    ],
    leaveAdjustments: {},
    attendancePeriods: {},
    payrollPeriods: {},
    payslips: {},
    expenseCategories: [], leads, followUps, events, deals, expenses, notifications, receivables, committee, investments, capitalInvestments, personalExpenses, campaigns, dataBankFolders, dataBankRecords, distributions: [], payouts: [], clientFolders, clientFolderLeads };
}

/* -------------------------------------------------------------------------- */
/* A minimal reactive store                                                    */
/* -------------------------------------------------------------------------- */

let state: DemoState = seed();
const listeners = new Set<() => void>();

function emit() {
  state = { ...state };
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useDemoState(): DemoState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  );
}

export function resetDemo() {
  state = seed();
  listeners.forEach((fn) => fn());
}

const now = () => ts(new Date());
let counter = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now()}_${counter++}`;

function addEvent(leadId: string, type: string, actorUid: string, meta: Record<string, unknown> = {}) {
  state.events[leadId] = [
    { id: nextId('ev'), type, actorUid, at: now(), meta },
    ...(state.events[leadId] ?? []),
  ];
}

function patchLead(leadId: string, patch: Partial<Lead>) {
  state.leads = state.leads.map((lead) => (lead.id === leadId ? { ...lead, ...patch } : lead));
}

/**
 * The in-memory stand-in for the `FieldValue.increment` writes the real
 * follow-up and deal transactions make against `users/{uid}/kpiMonths`.
 */
function bumpKpi(
  uid: string,
  month: string,
  delta: Partial<KpiCounts>,
  portfolioCategory?: string
) {
  const forUser = state.kpiMonths[uid] ?? {};
  const existing = forUser[month] ?? { ...EMPTY_KPI_COUNTS, monthKey: month, portfolio: {} };

  const portfolio = { ...existing.portfolio };
  if (portfolioCategory) {
    portfolio[portfolioCategory] = (portfolio[portfolioCategory] ?? 0) + (delta.revenue ?? 0);
  }

  state.kpiMonths = {
    ...state.kpiMonths,
    [uid]: {
      ...forUser,
      [month]: {
        monthKey: month,
        calls: existing.calls + (delta.calls ?? 0),
        connects: existing.connects + (delta.connects ?? 0),
        registrations: existing.registrations + (delta.registrations ?? 0),
        meetings: existing.meetings + (delta.meetings ?? 0),
        revenue: existing.revenue + (delta.revenue ?? 0),
        portfolio,
      },
    },
  };
}

/** Keeps the roster in the order the real Firestore query returns it in. */
function sortEmployees() {
  state.employees = [...state.employees].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.name.localeCompare(b.name);
  });
}

/* -------------------------------------------------------------------------- */
/* Mutations — same shapes the real Server Actions return                      */
/* -------------------------------------------------------------------------- */

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });

export const demo = {
  assignLead(leadId: string, userId: string, actorUid: string): Result {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return fail('That lead no longer exists.');
    if (lead.status !== 'NEW' && lead.status !== 'UNASSIGNED_NO_CAPACITY') {
      return fail('This lead has already been assigned. Use Reassign instead.');
    }
    // Admin assignment is a force accept — no window, nothing to decline.
    patchLead(leadId, {
      assignedUserId: userId, assignedAt: now(), acceptedAt: now(), lastActivityAt: now(),
      status: 'ACCEPTED', distributionMethod: 'MANUAL',
      acceptDeadlineAt: undefined, adminAssignDeadlineAt: undefined,
      attemptedAssignees: [...(lead.attemptedAssignees ?? []), userId],
    });
    addEvent(leadId, 'MANUALLY_ASSIGNED', actorUid, { assignedTo: userId });
    emit();
    return ok(undefined);
  },

  reassignLead(leadId: string, userId: string, actorUid: string): Result {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return fail('That lead no longer exists.');
    if (lead.assignedUserId === userId) return fail('This lead is already assigned to that employee.');
    patchLead(leadId, {
      assignedUserId: userId, assignedAt: now(), lastActivityAt: now(),
      status: 'ACCEPTED', distributionMethod: 'MANUAL',
      acceptedAt: now(), acceptDeadlineAt: undefined,
      attemptedAssignees: [userId],
    });
    addEvent(leadId, 'MANUALLY_REASSIGNED', actorUid, { previousAssignee: lead.assignedUserId, newAssignee: userId });
    emit();
    return ok(undefined);
  },

  acceptLead(leadId: string, actorUid: string): Result {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return fail('That lead no longer exists.');
    const session = getDemoSession();
    if (session?.role !== 'admin' && lead.assignedUserId !== actorUid) {
      return fail('This lead is not assigned to you.');
    }
    if (lead.status !== 'ASSIGNED') return fail('This lead is not waiting to be accepted.');
    patchLead(leadId, { status: 'ACCEPTED', acceptedAt: now(), lastActivityAt: now(), acceptDeadlineAt: undefined });
    addEvent(leadId, 'LEAD_ACCEPTED', actorUid);
    emit();
    return ok(undefined);
  },

  setLeadStatus(leadId: string, status: Lead['status'], actorUid: string): Result {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return fail('That lead no longer exists.');
    if (lead.status === 'ASSIGNED') return fail('Accept this lead before updating its status.');
    patchLead(leadId, {
      status,
      // Stamped one-way the first time token money arrives — the status moves
      // on to Deal Closed, the fact that a token was taken does not. Mirrors
      // the server so the report counts the same thing in both modes.
      ...(status === 'TOKEN_RECEIVED' && !lead.tokenReceivedAt
        ? { tokenReceived: true, tokenReceivedAt: ts(new Date()) }
        : {}),
    });
    addEvent(leadId, 'STATUS_CHANGED', actorUid, { from: lead.status, to: status });
    emit();
    return ok(undefined);
  },

  /** Mirrors `setLeadPipelineStage`: stores only the manual pin, never the rule. */
  setLeadPipelineStage(leadId: string, stage: PipelineStage | null, actorUid: string): Result {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return fail('That lead no longer exists.');
    if (stage !== null && !PIPELINE_STAGES.includes(stage)) {
      return fail('Choose Cold, P3, P2 or P1 — or Auto to follow the rule.');
    }
    if (isTerminal(lead.status)) {
      return fail('This lead is closed — its pipeline stage no longer applies.');
    }
    const current = lead.pipelineStageOverride ?? null;
    if (current === stage) return ok(undefined);

    patchLead(leadId, { pipelineStageOverride: stage ?? undefined, temperatureOverride: undefined });
    addEvent(leadId, 'PIPELINE_STAGE_CHANGED', actorUid, {
      from: current ?? 'auto',
      to: stage ?? 'auto',
    });
    emit();
    return ok(undefined);
  },

  /** Mirrors `saveKyc`, mirrored columns and all. */
  saveKyc(leadId: string, values: KycValues, actorUid: string): Result<{ values: KycValues }> {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return fail('That lead no longer exists.');

    const { values: clean, errors } = validateKyc(values ?? {});
    if (errors.length > 0) return fail(errors[0]);

    const mirrored = leadPatchFromKyc(clean);
    const changed = Object.entries(mirrored)
      .filter(([field, value]) => (lead as unknown as Record<string, unknown>)[field] !== value)
      .map(([field]) => field);

    patchLead(leadId, { kyc: clean, kycUpdatedAt: now(), kycUpdatedByUid: actorUid, ...mirrored });
    addEvent(leadId, 'KYC_UPDATED', actorUid, {
      fieldsFilled: Object.keys(clean).length,
      leadFieldsUpdated: changed,
    });
    emit();
    return ok({ values: clean });
  },

  /** Mirrors `finalizeProfitDistribution`, including the supersede-not-delete rule. */
  finalizeProfitDistribution(
    dealId: string,
    shares: Array<{ recipientUid: string | null; recipientRole: 'employee' | 'subadmin' | 'company'; kind: DistributionShare['kind']; percentage: number }>,
    actorUid: string
  ): Result<{ distributionId: string; netProfit: number; distributedAmount: number; companyTotalAmount: number }> {
    const deal = state.deals.find((d) => d.id === dealId);
    if (!deal) return fail('That deal no longer exists.');

    const prepared: DistributionShare[] = shares.map((share) => ({
      recipientUid: share.recipientUid,
      recipientRole: share.recipientRole,
      kind: share.kind,
      recipientName:
        share.recipientRole === 'company'
          ? 'Company'
          : state.employees.find((e) => e.uid === share.recipientUid)?.name ?? 'Unknown',
      percentage: share.percentage,
    }));

    const result = calculateDistribution(deal.profit, prepared);
    if (!result.valid) return fail(result.errors[0]);

    state.distributions = state.distributions.map((d) =>
      d.dealId === dealId ? { ...d, current: false } : d
    );
    state.payouts = state.payouts.map((row) =>
      row.dealId === dealId ? { ...row, current: false } : row
    );

    const id = nextId('dist');
    state.distributions = [
      {
        id,
        dealId,
        leadId: deal.leadId,
        employeeUid: deal.userId ?? null,
        subAdminUid: state.employees.find((e) => e.uid === deal.userId)?.subAdminUid ?? null,
        customerName: deal.customer?.name ?? null,
        amountReceived: deal.amountReceived,
        payableAmount: deal.payableAmount,
        netProfit: result.netProfit,
        lines: result.lines,
        distributedPercentage: result.distributedPercentage,
        distributedAmount: result.distributedAmount,
        remainingPercentage: result.remainingPercentage,
        remainingAmount: result.remainingAmount,
        companyBaseAmount: result.companyBaseAmount,
        companyTotalAmount: result.companyTotalAmount,
        finalizedByUid: actorUid,
        finalizedAt: now(),
        current: true,
      },
      ...state.distributions,
    ];

    for (const line of result.lines) {
      if (line.recipientRole === 'company' || !line.recipientUid) continue;
      state.payouts = [
        {
          id: nextId('pay'),
          dealId,
          leadId: deal.leadId,
          distributionId: id,
          recipientUid: line.recipientUid,
          recipientName: line.recipientName,
          recipientRole: line.recipientRole,
          kind: line.kind,
          subAdminUid:
            line.recipientRole === 'subadmin'
              ? line.recipientUid
              : state.employees.find((e) => e.uid === line.recipientUid)?.subAdminUid ?? null,
          percentage: line.percentage,
          amount: line.amount,
          netProfit: result.netProfit,
          customerName: deal.customer?.name ?? null,
          finalizedAt: now(),
          current: true,
        },
        ...state.payouts,
      ];
    }

    state.deals = state.deals.map((d) =>
      d.id === dealId ? { ...d, distributionStatus: 'FINALIZED', distributionId: id } : d
    );
    emit();

    return ok({
      distributionId: id,
      netProfit: result.netProfit,
      distributedAmount: result.distributedAmount,
      companyTotalAmount: result.companyTotalAmount,
    });
  },

  reopenProfitDistribution(dealId: string): Result {
    state.deals = state.deals.map((d) =>
      d.id === dealId ? { ...d, distributionStatus: 'PENDING' } : d
    );
    emit();
    return ok(undefined);
  },

  setEmployeeSubAdmin(employeeUid: string, subAdminUid: string | null): Result<{ moved: string | null }> {
    state.employees = state.employees.map((e) =>
      e.uid === employeeUid ? { ...e, subAdminUid } : e
    );
    state.leads = state.leads.map((lead) =>
      lead.assignedUserId === employeeUid ? { ...lead, subAdminUid } : lead
    );
    emit();
    return ok({ moved: subAdminUid });
  },

  setSubAdminTeam(subAdminUid: string, employeeUids: string[]): Result<{ added: number; removed: number }> {
    const wanted = new Set(employeeUids);
    let added = 0;
    let removed = 0;

    state.employees = state.employees.map((employee) => {
      if (employee.accessRole === 'subadmin') return employee;
      const has = employee.subAdminUid === subAdminUid;
      if (wanted.has(employee.uid) && !has) {
        added += 1;
        return { ...employee, subAdminUid };
      }
      if (!wanted.has(employee.uid) && has) {
        removed += 1;
        return { ...employee, subAdminUid: null };
      }
      return employee;
    });

    const teamUids = new Set(
      state.employees.filter((e) => e.subAdminUid === subAdminUid).map((e) => e.uid)
    );
    state.leads = state.leads.map((lead) =>
      lead.assignedUserId && (teamUids.has(lead.assignedUserId) || lead.subAdminUid === subAdminUid)
        ? { ...lead, subAdminUid: teamUids.has(lead.assignedUserId) ? subAdminUid : null }
        : lead
    );

    emit();
    return ok({ added, removed });
  },

  addFollowUp(
    leadId: string,
    input: {
      message: string; callMade: boolean; callCount?: number;
      durationSeconds?: number; meetingHeld?: boolean;
      whatsappNote?: string; occurredAt?: string; siteVisit?: boolean;
    },
    actorUid: string,
    actorEmail: string
  ): Result<{ followUpId: string; connect: boolean; kind: 'REMARK' | 'FOLLOW_UP' }> {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return fail('That lead no longer exists.');
    if (lead.status === 'ASSIGNED') return fail('Accept this lead before logging a remark.');

    const occurred = input.occurredAt ? new Date(input.occurredAt) : new Date();
    const dayKey = karachiDayKey(occurred);
    const isAdmin = getDemoSession()?.role !== 'employee';

    // Mirrors the server rule exactly (§1): day one takes a Remark and a
    // Follow-Up, every later day takes one Follow-Up. Shared code, so the demo
    // cannot demonstrate a rule the product does not have.
    const existing = state.followUps[leadId] ?? [];
    const allowance = entryAllowance(
      existing.length,
      existing.filter((f) => f.dayKey === dayKey).length,
      existing.length > 0
    );
    if (!allowance.allowed && !isAdmin) return fail(allowance.reason!);

    const calls = input.callMade ? Math.max(1, Number(input.callCount) || 1) : 0;
    const durationSeconds = input.callMade ? normalizeDurationSeconds(input.durationSeconds) : 0;
    if (input.callMade && durationSeconds === 0) {
      return fail('Enter how long the call lasted — it decides whether this counts as a connect.');
    }

    const connect = Boolean(input.callMade) && isConnect(durationSeconds);
    const meetingHeld = Boolean(input.meetingHeld);
    const siteVisit = Boolean(input.siteVisit);
    const id = nextId('fu');

    state.followUps[leadId] = [
      { id, kind: allowance.kind, message: input.message, callMade: input.callMade, callCount: calls,
        durationSeconds, connect, meetingHeld, siteVisit, dayKey,
        whatsappNote: input.whatsappNote || null, occurredAt: ts(occurred), createdAt: now(),
        authorUid: actorUid, authorEmail: actorEmail, creditUid: lead.assignedUserId ?? actorUid,
        revisions: [] },
      ...existing,
    ];
    patchLead(leadId, {
      followUpCount: (lead.followUpCount ?? 0) + 1,
      callCount: (lead.callCount ?? 0) + calls,
      lastActivityAt: now(),
      // Same one-way flag the real transaction writes: a meeting that happened
      // stays happened, and it lifts the lead to P2.
      ...(meetingHeld ? { meetingHeld: true } : {}),
      ...(siteVisit ? { siteVisit: true } : {}),
      siteVisitCount: (lead.siteVisitCount ?? 0) + (siteVisit ? 1 : 0),
      connectCount: (lead.connectCount ?? 0) + (connect ? 1 : 0),
      meetingCount: (lead.meetingCount ?? 0) + (meetingHeld ? 1 : 0),
      latestFollowUpId: id,
    });
    if (lead.assignedUserId) {
      bumpKpi(lead.assignedUserId, karachiMonthKey(occurred), {
        calls: input.callMade ? 1 : 0,
        connects: connect ? 1 : 0,
        meetings: meetingHeld ? 1 : 0,
      });
    }
    addEvent(leadId, allowance.kind === 'REMARK' ? 'REMARK_ADDED' : 'FOLLOW_UP_ADDED', actorUid, {
      followUpId: id, kind: allowance.kind, callMade: input.callMade, callCount: calls,
      durationSeconds, connect, meetingHeld, siteVisit,
    });

    // §3 — the cold rule raises a review rather than writing off the lead.
    const nextCount = (lead.followUpCount ?? 0) + 1;
    if (
      meetsColdRule({ status: lead.status, followUpCount: nextCount }) &&
      !lead.coldReviewRequestedAt &&
      !lead.pipelineStageOverride
    ) {
      patchLead(leadId, { coldReviewRequestedAt: now() });
      const message = `${lead.name} has had ${nextCount} follow-ups with no progress. Lead requires verification before being moved to Cold.`;
      state.notifications = [
        { id: nextId('n'), type: 'COLD_REVIEW_REQUIRED', leadId, targetRole: 'admin',
          payload: { message }, createdAt: now(), readAt: null },
        ...(lead.subAdminUid
          ? [{ id: nextId('n'), type: 'COLD_REVIEW_REQUIRED', leadId, targetRole: 'subadmin',
              targetUid: lead.subAdminUid, payload: { message }, createdAt: now(), readAt: null }]
          : []),
        ...state.notifications,
      ];
    }

    emit();
    return ok({ followUpId: id, connect, kind: allowance.kind });
  },

  /** Mirrors `updateFollowUp`: newest entry only, previous values kept. */
  updateFollowUp(
    leadId: string,
    followUpId: string,
    input: {
      message?: string; callMade?: boolean; callCount?: number;
      durationSeconds?: number; meetingHeld?: boolean; siteVisit?: boolean; whatsappNote?: string;
    },
    actorUid: string,
    actorEmail: string
  ): Result<{ connect: boolean }> {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return fail('That lead no longer exists.');

    const entries = state.followUps[leadId] ?? [];
    const entry = entries.find((f) => f.id === followUpId);
    if (!entry) return fail('That entry no longer exists.');

    if (lead.latestFollowUpId && lead.latestFollowUpId !== followUpId) {
      return fail('Only the latest entry can be edited. Older ones are part of the permanent record.');
    }

    const message = input.message === undefined ? entry.message : input.message.trim();
    if (!message) return fail('Write what happened before saving.');

    const callMade = input.callMade === undefined ? Boolean(entry.callMade) : Boolean(input.callMade);
    const callCount = callMade
      ? Math.max(1, Number(input.callCount === undefined ? entry.callCount : input.callCount) || 1)
      : 0;
    const durationSeconds = callMade
      ? normalizeDurationSeconds(
          input.durationSeconds === undefined ? entry.durationSeconds : input.durationSeconds
        )
      : 0;
    if (callMade && durationSeconds === 0) {
      return fail('Enter how long the call lasted — it decides whether this counts as a connect.');
    }

    const connect = callMade && isConnect(durationSeconds);
    const meetingHeld = input.meetingHeld === undefined ? Boolean(entry.meetingHeld) : Boolean(input.meetingHeld);
    const siteVisit = input.siteVisit === undefined ? Boolean(entry.siteVisit) : Boolean(input.siteVisit);

    const revision = {
      message: entry.message, callMade: Boolean(entry.callMade), callCount: entry.callCount ?? 0,
      durationSeconds: entry.durationSeconds ?? 0, connect: Boolean(entry.connect),
      meetingHeld: Boolean(entry.meetingHeld), siteVisit: Boolean(entry.siteVisit),
      whatsappNote: entry.whatsappNote ?? null,
      editedByUid: actorUid, editedByEmail: actorEmail, editedAt: now(),
    };

    state.followUps[leadId] = entries.map((f) =>
      f.id === followUpId
        ? {
            ...f, message, callMade, callCount, durationSeconds, connect, meetingHeld, siteVisit,
            whatsappNote:
              input.whatsappNote === undefined ? (f.whatsappNote ?? null) : input.whatsappNote.trim() || null,
            revisions: [...(f.revisions ?? []), revision],
            editedAt: now(), editedByUid: actorUid,
          }
        : f
    );

    patchLead(leadId, {
      lastActivityAt: now(),
      callCount: (lead.callCount ?? 0) + (callCount - (entry.callCount ?? 0)),
      connectCount: (lead.connectCount ?? 0) + ((connect ? 1 : 0) - (entry.connect ? 1 : 0)),
      meetingCount: (lead.meetingCount ?? 0) + ((meetingHeld ? 1 : 0) - (entry.meetingHeld ? 1 : 0)),
      siteVisitCount: (lead.siteVisitCount ?? 0) + ((siteVisit ? 1 : 0) - (entry.siteVisit ? 1 : 0)),
      ...(meetingHeld ? { meetingHeld: true } : {}),
      ...(siteVisit ? { siteVisit: true } : {}),
    });

    addEvent(leadId, 'FOLLOW_UP_EDITED', actorUid, { followUpId, connect, meetingHeld, siteVisit });
    emit();
    return ok({ connect });
  },

  /**
   * Mirrors `buildTeamReport` over the in-memory store — same subjects, same
   * columns, same no-double-counting rule, so demo mode and the live project
   * cannot disagree about what a report means.
   */
  buildTeamReport(from: string, to: string, actorUid: string, subjectId?: string | null) {
    const session = getDemoSession();
    const role = session?.role ?? 'admin';

    const people: ReportPerson[] = state.employees
      .map((employee) => ({
        uid: employee.uid,
        name: employee.name,
        role: (employee.accessRole === 'subadmin' ? 'subadmin' : 'employee') as ReportPerson['role'],
        subAdminUid: employee.subAdminUid ?? null,
      }))
      .filter((person) => {
        if (role === 'admin') return true;
        if (role === 'subadmin') return person.uid === actorUid || person.subAdminUid === actorUid;
        return person.uid === actorUid;
      });

    // The admin is a subject like anybody else — their own activity.
    if (role === 'admin') {
      const admin = DEMO_ACCOUNTS.find((account) => account.role === 'admin');
      if (admin && !people.some((person) => person.uid === admin.uid)) {
        people.push({ uid: admin.uid, name: admin.name, role: 'admin', subAdminUid: null });
      }
    }

    const options = demoReportOptions(people, actorUid);
    const valid = new Set(options.map((option) => option.value));
    let subject = parseSubject(subjectId);
    if (!valid.has(subject.id)) subject = parseSubject(options[0]?.value ?? ALL_EMPLOYEES);

    const subjectPeople = rowsForSubject(people, subject);
    const managerNames = new Map(
      people.filter((person) => person.role === 'subadmin').map((person) => [person.uid, person.name])
    );

    const rows = subjectPeople.map((person) => {
      const metrics = blankMetrics();

      for (const [leadId, entries] of Object.entries(state.followUps)) {
        const lead = state.leads.find((row) => row.id === leadId);
        if (!lead || lead.assignedUserId !== person.uid) continue;

        for (const entry of entries) {
          const day = entry.dayKey ?? '';
          if (!day || day < from || day > to) continue;
          if (entry.connect) {
            if (entry.kind === 'REMARK') metrics.newConnects += 1;
            else metrics.followUpConnects += 1;
          }
          if (entry.meetingHeld) metrics.meetings += 1;
          if (entry.siteVisit) metrics.siteVisits += 1;
        }
      }

      for (const lead of state.leads) {
        if (lead.assignedUserId !== person.uid) continue;

        const stage = pipelineStage(lead).value;
        if (stage === 'P3') metrics.p3 += 1;
        else if (stage === 'P2') metrics.p2 += 1;
        else if (stage === 'P1') metrics.p1 += 1;

        const tokenDay = lead.tokenReceivedAt ? karachiDayKey(toDate(lead.tokenReceivedAt)) : null;
        if (tokenDay && tokenDay >= from && tokenDay <= to) metrics.tokensReceived += 1;
        else if (!tokenDay && lead.status === 'TOKEN_RECEIVED') metrics.tokensReceived += 1;
      }

      for (const deal of state.deals) {
        if (deal.userId !== person.uid) continue;
        const day = karachiDayKey(toDate(deal.dealDate ?? deal.enteredAt));
        if (day >= from && day <= to) metrics.dealsClosed += 1;
      }

      return {
        uid: person.uid,
        id: shortId(person.uid),
        name: person.name,
        role: person.role,
        team: teamLabel(person, managerNames),
        ...metrics,
      };
    });

    return ok({
      from,
      to,
      subject: subject.id,
      subjectLabel: describeSubject(people, subject),
      rows,
      totals: sumMetrics(
        rows.map((row) => ({
          newConnects: row.newConnects,
          followUpConnects: row.followUpConnects,
          meetings: row.meetings,
          siteVisits: row.siteVisits,
          dealsClosed: row.dealsClosed,
          tokensReceived: row.tokensReceived,
          p1: row.p1,
          p2: row.p2,
          p3: row.p3,
        }))
      ),
      options,
      warning: null,
    });
  },

  /* ---------------------------------------------------------------- */
  /* Client folders (§15–§20)                                          */
  /* ---------------------------------------------------------------- */

  createClientFolder(input: { name: string; description?: string | null }, actorUid: string): Result<{ folderId: string }> {
    const name = input.name.trim();
    if (!name) return fail('Give the folder a name.');

    const id = nextId('cf');
    const session = getDemoSession();
    state.clientFolders = [
      ...state.clientFolders,
      {
        id,
        name,
        description: input.description?.trim() || null,
        color: null,
        subAdminUid: session?.role === 'subadmin' ? session.uid : null,
        leadCount: 0,
        createdByUid: actorUid,
        createdByName: session?.name ?? null,
        createdAt: now(),
      },
    ];
    emit();
    return ok({ folderId: id });
  },

  updateClientFolder(folderId: string, input: { name?: string; description?: string | null }): Result {
    state.clientFolders = state.clientFolders.map((folder) =>
      folder.id === folderId
        ? {
            ...folder,
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
          }
        : folder
    );
    emit();
    return ok(undefined);
  },

  deleteClientFolder(folderId: string): Result<{ removed: number }> {
    const removed = state.clientFolderLeads.filter((row) => row.folderId === folderId).length;
    state.clientFolderLeads = state.clientFolderLeads.filter((row) => row.folderId !== folderId);
    state.clientFolders = state.clientFolders.filter((folder) => folder.id !== folderId);
    emit();
    // The leads themselves are untouched — a folder is a view, not a container.
    return ok({ removed });
  },

  addLeadsToClientFolder(folderId: string, leadIds: string[]): Result<{ added: number; alreadyThere: number }> {
    let added = 0;
    let alreadyThere = 0;

    for (const leadId of [...new Set(leadIds)]) {
      const id = `${folderId}__${leadId}`;
      if (state.clientFolderLeads.some((row) => row.id === id)) {
        alreadyThere += 1;
        continue;
      }
      const lead = state.leads.find((l) => l.id === leadId);
      if (!lead) continue;

      state.clientFolderLeads = [
        { id, folderId, leadId, leadName: lead.name, addedByUid: 'demo-admin', addedAt: now() },
        ...state.clientFolderLeads,
      ];
      added += 1;
    }

    state.clientFolders = state.clientFolders.map((folder) =>
      folder.id === folderId ? { ...folder, leadCount: folder.leadCount + added } : folder
    );
    emit();
    return ok({ added, alreadyThere });
  },

  removeLeadFromClientFolder(folderId: string, leadId: string): Result {
    const id = `${folderId}__${leadId}`;
    const existed = state.clientFolderLeads.some((row) => row.id === id);
    state.clientFolderLeads = state.clientFolderLeads.filter((row) => row.id !== id);
    if (existed) {
      state.clientFolders = state.clientFolders.map((folder) =>
        folder.id === folderId ? { ...folder, leadCount: Math.max(0, folder.leadCount - 1) } : folder
      );
    }
    emit();
    return ok(undefined);
  },

  /** Mirrors `reviewColdLead` (§3). */
  reviewColdLead(leadId: string, verified: boolean, actorUid: string): Result {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return fail('That lead no longer exists.');
    if (isTerminal(lead.status)) return fail('This lead is already closed.');

    patchLead(leadId, {
      pipelineStageOverride: verified ? 'COLD' : undefined,
      coldReviewRequestedAt: undefined,
    });
    addEvent(leadId, verified ? 'COLD_VERIFIED' : 'COLD_REVIEW_DISMISSED', actorUid, {
      followUpCount: lead.followUpCount ?? 0,
    });
    emit();
    return ok(undefined);
  },

  /** Mirrors `assignLeadsBulk`: moves the assignment, never copies a lead. */
  assignLeadsBulk(leadIds: string[], userId: string, actorUid: string): Result<{ assigned: number; skipped: number }> {
    const employee = state.employees.find((e) => e.uid === userId);
    if (!employee) return fail('Choose a team member to assign these to.');

    let assigned = 0;
    let skipped = 0;

    state.leads = state.leads.map((lead) => {
      if (!leadIds.includes(lead.id)) return lead;
      if (isTerminal(lead.status) || lead.assignedUserId === userId) {
        skipped += 1;
        return lead;
      }
      assigned += 1;
      return {
        ...lead,
        assignedUserId: userId,
        assigneeName: employee.name,
        subAdminUid: employee.subAdminUid ?? null,
        assignedAt: now(),
        acceptedAt: now(),
        lastActivityAt: now(),
        status: 'ACCEPTED' as const,
        distributionMethod: 'MANUAL' as const,
        acceptDeadlineAt: undefined,
        attemptedAssignees: [userId],
        assignedByUid: actorUid,
      };
    });

    for (const id of leadIds) addEvent(id, 'BULK_ASSIGNED', actorUid, { newAssignee: userId });
    emit();
    return ok({ assigned, skipped });
  },

  closeDeal(
    leadId: string,
    input: {
      customer: { name: string; phone: string; email?: string; cnic?: string; address?: string; city?: string };
      serviceDescription: string; amountReceived: number; payableAmount: number;
      paymentMethod?: string; dealCategory?: string; dealDate?: string; notes?: string;
    },
    actorUid: string
  ): Result<{ dealId: string; profit: number }> {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return fail('That lead no longer exists.');
    if (state.deals.some((d) => d.leadId === leadId)) return fail('This deal has already been entered.');
    if (!input.customer.name.trim()) return fail("Enter the customer's name.");
    if (!input.customer.phone.trim()) return fail('Enter a valid contact number for the customer.');
    if (!input.serviceDescription.trim()) return fail('Describe what was sold, so the record makes sense later.');
    if (!Number.isFinite(input.amountReceived) || !Number.isFinite(input.payableAmount)) {
      return fail('Enter a valid amount.');
    }

    const profit = input.amountReceived - input.payableAmount;
    const dealCategory = normalizeDealCategory(input.dealCategory);
    const dealDate = input.dealDate ? new Date(`${input.dealDate}T12:00:00`) : new Date();
    state.deals = [
      {
        id: leadId, leadId, userId: lead.assignedUserId ?? actorUid, enteredByUid: actorUid,
        customer: {
          name: input.customer.name.trim(),
          phone: input.customer.phone.replace(/\D/g, ''),
          email: input.customer.email?.trim() || null,
          cnic: input.customer.cnic?.trim() || null,
          address: input.customer.address?.trim() || null,
          city: input.customer.city?.trim() || null,
        },
        serviceDescription: input.serviceDescription.trim(),
        paymentMethod: input.paymentMethod || 'Cash',
        dealCategory,
        notes: input.notes?.trim() || null,
        amountReceived: input.amountReceived, payableAmount: input.payableAmount, profit,
        campaignId: lead.campaignId ?? null, campaignName: lead.campaignName ?? null,
        subAdminUid: state.employees.find((e) => e.uid === lead.assignedUserId)?.subAdminUid ?? null,
        distributionStatus: 'PENDING',
        dealDate: ts(dealDate),
        enteredAt: now(),
      },
      ...state.deals,
    ];
    // The admin has to be told a deal is waiting to be split — nothing else on
    // any screen would surface it.
    state.notifications = [
      {
        id: nextId('n'),
        type: 'DEAL_CLOSED_REVIEW',
        leadId,
        targetRole: 'admin',
        payload: {
          message: `${input.customer.name.trim()} closed — net profit ${profit.toLocaleString('en-PK')}. Finalize Profit Distribution.`,
        },
        createdAt: now(),
        readAt: null,
      },
      ...state.notifications,
    ];
    patchLead(leadId, { status: 'CLOSED_WON', closedAt: now() });
    bumpKpi(lead.assignedUserId ?? actorUid, karachiMonthKey(dealDate), {
      registrations: 1,
      revenue: input.amountReceived,
    }, dealCategory);
    addEvent(leadId, 'DEAL_CLOSED', actorUid, { dealId: leadId, profit });
    emit();
    return ok({ dealId: leadId, profit });
  },

  addExpense(input: { title: string; category: string; amount: number; description?: string; date?: string }, actorUid: string): Result<{ expenseId: string }> {
    if (!input.title.trim()) return fail('Give the expense a title.');
    if (!Number.isFinite(input.amount) || input.amount <= 0) return fail('Enter an amount greater than zero.');
    const id = nextId('x');
    state.expenses = [
      { id, title: input.title.trim(), category: input.category, amount: input.amount,
        description: input.description?.trim() || null, addedByUid: actorUid,
        date: input.date ? ts(new Date(`${input.date}T12:00:00`)) : now() },
      ...state.expenses,
    ];
    emit();
    return ok({ expenseId: id });
  },

  createEmployee(input: { name: string; email: string; password: string; priority: number; jobTitle?: string; status?: 'ACTIVE' | 'DISABLED'; targets?: Partial<KpiTargets>; phone?: string | null; notes?: string | null; joinedAt?: string | null; autoAssign?: boolean; accessRole?: 'employee' | 'subadmin'; subAdminUid?: string | null; managerKind?: 'SALES' | 'HR'; monthlySalary?: number }): Result<{ uid: string }> {
    if (!input.name.trim()) return fail("Enter the employee's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return fail('Enter a valid email address.');
    if (input.password.length < 8) return fail('The password must be at least 8 characters.');
    if (state.employees.some((e) => e.email === input.email.toLowerCase())) {
      return fail('An account with that email already exists.');
    }
    const uid = nextId('emp');
    state.employees = [...state.employees, {
      uid, name: input.name.trim(), email: input.email.toLowerCase(),
      priority: input.priority,
      status: input.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
      jobTitle: normalizeJobTitle(input.jobTitle),
      accessRole: input.accessRole === 'subadmin' ? 'subadmin' : 'employee',
      subAdminUid: input.accessRole === 'subadmin' ? null : (input.subAdminUid ?? null),
      targets: { ...DEFAULT_KPI_TARGETS, ...(input.targets ?? {}) },
      phone: input.phone?.trim() || null,
      notes: input.notes?.trim() || null,
      joinedAt: input.joinedAt ? ts(new Date(input.joinedAt)) : null,
      ...(input.autoAssign === false ? { autoAssign: false } : {}),
      ...(input.accessRole === 'subadmin' ? { managerKind: input.managerKind ?? 'SALES' } : {}),
      monthlySalary: Math.max(0, Math.round(input.monthlySalary ?? 0)),
      autoPriority: true,
      createdAt: now(),
    }];
    emit();
    return ok({ uid });
  },

  updateEmployee(uid: string, input: { name?: string; email?: string; password?: string; priority?: number; jobTitle?: string; targets?: Partial<KpiTargets>; phone?: string | null; notes?: string | null; joinedAt?: string | null; autoAssign?: boolean; accessRole?: 'employee' | 'subadmin'; subAdminUid?: string | null; managerKind?: 'SALES' | 'HR'; monthlySalary?: number }): Result {
    if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return fail('Enter a valid email address.');
    if (input.password && input.password.length < 8) return fail('The password must be at least 8 characters.');
    
    state.employees = state.employees.map((e) => {
      if (e.uid === uid) {
        return {
          ...e,
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
          // Setting a priority by hand pins it, exactly as the server does.
          ...(input.priority !== undefined ? { priority: input.priority, autoPriority: false } : {}),
          ...(input.jobTitle !== undefined ? { jobTitle: normalizeJobTitle(input.jobTitle) } : {}),
          ...(input.targets !== undefined
            ? { targets: { ...DEFAULT_KPI_TARGETS, ...e.targets, ...input.targets } }
            : {}),
          // Directory fields, each written only when the caller sent it, so a
          // partial edit does not blank what it left out.
          ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
          ...(input.joinedAt !== undefined
            ? { joinedAt: input.joinedAt ? ts(new Date(input.joinedAt)) : null }
            : {}),
          ...(input.managerKind !== undefined ? { managerKind: input.managerKind } : {}),
          ...(input.monthlySalary !== undefined
            ? { monthlySalary: Math.max(0, Math.round(input.monthlySalary)) }
            : {}),
          ...(input.autoAssign !== undefined ? { autoAssign: input.autoAssign } : {}),
          // The hierarchy, mirroring the server: promoting somebody to sub
          // admin clears their own manager, because the tree is two levels deep.
          ...(input.accessRole !== undefined
            ? { accessRole: input.accessRole, ...(input.accessRole === 'subadmin' ? { subAdminUid: null } : {}) }
            : {}),
          ...(input.subAdminUid !== undefined && input.accessRole !== 'subadmin'
            ? { subAdminUid: input.subAdminUid }
            : {}),
        };
      }
      return e;
    });

    sortEmployees();
    emit();
    return ok(undefined);
  },

  setEmployeePriority(uid: string, priority: number): Result {
    state.employees = state.employees.map((e) =>
      e.uid === uid ? { ...e, priority, autoPriority: false } : e
    );
    sortEmployees();
    emit();
    return ok(undefined);
  },

  setEmployeeAutoPriority(uid: string, auto: boolean): Result {
    state.employees = state.employees.map((e) => (e.uid === uid ? { ...e, autoPriority: auto } : e));
    emit();
    return ok(undefined);
  },

  setEmployeeTargets(uid: string, targets: Partial<KpiTargets>): Result<{ targets: KpiTargets }> {
    const next: KpiTargets = { ...DEFAULT_KPI_TARGETS, ...targets };
    state.employees = state.employees.map((e) => (e.uid === uid ? { ...e, targets: next } : e));
    emit();
    return ok({ targets: next });
  },

  recalculateEmployeePriorities(): Result<{
    changes: Array<{ uid: string; name: string; from: number; to: number; score: number }>;
    evaluated: number;
  }> {
    const month = karachiMonthKey();
    const auto = state.employees.filter((e) => e.status === 'ACTIVE' && e.autoPriority !== false);

    const scored = auto.map((employee) => {
      const counts: KpiCounts = {
        ...EMPTY_KPI_COUNTS,
        ...(state.kpiMonths[employee.uid]?.[month] ?? {}),
      };
      return {
        employee,
        score: kpiScore(counts, { ...DEFAULT_KPI_TARGETS, ...employee.targets }),
      };
    });

    const assigned = priorityFromScores(
      scored.map(({ employee, score }) => ({ uid: employee.uid, score })),
      MIN_PRIORITY,
      MAX_PRIORITY
    );

    const changes: Array<{ uid: string; name: string; from: number; to: number; score: number }> = [];
    state.employees = state.employees.map((employee) => {
      const next = assigned.get(employee.uid);
      const score = scored.find((s) => s.employee.uid === employee.uid)?.score;
      if (next === undefined || score === undefined) return employee;

      if (next !== employee.priority) {
        changes.push({ uid: employee.uid, name: employee.name, from: employee.priority, to: next, score });
      }
      return { ...employee, priority: next, kpiScore: score, priorityRecalculatedAt: now() };
    });

    sortEmployees();
    emit();
    return ok({ changes, evaluated: scored.length });
  },

  setEmployeeStatus(uid: string, status: 'ACTIVE' | 'DISABLED'): Result<{ openLeads: number }> {
    state.employees = state.employees.map((e) => (e.uid === uid ? { ...e, status } : e));
    sortEmployees();
    const openLeads = state.leads.filter(
      (l) => l.assignedUserId === uid && !['CLOSED_WON', 'CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status)
    ).length;
    emit();
    return ok({ openLeads });
  },

  /**
   * The demo mirror of the attendance heartbeat.
   *
   * Opens today on the first call and moves the closing time on every later
   * one, exactly as the server action does. There is no IP in demo mode, so
   * the network is fixed to OFFICE rather than pretending to have checked.
   */
  /**
   * Check In / Check Out, mirroring `punchAttendance`.
   *
   * There is no request IP in demo mode, so the network is fixed to OFFICE
   * rather than pretending a check happened.
   */
  punchAttendance(
    uid: string,
    kind: 'IN' | 'OUT'
  ): Result<{
    kind: 'IN' | 'OUT';
    alreadyDone: boolean;
    dayKey: string;
    network: 'OFFICE';
    ip: string;
    firstActionAt: string;
    lastActionAt: string;
  }> {
    const at = new Date();
    const dayKey = karachiDayKey(at);
    const id = `${uid}_${dayKey}`;
    const existing = state.attendance.find((r) => r.id === id);

    const existingFirst = existing?.firstActionAt?.toDate?.() ?? null;
    const existingLast = existing?.lastActionAt?.toDate?.() ?? null;

    if (kind === 'OUT' && !existingFirst) {
      return { ok: false, error: 'Check in first — there is no open day to close.' };
    }

    const firstAt = kind === 'IN' ? (existingFirst ?? at) : existingFirst!;
    const lastAt =
      kind === 'OUT' ? (existingLast && existingLast > at ? existingLast : at) : existingLast;
    const alreadyDone =
      (kind === 'IN' && existingFirst !== null) ||
      (kind === 'OUT' && existingLast !== null && existingLast >= at);

    const record = {
      id,
      uid,
      dayKey,
      monthKey: dayKey.slice(0, 7),
      firstActionAt: ts(firstAt),
      lastActionAt: lastAt ? ts(lastAt) : undefined,
      workedMinutes: lastAt
        ? Math.max(0, Math.floor((lastAt.getTime() - firstAt.getTime()) / 60_000))
        : 0,
      checkedOut: kind === 'OUT' ? true : (existing?.checkedOut ?? false),
      network: 'OFFICE' as const,
      lastIp: '198.51.100.7',
    };

    state.attendance = existing
      ? state.attendance.map((r) => (r.id === id ? { ...r, ...record } : r))
      : [...state.attendance, record];
    emit();

    return {
      ok: true,
      data: {
        kind,
        alreadyDone,
        dayKey,
        network: 'OFFICE',
        ip: '198.51.100.7',
        firstActionAt: firstAt.toISOString(),
        lastActionAt: (lastAt ?? firstAt).toISOString(),
      },
    };
  },

  recordAttendancePing(uid: string): Result<{ dayKey: string }> {
    // Not named `now` — that shadows the module's `now()` timestamp helper.
    const at = new Date();
    const dayKey = karachiDayKey(at);
    const id = `${uid}_${dayKey}`;
    const existing = state.attendance.find((r) => r.id === id);

    if (existing) {
      state.attendance = state.attendance.map((record) =>
        record.id === id
          ? {
              ...record,
              lastActionAt: now(),
              workedMinutes: Math.max(
                0,
                Math.floor((Date.now() - (record.firstActionAt?.toMillis?.() ?? Date.now())) / 60_000)
              ),
            }
          : record
      );
    } else {
      state.attendance = [
        ...state.attendance,
        {
          id,
          uid,
          dayKey,
          monthKey: karachiMonthKey(at),
          firstActionAt: now(),
          lastActionAt: now(),
          workedMinutes: 0,
          network: 'OFFICE',
          lastIp: '198.51.100.7',
        },
      ];
    }

    emit();
    return ok({ dayKey });
  },

  setAttendanceOverride(
    uid: string,
    dayKey: string,
    status: AttendanceStatus | null,
    note?: string
  ): Result {
    const id = `${uid}_${dayKey}`;
    const existing = state.attendance.find((r) => r.id === id);

    if (existing) {
      state.attendance = state.attendance.map((record) =>
        record.id === id
          ? { ...record, overrideStatus: status ?? undefined, overrideNote: note || undefined }
          : record
      );
    } else {
      state.attendance = [
        ...state.attendance,
        {
          id, uid, dayKey, monthKey: dayKey.slice(0, 7),
          overrideStatus: status ?? undefined, overrideNote: note || undefined,
        },
      ];
    }
    emit();
    return ok(undefined);
  },

  getAttendanceConfig(): Result<AttendancePolicy & { yourIp: string }> {
    // Demo mode has no request to inspect, so this reports the seeded office
    // address rather than inventing one the admin might then trust.
    return ok({ ...state.attendancePolicy, yourIp: '198.51.100.7' });
  },

  setAttendanceConfig(input: Partial<AttendancePolicy>): Result<AttendancePolicy> {
    const ips = (input.officeIps ?? state.attendancePolicy.officeIps).map(normalizeIp).filter(Boolean);
    for (const ip of ips) {
      if (!isValidIp(ip)) return fail(`"${ip}" is not a valid IP address.`);
    }

    const next = normalizePolicy({ ...input, officeIps: Array.from(new Set(ips)) }, state.attendancePolicy);
    if (next.ipRestriction && next.officeIps.length === 0) {
      return fail(
        'Add at least one office IP before switching the restriction on, or nobody will be able to check in.'
      );
    }

    state.attendancePolicy = next;
    emit();
    return ok(next);
  },

  /* ---------------------------------------------------------------- */
  /* Leave (§6, §7)                                                    */
  /* ---------------------------------------------------------------- */

  requestLeave(
    input: { type: LeaveType; from: string; to: string; reason: string; uid?: string },
    actorUid: string
  ): Result<{ requestId: string; days: number }> {
    const days = leaveDayCount(input.from, input.to);
    if (days <= 0) return fail('The end date is before the start date.');
    if (!input.reason.trim()) return fail('Say why — an approver has to decide on something.');

    const forUid = input.uid || actorUid;
    const employee = state.employees.find((e) => e.uid === forUid);
    const id = nextId('lv');

    state.leaveRequests = [
      {
        id,
        uid: forUid,
        employeeName: employee?.name ?? null,
        subAdminUid: employee?.subAdminUid ?? null,
        type: input.type,
        from: input.from,
        to: input.to,
        days,
        reason: input.reason.trim(),
        // §7 — never approved by the act of submitting.
        status: 'PENDING',
        requestedByUid: actorUid,
        requestedAt: now(),
        decidedByUid: null,
        decidedAt: null,
      },
      ...state.leaveRequests,
    ];

    state.notifications = [
      {
        id: nextId('n'),
        type: 'LEAVE_REQUESTED',
        leadId: '',
        targetRole: 'admin',
        payload: {
          message: `${employee?.name ?? 'An employee'} requested ${days} day${days === 1 ? '' : 's'} of ${LEAVE_TYPE_LABELS[input.type]} (${input.from} → ${input.to}).`,
        },
        createdAt: now(),
        readAt: null,
      },
      ...state.notifications,
    ];

    emit();
    return ok({ requestId: id, days });
  },

  decideLeave(
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    note: string | undefined,
    actorUid: string
  ): Result<{ status: LeaveStatus; days: number }> {
    const request = state.leaveRequests.find((row) => row.id === requestId);
    if (!request) return fail('That request no longer exists.');
    if (request.status !== 'PENDING') {
      return fail(`This request has already been ${request.status.toLowerCase()}.`);
    }

    const session = getDemoSession();
    state.leaveRequests = state.leaveRequests.map((row) =>
      row.id === requestId
        ? {
            ...row,
            status: decision,
            decidedByUid: actorUid,
            decidedByName: session?.name ?? null,
            decidedAt: now(),
            decisionNote: note?.trim() || null,
          }
        : row
    );

    // Approving writes the leave days onto attendance, exactly as the server
    // does — that is what turns the calendar yellow and keeps the absence
    // sweep off those days.
    if (decision === 'APPROVED') {
      for (const dayKey of leaveDayKeys(request.from, request.to)) {
        const id = `${request.uid}_${dayKey}`;
        const existing = state.attendance.find((row) => row.id === id);
        const record = {
          id,
          uid: request.uid,
          dayKey,
          monthKey: dayKey.slice(0, 7),
          overrideStatus: 'LEAVE' as AttendanceStatus,
          overrideNote: `${LEAVE_TYPE_LABELS[request.type]} approved`,
        };
        state.attendance = existing
          ? state.attendance.map((row) => (row.id === id ? { ...row, ...record } : row))
          : [...state.attendance, record];
      }
    }

    state.notifications = [
      {
        id: nextId('n'),
        type: decision === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
        leadId: '',
        targetRole: 'employee',
        targetUid: request.uid,
        payload: {
          message:
            decision === 'APPROVED'
              ? `Your ${LEAVE_TYPE_LABELS[request.type]} for ${request.from} → ${request.to} was approved.`
              : `Your ${LEAVE_TYPE_LABELS[request.type]} for ${request.from} → ${request.to} was rejected.`,
        },
        createdAt: now(),
        readAt: null,
      },
      ...state.notifications,
    ];

    emit();
    return ok({ status: decision, days: request.days });
  },

  cancelLeave(requestId: string): Result {
    const request = state.leaveRequests.find((row) => row.id === requestId);
    if (!request) return fail('That request no longer exists.');
    if (request.status !== 'PENDING') {
      return fail('Only a request still awaiting a decision can be withdrawn.');
    }

    state.leaveRequests = state.leaveRequests.map((row) =>
      row.id === requestId ? { ...row, status: 'CANCELLED' as LeaveStatus } : row
    );
    emit();
    return ok(undefined);
  },

  getLeaveSummary(uid: string | undefined, year: string | undefined, actorUid: string) {
    const target = uid || actorUid;
    const yearKey = (year ?? new Date().toISOString().slice(0, 4)).slice(0, 4);

    const used: Partial<Record<LeaveType, number>> = {};
    let pendingDays = 0;

    for (const request of state.leaveRequests) {
      if (request.uid !== target || !request.from.startsWith(yearKey)) continue;
      if (request.status === 'APPROVED') used[request.type] = (used[request.type] ?? 0) + request.days;
      else if (request.status === 'PENDING') pendingDays += request.days;
    }

    return ok({
      uid: target,
      year: yearKey,
      balances: leaveBalances(state.attendancePolicy, used, state.leaveAdjustments[target] ?? {}),
      pendingDays,
    });
  },

  adjustLeaveBalance(uid: string, type: LeaveType, delta: number): Result<{ adjustment: number }> {
    const step = Math.trunc(delta);
    if (!step) return fail('Enter how many days to add or remove.');

    const current = state.leaveAdjustments[uid] ?? {};
    const next = (current[type] ?? 0) + step;
    state.leaveAdjustments = { ...state.leaveAdjustments, [uid]: { ...current, [type]: next } };
    emit();
    return ok({ adjustment: next });
  },

  /**
   * Mirrors `getTeamAttendance`. Scoping is the same shape as the server's: an
   * admin or HR manager sees the whole roster, a Sales manager sees their team.
   */
  getTeamAttendance(
    from: string,
    to: string,
    uid: string | undefined,
    actorUid: string,
    role: string,
    managerKind: string | undefined
  ) {
    const hr = role === 'admin' || managerKind === 'HR';
    const roster = state.employees.filter((employee) =>
      hr ? true : employee.subAdminUid === actorUid || employee.uid === actorUid
    );
    const wanted = uid ? roster.filter((employee) => employee.uid === uid) : roster;
    const nameOf = (target: string | null | undefined) =>
      target ? (state.employees.find((e) => e.uid === target)?.name ?? null) : null;

    const rows = wanted.map((employee) => {
      const days = state.attendance
        .filter((row) => row.uid === employee.uid && row.dayKey >= from && row.dayKey <= to)
        .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
        .map((row) => {
          const minutes = row.workedMinutes ?? 0;
          const status: AttendanceStatus =
            row.overrideStatus ??
            (row.late ? 'LATE' : deriveStatus(minutes, Boolean(row.firstActionAt)));
          const clock = (value: FirestoreTimestamp | undefined) => {
            const date = value?.toDate?.();
            return date
              ? new Intl.DateTimeFormat('en-GB', {
                  timeZone: 'Asia/Karachi',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                }).format(date)
              : null;
          };

          return {
            dayKey: row.dayKey,
            status,
            late: Boolean(row.late),
            lateByMinutes: row.lateByMinutes ?? 0,
            minutes,
            network: row.network ?? 'UNKNOWN',
            checkIn: clock(row.firstActionAt),
            checkOut: clock(row.lastActionAt),
            leaveType: row.leaveType ?? null,
            note: row.overrideNote ?? null,
            adjusted: Boolean(row.adjustments?.length),
          };
        });

      const count = (status: AttendanceStatus) => days.filter((d) => d.status === status).length;
      const present = count('PRESENT');
      const late = count('LATE');
      const halfDay = count('HALF_DAY');
      const absent = count('ABSENT');
      const considered = present + late + halfDay + absent;
      const credited = present + late + halfDay * 0.5;

      return {
        uid: employee.uid,
        name: employee.name,
        email: employee.email ?? null,
        jobTitle: employee.jobTitle ?? null,
        subAdminUid: employee.subAdminUid ?? null,
        managerName: nameOf(employee.subAdminUid),
        monthlySalary: employee.monthlySalary ?? 0,
        days,
        present,
        late,
        absent,
        leave: count('LEAVE'),
        halfDay,
        off: count('OFF'),
        workedMinutes: days.reduce((sum, day) => sum + day.minutes, 0),
        rate: considered === 0 ? 0 : Math.round((credited / considered) * 100),
        deduction: monthDeductions(late, state.attendancePolicy, employee.monthlySalary ?? 0).total,
      };
    });

    rows.sort((a, b) => a.name.localeCompare(b.name));
    return ok({ from, to, rows, policy: state.attendancePolicy, companyWide: hr });
  },

  /* ---------------------------------------------------------------- */
  /* Payroll                                                           */
  /* ---------------------------------------------------------------- */

  listSalaryProfiles() {
    return ok({
      profiles: state.employees.map((employee) => ({
        uid: employee.uid,
        name: employee.name,
        email: employee.email ?? null,
        jobTitle: employee.jobTitle ?? null,
        role: employee.accessRole ?? 'employee',
        ...normalizeSalaryProfile({
          ...(employee.salaryProfile ?? {}),
          basic: employee.salaryProfile?.basic ?? employee.monthlySalary ?? 0,
        }),
      })),
    });
  },

  saveSalaryProfile(uid: string, input: Partial<SalaryProfile>, actorUid: string) {
    const employee = state.employees.find((row) => row.uid === uid);
    if (!employee) return fail('That employee no longer exists.');

    const previous = normalizeSalaryProfile({
      ...(employee.salaryProfile ?? {}),
      basic: employee.salaryProfile?.basic ?? employee.monthlySalary ?? 0,
    });
    const next = normalizeSalaryProfile({ ...previous, ...input });

    state.employees = state.employees.map((row) =>
      row.uid === uid
        ? {
            ...row,
            salaryProfile: next,
            // One salary figure, shared with the attendance deduction.
            monthlySalary: next.basic,
            salaryHistory: [
              ...(row.salaryHistory ?? []),
              { at: new Date().toISOString(), byUid: actorUid, from: previous, to: next },
            ],
          }
        : row
    );
    emit();
    return ok({ profile: next });
  },

  generatePayroll(monthKey: string, actorUid: string) {
    const month = monthKey.slice(0, 7);
    if (month > karachiMonthKey()) return fail('That month has not started yet.');

    const existing = state.payrollPeriods[month];
    if (existing && !isEditable(existing.status)) {
      return fail(
        `${month} is ${existing.status.toLowerCase()} and cannot be regenerated. Send it back for review first.`
      );
    }

    // Commission comes from the payouts the distribution module wrote — never
    // recalculated here.
    const commission = new Map<string, number>();
    for (const payout of state.payouts) {
      if (payout.current === false) continue;
      const stamp = payout.finalizedAt?.toDate?.();
      if (!stamp) continue;
      const key = karachiMonthKey(stamp);
      if (key !== month) continue;
      commission.set(payout.recipientUid, (commission.get(payout.recipientUid) ?? 0) + payout.amount);
    }

    const closed = state.attendancePeriods[month];
    const frozen = new Map(
      closed?.finalized ? closed.lines.map((line) => [line.uid, line.amount]) : []
    );

    const lines = state.employees.map((employee) => {
      const days = state.attendance.filter(
        (row) => row.uid === employee.uid && row.dayKey.startsWith(month)
      );
      const statusOf = (row: (typeof days)[number]): AttendanceStatus =>
        row.overrideStatus ??
        (row.late ? 'LATE' : deriveStatus(row.workedMinutes ?? 0, Boolean(row.firstActionAt)));

      const late = days.filter((row) => statusOf(row) === 'LATE').length;

      return buildPayrollLine({
        uid: employee.uid,
        name: employee.name,
        email: employee.email ?? null,
        jobTitle: employee.jobTitle ?? null,
        profile: normalizeSalaryProfile({
          ...(employee.salaryProfile ?? {}),
          basic: employee.salaryProfile?.basic ?? employee.monthlySalary ?? 0,
        }),
        commission: commission.get(employee.uid) ?? 0,
        attendanceDeduction:
          frozen.get(employee.uid) ??
          monthDeductions(late, state.attendancePolicy, employee.monthlySalary ?? 0).total,
        lateCount: late,
        absentCount: days.filter((row) => statusOf(row) === 'ABSENT').length,
        leaveCount: days.filter((row) => statusOf(row) === 'LEAVE').length,
        presentCount: days.filter((row) => ['PRESENT', 'HALF_DAY', 'LATE'].includes(statusOf(row))).length,
      });
    });

    lines.sort((a, b) => a.name.localeCompare(b.name));
    const totals = payrollTotals(lines);

    state.payrollPeriods = {
      ...state.payrollPeriods,
      [month]: {
        monthKey: month,
        status: 'DRAFT',
        lines,
        generatedAt: new Date().toISOString(),
        generatedByUid: actorUid,
        history: [
          ...(existing?.history ?? []),
          {
            at: new Date().toISOString(),
            byUid: actorUid,
            byName: getDemoSession()?.name ?? null,
            action: existing ? 'REGENERATED' : 'GENERATED',
            detail: `${lines.length} employees, net ${totals.net}`,
          },
        ],
      },
    };
    emit();
    return ok({ monthKey: month, people: lines.length, net: totals.net });
  },

  getPayroll(monthKey: string) {
    const month = monthKey.slice(0, 7);
    const period = state.payrollPeriods[month];

    if (!period) {
      return ok({
        monthKey: month,
        status: 'DRAFT' as PayrollStatus,
        lines: [],
        totals: payrollTotals([]),
        generatedAt: null,
        generatedByUid: null,
        history: [],
        exists: false,
      });
    }

    return ok({ ...period, totals: payrollTotals(period.lines), exists: true });
  },

  adjustPayrollLine(monthKey: string, uid: string, patch: Partial<PayrollLine>, actorUid: string) {
    const month = monthKey.slice(0, 7);
    const period = state.payrollPeriods[month];
    if (!period) return fail('Generate the payroll for this month first.');
    if (!isEditable(period.status)) {
      return fail(
        `${month} is ${period.status.toLowerCase()}. Send it back for review before changing a figure.`
      );
    }

    const index = period.lines.findIndex((line) => line.uid === uid);
    if (index === -1) return fail('That employee is not on this payroll.');

    const before = period.lines[index];
    const after = repriceLine(before, patch);
    const lines = [...period.lines];
    lines[index] = after;

    state.payrollPeriods = {
      ...state.payrollPeriods,
      [month]: {
        ...period,
        lines,
        history: [
          ...period.history,
          {
            at: new Date().toISOString(),
            byUid: actorUid,
            byName: getDemoSession()?.name ?? null,
            action: 'LINE_ADJUSTED',
            detail: `${before.name}: net ${before.net} → ${after.net}`,
          },
        ],
      },
    };
    emit();
    return ok({ net: after.net });
  },

  setPayrollStatus(monthKey: string, status: PayrollStatus, actorUid: string) {
    const month = monthKey.slice(0, 7);
    const period = state.payrollPeriods[month];
    if (!period) return fail('Generate the payroll for this month first.');

    if (!canTransition(period.status, status)) {
      return fail(
        period.status === 'PAID'
          ? 'This payroll has been paid. Correct it with an adjustment on the next month rather than rewriting a paid one.'
          : `A ${period.status.toLowerCase()} payroll cannot go straight to ${status.toLowerCase()}.`
      );
    }

    const session = getDemoSession();
    if (status === 'PAID' && session?.role !== 'admin') {
      return fail('Only an administrator can mark a payroll as paid.');
    }

    const wasApproved = period.status === 'APPROVED';
    state.payrollPeriods = {
      ...state.payrollPeriods,
      [month]: {
        ...period,
        status,
        history: [
          ...period.history,
          {
            at: new Date().toISOString(),
            byUid: actorUid,
            byName: session?.name ?? null,
            action: `STATUS_${status}`,
            detail: `${period.status} → ${status}`,
          },
        ],
      },
    };

    if (status === 'APPROVED' || status === 'PAID') {
      const slips = { ...state.payslips };
      for (const line of period.lines) {
        const id = `${line.uid}_${month}`;
        slips[id] = {
          id,
          uid: line.uid,
          monthKey: month,
          status,
          line,
          current: true,
          approvedAt: new Date().toISOString(),
          approvedByName: session?.name ?? null,
        };
      }
      state.payslips = slips;

      state.notifications = [
        ...period.lines.map((line) => ({
          id: nextId('n'),
          type: status === 'PAID' ? 'SALARY_PAID' : 'SALARY_APPROVED',
          leadId: '',
          targetRole: 'employee' as const,
          targetUid: line.uid,
          payload: {
            message:
              status === 'PAID'
                ? `Your salary for ${month} has been paid: Rs ${line.net.toLocaleString('en-PK')}.`
                : `Your salary slip for ${month} is ready: Rs ${line.net.toLocaleString('en-PK')}.`,
          },
          createdAt: now(),
          readAt: null,
        })),
        ...state.notifications,
      ];
    }

    if (status === 'REVIEWED' && wasApproved) {
      // Reopened — the slips stay, marked not current, so what was approved is
      // still readable after the correction.
      const slips = { ...state.payslips };
      for (const line of period.lines) {
        const id = `${line.uid}_${month}`;
        if (slips[id]) slips[id] = { ...slips[id], current: false };
      }
      state.payslips = slips;
    }

    emit();
    return ok({ status });
  },

  getPayslips(uid: string) {
    return ok({
      slips: Object.values(state.payslips)
        .filter((slip) => slip.uid === uid)
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
    });
  },

  setSalaryAccess(uid: string, granted: boolean): Result {
    const employee = state.employees.find((row) => row.uid === uid);
    if (!employee) return fail('That account no longer exists.');
    if (employee.accessRole !== 'subadmin') {
      return fail('Salary access is granted to managers, not to employees.');
    }

    state.employees = state.employees.map((row) =>
      row.uid === uid ? { ...row, salaryAccess: granted } : row
    );
    emit();
    return ok(undefined);
  },

  /* ---------------------------------------------------------------- */
  /* Office expenses                                                   */
  /* ---------------------------------------------------------------- */

  getExpenseCategories() {
    return ok({
      categories: [
        ...new Set([
          ...DEFAULT_EXPENSE_CATEGORIES,
          ...state.expenseCategories,
          ...LEGACY_EXPENSE_CATEGORIES,
        ]),
      ],
      custom: state.expenseCategories,
    });
  },

  manageExpenseCategory(action: 'ADD' | 'RENAME' | 'REMOVE', name: string, renameTo?: string) {
    const label = name.trim();
    if (!label) return fail('Give the category a name.');

    let next = state.expenseCategories;
    let moved: number | undefined;

    if (action === 'ADD') {
      const known = new Set<string>([
        ...DEFAULT_EXPENSE_CATEGORIES,
        ...LEGACY_EXPENSE_CATEGORIES,
        ...state.expenseCategories,
      ]);
      if (known.has(label)) return fail(`"${label}" is already a category.`);
      next = [...state.expenseCategories, label];
    } else if (action === 'REMOVE') {
      next = state.expenseCategories.filter((entry) => entry !== label);
      if (next.length === state.expenseCategories.length) {
        return fail('Only categories you added can be removed.');
      }
    } else {
      const target = (renameTo ?? '').trim();
      if (!target) return fail('Give the category its new name.');
      next = state.expenseCategories.map((entry) => (entry === label ? target : entry));
      moved = state.expenses.filter((expense) => expense.category === label).length;
      state.expenses = state.expenses.map((expense) =>
        expense.category === label ? { ...expense, category: target } : expense
      );
    }

    state.expenseCategories = next;
    emit();
    return ok({
      categories: [
        ...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...next, ...LEGACY_EXPENSE_CATEGORIES]),
      ],
      moved,
    });
  },

  createOfficeExpense(
    input: {
      title: string;
      category: string;
      amount: number;
      date?: string;
      paidBy?: string;
      paymentMethod?: string;
      description?: string;
      receiptUrl?: string;
      receiptName?: string;
      status?: ExpenseStatus;
    },
    actorUid: string,
    actorEmail: string | null
  ) {
    const title = input.title.trim();
    if (!title) return fail('Give the expense a title.');
    if (!(Number(input.amount) > 0)) return fail('Enter an amount greater than zero.');
    if (!input.category.trim()) return fail('Choose a category.');

    const dayKey = (input.date ?? '').slice(0, 10) || karachiDayKey();
    if (dayKey > karachiDayKey()) return fail('The expense date cannot be in the future.');

    const id = nextId('exp');
    state.expenses = [
      {
        id,
        title,
        category: input.category.trim(),
        amount: Math.round(Number(input.amount)),
        description: input.description?.trim() || null,
        addedByUid: actorUid,
        addedByEmail: actorEmail,
        date: ts(new Date(`${dayKey}T12:00:00+05:00`)),
        dayKey,
        status: EXPENSE_STATUSES.includes(input.status as ExpenseStatus)
          ? (input.status as ExpenseStatus)
          : 'PENDING',
        paidBy: input.paidBy?.trim() || null,
        paymentMethod: input.paymentMethod?.trim() || null,
        receiptUrl: input.receiptUrl?.trim() || null,
        receiptName: input.receiptName?.trim() || null,
      },
      ...state.expenses,
    ];
    emit();
    return ok({ expenseId: id });
  },

  updateOfficeExpense(
    expenseId: string,
    input: {
      title: string;
      category: string;
      amount: number;
      date?: string;
      paidBy?: string;
      paymentMethod?: string;
      description?: string;
      receiptUrl?: string;
      receiptName?: string;
    },
    actorUid: string
  ): Result {
    const existing = state.expenses.find((expense) => expense.id === expenseId);
    if (!existing) return fail('That expense no longer exists.');
    if (!input.title.trim()) return fail('Give the expense a title.');
    if (!(Number(input.amount) > 0)) return fail('Enter an amount greater than zero.');

    const dayKey = (input.date ?? '').slice(0, 10) || existing.dayKey || karachiDayKey();
    state.expenses = state.expenses.map((expense) =>
      expense.id === expenseId
        ? {
            ...expense,
            title: input.title.trim(),
            category: input.category.trim(),
            amount: Math.round(Number(input.amount)),
            description: input.description?.trim() || null,
            paidBy: input.paidBy?.trim() || null,
            paymentMethod: input.paymentMethod?.trim() || null,
            receiptUrl: input.receiptUrl?.trim() || null,
            receiptName: input.receiptName?.trim() || null,
            dayKey,
            date: ts(new Date(`${dayKey}T12:00:00+05:00`)),
            updatedByUid: actorUid,
          }
        : expense
    );
    emit();
    return ok(undefined);
  },

  setOfficeExpenseStatus(
    expenseId: string,
    status: ExpenseStatus,
    note: string | undefined,
    actorUid: string
  ) {
    const existing = state.expenses.find((expense) => expense.id === expenseId);
    if (!existing) return fail('That expense no longer exists.');

    const current = normalizeExpenseStatus(existing.status);
    if (current === status) return fail(`This expense is already ${status.toLowerCase()}.`);

    const session = getDemoSession();
    state.expenses = state.expenses.map((expense) =>
      expense.id === expenseId
        ? {
            ...expense,
            status,
            decidedByUid: actorUid,
            decidedByName: session?.name ?? null,
            decisionNote: note?.trim() || null,
          }
        : expense
    );
    emit();
    return ok({ status });
  },

  deleteOfficeExpense(expenseId: string): Result {
    const existing = state.expenses.find((expense) => expense.id === expenseId);
    if (!existing) return fail('That expense no longer exists.');
    if (normalizeExpenseStatus(existing.status) === 'APPROVED') {
      return fail(
        'An approved expense cannot be deleted. Reject it instead — that keeps the record and the reason.'
      );
    }

    state.expenses = state.expenses.filter((expense) => expense.id !== expenseId);
    emit();
    return ok(undefined);
  },

  /** Mirrors `finalizeAttendanceDeductions` (§12). */
  finalizeAttendanceDeductions(monthKey: string, actorUid: string) {
    const month = monthKey.slice(0, 7);
    if (month >= karachiMonthKey()) {
      return fail('Wait until the month is over before closing it.');
    }
    if (state.attendancePeriods[month]?.finalized) {
      return fail(`${month} was already finalised. Reopen it first if the figures need to change.`);
    }

    const lateCounts = new Map<string, number>();
    for (const row of state.attendance) {
      if (!row.dayKey.startsWith(month)) continue;
      if (!row.late || (row.overrideStatus && row.overrideStatus !== 'LATE')) continue;
      lateCounts.set(row.uid, (lateCounts.get(row.uid) ?? 0) + 1);
    }

    const lines = state.employees
      .map((employee) => {
        const lateCount = lateCounts.get(employee.uid) ?? 0;
        const { outcomes, total } = monthDeductions(
          lateCount,
          state.attendancePolicy,
          employee.monthlySalary ?? 0
        );
        return {
          uid: employee.uid,
          name: employee.name,
          monthlySalary: employee.monthlySalary ?? 0,
          lateCount,
          amount: total,
          basis: outcomes.filter((outcome) => outcome.deducted).map((outcome) => outcome.basis),
        };
      })
      .filter((line) => line.amount > 0);

    const total = lines.reduce((sum, line) => sum + line.amount, 0);
    const session = getDemoSession();

    state.attendancePeriods = {
      ...state.attendancePeriods,
      [month]: {
        monthKey: month,
        finalized: true,
        finalizedAt: new Date().toISOString(),
        finalizedByUid: actorUid,
        finalizedByName: session?.name ?? null,
        lines,
        total,
        policy: state.attendancePolicy,
      },
    };
    emit();
    return ok({ monthKey: month, total, people: lines.length });
  },

  reopenAttendancePeriod(monthKey: string): Result {
    const month = monthKey.slice(0, 7);
    const period = state.attendancePeriods[month];
    if (!period?.finalized) return fail(`${month} is not closed.`);

    state.attendancePeriods = {
      ...state.attendancePeriods,
      [month]: { ...period, finalized: false },
    };
    emit();
    return ok(undefined);
  },

  getAttendancePeriod(monthKey: string) {
    const month = monthKey.slice(0, 7);
    return ok(
      state.attendancePeriods[month] ?? {
        monthKey: month,
        finalized: false,
        finalizedAt: null,
        finalizedByUid: null,
        finalizedByName: null,
        lines: [],
        total: 0,
        policy: null,
      }
    );
  },

  /** Mirrors `getAttendanceSummary` — one person's month with the working shown. */
  getAttendanceSummary(uid: string | undefined, monthKey: string | undefined, actorUid: string) {
    const target = uid || actorUid;
    const month = (monthKey ?? karachiMonthKey()).slice(0, 7);
    const employee = state.employees.find((e) => e.uid === target);
    const policy = state.attendancePolicy;

    let present = 0, late = 0, absent = 0, leave = 0, halfDay = 0, minutesTotal = 0;

    for (const row of state.attendance) {
      if (row.uid !== target || !row.dayKey.startsWith(month)) continue;
      const minutes = row.workedMinutes ?? 0;
      minutesTotal += minutes;
      const status: AttendanceStatus =
        row.overrideStatus ?? (row.late ? 'LATE' : deriveStatus(minutes, Boolean(row.firstActionAt)));
      if (status === 'PRESENT') present += 1;
      else if (status === 'LATE') late += 1;
      else if (status === 'ABSENT') absent += 1;
      else if (status === 'LEAVE') leave += 1;
      else if (status === 'HALF_DAY') halfDay += 1;
    }

    const considered = present + late + halfDay + absent;
    const credited = present + late + halfDay * 0.5;
    const { outcomes, total } = monthDeductions(late, policy, employee?.monthlySalary ?? 0);

    return ok({
      uid: target,
      monthKey: month,
      present,
      late,
      absent,
      leave,
      halfDay,
      workedMinutes: minutesTotal,
      rate: considered === 0 ? 0 : Math.round((credited / considered) * 100),
      deductions: outcomes,
      deductionTotal: total,
      rules: {
        startTime: policy.startTime,
        graceMinutes: policy.graceMinutes,
        lateAfter: formatClockValue((parseClock(policy.startTime) ?? 0) + policy.graceMinutes),
        absentCutoff: policy.absentCutoff,
        allowedLates: policy.allowedLates,
        deductionMode: policy.deductionMode,
        deductionValue: policy.deductionValue,
        ipRestriction: policy.ipRestriction,
      },
    });
  },

  /** Mirrors `adjustAttendance` — the correction sits beside what happened. */
  adjustAttendance(
    uid: string,
    dayKey: string,
    change: { status?: AttendanceStatus; late?: boolean; note?: string }
  ): Result {
    const id = `${uid}_${dayKey}`;
    const existing = state.attendance.find((row) => row.id === id);
    const patch = {
      id,
      uid,
      dayKey,
      monthKey: dayKey.slice(0, 7),
      ...(change.status ? { overrideStatus: change.status } : {}),
      overrideNote: change.note?.trim() || null,
    };

    state.attendance = existing
      ? state.attendance.map((row) => (row.id === id ? { ...row, ...patch } : row))
      : [...state.attendance, patch];

    emit();
    return ok(undefined);
  },

  markNotificationRead(id: string): Result {
    state.notifications = state.notifications.filter((n) => n.id !== id);
    emit();
    return ok(undefined);
  },

  markAllNotificationsRead(): Result<{ cleared: number }> {
    const cleared = state.notifications.length;
    state.notifications = [];
    emit();
    return ok({ cleared });
  },
  
  addReceivable(input: { title: string; size: string; amount: number; date?: string }, actorUid: string): Result<{ receivableId: string }> {
    if (!input.title.trim()) return fail('Give the receivable a title.');
    if (!Number.isFinite(input.amount) || input.amount <= 0) return fail('Enter an amount greater than zero.');
    const id = nextId('r');
    state.receivables = [
      { id, title: input.title.trim(), size: input.size, amount: input.amount,
        addedByUid: actorUid, addedByEmail: 'admin@crm.com',
        date: input.date ? ts(new Date(`${input.date}T12:00:00`)) : now() },
      ...state.receivables,
    ];
    emit();
    return ok({ receivableId: id });
  },

  addCommitteeRecord(input: { title: string; amount: number; description?: string; date?: string }, actorUid: string): Result<{ recordId: string }> {
    if (!input.title.trim()) return fail('Give the record a title.');
    if (!Number.isFinite(input.amount) || input.amount <= 0) return fail('Enter an amount greater than zero.');
    const id = nextId('c');
    state.committee = [
      { id, title: input.title.trim(), amount: input.amount, description: input.description?.trim() || null,
        addedByUid: actorUid, addedByEmail: 'admin@crm.com',
        date: input.date ? ts(new Date(`${input.date}T12:00:00`)) : now() },
      ...state.committee,
    ];
    emit();
    return ok({ recordId: id });
  },

  addInvestmentRecord(input: { title: string; amount: number; description?: string; date?: string }, actorUid: string): Result<{ recordId: string }> {
    if (!input.title.trim()) return fail('Give the record a title.');
    if (!Number.isFinite(input.amount) || input.amount <= 0) return fail('Enter an amount greater than zero.');
    const id = nextId('i');
    state.investments = [
      { id, title: input.title.trim(), amount: input.amount, description: input.description?.trim() || null,
        addedByUid: actorUid, addedByEmail: 'admin@crm.com',
        date: input.date ? ts(new Date(`${input.date}T12:00:00`)) : now() },
      ...state.investments,
    ];
    emit();
    return ok({ recordId: id });
  },

  addCapitalInvestmentRecord(input: { title: string; amount: number; description?: string; date?: string }, actorUid: string): Result<{ recordId: string }> {
    if (!input.title.trim()) return fail('Give the record a title.');
    if (!Number.isFinite(input.amount) || input.amount <= 0) return fail('Enter an amount greater than zero.');
    const id = nextId('ci');
    state.capitalInvestments = [
      { id, title: input.title.trim(), amount: input.amount, description: input.description?.trim() || null,
        addedByUid: actorUid, addedByEmail: 'admin@crm.com',
        date: input.date ? ts(new Date(`${input.date}T12:00:00`)) : now() },
      ...state.capitalInvestments,
    ];
    emit();
    return ok({ recordId: id });
  },

  addPersonalExpense(input: { title: string; amount: number; description?: string; date?: string }, actorUid: string): Result<{ recordId: string }> {
    if (!input.title.trim()) return fail('Give the record a title.');
    if (!Number.isFinite(input.amount) || input.amount <= 0) return fail('Enter an amount greater than zero.');
    const id = nextId('pe');
    state.personalExpenses = [
      { id, title: input.title.trim(), amount: input.amount, description: input.description?.trim() || null,
        addedByUid: actorUid, addedByEmail: 'admin@crm.com',
        date: input.date ? ts(new Date(`${input.date}T12:00:00`)) : now() },
      ...state.personalExpenses,
    ];
    emit();
    return ok({ recordId: id });
  },

  createLead(
    input: {
      name: string;
      phone?: string;
      email?: string;
      city?: string;
      status: LeadStatus;
      assignedUserId?: string | null;
      campaignId?: string | null;
      campaignName?: string | null;
      createdAt?: string;
      followUps?: Array<{ message: string; callMade: boolean; occurredAt: string }>;
      deal?: {
        serviceDescription: string;
        amountReceived: number;
        payableAmount: number;
        paymentMethod: string;
        dealCategory?: string;
        dealDate: string;
        notes?: string;
      };
    },
    actorUid: string
  ): Result<{ leadId: string }> {
    if (!input.name.trim()) return fail("Enter the lead's name.");
    
    const id = nextId('lead');
    const creationTime = input.createdAt ? ts(new Date(input.createdAt)) : now();

    const isTerminalStatus = input.status === "CLOSED_WON" || input.status === "CLOSED_LOST" || input.status === "NOT_INTERESTED";
    // Naming an assignee at creation is an admin decision: accepted outright.
    const effectiveStatus: LeadStatus = input.assignedUserId && !isTerminalStatus ? "ACCEPTED" : input.status;
    // A backdated lead is a historical backfill and must not enter the lane.
    const isBackdated =
      Boolean(input.createdAt) &&
      new Date(input.createdAt!).getTime() < startOfKarachiDay(new Date()).getTime();

    const campaignId = input.campaignId?.trim() || null;
    const campaignName = input.campaignName?.trim() || null;

    state.leads = [
      {
        id,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        city: input.city?.trim() || null,
        status: effectiveStatus,
        source: campaignId ? 'CAMPAIGN_IMPORT' : 'MANUAL_ENTRY',
        campaignId,
        campaignName,
        assignedUserId: input.assignedUserId || null,
        attemptedAssignees: input.assignedUserId ? [input.assignedUserId] : [],
        createdAt: creationTime,
        lastActivityAt: creationTime,
        ...(input.assignedUserId ? {
          assignedAt: creationTime,
          distributionMethod: 'MANUAL',
          acceptedAt: creationTime,
        } : {}),
        ...(effectiveStatus === "NEW" && !input.assignedUserId && !isBackdated
          ? { adminAssignDeadlineAt: ts(new Date(Date.now() + ADMIN_ASSIGN_WINDOW_MS)) }
          : {}),
        ...(effectiveStatus === "CLOSED_WON" ? { closedAt: creationTime, closedDealId: id } : {})
      },
      ...state.leads,
    ];

    addEvent(id, 'MANUALLY_CREATED', actorUid, { status: effectiveStatus, assignedTo: input.assignedUserId || null, campaignName });
    if (input.assignedUserId) {
      addEvent(id, 'MANUALLY_ASSIGNED', actorUid, { assignedTo: input.assignedUserId });
    }

    if (input.assignedUserId && effectiveStatus === 'ACCEPTED') {
      state.notifications = [
        {
          id: nextId('n'),
          type: 'NEW_LEAD_ASSIGNED',
          leadId: id,
          payload: { message: `${input.name.trim()} has been assigned to you by an admin.` },
          createdAt: now(),
          readAt: null,
        },
        ...state.notifications,
      ];
    }

    if (input.followUps && input.followUps.length > 0) {
      let lastActivity = creationTime;
      input.followUps.forEach((fu) => {
        const fuDate = ts(new Date(fu.occurredAt));
        if (fuDate > lastActivity) lastActivity = fuDate;

        state.followUps[id] = [
          {
            id: nextId('fu'),
            message: fu.message.trim(),
            callMade: fu.callMade,
            callCount: fu.callMade ? 1 : 0,
            // Imported records carry no timed duration, so never a Connect.
            durationSeconds: 0,
            connect: false,
            meetingHeld: false,
            dayKey: karachiDayKey(new Date(fu.occurredAt)),
            authorUid: input.assignedUserId || actorUid,
            occurredAt: fuDate,
          },
          ...(state.followUps[id] || []),
        ];
        if (input.assignedUserId && fu.callMade) {
          bumpKpi(input.assignedUserId, karachiMonthKey(new Date(fu.occurredAt)), { calls: 1 });
        }
        addEvent(id, 'FOLLOW_UP_ADDED', input.assignedUserId || actorUid, { message: fu.message.trim(), callMade: fu.callMade });
      });
      // update lastActivity
      const l = state.leads.find(x => x.id === id);
      if (l) l.lastActivityAt = lastActivity;
    }

    if (input.status === "CLOSED_WON" && input.deal) {
      const profit = input.deal.amountReceived - input.deal.payableAmount;
      const dDate = input.deal.dealDate ? ts(new Date(input.deal.dealDate + "T12:00:00Z")) : creationTime;
      state.deals = [
        {
          id,
          leadId: id,
          userId: input.assignedUserId || actorUid,
          enteredByUid: actorUid,
          customer: { name: input.name, phone: input.phone || "000", email: input.email || null, cnic: null, address: null, city: input.city || null },
          serviceDescription: input.deal.serviceDescription,
          paymentMethod: input.deal.paymentMethod,
          dealCategory: normalizeDealCategory(input.deal.dealCategory),
          notes: input.deal.notes || null,
          amountReceived: input.deal.amountReceived,
          payableAmount: input.deal.payableAmount,
          profit,
          campaignId,
          campaignName,
          dealDate: dDate,
          enteredAt: creationTime,
        },
        ...state.deals,
      ];
      if (input.assignedUserId) {
        bumpKpi(
          input.assignedUserId,
          karachiMonthKey(dDate.toDate()),
          { registrations: 1, revenue: input.deal.amountReceived },
          normalizeDealCategory(input.deal.dealCategory)
        );
      }
      addEvent(id, 'DEAL_CLOSED', actorUid, { dealId: id, creditedTo: input.assignedUserId || actorUid, amountReceived: input.deal.amountReceived, payableAmount: input.deal.payableAmount, profit });
    }

    emit();
    return ok({ leadId: id });
  },

  createCampaign: (
    input: {
      name: string;
      externalId?: string;
      platform?: string;
      category?: string;
      status: 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'ARCHIVED';
      startDate?: string;
      endDate?: string;
      budget?: number;
      description?: string;
      notes?: string;
      historicalLeadsCount?: number;
      historicalRevenue?: number;
    },
    actorUid = 'demo-admin'
  ) => {
    const id = nextId('camp');
    const start = input.startDate ? ts(new Date(input.startDate)) : null;
    const end = input.endDate ? ts(new Date(input.endDate)) : null;
    const camp: CampaignRecord = {
      id,
      name: input.name.trim(),
      externalId: input.externalId?.trim() || null,
      platform: input.platform?.trim() || 'Meta Ads',
      category: input.category?.trim() || null,
      status: input.status || 'COMPLETED',
      startDate: start,
      endDate: end,
      budget: Number(input.budget) || 0,
      description: input.description?.trim() || null,
      notes: input.notes?.trim() || null,
      historicalLeadsCount: Number(input.historicalLeadsCount) || 0,
      historicalRevenue: Number(input.historicalRevenue) || 0,
      addedByUid: actorUid,
      addedByEmail: 'admin@crm.com',
      createdAt: now(),
    };
    state.campaigns = [camp, ...(state.campaigns || [])];
    emit();
    return ok({ campaignId: id });
  },

  /* ---- Data Bank ---- */

  createDataBankFolder: (input: {
    name: string;
    code?: string | null;
    description?: string | null;
    fields: Array<{ key?: string; label: string }>;
    nameIndex: number;
    phoneIndex: number;
  }) => {
    const seen = new Set<string>();
    const fields = input.fields
      .map((f) => (f.label ?? '').trim())
      .filter(Boolean)
      .map((label) => {
        const key = fieldKeyFor(label, seen);
        seen.add(key);
        return { key, label };
      });
    if (fields.length === 0) return fail('Add at least one field — the columns your sheet has.');

    const nameKey = fields[input.nameIndex]?.key;
    const phoneFieldKey = fields[input.phoneIndex]?.key;
    if (!nameKey || !phoneFieldKey) return fail('Choose which field is the name and which is the phone number.');
    if (nameKey === phoneFieldKey) return fail('The name and the phone number must be two different fields.');

    const id = nextId('folder');
    state.dataBankFolders = [
      ...state.dataBankFolders,
      {
        id,
        name: input.name.trim(),
        code: (input.code ?? '').trim() || null,
        description: (input.description ?? '').trim() || null,
        fields,
        roles: { name: nameKey, phone: phoneFieldKey },
        columnMap: {},
        recordCount: 0,
        promotedCount: 0,
        createdAt: now(),
      },
    ].sort((a, b) => a.name.localeCompare(b.name));
    emit();
    return ok({ folderId: id });
  },

  updateDataBankFolder: (folderId: string, input: {
    name: string;
    code?: string | null;
    description?: string | null;
    fields: Array<{ key?: string; label: string }>;
    nameIndex: number;
    phoneIndex: number;
  }) => {
    const folder = state.dataBankFolders.find((f) => f.id === folderId);
    if (!folder) return fail('That folder no longer exists.');

    const seen = new Set<string>();
    const fields = input.fields
      .filter((f) => (f.label ?? '').trim())
      .map((f) => {
        const label = f.label.trim();
        const key = f.key && !seen.has(f.key) ? f.key : fieldKeyFor(label, seen);
        seen.add(key);
        return { key, label };
      });
    if (fields.length === 0) return fail('Add at least one field — the columns your sheet has.');

    const nameKey = fields[input.nameIndex]?.key;
    const phoneFieldKey = fields[input.phoneIndex]?.key;
    if (!nameKey || !phoneFieldKey) return fail('Choose which field is the name and which is the phone number.');
    if (nameKey === phoneFieldKey) return fail('The name and the phone number must be two different fields.');

    Object.assign(folder, {
      name: input.name.trim(),
      code: (input.code ?? '').trim() || null,
      description: (input.description ?? '').trim() || null,
      fields,
      roles: { name: nameKey, phone: phoneFieldKey },
    });
    state.dataBankFolders = [...state.dataBankFolders].sort((a, b) => a.name.localeCompare(b.name));
    emit();
    return ok(undefined);
  },

  deleteDataBankFolder: (folderId: string) => {
    const deleted = state.dataBankRecords.filter((r) => r.folderId === folderId).length;
    state.dataBankRecords = state.dataBankRecords.filter((r) => r.folderId !== folderId);
    state.dataBankFolders = state.dataBankFolders.filter((f) => f.id !== folderId);
    emit();
    return ok({ deleted });
  },

  saveColumnMap: (folderId: string, columnMap: Record<string, string>) => {
    const folder = state.dataBankFolders.find((f) => f.id === folderId);
    if (folder) {
      folder.columnMap = columnMap;
      emit();
    }
    return ok(undefined);
  },

  addDataBankRecord: (folderId: string, values: Record<string, string>) => {
    const folder = state.dataBankFolders.find((f) => f.id === folderId);
    if (!folder) return fail('That folder no longer exists.');

    const valid = new Set(folder.fields.map((f) => f.key));
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (valid.has(k)) clean[k] = String(v ?? '').trim();

    const name = (clean[folder.roles.name] ?? '').trim();
    const phone = (clean[folder.roles.phone] ?? '').trim();
    const key = phoneKey(phone);
    if (!name) return fail('Enter the name.');
    if (!key) return fail('Enter a usable phone number.');

    const clash = state.dataBankRecords.find((r) => r.folderId === folderId && r.phoneKey === key);
    if (clash) return fail(`That number is already in this folder (${clash.name}).`);

    const id = nextId('dbr');
    state.dataBankRecords = [
      { id, folderId, name, phone, phoneKey: key, values: clean, status: 'NEW', notes: null, createdAt: now() },
      ...state.dataBankRecords,
    ];
    folder.recordCount += 1;
    emit();
    return ok({ recordId: id });
  },

  updateDataBankRecord: (recordId: string, input: { values?: Record<string, string>; status?: DataBankStatus; notes?: string | null }) => {
    const record = state.dataBankRecords.find((r) => r.id === recordId);
    if (!record) return fail('That record no longer exists.');
    const folder = state.dataBankFolders.find((f) => f.id === record.folderId);

    if (input.values && folder) {
      const valid = new Set(folder.fields.map((f) => f.key));
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(input.values)) if (valid.has(k)) clean[k] = String(v ?? '').trim();
      const name = (clean[folder.roles.name] ?? '').trim();
      const phone = (clean[folder.roles.phone] ?? '').trim();
      if (!name) return fail('Enter the name.');
      if (!phoneKey(phone)) return fail('Enter a usable phone number.');
      Object.assign(record, { values: clean, name, phone, phoneKey: phoneKey(phone) });
    }
    if (input.status) record.status = input.status;
    if (input.notes !== undefined) record.notes = (input.notes ?? '').trim() || null;

    state.dataBankRecords = [...state.dataBankRecords];
    emit();
    return ok(undefined);
  },

  deleteDataBankRecord: (recordId: string) => {
    const record = state.dataBankRecords.find((r) => r.id === recordId);
    if (!record) return ok(undefined);
    const folder = state.dataBankFolders.find((f) => f.id === record.folderId);
    if (folder) folder.recordCount = Math.max(0, folder.recordCount - 1);
    state.dataBankRecords = state.dataBankRecords.filter((r) => r.id !== recordId);
    emit();
    return ok(undefined);
  },

  importDataBankRows: (folderId: string, rows: Array<{ values: Record<string, string> }>) => {
    const folder = state.dataBankFolders.find((f) => f.id === folderId);
    if (!folder) return fail('That folder no longer exists.');

    const valid = new Set(folder.fields.map((f) => f.key));
    const existing = new Set(
      state.dataBankRecords.filter((r) => r.folderId === folderId).map((r) => r.phoneKey)
    );

    let written = 0;
    let duplicates = 0;
    const added: DataBankRecord[] = [];

    for (const row of rows) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(row.values)) if (valid.has(k)) clean[k] = String(v ?? '').trim();
      const name = (clean[folder.roles.name] ?? '').trim();
      const phone = (clean[folder.roles.phone] ?? '').trim();
      const key = phoneKey(phone);
      if (!name || !key) continue;
      if (existing.has(key)) {
        duplicates += 1;
        continue;
      }
      existing.add(key);
      added.push({
        id: nextId('dbr'), folderId, name, phone, phoneKey: key,
        values: clean, status: 'NEW', notes: null, createdAt: now(),
      });
      written += 1;
    }

    state.dataBankRecords = [...added, ...state.dataBankRecords];
    folder.recordCount += written;
    emit();
    return ok({ written, duplicates });
  },

  /**
   * Mirrors `assignRecordsToManager` — the rows **move** into the manager's
   * own mirror of the folder rather than becoming leads. Same deterministic
   * mirror id, same one-row-one-owner rule.
   */
  assignRecordsToManager: (recordIds: string[], managerUid: string, actorUid = 'demo-admin') => {
    const manager = state.employees.find((e) => e.uid === managerUid);
    if (!manager) return fail('That account no longer exists.');
    if (manager.accessRole !== 'subadmin') return fail(`${manager.name} is not a manager.`);
    if (manager.status === 'DISABLED') {
      return fail(`${manager.name} is paused — resume them or choose someone else.`);
    }

    let moved = 0;
    let skipped = 0;
    const folderIds = new Set<string>();

    for (const recordId of recordIds) {
      const record = state.dataBankRecords.find((r) => r.id === recordId);
      const source = record && state.dataBankFolders.find((f) => f.id === record.folderId);
      if (!record || !source || source.subAdminUid === managerUid) {
        skipped += 1;
        continue;
      }

      const originId = source.sourceFolderId ?? source.id;
      const originName = source.sourceFolderName ?? source.name;
      const mirrorId = `mgr_${managerUid}_${originId}`;

      const existing = state.dataBankFolders.find((f) => f.id === mirrorId);
      const mirror: DataBankFolder =
        existing ?? {
          id: mirrorId,
          name: originName,
          description: `Handed to ${manager.name} from the ${originName} folder.`,
          fields: source.fields,
          roles: source.roles,
          subAdminUid: managerUid,
          sourceFolderId: originId,
          sourceFolderName: originName,
          recordCount: 0,
          promotedCount: 0,
          createdAt: ts(new Date()),
        };
      if (!existing) state.dataBankFolders = [...state.dataBankFolders, mirror];

      record.folderId = mirrorId;
      source.recordCount = Math.max(0, source.recordCount - 1);
      mirror.recordCount += 1;
      folderIds.add(mirrorId);
      moved += 1;
    }

    if (moved > 0) {
      state.notifications = [
        {
          id: nextId('n'),
          type: 'DATA_BANK_ASSIGNED',
          leadId: '',
          targetRole: 'subadmin',
          targetUid: managerUid,
          payload: {
            message: `${moved} Data Bank record${moved === 1 ? '' : 's'} handed to you. Assign them to your team from your Data Bank.`,
          },
          createdAt: now(),
          readAt: null,
        },
        ...state.notifications,
      ];
    }

    emit();
    void actorUid;
    return ok({ moved, skipped, folderIds: [...folderIds] });
  },

  /** Mirrors `promoteDataBankRecords` by running the single path per record. */
  promoteDataBankRecords: (recordIds: string[], assignedUserId: string, actorUid = 'demo-admin') => {
    let promoted = 0;
    let skipped = 0;
    const leadIds: string[] = [];

    for (const recordId of recordIds) {
      const result = demo.promoteDataBankRecord(recordId, assignedUserId, actorUid);
      if (result.ok && 'data' in result) {
        promoted += 1;
        leadIds.push(result.data.leadId);
      } else {
        skipped += 1;
      }
    }

    return ok({ promoted, skipped, leadIds });
  },

  promoteDataBankRecord: (recordId: string, assignedUserId: string, actorUid = 'demo-admin') => {
    const record = state.dataBankRecords.find((r) => r.id === recordId);
    if (!record) return fail('That record no longer exists.');
    // Employee, manager or the admin themselves (§2). A manager or the admin
    // gets the lead in their **Client section** rather than the employee lead
    // area — the server does the same, and the demo has to demonstrate it.
    const session = getDemoSession();
    const isSelf = assignedUserId === (session?.uid ?? actorUid);
    const employee = state.employees.find((e) => e.uid === assignedUserId);

    if (!employee && !isSelf) return fail('That account no longer exists.');
    if (employee?.status === 'DISABLED') {
      return fail('That employee is paused — resume them or choose someone else.');
    }

    const targetRole: 'admin' | 'subadmin' | 'employee' = employee
      ? employee.accessRole === 'subadmin'
        ? 'subadmin'
        : 'employee'
      : (session?.role ?? 'admin');
    const targetName = employee?.name ?? session?.name ?? 'Admin';
    const goesToClients = targetRole !== 'employee';

    const folder = state.dataBankFolders.find((f) => f.id === record.folderId);
    const labels = new Map((folder?.fields ?? []).map((f) => [f.key, f.label]));
    const customFields: Record<string, string> = {};
    for (const [k, v] of Object.entries(record.values)) {
      if (k === folder?.roles.name || k === folder?.roles.phone) continue;
      const label = labels.get(k);
      if (label && v) customFields[label] = v;
    }

    const leadId = nextId('lead');
    const stamp = now();
    state.leads = [
      {
        id: leadId,
        name: record.name,
        phone: record.phone,
        email: null,
        city: null,
        status: 'ACCEPTED',
        source: 'DATA_BANK',
        assignedUserId,
        assigneeName: targetName,
        attemptedAssignees: [assignedUserId],
        distributionMethod: 'MANUAL',
        dataBankFolderId: record.folderId,
        dataBankFolderName: folder?.name ?? null,
        subAdminUid:
          targetRole === 'subadmin'
            ? assignedUserId
            : targetRole === 'admin'
              ? null
              : (employee?.subAdminUid ?? null),
        campaignId: null,
        campaignName: null,
        followUpCount: 0,
        callCount: 0,
        customFields,
        createdAt: stamp,
        assignedAt: stamp,
        acceptedAt: stamp,
        lastActivityAt: stamp,
      } as Lead,
      ...state.leads,
    ];

    state.notifications = [
      {
        id: nextId('notif'),
        type: 'NEW_LEAD_ASSIGNED',
        leadId,
        targetRole,
        targetUid: assignedUserId,
        payload: {
          message: goesToClients
            ? `${record.name} was added to your ${folder?.name ?? 'client'} folder.`
            : `${record.name} has been assigned to you.`,
        },
        createdAt: stamp,
        readAt: null,
      },
      ...state.notifications,
    ];

    state.events[leadId] = [
      { id: `${leadId}-e1`, type: 'FORCE_ACCEPTED', actorUid, at: stamp, meta: { assignedTo: assignedUserId } },
    ];

    // §5 — into the recipient's Client section, in a folder mirroring the
    // source. The id is deterministic, so importing more of the same folder
    // later lands in the folder that already exists rather than a second copy.
    if (goesToClients && folder) {
      const clientFolderId = `db_${assignedUserId}_${folder.id}`;
      if (!state.clientFolders.some((f) => f.id === clientFolderId)) {
        state.clientFolders = [
          {
            id: clientFolderId,
            name: folder.name,
            description: `Imported from the ${folder.name} data bank folder.`,
            color: null,
            subAdminUid: targetRole === 'subadmin' ? assignedUserId : null,
            leadCount: 0,
            createdByUid: actorUid,
            createdByName: session?.name ?? null,
            createdAt: stamp,
          },
          ...state.clientFolders,
        ];
      }

      state.clientFolderLeads = [
        {
          id: `${clientFolderId}__${leadId}`,
          folderId: clientFolderId,
          leadId,
          leadName: record.name,
          addedByUid: actorUid,
          addedAt: stamp,
        },
        ...state.clientFolderLeads,
      ];

      state.clientFolders = state.clientFolders.map((f) =>
        f.id === clientFolderId ? { ...f, leadCount: f.leadCount + 1 } : f
      );
    }

    // The row leaves the folder — the owner's decision.
    state.dataBankRecords = state.dataBankRecords.filter((r) => r.id !== recordId);
    if (folder) {
      folder.recordCount = Math.max(0, folder.recordCount - 1);
      folder.promotedCount += 1;
    }
    emit();
    return ok({ leadId, clientFolderId: goesToClients && folder ? `db_${assignedUserId}_${folder.id}` : null });
  },
};
