"use client";

/**
 * A committee's statement, transcribed from the design files with
 * comprehensive Receivable tracking and cross-module accounting integration.
 *
 * Source of truth: `Committee Account.dc.html` and
 * `Committee Account Mobile.dc.html`. Every value here is copied from those
 * files, not measured from a picture.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { AccountDoc, TransactionDoc } from "@/hooks/useLedger";
import { TRANSACTION_TYPE_LABELS, type TransactionType } from "@/lib/ledger";
import { useSheetEntries } from "@/hooks/useAccountSheets";
import { pendingOf, type SheetEntry } from "@/lib/receivableSheet";
import {
  saveSheetEntry,
  settleSheetEntry,
  settleSheetEntryThroughAccounts,
  deleteSheetEntry,
} from "@/lib/clientActions";
import { PayFromAccounts } from "./PayFromAccounts";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { Field, FormGrid, FooterButtons, FormError, ConfirmPanel, fieldStyle } from "./sheetForms";
import { karachiDayKey } from "@/lib/dates";
import { useIsMobile } from "@/hooks/useIsMobile";

/* ---- tokens, verbatim from the design files ---------------------------- */

const C = {
  page: "#eef4f3",
  ink: "#141f1e",
  body: "#3c4d4b",
  muted: "#5b6d6b",
  label: "#8fa2a0",
  faint: "#9aacaa",
  hair: "#c3d5d3",
  line: "#e2ecea",
  rowLine: "#f2f7f6",
  field: "#f4f8f7",
  tint: "#f2f8f7",
  teal: "#3f8f8a",
  tealInk: "#2f7d78",
  deep: "#1f5c58",
  tealSoft: "#e4f0ef",
  spend: "#c0574a",
  spendInk: "#b4524a",
  spendTint: "#fdeeec",
  spendBar: "#fdf7f6",
  spendBorder: "#f5e6e3",
  spendPill: "#f0dcd8",
  spendPillInk: "#c08b83",
  share: "#a9bcba",
} as const;

/** One per transaction type, from `KIND_META` in both design files. */
const KIND_META: Record<string, { color: string; tint: string; d: string }> = {
  EXPENSE: { color: "#c0574a", tint: "#fdeeec", d: "M7 17 17 7M9 7h8v8" },
  INCOME: { color: "#2f7d78", tint: "#e8f5f3", d: "M17 7 7 17M15 17H7V9" },
  TRANSFER: { color: "#3f7ea3", tint: "#eef6fb", d: "M4 8h13l-3-3M20 16H7l3 3" },
  REIMBURSEMENT: { color: "#a5762a", tint: "#fdf5e6", d: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" },
  INVESTMENT: { color: "#3f7ea3", tint: "#eef6fb", d: "M4 16l5-5 4 3 7-8" },
  ADJUSTMENT: { color: "#5b6d6b", tint: "#f2f7f6", d: "M12 5v14M5 12h14" },
  LOAN: { color: "#2563eb", tint: "#eff6ff", d: "M17 7 7 17M15 17H7V9" },
};

const CHIPS = ["All", "Money in", "Money out", "Expense", "Income", "Transfer", "Reimbursement"] as const;
type Chip = (typeof CHIPS)[number];

const RECEIVABLE_CHIPS = ["All", "Pending", "Settled"] as const;
type ReceivableChip = (typeof RECEIVABLE_CHIPS)[number];

/** `short()` from the mobile file — lakhs, then thousands. */
function short(n: number): string {
  const v = Math.abs(n);
  if (v >= 100_000) return `Rs ${(n / 100_000).toFixed(v % 100_000 === 0 ? 0 : 1)}L`;
  if (v >= 1_000) return `Rs ${Math.round(n / 1000)}k`;
  return `Rs ${n}`;
}

/** `dash()` — the used arc of the mobile dial. */
function dash(pct: number, r: number): string {
  const c = 2 * Math.PI * r;
  return `${Math.max(0, Math.min(1, pct / 100)) * c} ${c}`;
}

const Icon = ({ d, size = 17, w = 2.1 }: { d: string; size?: number; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);

/* ------------------------------------------------------------------------ */

export interface CommitteeRow {
  id: string;
  title: string;
  type: TransactionType;
  direction: "IN" | "OUT";
  amount: number;
  dayKey: string;
  source: string;
  isManual: boolean;
}

export function CommitteeStatement({
  account,
  transactions,
  accounts,
  balances,
  getIdToken,
  isMobile,
  onAdd,
  onEdit,
  onDelete,
  onManage,
  onBanner,
}: {
  account: AccountDoc;
  transactions: TransactionDoc[];
  accounts?: AccountDoc[];
  balances?: Map<string, { balance: number }>;
  getIdToken?: () => Promise<string>;
  isMobile: boolean;
  onAdd: () => void;
  onEdit: (row: TransactionDoc) => void;
  onDelete: (row: TransactionDoc) => void;
  onManage: () => void;
  onBanner?: (msg: string) => void;
}) {
  const [statementTab, setStatementTab] = useState<"movements" | "receivables">("movements");
  const [chip, setChip] = useState<Chip>("All");
  const [query, setQuery] = useState("");

  const [receivableChip, setReceivableChip] = useState<ReceivableChip>("All");
  const [receivableQuery, setReceivableQuery] = useState("");

  // Modals state
  const [addingReceivable, setAddingReceivable] = useState(false);
  const [editingReceivable, setEditingReceivable] = useState<SheetEntry | null>(null);
  const [settlingReceivable, setSettlingReceivable] = useState<SheetEntry | null>(null);
  const [settlingSheetOnly, setSettlingSheetOnly] = useState<SheetEntry | null>(null);
  const [deletingReceivable, setDeletingReceivable] = useState<SheetEntry | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  // Live Sheet entries for receivables
  const { entries: sheetEntries } = useSheetEntries(true);

  // Filter receivables that belong to this committee account
  const committeeReceivables = useMemo(() => {
    return sheetEntries.filter((e) => {
      if (e.side !== "RECEIVABLE") return false;
      if (e.committeeAccountId) {
        return e.committeeAccountId === account.id;
      }
      // Backwards-compatible check: group is Committee and purpose or name mentions committee
      if (e.group === "Committee") {
        const text = `${e.purpose ?? ""} ${e.name}`.toLowerCase();
        return text.includes(account.name.toLowerCase());
      }
      return false;
    });
  }, [sheetEntries, account.id, account.name]);

  const receivableTotals = useMemo(() => {
    let owed = 0;
    let settled = 0;
    let pendingCount = 0;
    for (const e of committeeReceivables) {
      owed += e.amount;
      settled += e.settled;
      if (e.amount > e.settled) pendingCount += 1;
    }
    const pending = Math.max(0, owed - settled);
    return { owed, settled, pending, pendingCount };
  }, [committeeReceivables]);

  // Destination accounts for receiving funds, placing this committee account first
  const destinationAccounts = useMemo(() => {
    if (!accounts) return [account];
    return [account, ...accounts.filter((a) => a.id !== account.id && a.status !== "ARCHIVED")];
  }, [accounts, account]);

  const mine = useMemo(
    () => transactions.filter((t) => t.accountId === account.id && t.status === "POSTED"),
    [transactions, account.id]
  );

  const pool = account.openingBalance ?? 0;
  const totalOut = mine.filter((t) => t.direction === "OUT").reduce((a, t) => a + t.amount, 0);
  const totalIn = mine.filter((t) => t.direction === "IN").reduce((a, t) => a + t.amount, 0);
  const netSpent = totalOut - totalIn;
  const spent = Math.max(0, netSpent);
  const remaining = pool - netSpent;
  const usedPct = pool > 0 ? Math.round((spent / pool) * 100) : 0;
  const leftPct = pool > 0 ? Math.max(0, Math.round((remaining / pool) * 100)) : 0;
  const rowMax = Math.max(...mine.map((t) => t.amount), 1);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mine.filter((t) => {
      const kind = TRANSACTION_TYPE_LABELS[t.type];
      if (chip === "Money in" && t.direction !== "IN") return false;
      if (chip === "Money out" && t.direction !== "OUT") return false;
      if (chip !== "All" && chip !== "Money in" && chip !== "Money out" && kind !== chip) return false;
      if (!q) return true;
      return `${t.sourceLabel ?? ""} ${kind} ${t.sourceModule}`.toLowerCase().includes(q);
    });
  }, [mine, chip, query]);

  const filteredReceivables = useMemo(() => {
    const q = receivableQuery.trim().toLowerCase();
    return committeeReceivables.filter((e) => {
      const isSettled = e.amount > 0 && e.settled >= e.amount;
      if (receivableChip === "Pending" && isSettled) return false;
      if (receivableChip === "Settled" && !isSettled) return false;
      if (!q) return true;
      return `${e.name} ${e.purpose ?? ""} ${e.description ?? ""}`.toLowerCase().includes(q);
    });
  }, [committeeReceivables, receivableChip, receivableQuery]);

  const sourceOf = (t: TransactionDoc) =>
    t.sourceModule === "MANUAL" ? "Manual entry" : (t.sourceLabel ? "Office Expense" : t.sourceModule);

  if (isMobile) {
    return (
      <>
        <MobileStatement
          account={account}
          rows={rows}
          pool={pool}
          spent={spent}
          remaining={remaining}
          totalIn={totalIn}
          totalOut={totalOut}
          usedPct={usedPct}
          rowMax={rowMax}
          chip={chip}
          setChip={setChip}
          query={query}
          setQuery={setQuery}
          sourceOf={sourceOf}
          statementTab={statementTab}
          setStatementTab={setStatementTab}
          receivableTotals={receivableTotals}
          filteredReceivables={filteredReceivables}
          receivableChip={receivableChip}
          setReceivableChip={setReceivableChip}
          receivableQuery={receivableQuery}
          setReceivableQuery={setReceivableQuery}
          onAdd={onAdd}
          onEdit={onEdit}
          onDelete={onDelete}
          onManage={onManage}
          onAddReceivable={() => setAddingReceivable(true)}
          onSettleReceivable={(e) => setSettlingReceivable(e)}
          onEditReceivable={(e) => setEditingReceivable(e)}
          onDeleteReceivable={(e) => setDeletingReceivable(e)}
        />

        {/* Modals on Mobile */}
        {addingReceivable && (
          <CommitteeReceivableFormModal
            entry={null}
            account={account}
            getIdToken={getIdToken}
            onClose={() => setAddingReceivable(false)}
            onSaved={(msg) => {
              setAddingReceivable(false);
              onBanner?.(msg);
            }}
          />
        )}

        {editingReceivable && (
          <CommitteeReceivableFormModal
            entry={editingReceivable}
            account={account}
            getIdToken={getIdToken}
            onClose={() => setEditingReceivable(null)}
            onSaved={(msg) => {
              setEditingReceivable(null);
              onBanner?.(msg);
            }}
          />
        )}

        {settlingReceivable && (
          <PayFromAccounts
            open={!!settlingReceivable}
            onClose={() => setSettlingReceivable(null)}
            onPaid={(msg) => {
              setSettlingReceivable(null);
              onBanner?.(msg);
            }}
            accounts={destinationAccounts}
            balances={balances ?? new Map()}
            getIdToken={getIdToken ?? (async () => "")}
            copy={{
              title: `Receive from ${settlingReceivable.name}`,
              linesTitle: "Receive into which account? (Defaults to this Committee pot)",
              full: `Receive full amount — ${formatMoney(pendingOf(settlingReceivable))}`,
              part: "Record receipt",
              done: "Receipt posted to account.",
            }}
            source={{
              module: "RECEIVABLE",
              collection: "receivableEntries",
              id: settlingReceivable.id,
              label: `${settlingReceivable.name} (${account.name})`,
              amount: settlingReceivable.amount,
              alreadyPaid: settlingReceivable.settled,
              direction: "IN",
              type: "LOAN",
            }}
            submit={async ({ allocations, dayKey, note }) => {
              if (!getIdToken || !settlingReceivable) return { ok: false, error: "Missing authentication" };
              const token = await getIdToken();
              const result = await settleSheetEntryThroughAccounts(token, settlingReceivable.id, {
                allocations,
                dayKey,
                note,
                sourceLabel: `Committee Inflow — ${settlingReceivable.name}`,
              });
              return result.ok
                ? { ok: true, fullyPaid: result.data.fullyPaid, posted: result.data.posted }
                : { ok: false, error: result.error };
            }}
            extra={
              <button
                type="button"
                onClick={() => {
                  const cur = settlingReceivable;
                  setSettlingReceivable(null);
                  setSettlingSheetOnly(cur);
                }}
                style={{
                  alignSelf: "flex-start",
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: C.tealInk,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                Settled outside company accounts? Record on sheet only →
              </button>
            }
          />
        )}

        {settlingSheetOnly && (
          <CommitteeSheetOnlySettleModal
            entry={settlingSheetOnly}
            getIdToken={getIdToken}
            onBack={() => {
              const cur = settlingSheetOnly;
              setSettlingSheetOnly(null);
              setSettlingReceivable(cur);
            }}
            onClose={() => setSettlingSheetOnly(null)}
            onSaved={(msg) => {
              setSettlingSheetOnly(null);
              onBanner?.(msg);
            }}
          />
        )}

        {deletingReceivable && (
          <ConfirmPanel
            title={`Delete receivable for ${deletingReceivable.name}?`}
            confirmLabel="Delete"
            busy={busyDelete}
            onCancel={() => setDeletingReceivable(null)}
            onConfirm={async () => {
              if (!getIdToken || !deletingReceivable) return;
              setBusyDelete(true);
              try {
                const token = await getIdToken();
                const res = await deleteSheetEntry(token, deletingReceivable.id);
                if (res.ok) {
                  onBanner?.(`Deleted receivable for ${deletingReceivable.name}.`);
                  setDeletingReceivable(null);
                } else {
                  alert(res.error);
                }
              } catch {
                alert("Could not reach the server.");
              } finally {
                setBusyDelete(false);
              }
            }}
          >
            {formatMoney(deletingReceivable.amount)} · {deletingReceivable.dayKey} · {formatMoney(pendingOf(deletingReceivable))} still pending. This cannot be undone.
            {deletingReceivable.accountSettled > 0 && ` The ${formatMoney(deletingReceivable.accountSettled)} that moved through accounts stays in the accounts ledger.`}
          </ConfirmPanel>
        )}
      </>
    );
  }

  const stats = [
    {
      id: "pool",
      label: "Committee Pool",
      value: pool,
      note: "Full pool for this committee",
      pill: "Pool",
      tone: "neutral",
      pct: 100,
      color: C.ink,
      accent: C.teal,
      d: "M3 10 12 4l9 6M5 10v9h14v-9M9 19v-5h6v5",
      action: () => setStatementTab("movements"),
    },
    {
      id: "receivable",
      label: "Receivable (Pending In)",
      value: receivableTotals.pending,
      note:
        receivableTotals.owed > 0
          ? `${formatMoney(receivableTotals.settled)} received · ${receivableTotals.pendingCount} pending`
          : "No pending receivables",
      pill: receivableTotals.pending > 0 ? `${receivableTotals.pendingCount} pending` : "Settled",
      tone: receivableTotals.pending > 0 ? "down" : "up",
      pct: receivableTotals.owed > 0 ? Math.min(100, Math.round((receivableTotals.settled / receivableTotals.owed) * 100)) : 0,
      color: receivableTotals.pending > 0 ? "#1e40af" : C.tealInk,
      accent: "#2563eb",
      d: "M17 7 7 17M15 17H7V9",
      action: () => setStatementTab("receivables"),
    },
    {
      id: "spent",
      label: "Spent",
      value: spent,
      note: totalIn > 0 ? `${usedPct}% of pool · ${formatMoney(totalIn)} returned` : `${usedPct}% of the committee used`,
      pill: `${usedPct}%`,
      tone: "down",
      pct: usedPct,
      color: C.spendInk,
      accent: C.spend,
      d: "M7 17 17 7M9 7h8v8",
      action: () => setStatementTab("movements"),
    },
    {
      id: "remaining",
      label: "Remaining In Hand",
      value: remaining,
      note: remaining < 0 ? `Overspent by ${formatMoney(Math.abs(remaining))}` : `${leftPct}% still available`,
      pill: `${leftPct}%`,
      tone: remaining < 0 ? "down" : "up",
      pct: leftPct,
      color: remaining < 0 ? C.spendInk : C.tealInk,
      accent: remaining < 0 ? C.spend : C.tealInk,
      d: "M3 7h18v12H3zM3 11h18M7 15h4",
      action: () => setStatementTab("movements"),
    },
  ] as const;

  return (
    <div style={{ fontFamily: "Manrope, var(--font-directory), system-ui, sans-serif", letterSpacing: "-0.01em", color: "#22302f" }}>
      <Link href="/admin/accounts" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: C.tealInk, textDecoration: "none", marginBottom: 12 }}>
        <Icon d="M19 12H5M11 6l-6 6 6 6" size={15} w={2.3} />
        <span style={{ whiteSpace: "nowrap" }}>All accounts</span>
      </Link>

      {/* ---- gradient hero, from the Office Expenses banner ---- */}
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 20, background: "linear-gradient(115deg,#1f5c58 0%,#3f8f8a 66%,#4fa39c 100%)", color: "#fff", padding: "22px 26px", marginBottom: 14 }}>
        <svg viewBox="0 0 400 170" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.16 }} aria-hidden>
          <circle cx="356" cy="20" r="78" fill="none" stroke="#fff" strokeWidth="1.2" />
          <circle cx="356" cy="20" r="120" fill="none" stroke="#fff" strokeWidth="1.2" />
          <circle cx="296" cy="162" r="54" fill="none" stroke="#fff" strokeWidth="1.2" />
        </svg>
        <div style={{ position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
            <div style={{ width: 50, height: 50, borderRadius: 16, background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.42)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff" }}>
              <Icon d="M3 10 12 4l9 6M5 10v9h14v-9M9 19v-5h6v5" size={23} w={1.8} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1.6px", textTransform: "uppercase", opacity: 0.74 }}>Committee</div>
              <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-1.2px", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{formatMoney(pool)}</div>
              <div style={{ fontSize: 12.5, fontWeight: 500, opacity: 0.84, marginTop: 2 }}>
                {account.name} · {formatMoney(remaining)} in hand · {receivableTotals.pending > 0 ? `${formatMoney(receivableTotals.pending)} pending in` : "all collected"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={onManage} className="acc-press"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 18px", borderRadius: 999, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.45)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
              <span style={{ whiteSpace: "nowrap" }}>Manage account</span>
            </button>
            <button type="button" onClick={() => setAddingReceivable(true)} className="acc-press"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 20px", borderRadius: 999, background: "rgba(255,255,255,0.22)", border: "1px solid rgba(255,255,255,0.55)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              <Icon d="M12 5v14M5 12h14" size={15} w={2.4} />
              <span style={{ whiteSpace: "nowrap" }}>+ Add receivable</span>
            </button>
            <button type="button" onClick={onAdd} className="acc-press"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 22px", borderRadius: 999, background: "#fff", color: C.deep, fontSize: 13.5, fontWeight: 700, cursor: "pointer", border: "none", fontFamily: "inherit" }}>
              <Icon d="M12 5v14M5 12h14" size={16} w={2.4} />
              <span style={{ whiteSpace: "nowrap" }}>Add spending</span>
            </button>
          </div>
        </div>
      </div>

      {/* ---- four stat cards ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14, marginBottom: 16 }}>
        {stats.map((s) => (
          <div
            key={s.label}
            onClick={s.action}
            role="button"
            tabIndex={0}
            className="acc-in"
            style={{
              position: "relative",
              overflow: "hidden",
              background: "#fff",
              border: `1px solid ${C.line}`,
              borderRadius: 18,
              padding: "18px 20px 20px",
              cursor: "pointer",
            }}
          >
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: s.accent }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={{ width: 30, height: 30, borderRadius: 10, background: C.tint, color: s.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon d={s.d} size={16} w={2} />
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1.1px", textTransform: "uppercase", color: C.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                  {s.label}
                </span>
              </div>
              <span style={{
                flexShrink: 0, padding: "3px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap",
                ...(s.tone === "up" ? { background: "#e8f5f3", color: C.tealInk }
                  : s.tone === "down" ? { background: C.spendTint, color: C.spendInk }
                    : { background: C.rowLine, color: C.label }),
              }}>{s.pill}</span>
            </div>
            <div style={{ fontSize: 29, fontWeight: 800, letterSpacing: "-1.2px", marginTop: 12, color: s.color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {formatMoney(s.value)}
            </div>
            <div style={{ height: 7, borderRadius: 999, background: C.page, marginTop: 14, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 999, width: `${Math.max(3, Math.min(100, s.pct))}%`, background: s.accent }} />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: C.faint, marginTop: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {s.note}
            </div>
          </div>
        ))}
      </div>

      {/* ---- Statement and Receivables Panel ---- */}
      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, overflow: "hidden" }}>
        {/* Navigation Tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px 0", borderBottom: `1px solid ${C.line}` }}>
          <button
            type="button"
            onClick={() => setStatementTab("movements")}
            className="acc-press"
            style={{
              padding: "10px 16px",
              border: "none",
              borderBottom: statementTab === "movements" ? `3px solid ${C.teal}` : "3px solid transparent",
              background: "transparent",
              fontSize: 14,
              fontWeight: 700,
              color: statementTab === "movements" ? C.tealInk : C.muted,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "inherit",
            }}
          >
            <span>Spendings & Movements</span>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              background: statementTab === "movements" ? C.tealSoft : C.rowLine,
              color: statementTab === "movements" ? C.tealInk : C.label,
            }}>
              {mine.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatementTab("receivables")}
            className="acc-press"
            style={{
              padding: "10px 16px",
              border: "none",
              borderBottom: statementTab === "receivables" ? `3px solid #2563eb` : "3px solid transparent",
              background: "transparent",
              fontSize: 14,
              fontWeight: 700,
              color: statementTab === "receivables" ? "#1d4ed8" : C.muted,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "inherit",
            }}
          >
            <span>Receivables & Money In</span>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              background: statementTab === "receivables" ? "#eff6ff" : (receivableTotals.pendingCount > 0 ? "#fef3c7" : C.rowLine),
              color: statementTab === "receivables" ? "#1d4ed8" : (receivableTotals.pendingCount > 0 ? "#b45309" : C.label),
            }}>
              {committeeReceivables.length}
              {receivableTotals.pendingCount > 0 && ` (${receivableTotals.pendingCount} pending)`}
            </span>
          </button>
        </div>

        {/* Tab 1: Spendings & Movements */}
        {statementTab === "movements" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "16px 20px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 240, background: C.field, border: `1px solid ${C.line}`, borderRadius: 999, padding: "11px 16px" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.label} strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this statement..."
                  style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 13.5, fontWeight: 500, color: "#22302f", fontFamily: "inherit" }} />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 20px 16px", overflowX: "auto" }}>
              {CHIPS.map((label) => {
                const active = chip === label;
                return (
                  <button key={label} type="button" onClick={() => setChip(label)} aria-pressed={active} className="acc-press"
                    style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, padding: "9px 18px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${active ? C.teal : C.line}`, background: active ? C.teal : "#fff", color: active ? "#fff" : C.muted }}>
                    {active && <Icon d="M20 6 9 17l-5-5" size={13} w={3} />}
                    <span style={{ whiteSpace: "nowrap" }}>{label}</span>
                  </button>
                );
              })}
            </div>

            {(() => {
              const rowsInflow = rows.filter((t) => t.direction === "IN").reduce((sum, t) => sum + t.amount, 0);
              const rowsOutflow = rows.filter((t) => t.direction === "OUT").reduce((sum, t) => sum + t.amount, 0);
              const isFilteredIn = chip === "Money in";
              const sectionTitle =
                chip === "Money in"
                  ? "Money in"
                  : chip === "All"
                    ? (totalIn > 0 ? "Movements" : "Spendings")
                    : chip;
              const sectionTotal =
                chip === "Money in"
                  ? rowsInflow
                  : chip === "Money out"
                    ? rowsOutflow
                    : chip === "All"
                      ? (totalIn > 0 ? Math.max(0, rowsOutflow - rowsInflow) : rowsOutflow)
                      : rows.reduce((sum, t) => sum + t.amount, 0);

              return (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
                  padding: "13px 20px",
                  background: isFilteredIn ? C.tint : C.spendBar,
                  borderTop: `1px solid ${isFilteredIn ? C.hair : C.spendBorder}`,
                  borderBottom: `1px solid ${isFilteredIn ? C.hair : C.spendBorder}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: isFilteredIn ? C.teal : C.spend }} />
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: isFilteredIn ? C.tealInk : C.spendInk, whiteSpace: "nowrap" }}>
                      {sectionTitle}
                    </span>
                    <span style={{
                      padding: "2px 9px", borderRadius: 999, background: "#fff",
                      border: `1px solid ${isFilteredIn ? C.hair : C.spendPill}`,
                      fontSize: 11, fontWeight: 700, color: isFilteredIn ? C.tealInk : C.spendPillInk,
                    }}>{rows.length}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.5px", color: isFilteredIn ? C.tealInk : C.spendInk, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {chip === "All" && totalIn > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginRight: 6 }}>Net</span>}
                      {formatMoney(sectionTotal)}
                    </span>
                    <button type="button" onClick={onAdd} className="acc-press"
                      style={{
                        display: "flex", alignItems: "center", gap: 7, padding: "8px 15px",
                        borderRadius: 999, background: "#fff",
                        border: `1px solid ${isFilteredIn ? C.hair : C.spendPill}`,
                        fontSize: 12.5, fontWeight: 700, color: isFilteredIn ? C.tealInk : C.spendInk,
                        cursor: "pointer", fontFamily: "inherit",
                      }}>
                      <Icon d="M12 5v14M5 12h14" size={13} w={2.6} />
                      <span>Add</span>
                    </button>
                  </div>
                </div>
              );
            })()}

            {rows.map((t) => {
              const isIncome = t.direction === "IN";
              const m = isIncome
                ? { color: C.tealInk, tint: "#e8f5f3", d: "M17 7 7 17M15 17H7V9" }
                : (KIND_META[t.type] ?? KIND_META.EXPENSE);
              const baseTotal = isIncome ? (totalIn > 0 ? totalIn : t.amount) : (totalOut > 0 ? totalOut : t.amount);
              const sharePct = baseTotal > 0 ? Math.round((t.amount / baseTotal) * 100) : 0;
              return (
                <div key={t.id} className="cmt-row"
                  style={{ display: "grid", gridTemplateColumns: "42px minmax(0,1fr) 128px auto auto", alignItems: "center", gap: 16, padding: "15px 20px", borderBottom: `1px solid ${C.rowLine}` }}>
                  <div style={{ width: 42, height: 42, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: m.tint, color: m.color }}>
                    <Icon d={m.d} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                      <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.35px", color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.sourceLabel ?? "—"}</span>
                      <span style={{ flexShrink: 0, padding: "3px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.3px", whiteSpace: "nowrap", background: m.tint, color: m.color }}>
                        {isIncome ? "Money in" : TRANSACTION_TYPE_LABELS[t.type]}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: C.faint, marginTop: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.dayKey} · {sourceOf(t)}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, height: 6, borderRadius: 999, background: C.rowLine, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 999, width: `${Math.max(6, Math.round((t.amount / rowMax) * 100))}%`, background: isIncome ? "linear-gradient(90deg,#5cb8b2,#2f7d78)" : "linear-gradient(90deg,#d8735f,#c0574a)" }} />
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: isIncome ? C.tealInk : C.share, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>{sharePct}%</span>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 16, fontWeight: 800, letterSpacing: "-0.4px", color: isIncome ? C.tealInk : C.spendInk, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", minWidth: 104 }}>
                    {isIncome ? `+${formatMoney(t.amount)}` : formatMoney(t.amount)}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    {t.sourceModule === "MANUAL" && (
                      <button type="button" onClick={() => onEdit(t)} aria-label={`Edit ${t.sourceLabel ?? "row"}`} className="cmt-act"
                        style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.label, border: "none", background: "transparent" }}>
                        <Icon d="M4 20h4l11-11-4-4L4 16v4Z" size={15} w={1.9} />
                      </button>
                    )}
                    <button type="button" onClick={() => onDelete(t)} aria-label={`Delete ${t.sourceLabel ?? "row"}`} className="cmt-del"
                      style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#c99a94", border: "none", background: "transparent" }}>
                      <Icon d="M4 7h16M9 7V5h6v2M6 7v13h12V7M10 11v5M14 11v5" size={15} w={1.9} />
                    </button>
                  </div>
                </div>
              );
            })}

            {rows.length === 0 && (
              <div style={{ padding: "54px 20px", textAlign: "center", fontSize: 13.5, fontWeight: 500, color: C.faint }}>
                No entries match this filter.
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Receivables & Money In */}
        {statementTab === "receivables" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "16px 20px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 240, background: C.field, border: `1px solid ${C.line}`, borderRadius: 999, padding: "11px 16px" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.label} strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
                <input
                  value={receivableQuery}
                  onChange={(e) => setReceivableQuery(e.target.value)}
                  placeholder="Search member, source, or note..."
                  style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 13.5, fontWeight: 500, color: "#22302f", fontFamily: "inherit" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 20px 16px", overflowX: "auto" }}>
              {RECEIVABLE_CHIPS.map((label) => {
                const active = receivableChip === label;
                return (
                  <button key={label} type="button" onClick={() => setReceivableChip(label)} aria-pressed={active} className="acc-press"
                    style={{
                      display: "flex", alignItems: "center", gap: 7, flexShrink: 0, padding: "9px 18px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                      border: `1px solid ${active ? "#2563eb" : C.line}`,
                      background: active ? "#2563eb" : "#fff",
                      color: active ? "#fff" : C.muted
                    }}>
                    {active && <Icon d="M20 6 9 17l-5-5" size={13} w={3} />}
                    <span style={{ whiteSpace: "nowrap" }}>{label}</span>
                  </button>
                );
              })}
            </div>

            {/* Subheader bar */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
              padding: "13px 20px",
              background: "#f0f7ff",
              borderTop: "1px solid #dbeafe",
              borderBottom: "1px solid #dbeafe",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563eb" }} />
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: "#1d4ed8", whiteSpace: "nowrap" }}>
                  Committee Receivables
                </span>
                <span style={{
                  padding: "2px 9px", borderRadius: 999, background: "#fff",
                  border: "1px solid #bfdbfe",
                  fontSize: 11, fontWeight: 700, color: "#1d4ed8",
                }}>{filteredReceivables.length}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1e3a8a", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  Pending: <strong style={{ color: "#b45309" }}>{formatMoney(receivableTotals.pending)}</strong>
                  <span style={{ opacity: 0.5, margin: "0 6px" }}>·</span>
                  Received: <strong style={{ color: C.tealInk }}>{formatMoney(receivableTotals.settled)}</strong>
                </span>
                <button type="button" onClick={() => setAddingReceivable(true)} className="acc-press"
                  style={{
                    display: "flex", alignItems: "center", gap: 7, padding: "8px 15px",
                    borderRadius: 999, background: "#fff",
                    border: "1px solid #bfdbfe",
                    fontSize: 12.5, fontWeight: 700, color: "#1d4ed8",
                    cursor: "pointer", fontFamily: "inherit",
                  }}>
                  <Icon d="M12 5v14M5 12h14" size={13} w={2.6} />
                  <span>+ Add receivable</span>
                </button>
              </div>
            </div>

            {/* Receivables List */}
            {filteredReceivables.map((e) => {
              const pending = pendingOf(e);
              const isSettled = e.amount > 0 && e.settled >= e.amount;
              const isPart = e.settled > 0 && !isSettled;
              const pct = e.amount > 0 ? Math.min(100, Math.round((e.settled / e.amount) * 100)) : 0;

              return (
                <div key={e.id} className="cmt-row"
                  style={{ display: "grid", gridTemplateColumns: "42px minmax(0,1.2fr) 140px minmax(110px,auto) auto", alignItems: "center", gap: 16, padding: "15px 20px", borderBottom: `1px solid ${C.rowLine}` }}>
                  <div style={{ width: 42, height: 42, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: isSettled ? "#e8f5f3" : "#eff6ff", color: isSettled ? C.tealInk : "#2563eb" }}>
                    <Icon d="M17 7 7 17M15 17H7V9" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                      <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.35px", color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {e.name}
                      </span>
                      <span style={{
                        flexShrink: 0, padding: "3px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.3px", whiteSpace: "nowrap",
                        background: isSettled ? "#e8f5f3" : isPart ? "#eff6ff" : "#fef3c7",
                        color: isSettled ? C.tealInk : isPart ? "#1d4ed8" : "#b45309",
                      }}>
                        {isSettled ? "Settled" : isPart ? "Partially Paid" : "Pending"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: C.faint, marginTop: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e.dayKey}
                      {e.returnDayKey && ` · Due ${e.returnDayKey}`}
                      {e.purpose && ` · ${e.purpose}`}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, fontWeight: 600, color: C.label }}>
                      <span>{pct}%</span>
                      <span>{formatMoney(e.settled)}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: C.rowLine, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 999, width: `${Math.max(4, pct)}%`,
                        background: isSettled ? "linear-gradient(90deg,#5cb8b2,#2f7d78)" : "linear-gradient(90deg,#60a5fa,#2563eb)"
                      }} />
                    </div>
                  </div>

                  {/* Amount and Pending */}
                  <div style={{ textAlign: "right", minWidth: 104 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.4px", color: C.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {formatMoney(e.amount)}
                    </div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: isSettled ? C.tealInk : "#b45309", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                      {isSettled ? "Fully received" : `${formatMoney(pending)} pending`}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {!isSettled ? (
                      <button
                        type="button"
                        onClick={() => setSettlingReceivable(e)}
                        className="acc-press"
                        style={{
                          padding: "7px 14px",
                          borderRadius: 999,
                          background: C.teal,
                          color: "#fff",
                          fontSize: 12.5,
                          fontWeight: 700,
                          cursor: "pointer",
                          border: "none",
                          fontFamily: "inherit",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <Icon d="M17 7 7 17M15 17H7V9" size={13} w={2.4} />
                        <span>Receive</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSettlingReceivable(e)}
                        className="acc-press"
                        style={{
                          padding: "7px 12px",
                          borderRadius: 999,
                          background: "#e8f5f3",
                          color: C.tealInk,
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                          border: "none",
                          fontFamily: "inherit",
                        }}
                      >
                        Adjust
                      </button>
                    )}
                    <button type="button" onClick={() => setEditingReceivable(e)} aria-label={`Edit ${e.name}`} className="cmt-act"
                      style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.label, border: "none", background: "transparent" }}>
                      <Icon d="M4 20h4l11-11-4-4L4 16v4Z" size={15} w={1.9} />
                    </button>
                    <button type="button" onClick={() => setDeletingReceivable(e)} aria-label={`Delete ${e.name}`} className="cmt-del"
                      style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#c99a94", border: "none", background: "transparent" }}>
                      <Icon d="M4 7h16M9 7V5h6v2M6 7v13h12V7M10 11v5M14 11v5" size={15} w={1.9} />
                    </button>
                  </div>
                </div>
              );
            })}

            {filteredReceivables.length === 0 && (
              <div style={{ padding: "54px 20px", textAlign: "center", fontSize: 13.5, fontWeight: 500, color: C.faint }}>
                {receivableQuery || receivableChip !== "All"
                  ? "No receivables match this filter."
                  : "No receivables recorded for this committee yet. Click '+ Add receivable' to track money coming in."}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals on Desktop */}
      {addingReceivable && (
        <CommitteeReceivableFormModal
          entry={null}
          account={account}
          getIdToken={getIdToken}
          onClose={() => setAddingReceivable(false)}
          onSaved={(msg) => {
            setAddingReceivable(false);
            onBanner?.(msg);
          }}
        />
      )}

      {editingReceivable && (
        <CommitteeReceivableFormModal
          entry={editingReceivable}
          account={account}
          getIdToken={getIdToken}
          onClose={() => setEditingReceivable(null)}
          onSaved={(msg) => {
            setEditingReceivable(null);
            onBanner?.(msg);
          }}
        />
      )}

      {settlingReceivable && (
        <PayFromAccounts
          open={!!settlingReceivable}
          onClose={() => setSettlingReceivable(null)}
          onPaid={(msg) => {
            setSettlingReceivable(null);
            onBanner?.(msg);
          }}
          accounts={destinationAccounts}
          balances={balances ?? new Map()}
          getIdToken={getIdToken ?? (async () => "")}
          copy={{
            title: `Receive into Committee / Account`,
            linesTitle: "Receive into which account? (Defaults to this Committee pot)",
            full: `Receive full amount — ${formatMoney(pendingOf(settlingReceivable))}`,
            part: "Record receipt",
            done: "Receipt posted to account.",
          }}
          source={{
            module: "RECEIVABLE",
            collection: "receivableEntries",
            id: settlingReceivable.id,
            label: `${settlingReceivable.name} (${account.name})`,
            amount: settlingReceivable.amount,
            alreadyPaid: settlingReceivable.settled,
            direction: "IN",
            type: "LOAN",
          }}
          submit={async ({ allocations, dayKey, note }) => {
            if (!getIdToken || !settlingReceivable) return { ok: false, error: "Missing authentication" };
            const token = await getIdToken();
            const result = await settleSheetEntryThroughAccounts(token, settlingReceivable.id, {
              allocations,
              dayKey,
              note,
              sourceLabel: `Committee Inflow — ${settlingReceivable.name}`,
            });
            return result.ok
              ? { ok: true, fullyPaid: result.data.fullyPaid, posted: result.data.posted }
              : { ok: false, error: result.error };
          }}
          extra={
            <button
              type="button"
              onClick={() => {
                const cur = settlingReceivable;
                setSettlingReceivable(null);
                setSettlingSheetOnly(cur);
              }}
              style={{
                alignSelf: "flex-start",
                border: "none",
                background: "transparent",
                padding: 0,
                fontSize: 12.5,
                fontWeight: 700,
                color: C.tealInk,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              Settled outside company accounts? Record on sheet only →
            </button>
          }
        />
      )}

      {settlingSheetOnly && (
        <CommitteeSheetOnlySettleModal
          entry={settlingSheetOnly}
          getIdToken={getIdToken}
          onBack={() => {
            const cur = settlingSheetOnly;
            setSettlingSheetOnly(null);
            setSettlingReceivable(cur);
          }}
          onClose={() => setSettlingSheetOnly(null)}
          onSaved={(msg) => {
            setSettlingSheetOnly(null);
            onBanner?.(msg);
          }}
        />
      )}

      {deletingReceivable && (
        <ConfirmPanel
          title={`Delete receivable for ${deletingReceivable.name}?`}
          confirmLabel="Delete"
          busy={busyDelete}
          onCancel={() => setDeletingReceivable(null)}
          onConfirm={async () => {
            if (!getIdToken || !deletingReceivable) return;
            setBusyDelete(true);
            try {
              const token = await getIdToken();
              const res = await deleteSheetEntry(token, deletingReceivable.id);
              if (res.ok) {
                onBanner?.(`Deleted receivable for ${deletingReceivable.name}.`);
                setDeletingReceivable(null);
              } else {
                alert(res.error);
              }
            } catch {
              alert("Could not reach the server.");
            } finally {
              setBusyDelete(false);
            }
          }}
        >
          {formatMoney(deletingReceivable.amount)} · {deletingReceivable.dayKey} · {formatMoney(pendingOf(deletingReceivable))} still pending. This cannot be undone.
          {deletingReceivable.accountSettled > 0 && ` The ${formatMoney(deletingReceivable.accountSettled)} that moved through accounts stays in the accounts ledger.`}
        </ConfirmPanel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function MobileStatement({
  account,
  rows,
  pool,
  spent,
  remaining,
  totalIn,
  totalOut,
  usedPct,
  rowMax,
  chip,
  setChip,
  query,
  setQuery,
  sourceOf,
  statementTab,
  setStatementTab,
  receivableTotals,
  filteredReceivables,
  receivableChip,
  setReceivableChip,
  receivableQuery,
  setReceivableQuery,
  onAdd,
  onEdit,
  onDelete,
  onManage,
  onAddReceivable,
  onSettleReceivable,
  onEditReceivable,
  onDeleteReceivable,
}: {
  account: AccountDoc;
  rows: TransactionDoc[];
  pool: number;
  spent: number;
  remaining: number;
  totalIn: number;
  totalOut: number;
  usedPct: number;
  rowMax: number;
  chip: Chip;
  setChip: (c: Chip) => void;
  query: string;
  setQuery: (q: string) => void;
  sourceOf: (t: TransactionDoc) => string;
  statementTab: "movements" | "receivables";
  setStatementTab: (t: "movements" | "receivables") => void;
  receivableTotals: { owed: number; settled: number; pending: number; pendingCount: number };
  filteredReceivables: SheetEntry[];
  receivableChip: ReceivableChip;
  setReceivableChip: (c: ReceivableChip) => void;
  receivableQuery: string;
  setReceivableQuery: (q: string) => void;
  onAdd: () => void;
  onEdit: (row: TransactionDoc) => void;
  onDelete: (row: TransactionDoc) => void;
  onManage: () => void;
  onAddReceivable: () => void;
  onSettleReceivable: (e: SheetEntry) => void;
  onEditReceivable: (e: SheetEntry) => void;
  onDeleteReceivable: (e: SheetEntry) => void;
}) {
  return (
    <div style={{ fontFamily: "Manrope, var(--font-directory), system-ui, sans-serif", letterSpacing: "-0.01em", margin: "0 -16px" }}>
      {/* ---- gradient hero ---- */}
      <div style={{ position: "relative", overflow: "hidden", background: "linear-gradient(115deg,#1f5c58 0%,#3f8f8a 68%,#4fa39c 100%)", color: "#fff", borderRadius: "0 0 26px 26px", padding: "14px 20px 20px" }}>
        <svg viewBox="0 0 390 250" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.16 }} aria-hidden>
          <circle cx="344" cy="24" r="74" fill="none" stroke="#fff" strokeWidth="1.2" />
          <circle cx="344" cy="24" r="116" fill="none" stroke="#fff" strokeWidth="1.2" />
          <circle cx="290" cy="236" r="56" fill="none" stroke="#fff" strokeWidth="1.2" />
        </svg>

        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Link href="/admin/accounts" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, opacity: 0.86, color: "#fff", textDecoration: "none" }}>
            <Icon d="M19 12H5M11 6l-6 6 6 6" size={17} w={2.2} />
            <span style={{ whiteSpace: "nowrap" }}>All accounts</span>
          </Link>
          <button type="button" onClick={onManage} aria-label="Rename or delete" className="acc-press"
            style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, border: "none" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff" aria-hidden><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
          </button>
        </div>

        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 15, marginTop: 16 }}>
          <div style={{ position: "relative", width: 88, height: 88, flexShrink: 0 }}>
            <svg width="88" height="88" viewBox="0 0 88 88" style={{ display: "block" }} aria-hidden>
              <circle cx="44" cy="44" r="36" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="9" />
              <circle cx="44" cy="44" r="36" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeDasharray={dash(usedPct, 36)} transform="rotate(-90 44 44)" />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}>
              <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.6px", fontVariantNumeric: "tabular-nums" }}>{usedPct}%</span>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.8px", opacity: 0.8 }}>USED</span>
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.4px", textTransform: "uppercase", opacity: 0.74 }}>Committee</div>
            <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.7px", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{account.name}</div>
            <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.8, marginTop: 3 }}>
              {receivableTotals.pending > 0 ? `${short(receivableTotals.pending)} pending in` : "All collected"}
            </div>
          </div>
        </div>

        {/* 4-stat metric strip */}
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 16, padding: "12px 10px", borderRadius: 18, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.22)" }}>
          {([
            ["POOL", pool],
            ["RECEIVABLE", receivableTotals.pending],
            ["SPENT", spent],
            ["REMAINING", remaining]
          ] as const).map(([label, value], i) => (
            <div key={label} style={{ minWidth: 0, textAlign: "center", borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.22)" : undefined }}>
              <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.5px", opacity: 0.8, whiteSpace: "nowrap" }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-0.4px", marginTop: 3, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{short(value)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Segmented Tab Switcher */}
      <div style={{ display: "flex", gap: 6, margin: "14px 18px 0", background: "#e2ecea", padding: 4, borderRadius: 12 }}>
        <button
          type="button"
          onClick={() => setStatementTab("movements")}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 9,
            border: "none",
            background: statementTab === "movements" ? "#fff" : "transparent",
            color: statementTab === "movements" ? C.tealInk : C.muted,
            fontSize: 12.5,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            boxShadow: statementTab === "movements" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
          }}
        >
          Movements ({rows.length})
        </button>
        <button
          type="button"
          onClick={() => setStatementTab("receivables")}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 9,
            border: "none",
            background: statementTab === "receivables" ? "#fff" : "transparent",
            color: statementTab === "receivables" ? "#1d4ed8" : C.muted,
            fontSize: 12.5,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            boxShadow: statementTab === "receivables" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
          }}
        >
          Receivables ({filteredReceivables.length})
        </button>
      </div>

      {/* Movements View */}
      {statementTab === "movements" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "12px 18px 0", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 999, padding: "11px 16px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.label} strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search movements..."
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 16, fontWeight: 500, color: "#22302f", fontFamily: "inherit" }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px 8px", overflowX: "auto" }}>
            {CHIPS.map((label) => {
              const active = chip === label;
              return (
                <button key={label} type="button" onClick={() => setChip(label)} aria-pressed={active} className="acc-press"
                  style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, padding: "9px 17px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${active ? C.teal : C.line}`, background: active ? C.teal : "#fff", color: active ? "#fff" : C.muted }}>
                  {active && <Icon d="M20 6 9 17l-5-5" size={12} w={3.2} />}
                  <span style={{ whiteSpace: "nowrap" }}>{label}</span>
                </button>
              );
            })}
          </div>

          <div style={{ padding: "8px 18px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {rows.map((t) => {
                const isIncome = t.direction === "IN";
                const m = isIncome
                  ? { color: C.tealInk, tint: "#e8f5f3", d: "M17 7 7 17M15 17H7V9" }
                  : (KIND_META[t.type] ?? KIND_META.EXPENSE);
                const baseTotal = isIncome ? (totalIn > 0 ? totalIn : t.amount) : (totalOut > 0 ? totalOut : t.amount);
                const sharePct = baseTotal > 0 ? Math.round((t.amount / baseTotal) * 100) : 0;
                return (
                  <div key={t.id} className="acc-in" style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 20, padding: "15px 16px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "42px minmax(0,1fr) auto", alignItems: "center", gap: 13 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: m.tint, color: m.color }}>
                        <Icon d={m.d} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.35px", color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.sourceLabel ?? "—"}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, minWidth: 0 }}>
                          <span style={{ flexShrink: 0, padding: "3px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.3px", whiteSpace: "nowrap", background: m.tint, color: m.color }}>
                            {isIncome ? "Money in" : TRANSACTION_TYPE_LABELS[t.type]}
                          </span>
                          <span style={{ fontSize: 11.5, color: C.hair, flexShrink: 0 }}>·</span>
                          <span style={{ fontSize: 11.5, fontWeight: 500, color: C.label, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {t.dayKey} · {sourceOf(t)}
                          </span>
                        </div>
                      </div>
                      <span style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: "-0.4px", color: isIncome ? C.tealInk : C.spendInk, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {isIncome ? `+${formatMoney(t.amount)}` : formatMoney(t.amount)}
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 12, marginTop: 13, paddingTop: 12, borderTop: `1px solid ${C.rowLine}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                        <div style={{ flex: 1, minWidth: 0, height: 6, borderRadius: 999, background: C.rowLine, overflow: "hidden" }}>
                          <div style={{ height: "100%", borderRadius: 999, width: `${Math.max(6, Math.round((t.amount / rowMax) * 100))}%`, background: isIncome ? "linear-gradient(90deg,#5cb8b2,#2f7d78)" : "linear-gradient(90deg,#d8735f,#c0574a)" }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: isIncome ? C.tealInk : C.share, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{sharePct}%</span>
                      </div>
                      {t.sourceModule === "MANUAL" && (
                        <button type="button" onClick={() => onEdit(t)} aria-label="Edit" className="acc-press"
                          style={{ width: 34, height: 34, borderRadius: 11, background: C.field, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.muted, flexShrink: 0, border: "none" }}>
                          <Icon d="M4 20h4l11-11-4-4L4 16v4Z" size={15} w={1.9} />
                        </button>
                      )}
                      <button type="button" onClick={() => onDelete(t)} aria-label="Delete" className="acc-press"
                        style={{ width: 34, height: 34, borderRadius: 11, background: C.spendTint, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.spendInk, flexShrink: 0, border: "none" }}>
                        <Icon d="M4 7h16M9 7V5h6v2M6 7v13h12V7M10 11v5M14 11v5" size={15} w={1.9} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {rows.length === 0 && (
              <div style={{ padding: "46px 12px", textAlign: "center", fontSize: 13.5, fontWeight: 500, color: C.label }}>
                No entries match this filter.
              </div>
            )}

            <div style={{ position: "sticky", bottom: 12, display: "flex", justifyContent: "flex-end", pointerEvents: "none", marginTop: 14, zIndex: 5 }}>
              <button type="button" onClick={onAdd} className="acc-press"
                style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 9, padding: "14px 22px", borderRadius: 999, background: C.teal, color: "#fff", fontSize: 14, fontWeight: 700, boxShadow: "0 10px 24px rgba(31,92,88,0.34)", cursor: "pointer", border: "none", fontFamily: "inherit" }}>
                <Icon d="M12 5v14M5 12h14" size={17} w={2.4} />
                <span>Add spending</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Receivables View */}
      {statementTab === "receivables" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "12px 18px 0", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 999, padding: "11px 16px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.label} strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input value={receivableQuery} onChange={(e) => setReceivableQuery(e.target.value)} placeholder="Search member, source..."
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 16, fontWeight: 500, color: "#22302f", fontFamily: "inherit" }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px 8px", overflowX: "auto" }}>
            {RECEIVABLE_CHIPS.map((label) => {
              const active = receivableChip === label;
              return (
                <button key={label} type="button" onClick={() => setReceivableChip(label)} aria-pressed={active} className="acc-press"
                  style={{
                    display: "flex", alignItems: "center", gap: 6, flexShrink: 0, padding: "9px 17px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                    border: `1px solid ${active ? "#2563eb" : C.line}`,
                    background: active ? "#2563eb" : "#fff",
                    color: active ? "#fff" : C.muted
                  }}>
                  {active && <Icon d="M20 6 9 17l-5-5" size={12} w={3.2} />}
                  <span style={{ whiteSpace: "nowrap" }}>{label}</span>
                </button>
              );
            })}
          </div>

          <div style={{ padding: "8px 18px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {filteredReceivables.map((e) => {
                const pending = pendingOf(e);
                const isSettled = e.amount > 0 && e.settled >= e.amount;
                const isPart = e.settled > 0 && !isSettled;
                const pct = e.amount > 0 ? Math.min(100, Math.round((e.settled / e.amount) * 100)) : 0;

                return (
                  <div key={e.id} className="acc-in" style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 20, padding: "15px 16px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "40px minmax(0,1fr) auto", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: isSettled ? "#e8f5f3" : "#eff6ff", color: isSettled ? C.tealInk : "#2563eb" }}>
                        <Icon d="M17 7 7 17M15 17H7V9" size={16} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.35px", color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, minWidth: 0 }}>
                          <span style={{
                            flexShrink: 0, padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: "0.3px", whiteSpace: "nowrap",
                            background: isSettled ? "#e8f5f3" : isPart ? "#eff6ff" : "#fef3c7",
                            color: isSettled ? C.tealInk : isPart ? "#1d4ed8" : "#b45309",
                          }}>
                            {isSettled ? "Settled" : isPart ? "Part" : "Pending"}
                          </span>
                          <span style={{ fontSize: 11.5, color: C.hair, flexShrink: 0 }}>·</span>
                          <span style={{ fontSize: 11.5, fontWeight: 500, color: C.label, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {e.dayKey} {e.purpose ? `· ${e.purpose}` : ""}
                          </span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.4px", color: C.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {formatMoney(e.amount)}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: isSettled ? C.tealInk : "#b45309", fontVariantNumeric: "tabular-nums" }}>
                          {isSettled ? "Settled" : `${formatMoney(pending)} left`}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.rowLine}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, fontWeight: 600, color: C.label, marginBottom: 4 }}>
                        <span>Progress: {pct}%</span>
                        <span>{formatMoney(e.settled)} received</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 999, background: C.rowLine, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", borderRadius: 999, width: `${Math.max(4, pct)}%`,
                          background: isSettled ? "linear-gradient(90deg,#5cb8b2,#2f7d78)" : "linear-gradient(90deg,#60a5fa,#2563eb)"
                        }} />
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.rowLine}` }}>
                      {!isSettled ? (
                        <button
                          type="button"
                          onClick={() => onSettleReceivable(e)}
                          className="acc-press"
                          style={{
                            padding: "8px 16px",
                            borderRadius: 999,
                            background: C.teal,
                            color: "#fff",
                            fontSize: 12.5,
                            fontWeight: 700,
                            cursor: "pointer",
                            border: "none",
                            fontFamily: "inherit",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          <Icon d="M17 7 7 17M15 17H7V9" size={13} w={2.4} />
                          <span>Receive money</span>
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.tealInk }}>✓ Completed</span>
                      )}

                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" onClick={() => onEditReceivable(e)} aria-label="Edit" className="acc-press"
                          style={{ width: 34, height: 34, borderRadius: 11, background: C.field, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.muted, flexShrink: 0, border: "none" }}>
                          <Icon d="M4 20h4l11-11-4-4L4 16v4Z" size={15} w={1.9} />
                        </button>
                        <button type="button" onClick={() => onDeleteReceivable(e)} aria-label="Delete" className="acc-press"
                          style={{ width: 34, height: 34, borderRadius: 11, background: C.spendTint, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.spendInk, flexShrink: 0, border: "none" }}>
                          <Icon d="M4 7h16M9 7V5h6v2M6 7v13h12V7M10 11v5M14 11v5" size={15} w={1.9} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredReceivables.length === 0 && (
              <div style={{ padding: "46px 12px", textAlign: "center", fontSize: 13.5, fontWeight: 500, color: C.label }}>
                No receivables found.
              </div>
            )}

            <div style={{ position: "sticky", bottom: 12, display: "flex", justifyContent: "flex-end", pointerEvents: "none", marginTop: 14, zIndex: 5 }}>
              <button type="button" onClick={onAddReceivable} className="acc-press"
                style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 9, padding: "14px 22px", borderRadius: 999, background: "#2563eb", color: "#fff", fontSize: 14, fontWeight: 700, boxShadow: "0 10px 24px rgba(37,99,235,0.34)", cursor: "pointer", border: "none", fontFamily: "inherit" }}>
                <Icon d="M12 5v14M5 12h14" size={17} w={2.4} />
                <span>Add receivable</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function CommitteeReceivableFormModal({
  entry,
  account,
  getIdToken,
  onClose,
  onSaved,
}: {
  entry: SheetEntry | null;
  account: AccountDoc;
  getIdToken?: () => Promise<string>;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const isMobile = useIsMobile();
  const field = fieldStyle(isMobile);
  const [name, setName] = useState(entry?.name ?? "");
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [settled, setSettled] = useState(entry ? String(entry.settled || "") : "");
  const [dayKey, setDayKey] = useState(entry?.dayKey ?? karachiDayKey());
  const [returnDayKey, setReturnDayKey] = useState(entry?.returnDayKey ?? "");
  const [purpose, setPurpose] = useState(entry?.purpose ?? `${account.name} Installment`);
  const [description, setDescription] = useState(entry?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (text: string) => Number(String(text).replace(/[,\s]/g, "")) || 0;
  const pending = Math.max(0, num(amount) - num(settled));

  const submit = async () => {
    if (!name.trim()) {
      setError("Member or source name is required.");
      return;
    }
    if (num(amount) <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (!getIdToken) {
      setError("Authentication not ready.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken();
      const result = await saveSheetEntry(
        token,
        {
          side: "RECEIVABLE",
          group: "Committee",
          committeeAccountId: account.id,
          dayKey,
          name: name.trim(),
          amount: num(amount),
          settled: num(settled),
          returnDayKey: returnDayKey.trim() || null,
          purpose: purpose.trim() || null,
          description: description.trim() || null,
        },
        entry?.id
      );
      if (result.ok) {
        onSaved(`${name.trim()} ${entry ? "updated" : "added to committee receivables"}.`);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayPanel
      title={entry ? `Edit ${entry.name}` : `Add Committee Receivable`}
      subtitle={`${account.name} · Money coming in`}
      icon={<Icon d="M17 7 7 17M15 17H7V9" size={18} />}
      maxWidth={580}
      onClose={onClose}
      footer={
        <FooterButtons
          onCancel={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={entry ? "Save changes" : "Add receivable"}
          left={
            <span style={{ fontSize: 12.5, fontWeight: 700, color: pending > 0 ? "#b45309" : C.tealInk }}>
              Pending: {formatMoney(pending)}
            </span>
          }
        />
      }
    >
      <OverlayCard title="Receivable Details">
        <FormGrid isMobile={isMobile}>
          <Field label="Member / Source Name" hint="Who is paying into this committee?">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Qalbe Hassan, Choba, etc."
              style={field}
            />
          </Field>
          <Field label="Total Amount (Rs)" hint="Amount they owe or committed">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 50,000"
              style={field}
            />
          </Field>
          <Field label="Entry Date">
            <input type="date" value={dayKey} onChange={(e) => setDayKey(e.target.value)} style={field} />
          </Field>
          <Field label="Due / Expected Date (Optional)">
            <input type="date" value={returnDayKey} onChange={(e) => setReturnDayKey(e.target.value)} style={field} />
          </Field>
          <Field label="Purpose / Round Label" wide hint="What installment or round is this for?">
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder={`e.g. ${account.name} Installment / Share`}
              style={field}
            />
          </Field>
          <Field label="Already Received (Rs)" hint="Optional: If money was already paid previously outside">
            <input
              inputMode="decimal"
              value={settled}
              onChange={(e) => setSettled(e.target.value)}
              placeholder="0"
              style={field}
            />
          </Field>
          <Field label="Notes / Description" wide>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes or details"
              style={field}
            />
          </Field>
        </FormGrid>
      </OverlayCard>
      <FormError text={error} />
    </OverlayPanel>
  );
}

/* ------------------------------------------------------------------------ */

function CommitteeSheetOnlySettleModal({
  entry,
  getIdToken,
  onClose,
  onBack,
  onSaved,
}: {
  entry: SheetEntry;
  getIdToken?: () => Promise<string>;
  onClose: () => void;
  onBack: () => void;
  onSaved: (msg: string) => void;
}) {
  const isMobile = useIsMobile();
  const field = fieldStyle(isMobile);
  const pending = pendingOf(entry);
  const [amount, setAmount] = useState(String(pending));
  const [dayKey, setDayKey] = useState(karachiDayKey());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!getIdToken) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken();
      const num = Number(String(amount).replace(/[,\s]/g, "")) || 0;
      const res = await settleSheetEntry(token, entry.id, { amount: num, dayKey, note });
      if (res.ok) {
        onSaved(
          res.data.pending > 0
            ? `${formatMoney(num)} recorded — ${formatMoney(res.data.pending)} still pending on ${entry.name}.`
            : `${entry.name} is settled.`
        );
      } else {
        setError(res.error);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayPanel
      title={`Received from ${entry.name} — sheet only`}
      subtitle={`${formatMoney(pending)} pending`}
      icon={<Icon d="M17 7 7 17M15 17H7V9" size={18} />}
      maxWidth={480}
      onClose={onClose}
      footer={<FooterButtons onCancel={onClose} onSubmit={() => void submit()} busy={busy} submitLabel="Record" />}
    >
      <FormGrid isMobile={isMobile}>
        <Field label="Amount (Rs)">
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={field} />
        </Field>
        <Field label="Date">
          <input type="date" value={dayKey} onChange={(e) => setDayKey(e.target.value)} style={field} />
        </Field>
        <Field label="Note" wide>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" style={field} />
        </Field>
      </FormGrid>
      <p style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.5 }}>
        For money that never touched an account. No account balance changes.{" "}
        <button
          type="button"
          onClick={onBack}
          style={{ border: "none", background: "transparent", padding: 0, font: "inherit", fontWeight: 700, color: C.tealInk, cursor: "pointer" }}
        >
          Move it into an account instead →
        </button>
      </p>
      <FormError text={error} />
    </OverlayPanel>
  );
}
