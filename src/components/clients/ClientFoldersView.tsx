"use client";

/**
 * The Client section's folder list.
 *
 * **Built to the Data Bank's folder screen**, deliberately and to the pixel:
 * same full-bleed ground, same header block, same `auto-fill minmax(300px)`
 * card grid, same two-figure card body, same footer actions, same empty state.
 * They are the same kind of screen — a list of folders you open — and looking
 * different would be the only thing making them feel like different products.
 *
 * What differs is what a folder *holds*: the Data Bank holds cold rows that
 * are not leads yet, this holds leads that already exist. So the two figures
 * are Leads and Imported rather than Records and Promoted, and the field
 * chips are replaced by where the folder came from.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import {
  FolderHeart,
  Plus,
  Pencil,
  Trash2,
  ChevronRight,
  Database,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useClientFolders, type ClientFolder } from "@/hooks/useClients";
import { createClientFolder, updateClientFolder, deleteClientFolder } from "@/lib/clientActions";
import { Banner, FullPageSpinner } from "@/components/admin/AdminShared";
import { ImportFromDataBankModal } from "./ImportFromDataBankModal";
import { MobileClientFolders } from "@/components/mobile/MobileClients";

export function ClientFoldersView({ basePath }: { basePath: string }) {
  const { role, user, loading: authLoading, getIdToken } = useAuth();
  const isManager = role === "admin" || role === "subadmin";
  // Phones get their own screen — the same split the Data Bank makes. The
  // listener is gated on the surface actually rendering, so the two never both
  // subscribe.
  const isMobile = useIsMobile();

  const { folders, loading, error } = useClientFolders(isManager && !isMobile, {
    role,
    uid: user?.uid,
  });

  const [formFor, setFormFor] = useState<{ folder: ClientFolder | null } | null>(null);
  const [confirming, setConfirming] = useState<ClientFolder | null>(null);
  const [importing, setImporting] = useState(false);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const totals = useMemo(
    () => ({
      leads: folders.reduce((sum, folder) => sum + folder.leadCount, 0),
      imported: folders.filter((folder) => folder.dataBankFolderId).length,
    }),
    [folders]
  );

  const remove = async (folder: ClientFolder) => {
    setBusy(true);
    try {
      const result = await deleteClientFolder(await getIdToken(), folder.id);
      if (result.ok) {
        setBanner({
          tone: "success",
          text: `${folder.name} deleted. The ${result.data.removed} lead${
            result.data.removed === 1 ? "" : "s"
          } it held are untouched — a folder is a view of the pipeline, never a part of it.`,
        });
        setConfirming(null);
      } else {
        setBanner({ tone: "error", text: result.error });
      }
    } catch {
      setBanner({ tone: "error", text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  if (isMobile) return <MobileClientFolders basePath={basePath} />;

  if (authLoading || loading) return <FullPageSpinner />;

  return (
    <div className="-m-6 min-h-full bg-[#e9f1f0] px-6 py-6 text-[#2b3a39] md:-m-8 md:px-8 md:py-7">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#4f9c99] text-white">
            <FolderHeart size={22} />
          </span>
          <div>
            <h1 className="text-[24px] text-[#2b3a39]">Clients</h1>
            <p className="mt-0.5 text-[13px] text-[#7e918f]">
              {folders.length} folder{folders.length === 1 ? "" : "s"} ·{" "}
              {totals.leads.toLocaleString()} lead{totals.leads === 1 ? "" : "s"} ·{" "}
              {totals.imported} imported from the Data Bank
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={() => setImporting(true)}
            className="inline-flex items-center gap-2 rounded-full border border-[#cfe2e0] bg-white px-5 py-2.5 text-[13.5px] text-[#2f7d78] transition-colors hover:border-[#8cc3bf]"
          >
            <Database size={16} strokeWidth={2.2} />
            <span>Import from Data Bank</span>
          </button>
          <button
            onClick={() => setFormFor({ folder: null })}
            className="inline-flex items-center gap-2 rounded-full bg-[#3f8f8a] px-5 py-2.5 text-[13.5px] text-white transition-colors hover:bg-[#2f7d78]"
          >
            <Plus size={16} strokeWidth={2.2} />
            <span>New Folder</span>
          </button>
        </div>
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
          <FolderHeart className="mx-auto mb-3 text-[#a9cfcc]" size={30} />
          <p className="text-[14.5px] text-[#2b3a39]">No client folders yet.</p>
          <p className="mx-auto mt-1.5 max-w-[460px] text-[13px] text-[#7e918f]">
            A folder groups leads you are working — import a whole Data Bank folder, or a selection
            out of one. The leads keep their id, source and history; a folder is a view of the
            pipeline, never a copy of it.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {folders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              href={`${basePath}/${folder.id}`}
              onEdit={() => setFormFor({ folder })}
              onDelete={() => setConfirming(folder)}
            />
          ))}
        </div>
      )}

      {importing && (
        <ImportFromDataBankModal
          onClose={() => setImporting(false)}
          onImported={(message) => {
            setImporting(false);
            setBanner({ tone: "success", text: message });
          }}
        />
      )}

      {formFor && (
        <FolderForm
          folder={formFor.folder}
          busy={busy}
          onClose={() => setFormFor(null)}
          onSave={async (name, description) => {
            setBusy(true);
            const token = await getIdToken();
            const result = formFor.folder
              ? await updateClientFolder(token, formFor.folder.id, { name, description })
              : await createClientFolder(token, { name, description });
            setBusy(false);

            if (!result.ok) return result.error;
            setFormFor(null);
            setBanner({
              tone: "success",
              text: formFor.folder ? `${name} updated.` : `${name} created.`,
            });
            return null;
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

/* -------------------------------------------------------------------------- */
/* Card                                                                        */
/* -------------------------------------------------------------------------- */

function FolderCard({
  folder,
  href,
  onEdit,
  onDelete,
}: {
  folder: ClientFolder;
  href: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-[#dceae8] bg-white transition-colors hover:border-[#8cc3bf]">
      <Link href={href} className="block px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {folder.dataBankFolderId && (
                <span className="rounded-md bg-[#e8f5f3] px-2 py-0.5 text-[11px] tracking-[0.6px] text-[#2f7d78]">
                  DATA BANK
                </span>
              )}
              <span className="truncate text-[16px] text-[#2b3a39]">{folder.name}</span>
            </div>
            {folder.description && (
              <p className="mt-1 truncate text-[12.5px] text-[#9aacaa]">{folder.description}</p>
            )}
          </div>
          <ChevronRight size={18} className="mt-1 shrink-0 text-[#a9cfcc]" />
        </div>

        <div className="mt-4 flex items-end gap-6">
          <div>
            <div className="text-[24px] tabular-nums text-[#2b3a39]">
              {folder.leadCount.toLocaleString()}
            </div>
            <div className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">Leads</div>
          </div>
          {folder.dataBankFolderName && (
            <div className="min-w-0">
              <div className="truncate text-[15px] text-[#2f7d78]">{folder.dataBankFolderName}</div>
              <div className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">Source</div>
            </div>
          )}
        </div>

        <p className="mt-3.5 text-[11.5px] text-[#9aacaa]">
          Opening a lead here opens the lead itself — the same record, the same detail pane.
        </p>
      </Link>

      {/* Kept out of the <Link> so they are separate targets, not nested ones. */}
      <div className="flex items-center gap-1 border-t border-[#f0f6f5] px-3 py-2">
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-[#5b6d6b] transition-colors hover:bg-[#f2f8f7]"
        >
          <Pencil size={13} />
          <span>Rename</span>
        </button>
        <button
          onClick={onDelete}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-[#c0574a] transition-colors hover:bg-[#fdeeec]"
        >
          <Trash2 size={13} />
          <span>Delete</span>
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Create / rename                                                             */
/* -------------------------------------------------------------------------- */

function FolderForm({
  folder,
  busy,
  onClose,
  onSave,
}: {
  folder: ClientFolder | null;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, description: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const [description, setDescription] = useState(folder?.description ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("Give the folder a name.");
      return;
    }
    setError(await onSave(name.trim(), description.trim()));
  };

  return (
    <Overlay onClose={onClose}>
      <h2 className="text-[18px] text-[#2b3a39]">
        {folder ? "Rename folder" : "New client folder"}
      </h2>
      <p className="mt-1 text-[13px] text-[#7e918f]">
        A folder groups leads you are already working. Nothing is copied into it.
      </p>

      <label className="mt-4 block">
        <span className="text-[11px] tracking-[0.8px] text-[#9aacaa] uppercase">Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          placeholder="Facile Town 2"
          className="mt-1 w-full rounded-lg border border-[#dceae8] bg-white px-3 py-2.5 text-[16px] text-[#2b3a39] outline-none focus:border-[#4f9c99]"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-[11px] tracking-[0.8px] text-[#9aacaa] uppercase">Description</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          disabled={busy}
          placeholder="What this folder is for."
          className="mt-1 w-full resize-y rounded-lg border border-[#dceae8] bg-white px-3 py-2.5 text-[16px] text-[#2b3a39] outline-none focus:border-[#4f9c99]"
        />
      </label>

      {error && <p className="mt-3 text-[12.5px] text-[#c0574a]">{error}</p>}

      <div className="mt-5 flex justify-end gap-2.5">
        <button
          onClick={onClose}
          className="rounded-full border border-[#dceae8] bg-white px-5 py-2.5 text-[13.5px] text-[#5b6d6b]"
        >
          Cancel
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-full bg-[#2f7d78] px-6 py-2.5 text-[13.5px] text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : folder ? "Save" : "Create folder"}
        </button>
      </div>
    </Overlay>
  );
}

function ConfirmDelete({
  folder,
  busy,
  onCancel,
  onConfirm,
}: {
  folder: ClientFolder;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Overlay onClose={onCancel}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#fdeeec] text-[#c0574a]">
          <AlertTriangle size={18} />
        </span>
        <div>
          <h2 className="text-[17px] text-[#2b3a39]">Delete {folder.name}?</h2>
          {/* The distinction people actually need before pressing this. */}
          <p className="mt-1.5 text-[13px] text-[#5b6d6b]">
            This removes the folder and its {folder.leadCount} membership
            {folder.leadCount === 1 ? "" : "s"}. <strong>The leads themselves stay</strong> — a
            folder is an organisation of the pipeline, never a part of it.
          </p>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2.5">
        <button
          onClick={onCancel}
          className="rounded-full border border-[#dceae8] bg-white px-5 py-2.5 text-[13.5px] text-[#5b6d6b]"
        >
          Keep it
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="rounded-full bg-[#c0574a] px-6 py-2.5 text-[13.5px] text-white disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete folder"}
        </button>
      </div>
    </Overlay>
  );
}

/**
 * Portalled to `document.body`.
 *
 * Every page is wrapped in `.animate-page-transition`, whose `will-change:
 * transform` makes it the containing block for its `position: fixed`
 * descendants — an overlay written inside the page is pinned to the page, not
 * the viewport, and renders cropped. See `components/ui/OverlayPanel`.
 */
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0f2a28]/45 px-4 py-8"
    >
      <div className="w-full max-w-[460px] rounded-2xl bg-white p-6 shadow-xl">{children}</div>
    </div>,
    document.body
  );
}
