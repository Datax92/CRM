"use client";

/**
 * The Data Bank — cold lists, one folder per source.
 *
 * Folders are the top level because the sheets are: a Capital Smart City
 * export and an F2F sign-up sheet share no columns, so they cannot share a
 * table. Each card shows what the folder holds and how much of it has already
 * been worked into the pipeline.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileDataBankFolders } from "@/components/mobile/MobileDataBank";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useDataBankFolders, type DataBankFolder } from "@/hooks/useDataBank";
import { useSubAdmins } from "@/hooks/useEmployees";
import { deleteDataBankFolder } from "@/lib/clientActions";
import { Banner, FullPageSpinner } from "@/components/admin/AdminShared";
import { FolderFormModal } from "@/components/dataBank/FolderFormModal";
import { createPortal } from "react-dom";
import { Database, Plus, Pencil, Trash2, ChevronRight, UserCheck } from "lucide-react";

/**
 * Both managing roles land here.
 *
 * A sub admin sees only the folders assigned to them — enforced by the query
 * in `useDataBankFolders` and by the Security Rule behind it, not by anything
 * this page hides. What they cannot do is create, rename or delete a folder:
 * handing out a cold list is the admin's decision, and the Server Actions
 * refuse it regardless of what this screen renders.
 */
export default function DataBankPage() {
  const { role, user, loading: authLoading, getIdToken } = useAuth();
  useProtectedRoute(["admin", "subadmin"]);
  const isAdmin = role === "admin";
  const isManager = role === "admin" || role === "subadmin";
  // Phones get their own screen — see `MobileDataBank`. The listener is gated
  // on the surface actually rendering so the two do not both subscribe.
  const isMobile = useIsMobile();

  const { folders, loading, error } = useDataBankFolders(isManager && !isMobile, {
    role,
    uid: user?.uid,
  });
  // Only to name the manager on a handed-over folder. An admin's grid now
  // shows both the originals and the managers' mirrors of them, and two cards
  // reading "Facile Town 2" with no way to tell them apart would be worse than
  // not showing the mirror at all.
  const { subAdmins } = useSubAdmins(isAdmin && !isMobile);
  const managerNames = useMemo(
    () => new Map(subAdmins.map((manager) => [manager.uid, manager.name])),
    [subAdmins]
  );

  const [formFor, setFormFor] = useState<{ folder: DataBankFolder | null } | null>(null);
  const [confirming, setConfirming] = useState<DataBankFolder | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const totals = useMemo(
    () => ({
      records: folders.reduce((sum, folder) => sum + folder.recordCount, 0),
      promoted: folders.reduce((sum, folder) => sum + folder.promotedCount, 0),
    }),
    [folders]
  );

  const remove = async (folder: DataBankFolder) => {
    setBusy(true);
    try {
      const res = await deleteDataBankFolder(await getIdToken(), folder.id);
      if (res.ok) {
        setBanner({
          tone: "success",
          text: `${folder.name} deleted, along with ${res.data.deleted.toLocaleString()} record${res.data.deleted === 1 ? "" : "s"}.`,
        });
        setConfirming(null);
      } else {
        setBanner({ tone: "error", text: res.error });
      }
    } catch {
      setBanner({ tone: "error", text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  if (isMobile) return <MobileDataBankFolders />;

  if (authLoading || loading) return <FullPageSpinner />;

  return (
    <div className="-m-6 min-h-full bg-[#e9f1f0] px-6 py-6 text-[#2b3a39] md:-m-8 md:px-8 md:py-7">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#4f9c99] text-white">
            <Database size={22} />
          </span>
          <div>
            <h1 className="text-[24px] text-[#2b3a39]">Data Bank</h1>
            <p className="mt-0.5 text-[13px] text-[#7e918f]">
              {folders.length} source{folders.length === 1 ? "" : "s"} ·{" "}
              {totals.records.toLocaleString()} cold record
              {totals.records === 1 ? "" : "s"} · {totals.promoted.toLocaleString()} moved into the
              pipeline
            </p>
          </div>
        </div>

        {isAdmin && (
          <button
            onClick={() => setFormFor({ folder: null })}
            className="inline-flex items-center gap-2 rounded-full bg-[#3f8f8a] px-5 py-2.5 text-[13.5px] text-white transition-colors hover:bg-[#2f7d78]"
          >
            <Plus size={16} strokeWidth={2.2} />
            <span>New Folder</span>
          </button>
        )}
      </header>

      {(error || banner) && (
        <div className="mb-4 space-y-2.5">
          {error && <Banner tone="error" text={error} />}
          {banner && (
            <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />
          )}
        </div>
      )}

      {folders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#cfe2e0] bg-white/70 px-6 py-16 text-center">
          <Database className="mx-auto mb-3 text-[#a9cfcc]" size={30} />
          <p className="text-[14.5px] text-[#2b3a39]">No sources yet.</p>
          <p className="mx-auto mt-1.5 max-w-[440px] text-[13px] text-[#7e918f]">
            A folder is one source — Capital Smart City, F2F, a walk-in list. Create it with the
            columns that source&rsquo;s sheet has, then import the file.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {folders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              /* A manager reading their own list does not need telling whose
                 folder it is; only the admin sees more than one owner. */
              ownerName={
                isAdmin && folder.subAdminUid
                  ? (managerNames.get(folder.subAdminUid) ?? "a manager")
                  : null
              }
              onEdit={isAdmin ? () => setFormFor({ folder }) : undefined}
              onDelete={isAdmin ? () => setConfirming(folder) : undefined}
            />
          ))}
        </div>
      )}

      {formFor && (
        <FolderFormModal
          folder={formFor.folder}
          getIdToken={getIdToken}
          onClose={() => setFormFor(null)}
          onSaved={(message) => {
            setFormFor(null);
            setBanner({ tone: "success", text: message });
          }}
        />
      )}

      {confirming && (
        <ConfirmDelete
          folder={confirming}
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void remove(confirming)}
        />
      )}
    </div>
  );
}

function FolderCard({
  folder,
  ownerName,
  onEdit,
  onDelete,
}: {
  folder: DataBankFolder;
  /** Set when this folder is a manager's mirror — see `ensureManagerFolder`. */
  ownerName?: string | null;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-[#dceae8] bg-white transition-colors hover:border-[#8cc3bf]">
      <Link href={`/admin/data-bank/${folder.id}`} className="block px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {folder.code && (
                <span className="rounded-md bg-[#e8f5f3] px-2 py-0.5 text-[11px] tracking-[0.6px] text-[#2f7d78]">
                  {folder.code}
                </span>
              )}
              <span className="truncate text-[16px] text-[#2b3a39]">{folder.name}</span>
            </div>
            {ownerName && (
              <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[#eaf1f6] px-2.5 py-0.5 text-[11px] text-[#4d7590]">
                <UserCheck size={11} />
                Handed to {ownerName}
              </span>
            )}
            {folder.description && (
              <p className="mt-1 truncate text-[12.5px] text-[#9aacaa]">{folder.description}</p>
            )}
          </div>
          <ChevronRight size={18} className="mt-1 shrink-0 text-[#a9cfcc]" />
        </div>

        <div className="mt-4 flex items-end gap-6">
          <div>
            <div className="text-[24px] tabular-nums text-[#2b3a39]">
              {folder.recordCount.toLocaleString()}
            </div>
            <div className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">Records</div>
          </div>
          <div>
            <div className="text-[24px] tabular-nums text-[#2f7d78]">
              {folder.promotedCount.toLocaleString()}
            </div>
            <div className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">Promoted</div>
          </div>
          {/* Only when some have left. A permanent "0 handed over" column on
              every folder is noise on the majority that never will. */}
          {(folder.handedOffCount ?? 0) > 0 && (
            <div>
              <div className="text-[24px] tabular-nums text-[#4d7590]">
                {(folder.handedOffCount ?? 0).toLocaleString()}
              </div>
              <div className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">Handed on</div>
            </div>
          )}
        </div>

        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {folder.fields.slice(0, 4).map((field) => (
            <span
              key={field.key}
              className="rounded-md bg-[#f2f8f7] px-2 py-0.5 text-[11.5px] text-[#5b6d6b]"
            >
              {field.label}
            </span>
          ))}
          {folder.fields.length > 4 && (
            <span className="px-1 py-0.5 text-[11.5px] text-[#9aacaa]">
              +{folder.fields.length - 4}
            </span>
          )}
        </div>
      </Link>

      {/* Kept out of the <Link> so they are separate targets, not nested ones.
          A sub admin gets neither, so the row collapses rather than showing two
          buttons that would be refused. */}
      {(onEdit || onDelete) && (
      <div className="flex items-center gap-1 border-t border-[#f0f6f5] px-3 py-2">
        {onEdit && (
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-[#5b6d6b] transition-colors hover:bg-[#f2f8f7]"
        >
          <Pencil size={13} />
          <span>Edit fields</span>
        </button>
        )}
        {onDelete && (
        <button
          onClick={onDelete}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-[#c0574a] transition-colors hover:bg-[#fdeeec]"
        >
          <Trash2 size={13} />
          <span>Delete</span>
        </button>
        )}
      </div>
      )}
    </div>
  );
}

/**
 * Deleting a folder takes every record with it, so the count is stated in the
 * prompt and the confirm button names it. A folder of 12,000 numbers is not
 * something to lose to a stray click.
 */
function ConfirmDelete({
  folder,
  busy,
  onCancel,
  onConfirm,
}: {
  folder: DataBankFolder;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Portalled for the same reason every other overlay in this app is: the page
  // wrapper carries `will-change: transform`, which makes it the containing
  // block for `position: fixed` children — an un-portalled dialog is pinned to
  // the page box, not the viewport, and lands cropped in half a window.
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
      <div className="animate-modal-fade fixed inset-0 bg-[#1e3a38]/45" onClick={onCancel} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${folder.name}`}
        className="animate-modal-pop relative z-10 w-full max-w-[440px] overflow-hidden rounded-2xl bg-white p-6 shadow-[0_26px_70px_rgba(18,54,52,0.32)]"
      >
        <div className="text-[17px] text-[#2b3a39]">Delete {folder.name}?</div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#5b6d6b]">
          This removes the folder and all{" "}
          <strong className="text-[#c0574a]">{folder.recordCount.toLocaleString()}</strong> record
          {folder.recordCount === 1 ? "" : "s"} in it. Leads already promoted into the pipeline are
          not affected. This cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-[#cfe2e0] bg-white px-6 py-2.5 text-[13.5px] text-[#5b6d6b] transition-colors hover:bg-[#f3faf9] disabled:opacity-50"
          >
            Keep it
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-full bg-[#c0574a] px-6 py-2.5 text-[13.5px] text-white transition-colors hover:bg-[#a8473c] disabled:opacity-50"
          >
            {busy ? "Deleting…" : `Delete ${folder.recordCount.toLocaleString()} records`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
