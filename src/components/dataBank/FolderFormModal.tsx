"use client";

/**
 * New / Edit folder — a source, and the columns its sheets carry.
 *
 * The field builder is the heart of the Data Bank: the admin types the columns
 * their spreadsheet actually has, in the source's own words, and marks which
 * one is the name and which is the phone. Everything downstream — the import
 * mapping, the list, the detail pane, promotion — reads that list.
 *
 * On edit, existing fields keep their generated key, so renaming a label
 * ("Contact Number" → "Contact No") never orphans the values already stored
 * against it.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createDataBankFolder, updateDataBankFolder } from "@/lib/clientActions";
import { useSubAdmins } from "@/hooks/useEmployees";
import { useAuth } from "@/context/AuthContext";
import { MAX_FIELDS_PER_FOLDER } from "@/lib/dataBank";
import type { DataBankFolder } from "@/hooks/useDataBank";

interface Row {
  /** Present for a field that already exists; absent for a new one. */
  key?: string;
  label: string;
  /** Stable React identity, so removing a row does not remount its siblings. */
  uid: number;
}

const INPUT =
  "w-full rounded-md border border-[#dceae8] bg-[#f7fbfa] px-3 py-2.5 text-[13.5px] text-[#2b3a39] outline-none transition-colors placeholder:text-[#9aacaa] focus:border-[#4f9c99] focus:bg-white focus:ring-2 focus:ring-[#4f9c99]/15";
const LABEL = "flex flex-col gap-1.5 text-xs text-[#5b6d6b]";

export function FolderFormModal({
  folder,
  getIdToken,
  onClose,
  onSaved,
}: {
  folder?: DataBankFolder | null;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(folder);

  const [name, setName] = useState(folder?.name ?? "");
  const [code, setCode] = useState(folder?.code ?? "");
  const [description, setDescription] = useState(folder?.description ?? "");
  // Who this list belongs to. Empty means the admin keeps it — which is what
  // every folder created before the hierarchy means, so the empty option is
  // first and is the default.
  const [subAdminUid, setSubAdminUid] = useState(folder?.subAdminUid ?? "");
  /**
   * Who a folder belongs to is the **admin's** decision, so only the admin is
   * asked. `createDataBankFolder` files a manager's folder under their own uid
   * from the verified token, and `updateDataBankFolder` ignores the field for a
   * manager entirely — so this is a control that is absent rather than present
   * and quietly ignored.
   */
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { subAdmins } = useSubAdmins(isAdmin);
  const [rows, setRows] = useState<Row[]>(() =>
    folder
      ? folder.fields.map((field, index) => ({ key: field.key, label: field.label, uid: index }))
      : [
          { label: "", uid: 0 },
          { label: "", uid: 1 },
        ]
  );
  const [nameIndex, setNameIndex] = useState(() =>
    folder ? Math.max(0, folder.fields.findIndex((f) => f.key === folder.roles.name)) : 0
  );
  const [phoneIndex, setPhoneIndex] = useState(() =>
    folder ? Math.max(1, folder.fields.findIndex((f) => f.key === folder.roles.phone)) : 1
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "unset";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // `max + 1` rather than a counter, so a uid stays unique after removals
  // without reading a ref during render.
  const addRow = () =>
    setRows((list) => [...list, { label: "", uid: Math.max(-1, ...list.map((r) => r.uid)) + 1 }]);

  const removeRow = (index: number) => {
    setRows((list) => list.filter((_, i) => i !== index));
    // The two role pointers are positional, so they have to follow the shift.
    setNameIndex((current) => (current > index ? current - 1 : current === index ? 0 : current));
    setPhoneIndex((current) => (current > index ? current - 1 : current === index ? 0 : current));
  };

  const filled = rows.filter((row) => row.label.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError("Enter a name for the folder.");
    if (filled.length === 0) return setError("Add at least one field — the columns your sheet has.");
    if (nameIndex === phoneIndex) {
      return setError("The name and the phone number must be two different fields.");
    }
    if (!rows[nameIndex]?.label.trim() || !rows[phoneIndex]?.label.trim()) {
      return setError("The name and phone fields must both be filled in.");
    }

    setBusy(true);
    try {
      const token = await getIdToken();
      const payload = {
        name: name.trim(),
        code: code?.trim() || null,
        description: description?.trim() || null,
        // Blank rows are dropped, so the role indexes must be recomputed
        // against the list that is actually sent.
        fields: rows.filter((row) => row.label.trim()).map((row) => ({ key: row.key, label: row.label.trim() })),
        nameIndex: filled.findIndex((row) => row.uid === rows[nameIndex]?.uid),
        phoneIndex: filled.findIndex((row) => row.uid === rows[phoneIndex]?.uid),
        subAdminUid: subAdminUid || null,
      };

      const res = editing
        ? await updateDataBankFolder(token, folder!.id, payload)
        : await createDataBankFolder(token, payload);

      if (res.ok) onSaved(editing ? `${name.trim()} updated.` : `${name.trim()} created.`);
      else setError(res.error);
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4 py-8">
      <div className="animate-modal-fade fixed inset-0 bg-[#1e3a38]/45" onClick={onClose} aria-hidden />

      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit folder" : "New folder"}
        className="animate-modal-pop relative z-10 grid max-h-full w-full max-w-[640px] grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl bg-white shadow-[0_26px_70px_rgba(18,54,52,0.32)]"
      >
        <div className="bg-[#4f9c99] px-6 py-4 text-white">
          <div className="text-[17px] font-medium">{editing ? "Edit Folder" : "New Folder"}</div>
          <p className="mt-0.5 text-[12.5px] text-white/85">
            A source, and the columns its sheets carry.
          </p>
        </div>

        <div className="teal-scrollbar min-h-0 space-y-4 overflow-y-auto px-6 py-5">
          {error && (
            <div role="alert" className="rounded-md border border-[#f0c4bd] bg-[#fdeeeb] px-4 py-3 text-[13px] text-[#a33a29]">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <label className={LABEL}>
              <span>Folder Name *</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Capital Smart City"
                className={INPUT}
              />
            </label>
            <label className={LABEL}>
              <span>Short Code</span>
              <input
                value={code ?? ""}
                onChange={(e) => setCode(e.target.value)}
                placeholder="CSC"
                className={INPUT}
              />
            </label>
          </div>

          <label className={LABEL}>
            <span>Description</span>
            <input
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this list is, and where it came from"
              className={INPUT}
            />
          </label>

          {/* §7 — handing a folder to a sub admin. This is the only control
              that grants access to a cold list, so it says plainly what it
              does rather than reading as a filing label. Admin only; a manager
              is always making their own. */}
          {isAdmin && (
          <label className={LABEL}>
            <span>Assigned to</span>
            <select
              value={subAdminUid ?? ""}
              onChange={(e) => setSubAdminUid(e.target.value)}
              className={INPUT}
            >
              <option value="">Admin only</option>
              {subAdmins.map((person) => (
                <option key={person.uid} value={person.uid}>
                  {person.name}
                </option>
              ))}
            </select>
            <span className="text-[11.5px] text-[#9aacaa]">
              A sub admin can work and promote the rows in the folders assigned to them, and sees no
              others.
            </span>
          </label>
          )}

          <div className="h-px bg-[#e6f1f0]" />

          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[14.5px] text-[#2b3a39]">Fields</div>
                <p className="mt-0.5 text-[12.5px] text-[#7e918f]">
                  Name these exactly as your sheet names them. Mark which one is the name and which
                  is the phone number.
                </p>
              </div>
              <button
                type="button"
                onClick={addRow}
                disabled={rows.length >= MAX_FIELDS_PER_FOLDER}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#e8f5f3] px-4 py-2 text-[12.5px] text-[#2f7d78] transition-colors hover:bg-[#daeeeb] disabled:opacity-50"
              >
                + Add Field
              </button>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 gap-y-2">
              <span className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">Column name</span>
              <span className="text-center text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">Name</span>
              <span className="text-center text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">Phone</span>
              <span />

              {rows.map((row, index) => (
                <FieldRow
                  key={row.uid}
                  row={row}
                  index={index}
                  isName={nameIndex === index}
                  isPhone={phoneIndex === index}
                  canRemove={rows.length > 1}
                  onLabel={(label) =>
                    setRows((list) => list.map((r, i) => (i === index ? { ...r, label } : r)))
                  }
                  onName={() => setNameIndex(index)}
                  onPhone={() => setPhoneIndex(index)}
                  onRemove={() => removeRow(index)}
                />
              ))}
            </div>

            {editing && (
              <p className="mt-3 text-[12px] text-[#9aacaa]">
                Renaming a field keeps its data. Removing one hides its values rather than deleting
                them — adding the field back brings them straight back.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#e6f1f0] bg-[#f7fbfa] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-[#cfe2e0] bg-white px-6 py-2.5 text-[13.5px] text-[#5b6d6b] transition-colors hover:bg-[#f3faf9] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-[#3f8f8a] px-7 py-2.5 text-[13.5px] text-white transition-colors hover:bg-[#2f7d78] disabled:opacity-50"
          >
            {busy ? "Saving…" : editing ? "Save Changes" : "Create Folder"}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function FieldRow({
  row,
  index,
  isName,
  isPhone,
  canRemove,
  onLabel,
  onName,
  onPhone,
  onRemove,
}: {
  row: Row;
  index: number;
  isName: boolean;
  isPhone: boolean;
  canRemove: boolean;
  onLabel: (label: string) => void;
  onName: () => void;
  onPhone: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <input
        value={row.label}
        onChange={(e) => onLabel(e.target.value)}
        placeholder={index === 0 ? "e.g. Member Name" : index === 1 ? "e.g. Contact Number" : "e.g. Form Number"}
        aria-label={`Field ${index + 1} name`}
        className={INPUT}
      />
      <RoleDot checked={isName} onSelect={onName} label={`Use field ${index + 1} as the name`} />
      <RoleDot checked={isPhone} onSelect={onPhone} label={`Use field ${index + 1} as the phone number`} />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`Remove field ${index + 1}`}
        className="flex h-8 w-8 items-center justify-center rounded-md text-[#c0574a] transition-colors hover:bg-[#fdeeec] disabled:opacity-30"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </>
  );
}

/** A radio, drawn as a dot — two columns of these read faster than two selects. */
function RoleDot({
  checked,
  onSelect,
  label,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      onClick={onSelect}
      className={`mx-auto flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition-colors ${
        checked ? "border-[#3f8f8a] bg-[#3f8f8a]" : "border-[#cfe2e0] bg-white hover:border-[#8cc3bf]"
      }`}
    >
      {checked && <span className="h-2 w-2 rounded-full bg-white" aria-hidden />}
    </button>
  );
}
