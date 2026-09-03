/**
 * Pipeline Stage — Cold / P3 / P2 / P1.
 *
 * **The stage is now read off the status** (`STATUS_STAGE` in `leadStatus.ts`,
 * §14). Picking "Meeting Done" makes a lead P2; picking "Token Received" makes
 * it P1. Nobody selects a stage by hand any more, which removes the state this
 * app could previously reach where a lead was marked Negotiation and pinned
 * Cold at once and both were shown as true.
 *
 * Cold is the exception, and deliberately so: it is not something a rep chooses
 * but something that becomes true when a lead has been chased and has not moved
 * — ten follow-ups with the status still in the P3 band. And since a lead going
 * Cold is a write-off, **the rule no longer applies it on its own** (§3). It
 * raises a review instead: `coldPending` here, a notification to the admin and
 * the lead's manager from the follow-up transaction, and a person deciding.
 * `pipelineStageOverride: 'COLD'` is what that decision writes.
 *
 * So there are three states a lead can be in with respect to Cold:
 *
 * | | `stage.value` | `coldPending` |
 * |---|---|---|
 * | being worked | P3 / P2 / P1 | false |
 * | has met the cold rule, nobody has ruled on it | its status band | **true** |
 * | verified cold | COLD | false |
 *
 * Dependency-free apart from the status table, so the unit tests can run it
 * under raw `node --experimental-strip-types`.
 */

// Explicit .ts extension: this module is exercised directly by the unit tests
// under `node --experimental-strip-types`, whose ESM loader needs the real
// specifier. `allowImportingTsExtensions` is already on for exactly this.
import { stageForStatus, type LeadStatus } from './leadStatus.ts';

export type PipelineStage = 'COLD' | 'P3' | 'P2' | 'P1';

/**
 * Cold → P3 → P2 → P1, the owner's own progression.
 *
 * Used for the chip row and any sort that wants worst-first, so the order is
 * defined once and cannot be written backwards somewhere.
 */
export const PIPELINE_STAGES: PipelineStage[] = ['COLD', 'P3', 'P2', 'P1'];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  COLD: 'Cold',
  P3: 'P3',
  P2: 'P2',
  P1: 'P1',
};

/** The full name, for the detail pane and anywhere there is room. */
export const PIPELINE_STAGE_NAMES: Record<PipelineStage, string> = {
  COLD: 'Cold Lead',
  P3: 'P3 — In Conversation',
  P2: 'P2 — Met or Visited',
  P1: 'P1 — Closing',
};

export const PIPELINE_STAGE_DESCRIPTIONS: Record<PipelineStage, string> = {
  COLD: 'Chased repeatedly with no progress, and written off after review.',
  P3: 'Talking: contacted, sent details, following up, negotiating.',
  P2: 'They turned up — a meeting or a site visit has happened.',
  P1: 'Closing: documents, token money, the deal itself.',
};

/**
 * Follow-ups after which a lead that has not progressed is put up for review.
 *
 * Ten was the owner's figure. A constant rather than a literal in the
 * predicate, so the chip counts, the row pills and the copy all move together
 * when it changes.
 *
 * **What "no progress" means here.** There is no telephony or inbox
 * integration, so nothing can observe whether a client picked up. The only
 * signal is the one the rep already gives: moving the status. Ten follow-ups
 * with the status still in the P3 band means ten attempts that produced nothing
 * worth advancing for.
 */
export const COLD_FOLLOW_UP_THRESHOLD = 10;

/** Finished. A lost lead is history and carries no stage. */
const CLOSED_STATUSES: LeadStatus[] = ['CLOSED_LOST', 'NOT_INTERESTED'];

/** Nobody has worked these yet, so there is no progress to describe. */
const INTAKE_STATUSES: LeadStatus[] = ['NEW', 'ASSIGNED', 'UNASSIGNED_NO_CAPACITY'];

export interface PipelineStageInput {
  status: string;
  followUpCount?: number | null;
  /**
   * The verified Cold decision, or a stage pinned before §14 made the status
   * decide. Written only by the Cold review; nothing else sets it any more.
   */
  pipelineStageOverride?: PipelineStage | null;
  /** The retired field name, still read so pins made before the rename resolve. */
  temperatureOverride?: string | null;
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
 * Whether this lead has met the Cold rule.
 *
 * Separate from the stage on purpose: meeting the rule is a fact about the
 * lead, while *being* Cold is a decision somebody made about it (§3).
 */
export function meetsColdRule(lead: PipelineStageInput): boolean {
  if (has(CLOSED_STATUSES, lead.status) || has(INTAKE_STATUSES, lead.status)) return false;

  // Only a lead still in the talking band can go cold. One that has had a
  // meeting or taken token money is not cold however many calls it took.
  if (stageForStatus(lead.status) !== 'P3') return false;

  return (lead.followUpCount ?? 0) >= COLD_FOLLOW_UP_THRESHOLD;
}

/**
 * The stage the status implies, before any Cold decision.
 *
 * `null` means the question does not apply — intake nobody has touched, or a
 * lead that is closed. Giving those a stage would put finished business back
 * into the working filters.
 */
export function autoPipelineStage(lead: PipelineStageInput): PipelineStage | null {
  if (has(CLOSED_STATUSES, lead.status) || has(INTAKE_STATUSES, lead.status)) return null;
  return stageForStatus(lead.status);
}

/**
 * The stage actually shown, whether a person decided it, and whether it is
 * waiting on a Cold review.
 *
 * A closed lead ignores its override — otherwise a lead verified Cold and then
 * marked Not Interested would sit in the Cold filter forever.
 */
export function pipelineStage(lead: PipelineStageInput): {
  value: PipelineStage | null;
  manual: boolean;
  coldPending: boolean;
} {
  if (has(CLOSED_STATUSES, lead.status)) {
    return { value: null, manual: false, coldPending: false };
  }

  const override = readStageOverride(lead);
  if (override) return { value: override, manual: true, coldPending: false };

  return {
    value: autoPipelineStage(lead),
    manual: false,
    // Pending only while nobody has ruled: a verified lead has the override
    // above and never reaches here.
    coldPending: meetsColdRule(lead),
  };
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
  const { value, manual, coldPending } = pipelineStage(lead);

  if (has(CLOSED_STATUSES, lead.status)) return 'Closed leads carry no pipeline stage.';
  if (manual && value === 'COLD') {
    return 'Verified Cold. Change the pipeline status to bring it back into play.';
  }
  if (manual) return `Set to ${PIPELINE_STAGE_NAMES[value!]} by hand.`;
  if (has(INTAKE_STATUSES, lead.status)) {
    return 'Not worked yet — the stage starts once someone takes the lead.';
  }

  if (coldPending) {
    return `${lead.followUpCount ?? 0} follow-ups with no progress. Waiting on an admin or manager to verify moving it to Cold.`;
  }

  if (value === 'P1') return 'P1 — the status puts this lead at the closing stage.';
  if (value === 'P2') return 'P2 — a meeting or a site visit has happened.';

  const remaining = COLD_FOLLOW_UP_THRESHOLD - (lead.followUpCount ?? 0);
  return remaining > 0
    ? `P3 — being worked. Goes up for Cold review after ${remaining} more follow-up${remaining === 1 ? '' : 's'} unless the status moves up.`
    : 'P3 — being worked.';
}
