"use client";

/**
 * Add or edit one record by hand.
 *
 * The form is generated from the folder's own fields — there is no fixed set
 * of inputs here, because there is no fixed set of columns. The two fields
 * carrying the name and phone are marked required, since a record without
 * them cannot be called, deduped or promoted.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { addDataBankRecord, updateDataBankRecord } from "@/lib/clientActions";
import type { DataBankFolder, DataBankRecord } from "@/hooks/useDataBank";

const INPUT =
  "w-full rounded-md border border-[#dceae8] bg-[#f7fbfa] px-3 py-2.5 text-[13.5px] text-[#2b3a39] outline-none transition-colors placeholder:text-[#9aacaa] focus:border-[#4f9c99] focus:bg-white focus:ring-2 focus:ring-[#4f9c99]/15";

export function RecordFormModal({
  folder,
  record,
  getIdToken,
  onClose,
  onSaved,
}: {
  folder: DataBankFolder;
  record?: DataBankRecord | null;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(record);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const field of folder.fields) seed[field.key] = record?.values[field.key] ?? "";
    return seed;
  });
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const token = await getIdToken();
      const res = editing
        ? await updateDataBankRecord(token, record!.id, { values })
        : await addDataBankRecord(token, folder.id, values);

      if (res.ok) {
        onSaved(editing ? "Record updated." : `${values[folder.roles.name] || "Record"} added.`);
      } else {
        setError(res.error);
      }
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
        aria-label={editing ? "Edit record" : "Add record"}
        className="animate-modal-pop relative z-10 grid max-h-full w-full max-w-[540px] grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl bg-white shadow-[0_26px_70px_rgba(18,54,52,0.32)]"
      >
        <div className="bg-[#4f9c99] px-6 py-4 text-white">
          <div className="text-[17px] font-medium">{editing ? "Edit Record" : "Add Record"}</div>
          <p className="mt-0.5 text-[12.5px] text-white/85">{folder.name}</p>
        </div>

        <div className="teal-scrollbar min-h-0 space-y-3.5 overflow-y-auto px-6 py-5">
          {error && (
            <div role="alert" className="rounded-md border border-[#f0c4bd] bg-[#fdeeeb] px-4 py-3 text-[13px] text-[#a33a29]">
              {error}
            </div>
          )}

          {folder.fields.map((field) => {
            const required = field.key === folder.roles.name || field.key === folder.roles.phone;
            return (
              <label key={field.key} className="flex flex-col gap-1.5 text-xs text-[#5b6d6b]">
                <span>
                  {field.label}
                  {required && <span className="text-[#e05a4a]"> *</span>}
                </span>
                <input
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))}
                  inputMode={field.key === folder.roles.phone ? "tel" : undefined}
                  className={INPUT}
                />
              </label>
            );
          })}
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
            {busy ? "Saving…" : editing ? "Save Changes" : "Add Record"}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
