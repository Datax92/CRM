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

/** One folder's membership rows. The leads themselves come from `useLeads`. */
export function useClientFolderMembers(folderId: string | null, enabled = true) {
  const [state, setState] = useState<{
    key: string;
    members: ClientFolderMember[];
    error: string | null;
  } | null>(null);
  const demoState = useDemoState();
  const key = enabled && folderId ? folderId : 'idle';

  useEffect(() => {
    if (IS_DEMO || key === 'idle') return;

    const unsubscribe = onSnapshot(
      query(
        collection(db, 'clientFolderLeads'),
        where('folderId', '==', folderId),
        orderBy('addedAt', 'desc'),
        limit(PAGE)
      ),
      (snap) => {
        setState({
          key,
          members: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as ClientFolderMember[],
          error: null,
        });
      },
      (err) => {
        console.error('[useClientFolderMembers]', err);
        setState({ key, members: [], error: describeFirestoreError(err) });
      }
    );

    return () => unsubscribe();
  }, [key, folderId]);

  if (IS_DEMO) {
    return {
      members: folderId
        ? (demoState.clientFolderLeads ?? []).filter((row) => row.folderId === folderId)
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
