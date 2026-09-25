"use client";

/**
 * One Client folder.
 *
 * **This is the leads screen, scoped.** Not a copy of it, not a table that
 * looks like it — the same `LeadsWorkspace` the pipeline renders, given the
 * folder's lead ids. So opening a lead here gives the identical detail pane
 * with Follow-Ups, Remark, KYC, Deal Entry and the audit trail, the identical
 * chips, search, pagination and actions, on web and on the phone, because
 * there is exactly one implementation of all of it.
 *
 * A folder is a **view** of the pipeline. Its rows are the same lead documents
 * the pipeline holds, with the same ids — nothing is copied, so nothing can
 * drift.
 */

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useClientFolders, useClientFolderMembers, useOwnClientLeads } from "@/hooks/useClients";
import { ownClientLeadIds } from "@/lib/clientFolderScope";
import { useLeadsByIds } from "@/hooks/useLeadsByIds";
import { LeadsWorkspace } from "@/components/leads/LeadsWorkspace";
import { FullPageSpinner } from "@/components/admin/AdminShared";
import { FolderHeart, ChevronLeft } from "lucide-react";

export function ClientFolderView({
  folderId,
  basePath,
}: {
  folderId: string;
  basePath: string;
}) {
  const { role, managerKind, user, loading: authLoading } = useAuth();
  const isManager = role === "admin" || role === "subadmin";

  const { folders, loading: foldersLoading } = useClientFolders(isManager, {
    role,
    uid: user?.uid,
  });
  // Scoped, for the same reason the folder list is: a manager's membership
  // query must carry `subAdminUid == me` or the rule refuses it outright and
  // the folder renders empty.
  const { members, loading: membersLoading } = useClientFolderMembers(folderId, isManager, {
    role,
    uid: user?.uid,
  });

  // Only the leads still assigned to the folder's owner — a Client folder is
  // the leads somebody took for themselves. See `lib/clientFolderScope`.
  const { assignee, loading: ownLoading } = useOwnClientLeads(
    isManager,
    { role, uid: user?.uid, managerKind },
    false
  );

  const folder = folders.find((entry) => entry.id === folderId) ?? null;
  const ownerUid = user?.uid ?? "";

  /*
    **A folder is its membership rows, not the subset of them the window holds.**
    `assignee` comes from the pipeline window, so a member older than the window
    was read as somebody else's and dropped — 14 clients shown in a folder of 34
    on 2026-09-23. Those leads are now fetched by the ids the folder already
    knows. Below the window's ceiling `missing` is empty and this opens no
    listener, so the normal case costs nothing.
  */
  const memberIds = useMemo(() => members.map((member) => member.leadId), [members]);
  const inWindow = useCallback((leadId: string) => assignee.has(leadId), [assignee]);
  const extraLeads = useLeadsByIds(memberIds, inWindow, isManager, {
    role,
    uid: user?.uid,
    managerKind,
  });
  const extraAssignee = useMemo(
    () => new Map(extraLeads.map((lead) => [lead.id, lead.assignedUserId ?? null])),
    [extraLeads]
  );

  /**
   * The membership rows are the folder's whole definition, narrowed to the
   * leads still assigned to the owner. A `Set` because the workspace asks "is
   * this lead in the folder" once per lead per render.
   */
  const scope = useMemo(() => {
    if (!folder) return null;
    const leadIds = ownClientLeadIds(memberIds, ownerUid, (leadId) =>
      assignee.has(leadId) ? assignee.get(leadId) : extraAssignee.get(leadId)
    );
    return {
      leadIds,
      title: folder.name,
      subtitle: `${leadIds.size} lead${leadIds.size === 1 ? "" : "s"}${
        folder.dataBankFolderName ? ` · from ${folder.dataBankFolderName}` : ""
      }`,
      backHref: basePath,
      extraLeads,
    };
  }, [folder, memberIds, ownerUid, assignee, extraAssignee, extraLeads, basePath]);

  if (authLoading || foldersLoading || membersLoading || ownLoading) return <FullPageSpinner />;

  if (!folder || !scope) {
    return (
      <div className="-m-6 min-h-full bg-[#e9f1f0] px-6 py-6 md:-m-8 md:px-8 md:py-7">
        <div className="rounded-2xl border border-dashed border-[#cfe2e0] bg-white/70 px-6 py-16 text-center">
          <FolderHeart className="mx-auto mb-3 text-[#a9cfcc]" size={30} />
          <p className="text-[14.5px] text-[#2b3a39]">
            That folder is gone, or was never assigned to you.
          </p>
          <Link
            href={basePath}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#cfe2e0] bg-white px-4 py-2 text-[13px] text-[#2f7d78]"
          >
            <ChevronLeft size={14} /> Back to folders
          </Link>
        </div>
      </div>
    );
  }

  return (
    <LeadsWorkspace
      workspaceRole={role === "subadmin" ? "subadmin" : "admin"}
      basePath={`${basePath}/${folderId}`}
      scope={scope}
    />
  );
}
