import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError, type FirestoreTimestamp } from './useLeads';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';

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
 * The folders this person may see.
 *
 * An admin reads every folder, including the ones managers made — §20 says so
 * in as many words. A manager reads their own.
 */
export function useClientFolders(
  enabled = true,
  scope?: { role?: string | null; uid?: string }
) {
  const [state, setState] = useState<{ folders: ClientFolder[]; error: string | null } | null>(null);
  const demoState = useDemoState();

  const ownerOf = scope?.role === 'subadmin' ? (scope.uid ?? null) : null;
  const ready = enabled && (scope?.role !== 'subadmin' || Boolean(ownerOf));

  useEffect(() => {
    if (IS_DEMO || !ready) return;

    const unsubscribe = onSnapshot(
      ownerOf
        ? query(collection(db, 'clientFolders'), where('subAdminUid', '==', ownerOf), orderBy('name'))
        : query(collection(db, 'clientFolders'), orderBy('name')),
      (snap) => {
        setState({
          folders: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as ClientFolder[],
          error: null,
        });
      },
      (err) => {
        console.error('[useClientFolders]', err);
        setState({ folders: [], error: describeFirestoreError(err) });
      }
    );

    return () => unsubscribe();
  }, [ready, ownerOf]);

  if (IS_DEMO) {
    const folders = ownerOf
      ? (demoState.clientFolders ?? []).filter((folder) => folder.subAdminUid === ownerOf)
      : (demoState.clientFolders ?? []);
    return { folders: enabled ? folders : [], loading: false, error: null };
  }

  return {
    folders: ready ? (state?.folders ?? []) : [],
    loading: ready && state === null,
    error: ready ? (state?.error ?? null) : null,
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
  const [state, setState] = useState<{
    key: string;
    members: ClientFolderMember[];
    error: string | null;
  } | null>(null);
  const demoState = useDemoState();

  const ownerOf = scope?.role === 'subadmin' ? (scope.uid ?? null) : null;
  // A manager with no uid yet would issue the unscoped query and be refused.
  const waiting = scope?.role === 'subadmin' && !ownerOf;
  const key = enabled && folderId && !waiting ? `${ownerOf ?? 'admin'}:${folderId}` : 'idle';

  useEffect(() => {
    if (IS_DEMO || key === 'idle') return;

    const clauses = [where('folderId', '==', folderId)];
    if (ownerOf) clauses.push(where('subAdminUid', '==', ownerOf));

    const unsubscribe = onSnapshot(
      query(collection(db, 'clientFolderLeads'), ...clauses, limit(PAGE)),
      (snap) => {
        setState({
          key,
          members: (snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as ClientFolderMember[])
            .sort((a, b) => millisOf(b.addedAt) - millisOf(a.addedAt)),
          error: null,
        });
      },
      (err) => {
        console.error('[useClientFolderMembers]', err);
        setState({ key, members: [], error: describeFirestoreError(err) });
      }
    );

    return () => unsubscribe();
  }, [key, folderId, ownerOf]);

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

  const current = state?.key === key ? state : null;
  return {
    members: current?.members ?? [],
    loading: key !== 'idle' && current === null,
    error: current?.error ?? null,
  };
}
