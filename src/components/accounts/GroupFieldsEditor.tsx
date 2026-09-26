"use client";

/**
 * The Mahziyar sheet's columns — the part the owner asked to be able to add to.
 *
 * Five columns are filled by the modules and cannot be removed, only renamed:
 * Total Income, Deal Profit, Personal Expense, Office Expense and Other Account
 * Spending. Every other column is a **field**: a name and whether it is income
 * or spending — "Committee / Kist", "Daddy Media", "Rent received". A field can
 * be **linked to accounts** (particular ones, or every account of a kind), and
 * the money moving through them fills it automatically; lines can still be
 * added to a month by hand on top.
 *
 * Removing a field hides it; its lines are kept and come back if it is added
 * again under the same name. That is `saveGroupConfig`'s rule, stated here so
 * the button says what it does.
 */

import { useState } from "react";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { saveGroupConfig } from "@/lib/clientActions";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DEFAULT_BUILTIN_LABELS, LINKABLE_MODULES, type BuiltinColumn, type GroupField, type GroupFieldType } from "@/lib/groupFinance";
import { ACCOUNT_KINDS, ACCOUNT_KIND_LABELS, type AccountKind } from "@/lib/ledger";
import { ICON, X } from "@/components/finance/expensesChrome";
import { Field, FooterButtons, FormError, FormGrid, Glyph, fieldStyle } from "./sheetForms";

const BUILTIN_HINTS: Record<BuiltinColumn, string> = {
  income: "Income into every account no income field is linked to: Marketing, Car Sale, StateLife, Investment with X and income added by hand.",
  deals: "Every closed deal in the month — the money it brought in (down payment, commission or remaining), before anybody’s cut.",
  personal: "Personal expenses dated in the month.",
  office: "Approved office expenses dated in the month.",
  accounts: "Money spent straight out of any account no spending field is linked to — salaries, manual expenses.",
};

type LinkAccount = { id: string; name: string; kind: string };

export function GroupFieldsEditor({
  fields,
  labels,
  accounts = [],
  getIdToken,
  onClose,
  onSaved,
}: {
  fields: GroupField[];
  /** The accounts a field can be linked to. */
  accounts?: LinkAccount[];
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
  /** Which live row's account picker is open, by its position in the list. */
  const [linking, setLinking] = useState<number | null>(null);

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
              hint={BUILTIN_HINTS[key]}
            >
              <input value={builtin[key]} onChange={(e) => { const v = e.target.value; setBuiltin((b) => ({ ...b, [key]: v })); }} style={field} />
            </Field>
          ))}
        </FormGrid>
      </OverlayCard>

      <OverlayCard title="Your fields" hint="Link a field to accounts to fill it automatically; lines can be added by hand too">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {live.length === 0 && <p style={{ fontSize: 12.5, color: X.faint }}>No fields yet.</p>}
          {live.map((row, index) => (
            <div key={row.key ?? `new-${index}`} style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: `1px solid ${X.rowLine}` }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: isMobile ? "wrap" : "nowrap" }}>
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
              <AccountLinks
                row={row}
                accounts={accounts}
                open={linking === index}
                onToggle={() => setLinking(linking === index ? null : index)}
                onChange={(next) => patch(row, next)}
              />
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

/**
 * Which accounts fill a field: every account of a kind (so a committee opened
 * next month is picked up) or particular accounts. Saved on the field; an
 * empty choice means the field is filled by hand only.
 */
function AccountLinks({
  row,
  accounts,
  open,
  onToggle,
  onChange,
}: {
  row: Partial<GroupField> & { type: GroupFieldType };
  accounts: LinkAccount[];
  open: boolean;
  onToggle: () => void;
  onChange: (next: Partial<GroupField>) => void;
}) {
  const kinds = row.accountKinds ?? [];
  const ids = row.accountIds ?? [];
  const modules = row.sourceModules ?? [];
  const nameOf = new Map(accounts.map((account) => [account.id, account.name]));
  const moduleOptions = LINKABLE_MODULES[row.type];
  const moduleLabel = new Map(moduleOptions.map((option) => [option.key, option.label]));
  // Every change saves all three lists, so a field once edited never falls
  // back to its default links.
  const links = { accountIds: ids, accountKinds: kinds, sourceModules: modules };
  const summary = [
    ...modules.map((key) => `every ${moduleLabel.get(key) ?? key} entry`),
    ...kinds.map((kind) => `every ${ACCOUNT_KIND_LABELS[kind as AccountKind] ?? kind} account`),
    ...ids.map((id) => nameOf.get(id) ?? "a deleted account"),
  ];
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const chip = (active: boolean): React.CSSProperties => ({
    borderRadius: 999, border: `1px solid ${active ? X.deep : X.line}`, background: active ? "#e3f1ef" : "#fff",
    color: active ? X.deep : X.muted, padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  });
  const kindsInUse = ACCOUNT_KINDS.filter((kind) => accounts.some((account) => account.kind === kind));
  const heading: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: X.faint, letterSpacing: 0.4, textTransform: "uppercase" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ alignSelf: "flex-start", border: "none", background: "transparent", padding: 0, fontSize: 12, fontWeight: 600, color: summary.length ? X.deep : X.faint, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
        {summary.length
          ? `${row.type === "INCOME" ? "Income into" : "Spending from"} ${summary.join(", ")}`
          : "Filled by hand only — link accounts"}{" "}
        {open ? "▴" : "▾"}
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 12, background: X.tint }}>
          <span style={heading}>Every entry from</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {moduleOptions.map((option) => (
              <button key={option.key} type="button" aria-pressed={modules.includes(option.key)} onClick={() => onChange({ ...links, sourceModules: toggle(modules, option.key) })} style={chip(modules.includes(option.key))}>
                {option.label}
              </button>
            ))}
          </div>
          <span style={heading}>Every account of a kind</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {kindsInUse.map((kind) => (
              <button key={kind} type="button" aria-pressed={kinds.includes(kind)} onClick={() => onChange({ ...links, accountKinds: toggle(kinds, kind) })} style={chip(kinds.includes(kind))}>
                {ACCOUNT_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
          <span style={heading}>Particular accounts</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {accounts.map((account) => (
              <button key={account.id} type="button" aria-pressed={ids.includes(account.id)} onClick={() => onChange({ ...links, accountIds: toggle(ids, account.id) })} style={chip(ids.includes(account.id))}>
                {account.name}
              </button>
            ))}
            {accounts.length === 0 && <span style={{ fontSize: 12, color: X.faint }}>No accounts yet.</span>}
          </div>
          <span style={{ fontSize: 11.5, color: X.faint, lineHeight: 1.5 }}>
            {row.type === "INCOME"
              ? "Income into these accounts fills this field instead of Total Income."
              : "Money spent out of these accounts fills this field instead of Other Account Spending. Office and personal expenses stay in their own columns."}
          </span>
        </div>
      )}
    </div>
  );
}
