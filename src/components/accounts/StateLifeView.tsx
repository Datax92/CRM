"use client";

/**
 * StateLife — the commission record.
 *
 * The columns are the workbook's columns, in the workbook's order, and the
 * commissions are `lib/stateLife`'s, transcribed from its formulas. Every rate
 * is a percentage of **PASS** with 8% tax folded in; see that module for why
 * that distinction is the one that matters.
 */

import { useMemo, useState } from "react";
import { Plus, ReceiptText, Wallet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFinanceCollection } from "@/hooks/useLedger";
import { EmptyState, A, CARD, Button, SummaryCard, Skeleton } from "./accountsChrome";
import { useIsMobile } from "@/hooks/useIsMobile";

/** The section tokens; `E` was the old alias. */
const E = A;
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import { stateLifeCommission, stateLifeTotals } from "@/lib/stateLife";
import { saveStateLifePolicy } from "@/lib/clientActions";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";

const FIELD: React.CSSProperties = {
  width: "100%", borderRadius: 9, border: `1px solid ${E.border}`, background: E.surface,
  padding: "8px 10px", fontSize: 13, color: E.ink, outline: "none", fontFamily: "inherit",
};

interface Row {
  id: string;
  proposalNo?: string; name?: string; fyp?: number; pass?: number; srCode?: string;
  dayKey?: string; paidAmount?: number; paidDayKey?: string; policyNumber?: string;
  description?: string; srName?: string; discount?: number; incomeNote?: string;
}

export function StateLifeView() {
  const { role, getIdToken } = useAuth();
  const ready = role === "admin" || role === "subadmin";
  const { records, loading } = useFinanceCollection("stateLifePolicies", ready);
  const [adding, setAdding] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const rows = records as unknown as Row[];
  const totals = useMemo(
    () => stateLifeTotals(rows.map((r) => ({ fyp: r.fyp ?? 0, pass: r.pass ?? 0, discount: r.discount ?? 0, paidAmount: r.paidAmount ?? 0 }))),
    [rows]
  );

  if (!ready) return <EmptyState icon={<Wallet size={20} />} title="Nothing here yet" body="StateLife is for administrators and HR." />;

  return (
    <div style={{ fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ fontFamily: "inherit", fontSize: 22, fontWeight: 700, color: E.ink }}>StateLife</h1>
          <p style={{ fontSize: 12.5, color: E.faint }}>
            Fresh business and its commission. Every rate is a percentage of <strong>PASS</strong>, less 8% tax.
          </p>
        </div>
        <Button primary icon={<Plus size={14} />} full={isMobile} onClick={() => setAdding(true)}>Add policy</Button>
      </header>

      {banner && <p role="status" style={{ marginBottom: 12, borderRadius: 10, background: E.tealTint, padding: "10px 13px", fontSize: 12.5, fontWeight: 600, color: E.deep }}>{banner}</p>}

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fill, minmax(168px,1fr))", marginBottom: 14 }}>
        <SummaryCard label="FYP" value={totals.fyp} icon={<ReceiptText size={14} />} mobile={isMobile} />
        <SummaryCard label="Pass" value={totals.pass} icon={<ReceiptText size={14} />} mobile={isMobile} />
        <SummaryCard label="Paid" value={totals.paidAmount} icon={<Wallet size={14} />} mobile={isMobile} />
        <SummaryCard label="Discount" value={totals.discount} icon={<ReceiptText size={14} />} mobile={isMobile} />
        <SummaryCard label="Net commission" value={totals.netCommission} icon={<Wallet size={14} />} tone={A.positive} mobile={isMobile} />
      </div>

      {loading ? <div style={{ display: "grid", gap: 8 }}><Skeleton height={64} count={4} /></div> : rows.length === 0 ? (
        <EmptyState icon={<Wallet size={20} />} title="Nothing here yet" body="No policies yet. Add one and its commission columns fill in from the passed amount." />
      ) : (
        isMobile ? (
        /* Twenty columns cannot be a table on a phone. Each policy becomes a
           card carrying the same figures, with the derived commissions grouped
           under the typed ones. */
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((row) => {
            const c = stateLifeCommission({ fyp: row.fyp ?? 0, pass: row.pass ?? 0, discount: row.discount ?? 0 });
            return (
              <div key={row.id} className="acc-in" style={{ ...CARD, padding: "13px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: A.ink }}>{row.name ?? "—"}</p>
                    <p style={{ fontSize: 11.5, color: A.faint, marginTop: 2 }}>
                      {row.proposalNo ?? "—"}{row.srName ? ` · ${row.srName}` : ""}{row.dayKey ? ` · ${row.dayKey}` : ""}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 15, fontWeight: 800, color: A.positive, fontVariantNumeric: "tabular-nums" }}>{formatMoney(c.netCommission)}</p>
                    <p style={{ fontSize: 10.5, color: A.faint }}>net commission</p>
                  </div>
                </div>
                {row.description && <p style={{ fontSize: 11.5, color: A.body, marginTop: 6 }}>{row.description}</p>}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 9, paddingTop: 9, borderTop: `1px solid ${A.rowBorder}`, fontSize: 11.5, color: A.faint }}>
                  <span>FYP <strong style={{ color: A.body }}>{formatMoney(row.fyp ?? 0)}</strong></span>
                  <span>Pass <strong style={{ color: A.ink }}>{formatMoney(row.pass ?? 0)}</strong></span>
                  <span>30% <strong style={{ color: A.body }}>{formatMoney(c.firstCommission)}</strong></span>
                  <span>10% <strong style={{ color: A.body }}>{formatMoney(c.secondCommission)}</strong></span>
                  <span>Disc. <strong style={{ color: A.body }}>{formatMoney(c.discount)}</strong></span>
                  <span>Rem. <strong style={{ color: c.remainingCommission < 0 ? A.negative : A.body }}>{formatMoney(c.remainingCommission)}</strong></span>
                </div>
              </div>
            );
          })}
        </div>
        ) : (
        <div style={{ ...CARD, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 1100 }}>
            <thead>
              <tr style={{ background: E.tint }}>
                {["Proposal", "Name", "FYP", "Pass", "Date", "Paid", "Policy #", "Status", "Sr Name",
                  "30%−8%", "10%−8%", "Discount", "Remaining", "Qtr 2.5%", "Dec 7.5%", "Net"].map((h) => (
                  <th key={h} style={{ padding: "9px 10px", textAlign: "left", fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: E.faint, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const c = stateLifeCommission({ fyp: row.fyp ?? 0, pass: row.pass ?? 0, discount: row.discount ?? 0 });
                return (
                  <tr key={row.id} style={{ borderTop: `1px solid ${E.rowBorder}` }}>
                    <td style={cell}>{row.proposalNo ?? "—"}</td>
                    <td style={{ ...cell, fontWeight: 700, color: E.ink }}>{row.name ?? "—"}</td>
                    <td style={num}>{formatMoney(row.fyp ?? 0)}</td>
                    <td style={{ ...num, fontWeight: 700 }}>{formatMoney(row.pass ?? 0)}</td>
                    <td style={cell}>{row.dayKey ?? "—"}</td>
                    <td style={num}>{formatMoney(row.paidAmount ?? 0)}</td>
                    <td style={cell}>{row.policyNumber ?? "—"}</td>
                    <td style={cell}>{row.description ?? "—"}</td>
                    <td style={cell}>{row.srName ?? "—"}</td>
                    <td style={num}>{formatMoney(c.firstCommission)}</td>
                    <td style={num}>{formatMoney(c.secondCommission)}</td>
                    <td style={num}>{formatMoney(c.discount)}</td>
                    {/* Negative is real — a discount can exceed the commission. */}
                    <td style={{ ...num, color: c.remainingCommission < 0 ? E.red : E.body }}>{formatMoney(c.remainingCommission)}</td>
                    <td style={num}>{formatMoney(c.quarterCommission)}</td>
                    <td style={num}>{formatMoney(c.decemberCommission)}</td>
                    <td style={{ ...num, fontWeight: 800, color: E.tealInk }}>{formatMoney(c.netCommission)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )
      )}

      {adding && (
        <AddPolicy onClose={() => setAdding(false)} getIdToken={getIdToken} onSaved={(m) => { setBanner(m); setAdding(false); }} />
      )}
    </div>
  );
}

const cell: React.CSSProperties = { padding: "8px 10px", color: E.body, whiteSpace: "nowrap" };
const num: React.CSSProperties = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" };

function AddPolicy({ onClose, getIdToken, onSaved }: { onClose: () => void; getIdToken: () => Promise<string>; onSaved: (m: string) => void }) {
  const [form, setForm] = useState({
    proposalNo: "", name: "", fyp: "", pass: "", srCode: "", dayKey: karachiDayKey(),
    paidAmount: "", policyNumber: "", description: "", srName: "", discount: "", incomeNote: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // The live preview, from the same function the server will run.
  const preview = stateLifeCommission({ fyp: Number(form.fyp), pass: Number(form.pass), discount: Number(form.discount) });

  return (
    <OverlayPanel title="Add policy" icon={<ReceiptText size={18} />} maxWidth={620} onClose={onClose}
      footer={
        <button type="button" disabled={busy || !form.name.trim() || !(Number(form.pass) > 0)}
          onClick={async () => {
            setBusy(true);
            const res = await saveStateLifePolicy(await getIdToken(), {
              proposalNo: form.proposalNo, name: form.name, fyp: Number(form.fyp) || 0,
              pass: Number(form.pass) || 0, srCode: form.srCode, dayKey: form.dayKey,
              paidAmount: Number(form.paidAmount) || 0, policyNumber: form.policyNumber,
              description: form.description, srName: form.srName,
              discount: Number(form.discount) || 0, incomeNote: form.incomeNote,
            });
            setBusy(false);
            if (res.ok) onSaved(`${form.name.trim()} added.`); else setError(res.error);
          }}
          style={{ borderRadius: 10, border: "none", background: E.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
          {busy ? "Saving…" : "Add policy"}
        </button>
      }>
      <OverlayCard title="Policy">
        <div style={{ display: "grid", gap: 9, gridTemplateColumns: "1fr 1fr" }}>
          <Input label="Proposal No" value={form.proposalNo} onChange={(v) => set("proposalNo", v)} />
          <Input label="Name" value={form.name} onChange={(v) => set("name", v)} />
          <Input label="FYP" value={form.fyp} onChange={(v) => set("fyp", v)} type="number" />
          <Input label="PASS — the commission base" value={form.pass} onChange={(v) => set("pass", v)} type="number" />
          <Input label="SR Code" value={form.srCode} onChange={(v) => set("srCode", v)} />
          <Input label="Date" value={form.dayKey} onChange={(v) => set("dayKey", v)} type="date" />
          <Input label="Paid amount" value={form.paidAmount} onChange={(v) => set("paidAmount", v)} type="number" />
          <Input label="Policy number" value={form.policyNumber} onChange={(v) => set("policyNumber", v)} />
          <Input label="Status / description" value={form.description} onChange={(v) => set("description", v)} />
          <Input label="Sr Name" value={form.srName} onChange={(v) => set("srName", v)} />
          <Input label="Discount" value={form.discount} onChange={(v) => set("discount", v)} type="number" />
          <Input label="Income note" value={form.incomeNote} onChange={(v) => set("incomeNote", v)} />
        </div>
      </OverlayCard>

      <div style={{ borderRadius: 12, border: `1px solid ${E.border}`, background: E.tint, padding: "12px 14px" }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: E.tealInk }}>Commission, from PASS</span>
        <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", marginTop: 8, fontSize: 12 }}>
          {[["30% − 8%", preview.firstCommission], ["10% − 8%", preview.secondCommission],
            ["Remaining", preview.remainingCommission], ["Qtr 2.5%", preview.quarterCommission],
            ["Dec 7.5%", preview.decemberCommission], ["Net", preview.netCommission]].map(([l, v]) => (
            <span key={l as string} style={{ color: E.muted }}>
              {l}: <strong style={{ color: E.ink, fontVariantNumeric: "tabular-nums" }}>{formatMoney(v as number)}</strong>
            </span>
          ))}
        </div>
      </div>
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}

function Input({ label, value, onChange, type }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, fontWeight: 600, color: E.muted }}>
      {label}
      <input type={type ?? "text"} value={value} onChange={(e) => onChange(e.target.value)} style={FIELD} />
    </label>
  );
}
