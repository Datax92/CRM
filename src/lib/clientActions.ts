"use client";

import { IS_DEMO, demo, getDemoSession } from '@/lib/demo/store';
import type { LeadStatus } from '@/lib/leadStatus';
import type { ActionResult } from '@/lib/actionResult';

import { assignLead as _assignLead, reassignLeadManual as _reassignLeadManual, acceptLead as _acceptLead, setLeadStatus as _setLeadStatus, setLeadPipelineStage as _setLeadPipelineStage, createLead as _createLead } from '@/app/actions/leads';
import type { PipelineStage } from '@/lib/pipelineStage';
import { saveKyc as _saveKyc } from '@/app/actions/kyc';
import type { KycValues } from '@/lib/kyc';
import {
  finalizeProfitDistribution as _finalizeProfitDistribution,
  reopenProfitDistribution as _reopenProfitDistribution,
  type ShareInput,
  type FinalizeResult,
} from '@/app/actions/profitDistribution';
import { addFollowUp as _addFollowUp } from '@/app/actions/followUps';
import { closeDeal as _closeDeal } from '@/app/actions/closedDeals';
import { addExpense as _addExpense } from '@/app/actions/expenses';
import { addReceivable as _addReceivable } from '@/app/actions/receivables';
import { addCommitteeRecord as _addCommitteeRecord, addInvestmentRecord as _addInvestmentRecord, addCapitalInvestmentRecord as _addCapitalInvestmentRecord, addPersonalExpense as _addPersonalExpense } from '@/app/actions/accounts';
import { createEmployee as _createEmployee, updateEmployee as _updateEmployee, setEmployeePriority as _setEmployeePriority, setEmployeeAutoPriority as _setEmployeeAutoPriority, setEmployeeTargets as _setEmployeeTargets, recalculateEmployeePriorities as _recalculateEmployeePriorities, disableEmployee as _disableEmployee, enableEmployee as _enableEmployee, setEmployeeSubAdmin as _setEmployeeSubAdmin, setSubAdminTeam as _setSubAdminTeam, type PriorityChange } from '@/app/actions/employees';
import type { KpiTargets } from '@/lib/kpi';
import { createCampaign as _createCampaign, type CreateCampaignInput } from '@/app/actions/campaigns';
import {
  createDataBankFolder as _createDataBankFolder,
  updateDataBankFolder as _updateDataBankFolder,
  deleteDataBankFolder as _deleteDataBankFolder,
  saveColumnMap as _saveColumnMap,
  addDataBankRecord as _addDataBankRecord,
  updateDataBankRecord as _updateDataBankRecord,
  deleteDataBankRecord as _deleteDataBankRecord,
  importDataBankRows as _importDataBankRows,
  promoteDataBankRecord as _promoteDataBankRecord,
  type FolderInput,
  type ImportChunkResult,
} from '@/app/actions/dataBank';
import type { ColumnMap, DataBankStatus } from '@/lib/dataBank';
import {
  recordAttendancePing as _recordAttendancePing,
  punchAttendance as _punchAttendance,
  setAttendanceOverride as _setAttendanceOverride,
  getAttendanceConfig as _getAttendanceConfig,
  setAttendanceConfig as _setAttendanceConfig,
  type AttendanceConfig,
  type AttendancePingResult,
  type AttendancePunchResult,
  type PunchKind,
} from '@/app/actions/attendance';
import type { AttendanceStatus } from '@/lib/attendance';
import { markNotificationRead as _markNotificationRead, markAllNotificationsRead as _markAllNotificationsRead } from '@/app/actions/notifications';
import { getMonitoringConfig as _getMonitoringConfig, setNoFollowUpHours as _setNoFollowUpHours, type MonitoringConfig } from '@/app/actions/config';
import { DEFAULT_NO_FOLLOWUP_HOURS } from '@/lib/constants/monitoring';

/** Who the demo store should attribute mutations to. */
const actor = () => getDemoSession() ?? { uid: 'demo-admin', email: 'admin@crm.com' };

export async function assignLead(token: string, leadId: string, userId: string): Promise<ActionResult> {
  if (IS_DEMO) return demo.assignLead(leadId, userId, actor().uid);
  return _assignLead(token, leadId, userId);
}

export async function reassignLeadManual(token: string, leadId: string, userId: string): Promise<ActionResult> {
  if (IS_DEMO) return demo.reassignLead(leadId, userId, actor().uid);
  return _reassignLeadManual(token, leadId, userId);
}

export async function acceptLead(token: string, leadId: string): Promise<ActionResult> {
  if (IS_DEMO) return demo.acceptLead(leadId, actor().uid);
  return _acceptLead(token, leadId);
}

export async function setLeadStatus(token: string, leadId: string, status: LeadStatus): Promise<ActionResult> {
  if (IS_DEMO) return demo.setLeadStatus(leadId, status, actor().uid);
  return _setLeadStatus(token, leadId, status);
}

export async function setLeadPipelineStage(
  token: string,
  leadId: string,
  stage: PipelineStage | null
): Promise<ActionResult> {
  if (IS_DEMO) return demo.setLeadPipelineStage(leadId, stage, actor().uid);
  return _setLeadPipelineStage(token, leadId, stage);
}

/** Know Your Client — see `lib/kyc` for why this also rewrites the lead row. */
export async function saveKyc(
  token: string,
  leadId: string,
  values: KycValues
): Promise<ActionResult<{ values: KycValues }>> {
  if (IS_DEMO) return demo.saveKyc(leadId, values, actor().uid);
  return _saveKyc(token, leadId, values);
}

export async function finalizeProfitDistribution(
  token: string,
  dealId: string,
  shares: ShareInput[]
): Promise<ActionResult<FinalizeResult>> {
  if (IS_DEMO) return demo.finalizeProfitDistribution(dealId, shares, actor().uid);
  return _finalizeProfitDistribution(token, dealId, shares);
}

export async function reopenProfitDistribution(token: string, dealId: string): Promise<ActionResult> {
  if (IS_DEMO) return demo.reopenProfitDistribution(dealId);
  return _reopenProfitDistribution(token, dealId);
}

export async function createLead(
  token: string,
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
  }
): Promise<ActionResult<{ leadId: string }>> {
  if (IS_DEMO) return demo.createLead(input, actor().uid);
  return _createLead(token, input);
}

export async function addFollowUp(
  token: string,
  leadId: string,
  input: {
    message: string;
    callMade: boolean;
    callCount?: number;
    durationSeconds?: number;
    meetingHeld?: boolean;
    whatsappNote?: string;
    occurredAt?: string;
  }
): Promise<ActionResult<{ followUpId: string; connect: boolean }>> {
  if (IS_DEMO) return demo.addFollowUp(leadId, input, actor().uid, actor().email);
  return _addFollowUp(token, leadId, input);
}

export async function closeDeal(
  token: string,
  leadId: string,
  input: {
    customer: { name: string; phone: string; email?: string; cnic?: string; address?: string; city?: string };
    serviceDescription: string;
    amountReceived: number;
    payableAmount: number;
    paymentMethod?: string;
    dealCategory?: string;
    dealDate?: string;
    notes?: string;
  }
): Promise<ActionResult<{ dealId: string; profit: number }>> {
  if (IS_DEMO) return demo.closeDeal(leadId, input, actor().uid);
  return _closeDeal(token, leadId, input);
}

export async function addExpense(
  token: string,
  input: { title: string; category: string; amount: number; description?: string; date?: string }
): Promise<ActionResult<{ expenseId: string }>> {
  if (IS_DEMO) return demo.addExpense(input, actor().uid);
  return _addExpense(token, input);
}

export async function addReceivable(
  token: string,
  input: { title: string; size: string; amount: number; date?: string }
): Promise<ActionResult<{ receivableId: string }>> {
  if (IS_DEMO) return demo.addReceivable(input, actor().uid);
  return _addReceivable(token, input);
}

export async function addCommitteeRecord(
  token: string,
  input: { title: string; amount: number; description?: string; date?: string }
): Promise<ActionResult<{ recordId: string }>> {
  if (IS_DEMO) return demo.addCommitteeRecord(input, actor().uid);
  return _addCommitteeRecord(token, input);
}

export async function addInvestmentRecord(
  token: string,
  input: { title: string; amount: number; description?: string; date?: string }
): Promise<ActionResult<{ recordId: string }>> {
  if (IS_DEMO) return demo.addInvestmentRecord(input, actor().uid);
  return _addInvestmentRecord(token, input);
}

export async function addCapitalInvestmentRecord(
  token: string,
  input: { title: string; amount: number; description?: string; date?: string }
): Promise<ActionResult<{ recordId: string }>> {
  if (IS_DEMO) return demo.addCapitalInvestmentRecord(input, actor().uid);
  return _addCapitalInvestmentRecord(token, input);
}

export async function addPersonalExpense(
  token: string,
  input: { title: string; amount: number; description?: string; date?: string }
): Promise<ActionResult<{ recordId: string }>> {
  if (IS_DEMO) return demo.addPersonalExpense(input, actor().uid);
  return _addPersonalExpense(token, input);
}

export async function createEmployee(
  token: string,
  input: { name: string; email: string; password: string; priority: number; jobTitle?: string; status?: 'ACTIVE' | 'DISABLED'; targets?: Partial<KpiTargets>; phone?: string | null; notes?: string | null; joinedAt?: string | null; autoAssign?: boolean; accessRole?: 'employee' | 'subadmin'; subAdminUid?: string | null }
): Promise<ActionResult<{ uid: string }>> {
  if (IS_DEMO) return demo.createEmployee(input);
  return _createEmployee(token, input);
}

export async function updateEmployee(
  token: string,
  uid: string,
  input: { name?: string; email?: string; password?: string; priority?: number; jobTitle?: string; targets?: Partial<KpiTargets>; phone?: string | null; notes?: string | null; joinedAt?: string | null; autoAssign?: boolean; accessRole?: 'employee' | 'subadmin'; subAdminUid?: string | null }
): Promise<ActionResult> {
  if (IS_DEMO) return demo.updateEmployee(uid, input);
  return _updateEmployee(token, uid, input);
}

/** Moves one employee onto a sub admin's team, or back under the admin. */
export async function setEmployeeSubAdmin(
  token: string,
  employeeUid: string,
  subAdminUid: string | null
): Promise<ActionResult<{ moved: string | null }>> {
  if (IS_DEMO) return demo.setEmployeeSubAdmin(employeeUid, subAdminUid);
  return _setEmployeeSubAdmin(token, employeeUid, subAdminUid);
}

/** Sets a sub admin's whole team at once, from the directory's tick list. */
export async function setSubAdminTeam(
  token: string,
  subAdminUid: string,
  employeeUids: string[]
): Promise<ActionResult<{ added: number; removed: number }>> {
  if (IS_DEMO) return demo.setSubAdminTeam(subAdminUid, employeeUids);
  return _setSubAdminTeam(token, subAdminUid, employeeUids);
}

export async function setEmployeePriority(token: string, uid: string, priority: number): Promise<ActionResult> {
  if (IS_DEMO) return demo.setEmployeePriority(uid, priority);
  return _setEmployeePriority(token, uid, priority);
}

export async function setEmployeeAutoPriority(token: string, uid: string, auto: boolean): Promise<ActionResult> {
  if (IS_DEMO) return demo.setEmployeeAutoPriority(uid, auto);
  return _setEmployeeAutoPriority(token, uid, auto);
}

export async function setEmployeeTargets(
  token: string,
  uid: string,
  targets: Partial<KpiTargets>
): Promise<ActionResult<{ targets: KpiTargets }>> {
  if (IS_DEMO) return demo.setEmployeeTargets(uid, targets);
  return _setEmployeeTargets(token, uid, targets);
}

export async function recalculateEmployeePriorities(
  token: string
): Promise<ActionResult<{ changes: PriorityChange[]; evaluated: number }>> {
  if (IS_DEMO) return demo.recalculateEmployeePriorities();
  return _recalculateEmployeePriorities(token);
}

export async function disableEmployee(token: string, uid: string): Promise<ActionResult<{ openLeads: number }>> {
  if (IS_DEMO) return demo.setEmployeeStatus(uid, 'DISABLED');
  return _disableEmployee(token, uid);
}

export async function enableEmployee(token: string, uid: string): Promise<ActionResult> {
  if (IS_DEMO) return demo.setEmployeeStatus(uid, 'ACTIVE') as ActionResult;
  return _enableEmployee(token, uid);
}

export async function recordAttendancePing(token: string): Promise<ActionResult<AttendancePingResult>> {
  if (IS_DEMO) return demo.recordAttendancePing(actor().uid) as ActionResult<AttendancePingResult>;
  return _recordAttendancePing(token);
}

/** The employee's own Check In / Check Out. */
export async function punchAttendance(
  token: string,
  kind: PunchKind
): Promise<ActionResult<AttendancePunchResult>> {
  if (IS_DEMO) return demo.punchAttendance(actor().uid, kind) as ActionResult<AttendancePunchResult>;
  return _punchAttendance(token, kind);
}

export async function setAttendanceOverride(
  token: string,
  uid: string,
  dayKey: string,
  status: AttendanceStatus | null,
  note?: string
): Promise<ActionResult> {
  if (IS_DEMO) return demo.setAttendanceOverride(uid, dayKey, status, note);
  return _setAttendanceOverride(token, uid, dayKey, status, note);
}

export async function getAttendanceConfig(
  token: string
): Promise<ActionResult<AttendanceConfig & { yourIp: string }>> {
  if (IS_DEMO) return demo.getAttendanceConfig();
  return _getAttendanceConfig(token);
}

export async function setAttendanceConfig(
  token: string,
  officeIps: string[]
): Promise<ActionResult<AttendanceConfig>> {
  if (IS_DEMO) return demo.setAttendanceConfig(officeIps);
  return _setAttendanceConfig(token, officeIps);
}

export async function markNotificationRead(token: string, id: string): Promise<ActionResult> {
  if (IS_DEMO) return demo.markNotificationRead(id);
  return _markNotificationRead(token, id);
}

export async function markAllNotificationsRead(token: string): Promise<ActionResult<{ cleared: number }>> {
  if (IS_DEMO) return demo.markAllNotificationsRead();
  return _markAllNotificationsRead(token);
}

export async function getMonitoringConfig(token: string): Promise<ActionResult<MonitoringConfig>> {
  if (IS_DEMO) return { ok: true, data: { noFollowUpHours: DEFAULT_NO_FOLLOWUP_HOURS } };
  return _getMonitoringConfig(token);
}

export async function setNoFollowUpHours(token: string, hours: number): Promise<ActionResult> {
  if (IS_DEMO) return { ok: false, error: 'Settings are read-only in demo mode.' };
  return _setNoFollowUpHours(token, hours);
}

export async function createCampaign(
  token: string,
  input: CreateCampaignInput
): Promise<ActionResult<{ campaignId: string }>> {
  if (IS_DEMO) return demo.createCampaign(input, actor().uid);
  return _createCampaign(token, input);
}

/* -------------------------------------------------------------------------- */
/* Data Bank                                                                   */
/* -------------------------------------------------------------------------- */

export async function createDataBankFolder(
  token: string,
  input: FolderInput
): Promise<ActionResult<{ folderId: string }>> {
  if (IS_DEMO) return demo.createDataBankFolder(input);
  return _createDataBankFolder(token, input);
}

export async function updateDataBankFolder(
  token: string,
  folderId: string,
  input: FolderInput
): Promise<ActionResult> {
  if (IS_DEMO) return demo.updateDataBankFolder(folderId, input);
  return _updateDataBankFolder(token, folderId, input);
}

export async function deleteDataBankFolder(
  token: string,
  folderId: string
): Promise<ActionResult<{ deleted: number }>> {
  if (IS_DEMO) return demo.deleteDataBankFolder(folderId);
  return _deleteDataBankFolder(token, folderId);
}

export async function saveColumnMap(
  token: string,
  folderId: string,
  columnMap: ColumnMap
): Promise<ActionResult> {
  if (IS_DEMO) return demo.saveColumnMap(folderId, columnMap);
  return _saveColumnMap(token, folderId, columnMap);
}

export async function addDataBankRecord(
  token: string,
  folderId: string,
  values: Record<string, string>
): Promise<ActionResult<{ recordId: string }>> {
  if (IS_DEMO) return demo.addDataBankRecord(folderId, values);
  return _addDataBankRecord(token, folderId, values);
}

export async function updateDataBankRecord(
  token: string,
  recordId: string,
  input: { values?: Record<string, string>; status?: DataBankStatus; notes?: string | null }
): Promise<ActionResult> {
  if (IS_DEMO) return demo.updateDataBankRecord(recordId, input);
  return _updateDataBankRecord(token, recordId, input);
}

export async function deleteDataBankRecord(token: string, recordId: string): Promise<ActionResult> {
  if (IS_DEMO) return demo.deleteDataBankRecord(recordId);
  return _deleteDataBankRecord(token, recordId);
}

export async function importDataBankRows(
  token: string,
  folderId: string,
  rows: Array<{ values: Record<string, string> }>
): Promise<ActionResult<ImportChunkResult>> {
  if (IS_DEMO) return demo.importDataBankRows(folderId, rows);
  return _importDataBankRows(token, folderId, rows);
}

export async function promoteDataBankRecord(
  token: string,
  recordId: string,
  assignedUserId: string
): Promise<ActionResult<{ leadId: string }>> {
  if (IS_DEMO) return demo.promoteDataBankRecord(recordId, assignedUserId, actor().uid);
  return _promoteDataBankRecord(token, recordId, assignedUserId);
}

/** Re-exported so existing client imports from '@/lib/clientActions' keep working. */
export { EXPENSE_CATEGORIES, PAYMENT_METHODS, RECEIVABLE_SIZES } from '@/lib/constants';
