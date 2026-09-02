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

import type { LeadStatus } from './leadStatus';
import { resolveRange, withinRange, type DateRange } from './dates';
import { pipelineStage, PIPELINE_STAGES, type PipelineStage } from './pipelineStage';

export type LeadFilterKey =
  | 'ALL' | 'TODAY' | 'NEW' | 'PENDING' | 'ACTIVE' | 'CLOSED' | PipelineStage;

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
  };

  for (const lead of leads) {
    counts.ALL += 1;
    counts[bucketOf(lead.status, role)] += 1;
    if (withinRange(lead.createdAt, range)) counts.TODAY += 1;

    const stage = pipelineStage(lead).value;
    if (stage) counts[stage] += 1;
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
