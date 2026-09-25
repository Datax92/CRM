import { useCallback, useState, useEffect, useSyncExternalStore } from 'react';
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  type Timestamp,
} from 'firebase/firestore';
// Metered: counts the reads Google bills, into the server log only.
import { onSnapshot } from '@/lib/firebase/meteredFirestore';
import { db } from '@/lib/firebase/client';
import { useLive } from './useLive';
import { LEAD_WINDOW_FLOOR, leadWindowSize, windowIsFull } from '@/lib/leadWindow';
import { countState, subscribeCount } from '@/lib/liveCount';
import { subscribeSyncedLeads, syncedLeadsState } from '@/lib/leadSync';
import { SERVER_STATE } from '@/lib/liveCollection';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';
import { QUOTA_MESSAGE, isQuotaExhausted } from '@/lib/quotaError';
import type { LeadStatus } from '@/lib/leadStatus';
import type { PipelineStage } from '@/lib/pipelineStage';
import type { KycValues } from '@/lib/kyc';

export type { LeadStatus };

/**
 * Live lead data.
 *
 * These hooks return real Firestore state and nothing else. An earlier version
 * fell back to hardcoded sample leads whenever a query returned empty or
 * errored, which meant a permissions failure looked like a working dashboard
 * full of fictional customers and fictional revenue. Errors now surface as
 * errors.
 *
 * Each hook stamps its results with the subscription key they came from, and
 * `loading` is derived by comparing that stamp to the current key. That keeps
 * every setState inside an async snapshot callback — resetting state from the
 * effect body instead would trigger a cascading render on every change of role
 * or selected lead.
 */

export interface Lead {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  status: LeadStatus;
  source: string;
  campaignId?: string | null;
  campaignName?: string | null;
  adName?: string | null;
  /**
   * The Data Bank folder this lead was promoted out of, denormalised at
   * promotion. Never resolved by joining back to the folder: a folder can be
   * renamed or deleted, and a lead's recorded origin must not change when it
   * is. See `lib/leadSource`.
   */
  dataBankFolderId?: string | null;
  dataBankFolderName?: string | null;
  /** True on a lead an employee brought in themselves (`addPersonalLead`). */
  personalLead?: boolean;
  /**
   * Free text carried from intake — for a Meta lead, the form's extra answers
   * in the customer's own words ("Your Budget of investment: 5 lac to 10 lac").
   * Deliberately not mapped onto typed KYC fields; see `metaNotes`.
   */
  notes?: string | null;
  assignedUserId: string | null;
  assigneeName?: string | null;
  /** Assignment provenance (§9) — who handed this out, and under which team. */
  assignedByUid?: string | null;
  assignedByRole?: string | null;
  assignedByName?: string | null;
  /** The sub admin whose team holds this lead. Absent means the admin's own. */
  subAdminUid?: string | null;
  /** The confirmed client record. See `lib/kyc`. */
  kyc?: KycValues | null;
  /**
   * Money the source sheet already carried, copied on at promotion by the
   * folder's field mapping. Pre-fills Deal Entry so a price that is already in
   * the spreadsheet is not typed again. See `lib/fieldMapping`.
   */
  dealDefaults?: { totalPrice?: number; downPayment?: number; adjustment?: number } | null;
  kycUpdatedAt?: FirestoreTimestamp;
  kycUpdatedByUid?: string | null;
  /** True once any entry recorded a held meeting. */
  meetingHeld?: boolean;
  /**
   * True once any entry recorded a meeting being **agreed** — arranged, not
   * held. One-way, like the two beside it. The all-time reading of the Meeting
   * aligned cut; the period reading comes from the entries themselves.
   */
  meetingAligned?: boolean;
  /** True once any entry recorded a site visit. Counted in Reports (§4). */
  siteVisit?: boolean;
  /**
   * Stamped one-way the first time the status reaches TOKEN_RECEIVED. The
   * status moves on to Deal Closed; the fact that token money arrived does
   * not, so the report reads this rather than the current status.
   */
  tokenReceived?: boolean;
  tokenReceivedAt?: FirestoreTimestamp;
  /**
   * The entry that is still editable (§2). Writing a new one locks whatever
   * came before by simply no longer naming it — so "is this row editable" is a
   * field comparison rather than an ordering read.
   */
  latestFollowUpId?: string | null;
  /**
   * Set when the lead met the Cold rule and a review was raised (§3). Cleared
   * when an admin or the manager rules on it, either way.
   */
  coldReviewRequestedAt?: FirestoreTimestamp;
  coldReviewedAt?: FirestoreTimestamp;
  coldReviewedByUid?: string | null;
  attemptedAssignees?: string[];
  /**
   * The people this lead may go to, stamped at creation from a folder routed to
   * particular employees. Absent means the whole rotation. Server-side routing:
   * read by the cascade, the expiry sweep and Pass on — see `setFolderLane`.
   */
  laneUids?: string[] | null;
  createdAt?: FirestoreTimestamp;
  assignedAt?: FirestoreTimestamp;
  acceptedAt?: FirestoreTimestamp;
  closedAt?: FirestoreTimestamp;
  lastActivityAt?: FirestoreTimestamp;
  lastFollowUpAt?: FirestoreTimestamp;
  followUpCount?: number;
  callCount?: number;
  connectCount?: number;
  meetingCount?: number;
  siteVisitCount?: number;
  adminAssignDeadlineAt?: FirestoreTimestamp;
  acceptDeadlineAt?: FirestoreTimestamp;
  distributionMethod?: 'MANUAL' | 'AUTO' | 'AUTO_REASSIGN';
  /**
   * A Pipeline Stage pin set by hand. Absent on almost every lead — the stage
   * is normally derived from the status and follow-up count on read, so this
   * field records only the exception. See `lib/pipelineStage`.
   */
  pipelineStageOverride?: PipelineStage | null;
  /** The retired field name, still read so pins made before the rename resolve. */
  temperatureOverride?: string | null;
  intakeWarning?: string | null;
  customFields?: Record<string, string>;
}

/** Firestore Timestamps as they arrive on the client. */
export interface FirestoreTimestamp {
  toDate: () => Date;
  toMillis: () => number;
  seconds?: number;
}

/** One revision of an entry, kept when the latest one is edited (§2). */
export interface FollowUpRevision {
  message: string | null;
  callMade: boolean;
  callCount: number;
  durationSeconds: number;
  connect: boolean;
  meetingHeld: boolean;
  meetingAligned?: boolean;
  siteVisit: boolean;
  whatsappNote: string | null;
  editedByUid: string;
  editedByEmail?: string | null;
  editedAt?: FirestoreTimestamp;
}

export interface FollowUpRecord {
  id: string;
  /**
   * Remark or Follow-Up, stored from the day the §1 rule landed. Entries
   * written before that have none, and `entryKindAt` derives it from position
   * for them — see `lib/followUpKind`.
   */
  kind?: 'REMARK' | 'FOLLOW_UP';
  message: string;
  callMade: boolean;
  callCount?: number;
  /** Self-reported call length. Decides `connect` — see lib/kpi. */
  durationSeconds?: number;
  /** Computed server-side from the duration; never trusted from a client. */
  connect?: boolean;
  meetingHeld?: boolean;
  /** A meeting was agreed on this entry — counted in the range by `entryTally`. */
  meetingAligned?: boolean;
  /** Whether the client visited the site. Counted separately in Reports. */
  siteVisit?: boolean;
  /** `YYYY-MM-DD` in Karachi — backs the day rule and the report date range. */
  dayKey?: string;
  /** Who the activity counts for: the lead's employee, not always the author. */
  creditUid?: string | null;
  /** Previous values, oldest first. Empty unless this entry has been edited. */
  revisions?: FollowUpRevision[];
  editedAt?: FirestoreTimestamp;
  editedByUid?: string | null;
  whatsappNote?: string | null;
  occurredAt?: FirestoreTimestamp;
  createdAt?: FirestoreTimestamp;
  authorUid: string;
  authorEmail?: string | null;
}

export interface AuditEventRecord {
  id: string;
  type: string;
  actorUid: string;
  at?: FirestoreTimestamp;
  meta?: Record<string, unknown>;
}

/**
 * Guards against unbounded reads on the admin dashboard.
 *
 * **It is a window over the newest leads, and when the pipeline outgrows it the
 * oldest leads stop being loaded at all.** That is not only a shorter leads
 * list: every screen that asks a question *about* a lead answers it from this
 * array, so a lead outside the window reads as absent rather than as old. The
 * Client section is where that bit first — a folder shows the members still
 * assigned to its owner, and `assignee` is built from these rows, so a member
 * whose lead had fallen out of the window was silently dropped from the folder
 * and from its count.
 *
 * Measured 2026-09-23 on the live project: `leads` crossed 500 on 2026-09-21
 * and stood at 536, and the admin's "Personal Clients" folder — 34 membership
 * rows, all 34 still assigned to the admin, none deleted, none reassigned —
 * displayed **14**. The other 20 were simply older than the 500th newest lead.
 * Nothing was lost; the screen could not see them.
 *
 * **The size is no longer a number anybody chose.** `size` below is the
 * collection's own count plus 25%, rounded to 500, floored at
 * `LEAD_WINDOW_FLOOR` and capped at `LEAD_WINDOW_CEILING` — see `lib/leadWindow`
 * for the arithmetic and `lib/liveCount` for how the count is shared. A constant
 * was a promise somebody had to remember to renew, and the cost of forgetting it
 * was this incident.
 *
 * The ceiling is a circuit breaker rather than a limit — past it the binding
 * constraint is the browser, not the read bill, and `truncated` says so on
 * screen instead of dropping the oldest leads in silence.
 */

/**
 * Every lead the signed-in person is entitled to see.
 *
 * Three scopes, and each one mirrors a clause of the Security Rule rather than
 * filtering after the fact — a list query Firestore cannot prove safe is
 * rejected outright, not trimmed:
 *
 * | role | query |
 * |---|---|
 * | admin | everything, newest first |
 * | HR manager | everything — their reach is the company, see `isHrManager` |
 * | Sales manager | `subAdminUid == me` — their team's leads (§10) |
 * | employee | `assignedUserId == me` |
 */
export function useLeads(
  role: 'admin' | 'subadmin' | 'employee' | null,
  uid?: string,
  /**
   * Read the whole pipeline rather than one team's slice. True for an **HR
   * manager**, whose reach is the company (`isHrManager`) — the Security Rule
   * on `leads` carries the matching `isHr()` clause, so this is not the UI
   * widening its own scope: without that clause the unscoped query would be
   * refused outright, which is what an unscoped list query does here.
   */
  companyWide = false
) {
  const demoState = useDemoState();

  // The admin and an HR manager ask the same question of Firestore, so they
  // share one subscription key: two keys for one query would resubscribe for
  // no reason every time the role resolved.
  const wholePipeline = role === 'admin' || (role === 'subadmin' && companyWide);
  const key = !role || (!wholePipeline && !uid) ? 'idle' : wholePipeline ? 'all' : `${role}:${uid}`;

  /*
    **The window sizes itself to the collection.** Only the whole pipeline is
    counted: it is the one scope that can plausibly reach the floor, and an
    employee or a Sales manager holding two thousand leads is not a thing — if it
    ever became one, `truncated` says so. So a count is one read per admin or HR
    device per half hour, never one per person on the roster.

    A count that has not arrived, or cannot be had, leaves `size` at the floor,
    so nothing waits on it and nothing renders differently for want of it.
  */
  const counted = key === 'all' && !IS_DEMO;
  const buildCount = useCallback(() => collection(db, 'leads'), []);
  const subscribeToCount = useCallback(
    (notify: () => void) => (counted ? subscribeCount('leads:all', buildCount, notify) : () => {}),
    [counted, buildCount]
  );
  const readCount = useCallback(() => (counted ? countState('leads:all') : null), [counted]);
  const leadCount = useSyncExternalStore(subscribeToCount, readCount, () => null);
  const size = counted ? leadWindowSize(leadCount) : LEAD_WINDOW_FLOOR;

  /*
    **Shared, because `leads` is the most expensive thing this app reads and it
    is read everywhere.** 296 documents, opened by the dashboard, the leads
    workspace, the directory and the deals screen — four separate listeners for
    one question. `useLive` gives them one, and holds it briefly after the last
    screen closes so moving between them costs nothing. See `lib/liveCollection`.
  */
  const build = useCallback(() => {
    const leadsRef = collection(db, 'leads');
    const scopeField = role === 'subadmin' ? 'subAdminUid' : 'assignedUserId';
    return key === 'all'
      ? query(leadsRef, orderBy('createdAt', 'desc'), limit(size))
      : query(leadsRef, where(scopeField, '==', uid), orderBy('createdAt', 'desc'), limit(size));
    // `uid` and `role` are both encoded in `key`, so the key and the size
    // together identify the query — depending on the rest as well would rebuild
    // it every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size]);

  /*
    **The whole pipeline syncs only what changed** (owner, 2026-09-23 — the day
    the free read quota ran out). The admin's and HR's list is every lead in
    the business, re-billed in full each time a device reopened the CRM; it now
    comes from the device's copy plus `updatedAt > last visit`, with a full
    sync every six hours. Scoped lists keep the ordinary listener — see
    `lib/leadSync` for why a delta cannot serve them.
  */
  const synced = key === 'all' && !IS_DEMO;
  /*
    **The size is part of the sync key, and that is deliberate.** `leadSync`
    stores its watermark under this key, so a key it has not seen has no meta and
    `planSync` returns FULL — which is exactly right: the device's cached copy
    holds the *old*, smaller window, and serving a delta on top of it would leave
    the admin looking at 2000 leads while the window had grown to 2500. Growing
    therefore costs one full sync per device, once per step — about one every
    twenty days at ~25 leads a day, against the six-hourly full sync that already
    happens. The stale key's meta is left in `localStorage`; it is two numbers,
    and reading it again would mean a device that shrank back to a smaller window
    trusting a watermark from a larger one.
  */
  const syncKey = `leads:all:${size}`;
  const buildDelta = useCallback(
    (since: Timestamp) =>
      query(collection(db, 'leads'), where('updatedAt', '>', since), orderBy('updatedAt', 'asc')),
    []
  );
  const subscribeSynced = useCallback(
    (notify: () => void) =>
      synced ? subscribeSyncedLeads(syncKey, build, buildDelta, describeLiveError, notify) : () => {},
    [synced, syncKey, build, buildDelta]
  );
  const readSynced = useCallback(
    () => (synced ? syncedLeadsState(syncKey) : SERVER_STATE),
    [synced, syncKey]
  );
  const syncedState = useSyncExternalStore(subscribeSynced, readSynced, () => SERVER_STATE);

  const plain = useLive(
    `leads:${key}:${size}`,
    build,
    !IS_DEMO && key !== 'idle' && !synced,
    describeLiveError
  );
  const live = synced ? syncedState : plain;

  if (IS_DEMO) {
    const leads = wholePipeline
      ? demoState.leads
      : demoState.leads.filter((lead) =>
          role === 'subadmin' ? lead.subAdminUid === uid : lead.assignedUserId === uid
        );
    return { leads, loading: false, error: null, truncated: false };
  }

  const rows = live.rows as unknown as Lead[];

  return {
    leads: rows,
    loading: key !== 'idle' && live.loading,
    error: live.error,
    /**
     * The window is full, so there are probably older leads it does not hold.
     *
     * A full window cannot prove more exist — the pipeline may be exactly that
     * long — which is why every reader words this as a possibility. Now that the
     * window grows with the collection, this can only be true at
     * `LEAD_WINDOW_CEILING`, where it means what the notice says: this needs
     * server-side paging, not a bigger number.
     */
    truncated: !live.loading && windowIsFull(rows.length, size),
  };
}

/**
 * One lead, live.
 *
 * The Closed Deals record needs the lead behind a deal — its KYC, its origin,
 * its assignment provenance — and the deal document only carries a denormalised
 * copy of some of that. A single `get` on `leads/{id}` is the cheapest way to
 * the rest, and the Security Rules already scope it: an admin reads any lead, a
 * manager their team's, an employee their own.
 *
 * `null` after loading means the lead is gone or out of scope; the caller shows
 * what the deal itself recorded rather than an error, because a deal outliving
 * its lead is a real state and not a failure.
 */
export function useLeadById(leadId: string | null, enabled = true) {
  const [state, setState] = useState<{ key: string; lead: Lead | null } | null>(null);
  const demoState = useDemoState();
  const key = enabled && leadId ? leadId : 'idle';

  useEffect(() => {
    if (IS_DEMO || key === 'idle' || !leadId) return;

    const unsubscribe = onSnapshot(
      doc(db, 'leads', leadId),
      (snap) => {
        setState({ key: leadId, lead: snap.exists() ? ({ id: snap.id, ...snap.data() } as Lead) : null });
      },
      (err) => {
        console.error('[useLeadById]', err);
        setState({ key: leadId, lead: null });
      }
    );

    return () => unsubscribe();
  }, [key, leadId]);

  if (IS_DEMO) {
    return {
      lead: leadId ? (demoState.leads.find((lead) => lead.id === leadId) ?? null) : null,
      loading: false,
    };
  }

  const current = state?.key === key ? state : null;
  return { lead: current?.lead ?? null, loading: key !== 'idle' && current === null };
}

interface HistoryState {
  key: string;
  followUps: FollowUpRecord[];
  events: AuditEventRecord[];
  error: string | null;
}

export function useLeadHistory(leadId: string | null) {
  const [state, setState] = useState<HistoryState | null>(null);
  const demoState = useDemoState();
  const key = leadId ?? 'idle';

  useEffect(() => {
    if (IS_DEMO || !leadId) return;

    let followUps: FollowUpRecord[] = [];
    let events: AuditEventRecord[] = [];
    let error: string | null = null;

    const publish = () => setState({ key: leadId, followUps, events, error });

    const unsubFollowUps = onSnapshot(
      query(collection(db, 'leads', leadId, 'followUps'), orderBy('occurredAt', 'desc')),
      (snap) => {
        followUps = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as FollowUpRecord[];
        publish();
      },
      (err) => {
        console.error('[useLeadHistory:followUps]', err);
        followUps = [];
        error = describeFirestoreError(err);
        publish();
      }
    );

    const unsubEvents = onSnapshot(
      query(collection(db, 'leads', leadId, 'events'), orderBy('at', 'desc')),
      (snap) => {
        events = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as AuditEventRecord[];
        publish();
      },
      (err) => {
        console.error('[useLeadHistory:events]', err);
        events = [];
        publish();
      }
    );

    return () => {
      unsubFollowUps();
      unsubEvents();
    };
  }, [leadId]);

  if (IS_DEMO) {
    return {
      followUps: leadId ? (demoState.followUps[leadId] ?? []) : [],
      events: leadId ? (demoState.events[leadId] ?? []) : [],
      loading: false,
      error: null,
    };
  }

  const current = state?.key === key ? state : null;

  return {
    followUps: current?.followUps ?? [],
    events: current?.events ?? [],
    loading: Boolean(leadId) && current === null,
    error: current?.error ?? null,
  };
}

export function describeFirestoreError(err: { code?: string; message?: string }): string {
  if (err?.code === 'permission-denied') {
    return 'You do not have access to this data. If you were recently given a role, sign out and sign in again.';
  }
  if (err?.code === 'failed-precondition') {
    return 'This view needs a database index that has not been created yet. Deploy the Firestore indexes and try again.';
  }
  if (err?.code === 'unavailable') {
    return 'Cannot reach the database. Check your connection.';
  }
  if (isQuotaExhausted(err)) {
    return QUOTA_MESSAGE;
  }
  return err?.message ?? 'Could not load data.';
}

/**
 * The same describer, with a stable identity.
 *
 * `useLive` takes it as a dependency, so a fresh closure per render would
 * resubscribe every render and cost exactly what the sharing is there to save.
 */
export const describeLiveError = (error: unknown): string =>
  describeFirestoreError(error as { code?: string; message?: string });
