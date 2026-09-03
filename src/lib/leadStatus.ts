/**
 * Pipeline Status — the formal state a lead is in.
 *
 * **The status now decides the stage.** Each user-settable status belongs to
 * exactly one band, P3 / P2 / P1, and picking a status sets the stage with it
 * (§13, §14). Nobody chooses a stage by hand any more, which removes the state
 * this app could previously get into where a lead was marked "Negotiation" and
 * pinned "Cold" at the same time and both were displayed as true.
 *
 * The bands are the sales process, not a severity scale:
 *
 * | band | what it means | statuses |
 * |---|---|---|
 * | **P3** | talking | Accepted → No Response |
 * | **P2** | they showed up | Meeting Done, Site Visit Done |
 * | **P1** | closing | Document Received, Token Received, Deal Closed |
 *
 * `STATUS_STAGE` below is the single source for that mapping — `lib/pipelineStage`
 * reads it rather than restating it, so the two cannot disagree.
 *
 * **Three statuses are the system's, not the user's.** NEW, ASSIGNED and
 * UNASSIGNED_NO_CAPACITY belong to the distribution engine (BR-4 to BR-7) and
 * carry no stage: nobody has worked the lead yet, so there is no progress to
 * describe.
 */

export type LeadStatus =
  // --- the distribution engine's own states -------------------------------
  | 'NEW'
  | 'ASSIGNED'
  | 'UNASSIGNED_NO_CAPACITY'
  // --- P3 · talking --------------------------------------------------------
  | 'ACCEPTED'
  | 'CONTACTED'
  | 'DETAILS_SENT'
  | 'FOLLOW_UP'
  | 'INTERESTED'
  | 'NEGOTIATION'
  | 'NOT_INTERESTED'
  | 'NO_RESPONSE'
  // --- P2 · they showed up -------------------------------------------------
  | 'MEETING_DONE'
  | 'SITE_VISIT_DONE'
  // --- P1 · closing --------------------------------------------------------
  | 'DOCUMENT_RECEIVED'
  | 'TOKEN_RECEIVED'
  | 'CLOSED_WON'
  // --- finished, and not a stage ------------------------------------------
  | 'CLOSED_LOST';

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  UNASSIGNED_NO_CAPACITY: 'Needs Manual Assignment',

  ACCEPTED: 'Accepted',
  CONTACTED: 'Contacted',
  DETAILS_SENT: 'Details Sent',
  FOLLOW_UP: 'Follow-Up',
  // The old label was "Interested", which read as a decision. "Seems" is the
  // rep's own word for it and is honest about how firm it is.
  INTERESTED: 'Seems Interested',
  NEGOTIATION: 'Negotiation',
  NOT_INTERESTED: 'Not Interested',
  NO_RESPONSE: 'No Response',

  MEETING_DONE: 'Meeting Done',
  SITE_VISIT_DONE: 'Site Visit Done',

  DOCUMENT_RECEIVED: 'Document Received',
  TOKEN_RECEIVED: 'Token Received',
  CLOSED_WON: 'Deal Closed',

  CLOSED_LOST: 'Closed / Lost',
};

/**
 * Status → Pipeline Stage. The whole of §14, in one table.
 *
 * A status missing from here has no stage, which is the correct answer for the
 * three system states and for a lost lead.
 */
export const STATUS_STAGE: Partial<Record<LeadStatus, 'P3' | 'P2' | 'P1'>> = {
  ACCEPTED: 'P3',
  CONTACTED: 'P3',
  DETAILS_SENT: 'P3',
  FOLLOW_UP: 'P3',
  INTERESTED: 'P3',
  NEGOTIATION: 'P3',
  NOT_INTERESTED: 'P3',
  NO_RESPONSE: 'P3',

  MEETING_DONE: 'P2',
  SITE_VISIT_DONE: 'P2',

  DOCUMENT_RECEIVED: 'P1',
  TOKEN_RECEIVED: 'P1',
  CLOSED_WON: 'P1',
};

/** The statuses in each band, in the order the selector shows them. */
export const STAGE_STATUSES: Record<'P3' | 'P2' | 'P1', LeadStatus[]> = {
  P3: ['ACCEPTED', 'CONTACTED', 'DETAILS_SENT', 'FOLLOW_UP', 'INTERESTED', 'NEGOTIATION', 'NOT_INTERESTED', 'NO_RESPONSE'],
  P2: ['MEETING_DONE', 'SITE_VISIT_DONE'],
  P1: ['DOCUMENT_RECEIVED', 'TOKEN_RECEIVED', 'CLOSED_WON'],
};

/**
 * Terminal states — a lead here is finished and must not move again
 * (PRD §7 auditability).
 *
 * NOT_INTERESTED stays terminal even though §13 lists it among the P3
 * statuses: the band says what kind of conversation it was, not whether the
 * lead is still open, and re-opening a written-off lead by changing a dropdown
 * would lose the record of when it was written off.
 */
export const TERMINAL_STATUSES: LeadStatus[] = ['CLOSED_WON', 'CLOSED_LOST', 'NOT_INTERESTED'];

/** Statuses the distribution engine owns. Users never set these by hand. */
export const SYSTEM_STATUSES: LeadStatus[] = [
  'NEW',
  'ASSIGNED',
  'ACCEPTED',
  'UNASSIGNED_NO_CAPACITY',
];

/**
 * Statuses a user may select in the lead detail view, grouped by band.
 *
 * CLOSED_WON ("Deal Closed") is offered because §13 lists it, but choosing it
 * does not write: BR-18 requires every won deal through the Entry Module, and
 * `setLeadStatus` refuses it with a message pointing there. The alternative —
 * hiding it — would leave a rep looking for the option the process tells them
 * to pick.
 */
export const USER_SETTABLE_STATUSES: LeadStatus[] = [
  ...STAGE_STATUSES.P3,
  ...STAGE_STATUSES.P2,
  ...STAGE_STATUSES.P1,
  'CLOSED_LOST',
];

/** Leads still moving through the pipeline — used by the no-follow-up scan. */
export const ACTIVE_STATUSES: LeadStatus[] = [
  'ASSIGNED',
  'ACCEPTED',
  'CONTACTED',
  'DETAILS_SENT',
  'FOLLOW_UP',
  'INTERESTED',
  'NEGOTIATION',
  'NO_RESPONSE',
  'MEETING_DONE',
  'SITE_VISIT_DONE',
  'DOCUMENT_RECEIVED',
  'TOKEN_RECEIVED',
];

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as LeadStatus);
}

export function isUserSettable(status: string): boolean {
  return USER_SETTABLE_STATUSES.includes(status as LeadStatus);
}

/** The band a status implies, or null for the system states and a lost lead. */
export function stageForStatus(status: string): 'P3' | 'P2' | 'P1' | null {
  return STATUS_STAGE[status as LeadStatus] ?? null;
}

/**
 * The label for a status that may predate this file.
 *
 * A stored value nobody recognises is title-cased rather than dropped: an
 * unknown status is still better shown than replaced with a blank cell, which
 * would hide the fact that something is writing statuses nobody added here.
 */
export function statusLabel(status: string | null | undefined): string {
  const token = (status ?? '').trim();
  if (!token) return '—';
  return (
    LEAD_STATUS_LABELS[token as LeadStatus] ??
    token.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
