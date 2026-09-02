export type LeadStatus =
  | 'NEW'
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'CONTACTED'
  | 'FOLLOW_UP'
  | 'INTERESTED'
  | 'NEGOTIATION'
  | 'CLOSED_WON'
  | 'CLOSED_LOST'
  | 'NOT_INTERESTED'
  | 'NO_RESPONSE'
  | 'UNASSIGNED_NO_CAPACITY';

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  ACCEPTED: 'Accepted',
  CONTACTED: 'Contacted',
  FOLLOW_UP: 'Follow-Up',
  INTERESTED: 'Interested',
  NEGOTIATION: 'Negotiation',
  CLOSED_WON: 'Closed / Won',
  CLOSED_LOST: 'Closed / Lost',
  NOT_INTERESTED: 'Not Interested',
  NO_RESPONSE: 'No Response',
  UNASSIGNED_NO_CAPACITY: 'Needs Manual Assignment',
};

/** Terminal states — a lead here is finished and must not move again (PRD §7 auditability). */
export const TERMINAL_STATUSES: LeadStatus[] = [
  'CLOSED_WON',
  'CLOSED_LOST',
  'NOT_INTERESTED',
];

/** Statuses the distribution engine owns. Users never set these by hand. */
export const SYSTEM_STATUSES: LeadStatus[] = [
  'NEW',
  'ASSIGNED',
  'ACCEPTED',
  'UNASSIGNED_NO_CAPACITY',
];

/**
 * Statuses a user may select in the lead detail view.
 *
 * CLOSED_WON is absent on purpose: BR-18 requires every won deal to go through
 * the Entry Module, so the only way into that status is `closeDeal`.
 */
export const USER_SETTABLE_STATUSES: LeadStatus[] = [
  'CONTACTED',
  'FOLLOW_UP',
  'INTERESTED',
  'NEGOTIATION',
  'CLOSED_LOST',
  'CLOSED_WON',
  'NOT_INTERESTED',
  'NO_RESPONSE',
];

/** Leads still moving through the pipeline — used by the no-follow-up scan. */
export const ACTIVE_STATUSES: LeadStatus[] = [
  'ASSIGNED',
  'ACCEPTED',
  'CONTACTED',
  'FOLLOW_UP',
  'INTERESTED',
  'NEGOTIATION',
  'NO_RESPONSE',
];

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as LeadStatus);
}

export function isUserSettable(status: string): boolean {
  return USER_SETTABLE_STATUSES.includes(status as LeadStatus);
}
