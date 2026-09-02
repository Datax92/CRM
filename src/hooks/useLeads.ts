import { useState, useEffect } from 'react';
import { collection, doc, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
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
  kycUpdatedAt?: FirestoreTimestamp;
  kycUpdatedByUid?: string | null;
  /** True once any follow-up recorded a held meeting — lifts the lead to P2. */
  meetingHeld?: boolean;
  attemptedAssignees?: string[];
  createdAt?: FirestoreTimestamp;
  assignedAt?: FirestoreTimestamp;
  acceptedAt?: FirestoreTimestamp;
  closedAt?: FirestoreTimestamp;
  lastActivityAt?: FirestoreTimestamp;
  lastFollowUpAt?: FirestoreTimestamp;
  followUpCount?: number;
  callCount?: number;
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

export interface FollowUpRecord {
  id: string;
  message: string;
  callMade: boolean;
  callCount?: number;
  /** Self-reported call length. Decides `connect` — see lib/kpi. */
  durationSeconds?: number;
  /** Computed server-side from the duration; never trusted from a client. */
  connect?: boolean;
  meetingHeld?: boolean;
  /** `YYYY-MM-DD` in Karachi — backs the one-per-lead-per-day rule. */
  dayKey?: string;
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

/** Guards against unbounded reads on the admin dashboard. */
const LEAD_PAGE_SIZE = 500;

interface LeadState {
  key: string;
  leads: Lead[];
  error: string | null;
}

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
 * | sub admin | `subAdminUid == me` — their team's leads (§10) |
 * | employee | `assignedUserId == me` |
 */
export function useLeads(role: 'admin' | 'subadmin' | 'employee' | null, uid?: string) {
  const [state, setState] = useState<LeadState | null>(null);
  const demoState = useDemoState();

  const key =
    !role || (role !== 'admin' && !uid) ? 'idle' : role === 'admin' ? 'admin' : `${role}:${uid}`;

  useEffect(() => {
    if (IS_DEMO || key === 'idle') return;

    const leadsRef = collection(db, 'leads');
    const scopeField = role === 'subadmin' ? 'subAdminUid' : 'assignedUserId';
    const q =
      key === 'admin'
        ? query(leadsRef, orderBy('createdAt', 'desc'), limit(LEAD_PAGE_SIZE))
        : query(
            leadsRef,
            where(scopeField, '==', uid),
            orderBy('createdAt', 'desc'),
            limit(LEAD_PAGE_SIZE)
          );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setState({
          key,
          leads: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Lead[],
          error: null,
        });
      },
      (err) => {
        console.error('[useLeads]', err);
        setState({ key, leads: [], error: describeFirestoreError(err) });
      }
    );

    return () => unsubscribe();
    // `uid` is encoded in `key`, so the key alone identifies the subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (IS_DEMO) {
    const leads =
      role === 'admin'
        ? demoState.leads
        : demoState.leads.filter((lead) =>
            role === 'subadmin' ? lead.subAdminUid === uid : lead.assignedUserId === uid
          );
    return { leads, loading: false, error: null };
  }

  const current = state?.key === key ? state : null;

  return {
    leads: current?.leads ?? [],
    loading: key !== 'idle' && current === null,
    error: current?.error ?? null,
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
