"use client";

/**
 * The Mahziyar sheet's columns — the part the owner asked to be able to add to.
 *
 * Three columns are filled by the modules and cannot be removed, only renamed:
 * Total Income, Personal Expense, Office Expense. Every other column is a
 * **field**: a name and whether it is income or spending — "Committee / Kist",
 * "Daddy Media", "Rent received". Lines are added to a month against a field,
 * and the performance sheet sums them.
 *
 * Removing a field hides it; its lines are kept and come back if it is added
 * again under the same name. That is `saveGroupConfig`'s rule, stated here so
 * the button says what it does.
 */

import { useState } from "react";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { saveGroupConfig } from "@/lib/clientActions";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DEFAULT_BUILTIN_LABELS, type BuiltinColumn, type GroupField, type GroupFieldType } from "@/lib/groupFinance";
import { ICON, X } from "@/components/finance/expensesChrome";
import { Field, FooterButtons, FormError, FormGrid, Glyph, fieldStyle } from "./sheetForms";

export function GroupFieldsEditor({
  fields,
  labels,
  getIdToken,
  onClose,
  onSaved,
}: {
  fields: GroupField[];
  labels: Record<BuiltinColumn, string>;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const field = fieldStyle(isMobile);
  const [builtin, setBuiltin] = useState<Record<BuiltinColumn, string>>({ ...labels });
  const [rows, setRows] = useState<Array<Partial<GroupField> & { label: string; type: GroupFieldType }>>(
    fields.map((f) => ({ ...f }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = rows.filter((row) => !row.archived);
  const archived = rows.filter((row) => row.archived);

  const patch = (target: (typeof rows)[number], next: Partial<GroupField>) =>
    setRows((list) => list.map((row) => (row === target ? { ...row, ...next } : row)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await saveGroupConfig(await getIdToken(), { fields: rows, labels: builtin });
      if (result.ok) onSaved("Columns saved.");
      else setError(result.error);
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayPanel
      title="Sheet columns"
      subtitle="Rename, add or remove what the Mahziyar sheet tracks"
      icon={<Glyph d={ICON.tags} size={18} />}
      maxWidth={620}
      onClose={onClose}
      footer={<FooterButtons onCancel={onClose} onSubmit={() => void submit()} busy={busy} submitLabel="Save columns" />}
    >
      <OverlayCard title="Filled automatically" hint="Renameable — the modules fill these">
        <FormGrid isMobile={isMobile}>
          {(Object.keys(DEFAULT_BUILTIN_LABELS) as BuiltinColumn[]).map((key) => (
            <Field
              key={key}
              label={DEFAULT_BUILTIN_LABELS[key]}
              hint={
                key === "income"
                  ? "Every income account: Marketing, Car Sale, StateLife, Investment with X and income added to an account."
                  : key === "office"
                    ? "Approved office expenses dated in the month."
                    : "Personal expenses dated in the month."
              }
            >
              <input value={builtin[key]} onChange={(e) => { const v = e.target.value; setBuiltin((b) => ({ ...b, [key]: v })); }} style={field} />
            </Field>
          ))}
        </FormGrid>
      </OverlayCard>

      <OverlayCard title="Your fields" hint="Lines are added to a month against these">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {live.length === 0 && <p style={{ fontSize: 12.5, color: X.faint }}>No fields yet.</p>}
          {live.map((row, index) => (
            <div key={row.key ?? `new-${index}`} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: isMobile ? "wrap" : "nowrap" }}>
              <input value={row.label} aria-label="Field name" placeholder="Field name"
                onChange={(e) => patch(row, { label: e.target.value })} style={{ ...field, flex: "1 1 200px" }} />
              <select value={row.type} aria-label="Income or spending"
                onChange={(e) => patch(row, { type: e.target.value as GroupFieldType })}
                style={{ ...field, width: isMobile ? "auto" : 140, flex: isMobile ? "1 1 120px" : "0 0 auto", cursor: "pointer" }}>
                <option value="EXPENSE">Spending</option>
                <option value="INCOME">Income</option>
              </select>
              <button type="button" aria-label={`Remove ${row.label || "field"}`}
                onClick={() => (row.key ? patch(row, { archived: true }) : setRows((list) => list.filter((r) => r !== row)))}
                style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: "#a8483c", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Glyph d={ICON.cross} size={14} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setRows((list) => [...list, { label: "", type: "EXPENSE" }])}
            style={{ alignSelf: isMobile ? "stretch" : "flex-start", borderRadius: 11, border: `1px dashed ${X.track}`, background: "transparent", padding: "10px 14px", fontSize: 13, fontWeight: 700, color: X.deep, cursor: "pointer", fontFamily: "inherit" }}>
            + Add field
          </button>
        </div>
      </OverlayCard>

      {archived.length > 0 && (
        <OverlayCard title="Removed" hint="Their lines are kept — bring one back to show it again">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {archived.map((row) => (
              <button key={row.key} type="button" onClick={() => patch(row, { archived: false })}
                style={{ borderRadius: 999, border: `1px solid ${X.line}`, background: X.tint, color: X.muted, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                ↺ {row.label}
              </button>
            ))}
          </div>
        </OverlayCard>
      )}

      <FormError text={error} />
    </OverlayPanel>
  );
}
