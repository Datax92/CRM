/**
 * Pipeline Stage — Cold / P3 / P2 / P1.
 *
 * This replaces the old Hot/Cold "temperature". Two colours could only say
 * *whether* a lead was worth chasing; the sales team needs to know **how far
 * along it is**, because that is what decides who gets called this afternoon.
 * The four stages are the owner's own scale:
 *
 * | stage | meaning | rough completion |
 * |---|---|---|
 * | **Cold** | chased repeatedly, no response | — |
 * | **P3** | responded, little real interest | 20–40% |
 * | **P2** | clearly interested, may have met | 40–70% |
 * | **P1** | almost done, final steps only | 70–100% |
 *
 * **Stage is not Status.** The pipeline *status* (`leadStatus.ts`) is the
 * formal state machine — Assigned, Contacted, Negotiation, Closed / Won — and
 * the system owns most of it. The *stage* is the commercial read on the same
 * lead. Keeping them apart is deliberate: a lead can sit in Follow-Up for three
 * weeks and be either a P3 or a P1 depending on how the calls actually went.
 *
 * Like the temperature it replaces, the stage is **derived on read** from facts
 * the lead already carries, so it can never go stale and needs no backfill:
 * every lead that exists today is classified the moment this ships. A person
 * can overrule the rule from the detail pane — a rep who has just had a
 * promising call knows something the follow-up count does not — and that choice
 * is stored as `pipelineStageOverride` until they clear it.
 *
 * Dependency-free apart from the status list, so the unit tests can run it
 * under raw `node --experimental-strip-types`.
 */

import type { LeadStatus } from './leadStatus';

export type PipelineStage = 'COLD' | 'P3' | 'P2' | 'P1';

/**
 * Cold → P3 → P2 → P1, the order the owner specified.
 *
 * Used for the chip row, the stage selector and any sort that wants worst-first,
 * so the progression is defined once and cannot be written backwards somewhere.
 */
export const PIPELINE_STAGES: PipelineStage[] = ['COLD', 'P3', 'P2', 'P1'];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  COLD: 'Cold',
  P3: 'P3',
  P2: 'P2',
  P1: 'P1',
};

/** The full name, for the selector and the detail pane where there is room. */
export const PIPELINE_STAGE_NAMES: Record<PipelineStage, string> = {
  COLD: 'Cold Lead',
  P3: 'P3 — Low Interest',
  P2: 'P2 — Hot Lead',
  P1: 'P1 — Near Completion',
};

export const PIPELINE_STAGE_DESCRIPTIONS: Record<PipelineStage, string> = {
  COLD: 'Chased repeatedly with no response.',
  P3: 'Responded, but not showing serious interest yet (20–40%).',
  P2: 'Clearly interested — a meeting may have happened (40–70%).',
  P1: 'Almost done. Only the final steps remain (70–100%).',
};

/** The completion band each stage stands for, for the pane's progress read. */
export const PIPELINE_STAGE_RANGE: Record<PipelineStage, { from: number; to: number }> = {
  COLD: { from: 0, to: 20 },
  P3: { from: 20, to: 40 },
  P2: { from: 40, to: 70 },
  P1: { from: 70, to: 100 },
};

/**
 * Follow-ups after which a lead that has not progressed is written off as cold.
 *
 * Ten was the owner's figure. A constant rather than a literal in the
 * predicate, so the chip counts, the row pills and the explanatory copy all
 * move together when it changes.
 *
 * **What "no response" means here.** There is no telephony or inbox
 * integration, so nothing can observe whether a client picked up. The only
 * response signal is the one the rep already gives: moving the pipeline status.
 * Ten follow-ups with the status still parked below Interested means ten
 * attempts that produced nothing worth advancing for.
 */
export const COLD_FOLLOW_UP_THRESHOLD = 10;

/** Final steps only — terms are agreed and the paperwork is what is left. */
const P1_STATUSES: LeadStatus[] = ['NEGOTIATION'];

/** Clearly interested. A held meeting also lands here, whatever the status. */
const P2_STATUSES: LeadStatus[] = ['INTERESTED'];

/** Responded, being worked, nothing decided yet. */
const P3_STATUSES: LeadStatus[] = ['CONTACTED', 'FOLLOW_UP', 'NO_RESPONSE', 'ACCEPTED', 'ASSIGNED'];

/**
 * Statuses that prove the lead *did* engage, so no number of follow-ups makes
 * them cold. Someone called fifteen times who is now negotiating is the
 * opposite of a dead lead.
 */
const PROGRESSED_STATUSES: LeadStatus[] = ['INTERESTED', 'NEGOTIATION', 'CLOSED_WON'];

/** Finished. A closed lead is history and carries no stage either way. */
const CLOSED_STATUSES: LeadStatus[] = ['CLOSED_WON', 'CLOSED_LOST', 'NOT_INTERESTED'];

/** Nobody has worked these yet, so there is no progress to describe. */
const INTAKE_STATUSES: LeadStatus[] = ['NEW', 'UNASSIGNED_NO_CAPACITY'];

export interface PipelineStageInput {
  status: string;
  followUpCount?: number | null;
  /** Set by hand from the detail pane; overrules the rule below. */
  pipelineStageOverride?: PipelineStage | null;
  /**
   * The previous field name, kept readable so leads pinned Hot or Cold before
   * this module existed still resolve. HOT was the closing stages, which is
   * P2 here; COLD is COLD.
   */
  temperatureOverride?: string | null;
  /** True once any follow-up recorded a held meeting — lifts a lead to P2. */
  meetingHeld?: boolean | null;
}

function has(list: LeadStatus[], status: string): boolean {
  return list.includes(status as LeadStatus);
}

/** Accepts either field, and the retired HOT/COLD vocabulary. */
export function readStageOverride(lead: PipelineStageInput): PipelineStage | null {
  const raw = (lead.pipelineStageOverride ?? lead.temperatureOverride ?? '') as string;
  const token = raw.trim().toUpperCase();

  if (token === 'HOT') return 'P2';
  return (PIPELINE_STAGES as string[]).includes(token) ? (token as PipelineStage) : null;
}

/**
 * The rule, with nothing stored: what stage the lead is at on the facts alone.
 *
 * `null` means the question does not apply — intake that nobody has touched,
 * or a lead that is already closed. Giving those a stage would put finished
 * business back into the working filters.
 */
export function autoPipelineStage(lead: PipelineStageInput): PipelineStage | null {
  if (has(CLOSED_STATUSES, lead.status) || has(INTAKE_STATUSES, lead.status)) return null;

  if (has(P1_STATUSES, lead.status)) return 'P1';
  if (has(P2_STATUSES, lead.status) || lead.meetingHeld) return 'P2';

  const followUps = lead.followUpCount ?? 0;
  if (followUps >= COLD_FOLLOW_UP_THRESHOLD && !has(PROGRESSED_STATUSES, lead.status)) {
    return 'COLD';
  }

  return has(P3_STATUSES, lead.status) ? 'P3' : null;
}

/**
 * The stage actually shown, and whether a person put it there.
 *
 * The `manual` flag is what lets the pane offer "Auto" as a way back. Without
 * it, a lead pinned P1 in March would look identical to one the rule called P1
 * this morning and nobody could tell which.
 *
 * A closed lead ignores its override, otherwise a lead pinned P1 and then lost
 * would sit in the P1 filter forever.
 */
export function pipelineStage(lead: PipelineStageInput): {
  value: PipelineStage | null;
  manual: boolean;
} {
  if (has(CLOSED_STATUSES, lead.status)) return { value: null, manual: false };

  const override = readStageOverride(lead);
  if (override) return { value: override, manual: true };

  return { value: autoPipelineStage(lead), manual: false };
}

/** Convenience for the filter chips and counts. */
export function isStage(lead: PipelineStageInput, stage: PipelineStage): boolean {
  return pipelineStage(lead).value === stage;
}

/**
 * Why this lead reads the way it does, in one sentence, for the detail pane.
 * A rule the user cannot see is a rule they will not trust.
 */
export function explainPipelineStage(lead: PipelineStageInput): string {
  const { value, manual } = pipelineStage(lead);

  if (has(CLOSED_STATUSES, lead.status)) return 'Closed leads carry no pipeline stage.';
  if (manual) {
    return `Set to ${PIPELINE_STAGE_NAMES[value!]} by hand. Choose Auto to follow the rule again.`;
  }
  if (has(INTAKE_STATUSES, lead.status)) {
    return 'Not worked yet — the stage starts once someone takes the lead.';
  }

  if (value === 'P1') return 'Automatically P1 — the lead is at the negotiation stage.';
  if (value === 'P2') {
    return lead.meetingHeld && !has(P2_STATUSES, lead.status)
      ? 'Automatically P2 — a meeting has been held.'
      : 'Automatically P2 — the lead is marked interested.';
  }
  if (value === 'COLD') {
    return `Automatically Cold — ${lead.followUpCount ?? 0} follow-ups and the status never reached Interested.`;
  }

  const remaining = COLD_FOLLOW_UP_THRESHOLD - (lead.followUpCount ?? 0);
  return remaining > 0
    ? `P3 — being worked. Goes Cold after ${remaining} more follow-up${remaining === 1 ? '' : 's'} unless the status moves up.`
    : 'P3 — being worked.';
}
