/**
 * Who is first in line for the next lead, and why.
 *
 * **The lane is earned, not assigned.** Priority 1 sees new leads before anyone
 * else, so it has to be the person who is actually working them — and the owner
 * named the two signals that count: **connected calls** and **follow-ups**.
 *
 * ```
 *   score = connects × 2  +  follow-ups × 1  −  passes × 2
 * ```
 *
 * Three deliberate choices in that line:
 *
 * - **A connect counts double a follow-up.** Reaching a human is the work;
 *   logging an entry is the record of it. Weighting them equally would put
 *   somebody who writes twenty notes above somebody who had ten real
 *   conversations, and the lane would reward typing.
 * - **Passing a lead costs two points**, the owner's figure — the same as
 *   giving back one connected call. Enough that cherry-picking is not free,
 *   small enough that somebody who is driving can still hand a lead on without
 *   being punished for honesty.
 * - **The floor is zero.** A month of nothing but passes must not produce a
 *   negative score that sorts *below* somebody who did nothing at all; both did
 *   no work and both belong at the back.
 *
 * Ranking, never banding: the best performer takes priority 1 even in a weak
 * month, because the lane's job is to order people, not to grade them.
 *
 * Dependency-free so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

/** What each signal is worth. The owner's numbers, in one place. */
export const LEAD_SCORE_WEIGHTS = {
  /** A call that reached `CONNECT_MIN_SECONDS` — somebody actually answered. */
  connect: 2,
  /** Any follow-up entry written on a lead. */
  followUp: 1,
  /** Handing a lead on rather than taking it. Deducted. */
  pass: 2,
} as const;

/** One person's month, as the lane measures it. */
export interface LeadActivity {
  connects: number;
  followUps: number;
  passes: number;
}

export const EMPTY_LEAD_ACTIVITY: LeadActivity = { connects: 0, followUps: 0, passes: 0 };

const count = (value: unknown): number => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Reads a month's counters off a stored document, defaulting every field. */
export function readLeadActivity(raw: Record<string, unknown> | null | undefined): LeadActivity {
  return {
    connects: count(raw?.connects),
    followUps: count(raw?.followUps),
    passes: count(raw?.passes),
  };
}

/**
 * What this month's work is worth.
 *
 * **Floored at zero** — see the module note. A negative score would sort a
 * passer below somebody with no activity at all, which claims a distinction
 * the lane has no business making.
 */
export function leadScore(activity: LeadActivity): number {
  const raw =
    count(activity.connects) * LEAD_SCORE_WEIGHTS.connect +
    count(activity.followUps) * LEAD_SCORE_WEIGHTS.followUp -
    count(activity.passes) * LEAD_SCORE_WEIGHTS.pass;
  return Math.max(0, raw);
}

/** The score broken into its parts, for the screen that has to explain itself. */
export function leadScoreBreakdown(activity: LeadActivity): {
  connects: number;
  followUps: number;
  passes: number;
  total: number;
} {
  return {
    connects: count(activity.connects) * LEAD_SCORE_WEIGHTS.connect,
    followUps: count(activity.followUps) * LEAD_SCORE_WEIGHTS.followUp,
    passes: -count(activity.passes) * LEAD_SCORE_WEIGHTS.pass,
    total: leadScore(activity),
  };
}

export interface RankedPerson {
  uid: string;
  score: number;
  /** Pinned people keep the priority an admin gave them — see below. */
  autoPriority?: boolean;
  /** The priority they hold now, which a pinned person keeps. */
  priority?: number;
}

/**
 * Turns scores into lane positions, 1 first.
 *
 * **A priority an admin set by hand is never moved.** `autoPriority: false` is
 * a deliberate act — "this person is first whatever the numbers say" — and a
 * nightly job quietly undoing it would make the control useless. Pinned people
 * therefore hold their number and the automatic ones fill the positions left
 * over, in score order.
 *
 * Ties break on uid so the result is stable: the same input always produces the
 * same lane, which is what makes it testable and what stops two people
 * swapping places every night for no reason.
 */
export function assignPriorities(
  people: RankedPerson[],
  minPriority: number,
  maxPriority: number
): Map<string, number> {
  const result = new Map<string, number>();

  const pinned = people.filter((person) => person.autoPriority === false);
  const taken = new Set<number>();
  for (const person of pinned) {
    const held = Math.min(Math.max(person.priority ?? minPriority, minPriority), maxPriority);
    result.set(person.uid, held);
    taken.add(held);
  }

  const automatic = people
    .filter((person) => person.autoPriority !== false)
    .sort((a, b) => b.score - a.score || a.uid.localeCompare(b.uid));

  let slot = minPriority;
  for (const person of automatic) {
    while (taken.has(slot) && slot < maxPriority) slot += 1;
    result.set(person.uid, Math.min(slot, maxPriority));
    taken.add(slot);
    slot += 1;
  }

  return result;
}
