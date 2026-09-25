/**
 * Leads one employee receives before the lane moves to the next priority.
 *
 * **One, at the owner's instruction (2026-09-17)** — it was eight, then five.
 * A straight round robin: lead 1 to priority 1, lead 2 to priority 2, and back
 * to the top once everybody has had one. With paid WhatsApp leads arriving a
 * few an hour, a turn of five handed one person most of a morning's leads.
 *
 * A missed lead still cascades without spending anybody's turn, so the person
 * who picks it up is not skipped for the next one.
 *
 * Defined here rather than imported: this module is deliberately dependency
 * free so the node test runner can load it directly, without a bundler to
 * resolve extensionless paths.
 */
export const LEADS_PER_TURN = 1;

/**
 * The most leads one person may be set to take in a turn. The admin sets each
 * person's own number on the lane screen (`leadsPerTurn`); this is the ceiling,
 * so a slip of the finger cannot hand one person a whole day's leads.
 */
export const MAX_LEADS_PER_TURN = 10;

/** A person's turn size: their own whole number from 1 to the ceiling, else the lane's default. */
export function normalizeLeadsPerTurn(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN;
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_LEADS_PER_TURN) : LEADS_PER_TURN;
}

/**
 * Whether a stored profile is in the rotation.
 *
 * **The default differs by role, deliberately.** An employee is in unless an
 * admin has taken them out (`autoAssign: false`), so records that predate the
 * setting keep receiving leads. A manager is **out unless an admin has put them
 * in** (`autoAssign: true`): managers were never in the lane, and reading an
 * absent field as "in" would start handing leads to every manager the moment
 * this shipped. One predicate, read by the server's roster and the lane screen,
 * so the screen can never show somebody in rotation whom the server skips.
 */
export function laneMembership(data: Record<string, unknown> | undefined): boolean {
  if (data?.role === 'subadmin') return data.autoAssign === true;
  return data?.autoAssign !== false;
}

export interface Employee {
  uid: string;
  priority: number;
  status: 'ACTIVE' | 'DISABLED';
  /**
   * Whether automatic distribution may hand this person a lead.
   *
   * Absent means yes — every record predating the setting stays in the lane,
   * so adding the field cannot silently empty the rotation. `false` is the
   * directory's "Manual assignment only": the employee keeps working leads and
   * an admin can still assign to them by hand, they simply stop receiving the
   * automatic ones.
   */
  autoAssign?: boolean;
  /** Leads this person takes before the lane moves on. Absent means `LEADS_PER_TURN`. */
  leadsPerTurn?: number;
}

/** In the lane unless an admin has taken them out of it. */
function takesAutoLeads(employee: Employee): boolean {
  return employee.status === 'ACTIVE' && employee.autoAssign !== false;
}

/**
 * One stored `users` document, as the lane needs to see it.
 *
 * **This exists because the mapping is where the bug was.** Every server path
 * that assigns a lead used to build these objects inline, and the cron's copy
 * simply never read `autoAssign` — so `takesAutoLeads` above, and the tests
 * proving it, were being handed `undefined` every time and the rule stopped
 * existing. Measured on 2026-09-14: four of five employees were marked out of
 * distribution and all four were still being given automatic leads.
 *
 * That is this project's most-repeated failure — a field typed on an interface
 * and never taken out of the snapshot, now ten occurrences — and it survives
 * typecheck, lint and clicking around every time, because the symptom is a
 * confident default rather than an error. One mapper, in the same
 * dependency-free module as the rule it feeds, so the tests can reach it.
 */
export function readLaneEmployee(uid: string, data: Record<string, unknown>): Employee {
  return {
    uid,
    // 99 puts an employee with no priority at the back rather than the front;
    // an absent field must never read as "first in line".
    priority: typeof data.priority === 'number' ? data.priority : 99,
    status: data.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    // An employee is in unless marked out; a manager is out unless marked in.
    // See `laneMembership`.
    autoAssign: laneMembership(data) ? undefined : false,
    leadsPerTurn: normalizeLeadsPerTurn(data.leadsPerTurn),
  };
}

/**
 * The name a lead carries for whoever holds it, read off their profile.
 *
 * **Every write that moves a lead writes this beside `assignedUserId`.** The
 * cascade and Pass on used to move the uid and leave the name behind, so a lead
 * that went Aroosa → Rafia still said "Aroosa" wherever the screen reads the
 * stored name — search, and the duplicate message that tells a salesperson
 * who already holds a number. One reader, so the lane and the manual paths
 * cannot spell it differently.
 */
export function laneDisplayName(data: Record<string, unknown> | undefined): string | null {
  const pick = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return pick(data?.name) ?? pick(data?.email);
}

/* -------------------------------------------------------------------------- */
/* A folder's own lane                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The most people one folder may be routed to.
 *
 * A routing list is a decision — "these leads are ESMR's team's" — not a copy
 * of the roster. The cap is what stops a stray payload turning into a getAll of
 * every user document inside a transaction that must stay small.
 */
export const MAX_LANE_UIDS = 25;

/**
 * The uids a folder's leads are restricted to, cleaned up.
 *
 * Empty means **no restriction** — the whole rotation, which is what every
 * folder that predates this setting means and why absence can never quietly
 * take a folder out of distribution. Junk, duplicates and blanks are dropped
 * rather than refused: the stored list is read on the path that distributes a
 * paid lead, and refusing there would leave the lead sitting in the Data Bank.
 */
export function normalizeLaneUids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const uids: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const uid = raw.trim();
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    uids.push(uid);
    if (uids.length >= MAX_LANE_UIDS) break;
  }
  return uids;
}

/**
 * One person an admin has chosen for a folder, as that folder's lane sees them.
 *
 * **The choice overrides `autoAssign`, and never overrides `status`.** Being
 * out of the general rotation is a statement about incoming volume — "do not
 * hand me the ordinary flow" — and an admin naming somebody on this one folder
 * is a later, narrower instruction that should win; otherwise the picker would
 * offer people it then silently skips. A **disabled** account is different: the
 * person has no access at all, so a lead left with them is a lead nobody can
 * work. Managers and the admin are read by the same function as an employee —
 * inside a folder's own lane everybody takes their turn on the same terms,
 * which is the owner's instruction (2026-09-22).
 */
export function readChosenLaneMember(uid: string, data: Record<string, unknown>): Employee {
  return {
    uid,
    // No priority — the admin, usually — sorts to the back of the group rather
    // than the front. An absent field must never read as "first in line".
    priority: typeof data.priority === 'number' ? data.priority : 99,
    status: data.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    autoAssign: undefined,
    leadsPerTurn: normalizeLeadsPerTurn(data.leadsPerTurn),
  };
}

export interface CycleState {
  [uid: string]: number; // leads assigned to this employee in the current cycle
}

export interface AssigneeResolution {
  uid: string | null;
  newState: CycleState;
  /** True when the rotation wrapped around and every counter was cleared. */
  cycleReset: boolean;
}

/**
 * Resolves the next assignee under the priority + rotation rule (BR-6,
 * architecture.md §4.2) and returns the updated cycle state.
 *
 * The rule as implemented: the highest-priority active employee receives
 * `LEADS_PER_TURN` leads, then the next priority receives theirs, and so on;
 * once the lowest priority completes their turn the cycle resets and it starts
 * again from priority 1. Disabled employees are skipped without breaking the sequence.
 *
 * NOTE (PRD §8 open question 1): only auto-assignments advance these counters —
 * a lead the admin hands out manually inside the 5-minute window does not
 * consume anyone's turn. That is the behaviour the system already had; it is
 * flagged for client confirmation rather than changed here.
 *
 * `excludeUids` covers reassignment: an employee who has already been offered
 * this lead and let it expire is skipped for subsequent passes, but keeps their
 * cycle counter so their place in the rotation is not lost.
 *
 * Pure and total — no I/O, no clock, no randomness. See distribution.test.ts.
 */
export function getNextAssigneeAndState(
  employees: Employee[],
  cycleState: CycleState,
  excludeUids: string[] = [],
  bypassRotation: boolean = false
): AssigneeResolution {
  const excluded = new Set(excludeUids);

  const activeEmployees = employees
    .filter(takesAutoLeads)
    .sort((a, b) => a.priority - b.priority || a.uid.localeCompare(b.uid));

  const eligible = activeEmployees.filter((e) => !excluded.has(e.uid));

  if (eligible.length === 0) {
    return { uid: null, newState: cycleState, cycleReset: false };
  }

  if (bypassRotation) {
    const selected = eligible[0];
    return {
      uid: selected.uid,
      newState: cycleState,
      cycleReset: false,
    };
  }

  // Whoever has not yet taken their turn, in priority order.
  const withCapacity = eligible.find(
    (e) => (cycleState[e.uid] ?? 0) < normalizeLeadsPerTurn(e.leadsPerTurn)
  );

  if (withCapacity) {
    return {
      uid: withCapacity.uid,
      newState: { ...cycleState, [withCapacity.uid]: (cycleState[withCapacity.uid] ?? 0) + 1 },
      cycleReset: false,
    };
  }

  // Everyone eligible has taken their turn — wrap around and start a new cycle.
  //
  // Counters are cleared for the whole active roster, not just the eligible
  // subset. Clearing only the eligible ones would leave an excluded employee
  // sitting at a full turn into the next cycle and silently cost them their turn.
  const selected = eligible[0];
  const newState: CycleState = {};
  for (const employee of activeEmployees) {
    newState[employee.uid] = 0;
  }
  newState[selected.uid] = 1;

  return { uid: selected.uid, newState, cycleReset: true };
}

/* -------------------------------------------------------------------------- */
/* Priority lane cascade                                                      */
/* -------------------------------------------------------------------------- */

export interface CascadeResolution {
  uid: string | null;
  /**
   * True when the lane came back round to the top: everybody active had already
   * been offered this lead, so this hop starts a new lap.
   *
   * The caller uses it to clear `attemptedAssignees` — without that reset the
   * exclusion list would keep growing and the second lap would find nobody.
   */
  wrapped: boolean;
}

/**
 * Who receives a lead whose accept window just lapsed.
 *
 * The lane runs strictly by priority — 1 first, then 2, and so on — skipping
 * anyone who has already been offered this lead on this lap. That exclusion is
 * what stops two employees handing a lead back and forth inside one lap while
 * a third never sees it.
 *
 * **The lane is a loop, and has no floor** (owner, 2026-09-22). When the last
 * person in the queue lets the window lapse, the lead goes back to priority 1
 * and round again, for as long as it takes somebody to accept. It used to
 * *force-accept* at the end of the lane — the last employee left got the lead
 * with no window and no way to decline — and the owner's instruction is that
 * a lead nobody has accepted should keep being offered rather than being
 * parked on whoever happened to be last.
 *
 * **What that costs, stated plainly**: a lead nobody ever accepts is re-offered
 * every sweep, for ever. At a five-minute sweep that is ~288 hops a day for one
 * stuck lead — see `reassignExpiredLead`, which is why a miss is red-flagged and
 * charged **once per person per lead** rather than once per hop.
 *
 * A single-person lane is the same rule taken literally: first and last are the
 * same person, so the lead is re-offered to them with a fresh window each time.
 *
 * Rotation counters are deliberately not consulted or advanced here. A turn is
 * about sharing *incoming volume*; a cascade is about catching a miss, and
 * making a missed lead consume someone's turn would penalise the employee who
 * cleaned up after a colleague.
 *
 * Pure and total — no I/O, no clock, no randomness. See distribution.test.ts.
 */
export function resolveCascadeAssignee(
  employees: Employee[],
  attemptedUids: string[] = []
): CascadeResolution {
  const attempted = new Set(attemptedUids);

  const active = employees
    .filter(takesAutoLeads)
    .sort((a, b) => a.priority - b.priority || a.uid.localeCompare(b.uid));

  // Nobody in the lane at all. The caller parks the lead for the admin rather
  // than inventing a recipient — the one case that is not a loop.
  if (active.length === 0) return { uid: null, wrapped: false };

  const eligible = active.filter((e) => !attempted.has(e.uid));

  // Still somebody further down this lap.
  if (eligible.length > 0) return { uid: eligible[0].uid, wrapped: false };

  // Everybody has had a turn — back to priority 1 and round again.
  return { uid: active[0].uid, wrapped: true };
}


/* -------------------------------------------------------------------------- */
/* Quiet hours — the lane waits overnight                                      */
/* -------------------------------------------------------------------------- */

/**
 * The lane's night (owner, 2026-09-23), Karachi time: from 22:00 until 09:00
 * an offer does not expire, so nothing circles the lane while nobody is
 * working.
 *
 * **Why:** the lane loops until somebody accepts, one hop every five minutes.
 * A lead that arrived at 23:00 used to go round ~130 times before anyone
 * woke, each hop ~15 reads and ~4 writes, a red flag against whoever was
 * holding it at the time, and a pile of EXPIRED events nobody reads — on the
 * free plan, a real share of the day's read quota spent overnight.
 *
 * **How:** an offer made in quiet hours is given a deadline of 09:00 plus the
 * ordinary window, instead of now plus the window. The person it was offered
 * to can accept it any time before then — at midnight if they are awake — and
 * if they have not by 09:05 the lane carries on exactly as in the day. The
 * sweep has nothing to do overnight because nothing has expired. Nothing about
 * the order of the lane, the rotation or who is offered first changes.
 */
export const LANE_QUIET_FROM_HOUR = 22;
export const LANE_QUIET_UNTIL_HOUR = 9;

const KARACHI_OFFSET_MS = 5 * 3_600_000; // UTC+5, no daylight saving
const DAY_MS = 86_400_000;

/**
 * A one-morning hold (owner, 2026-09-25, while the day's read allowance ran
 * out): every offer made before 10:40 Karachi on 2026-09-26 opens at 10:40 or
 * a few minutes after, spread by the lead's id into four-minute slots, so the
 * waiting leads reach people one or two at a time instead of all at once. The
 * popup shows an offer only once its slot has opened (`offerOpensAt`). It
 * applies to nothing before the evening of the 25th or after 10:40 on the 26th.
 */
export const LANE_HOLD_UNTIL = Date.parse("2026-09-26T10:40:00+05:00");
const LANE_HOLD_FROM = LANE_HOLD_UNTIL - 18 * 3_600_000;
const HOLD_SLOTS = 6;
const HOLD_GAP_MS = 4 * 60_000;

function holdSlot(seed: string | undefined): number {
  let hash = 0;
  for (const char of seed ?? "") hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % HOLD_SLOTS) * HOLD_GAP_MS;
}

/** When the lane resumes, in epoch ms, if `nowMs` is inside quiet hours; else null. */
export function laneResumesAt(nowMs: number, seed?: string): number | null {
  if (nowMs >= LANE_HOLD_FROM && nowMs < LANE_HOLD_UNTIL) return LANE_HOLD_UNTIL + holdSlot(seed);
  const local = nowMs + KARACHI_OFFSET_MS;
  const hour = new Date(local).getUTCHours();
  if (hour < LANE_QUIET_FROM_HOUR && hour >= LANE_QUIET_UNTIL_HOUR) return null;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  const resumeLocal = dayStart + LANE_QUIET_UNTIL_HOUR * 3_600_000 + (hour >= LANE_QUIET_FROM_HOUR ? DAY_MS : 0);
  return resumeLocal - KARACHI_OFFSET_MS;
}

/** The accept deadline for an offer made at `nowMs`: the window, from now or from the morning. */
export function acceptDeadlineFrom(nowMs: number, windowMs: number, seed?: string): Date {
  return new Date((laneResumesAt(nowMs, seed) ?? nowMs) + windowMs);
}

/** When an offer's window opened (or opens) — the popup waits for it. */
export function offerOpensAt(deadlineMs: number, windowMs: number): number {
  return deadlineMs - windowMs;
}

/**
 * Time left on an offer, as the popup and the cards print it. Under an hour it
 * is the ticking `4:12`; an overnight offer (see `acceptDeadlineFrom`) reads
 * `10h 04m` rather than `604:12`.
 */
export function formatTimeLeft(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total >= 3600) {
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The sentence an offer's notification ends with. By day it is the window; in
 * quiet hours the deadline is the morning (`acceptDeadlineFrom`), and saying
 * "5 minutes" at 23:00 would send somebody scrambling for a lead that waits
 * until 09:05.
 */
export function acceptWindowPhrase(nowMs: number, windowMinutes: number, seed?: string): string {
  const resume = laneResumesAt(nowMs, seed);
  if (resume === null) return `You have ${windowMinutes} minutes to accept.`;
  const by = new Date(resume + windowMinutes * 60_000 + KARACHI_OFFSET_MS);
  const hh = String(by.getUTCHours()).padStart(2, "0");
  const mm = String(by.getUTCMinutes()).padStart(2, "0");
  return `You can accept it until ${hh}:${mm}.`;
}
