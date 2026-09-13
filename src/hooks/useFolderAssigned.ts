"use client";

/**
 * A Data Bank folder's **Assigned** rows — everything it has handed out, and to
 * whom. See `lib/dataBankAssigned` for why this is derived rather than stored.
 *
 * Two sources, and only the first costs nothing new:
 *
 * 1. **Leads.** Read from the shared `useLeads` subscription every leads screen
 *    already holds, narrowed in memory to the ones this folder produced. The
 *    scope is the viewer's own — an admin and an HR manager see every lead, a
 *    Sales manager sees their team's — so a manager is only ever shown what
 *    the Security Rules already let them read.
 * 2. **Rows handed to a manager and not worked yet.** They sit in the manager's
 *    mirror (`mgr_{uid}_{folderId}`), one query across every mirror id. The
 *    admin's alone: a manager cannot read another manager's mirror, and the
 *    rule would refuse the whole query rather than trim it.
 */

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { IS_DEMO, useDemoState } from "@/lib/demo/store";
import { describeFirestoreError, useLeads, type FirestoreTimestamp, type Lead } from "./useLeads";
import type { DataBankRecord } from "./useDataBank";
import {
  isMirrorId,
  leadBelongsToFolder,
  managerMirrorId,
  mirrorOwner,
  sortAssigned,
  type AssignedItem,
} from "@/lib/dataBankAssigned";

function millisOf(value: FirestoreTimestamp | Date | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  return value.toDate?.()?.getTime() ?? 0;
}

export interface FolderAssigned {
  items: AssignedItem[];
  /** The lead behind a `LEAD` item, for the detail pane. */
  leadsById: Map<string, Lead>;
  /** The record behind a `HANDOFF` item. */
  handoffsById: Map<string, DataBankRecord>;
  loading: boolean;
  error: string | null;
}

export function useFolderAssigned(
  folderId: string | null,
  enabled: boolean,
  viewer: {
    role?: string | null;
    uid?: string | null;
    managerKind?: string | null;
    /** Managers on the roster, for the hand-off mirrors and their names. Admin only. */
    managers?: ReadonlyArray<{ uid: string; name: string }>;
    /** Every name the viewer can resolve, to label a lead with no `assigneeName`. */
    names?: ReadonlyMap<string, string>;
  }
): FolderAssigned {
  const role = viewer.role === "admin" || viewer.role === "subadmin" ? viewer.role : null;
  const companyWide = role === "subadmin" && viewer.managerKind === "HR";
  const { leads, loading: leadsLoading, error: leadsError } = useLeads(
    enabled ? role : null,
    viewer.uid ?? undefined,
    companyWide
  );
  const demoState = useDemoState();

  const mirrorIds = useMemo(() => {
    if (role !== "admin" || !folderId || isMirrorId(folderId)) return [];
    return (viewer.managers ?? []).map((manager) => managerMirrorId(manager.uid, folderId)).slice(0, 30);
  }, [role, folderId, viewer.managers]);
  const mirrorKey = enabled ? mirrorIds.join(",") : "";

  const [handoffState, setHandoffState] = useState<{
    key: string;
    rows: Array<DataBankRecord & { handedOffAt?: FirestoreTimestamp }>;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (IS_DEMO || !mirrorKey) return;
    const ids = mirrorKey.split(",");
    const unsubscribe = onSnapshot(
      query(
        collection(db, "dataBankRecords"),
        where("folderId", "in", ids),
        orderBy("createdAt", "desc"),
        limit(500)
      ),
      (snap) => {
        setHandoffState({
          key: mirrorKey,
          rows: snap.docs.map((doc) => {
            const raw = doc.data();
            return {
              id: doc.id,
              folderId: raw.folderId,
              name: raw.name ?? "",
              phone: raw.phone ?? "",
              phoneKey: raw.phoneKey ?? "",
              values: raw.values ?? {},
              status: raw.status ?? "NEW",
              notes: raw.notes ?? null,
              createdAt: raw.createdAt,
              handedOffAt: raw.handedOffAt,
            };
          }),
          error: null,
        });
      },
      (err) => {
        console.error("[useFolderAssigned]", err);
        setHandoffState({ key: mirrorKey, rows: [], error: describeFirestoreError(err) });
      }
    );
    return () => unsubscribe();
  }, [mirrorKey]);

  const handoffRows = useMemo(() => {
    if (IS_DEMO) {
      return folderId && role === "admin"
        ? demoState.dataBankRecords.filter((record) => mirrorIds.includes(record.folderId))
        : [];
    }
    return handoffState?.key === mirrorKey ? handoffState.rows : [];
  }, [demoState.dataBankRecords, folderId, role, mirrorIds, handoffState, mirrorKey]);

  return useMemo(() => {
    const managerNames = new Map((viewer.managers ?? []).map((m) => [m.uid, m.name]));
    const nameOf = (uid: string | null | undefined) =>
      (uid && (viewer.names?.get(uid) ?? managerNames.get(uid))) || "";

    const leadsById = new Map<string, Lead>();
    const handoffsById = new Map<string, DataBankRecord>();
    const items: AssignedItem[] = [];

    if (folderId && enabled) {
      for (const lead of leads) {
        if (!leadBelongsToFolder(lead.dataBankFolderId, folderId)) continue;
        leadsById.set(lead.id, lead);
        items.push({
          id: lead.id,
          kind: "LEAD",
          name: lead.name ?? "",
          phone: lead.phone ?? "",
          assigneeUid: lead.assignedUserId ?? null,
          assigneeName:
            (lead.assignedUserId === viewer.uid ? "You" : "") ||
            nameOf(lead.assignedUserId) ||
            lead.assigneeName ||
            "",
          at: millisOf(lead.assignedAt ?? lead.createdAt),
        });
      }
      for (const record of handoffRows) {
        const managerUid = mirrorOwner(record.folderId, folderId);
        handoffsById.set(record.id, record);
        items.push({
          id: record.id,
          kind: "HANDOFF",
          name: record.name,
          phone: record.phone,
          assigneeUid: managerUid,
          assigneeName: nameOf(managerUid) || "A manager",
          at: millisOf((record as { handedOffAt?: FirestoreTimestamp }).handedOffAt ?? record.createdAt),
        });
      }
    }

    return {
      items: sortAssigned(items),
      leadsById,
      handoffsById,
      loading: enabled && (leadsLoading || (Boolean(mirrorKey) && !IS_DEMO && handoffState?.key !== mirrorKey)),
      error: leadsError ?? (handoffState?.key === mirrorKey ? handoffState.error : null),
    };
  }, [
    folderId,
    enabled,
    leads,
    handoffRows,
    viewer.managers,
    viewer.names,
    viewer.uid,
    leadsLoading,
    leadsError,
    mirrorKey,
    handoffState,
  ]);
}
