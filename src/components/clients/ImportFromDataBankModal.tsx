"use client";

/**
 * Importing a Data Bank folder into Clients (§3).
 *
 * **This is not a second import system.** It runs the same
 * `promoteDataBankRecords` the Data Bank's own bulk bar runs, with the
 * importer as the assignee — and the server, seeing a manager or the admin
 * rather than an employee, files the resulting leads into the mirrored Client
 * folder instead of the employee pipeline (§5). So the whole folder, or a
 * selection out of it, arrives in Clients with the original lead id, source,
 * Data Bank folder and history intact.
 *
 * The mirrored folder has a deterministic id, so importing more of the same
 * source folder next week adds to the folder that already exists rather than
 * creating a second one with the same name.
 */

import { useMemo, useState } from "react";
import { Check, Database, FolderOpen, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { useDataBankFolders, useDataBankRecords } from "@/hooks/useDataBank";
import { promoteDataBankRecords } from "@/lib/clientActions";
import { A } from "@/components/attendance/attendanceChrome";

export function ImportFromDataBankModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const { user, role, getIdToken } = useAuth();

  const [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Whole folder, or the rows ticked below. */
  const [mode, setMode] = useState<"ALL" | "SOME">("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { folders } = useDataBankFolders(true, { role, uid: user?.uid });
  const page = useDataBankRecords(folderId, { search, enabled: Boolean(folderId) });

  const folder = useMemo(
    () => folders.find((entry) => entry.id === folderId) ?? null,
    [folders, folderId]
  );

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const importNow = async () => {
    setError(null);
    if (!folderId || !folder) {
      setError("Choose a data bank folder first.");
      return;
    }

    // "Whole folder" means the rows on this page plus every page after it,
    // which the cursor cannot hand over in one go. Rather than pretend
    // otherwise, it imports what is loaded and says so — and the count in the
    // button is the honest number.
    const ids = mode === "ALL" ? page.records.map((record) => record.id) : [...picked];
    if (ids.length === 0) {
      setError(mode === "ALL" ? "That folder has no records to import." : "Tick at least one lead.");
      return;
    }

    setBusy(true);
    const token = await getIdToken();
    const result = await promoteDataBankRecords(token, ids, user?.uid ?? "");
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onImported(
      `${result.data.promoted} lead${result.data.promoted === 1 ? "" : "s"} imported into ${folder.name}.` +
        (result.data.skipped ? ` ${result.data.skipped} were skipped.` : "")
    );
  };

  const count = mode === "ALL" ? page.records.length : picked.size;

  return (
    <OverlayPanel
      title="Import from the Data Bank"
      subtitle="The leads keep their id, source and history"
      icon={<Database size={18} color="#fff" />}
      maxWidth={640}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: A.muted }}>
            {folder ? `${count} selected` : "No folder chosen"}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} style={quietButton}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void importNow()}
              disabled={busy || !folder || count === 0}
              style={{
                ...primaryButton,
                cursor: busy || !folder || count === 0 ? "not-allowed" : "pointer",
                opacity: busy || !folder || count === 0 ? 0.55 : 1,
              }}
            >
              {busy ? "Importing…" : `Import ${count || ""}`.trim()}
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <OverlayCard title="Source folder" icon={<FolderOpen size={14} color={A.teal} />}>
          {folders.length === 0 ? (
            <p style={{ fontSize: 12.5, color: A.faint }}>
              No data bank folders yet. Create one in the Data Bank first.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {folders.map((entry) => {
                const active = entry.id === folderId;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setFolderId(entry.id);
                      setPicked(new Set());
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      borderRadius: 12,
                      border: `1px solid ${active ? A.teal : A.line}`,
                      background: active ? A.tealSoft : A.surface,
                      padding: "10px 13px",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 13.5,
                          fontWeight: 700,
                          color: active ? A.teal : A.ink,
                        }}
                      >
                        {entry.name}
                      </span>
                      <span style={{ display: "block", fontSize: 11.5, color: A.faint }}>
                        {entry.recordCount} record{entry.recordCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    {active && <Check size={16} color={A.teal} />}
                  </button>
                );
              })}
            </div>
          )}
        </OverlayCard>

        {folder && (
          <OverlayCard title="What to import">
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {(
                [
                  { key: "ALL", label: "Everything loaded" },
                  { key: "SOME", label: "Pick leads" },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setMode(option.key)}
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${mode === option.key ? A.teal : A.line}`,
                    background: mode === option.key ? A.tealSoft : A.surface,
                    color: mode === option.key ? A.teal : A.muted,
                    padding: "6px 14px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div style={{ position: "relative", marginBottom: 10 }}>
              <Search
                size={14}
                color={A.faint}
                style={{ position: "absolute", left: 11, top: 11 }}
                aria-hidden
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search this folder"
                style={{
                  width: "100%",
                  borderRadius: 10,
                  border: `1px solid ${A.line}`,
                  background: "#fff",
                  color: A.ink,
                  padding: "9px 11px 9px 32px",
                  fontSize: 16,
                  outline: "none",
                }}
              />
            </div>

            {page.loading && page.records.length === 0 ? (
              <p style={{ fontSize: 12.5, color: A.faint }}>Loading the folder…</p>
            ) : page.records.length === 0 ? (
              <p style={{ fontSize: 12.5, color: A.faint }}>Nothing in this folder matches.</p>
            ) : (
              <div style={{ display: "grid", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                {page.records.map((record) => {
                  const ticked = mode === "ALL" || picked.has(record.id);
                  return (
                    <label
                      key={record.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        borderRadius: 10,
                        border: `1px solid ${ticked ? A.teal : A.line}`,
                        background: ticked ? A.tealSoft : A.surface,
                        padding: "8px 11px",
                        cursor: mode === "ALL" ? "default" : "pointer",
                        opacity: mode === "ALL" ? 0.8 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={ticked}
                        disabled={mode === "ALL"}
                        onChange={() => toggle(record.id)}
                        style={{ width: 15, height: 15, accentColor: A.teal, flexShrink: 0 }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: A.ink }}>
                          {record.name}
                        </span>
                        <span style={{ display: "block", fontSize: 11.5, color: A.faint }}>
                          {record.phone || "No number"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {page.hasNext && mode === "ALL" && (
              <p style={{ marginTop: 9, fontSize: 11.5, color: "#8a6a17", lineHeight: 1.5 }}>
                This folder has more records than are loaded. Importing takes the{" "}
                {page.records.length} showing — scroll the Data Bank folder or import again to bring
                the rest across.
              </p>
            )}
          </OverlayCard>
        )}

        {error && (
          <p role="alert" style={{ fontSize: 12.5, color: "#a33a29", fontWeight: 600 }}>
            {error}
          </p>
        )}

        <p style={{ fontSize: 11.5, color: A.faint, lineHeight: 1.6 }}>
          Imported rows leave the Data Bank folder and become leads in your Client section, keeping
          their original source and folder name. Nothing is duplicated — the lead is the same
          record you would see in the pipeline.
        </p>
      </div>
    </OverlayPanel>
  );
}

const primaryButton: React.CSSProperties = {
  borderRadius: 999,
  border: "none",
  background: A.teal,
  color: "#fff",
  padding: "9px 20px",
  fontSize: 13,
  fontWeight: 700,
};

const quietButton: React.CSSProperties = {
  borderRadius: 999,
  border: `1px solid ${A.line}`,
  background: A.surface,
  color: A.muted,
  padding: "9px 18px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};
