"use client";

/**
 * Know Your Client — the confirmed client record, edited in place.
 *
 * One component, rendered by both the desktop detail pane and the phone lead
 * screen, so the two surfaces cannot end up collecting different fields or
 * validating them differently. The field list, the validation and the
 * lead-mirroring rule all live in `lib/kyc`; this is only the form.
 *
 * **The mirroring is stated on the form, not hidden in it.** Four of these
 * fields overwrite the lead's own columns the moment they save, which is a
 * surprising amount of consequence for a form that looks like a notes page —
 * so the fields that do it are marked, and the confirmation says which ones
 * moved.
 */

import { useMemo, useState } from "react";
import { IdCard, Save, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { saveKyc } from "@/lib/clientActions";
import {
  KYC_FIELDS,
  KYC_SECTIONS,
  kycField,
  kycCompleteness,
  validateKyc,
  type KycValues,
} from "@/lib/kyc";
import { formatBusinessDateTime } from "@/lib/dates";
import type { Lead } from "@/hooks/useLeads";

export interface KycPanelProps {
  lead: Lead;
  getIdToken: () => Promise<string>;
  /** Lets the host surface the result in its own banner slot. */
  onResult?: (banner: { tone: "success" | "error"; text: string } | null) => void;
  /** Phones get a single column and larger touch targets. */
  compact?: boolean;
  /** A closed lead keeps its record readable but no longer editable. */
  readOnly?: boolean;
}

export function KycPanel({ lead, getIdToken, onResult, compact = false, readOnly = false }: KycPanelProps) {
  // Seeded from the stored KYC, falling back to whatever the lead already
  // knows — the first time this is opened it should not be a blank page when
  // the ad form already supplied a name and a number.
  const initial = useMemo<KycValues>(() => {
    const stored = lead.kyc ?? {};
    return {
      name: stored.name ?? lead.name ?? "",
      phone: stored.phone ?? lead.phone ?? "",
      email: stored.email ?? lead.email ?? "",
      city: stored.city ?? lead.city ?? "",
      ...Object.fromEntries(
        KYC_FIELDS.filter((field) => !field.syncsTo).map((field) => [field.key, stored[field.key] ?? ""])
      ),
    };
  }, [lead]);

  const [values, setValues] = useState<KycValues>(initial);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

  const { filled, total } = kycCompleteness(values);
  const dirty = KYC_FIELDS.some((field) => (values[field.key] ?? "") !== (initial[field.key] ?? ""));

  const set = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    // The same validator the server runs. Checking here first means a typo in
    // a CNIC is caught before a round trip, not after one — it never objects to
    // a field simply being empty, because none of them are required.
    const check = validateKyc(values);
    if (check.errors.length > 0) {
      setErrors(check.errors);
      onResult?.({ tone: "error", text: check.errors[0] });
      return;
    }

    setErrors([]);
    setBusy(true);
    onResult?.(null);

    try {
      const result = await saveKyc(await getIdToken(), lead.id, values);
      if (result.ok) {
        const moved = ["name", "phone", "email", "city"].filter(
          (key) => (result.data.values[key] ?? "") && result.data.values[key] !== (lead as unknown as Record<string, string>)[key]
        );
        const text = moved.length
          ? `Client record saved. The lead's ${moved.join(", ")} now match it.`
          : "Client record saved.";
        setSaved(text);
        onResult?.({ tone: "success", text });
      } else {
        setErrors([result.error]);
        onResult?.({ tone: "error", text: result.error });
      }
    } catch {
      const text = "Could not reach the server. Check your connection.";
      setErrors([text]);
      onResult?.({ tone: "error", text });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-[880px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: "#e2f0ee", color: "#2f7d78" }}
            aria-hidden
          >
            <IdCard size={17} />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold text-[#1f3b39]">Know Your Client</h3>
            <p className="text-[12px] text-[#7e918f]">
              {filled} of {total} fields recorded
              {lead.kycUpdatedAt ? ` · updated ${formatBusinessDateTime(lead.kycUpdatedAt)}` : ""}
            </p>
          </div>
        </div>

        {dirty && !readOnly && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[#a4682a]">
            <AlertCircle size={13} /> Unsaved changes
          </span>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-lg border border-[#f0c4bd] bg-[#fdeeeb] p-3.5 text-xs text-[#a33a29]">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      {saved && (
        <p className="mb-4 inline-flex items-center gap-2 rounded-lg border border-[#cfe2e0] bg-[#eaf6f4] px-3.5 py-2.5 text-xs text-[#2f7d78]">
          <CheckCircle2 size={14} /> {saved}
        </p>
      )}

      <div className="space-y-4">
        {KYC_SECTIONS.map((section) => (
          <section key={section.title} className="overflow-hidden rounded-xl border border-[#e0eeec] bg-white">
            <h4 className="border-b border-[#f0f6f5] px-5 py-3 text-[12px] font-semibold tracking-[0.6px] text-[#5b6d6b] uppercase">
              {section.title}
            </h4>

            <div className={`grid gap-4 p-5 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
              {section.keys.map((key) => {
                const field = kycField(key);
                if (!field) return null;
                const id = `kyc-${lead.id}-${key}`;

                return (
                  <div key={key} className={field.kind === "longtext" && !compact ? "sm:col-span-2" : undefined}>
                    <label
                      htmlFor={id}
                      className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-[#5b6d6b]"
                    >
                      {field.label}
                      {/* These four rewrite the lead row on save. Saying so on
                          the field is the only place a person would look. */}
                      {field.syncsTo && (
                        <span
                          title="Saving also updates this on the lead"
                          className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px]"
                          style={{ background: "#e2f0ee", color: "#2f7d78" }}
                        >
                          <RefreshCw size={9} /> lead
                        </span>
                      )}
                    </label>

                    {field.kind === "longtext" ? (
                      <textarea
                        id={id}
                        rows={compact ? 3 : 2}
                        value={values[key] ?? ""}
                        disabled={readOnly || busy}
                        placeholder={field.placeholder}
                        onChange={(event) => set(key, event.target.value)}
                        className="w-full resize-y rounded-lg border border-[#d6e7e5] bg-white px-3 py-2 text-[13.5px] text-[#1f3b39] outline-none placeholder:text-[#9aacaa] focus:border-[#4f9c99] disabled:bg-[#f6faf9]"
                      />
                    ) : (
                      <input
                        id={id}
                        type={field.kind === "date" ? "date" : field.kind === "email" ? "email" : "text"}
                        inputMode={
                          field.kind === "phone" ? "tel" : field.kind === "money" ? "decimal" : undefined
                        }
                        value={values[key] ?? ""}
                        disabled={readOnly || busy}
                        placeholder={field.placeholder}
                        onChange={(event) => set(key, event.target.value)}
                        className="w-full rounded-lg border border-[#d6e7e5] bg-white px-3 py-2 text-[13.5px] text-[#1f3b39] outline-none placeholder:text-[#9aacaa] focus:border-[#4f9c99] disabled:bg-[#f6faf9]"
                      />
                    )}

                    {field.hint && <p className="mt-1 text-[11px] text-[#9aacaa]">{field.hint}</p>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {!readOnly && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13.5px] font-medium text-white transition-opacity disabled:opacity-60"
            style={{ background: "#2f7d78" }}
          >
            <Save size={15} />
            {busy ? "Saving…" : "Save client record"}
          </button>
          <span className="text-[12px] text-[#7e918f]">
            The CNIC and address carry into Deal Entry automatically.
          </span>
        </div>
      )}
    </form>
  );
}
