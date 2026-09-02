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
import type { AttendanceRecord } from '@/hooks/useAttendance';
import { isValidIp, normalizeIp, type AttendanceStatus } from '@/lib/attendance';
import { isTerminal, type LeadStatus } from '@/lib/leadStatus';
import type { DistributionLine } from '@/lib/profitDistribution';
import { calculateDistribution, type DistributionShare } from '@/lib/profitDistribution';
import { validateKyc, leadPatchFromKyc, type KycValues } from '@/lib/kyc';
import { PIPELINE_STAGES, type PipelineStage } from '@/lib/pipelineStage';
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
  /** Mirrors config/attendance.officeIps. */
  officeIps: string[];
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

  return { employees, kpiMonths, attendance, officeIps: ['198.51.100.7'], leads, followUps, events, deals, expenses, notifications, receivables, committee, investments, capitalInvestments, personalExpenses, campaigns, dataBankFolders, dataBankRecords, distributions: [], payouts: [] };
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
    patchLead(leadId, { status });
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
      whatsappNote?: string; occurredAt?: string;
    },
    actorUid: string,
    actorEmail: string
  ): Result<{ followUpId: string; connect: boolean }> {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return fail('That lead no longer exists.');
    if (lead.status === 'ASSIGNED') return fail('Accept this lead before logging a follow-up.');

    const occurred = input.occurredAt ? new Date(input.occurredAt) : new Date();
    const dayKey = karachiDayKey(occurred);
    const isAdmin = getDemoSession()?.role !== 'employee';

    // Mirrors the server rule: one follow-up per lead per day for employees.
    if (!isAdmin && (state.followUps[leadId] ?? []).some((f) => f.dayKey === dayKey)) {
      return fail('You have already logged a follow-up for this lead today. Add the next one tomorrow.');
    }

    const calls = input.callMade ? Math.max(1, Number(input.callCount) || 1) : 0;
    const durationSeconds = input.callMade ? normalizeDurationSeconds(input.durationSeconds) : 0;
    if (input.callMade && durationSeconds === 0) {
      return fail('Enter how long the call lasted — it decides whether this counts as a connect.');
    }

    const connect = Boolean(input.callMade) && isConnect(durationSeconds);
    const meetingHeld = Boolean(input.meetingHeld);
    const id = nextId('fu');

    state.followUps[leadId] = [
      { id, message: input.message, callMade: input.callMade, callCount: calls,
        durationSeconds, connect, meetingHeld, dayKey,
        whatsappNote: input.whatsappNote || null, occurredAt: ts(occurred), createdAt: now(),
        authorUid: actorUid, authorEmail: actorEmail },
      ...(state.followUps[leadId] ?? []),
    ];
    patchLead(leadId, {
      followUpCount: (lead.followUpCount ?? 0) + 1,
      callCount: (lead.callCount ?? 0) + calls,
      lastActivityAt: now(),
      // Same one-way flag the real transaction writes: a meeting that happened
      // stays happened, and it lifts the lead to P2.
      ...(meetingHeld ? { meetingHeld: true } : {}),
    });
    if (lead.assignedUserId) {
      bumpKpi(lead.assignedUserId, karachiMonthKey(occurred), {
        calls: input.callMade ? 1 : 0,
        connects: connect ? 1 : 0,
        meetings: meetingHeld ? 1 : 0,
      });
    }
    addEvent(leadId, 'FOLLOW_UP_ADDED', actorUid, {
      followUpId: id, callMade: input.callMade, callCount: calls, durationSeconds, connect, meetingHeld,
    });
    emit();
    return ok({ followUpId: id, connect });
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

  createEmployee(input: { name: string; email: string; password: string; priority: number; jobTitle?: string; status?: 'ACTIVE' | 'DISABLED'; targets?: Partial<KpiTargets>; phone?: string | null; notes?: string | null; joinedAt?: string | null; autoAssign?: boolean; accessRole?: 'employee' | 'subadmin'; subAdminUid?: string | null }): Result<{ uid: string }> {
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
      autoPriority: true,
      createdAt: now(),
    }];
    emit();
    return ok({ uid });
  },

  updateEmployee(uid: string, input: { name?: string; email?: string; password?: string; priority?: number; jobTitle?: string; targets?: Partial<KpiTargets>; phone?: string | null; notes?: string | null; joinedAt?: string | null; autoAssign?: boolean; accessRole?: 'employee' | 'subadmin'; subAdminUid?: string | null }): Result {
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

  getAttendanceConfig(): Result<{ officeIps: string[]; yourIp: string }> {
    // Demo mode has no request to inspect, so this reports the seeded office
    // address rather than inventing one the admin might then trust.
    return ok({ officeIps: state.officeIps, yourIp: '198.51.100.7' });
  },

  setAttendanceConfig(officeIps: string[]): Result<{ officeIps: string[] }> {
    for (const ip of officeIps) {
      if (!isValidIp(ip)) return fail(`"${ip}" is not a valid IP address.`);
    }
    state.officeIps = Array.from(new Set(officeIps.map(normalizeIp).filter(Boolean)));
    emit();
    return ok({ officeIps: state.officeIps });
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

  promoteDataBankRecord: (recordId: string, assignedUserId: string, actorUid = 'demo-admin') => {
    const record = state.dataBankRecords.find((r) => r.id === recordId);
    if (!record) return fail('That record no longer exists.');
    const employee = state.employees.find((e) => e.uid === assignedUserId);
    if (!employee) return fail('Choose a team member to assign this to.');
    if (employee.status === 'DISABLED') return fail('That employee is paused — resume them or choose someone else.');

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
        attemptedAssignees: [assignedUserId],
        distributionMethod: 'MANUAL',
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
        targetRole: 'employee',
        targetUid: assignedUserId,
        payload: { message: `${record.name} has been assigned to you.` },
        createdAt: stamp,
        readAt: null,
      },
      ...state.notifications,
    ];

    state.events[leadId] = [
      { id: `${leadId}-e1`, type: 'FORCE_ACCEPTED', actorUid, at: stamp, meta: { assignedTo: assignedUserId } },
    ];

    // The row leaves the folder — the owner's decision.
    state.dataBankRecords = state.dataBankRecords.filter((r) => r.id !== recordId);
    if (folder) {
      folder.recordCount = Math.max(0, folder.recordCount - 1);
      folder.promotedCount += 1;
    }
    emit();
    return ok({ leadId });
  },
};
