import type { Lead } from '@/hooks/useLeads';
import type { DealRecord } from '@/hooks/useFinancials';
import type { EmployeeData } from '@/hooks/useEmployees';
import { withinRange, type DateRange } from './dates';
import { TERMINAL_STATUSES } from './leadStatus';

/**
 * Performance and campaign rollups (FR-22, FR-24, FR-25).
 *
 * Computed from already-loaded documents rather than fetched separately. That
 * is the right trade at this scale — a few hundred leads on an admin dashboard
 * that already holds them in memory. Once volume makes that unreasonable, the
 * replacement is scheduled rollup documents (architecture.md §4.5), not a
 * bigger client-side loop.
 */

export interface EmployeeMetrics {
  uid: string;
  name: string;
  email: string;
  priority: number;
  status: 'ACTIVE' | 'DISABLED';
  jobTitle: string;
  phone?: string | null;
  joinedAt?: EmployeeData['joinedAt'];
  notes?: string | null;
  autoAssign?: boolean;
  /** Monthly KPI targets. Absent on records predating the KPI module. */
  targets?: EmployeeData['targets'];
  /** False once an admin has pinned the priority by hand. */
  autoPriority?: boolean;
  /** 0–1, from the last KPI recalculation. */
  kpiScore?: number;
  /** Access role — `subadmin` accounts appear in the same directory. */
  accessRole?: EmployeeData['accessRole'];
  /** The sub admin who manages them. Absent means the admin directly. */
  subAdminUid?: string | null;
  /** Sales or HR (§13). Only meaningful on a manager account. */
  managerKind?: EmployeeData['managerKind'];
  /** Base for percentage late deductions and payroll (§5, §12). */
  monthlySalary?: number;
  createdAt?: EmployeeData['createdAt'];

  assigned: number;
  accepted: number;
  /** Offered to them, then reassigned elsewhere after the window lapsed. */
  missed: number;
  active: number;
  closedWon: number;
  lost: number;

  followUps: number;
  calls: number;

  revenue: number;
  payable: number;
  profit: number;
  /** Closed-won as a percentage of leads handled. */
  conversionRate: number;
}

export type RankingKey =
  | 'closedWon'
  | 'revenue'
  | 'profit'
  | 'conversionRate'
  | 'assigned'
  | 'followUps'
  | 'missed';

export const RANKING_OPTIONS: { key: RankingKey; label: string; ascending?: boolean }[] = [
  { key: 'profit', label: 'Profit' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'closedWon', label: 'Deals closed' },
  { key: 'conversionRate', label: 'Conversion rate' },
  { key: 'assigned', label: 'Leads handled' },
  { key: 'followUps', label: 'Follow-ups logged' },
  { key: 'missed', label: 'Missed leads', ascending: true },
];

export function buildEmployeeMetrics(
  employees: EmployeeData[],
  leads: Lead[],
  deals: DealRecord[],
  range?: DateRange
): EmployeeMetrics[] {
  const leadsInRange = leads.filter((lead) => withinRange(lead.createdAt, range));

  return employees.map((employee) => {
    const own = leadsInRange.filter((lead) => lead.assignedUserId === employee.uid);
    const ownDeals = deals.filter((deal) => deal.userId === employee.uid);

    // Offered to them at some point, but the lead now sits with someone else —
    // that is a lapsed accept window (BR-8).
    const missed = leadsInRange.filter(
      (lead) =>
        Array.isArray(lead.attemptedAssignees) &&
        lead.attemptedAssignees.includes(employee.uid) &&
        lead.assignedUserId !== employee.uid
    ).length;

    const closedWon = own.filter((lead) => lead.status === 'CLOSED_WON').length;
    const lost = own.filter(
      (lead) => TERMINAL_STATUSES.includes(lead.status) && lead.status !== 'CLOSED_WON'
    ).length;

    return {
      uid: employee.uid,
      name: employee.name,
      email: employee.email,
      priority: employee.priority,
      status: employee.status,
      jobTitle: employee.jobTitle,
      phone: employee.phone,
      joinedAt: employee.joinedAt,
      notes: employee.notes,
      autoAssign: employee.autoAssign,
      targets: employee.targets,
      autoPriority: employee.autoPriority,
      kpiScore: employee.kpiScore,
      accessRole: employee.accessRole,
      subAdminUid: employee.subAdminUid ?? null,
      managerKind: employee.managerKind,
      monthlySalary: employee.monthlySalary ?? 0,
      createdAt: employee.createdAt,

      assigned: own.length,
      accepted: own.filter((lead) => Boolean(lead.acceptedAt)).length,
      missed,
      active: own.filter((lead) => !TERMINAL_STATUSES.includes(lead.status)).length,
      closedWon,
      lost,

      followUps: sum(own, (lead) => lead.followUpCount),
      calls: sum(own, (lead) => lead.callCount),

      revenue: sum(ownDeals, (deal) => deal.amountReceived),
      payable: sum(ownDeals, (deal) => deal.payableAmount),
      profit: sum(ownDeals, (deal) => deal.profit),
      conversionRate: own.length > 0 ? (closedWon / own.length) * 100 : 0,
    };
  });
}

export function rankEmployees(metrics: EmployeeMetrics[], key: RankingKey): EmployeeMetrics[] {
  const option = RANKING_OPTIONS.find((o) => o.key === key);
  const ascending = option?.ascending ?? false;

  return [...metrics].sort((a, b) => {
    const diff = Number(a[key]) - Number(b[key]);
    if (diff !== 0) return ascending ? diff : -diff;
    return a.name.localeCompare(b.name);
  });
}

export interface CampaignMetrics {
  campaignId: string;
  name: string;
  leads: number;
  closedWon: number;
  revenue: number;
  profit: number;
  conversionRate: number;
  /** Revenue divided by leads — what one lead from this campaign is worth. */
  valuePerLead: number;
}

export function buildCampaignMetrics(
  leads: Lead[],
  deals: DealRecord[],
  range?: DateRange
): CampaignMetrics[] {
  const leadsInRange = leads.filter((lead) => withinRange(lead.createdAt, range));
  const byCampaign = new Map<string, { name: string; leads: Lead[] }>();

  for (const lead of leadsInRange) {
    const id = lead.campaignId ?? 'unattributed';
    const name = lead.campaignName ?? (lead.campaignId ? lead.campaignId : 'Not attributed');
    const bucket = byCampaign.get(id) ?? { name, leads: [] };
    bucket.leads.push(lead);
    byCampaign.set(id, bucket);
  }

  const metrics: CampaignMetrics[] = [];

  for (const [campaignId, bucket] of byCampaign) {
    const campaignDeals = deals.filter(
      (deal) => (deal.campaignId ?? 'unattributed') === campaignId
    );
    const closedWon = bucket.leads.filter((lead) => lead.status === 'CLOSED_WON').length;
    const revenue = sum(campaignDeals, (deal) => deal.amountReceived);

    metrics.push({
      campaignId,
      name: bucket.name,
      leads: bucket.leads.length,
      closedWon,
      revenue,
      profit: sum(campaignDeals, (deal) => deal.profit),
      conversionRate: bucket.leads.length > 0 ? (closedWon / bucket.leads.length) * 100 : 0,
      valuePerLead: bucket.leads.length > 0 ? revenue / bucket.leads.length : 0,
    });
  }

  return metrics.sort((a, b) => b.profit - a.profit || b.leads - a.leads);
}

function sum<T>(items: T[], pick: (item: T) => number | undefined): number {
  return items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
}
