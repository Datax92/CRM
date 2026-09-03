"use client";

import { IS_DEMO, demo, getDemoSession } from '@/lib/demo/store';
import type { LeadStatus } from '@/lib/leadStatus';
import type { ActionResult } from '@/lib/actionResult';

import { assignLead as _assignLead, reassignLeadManual as _reassignLeadManual, acceptLead as _acceptLead, setLeadStatus as _setLeadStatus, setLeadPipelineStage as _setLeadPipelineStage, createLead as _createLead, reviewColdLead as _reviewColdLead, assignLeadsBulk as _assignLeadsBulk } from '@/app/actions/leads';
import type { PipelineStage } from '@/lib/pipelineStage';
import { saveKyc as _saveKyc } from '@/app/actions/kyc';
import type { KycValues } from '@/lib/kyc';
import {
  finalizeProfitDistribution as _finalizeProfitDistribution,
  reopenProfitDistribution as _reopenProfitDistribution,
  type ShareInput,
  type FinalizeResult,
} from '@/app/actions/profitDistribution';
import { addFollowUp as _addFollowUp, updateFollowUp as _updateFollowUp } from '@/app/actions/followUps';
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
  promoteDataBankRecords as _promoteDataBankRecords,
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
import type { SalaryProfile, PayrollLine, PayrollStatus } from '@/lib/payroll';
import type { ExpenseStatus } from '@/lib/officeExpenses';
import {
  listSalaryProfiles as _listSalaryProfiles,
  saveSalaryProfile as _saveSalaryProfile,
  generatePayroll as _generatePayroll,
  getPayroll as _getPayroll,
  adjustPayrollLine as _adjustPayrollLine,
  setPayrollStatus as _setPayrollStatus,
  getPayslips as _getPayslips,
  setSalaryAccess as _setSalaryAccess,
  type PayrollPeriod,
  type Payslip,
  type SalaryProfileRecord,
} from '@/app/actions/payroll';
import {
  getExpenseCategories as _getExpenseCategories,
  manageExpenseCategory as _manageExpenseCategory,
  createOfficeExpense as _createOfficeExpense,
  updateOfficeExpense as _updateOfficeExpense,
  setOfficeExpenseStatus as _setOfficeExpenseStatus,
  deleteOfficeExpense as _deleteOfficeExpense,
  type OfficeExpenseInput,
} from '@/app/actions/officeExpenses';
import type { LeaveType } from '@/lib/attendancePolicy';
import {
  adjustAttendance as _adjustAttendance,
  finalizeAttendanceDeductions as _finalizeAttendanceDeductions,
  getAttendancePeriod as _getAttendancePeriod,
  getAttendanceSummary as _getAttendanceSummary,
  getTeamAttendance as _getTeamAttendance,
  reopenAttendancePeriod as _reopenAttendancePeriod,
  type AttendanceAdjustment,
  type AttendancePeriod,
  type AttendanceSummary,
  type TeamAttendanceResult,
} from '@/app/actions/attendance';
import {
  requestLeave as _requestLeave,
  decideLeave as _decideLeave,
  cancelLeave as _cancelLeave,
  getLeaveSummary as _getLeaveSummary,
  adjustLeaveBalance as _adjustLeaveBalance,
  type LeaveSummary,
} from '@/app/actions/leave';
import { markNotificationRead as _markNotificationRead, markAllNotificationsRead as _markAllNotificationsRead } from '@/app/actions/notifications';
import { buildTeamReport as _buildTeamReport, type TeamReport } from '@/app/actions/reports';
import {
  createClientFolder as _createClientFolder,
  updateClientFolder as _updateClientFolder,
  deleteClientFolder as _deleteClientFolder,
  addLeadsToClientFolder as _addLeadsToClientFolder,
  removeLeadFromClientFolder as _removeLeadFromClientFolder,
} from '@/app/actions/clients';
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
    siteVisit?: boolean;
    whatsappNote?: string;
    occurredAt?: string;
  }
): Promise<ActionResult<{ followUpId: string; connect: boolean; kind: 'REMARK' | 'FOLLOW_UP' }>> {
  if (IS_DEMO) return demo.addFollowUp(leadId, input, actor().uid, actor().email);
  return _addFollowUp(token, leadId, input);
}

/** Edits the newest entry on a lead. Older ones are locked — see §2. */
export async function updateFollowUp(
  token: string,
  leadId: string,
  followUpId: string,
  input: {
    message?: string;
    callMade?: boolean;
    callCount?: number;
    durationSeconds?: number;
    meetingHeld?: boolean;
    siteVisit?: boolean;
    whatsappNote?: string;
  }
): Promise<ActionResult<{ connect: boolean }>> {
  if (IS_DEMO) return demo.updateFollowUp(leadId, followUpId, input, actor().uid, actor().email);
  return _updateFollowUp(token, leadId, followUpId, input);
}

/** The Cold review (§3): an admin or the lead's manager rules on it. */
export async function reviewColdLead(
  token: string,
  leadId: string,
  verified: boolean
): Promise<ActionResult> {
  if (IS_DEMO) return demo.reviewColdLead(leadId, verified, actor().uid);
  return _reviewColdLead(token, leadId, verified);
}

/** Hands many existing leads to one employee, without copying any of them. */
export async function assignLeadsBulk(
  token: string,
  leadIds: string[],
  userId: string
): Promise<ActionResult<{ assigned: number; skipped: number }>> {
  if (IS_DEMO) return demo.assignLeadsBulk(leadIds, userId, actor().uid);
  return _assignLeadsBulk(token, leadIds, userId);
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
  input: { name: string; email: string; password: string; priority: number; jobTitle?: string; status?: 'ACTIVE' | 'DISABLED'; targets?: Partial<KpiTargets>; phone?: string | null; notes?: string | null; joinedAt?: string | null; autoAssign?: boolean; accessRole?: 'employee' | 'subadmin'; subAdminUid?: string | null; managerKind?: 'SALES' | 'HR'; monthlySalary?: number }
): Promise<ActionResult<{ uid: string }>> {
  if (IS_DEMO) return demo.createEmployee(input);
  return _createEmployee(token, input);
}

export async function updateEmployee(
  token: string,
  uid: string,
  input: { name?: string; email?: string; password?: string; priority?: number; jobTitle?: string; targets?: Partial<KpiTargets>; phone?: string | null; notes?: string | null; joinedAt?: string | null; autoAssign?: boolean; accessRole?: 'employee' | 'subadmin'; subAdminUid?: string | null; managerKind?: 'SALES' | 'HR'; monthlySalary?: number }
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

/**
 * Saves the attendance policy — start time, grace, absence cutoff, late
 * allowance, deduction rule, leave allowance and the IP settings (§2, §4–§6).
 * A partial patch is merged onto what is stored, so one screen can save one
 * section without resending the rest.
 */
export async function setAttendanceConfig(
  token: string,
  input: Partial<AttendanceConfig>
): Promise<ActionResult<AttendanceConfig>> {
  if (IS_DEMO) return demo.setAttendanceConfig(input);
  return _setAttendanceConfig(token, input);
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

/** The same promotion, for a selection rather than one row (§9). */
export async function promoteDataBankRecords(
  token: string,
  recordIds: string[],
  assignedUserId: string
): Promise<ActionResult<{ promoted: number; skipped: number; leadIds: string[] }>> {
  if (IS_DEMO) return demo.promoteDataBankRecords(recordIds, assignedUserId, actor().uid);
  return _promoteDataBankRecords(token, recordIds, assignedUserId);
}

/** Re-exported so existing client imports from '@/lib/clientActions' keep working. */
export { EXPENSE_CATEGORIES, PAYMENT_METHODS, RECEIVABLE_SIZES } from '@/lib/constants';

/**
 * The Team report for a date range (§4–§6).
 *
 * Scoped on the server from the verified token — an employee cannot ask for
 * somebody else's row by passing a different uid, because there is no uid to
 * pass.
 */
export async function buildTeamReport(
  token: string,
  from: string,
  to: string
): Promise<ActionResult<TeamReport>> {
  if (IS_DEMO) return demo.buildTeamReport(from, to, actor().uid);
  return _buildTeamReport(token, from, to);
}

export type { TeamReport, ReportRow } from '@/app/actions/reports';

/* -------------------------------------------------------------------------- */
/* Client folders — a view over existing leads, never a copy of them           */
/* -------------------------------------------------------------------------- */

export async function createClientFolder(
  token: string,
  input: { name: string; description?: string | null }
): Promise<ActionResult<{ folderId: string }>> {
  if (IS_DEMO) return demo.createClientFolder(input, actor().uid);
  return _createClientFolder(token, input);
}

export async function updateClientFolder(
  token: string,
  folderId: string,
  input: { name?: string; description?: string | null }
): Promise<ActionResult> {
  if (IS_DEMO) return demo.updateClientFolder(folderId, input);
  return _updateClientFolder(token, folderId, input);
}

export async function deleteClientFolder(
  token: string,
  folderId: string
): Promise<ActionResult<{ removed: number }>> {
  if (IS_DEMO) return demo.deleteClientFolder(folderId);
  return _deleteClientFolder(token, folderId);
}

export async function addLeadsToClientFolder(
  token: string,
  folderId: string,
  leadIds: string[]
): Promise<ActionResult<{ added: number; alreadyThere: number }>> {
  if (IS_DEMO) return demo.addLeadsToClientFolder(folderId, leadIds);
  return _addLeadsToClientFolder(token, folderId, leadIds);
}

export async function removeLeadFromClientFolder(
  token: string,
  folderId: string,
  leadId: string
): Promise<ActionResult> {
  if (IS_DEMO) return demo.removeLeadFromClientFolder(folderId, leadId);
  return _removeLeadFromClientFolder(token, folderId, leadId);
}

/* -------------------------------------------------------------------------- */
/* Attendance & leave                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Corrects one employee's day (§11).
 *
 * The observed times are never overwritten — the correction is stored beside
 * them, with who made it and when.
 */
export async function adjustAttendance(
  token: string,
  uid: string,
  dayKey: string,
  change: AttendanceAdjustment
): Promise<ActionResult> {
  if (IS_DEMO) return demo.adjustAttendance(uid, dayKey, change);
  return _adjustAttendance(token, uid, dayKey, change);
}

export async function requestLeave(
  token: string,
  input: { type: LeaveType; from: string; to: string; reason: string; uid?: string }
): Promise<ActionResult<{ requestId: string; days: number }>> {
  if (IS_DEMO) return demo.requestLeave(input, actor().uid);
  return _requestLeave(token, input);
}

/** Approve or reject. Nothing else in the app can write APPROVED (§7). */
export async function decideLeave(
  token: string,
  requestId: string,
  decision: 'APPROVED' | 'REJECTED',
  note?: string
): Promise<ActionResult<{ status: string; days: number }>> {
  if (IS_DEMO) return demo.decideLeave(requestId, decision, note, actor().uid);
  return _decideLeave(token, requestId, decision, note);
}

export async function cancelLeave(token: string, requestId: string): Promise<ActionResult> {
  if (IS_DEMO) return demo.cancelLeave(requestId);
  return _cancelLeave(token, requestId);
}

export async function getLeaveSummary(
  token: string,
  uid?: string,
  year?: string
): Promise<ActionResult<LeaveSummary>> {
  if (IS_DEMO) return demo.getLeaveSummary(uid, year, actor().uid) as ActionResult<LeaveSummary>;
  return _getLeaveSummary(token, uid, year);
}

export async function adjustLeaveBalance(
  token: string,
  uid: string,
  type: LeaveType,
  delta: number
): Promise<ActionResult<{ adjustment: number }>> {
  if (IS_DEMO) return demo.adjustLeaveBalance(uid, type, delta);
  return _adjustLeaveBalance(token, uid, type, delta);
}

export type { LeaveSummary } from '@/app/actions/leave';
export type { AttendanceAdjustment } from '@/app/actions/attendance';

/**
 * A date range of attendance for everyone the caller may see (§9, §10, §11).
 *
 * Read through an action rather than a listener: a Sales manager's team is a
 * property of each employee's profile, not of the attendance row, so the scope
 * check costs one roster read here instead of a rule lookup per day per person.
 */
export async function getTeamAttendance(
  token: string,
  input: { from: string; to: string; uid?: string }
): Promise<ActionResult<TeamAttendanceResult>> {
  if (IS_DEMO) {
    const session = getDemoSession();
    return demo.getTeamAttendance(
      input.from,
      input.to,
      input.uid,
      session?.uid ?? 'demo-admin',
      session?.role ?? 'admin',
      session?.managerKind
    ) as ActionResult<TeamAttendanceResult>;
  }
  return _getTeamAttendance(token, input);
}

export type { TeamAttendanceResult, TeamAttendanceRow, TeamAttendanceDay } from '@/app/actions/attendance';

/**
 * One person's month (§10). The only attendance read an employee may run, and
 * it is scoped to themselves on the server — passing somebody else's uid is
 * refused rather than filtered.
 */
export async function getAttendanceSummary(
  token: string,
  uid?: string,
  monthKey?: string
): Promise<ActionResult<AttendanceSummary>> {
  if (IS_DEMO) {
    return demo.getAttendanceSummary(uid, monthKey, actor().uid) as ActionResult<AttendanceSummary>;
  }
  return _getAttendanceSummary(token, uid, monthKey);
}

export type { AttendanceSummary, AttendanceRules } from '@/app/actions/attendance';

/**
 * Closes a month's late deductions (§12).
 *
 * The figures are **copied** into the period rather than recomputed on read,
 * so raising the deduction next month cannot change what last month cost.
 */
export async function finalizeAttendanceDeductions(
  token: string,
  monthKey: string
): Promise<ActionResult<{ monthKey: string; total: number; people: number }>> {
  if (IS_DEMO) return demo.finalizeAttendanceDeductions(monthKey, actor().uid);
  return _finalizeAttendanceDeductions(token, monthKey);
}

/** Undoing a payroll decision — deliberately its own action, not a second press. */
export async function reopenAttendancePeriod(token: string, monthKey: string): Promise<ActionResult> {
  if (IS_DEMO) return demo.reopenAttendancePeriod(monthKey);
  return _reopenAttendancePeriod(token, monthKey);
}

export async function getAttendancePeriod(
  token: string,
  monthKey: string
): Promise<ActionResult<AttendancePeriod>> {
  if (IS_DEMO) return demo.getAttendancePeriod(monthKey) as ActionResult<AttendancePeriod>;
  return _getAttendancePeriod(token, monthKey);
}

export type { AttendancePeriod, PayrollDeductionLine } from '@/app/actions/attendance';

/* -------------------------------------------------------------------------- */
/* Payroll                                                                     */
/* -------------------------------------------------------------------------- */

export async function listSalaryProfiles(
  token: string
): Promise<ActionResult<{ profiles: SalaryProfileRecord[] }>> {
  if (IS_DEMO) return demo.listSalaryProfiles() as ActionResult<{ profiles: SalaryProfileRecord[] }>;
  return _listSalaryProfiles(token);
}

export async function saveSalaryProfile(
  token: string,
  uid: string,
  input: Partial<SalaryProfile>
): Promise<ActionResult<{ profile: SalaryProfile }>> {
  if (IS_DEMO) return demo.saveSalaryProfile(uid, input, actor().uid);
  return _saveSalaryProfile(token, uid, input);
}

/**
 * Builds a month's payroll as a draft. Safe to re-run while it is still a
 * draft; refused once it is approved or paid.
 */
export async function generatePayroll(
  token: string,
  monthKey: string
): Promise<ActionResult<{ monthKey: string; people: number; net: number }>> {
  if (IS_DEMO) return demo.generatePayroll(monthKey, actor().uid);
  return _generatePayroll(token, monthKey);
}

export async function getPayroll(
  token: string,
  monthKey: string
): Promise<ActionResult<PayrollPeriod>> {
  if (IS_DEMO) return demo.getPayroll(monthKey) as ActionResult<PayrollPeriod>;
  return _getPayroll(token, monthKey);
}

export async function adjustPayrollLine(
  token: string,
  monthKey: string,
  uid: string,
  patch: Partial<PayrollLine>
): Promise<ActionResult<{ net: number }>> {
  if (IS_DEMO) return demo.adjustPayrollLine(monthKey, uid, patch, actor().uid);
  return _adjustPayrollLine(token, monthKey, uid, patch);
}

export async function setPayrollStatus(
  token: string,
  monthKey: string,
  status: PayrollStatus
): Promise<ActionResult<{ status: PayrollStatus }>> {
  if (IS_DEMO) return demo.setPayrollStatus(monthKey, status, actor().uid);
  return _setPayrollStatus(token, monthKey, status);
}

/** Somebody's salary history. An employee gets their own and nobody else's. */
export async function getPayslips(
  token: string,
  uid?: string
): Promise<ActionResult<{ slips: Payslip[] }>> {
  if (IS_DEMO) return demo.getPayslips(uid ?? actor().uid) as ActionResult<{ slips: Payslip[] }>;
  return _getPayslips(token, uid);
}

export async function setSalaryAccess(
  token: string,
  uid: string,
  granted: boolean
): Promise<ActionResult> {
  if (IS_DEMO) return demo.setSalaryAccess(uid, granted);
  return _setSalaryAccess(token, uid, granted);
}

/* -------------------------------------------------------------------------- */
/* Office expenses                                                             */
/* -------------------------------------------------------------------------- */

export async function getExpenseCategories(
  token: string
): Promise<ActionResult<{ categories: string[]; custom: string[] }>> {
  if (IS_DEMO) return demo.getExpenseCategories();
  return _getExpenseCategories(token);
}

export async function manageExpenseCategory(
  token: string,
  action: 'ADD' | 'RENAME' | 'REMOVE',
  name: string,
  renameTo?: string
): Promise<ActionResult<{ categories: string[]; moved?: number }>> {
  if (IS_DEMO) return demo.manageExpenseCategory(action, name, renameTo);
  return _manageExpenseCategory(token, action, name, renameTo);
}

export async function createOfficeExpense(
  token: string,
  input: OfficeExpenseInput
): Promise<ActionResult<{ expenseId: string }>> {
  if (IS_DEMO) return demo.createOfficeExpense(input, actor().uid, actor().email);
  return _createOfficeExpense(token, input);
}

export async function updateOfficeExpense(
  token: string,
  expenseId: string,
  input: OfficeExpenseInput
): Promise<ActionResult> {
  if (IS_DEMO) return demo.updateOfficeExpense(expenseId, input, actor().uid);
  return _updateOfficeExpense(token, expenseId, input);
}

export async function setOfficeExpenseStatus(
  token: string,
  expenseId: string,
  status: ExpenseStatus,
  note?: string
): Promise<ActionResult<{ status: ExpenseStatus }>> {
  if (IS_DEMO) return demo.setOfficeExpenseStatus(expenseId, status, note, actor().uid);
  return _setOfficeExpenseStatus(token, expenseId, status, note);
}

export async function deleteOfficeExpense(token: string, expenseId: string): Promise<ActionResult> {
  if (IS_DEMO) return demo.deleteOfficeExpense(expenseId);
  return _deleteOfficeExpense(token, expenseId);
}

export type {
  PayrollPeriod,
  Payslip,
  SalaryProfileRecord,
} from '@/app/actions/payroll';
export type { OfficeExpenseInput } from '@/app/actions/officeExpenses';

