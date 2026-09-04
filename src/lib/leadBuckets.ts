/**
 * Buckets behind the leads workspace filter chips.
 *
 * The Active / New / Closed pages used to be three routes, each with its own
 * inline status predicate. They are one page now, so the predicates live here
 * — shared by the chips, the counts and the old-route redirects, and unit
 * tested so a status added to `leadStatus.ts` can't silently fall out of every
 * bucket.
 *
 * Each lead lands in exactly one of NEW / ACTIVE / CLOSED. TODAY cuts across
 * all three by creation date, so a lead can be both TODAY and ACTIVE — and so
 * do the four pipeline stages (see `pipelineStage.ts`), which describe how far
 * along a lead is rather than which part of the workflow owns it.
 */

// Explicit .ts extensions: this module is exercised directly by the unit tests
// under `node --experimental-strip-types`, whose ESM loader cannot resolve an
// extensionless specifier. `allowImportingTsExtensions` is already on for
// exactly this, and `pipelineStage.ts` does the same.
import type { LeadStatus } from './leadStatus.ts';
import { resolveRange, withinRange, type DateRange } from './dates.ts';
import { pipelineStage, PIPELINE_STAGES, type PipelineStage } from './pipelineStage.ts';

export type LeadFilterKey =
  | 'ALL' | 'TODAY' | 'NEW' | 'PENDING' | 'ACTIVE' | 'CLOSED' | PipelineStage
  | ActivityFilterKey;

/**
 * Cuts by what has been *done* to a lead rather than where it stands.
 *
 * These are for the employee dossier: "show me the leads this person has
 * actually remarked on / followed up / got through to". They are not on the
 * workspace chip row, because the workspace answers "what is in my pipeline"
 * and these answer "what has this person done" — a different question that
 * deserves its own place rather than four more chips over the pipeline.
 *
 * Read off the counters the follow-up transaction already maintains on the
 * lead, so they cost nothing extra and cannot disagree with the entries.
 */
export type ActivityFilterKey = 'REMARKED' | 'FOLLOWED_UP' | 'CONNECTED';

export const ACTIVITY_FILTERS: ActivityFilterKey[] = ['REMARKED', 'FOLLOWED_UP', 'CONNECTED'];

export function isActivityFilter(key: LeadFilterKey): key is ActivityFilterKey {
  return (ACTIVITY_FILTERS as string[]).includes(key);
}

/**
 * A sub admin sees the same workspace an admin does, scoped to their own
 * employees — so they get the admin chip row. The distinction the chips care
 * about is "manages other people" versus "works their own leads".
 */
export type WorkspaceRole = 'admin' | 'subadmin' | 'employee';

/**
 * Chip order, left to right.
 *
 * The four pipeline stages sit after Closed on both roles, in the owner's own
 * progression — Cold, P3, P2, P1 — so the row reads worst to best and a lead
 * visibly climbs it. They come last because they cut across the workflow
 * buckets rather than continuing them: a P1 lead is also an active one.
 *
 * The admin row has no New chip — removed at the owner's request. Unassigned
 * intake still arrives at the top of All (the default chip, sorted newest
 * first), the notification bell still fires on it, and `?filter=new` is still
 * a valid deep link, so the old route redirect and the /home tile keep working.
 *
 * An employee never sees an unassigned lead at all, so their third chip is
 * PENDING instead: assigned to you, not yet accepted, and on the acceptance
 * clock. That one stays — it is the 5-minute window, and hiding it would cost
 * people leads.
 */
export const ADMIN_FILTER_ORDER: LeadFilterKey[] = ['ALL', 'TODAY', 'ACTIVE', 'CLOSED', ...PIPELINE_STAGES];
export const EMPLOYEE_FILTER_ORDER: LeadFilterKey[] = ['ALL', 'TODAY', 'PENDING', 'ACTIVE', 'CLOSED', ...PIPELINE_STAGES];

export function filterOrderFor(role: WorkspaceRole): LeadFilterKey[] {
  return role === 'employee' ? EMPLOYEE_FILTER_ORDER : ADMIN_FILTER_ORDER;
}

/**
 * Filters a URL may name, which is a wider set than the chips on screen.
 *
 * NEW is parseable for an admin without being a chip, so the retired
 * `/admin/leads/new` route and any bookmark of it still land on the intake
 * queue rather than silently falling back to All.
 */
export function parsableFiltersFor(role: WorkspaceRole): LeadFilterKey[] {
  const chips = filterOrderFor(role);
  return role === 'employee' ? chips : [...chips, 'NEW'];
}

/** The chip that carries a red badge, because it is the one needing action. */
export function urgentFilterFor(role: WorkspaceRole): LeadFilterKey | null {
  // The admin's action bucket was NEW, and NEW is no longer a chip — so on the
  // admin row nothing is badged rather than the badge migrating to a chip that
  // does not mean "needs you".
  return role === 'employee' ? 'PENDING' : null;
}

export const LEAD_FILTER_LABELS: Record<LeadFilterKey, string> = {
  ALL: 'All',
  TODAY: 'Today',
  NEW: 'New',
  PENDING: 'Pending',
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  COLD: 'Cold',
  P3: 'P3',
  P2: 'P2',
  P1: 'P1',
  REMARKED: 'Remarks',
  FOLLOWED_UP: 'Follow-ups',
  CONNECTED: 'Connected',
};

/** One line each, for the chip's tooltip — these are not self-evident. */
export const ACTIVITY_FILTER_HINTS: Record<ActivityFilterKey, string> = {
  REMARKED: 'Remark written, not followed up yet — moves to Follow-ups on the next entry',
  FOLLOWED_UP: 'Has gone past the Remark to at least one follow-up',
  CONNECTED: 'A call was answered — 1:10 or longer, on the Remark or any follow-up',
};

/** True for the four chips that are a pipeline stage rather than a bucket. */
export function isStageFilter(key: LeadFilterKey): key is PipelineStage {
  return (PIPELINE_STAGES as string[]).includes(key);
}

/**
 * Leads that still need someone to pick them up.
 *
 * UNASSIGNED_NO_CAPACITY sits here rather than in ACTIVE: the old Active page
 * counted it as active, but it is a lead no employee has capacity for and it
 * needs the same manual-assignment action as a brand new lead. Grouping it
 * with NEW is what makes the buckets disjoint.
 */
export const INTAKE_STATUSES: LeadStatus[] = ['NEW', 'UNASSIGNED_NO_CAPACITY'];

/** Terminal states — the lead is finished and must not move again (PRD §7). */
export const CLOSED_LEAD_STATUSES: LeadStatus[] = ['CLOSED_WON', 'CLOSED_LOST', 'NOT_INTERESTED'];

export function isIntakeLead(status: string): boolean {
  return INTAKE_STATUSES.includes(status as LeadStatus);
}

export function isClosedLead(status: string): boolean {
  return CLOSED_LEAD_STATUSES.includes(status as LeadStatus);
}

/** Anything being actively worked: assigned, accepted, contacted, negotiating… */
export function isActiveLead(status: string): boolean {
  return !isIntakeLead(status) && !isClosedLead(status);
}

/** Assigned to someone but not yet accepted — the accept window (BR-6). */
export function isPendingLead(status: string): boolean {
  return status === 'ASSIGNED';
}

/**
 * The single bucket a lead belongs to, ignoring date.
 *
 * Buckets stay disjoint per role so the chip counts add up to the total. For an
 * employee ASSIGNED splits out into PENDING; for an admin it stays inside
 * ACTIVE, because an admin cares that it is being worked, not whose clock it is
 * sitting on.
 */
export function bucketOf(
  status: string,
  role: WorkspaceRole = 'admin'
): Extract<LeadFilterKey, 'NEW' | 'PENDING' | 'ACTIVE' | 'CLOSED'> {
  if (isIntakeLead(status)) return 'NEW';
  if (isClosedLead(status)) return 'CLOSED';
  if (role === 'employee' && isPendingLead(status)) return 'PENDING';
  return 'ACTIVE';
}

interface BucketableLead {
  status: string;
  createdAt?: { toDate?: () => Date } | Date | null;
  /** These three feed the stage rule — see `pipelineStage.ts`. */
  followUpCount?: number | null;
  meetingHeld?: boolean | null;
  pipelineStageOverride?: PipelineStage | null;
  /** The retired field name, still read so old pins resolve. */
  temperatureOverride?: string | null;
  /** Connected calls logged against this lead — the CONNECTED cut. */
  connectCount?: number | null;
}

/**
 * Whether a lead answers one of the activity cuts.
 *
 * **Remarks and Follow-ups are two stops on one road, not two labels for the
 * same lead.** The first entry on a lead is its Remark and every later one is
 * a Follow-Up (`lib/followUpKind`), so:
 *
 * | entries | Remarks | Follow-ups |
 * |---|---|---|
 * | 0 | — | — |
 * | 1 | **yes** | — |
 * | 2+ | — | **yes** |
 *
 * A lead that has moved on to follow-ups **leaves** Remarks. The two are
 * disjoint on purpose: the question "who has been remarked on but not chased
 * yet" is the whole reason to have the Remarks cut, and it cannot be answered
 * by a filter that also returns every lead with fifteen follow-ups.
 *
 * **Connected cuts across both**, because it asks something different — was a
 * call actually answered — and that can happen on the Remark or on any
 * follow-up. `connectCount` is the counter `addFollowUp` maintains, and a call
 * counts only at `CONNECT_MIN_SECONDS` (1:10) or longer, so a logged call too
 * short to be a connect is deliberately not here.
 */
export function matchesActivityFilter(lead: BucketableLead, key: ActivityFilterKey): boolean {
  const entries = lead.followUpCount ?? 0;
  if (key === 'REMARKED') return entries === 1;
  if (key === 'FOLLOWED_UP') return entries >= 2;
  return (lead.connectCount ?? 0) >= 1;
}

/**
 * Whether a lead belongs under a given chip.
 *
 * `todayRange` is passed in rather than recomputed per lead — resolving the
 * Karachi day boundary does Intl formatting, which is far too expensive to run
 * once per row on every keystroke.
 */
export function matchesLeadFilter(
  lead: BucketableLead,
  key: LeadFilterKey,
  todayRange?: DateRange,
  role: WorkspaceRole = 'admin'
): boolean {
  if (key === 'ALL') return true;
  if (key === 'TODAY') return withinRange(lead.createdAt, todayRange ?? resolveRange('TODAY'));
  // A stage is orthogonal to the workflow buckets: a P1 lead is also an active
  // one, so these are answered before `bucketOf` is consulted.
  if (isStageFilter(key)) return pipelineStage(lead).value === key;
  // So is activity — a lead somebody has connected with is also active, or
  // closed, or P2. Answered here for the same reason.
  if (isActivityFilter(key)) return matchesActivityFilter(lead, key);
  return bucketOf(lead.status, role) === key;
}

/** Chip counts for one already search-filtered list. */
export function countByFilter(
  leads: BucketableLead[],
  todayRange?: DateRange,
  role: WorkspaceRole = 'admin'
): Record<LeadFilterKey, number> {
  const range = todayRange ?? resolveRange('TODAY');
  const counts: Record<LeadFilterKey, number> = {
    ALL: 0, TODAY: 0, NEW: 0, PENDING: 0, ACTIVE: 0, CLOSED: 0,
    COLD: 0, P3: 0, P2: 0, P1: 0,
    REMARKED: 0, FOLLOWED_UP: 0, CONNECTED: 0,
  };

  for (const lead of leads) {
    counts.ALL += 1;
    counts[bucketOf(lead.status, role)] += 1;
    if (withinRange(lead.createdAt, range)) counts.TODAY += 1;

    const stage = pipelineStage(lead).value;
    if (stage) counts[stage] += 1;

    for (const key of ACTIVITY_FILTERS) {
      if (matchesActivityFilter(lead, key)) counts[key] += 1;
    }
  }

  return counts;
}

/** Maps a retired route to the chip it should land on. */
export function filterFromLegacyPath(path: string): LeadFilterKey {
  if (path.endsWith('/new')) return 'NEW';
  if (path.endsWith('/closed')) return 'CLOSED';
  if (path.endsWith('/active')) return 'ACTIVE';
  return 'ALL';
}

/**
 * Accepts a `?filter=` query value, falling back to ALL.
 *
 * Validated against the filters this role can actually use, so an admin link
 * pasted into an employee session lands on All rather than an empty screen
 * filtered by something that isn't on the page.
 */
export function parseFilterParam(
  raw: string | null | undefined,
  role: WorkspaceRole = 'admin'
): LeadFilterKey {
  const upper = (raw ?? '').toUpperCase();
  return (parsableFiltersFor(role) as string[]).includes(upper) ? (upper as LeadFilterKey) : 'ALL';
}
