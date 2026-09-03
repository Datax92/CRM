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

import { useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useClientFolders, useClientFolderMembers } from "@/hooks/useClients";
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
  const { role, user, loading: authLoading } = useAuth();
  const isManager = role === "admin" || role === "subadmin";

  const { folders, loading: foldersLoading } = useClientFolders(isManager, {
    role,
    uid: user?.uid,
  });
  const { members, loading: membersLoading } = useClientFolderMembers(folderId, isManager);

  const folder = folders.find((entry) => entry.id === folderId) ?? null;

  /**
   * The membership rows are the folder's whole definition. A `Set` because the
   * workspace asks "is this lead in the folder" once per lead per render.
   */
  const scope = useMemo(
    () =>
      folder
        ? {
            leadIds: new Set(members.map((member) => member.leadId)),
            title: folder.name,
            subtitle: `${members.length} lead${members.length === 1 ? "" : "s"}${
              folder.dataBankFolderName ? ` · from ${folder.dataBankFolderName}` : ""
            }`,
            backHref: basePath,
          }
        : null,
    [folder, members, basePath]
  );

  if (authLoading || foldersLoading || membersLoading) return <FullPageSpinner />;

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
