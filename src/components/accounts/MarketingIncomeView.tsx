"use client";

/**
 * Mahziyar Marketing — income, and the three cuts that come out of it.
 *
 * **Deliberately not routed through the deal profit split.**
 * `lib/profitDistribution` splits a closed CRM deal, where the admin finalises
 * percentages against a cut base; this is a marketing receipt with three
 * amounts typed straight in. Putting one through the other would give
 * `dealPayouts` a second meaning and make every commission report ambiguous
 * about which kind of earning it was counting.
 *
 * `Total cost` is the sum of the three cuts and is **derived**, so it cannot
 * disagree with its parts. The money itself only exists in the ledger once it
 * is received into an account — that is the "Receive into…" button.
 */

import { useMemo, useState } from "react";
import { Plus, TrendingUp, Wallet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFinanceCollection, useLedger } from "@/hooks/useLedger";
import { useEmployees, useSubAdmins } from "@/hooks/useEmployees";
import { EmptyState, A, CARD, Button, SummaryCard, Skeleton } from "./accountsChrome";
import { useIsMobile } from "@/hooks/useIsMobile";

/** The section tokens; `E` was the old alias. */
const E = A;
import { PayFromAccounts } from "./PayFromAccounts";
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import { saveMarketingIncome } from "@/lib/clientActions";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";

const FIELD: React.CSSProperties = {
  width: "100%", borderRadius: 9, border: `1px solid ${E.border}`, background: E.surface,
  padding: "8px 10px", fontSize: 13, color: E.ink, outline: "none", fontFamily: "inherit",
};

interface Row {
  id: string; dayKey?: string; customerName?: string; soldByName?: string; teamName?: string;
  description?: string; amountReceived?: number; staffCommission?: number; teamCommission?: number;
  companyCommission?: number; totalCost?: number; netIncome?: number;
  paidAmount?: number; amount?: number;
}

export function MarketingIncomeView() {
  const { role, getIdToken } = useAuth();
  const ready = role === "admin" || role === "subadmin";
  const { records, loading } = useFinanceCollection("marketingIncome", ready);
  const ledger = useLedger(ready);
  const [adding, setAdding] = useState(false);
  const [receiving, setReceiving] = useState<Row | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const rows = records as unknown as Row[];
  const totals = useMemo(() => rows.reduce((t, r) => ({
    received: t.received + (r.amountReceived ?? 0),
    cost: t.cost + (r.totalCost ?? 0),
    net: t.net + (r.netIncome ?? 0),
  }), { received: 0, cost: 0, net: 0 }), [rows]);

  if (!ready) return <EmptyState icon={<Wallet size={20} />} title="Nothing here yet" body="Marketing income is for administrators and HR." />;

  return (
    <div style={{ fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ fontFamily: "inherit", fontSize: 22, fontWeight: 700, color: E.ink }}>Mahziyar Marketing Income</h1>
          <p style={{ fontSize: 12.5, color: E.faint }}>What came in, what it cost in commission, and what the company kept.</p>
        </div>
        <Button primary icon={<Plus size={14} />} full={isMobile} onClick={() => setAdding(true)}>Add income</Button>
      </header>

      {banner && <p role="status" style={{ marginBottom: 12, borderRadius: 10, background: E.tealTint, padding: "10px 13px", fontSize: 12.5, fontWeight: 600, color: E.deep }}>{banner}</p>}

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(180px,1fr))", marginBottom: 14 }}>
        <SummaryCard label="Amount received" value={totals.received} icon={<TrendingUp size={14} />} tone={A.positive} mobile={isMobile} />
        <SummaryCard label="Total cost" value={totals.cost} icon={<Wallet size={14} />} tone={A.negative} mobile={isMobile} />
        <SummaryCard label="Net income" value={totals.net} icon={<TrendingUp size={14} />} mobile={isMobile} />
      </div>

      {loading ? (
        <div style={{ display: "grid", gap: 8 }}><Skeleton height={64} count={4} /></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<TrendingUp size={22} />}
          title="No marketing income yet"
          body="Record a sale and its three commission cuts. Receiving it into an account posts the movement to the ledger automatically."
          action={<Button primary icon={<Plus size={14} />} onClick={() => setAdding(true)}>Add income</Button>}
          mobile={isMobile}
        />
      ) : (
        isMobile ? (
        /* **Cards, not a squeezed table.** Eleven columns at 390px is a
           horizontal scrollbar nobody uses; every figure below is still here. */
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((row) => {
            const paid = row.paidAmount ?? 0;
            return (
              <div key={row.id} className="acc-in" style={{ ...CARD, padding: "13px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: A.ink }}>{row.customerName ?? "—"}</p>
                    <p style={{ fontSize: 11.5, color: A.faint, marginTop: 2 }}>
                      {row.dayKey ?? "—"}{row.soldByName ? ` · ${row.soldByName}` : ""}{row.teamName ? ` · ${row.teamName}` : ""}
                    </p>
                  </div>
                  <p style={{ fontSize: 15, fontWeight: 800, color: A.positive, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {formatMoney(row.amountReceived ?? 0)}
                  </p>
                </div>
                {row.description && <p style={{ fontSize: 12, color: A.body, marginTop: 6 }}>{row.description}</p>}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 9, paddingTop: 9, borderTop: `1px solid ${A.rowBorder}`, fontSize: 11.5, color: A.faint }}>
                  <span>Staff <strong style={{ color: A.body }}>{formatMoney(row.staffCommission ?? 0)}</strong></span>
                  <span>Team <strong style={{ color: A.body }}>{formatMoney(row.teamCommission ?? 0)}</strong></span>
                  <span>Company <strong style={{ color: A.body }}>{formatMoney(row.companyCommission ?? 0)}</strong></span>
                  <span>Cost <strong style={{ color: A.ink }}>{formatMoney(row.totalCost ?? 0)}</strong></span>
                </div>
                <div style={{ marginTop: 10 }}>
                  {paid >= (row.amountReceived ?? 0)
                    ? <span style={{ fontSize: 12, fontWeight: 700, color: A.positive }}>Received</span>
                    : <Button full onClick={() => setReceiving(row)}>Receive into…</Button>}
                </div>
              </div>
            );
          })}
        </div>
        ) : (
        <div style={{ ...CARD, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 960 }}>
            <thead>
              <tr style={{ background: E.tint }}>
                {["Date", "Customer", "Sold by", "Team", "Description", "Received", "Staff", "Team", "Company", "Total cost", ""].map((h, i) => (
                  <th key={i} style={{ padding: "9px 10px", textAlign: i >= 5 && i <= 9 ? "right" : "left", fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: E.faint, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const paid = row.paidAmount ?? 0;
                return (
                  <tr key={row.id} style={{ borderTop: `1px solid ${E.rowBorder}` }}>
                    <td style={cell}>{row.dayKey ?? "—"}</td>
                    <td style={{ ...cell, fontWeight: 700, color: E.ink }}>{row.customerName ?? "—"}</td>
                    <td style={cell}>{row.soldByName ?? "—"}</td>
                    <td style={cell}>{row.teamName ?? "—"}</td>
                    <td style={{ ...cell, whiteSpace: "normal", maxWidth: 220 }}>{row.description ?? "—"}</td>
                    <td style={{ ...num, fontWeight: 700, color: E.tealInk }}>{formatMoney(row.amountReceived ?? 0)}</td>
                    <td style={num}>{formatMoney(row.staffCommission ?? 0)}</td>
                    <td style={num}>{formatMoney(row.teamCommission ?? 0)}</td>
                    <td style={num}>{formatMoney(row.companyCommission ?? 0)}</td>
                    <td style={{ ...num, fontWeight: 700 }}>{formatMoney(row.totalCost ?? 0)}</td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      {paid >= (row.amountReceived ?? 0) ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: E.tealInk }}>Received</span>
                      ) : (
                        <button type="button" onClick={() => setReceiving(row)}
                          style={{ border: `1px solid ${E.border}`, background: E.surface, borderRadius: 999, padding: "4px 11px", fontSize: 11.5, fontWeight: 700, color: E.tealInk, cursor: "pointer" }}>
                          Receive into…
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )
      )}

      {adding && <AddIncome onClose={() => setAdding(false)} getIdToken={getIdToken} onSaved={(m) => { setBanner(m); setAdding(false); }} />}

      {/* Income uses the same split control as an expense, with the direction
          flipped: money can arrive across several accounts too. */}
      {receiving && (
        <PayFromAccounts
          open
          onClose={() => setReceiving(null)}
          onPaid={(text) => setBanner(text)}
          accounts={ledger.accounts}
          balances={ledger.balances}
          getIdToken={getIdToken}
          source={{
            module: "MARKETING_INCOME",
            collection: "marketingIncome",
            id: receiving.id,
            label: `Marketing — ${receiving.customerName ?? "income"}`,
            amount: receiving.amountReceived ?? 0,
            alreadyPaid: receiving.paidAmount ?? 0,
            direction: "IN",
            type: "INCOME",
          }}
        />
      )}
    </div>
  );
}

const cell: React.CSSProperties = { padding: "8px 10px", color: E.body, whiteSpace: "nowrap" };
const num: React.CSSProperties = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" };

function AddIncome({ onClose, getIdToken, onSaved }: { onClose: () => void; getIdToken: () => Promise<string>; onSaved: (m: string) => void }) {
  const { employees } = useEmployees(true);
  const { subAdmins } = useSubAdmins(true);
  const [form, setForm] = useState({
    dayKey: karachiDayKey(), customerName: "", soldByUid: "", teamUid: "", description: "",
    amountReceived: "", staffCommission: "", teamCommission: "", companyCommission: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const totalCost = (Number(form.staffCommission) || 0) + (Number(form.teamCommission) || 0) + (Number(form.companyCommission) || 0);
  const net = (Number(form.amountReceived) || 0) - totalCost;

  return (
    <OverlayPanel title="Add marketing income" icon={<TrendingUp size={18} />} maxWidth={600} onClose={onClose}
      footer={
        <button type="button" disabled={busy || !form.customerName.trim() || !(Number(form.amountReceived) > 0) || net < 0}
          onClick={async () => {
            setBusy(true);
            const res = await saveMarketingIncome(await getIdToken(), {
              dayKey: form.dayKey, customerName: form.customerName,
              soldByUid: form.soldByUid || null,
              soldByName: employees.find((e) => e.uid === form.soldByUid)?.name ?? null,
              teamUid: form.teamUid || null,
              teamName: subAdmins.find((s) => s.uid === form.teamUid)?.name ?? null,
              description: form.description, amountReceived: Number(form.amountReceived) || 0,
              staffCommission: Number(form.staffCommission) || 0,
              teamCommission: Number(form.teamCommission) || 0,
              companyCommission: Number(form.companyCommission) || 0,
            });
            setBusy(false);
            if (res.ok) onSaved(`${form.customerName.trim()} recorded.`); else setError(res.error);
          }}
          style={{ borderRadius: 10, border: "none", background: E.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: busy || net < 0 ? 0.5 : 1 }}>
          {busy ? "Saving…" : "Add income"}
        </button>
      }>
      <OverlayCard title="The sale">
        <div style={{ display: "grid", gap: 9, gridTemplateColumns: "1fr 1fr" }}>
          <Field label="Date"><input type="date" value={form.dayKey} onChange={(e) => set("dayKey", e.target.value)} style={FIELD} /></Field>
          <Field label="Customer name"><input value={form.customerName} onChange={(e) => set("customerName", e.target.value)} style={FIELD} /></Field>
          <Field label="Sold by">
            <select value={form.soldByUid} onChange={(e) => set("soldByUid", e.target.value)} style={{ ...FIELD, cursor: "pointer" }}>
              <option value="">—</option>
              {employees.map((e) => <option key={e.uid} value={e.uid}>{e.name}</option>)}
            </select>
          </Field>
          <Field label="Team (sub admin)">
            <select value={form.teamUid} onChange={(e) => set("teamUid", e.target.value)} style={{ ...FIELD, cursor: "pointer" }}>
              <option value="">—</option>
              {subAdmins.map((s) => <option key={s.uid} value={s.uid}>{s.name}</option>)}
            </select>
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Description"><input value={form.description} onChange={(e) => set("description", e.target.value)} style={FIELD} /></Field>
          </div>
          <Field label="Amount received"><input type="number" value={form.amountReceived} onChange={(e) => set("amountReceived", e.target.value)} style={FIELD} /></Field>
        </div>
      </OverlayCard>

      <OverlayCard title="Commission — the three cuts">
        <div style={{ display: "grid", gap: 9, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <Field label="Staff"><input type="number" value={form.staffCommission} onChange={(e) => set("staffCommission", e.target.value)} style={FIELD} /></Field>
          <Field label="Team (sub admins)"><input type="number" value={form.teamCommission} onChange={(e) => set("teamCommission", e.target.value)} style={FIELD} /></Field>
          <Field label="Company"><input type="number" value={form.companyCommission} onChange={(e) => set("companyCommission", e.target.value)} style={FIELD} /></Field>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${E.rowBorder}`, fontSize: 12.5 }}>
          <span style={{ color: E.muted, fontWeight: 700 }}>Total cost — the three cuts, added</span>
          <span style={{ fontWeight: 800, color: net < 0 ? E.red : E.ink, fontVariantNumeric: "tabular-nums" }}>{formatMoney(totalCost)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, marginTop: 4 }}>
          <span style={{ color: E.muted, fontWeight: 700 }}>Company keeps</span>
          <span style={{ fontWeight: 800, color: net < 0 ? E.red : E.tealInk, fontVariantNumeric: "tabular-nums" }}>{formatMoney(net)}</span>
        </div>
        {net < 0 && <p style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "#a33a29" }}>The commissions come to more than the amount received.</p>}
      </OverlayCard>
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, fontWeight: 600, color: E.muted }}>
      {label}{children}
    </label>
  );
}
