"use client";

/**
 * Personal expenses — an employee spends their own money, the company pays it
 * back.
 *
 * The workflow is the standard reimbursement one, not an invention: **submit →
 * approve → reimburse**, with two separations that do all the work.
 *
 * - **Approval is not payment.** An approved claim is money owed. It becomes
 *   money moved when somebody says which accounts fund it — the same split
 *   control every other module uses.
 * - **The approver is never the claimant.** Self-approval is the failure this
 *   kind of module exists to prevent, and it is refused on the server, not
 *   merely hidden here.
 *
 * Employees see only their own claims. That is a Security Rule, matched by the
 * `where('employeeUid','==',uid)` in `useMyPersonalExpenses` — an unscoped read
 * is refused outright rather than filtered.
 */

import { useMemo, useState } from "react";
import { Plus, Check, X, Wallet2, Wallet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { usePersonalExpenses, useMyPersonalExpenses, useLedger } from "@/hooks/useLedger";
import { useEmployees } from "@/hooks/useEmployees";
import { EmptyState, A, CARD, Button, SummaryCard, StatusPill, Skeleton } from "./accountsChrome";
import { useIsMobile } from "@/hooks/useIsMobile";

/** The section tokens; `E` was the old alias. */
const E = A;
import { PayFromAccounts } from "./PayFromAccounts";
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import { savePersonalExpense, decidePersonalExpense } from "@/lib/clientActions";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";

const FIELD: React.CSSProperties = {
  width: "100%", borderRadius: 9, border: `1px solid ${E.border}`, background: E.surface,
  padding: "8px 10px", fontSize: 13, color: E.ink, outline: "none", fontFamily: "inherit",
};

const CATEGORIES = ["Travel", "Fuel", "Meals", "Client entertainment", "Supplies", "Phone", "Other"];

interface Row {
  id: string; title?: string; category?: string; amount?: number; dayKey?: string;
  vendor?: string; purpose?: string; employeeUid?: string; employeeName?: string;
  status?: string; paidAmount?: number; decisionNote?: string; decidedByName?: string;
}

export function PersonalExpensesView() {
  const { user, role, getIdToken } = useAuth();
  const isFinance = role === "admin" || role === "subadmin";
  const all = usePersonalExpenses(isFinance);
  const mine = useMyPersonalExpenses(user?.uid, !isFinance);
  const ledger = useLedger(isFinance);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<Row | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const rows = (isFinance ? all.records : mine.records) as unknown as Row[];
  const totals = useMemo(() => rows.reduce((t, r) => ({
    claimed: t.claimed + (r.amount ?? 0),
    approved: t.approved + (r.status === "APPROVED" ? (r.amount ?? 0) : 0),
    paid: t.paid + (r.paidAmount ?? 0),
  }), { claimed: 0, approved: 0, paid: 0 }), [rows]);

  const decide = async (row: Row, decision: "APPROVED" | "REJECTED") => {
    const res = await decidePersonalExpense(await getIdToken(), row.id, decision);
    setBanner(res.ok ? `${row.title ?? "Claim"} ${decision.toLowerCase()}.` : res.error);
  };

  return (
    <div style={{ fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ fontFamily: "inherit", fontSize: 22, fontWeight: 700, color: E.ink }}>Personal Expenses</h1>
          <p style={{ fontSize: 12.5, color: E.faint }}>
            {isFinance ? "Claims to approve and reimburse." : "Your own claims. Approval and reimbursement are separate steps."}
          </p>
        </div>
        <Button primary icon={<Plus size={14} />} full={isMobile} onClick={() => setAdding(true)}>New claim</Button>
      </header>

      {banner && <p role="status" style={{ marginBottom: 12, borderRadius: 10, background: E.tealTint, padding: "10px 13px", fontSize: 12.5, fontWeight: 600, color: E.deep }}>{banner}</p>}

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(180px,1fr))", marginBottom: 14 }}>
        <SummaryCard label="Claimed" value={totals.claimed} icon={<Wallet2 size={14} />} mobile={isMobile} />
        <SummaryCard label="Approved" value={totals.approved} icon={<Check size={14} />} tone={A.pending} mobile={isMobile} />
        <SummaryCard label="Reimbursed" value={totals.paid} icon={<Wallet size={14} />} tone={A.positive} mobile={isMobile} />
      </div>

      {(isFinance ? all.loading : mine.loading) ? (
        <div style={{ display: "grid", gap: 8 }}><Skeleton height={64} count={4} /></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Wallet2 size={22} />}
          title="No expense claims yet"
          body={isFinance
            ? "Claims your team submits appear here for approval, then reimbursement."
            : "Spent your own money on something for work? File it here and it goes for approval."}
          action={<Button primary icon={<Plus size={14} />} onClick={() => setAdding(true)}>New claim</Button>}
          mobile={isMobile}
        />
      ) : (
        isMobile ? (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((row) => {
            const paid = row.paidAmount ?? 0;
            const isMine = row.employeeUid === user?.uid;
            const shown = paid > 0 && paid >= (row.amount ?? 0) ? "REIMBURSED" : row.status ?? "DRAFT";
            return (
              <div key={row.id} className="acc-in" style={{ ...CARD, padding: "13px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: A.ink }}>{row.title ?? "—"}</p>
                    <p style={{ fontSize: 11.5, color: A.faint, marginTop: 2 }}>
                      {row.employeeName ?? "—"} · {row.category ?? "—"} · {row.dayKey ?? "—"}
                    </p>
                  </div>
                  <p style={{ fontSize: 15, fontWeight: 800, color: A.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {formatMoney(row.amount ?? 0)}
                  </p>
                </div>
                {row.purpose && <p style={{ fontSize: 12, color: A.body, marginTop: 6 }}>{row.purpose}</p>}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <StatusPill status={shown} />
                  <div style={{ display: "flex", gap: 6 }}>
                    {isFinance && row.status === "SUBMITTED" && !isMine && (
                      <Button onClick={() => void decide(row, "APPROVED")}>Approve</Button>
                    )}
                    {isFinance && row.status === "SUBMITTED" && (
                      <Button onClick={() => void decide(row, "REJECTED")}>Reject</Button>
                    )}
                    {isFinance && row.status === "APPROVED" && paid < (row.amount ?? 0) && (
                      <Button primary onClick={() => setPaying(row)}>Reimburse</Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        ) : (
        <div style={{ ...CARD, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 820 }}>
            <thead>
              <tr style={{ background: E.tint }}>
                {["Date", "Employee", "What for", "Category", "Amount", "Status", ""].map((h, i) => (
                  <th key={i} style={{ padding: "9px 10px", textAlign: i === 4 ? "right" : "left", fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: E.faint, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const paid = row.paidAmount ?? 0;
                const isMine = row.employeeUid === user?.uid;
                return (
                  <tr key={row.id} style={{ borderTop: `1px solid ${E.rowBorder}` }}>
                    <td style={cell}>{row.dayKey ?? "—"}</td>
                    <td style={{ ...cell, fontWeight: 700, color: E.ink }}>{row.employeeName ?? "—"}</td>
                    <td style={{ ...cell, whiteSpace: "normal", maxWidth: 240 }}>
                      {row.title ?? "—"}
                      {row.purpose && <span style={{ display: "block", fontSize: 11, color: E.faint }}>{row.purpose}</span>}
                    </td>
                    <td style={cell}>{row.category ?? "—"}</td>
                    <td style={{ ...num, fontWeight: 700 }}>{formatMoney(row.amount ?? 0)}</td>
                    <td style={cell}>
                      <StatusPill status={paid > 0 && paid >= (row.amount ?? 0) ? "REIMBURSED" : row.status ?? "DRAFT"} />
                    </td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      {isFinance && row.status === "SUBMITTED" && (
                        <>
                          {/* Absent on your own claim: the server refuses
                              self-approval, so offering the button would be
                              offering a choice that can only fail. */}
                          {!isMine && (
                            <button type="button" onClick={() => void decide(row, "APPROVED")} style={{ ...pill, color: "#1f7a52", borderColor: "#bfe3d2" }}>
                              <Check size={11} /> Approve
                            </button>
                          )}
                          <button type="button" onClick={() => void decide(row, "REJECTED")} style={{ ...pill, color: "#a33a29", borderColor: "#f0c4bd" }}>
                            <X size={11} /> Reject
                          </button>
                        </>
                      )}
                      {isFinance && row.status === "APPROVED" && paid < (row.amount ?? 0) && (
                        <button type="button" onClick={() => setPaying(row)} style={{ ...pill, color: E.tealInk, borderColor: "#bfe0dc" }}>
                          <Wallet2 size={11} /> Reimburse
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

      {adding && <NewClaim onClose={() => setAdding(false)} getIdToken={getIdToken} isFinance={isFinance} onSaved={(m) => { setBanner(m); setAdding(false); }} />}

      {paying && (
        <PayFromAccounts
          open
          onClose={() => setPaying(null)}
          onPaid={(text) => setBanner(text)}
          accounts={ledger.accounts}
          balances={ledger.balances}
          getIdToken={getIdToken}
          source={{
            module: "PERSONAL_EXPENSE",
            collection: "personalExpenses",
            id: paying.id,
            label: `Reimbursement — ${paying.employeeName ?? "employee"} · ${paying.title ?? ""}`,
            amount: paying.amount ?? 0,
            alreadyPaid: paying.paidAmount ?? 0,
            direction: "OUT",
            type: "REIMBURSEMENT",
          }}
        />
      )}
    </div>
  );
}

const cell: React.CSSProperties = { padding: "8px 10px", color: E.body, whiteSpace: "nowrap" };
const num: React.CSSProperties = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const pill: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 5,
  border: `1px solid ${E.border}`, background: E.surface, borderRadius: 999,
  padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer",
};

function NewClaim({ onClose, getIdToken, onSaved, isFinance }: {
  onClose: () => void; getIdToken: () => Promise<string>; onSaved: (m: string) => void; isFinance: boolean;
}) {
  const { employees } = useEmployees(isFinance);
  const [form, setForm] = useState({
    title: "", category: CATEGORIES[0], amount: "", dayKey: karachiDayKey(),
    vendor: "", purpose: "", employeeUid: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (submit: boolean) => {
    setBusy(true);
    const res = await savePersonalExpense(await getIdToken(), {
      title: form.title, category: form.category, amount: Number(form.amount) || 0,
      dayKey: form.dayKey, vendor: form.vendor, purpose: form.purpose,
      employeeUid: form.employeeUid || null, submit,
    });
    setBusy(false);
    if (res.ok) onSaved(submit ? "Claim submitted for approval." : "Draft saved."); else setError(res.error);
  };

  return (
    <OverlayPanel title="New expense claim" icon={<Wallet2 size={18} />} maxWidth={560} onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" disabled={busy} onClick={() => void save(false)}
            style={{ borderRadius: 10, border: `1px solid ${E.border}`, background: E.surface, color: E.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            Save draft
          </button>
          <button type="button" disabled={busy || !form.title.trim() || !(Number(form.amount) > 0)} onClick={() => void save(true)}
            style={{ borderRadius: 10, border: "none", background: E.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Saving…" : "Submit for approval"}
          </button>
        </div>
      }>
      <OverlayCard title="The claim">
        <div style={{ display: "grid", gap: 9, gridTemplateColumns: "1fr 1fr" }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <L label="What was it for"><input value={form.title} onChange={(e) => set("title", e.target.value)} style={FIELD} /></L>
          </div>
          <L label="Date"><input type="date" value={form.dayKey} max={karachiDayKey()} onChange={(e) => set("dayKey", e.target.value)} style={FIELD} /></L>
          <L label="Amount"><input type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} style={FIELD} /></L>
          <L label="Category">
            <select value={form.category} onChange={(e) => set("category", e.target.value)} style={{ ...FIELD, cursor: "pointer" }}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </L>
          <L label="Vendor"><input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} style={FIELD} /></L>
          {isFinance && (
            <div style={{ gridColumn: "1 / -1" }}>
              <L label="Claimant — leave blank to file your own">
                <select value={form.employeeUid} onChange={(e) => set("employeeUid", e.target.value)} style={{ ...FIELD, cursor: "pointer" }}>
                  <option value="">Myself</option>
                  {employees.map((e) => <option key={e.uid} value={e.uid}>{e.name}</option>)}
                </select>
              </L>
            </div>
          )}
          <div style={{ gridColumn: "1 / -1" }}>
            <L label="Business purpose"><input value={form.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="Why the company should carry this" style={FIELD} /></L>
          </div>
        </div>
      </OverlayCard>
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, fontWeight: 600, color: E.muted }}>
      {label}{children}
    </label>
  );
}
