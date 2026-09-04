"use client";

/**
 * Data Bank reads.
 *
 * The folder list is a live listener — there will be a handful of folders and
 * their counts should move as an import runs.
 *
 * The **records are paged with Firestore cursors**, not loaded whole. This is
 * the one list in the app that can hold 20,000 documents, and pulling them all
 * into the browser would cost 20,000 reads every time somebody opens a folder,
 * for a list nobody scrolls past the first screen of. Everything else in this
 * app can afford to load its collection; this cannot.
 *
 * Search is served by the same index rather than by filtering in memory: a
 * name prefix (`orderBy name` + a range) or, when the box looks like a phone
 * number, an exact match on the dedupe key.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  type QueryDocumentSnapshot,
  type DocumentData,
  type Query,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { describeFirestoreError, type FirestoreTimestamp } from "./useLeads";
import { IS_DEMO, useDemoState } from "@/lib/demo/store";
import { phoneKey, type DataBankField, type DataBankStatus, type FieldRoles, type ColumnMap } from "@/lib/dataBank";

export interface DataBankFolder {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  fields: DataBankField[];
  roles: FieldRoles;
  columnMap?: ColumnMap;
  recordCount: number;
  promotedCount: number;
  /** Rows handed on to a manager's own Data Bank, and no longer here. */
  handedOffCount?: number;
  /** The sub admin this folder is assigned to. Absent means admin-only. */
  subAdminUid?: string | null;
  /**
   * Set on a manager's mirror of a source folder — the folder those rows
   * actually came out of. Absent on a folder created here from an import,
   * which is how the UI tells a mirror from an original.
   */
  sourceFolderId?: string | null;
  sourceFolderName?: string | null;
  createdAt?: FirestoreTimestamp;
}

export interface DataBankRecord {
  id: string;
  folderId: string;
  name: string;
  phone: string;
  phoneKey: string;
  values: Record<string, string>;
  status: DataBankStatus;
  notes?: string | null;
  createdAt?: FirestoreTimestamp;
}

/** Rows fetched per page. Small enough to stay cheap, large enough to scroll. */
export const RECORDS_PER_PAGE = 25;

/* -------------------------------------------------------------------------- */

/**
 * The folders this person may work.
 *
 * An admin sees the whole Data Bank. A sub admin sees only the folders handed
 * to them, by the same `subAdminUid` constraint their Security Rule checks —
 * reading everything and filtering afterwards would not merely be wasteful, it
 * would be refused: Firestore rejects a list query it cannot prove safe before
 * running it.
 */
export function useDataBankFolders(
  enabled = true,
  scope?: { role?: string | null; uid?: string }
) {
  const [state, setState] = useState<{ folders: DataBankFolder[]; error: string | null } | null>(null);
  const demoState = useDemoState();

  const teamOf = scope?.role === "subadmin" ? (scope.uid ?? null) : null;
  const ready = enabled && (scope?.role !== "subadmin" || Boolean(teamOf));

  useEffect(() => {
    if (IS_DEMO || !ready) return;

    const unsubscribe = onSnapshot(
      teamOf
        ? query(
            collection(db, "dataBankFolders"),
            where("subAdminUid", "==", teamOf),
            orderBy("name")
          )
        : query(collection(db, "dataBankFolders"), orderBy("name")),
      (snapshot) => {
        setState({
          folders: snapshot.docs.map((snap) => folderFrom(snap.id, snap.data())),
          error: null,
        });
      },
      (err) => {
        console.error("[useDataBankFolders]", err);
        setState({ folders: [], error: describeFirestoreError(err) });
      }
    );
    return () => unsubscribe();
  }, [ready, teamOf]);

  if (IS_DEMO) {
    const folders = teamOf
      ? demoState.dataBankFolders.filter((folder) => folder.subAdminUid === teamOf)
      : demoState.dataBankFolders;
    return { folders: enabled ? folders : [], loading: false, error: null };
  }

  return {
    folders: ready ? (state?.folders ?? []) : [],
    loading: ready && state === null,
    error: ready ? (state?.error ?? null) : null,
  };
}

/** One folder, live — so a rename or a field change lands without a reload. */
export function useDataBankFolder(folderId: string | null, enabled = true) {
  const [state, setState] = useState<{ folder: DataBankFolder | null; error: string | null } | null>(null);
  const demoState = useDemoState();

  useEffect(() => {
    if (IS_DEMO || !enabled || !folderId) return;

    const unsubscribe = onSnapshot(
      doc(db, "dataBankFolders", folderId),
      (snap) => {
        setState({ folder: snap.exists() ? folderFrom(snap.id, snap.data()) : null, error: null });
      },
      (err) => {
        console.error("[useDataBankFolder]", err);
        setState({ folder: null, error: describeFirestoreError(err) });
      }
    );
    return () => unsubscribe();
  }, [folderId, enabled]);

  if (IS_DEMO) {
    const folder = demoState.dataBankFolders.find((f) => f.id === folderId) ?? null;
    return { folder, loading: false, error: null };
  }

  return {
    folder: state?.folder ?? null,
    loading: Boolean(folderId) && enabled && state === null,
    error: state?.error ?? null,
  };
}

/* -------------------------------------------------------------------------- */

export interface RecordsPage {
  records: DataBankRecord[];
  loading: boolean;
  error: string | null;
  /** 1-based, for display only — Firestore cursors cannot jump to page 7. */
  page: number;
  hasNext: boolean;
  hasPrevious: boolean;
  next: () => void;
  previous: () => void;
  /** Re-runs the current page — call after a write. */
  refresh: () => void;
}

/**
 * A page of a folder's records.
 *
 * Cursor paging means **next and previous only** — there is no "jump to page
 * 12", because Firestore has no offset and faking one costs a read per skipped
 * row. That is the honest trade for a list this size, and it is why this list
 * gets its own control rather than the shared `Pager`.
 */
export function useDataBankRecords(
  folderId: string | null,
  options: { search?: string; status?: DataBankStatus | "ALL"; enabled?: boolean } = {}
): RecordsPage {
  const { search = "", status = "ALL", enabled = true } = options;

  // `null` means "not fetched yet", which is what drives the first-load
  // spinner without a `setState` in an effect.
  const [records, setRecords] = useState<DataBankRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [tick, setTick] = useState(0);

  // One cursor per page boundary, so "previous" is a real step back rather
  // than a re-query from the top.
  const cursors = useRef<Array<QueryDocumentSnapshot<DocumentData> | null>>([null]);
  const demoState = useDemoState();

  const trimmed = search.trim();
  const run = useCallback(
    /**
     * Fetches one page.
     *
     * `reset` clears the cursor stack — any change to the query invalidates
     * every one of them, because page 2 of one search is meaningless in
     * another. That happens **here**, inside an async function, rather than
     * during render or synchronously in an effect: a ref must not be mutated
     * while rendering, and this project's lint rule rejects a synchronous
     * `setState` in an effect. Everything below the first `await` runs in a
     * microtask, which is neither.
     */
    async (target: number, reset = false) => {
      if (IS_DEMO || !enabled || !folderId) return;
      try {
        if (reset) cursors.current = [null];
        const after = cursors.current[target - 1] ?? null;
        const base = buildRecordsQuery(folderId, trimmed, status);
        // One extra row tells us whether a next page exists without a
        // second query.
        const q = after
          ? query(base, startAfter(after), limit(RECORDS_PER_PAGE + 1))
          : query(base, limit(RECORDS_PER_PAGE + 1));

        const snapshot = await getDocs(q);
        const docs = snapshot.docs.slice(0, RECORDS_PER_PAGE);

        setError(null);
        setRecords(docs.map((snap) => recordFrom(snap.id, snap.data())));
        setHasNext(snapshot.docs.length > RECORDS_PER_PAGE);
        cursors.current[target] = docs[docs.length - 1] ?? null;
        setPage(target);
      } catch (err: unknown) {
        console.error("[useDataBankRecords]", err);
        setRecords([]);
        setHasNext(false);
        setError(describeFirestoreError(err as { code?: string; message?: string }));
      }
    },
    [folderId, trimmed, status, enabled]
  );

  // `run` is memoised on the query, so this fires exactly when the folder,
  // search or status changes — and `tick` forces a refetch after a write.
  // Nothing here touches state synchronously.
  useEffect(() => {
    // `react-hooks/set-state-in-effect` flags any call that transitively sets
    // state, and cannot see that every update inside `run` happens after its
    // first `await` — i.e. in a microtask, not synchronously in this body.
    // Fetching a page on mount is the "subscribe to an external system" shape
    // the rule's own guidance allows; it just cannot tell a promise from a
    // callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(1, true);
  }, [run, tick]);

  if (IS_DEMO) {
    const all = demoState.dataBankRecords
      .filter((record) => record.folderId === folderId)
      .filter((record) => (status === "ALL" ? true : record.status === status))
      .filter((record) => matchesSearch(record, trimmed));
    return {
      records: all.slice((page - 1) * RECORDS_PER_PAGE, page * RECORDS_PER_PAGE),
      loading: false,
      error: null,
      page,
      hasNext: all.length > page * RECORDS_PER_PAGE,
      hasPrevious: page > 1,
      next: () => setPage((p) => p + 1),
      previous: () => setPage((p) => Math.max(1, p - 1)),
      refresh: () => setTick((t) => t + 1),
    };
  }

  const step = (target: number) => {
    // Safe here — a click handler, not an effect.
    setLoading(true);
    void run(target).finally(() => setLoading(false));
  };

  return {
    records: records ?? [],
    loading: loading || records === null,
    error,
    page,
    hasNext,
    hasPrevious: page > 1,
    next: () => step(page + 1),
    previous: () => step(Math.max(1, page - 1)),
    refresh: () => setTick((t) => t + 1),
  };
}

/* -------------------------------------------------------------------------- */

/**
 * The query behind one page.
 *
 * A search that looks like a phone number becomes an exact match on the dedupe
 * key, so `0300 1234567` finds the row stored as `+92 300 1234567`. Anything
 * else is a **name prefix** — Firestore cannot search inside a string, and
 * pretending otherwise with a client-side filter over a paged query would
 * search only the page you happen to be on.
 */
function buildRecordsQuery(folderId: string, search: string, status: DataBankStatus | "ALL"): Query {
  const records = collection(db, "dataBankRecords");
  const digits = search.replace(/\D/g, "");

  if (search && digits.length >= 7) {
    return query(records, where("folderId", "==", folderId), where("phoneKey", "==", phoneKey(search)));
  }

  if (search) {
    return query(
      records,
      where("folderId", "==", folderId),
      orderBy("name"),
      where("name", ">=", search),
      // \uf8ff sorts above any ordinary character, so this bounds the range
      // to "everything starting with `search`". Without it the upper bound
      // equals the lower bound and only exact matches come back.
      where("name", "<=", `${search}\uf8ff`)
    );
  }

  if (status !== "ALL") {
    return query(
      records,
      where("folderId", "==", folderId),
      where("status", "==", status),
      orderBy("createdAt", "desc")
    );
  }

  return query(records, where("folderId", "==", folderId), orderBy("createdAt", "desc"));
}

function matchesSearch(record: DataBankRecord, search: string): boolean {
  if (!search) return true;
  const digits = search.replace(/\D/g, "");
  if (digits.length >= 7) return record.phoneKey === phoneKey(search);
  return record.name.toLowerCase().startsWith(search.toLowerCase());
}

function folderFrom(id: string, raw: DocumentData): DataBankFolder {
  return {
    id,
    name: raw.name ?? "Untitled",
    code: raw.code ?? null,
    description: raw.description ?? null,
    fields: Array.isArray(raw.fields) ? (raw.fields as DataBankField[]) : [],
    roles: raw.roles ?? { name: "", phone: "" },
    columnMap: raw.columnMap ?? {},
    recordCount: typeof raw.recordCount === "number" ? raw.recordCount : 0,
    promotedCount: typeof raw.promotedCount === "number" ? raw.promotedCount : 0,
    handedOffCount: typeof raw.handedOffCount === "number" ? raw.handedOffCount : 0,
    subAdminUid: typeof raw.subAdminUid === "string" ? raw.subAdminUid : null,
    // Read out of the snapshot as well as typed — the gap that has shipped
    // four times on this project is a field declared on the interface and
    // never mapped here.
    sourceFolderId: typeof raw.sourceFolderId === "string" ? raw.sourceFolderId : null,
    sourceFolderName: typeof raw.sourceFolderName === "string" ? raw.sourceFolderName : null,
    createdAt: raw.createdAt,
  };
}

function recordFrom(id: string, raw: DocumentData): DataBankRecord {
  return {
    id,
    folderId: raw.folderId,
    name: raw.name ?? "",
    phone: raw.phone ?? "",
    phoneKey: raw.phoneKey ?? "",
    values: raw.values ?? {},
    status: (raw.status ?? "NEW") as DataBankStatus,
    notes: raw.notes ?? null,
    createdAt: raw.createdAt,
  };
}
