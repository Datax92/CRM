import { useCallback, useMemo } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeLiveError, useLeads, type FirestoreTimestamp } from './useLeads';
import { useLive } from './useLive';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';
import { countOwnClientLeads, isOwnClientFolder } from '@/lib/clientFolderScope';

/**
 * Client folders — a curated view over leads that already exist (§15–§20).
 *
 * Two collections, and the split is deliberate: `clientFolders` is the folder
 * itself, `clientFolderLeads` is one row per lead in it. A folder never holds
 * an array of lead ids — see `actions/clients` for why — so a folder with two
 * hundred leads costs one document plus the rows a page actually shows.
 *
 * Every query mirrors a clause of its Security Rule rather than filtering
 * afterwards, because Firestore rejects a list query it cannot prove safe
 * before running it.
 */

export interface ClientFolder {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  /** The manager who owns it. Absent means it is the admin's. */
  subAdminUid?: string | null;
  leadCount: number;
  /**
   * Set on a folder mirrored out of the Data Bank — the source it was imported
   * from. Kept so the link back to the origin survives a rename on either
   * side, and so the folder can say where its leads came from.
   */
  dataBankFolderId?: string | null;
  dataBankFolderName?: string | null;
  /** Whose folder it is. A manager's carries their uid; the admin's does not. */
  ownerUid?: string | null;
  ownerRole?: 'admin' | 'subadmin';
  createdByUid: string;
  createdByName?: string | null;
  createdAt?: FirestoreTimestamp;
}

export interface ClientFolderMember {
  id: string;
  folderId: string;
  leadId: string;
  leadName?: string | null;
  /** The Data Bank folder the lead was promoted out of, when it was. */
  dataBankFolderId?: string | null;
  subAdminUid?: string | null;
  addedByUid: string;
  addedAt?: FirestoreTimestamp;
}

const PAGE = 300;

/** Newest first, from whatever shape the timestamp arrives in. */
function millisOf(value: FirestoreTimestamp | undefined): number {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return value.toDate?.()?.getTime() ?? 0;
}

/**
 * The folders this person owns.
 *
 * **Personal, for every role.** A manager reads their own by the query their
 * rule checks. The admin's query is unscoped — the rule lets an admin read
 * every folder — and is narrowed to the admin's own here, because showing the
 * managers' folders in the admin's Clients is what put an HR manager's
 * self-assigned leads on the admin's screen and listed one source three times.
 * See `lib/clientFolderScope`.
 */
export function useClientFolders(
  enabled = true,
  scope?: { role?: string | null; uid?: string }
) {
  const demoState = useDemoState();

  const ownerOf = scope?.role === 'subadmin' ? (scope.uid ?? null) : null;
  const ready = enabled && (scope?.role !== 'subadmin' || Boolean(ownerOf));

  // Shared and held between screens (`lib/liveCollection`) — it was a listener
  // of its own on every mount; see `useDataBankFolders` for the measurement.
  const build = useCallback(
    () =>
      ownerOf
        ? query(collection(db, 'clientFolders'), where('subAdminUid', '==', ownerOf), orderBy('name'))
        : query(collection(db, 'clientFolders'), orderBy('name')),
    [ownerOf]
  );
  const live = useLive(`clientFolders:${ownerOf ?? 'all'}`, build, !IS_DEMO && ready, describeLiveError);

  const viewer = { role: scope?.role ?? null, uid: scope?.uid ?? null };

  if (IS_DEMO) {
    const folders = (demoState.clientFolders ?? []).filter((folder) => isOwnClientFolder(folder, viewer));
    return { folders: enabled ? folders : [], loading: false, error: null };
  }

  return {
    folders: ready
      ? (live.rows as unknown as ClientFolder[]).filter((folder) => isOwnClientFolder(folder, viewer))
      : [],
    loading: ready && live.loading,
    error: ready ? live.error : null,
  };
}

/**
 * One folder's membership rows. The leads themselves come from `useLeads`.
 *
 * **A manager's query carries their own uid**, because the rule for
 * `clientFolderLeads` is `subAdminUid == request.auth.uid` and Firestore checks
 * a list query against the rules *before* running it. Scoping only by
 * `folderId` cannot prove that clause, so the whole query was refused and a
 * manager opening their own Client folder saw an empty list — the folder was
 * there, every lead inside it was invisible.
 *
 * **Ordered in memory rather than by the query.** Two equality filters with no
 * `orderBy` are served by Firestore's automatic single-field indexes; adding
 * `orderBy('addedAt')` would demand a three-field composite index that does not
 * exist and that this project cannot currently deploy. A folder holds a
 * bounded number of rows and they are already capped at `PAGE`, so sorting
 * them here costs nothing and removes the dependency entirely.
 */
export function useClientFolderMembers(
  folderId: string | null,
  enabled = true,
  scope?: { role?: string | null; uid?: string }
) {
  const demoState = useDemoState();

  const ownerOf = scope?.role === 'subadmin' ? (scope.uid ?? null) : null;
  // A manager with no uid yet would issue the unscoped query and be refused.
  const waiting = scope?.role === 'subadmin' && !ownerOf;
  const active = enabled && Boolean(folderId) && !waiting;

  const build = useCallback(() => {
    const clauses = [where('folderId', '==', folderId)];
    if (ownerOf) clauses.push(where('subAdminUid', '==', ownerOf));
    return query(collection(db, 'clientFolderLeads'), ...clauses, limit(PAGE));
  }, [folderId, ownerOf]);
  const live = useLive(
    `clientFolderMembers:${ownerOf ?? 'admin'}:${folderId ?? ''}`,
    build,
    !IS_DEMO && active,
    describeLiveError
  );

  const members = useMemo(
    () =>
      (live.rows as unknown as ClientFolderMember[])
        .slice()
        .sort((a, b) => millisOf(b.addedAt) - millisOf(a.addedAt)),
    [live.rows]
  );

  if (IS_DEMO) {
    return {
      members: folderId
        ? (demoState.clientFolderLeads ?? []).filter(
            (row) => row.folderId === folderId && (!ownerOf || row.subAdminUid === ownerOf)
          )
        : [],
      loading: false,
      error: null,
    };
  }

  return {
    members: active ? members : [],
    loading: active && live.loading,
    error: active ? live.error : null,
  };
}

/**
 * Every membership row across this person's own Client folders — what the
 * folder list needs to say how many leads each folder really shows.
 *
 * A manager's rows carry their uid; the admin's are written with
 * `subAdminUid: null`, which is an equality Firestore can match. Either way one
 * equality clause, served by the automatic index, and exactly the clause the
 * `clientFolderLeads` rule checks for a manager.
 */
export function useOwnClientMembers(
  enabled = true,
  scope?: { role?: string | null; uid?: string }
) {
  const demoState = useDemoState();

  const role = scope?.role ?? null;
  const uid = scope?.uid ?? null;
  const active = enabled && Boolean(uid) && (role === 'admin' || role === 'subadmin');
  // The admin's rows are the ones written with `subAdminUid: null`, whoever the
  // admin is, so every admin shares one key.
  const owner = role === 'subadmin' ? uid : null;

  const build = useCallback(
    () => query(collection(db, 'clientFolderLeads'), where('subAdminUid', '==', owner), limit(2000)),
    [owner]
  );
  const live = useLive(`clientFolderLeads:${owner ?? 'admin'}`, build, !IS_DEMO && active, describeLiveError);

  if (IS_DEMO) {
    return { members: active ? (demoState.clientFolderLeads ?? []) : [], loading: false, error: null };
  }

  return {
    members: active ? (live.rows as unknown as ClientFolderMember[]) : [],
    loading: active && live.loading,
    error: active ? live.error : null,
  };
}

/**
 * The leads visible to this viewer's own Client section: how many each folder
 * shows, and — given a folder's members — which ones.
 *
 * Reads the shared `useLeads` subscription the leads screens already hold, so
 * asking "is this lead still assigned to me" costs nothing extra.
 *
 * **That subscription is a capped window, and the cap is why this hook now
 * reports `truncated`.** A member whose lead is older than the window simply
 * is not in `assignee`, so it reads as "assigned to somebody else" and is left
 * out of both the count and the folder. On 2026-09-23 that hid 20 of the
 * admin's 34 Personal Clients. The window is bigger now; the flag is what
 * makes the next time visible instead of silent.
 */
export function useOwnClientLeads(
  enabled: boolean,
  scope: { role?: string | null; uid?: string; managerKind?: string | null },
  /** False when only `assignee` is wanted — one folder's view needs no counts. */
  withCounts = true
) {
  const role = scope.role === 'admin' || scope.role === 'subadmin' ? scope.role : null;
  const uid = scope.uid ?? '';
  const { leads, loading: leadsLoading, truncated } = useLeads(
    enabled ? role : null,
    uid || undefined,
    role === 'subadmin' && scope.managerKind === 'HR'
  );
  const { members, loading: membersLoading } = useOwnClientMembers(enabled && withCounts, { role, uid });

  const assignee = useMemo(
    () => new Map(leads.map((lead) => [lead.id, lead.assignedUserId ?? null])),
    [leads]
  );
  const counts = useMemo(
    () => countOwnClientLeads(members, uid, (leadId) => assignee.get(leadId)),
    [members, uid, assignee]
  );

  return {
    counts,
    /** Lead id → current assignee, for `ownClientLeadIds`. */
    assignee,
    loading: enabled && (leadsLoading || membersLoading),
    /**
     * The leads window is full, so a member whose lead sits outside it is
     * absent from `assignee` and is counted as somebody else's — which
     * understates the folder without saying so. The screens say so.
     */
    truncated,
  };
}
