"use client";

/**
 * The Client section on a phone.
 *
 * **The Data Bank's folder screen, with different nouns.** The header, the
 * stat strip, the card, the figures, the action row, the empty state and the
 * skeletons are all imported from `MobileDataBank` rather than rebuilt — they
 * are the same screen doing the same job, and a second copy would drift the
 * first time either is touched.
 *
 * Opening a folder does not lead here: it leads to `MobileLeads`, scoped to
 * the folder, which is the phone's own leads screen. There is one lead list
 * and one lead detail in this product, and a Client folder is a view of them.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useClientFolders, type ClientFolder } from "@/hooks/useClients";
import { createClientFolder, updateClientFolder, deleteClientFolder } from "@/lib/clientActions";
import { MobileHeader, HeaderCircle, M } from "./mobileChrome";
import { AccountButton } from "./MobileAccount";
import {
  EYEBROW,
  TITLE,
  LIST_BODY,
  HeaderStat,
  Note,
  Empty,
  SkeletonCards,
  Figure,
  MiniAction,
} from "./MobileDataBank";
import { ImportFromDataBankModal } from "@/components/clients/ImportFromDataBankModal";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";

export function MobileClientFolders({ basePath }: { basePath: string }) {
  const { role, user, getIdToken } = useAuth();
  const isManager = role === "admin" || role === "subadmin";
  const router = useRouter();

  const { folders, loading, error } = useClientFolders(isManager, { role, uid: user?.uid });

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
          text: `${folder.name} deleted. The leads it held are untouched.`,
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

  return (
    <>
      <MobileHeader>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={EYEBROW}>Clients</div>
            <h1 style={TITLE}>Folders</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <HeaderCircle label="Import from Data Bank" onClick={() => setImporting(true)}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3ZM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7" />
              </svg>
            </HeaderCircle>
            <HeaderCircle label="New folder" onClick={() => setFormFor({ folder: null })}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </HeaderCircle>
            <AccountButton />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <HeaderStat label="Folders" value={folders.length.toLocaleString()} />
          <HeaderStat label="Leads" value={totals.leads.toLocaleString()} />
          <HeaderStat label="Imported" value={totals.imported.toLocaleString()} />
        </div>
      </MobileHeader>

      <div style={LIST_BODY}>
        {error && <Note tone="error">{error}</Note>}
        {banner && <Note tone={banner.tone}>{banner.text}</Note>}

        {loading ? (
          <SkeletonCards />
        ) : folders.length === 0 ? (
          <Empty
            title="No client folders yet."
            body="A folder groups leads you are working. Import a whole Data Bank folder, or a selection out of one — the leads keep their id, source and history."
          />
        ) : (
          folders.map((folder, index) => (
            <div
              key={folder.id}
              style={{
                background: M.cardBg,
                border: `1px solid ${M.cardBorder}`,
                borderRadius: M.cardRadius,
                overflow: "hidden",
                // A flex item in a column container shrinks below its content
                // by default, and the body above is `flex: 1` — without this
                // the card's action row is clipped off the bottom edge.
                flexShrink: 0,
                animation:
                  index < 8
                    ? `mob-rise 300ms cubic-bezier(0.22,0.61,0.36,1) ${index * 32}ms both`
                    : undefined,
              }}
            >
              <button
                className="mob-press"
                onClick={() => router.push(`${basePath}/${folder.id}`)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: "transparent",
                  padding: "15px 16px 13px",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {folder.dataBankFolderId && (
                    <span
                      style={{
                        flexShrink: 0,
                        borderRadius: 7,
                        background: M.tealTint,
                        color: M.tealDeep,
                        padding: "2px 7px",
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: "0.5px",
                      }}
                    >
                      DATA BANK
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      letterSpacing: "-0.35px",
                      color: M.ink,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {folder.name}
                  </span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={M.teal}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    style={{ marginLeft: "auto", flexShrink: 0 }}
                    aria-hidden
                  >
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </div>

                {folder.description && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      fontWeight: 500,
                      color: M.fainter,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {folder.description}
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "flex-end", gap: 22, marginTop: 12 }}>
                  <Figure value={folder.leadCount.toLocaleString()} label="Leads" />
                  {folder.dataBankFolderName && (
                    <Figure value={folder.dataBankFolderName} label="Source" tone={M.tealDeep} />
                  )}
                </div>
              </button>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  borderTop: `1px solid ${M.divider}`,
                  padding: "8px 12px",
                }}
              >
                <MiniAction
                  onPress={() => setFormFor({ folder })}
                  d="M4 20h4L19 9l-4-4L4 16zM14 5l4 4"
                >
                  Rename
                </MiniAction>
                <div style={{ marginLeft: "auto" }}>
                  <MiniAction
                    tone={M.red}
                    onPress={() => setConfirming(folder)}
                    d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"
                  >
                    Delete
                  </MiniAction>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

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
        <FolderSheet
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
        <OverlayPanel
          title={`Delete ${confirming.name}?`}
          subtitle="The leads it holds are untouched"
          maxWidth={460}
          onClose={() => setConfirming(null)}
          footer={
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirming(null)} style={quietButton}>
                Keep it
              </button>
              <button
                onClick={() => void remove(confirming)}
                disabled={busy}
                style={{ ...dangerButton, opacity: busy ? 0.6 : 1 }}
              >
                {busy ? "Deleting…" : "Delete folder"}
              </button>
            </div>
          }
        >
          <OverlayCard title="What this removes">
            <p style={{ fontSize: 13, color: M.muted, lineHeight: 1.6 }}>
              The folder and its {confirming.leadCount} membership
              {confirming.leadCount === 1 ? "" : "s"}. <strong>The leads themselves stay</strong> —
              a folder is an organisation of the pipeline, never a part of it.
            </p>
          </OverlayCard>
        </OverlayPanel>
      )}
    </>
  );
}

function FolderSheet({
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
    <OverlayPanel
      title={folder ? "Rename folder" : "New client folder"}
      subtitle="Nothing is copied into a folder"
      maxWidth={460}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={quietButton}>
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Saving…" : folder ? "Save" : "Create folder"}
          </button>
        </div>
      }
    >
      <OverlayCard title="Folder">
        <label style={{ display: "grid", gap: 5 }}>
          <span style={sheetLabel}>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            placeholder="Facile Town 2"
            style={sheetField}
          />
        </label>

        <label style={{ display: "grid", gap: 5, marginTop: 12 }}>
          <span style={sheetLabel}>Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            disabled={busy}
            placeholder="What this folder is for."
            style={{ ...sheetField, resize: "vertical" }}
          />
        </label>

        {error && (
          <p role="alert" style={{ marginTop: 10, fontSize: 12.5, color: M.red, fontWeight: 600 }}>
            {error}
          </p>
        )}
      </OverlayCard>
    </OverlayPanel>
  );
}

const sheetLabel: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.6px",
  textTransform: "uppercase",
  color: M.fainter,
};

const sheetField: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: `1px solid ${M.cardBorder}`,
  background: "#fff",
  color: M.ink,
  padding: "10px 12px",
  // 16px, or iOS Safari zooms the page on focus.
  fontSize: 16,
  fontWeight: 600,
  outline: "none",
  fontFamily: "inherit",
};

const primaryButton: React.CSSProperties = {
  borderRadius: 999,
  border: "none",
  background: M.tealDeep,
  color: "#fff",
  padding: "10px 20px",
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
};

const dangerButton: React.CSSProperties = { ...primaryButton, background: M.red };

const quietButton: React.CSSProperties = {
  borderRadius: 999,
  border: `1px solid ${M.cardBorder}`,
  background: "#fff",
  color: M.muted,
  padding: "10px 18px",
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
};
