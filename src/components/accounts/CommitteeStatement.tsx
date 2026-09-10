"use client";

/**
 * A committee's statement, transcribed from the design files.
 *
 * Source of truth: `Committee Account.dc.html` and
 * `Committee Account Mobile.dc.html`. **Every value here is copied from those
 * files, not measured from a picture** — the project's rule for design work,
 * and the reason the two layouts hold together at all.
 *
 * The one deliberate departure is the phone frame: the mobile file draws a
 * 390×844 device with a 9:41 status bar and signal bars, and reproducing that
 * inside a real phone would be a second status bar under the real one. The
 * gradient hero, its rings, the progress dial and everything below are the
 * design's; the drawn hardware is not.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { AccountDoc, TransactionDoc } from "@/hooks/useLedger";
import { TRANSACTION_TYPE_LABELS, type TransactionType } from "@/lib/ledger";

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
};

const CHIPS = ["All", "Money in", "Money out", "Expense", "Income", "Transfer", "Reimbursement"] as const;
type Chip = (typeof CHIPS)[number];

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
  account, transactions, isMobile, onAdd, onEdit, onDelete, onManage,
}: {
  account: AccountDoc;
  transactions: TransactionDoc[];
  isMobile: boolean;
  onAdd: () => void;
  onEdit: (row: TransactionDoc) => void;
  onDelete: (row: TransactionDoc) => void;
  onManage: () => void;
}) {
  const [chip, setChip] = useState<Chip>("All");
  const [query, setQuery] = useState("");

  const mine = useMemo(
    () => transactions.filter((t) => t.accountId === account.id && t.status === "POSTED"),
    [transactions, account.id]
  );

  const pool = account.openingBalance ?? 0;
  const spent = mine.filter((t) => t.direction === "OUT").reduce((a, t) => a + t.amount, 0);
  const remaining = pool - spent;
  const usedPct = pool > 0 ? Math.round((spent / pool) * 100) : 0;
  const leftPct = Math.max(0, 100 - usedPct);
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

  const sourceOf = (t: TransactionDoc) =>
    t.sourceModule === "MANUAL" ? "Manual entry" : (t.sourceLabel ? "Office Expense" : t.sourceModule);

  if (isMobile) {
    return (
      <MobileStatement
        account={account} rows={rows} pool={pool} spent={spent} remaining={remaining}
        usedPct={usedPct} rowMax={rowMax} chip={chip} setChip={setChip}
        query={query} setQuery={setQuery} sourceOf={sourceOf}
        onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onManage={onManage}
      />
    );
  }

  const stats = [
    { label: "Committee Amount", value: pool, note: "Full pool for this committee", pill: "Pool", tone: "neutral", pct: 100, color: C.ink, accent: C.teal, d: "M3 10 12 4l9 6M5 10v9h14v-9M9 19v-5h6v5" },
    { label: "Spent", value: spent, note: `${usedPct}% of the committee used`, pill: `${usedPct}%`, tone: "down", pct: usedPct, color: C.spendInk, accent: C.spend, d: "M7 17 17 7M9 7h8v8" },
    { label: "Remaining", value: remaining, note: `${leftPct}% still available`, pill: `${leftPct}%`, tone: "up", pct: leftPct, color: C.tealInk, accent: C.tealInk, d: "M3 7h18v12H3zM3 11h18M7 15h4" },
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
                {account.name} · {formatMoney(remaining)} remaining · {rows.length} record{rows.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={onManage} className="acc-press"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 20px", borderRadius: 999, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.45)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
              <span style={{ whiteSpace: "nowrap" }}>Rename or delete</span>
            </button>
            <button type="button" onClick={onAdd} className="acc-press"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 22px", borderRadius: 999, background: "#fff", color: C.deep, fontSize: 13.5, fontWeight: 700, cursor: "pointer", border: "none", fontFamily: "inherit" }}>
              <Icon d="M12 5v14M5 12h14" size={16} w={2.4} />
              <span style={{ whiteSpace: "nowrap" }}>Add spending</span>
            </button>
          </div>
        </div>
      </div>

      {/* ---- three stat cards ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(272px,1fr))", gap: 14, marginBottom: 16 }}>
        {stats.map((s) => (
          <div key={s.label} className="acc-in" style={{ position: "relative", overflow: "hidden", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, padding: "18px 20px 20px" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: s.accent }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={{ width: 30, height: 30, borderRadius: 10, background: C.tint, color: s.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon d={s.d} size={16} w={2} />
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: C.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
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
            <div style={{ fontSize: 31, fontWeight: 800, letterSpacing: "-1.2px", marginTop: 12, color: s.color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {formatMoney(s.value)}
            </div>
            <div style={{ height: 7, borderRadius: 999, background: C.page, marginTop: 14, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 999, width: `${Math.max(3, Math.min(100, s.pct))}%`, background: s.accent }} />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: C.faint, marginTop: 8 }}>{s.note}</div>
          </div>
        ))}
      </div>

      {/* ---- the statement panel ---- */}
      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, overflow: "hidden" }}>
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

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "13px 20px", background: C.spendBar, borderTop: `1px solid ${C.spendBorder}`, borderBottom: `1px solid ${C.spendBorder}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.spend }} />
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: C.spendInk, whiteSpace: "nowrap" }}>Spendings</span>
            <span style={{ padding: "2px 9px", borderRadius: 999, background: "#fff", border: `1px solid ${C.spendPill}`, fontSize: 11, fontWeight: 700, color: C.spendPillInk }}>{rows.length}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.5px", color: C.spendInk, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatMoney(spent)}</span>
            <button type="button" onClick={onAdd} className="acc-press"
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 15px", borderRadius: 999, background: "#fff", border: `1px solid ${C.spendPill}`, fontSize: 12.5, fontWeight: 700, color: C.spendInk, cursor: "pointer", fontFamily: "inherit" }}>
              <Icon d="M12 5v14M5 12h14" size={13} w={2.6} />
              <span>Add</span>
            </button>
          </div>
        </div>

        {rows.map((t) => {
          const m = KIND_META[t.type] ?? KIND_META.EXPENSE;
          const sharePct = spent > 0 ? Math.round((t.amount / spent) * 100) : 0;
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
                    {TRANSACTION_TYPE_LABELS[t.type]}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: C.faint, marginTop: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.dayKey} · {sourceOf(t)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <div style={{ flex: 1, minWidth: 0, height: 6, borderRadius: 999, background: C.rowLine, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 999, width: `${Math.max(6, Math.round((t.amount / rowMax) * 100))}%`, background: "linear-gradient(90deg,#d8735f,#c0574a)" }} />
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.share, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>{sharePct}%</span>
              </div>
              <div style={{ textAlign: "right", fontSize: 16, fontWeight: 800, letterSpacing: "-0.4px", color: C.spendInk, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", minWidth: 104 }}>
                {formatMoney(t.amount)}
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
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function MobileStatement({
  account, rows, pool, spent, remaining, usedPct, rowMax, chip, setChip, query, setQuery,
  sourceOf, onAdd, onEdit, onDelete, onManage,
}: {
  account: AccountDoc;
  rows: TransactionDoc[];
  pool: number; spent: number; remaining: number; usedPct: number; rowMax: number;
  chip: Chip; setChip: (c: Chip) => void;
  query: string; setQuery: (q: string) => void;
  sourceOf: (t: TransactionDoc) => string;
  onAdd: () => void;
  onEdit: (row: TransactionDoc) => void;
  onDelete: (row: TransactionDoc) => void;
  onManage: () => void;
}) {
  return (
    <div style={{ fontFamily: "Manrope, var(--font-directory), system-ui, sans-serif", letterSpacing: "-0.01em", margin: "0 -16px" }}>
      {/* ---- gradient hero ---- */}
      <div style={{ position: "relative", overflow: "hidden", background: "linear-gradient(115deg,#1f5c58 0%,#3f8f8a 68%,#4fa39c 100%)", color: "#fff", borderRadius: "0 0 26px 26px", padding: "14px 20px 20px" }}>
        {/* The design's rings. No drawn status bar — the phone already has one. */}
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
            <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.8, marginTop: 3 }}>Every movement, and what caused it</div>
          </div>
        </div>

        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, marginTop: 16, padding: "13px 14px", borderRadius: 18, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.22)" }}>
          {([["COMMITTEE", pool], ["SPENT", spent], ["REMAINING", remaining]] as const).map(([label, value], i) => (
            <div key={label} style={{ flex: 1, minWidth: 0, textAlign: "center", borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.22)" : undefined }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.7px", opacity: 0.8, whiteSpace: "nowrap" }}>{label}</div>
              <div style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: "-0.5px", marginTop: 3, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{short(value)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- search + chips ---- */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "16px 18px 0", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 999, padding: "11px 16px" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.label} strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        {/* 16px, or iOS Safari zooms the page on focus. */}
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this statement..."
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

      {/* ---- rows ---- */}
      <div style={{ padding: "8px 18px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "6px 4px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.spend }} />
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: C.spendInk, whiteSpace: "nowrap" }}>Spendings</span>
            <span style={{ padding: "2px 8px", borderRadius: 999, background: "#fff", border: `1px solid ${C.spendPill}`, fontSize: 10.5, fontWeight: 700, color: C.spendPillInk }}>{rows.length}</span>
          </div>
          <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.5px", color: C.spendInk, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatMoney(spent)}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {rows.map((t) => {
            const m = KIND_META[t.type] ?? KIND_META.EXPENSE;
            const sharePct = spent > 0 ? Math.round((t.amount / spent) * 100) : 0;
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
                        {TRANSACTION_TYPE_LABELS[t.type]}
                      </span>
                      <span style={{ fontSize: 11.5, color: C.hair, flexShrink: 0 }}>·</span>
                      <span style={{ fontSize: 11.5, fontWeight: 500, color: C.label, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {t.dayKey} · {sourceOf(t)}
                      </span>
                    </div>
                  </div>
                  <span style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: "-0.4px", color: C.spendInk, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {formatMoney(t.amount)}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 12, marginTop: 13, paddingTop: 12, borderTop: `1px solid ${C.rowLine}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, height: 6, borderRadius: 999, background: C.rowLine, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 999, width: `${Math.max(6, Math.round((t.amount / rowMax) * 100))}%`, background: "linear-gradient(90deg,#d8735f,#c0574a)" }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.share, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{sharePct}%</span>
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

        {/*
          **The floating Add — sticky, not fixed.**
          
          `position: fixed` was wrong twice over. Every page in this CRM is
          wrapped in `.animate-page-transition`, which carries
          `will-change: transform`, and that makes the wrapper the containing
          block for any `fixed` descendant — so the button was pinned to the
          page's content box rather than the viewport, and drifted up as the
          list scrolled. Second, the phone's tab bar is a real row at the foot
          of the shell, not an overlay, so a viewport-fixed button sat on top of
          it and over the last card.
          
          Sticky solves both without a portal: it is positioned against the
          scrolling column, which already ends above the tab bar, and as the
          last child in flow it floats over the list while scrolling and then
          settles clear of the final row. `pointerEvents` is lifted off the
          wrapper so the strip does not swallow taps on the card beneath it.
        */}
        <div
          style={{
            position: "sticky",
            bottom: 12,
            display: "flex",
            justifyContent: "flex-end",
            pointerEvents: "none",
            marginTop: 14,
            zIndex: 5,
          }}
        >
          <button type="button" onClick={onAdd} className="acc-press"
            style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 9, padding: "14px 22px", borderRadius: 999, background: C.teal, color: "#fff", fontSize: 14, fontWeight: 700, boxShadow: "0 10px 24px rgba(31,92,88,0.34)", cursor: "pointer", border: "none", fontFamily: "inherit" }}>
            <Icon d="M12 5v14M5 12h14" size={17} w={2.4} />
            <span>Add</span>
          </button>
        </div>
      </div>

    </div>
  );
}
