"use client";

/**
 * An employee's **personal lead** — a client they found themselves.
 *
 * Three fields: the name, the number, and which of the admin's Data Bank
 * folders it belongs under. The lead is theirs at once (it lands in their own
 * pipeline, accepted) and it appears in that folder's Assigned list under their
 * name, so the admin sees where it came from and who has it. See
 * `addPersonalLead`.
 *
 * **What the employee is shown is deliberately thin.** The folder list is names
 * only — no counts, no rows — because an employee cannot read the Data Bank, and
 * a duplicate refusal never says whose number it is.
 *
 * One component for both widths: `OverlayPanel` is already full-bleed on a phone
 * and centred on a desktop, and the inputs are 16px so iOS Safari does not zoom.
 */

import { useEffect, useState } from "react";
import { Database, UserPlus } from "lucide-react";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import {
  addPersonalLead,
  listPersonalLeadFolders,
  type PersonalLeadFolder,
} from "@/lib/clientActions";

const INK = "#1f3b39";
const MUTED = "#5b6d6b";
const FAINT = "#8fa2a0";
const LINE = "#dceae8";
const TEAL = "#2f7d78";

export function PersonalLeadModal({
  getIdToken,
  onClose,
  onAdded,
}: {
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onAdded: (message: string, leadId: string) => void;
}) {
  const [folders, setFolders] = useState<PersonalLeadFolder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [folderId, setFolderId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Every state update below happens after an `await`, never synchronously
    // in the effect body.
    void (async () => {
      try {
        const res = await listPersonalLeadFolders(await getIdToken());
        if (!live) return;
        if (res.ok) setFolders(res.data);
        else {
          setFolders([]);
          setLoadError(res.error);
        }
      } catch {
        if (!live) return;
        setFolders([]);
        setLoadError("Could not load the Data Bank folders. Check your connection.");
      }
    })();
    return () => {
      live = false;
    };
  }, [getIdToken]);

  const submit = async () => {
    setError(null);
    if (!folderId) return setError("Choose the Data Bank folder this lead belongs to.");
    if (!name.trim()) return setError("Enter the lead's name.");
    if (phone.replace(/\D/g, "").length < 7) return setError("Enter a usable phone number.");

    setBusy(true);
    try {
      const res = await addPersonalLead(await getIdToken(), {
        folderId,
        name: name.trim(),
        phone: phone.trim(),
      });
      if (res.ok) {
        onAdded(`${name.trim()} added to your leads, filed under ${res.data.folderName}.`, res.data.leadId);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Could not reach the server. Nothing was added — try again.");
    } finally {
      setBusy(false);
    }
  };

  const ready = folders !== null && folders.length > 0;

  return (
    <OverlayPanel
      title="Add a personal lead"
      subtitle="A client you found yourself"
      icon={<UserPlus size={18} color="#fff" />}
      maxWidth={480}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={quietButton}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !ready}
            style={{ ...primaryButton, opacity: busy || !ready ? 0.55 : 1, cursor: busy || !ready ? "not-allowed" : "pointer" }}
          >
            {busy ? "Adding…" : "Add lead"}
          </button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <OverlayCard title="Lead" icon={<UserPlus size={14} color={TEAL} />}>
          <label style={fieldWrap}>
            <span style={labelStyle}>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              autoComplete="off"
              placeholder="Client's name"
              style={inputStyle}
            />
          </label>
          <label style={{ ...fieldWrap, marginTop: 12 }}>
            <span style={labelStyle}>Phone number</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={busy}
              inputMode="tel"
              autoComplete="off"
              placeholder="0300 1234567"
              style={{ ...inputStyle, fontVariantNumeric: "tabular-nums" }}
            />
          </label>
        </OverlayCard>

        <OverlayCard
          title="Data Bank folder"
          icon={<Database size={14} color={TEAL} />}
          hint="Where this client came from. The lead is yours either way."
        >
          {folders === null ? (
            <p style={{ fontSize: 13, color: FAINT }}>Loading folders…</p>
          ) : folders.length === 0 ? (
            <p style={{ fontSize: 13, color: FAINT }}>
              {loadError ?? "There are no Data Bank folders to file a lead under yet. Ask your admin to create one."}
            </p>
          ) : (
            <label style={fieldWrap}>
              <span style={labelStyle}>Folder</span>
              <select
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
                disabled={busy}
                style={inputStyle}
              >
                <option value="">Choose a folder…</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.code ? `${folder.name} (${folder.code})` : folder.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </OverlayCard>

        {error && (
          <p
            role="alert"
            style={{
              borderRadius: 12,
              border: "1px solid #f0c4bd",
              background: "#fdeeeb",
              color: "#a33a29",
              padding: "10px 12px",
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.45,
            }}
          >
            {error}
          </p>
        )}
      </div>
    </OverlayPanel>
  );
}

const fieldWrap: React.CSSProperties = { display: "grid", gap: 5 };

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.6px",
  textTransform: "uppercase",
  color: FAINT,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: `1px solid ${LINE}`,
  background: "#fff",
  color: INK,
  padding: "10px 12px",
  // 16px, or iOS Safari zooms the page on focus.
  fontSize: 16,
  fontWeight: 500,
  outline: "none",
  fontFamily: "inherit",
};

const primaryButton: React.CSSProperties = {
  borderRadius: 999,
  border: "none",
  background: TEAL,
  color: "#fff",
  padding: "10px 22px",
  fontSize: 13.5,
  fontWeight: 700,
};

const quietButton: React.CSSProperties = {
  borderRadius: 999,
  border: `1px solid ${LINE}`,
  background: "#fff",
  color: MUTED,
  padding: "10px 18px",
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
};
