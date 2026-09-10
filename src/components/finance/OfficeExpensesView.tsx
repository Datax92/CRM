"use client";

/**
 * Office Expenses — dashboard, ledger and reports on one screen.
 *
 * **Admin and HR only.** The route guards it, the Server Actions refuse
 * everybody else, and the Security Rule refuses the read — three layers,
 * because the brief is unusually firm that managers and employees must not see
 * this at all.
 *
 * Three tabs rather than three routes: the filters are shared, and a person
 * who has just filtered to "Marketing, this quarter" should be able to see the
 * ledger and the breakdown of that same selection without setting it twice.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  Paperclip,
  Pencil,
  Receipt,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useOfficeExpenses } from "@/hooks/useOfficeExpenses";
import {
  deleteOfficeExpense,
  getExpenseCategories,
  setOfficeExpenseStatus,
} from "@/lib/clientActions";
import {
  EXPENSE_STATUSES,
  EXPENSE_STATUS_LABELS,
  expensesByCategory,
  expensesByPeriod,
  summarizeExpenses,
  trendPercent,
  type ExpenseStatus,
  type OfficeExpense,
} from "@/lib/officeExpenses";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import {
  Banner,
  ExpenseStatusPill,
  F,
  FinanceCard,
  EmptyState,
  PrimaryButton,
  ShareBar,
  fieldStyle,
  labelStyle,
  rupees,
} from "./financeChrome";
import { ExpenseFormModal } from "./ExpenseFormModal";
import { PayFromAccounts } from "@/components/accounts/PayFromAccounts";
import { useLedger } from "@/hooks/useLedger";
import { Wallet } from "lucide-react";
import { ExpenseCategoriesModal } from "./ExpenseCategoriesModal";

/** The first of the current month — the period an expense question usually means. */
function monthStart(): string {
  return `${karachiMonthKey()}-01`;
}

export function OfficeExpensesView({ isAdmin }: { isAdmin: boolean }) {
  const { getIdToken } = useAuth();
  const { expenses, loading, error } = useOfficeExpenses(true);
  // Mobile is the primary surface here: the filters stack, the two header
  // actions go full width, and every action stays present rather than
  // being dropped for space.
  const isMobile = useIsMobile();

  const [tab, setTab] = useState<"LEDGER" | "REPORTS">("LEDGER");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(karachiDayKey());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ExpenseStatus | "ALL">("ALL");
  const [category, setCategory] = useState("ALL");
  /**
   * The expense being funded. `paidOf` reads what has already been paid
   * against it, so a part-paid expense offers "Pay balance" and the modal only
   * lets the remainder be allocated — the obligation itself never changes.
   */
  const [paying, setPaying] = useState<OfficeExpense | null>(null);
  const ledger = useLedger(true);
  const [grain, setGrain] = useState<"day" | "month" | "year">("month");

  const [categories, setCategories] = useState<string[]>([]);
  const [editing, setEditing] = useState<OfficeExpense | null>(null);
  const [creating, setCreating] = useState(false);
  const [managingCategories, setManagingCategories] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reloadCategories = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await getIdToken().catch(() => "");
      if (cancelled || !token) return;

      const result = await getExpenseCategories(token);
      if (cancelled) return;
      if (result.ok) setCategories(result.data.categories);
    })();

    return () => {
      cancelled = true;
    };
  }, [getIdToken, nonce]);

  /** The range first — every figure on the screen belongs to the same period. */
  const inRange = useMemo(
    () => expenses.filter((expense) => expense.dayKey >= from && expense.dayKey <= to),
    [expenses, from, to]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inRange.filter((expense) => {
      if (status !== "ALL" && expense.status !== status) return false;
      if (category !== "ALL" && expense.category !== category) return false;
      if (!needle) return true;
      return (
        expense.title.toLowerCase().includes(needle) ||
        (expense.paidBy ?? "").toLowerCase().includes(needle) ||
        (expense.description ?? "").toLowerCase().includes(needle)
      );
    });
  }, [inRange, search, status, category]);

  // The dashboard describes the **range**, not the filter. A total that fell
  // when somebody clicked "Pending" would read as the company having spent
  // less, which is the opposite of what happened.
  const summary = useMemo(() => summarizeExpenses(inRange), [inRange]);
  const monthSummary = useMemo(
    () =>
      summarizeExpenses(
        expenses.filter((expense) => expense.dayKey.startsWith(karachiMonthKey()))
      ),
    [expenses]
  );
  const byCategory = useMemo(() => expensesByCategory(inRange), [inRange]);
  const byPeriod = useMemo(() => expensesByPeriod(inRange, grain), [inRange, grain]);
  const trend = useMemo(() => trendPercent(byPeriod), [byPeriod]);

  const page = usePagination(filtered, 12);

  const decide = async (expense: OfficeExpense, next: ExpenseStatus) => {
    setBusyId(expense.id);
    const token = await getIdToken();
    const result = await setOfficeExpenseStatus(token, expense.id, next);
    setBusyId(null);
    setBanner(
      result.ok
        ? { ok: true, text: `"${expense.title}" ${EXPENSE_STATUS_LABELS[next].toLowerCase()}.` }
        : { ok: false, text: result.error }
    );
  };

  const remove = async (expense: OfficeExpense) => {
    setBusyId(expense.id);
    const token = await getIdToken();
    const result = await deleteOfficeExpense(token, expense.id);
    setBusyId(null);
    setBanner(
      result.ok
        ? { ok: true, text: `"${expense.title}" deleted.` }
        : { ok: false, text: result.error }
    );
  };

  const download = () => {
    const header = ["Date", "Title", "Category", "Amount", "Status", "Paid by", "Method", "Notes"];
    const rows = filtered.map((expense) => [
      expense.dayKey,
      expense.title,
      expense.category,
      expense.amount,
      EXPENSE_STATUS_LABELS[expense.status],
      expense.paidBy ?? "",
      expense.paymentMethod ?? "",
      expense.description ?? "",
    ]);

    // Every field quoted: a description with a comma would otherwise shift
    // every column after it by one, silently.
    const csv = [header, ...rows]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");

    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `office-expenses-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/*
        The banner, transcribed from `Office Expenses.dc.html` — the 115°
        gradient, its three ring outlines, the 50px glass tile and the 32px
        figure. The mobile file uses the same gradient with a 40px tile and a
        29px figure, so the two differ only by those values.
      */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 20,
          background: "linear-gradient(115deg,#1f5c58 0%,#3f8f8a 66%,#4fa39c 100%)",
          color: "#fff",
          padding: isMobile ? "18px 20px" : "22px 26px",
        }}
      >
        <svg
          viewBox="0 0 400 170"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.16 }}
          aria-hidden
        >
          <circle cx="356" cy="20" r="78" fill="none" stroke="#fff" strokeWidth="1.2" />
          <circle cx="356" cy="20" r="120" fill="none" stroke="#fff" strokeWidth="1.2" />
          <circle cx="296" cy="162" r="54" fill="none" stroke="#fff" strokeWidth="1.2" />
        </svg>

        <div style={{ position: "relative", display: "flex", alignItems: isMobile ? "flex-start" : "flex-end", justifyContent: "space-between", gap: isMobile ? 14 : 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
            {!isMobile && (
              <div style={{ width: 50, height: 50, borderRadius: 16, background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.42)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />
                </svg>
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: isMobile ? "1.5px" : "1.6px", textTransform: "uppercase", opacity: 0.74 }}>
                Office Expenses
              </div>
              <div style={{ fontSize: isMobile ? 29 : 32, fontWeight: 800, letterSpacing: isMobile ? "-1.1px" : "-1.2px", marginTop: isMobile ? 2 : 1, fontVariantNumeric: "tabular-nums" }}>
                {rupees(summary.spend)}
              </div>
              <div style={{ fontSize: isMobile ? 12 : 12.5, fontWeight: 500, opacity: isMobile ? 0.82 : 0.84, marginTop: 2 }}>
                approved{isMobile ? "" : " in this period"} · {summary.count} record{summary.count === 1 ? "" : "s"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, width: isMobile ? "100%" : undefined }}>
            <button type="button" onClick={() => setManagingCategories(true)} className="acc-press"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px 20px", borderRadius: 999, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.45)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flex: isMobile ? 1 : undefined }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 12V4h8l9 9-8 8-9-9Z" /><circle cx="7.5" cy="7.5" r="1.4" />
              </svg>
              <span style={{ whiteSpace: "nowrap" }}>Categories</span>
            </button>
            <button type="button" onClick={() => setCreating(true)} className="acc-press"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px 22px", borderRadius: 999, background: "#fff", color: "#1f5c58", fontSize: 13.5, fontWeight: 700, cursor: "pointer", border: "none", fontFamily: "inherit", flex: isMobile ? 1 : undefined }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
              <span style={{ whiteSpace: "nowrap" }}>Add expense</span>
            </button>
          </div>
        </div>
      </section>

      {banner && <Banner ok={banner.ok}>{banner.text}</Banner>}
      {error && <Banner ok={false}>{error}</Banner>}

      {/* ------------------------------------------------------------------ */}
      {/* Dashboard                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(212px, 1fr))", gap: 12 }}>
        {(() => {
          const total = summary.total;
          const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
          const cards = [
            { label: "Total Invoiced", value: summary.total, note: "every record in range", pill: `${summary.count} recs`, tone: "neutral", pct: 100, color: "#141f1e", accent: "#3f8f8a" },
            { label: "This Month", value: monthSummary.spend, note: "approved", pill: null, tone: "neutral", pct: pct(monthSummary.spend), color: "#141f1e", accent: "#4fa39c" },
            { label: "Pending", value: summary.pending, note: `${summary.pendingCount} awaiting a decision`, pill: summary.pendingCount ? "Action" : "Clear", tone: summary.pendingCount ? "warn" : "neutral", pct: pct(summary.pending), color: "#a5762a", accent: "#c99a2e" },
            { label: "Approved", value: summary.approved, note: `${summary.approvedCount} records`, pill: `${pct(summary.approved)}%`, tone: "up", pct: pct(summary.approved), color: "#2f7d78", accent: "#2f7d78" },
            { label: "Rejected", value: summary.rejected, note: `${summary.rejectedCount} records`, pill: summary.rejectedCount ? "Review" : "None", tone: summary.rejectedCount ? "down" : "neutral", pct: pct(summary.rejected), color: "#a8483c", accent: "#c0574a" },
          ] as const;
          const pillTone = (tone: string) =>
            tone === "up" ? { background: "#e8f5f3", color: "#2f7d78" }
              : tone === "warn" ? { background: "#fdf5e6", color: "#8a6321" }
                : tone === "down" ? { background: "#fdeeec", color: "#a8483c" }
                  : { background: "#f2f7f6", color: "#6c7d7b" };
          const icons: Record<string, string> = {
            "Total Invoiced": "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
            "This Month": "M4 5h16v16H4zM8 3v4M16 3v4M4 11h16",
            Pending: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
            Approved: "M20 6 9 17l-5-5",
            Rejected: "M6 6l12 12M18 6 6 18",
          };
          return cards.map((c) => (
            <div key={c.label} style={{ position: "relative", overflow: "hidden", background: "#fff", border: "1px solid #e2ecea", borderRadius: 16, padding: "15px 18px" }}>
              {/* The 3px accent stripe the design puts down every card. */}
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: c.accent }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 9, background: "#f2f8f7", color: c.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={icons[c.label]} /></svg>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#6c7d7b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{c.label}</span>
                </div>
                {c.pill && (
                  <span style={{ flexShrink: 0, padding: "3px 9px", borderRadius: 999, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", ...pillTone(c.tone) }}>{c.pill}</span>
                )}
              </div>
              <div style={{ fontSize: isMobile ? 21 : 25, fontWeight: 800, letterSpacing: "-0.9px", marginTop: 9, color: c.color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {rupees(c.value)}
              </div>
              <div style={{ height: 5, borderRadius: 999, background: "#eef4f3", marginTop: 11, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 999, width: `${Math.max(3, Math.min(100, c.pct))}%`, background: c.accent }} />
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 500, color: "#6c7d7b", marginTop: 7 }}>{c.note}</div>
            </div>
          ));
        })()}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Filters — shared by both tabs                                       */}
      {/* ------------------------------------------------------------------ */}
      <FinanceCard title="Period and filters" hint={`${from} → ${to}`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 4, flex: isMobile ? "1 1 100%" : undefined }}>
            <span style={labelStyle}>From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              style={{ ...fieldStyle, width: isMobile ? "100%" : "auto" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4, flex: isMobile ? "1 1 100%" : undefined }}>
            <span style={labelStyle}>To</span>
            <input
              type="date"
              value={to}
              min={from}
              max={karachiDayKey()}
              onChange={(event) => setTo(event.target.value)}
              style={{ ...fieldStyle, width: isMobile ? "100%" : "auto" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4, flex: "1 1 170px" }}>
            <span style={labelStyle}>Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Title, payee or note"
              style={fieldStyle}
            />
          </label>
          <label style={{ display: "grid", gap: 4, flex: isMobile ? "1 1 100%" : undefined }}>
            <span style={labelStyle}>Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as ExpenseStatus | "ALL")}
              style={{ ...fieldStyle, width: isMobile ? "100%" : "auto" }}
            >
              <option value="ALL">All</option>
              {EXPENSE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {EXPENSE_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, flex: isMobile ? "1 1 100%" : undefined }}>
            <span style={labelStyle}>Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              style={{ ...fieldStyle, width: isMobile ? "100%" : "auto" }}
            >
              <option value="ALL">All</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <PrimaryButton onClick={download} disabled={filtered.length === 0} tone="quiet">
            <Download size={14} /> CSV
          </PrimaryButton>
        </div>
      </FinanceCard>

      {/*
        A segmented control, as the design draws it: one `#dceae8` track with
        the active pill lifted out of it in white. Not two outlined buttons —
        the track is what says the two are alternatives.
      */}
      <div style={{ display: isMobile ? "flex" : "inline-flex", alignItems: "center", gap: 4, padding: 4, borderRadius: 999, background: "#dceae8", alignSelf: "flex-start" }}>
        {(
          [
            { key: "LEDGER", label: "Expense history", d: "M4 7h16M7 12h10M10 17h4" },
            { key: "REPORTS", label: "Reports", d: "M5 20V10M12 20V4M19 20v-7" },
          ] as const
        ).map(({ key, label, d }) => {
          const active = tab === key;
          return (
            <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={active} className="acc-press"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "9px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 700,
                cursor: "pointer", border: "none", fontFamily: "inherit",
                color: active ? "#2f7d78" : "#5b6d6b",
                background: active ? "#fff" : "transparent",
                boxShadow: active ? "0 1px 3px rgba(31,92,88,0.14)" : "none",
                flex: isMobile ? 1 : undefined,
              }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
              <span style={{ whiteSpace: "nowrap" }}>{label}</span>
            </button>
          );
        })}
      </div>

      {tab === "LEDGER" ? (
        <FinanceCard
          title="Expense history"
          hint={`${filtered.length} of ${inRange.length} in this period`}
        >
          {loading ? (
            <EmptyState>Loading the ledger.</EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState>
              {inRange.length === 0
                ? "No expenses recorded in this period."
                : "Nothing matches these filters."}
            </EmptyState>
          ) : (
            <>
              <div style={{ display: "grid", gap: 9 }}>
                {page.items.map((expense) => (
                  <article
                    key={expense.id}
                    style={{
                      borderRadius: 12,
                      border: `1px solid ${expense.status === "PENDING" ? "#ecdcae" : F.line}`,
                      background: expense.status === "PENDING" ? "#fffdf6" : F.surface,
                      padding: "12px 14px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 10,
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                      }}
                    >
                      <div style={{ display: "flex", gap: 11, minWidth: 0, flex: "1 1 220px" }}>
                        <span
                          aria-hidden
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            background: F.tealSoft,
                            color: F.teal,
                            display: "grid",
                            placeItems: "center",
                            flexShrink: 0,
                          }}
                        >
                          <Receipt size={16} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: 13.5, fontWeight: 700, color: F.ink }}>
                            {expense.title}
                          </p>
                          <p style={{ fontSize: 11.5, color: F.faint }}>
                            {expense.dayKey} · {expense.category}
                            {expense.paidBy ? ` · paid by ${expense.paidBy}` : ""}
                            {expense.paymentMethod ? ` · ${expense.paymentMethod}` : ""}
                          </p>
                          {expense.description && (
                            <p style={{ fontSize: 11.5, color: F.muted, marginTop: 3 }}>
                              {expense.description}
                            </p>
                          )}
                          {expense.decisionNote && (
                            <p style={{ fontSize: 11, color: F.muted, marginTop: 3 }}>
                              {expense.decidedByName ?? "Decision"}: {expense.decisionNote}
                            </p>
                          )}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <ExpenseStatusPill status={expense.status} />
                        <span
                          style={{
                            fontSize: 15,
                            fontWeight: 800,
                            color: expense.status === "REJECTED" ? F.faint : F.ink,
                            fontVariantNumeric: "tabular-nums",
                            textDecoration: expense.status === "REJECTED" ? "line-through" : "none",
                          }}
                        >
                          {rupees(expense.amount)}
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 7,
                        marginTop: 10,
                        alignItems: "center",
                      }}
                    >
                      {expense.receiptUrl && (
                        <a
                          href={expense.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ ...smallButton, textDecoration: "none", color: F.teal }}
                        >
                          <Paperclip size={12} /> {expense.receiptName ?? "Receipt"}
                        </a>
                      )}

                      {expense.status !== "APPROVED" && (
                        <button
                          type="button"
                          disabled={busyId === expense.id}
                          onClick={() => void decide(expense, "APPROVED")}
                          style={{ ...smallButton, color: "#1f7a52", borderColor: "#bfe3d2" }}
                        >
                          <Check size={12} /> Approve
                        </button>
                      )}
                      {expense.status !== "REJECTED" && (
                        <button
                          type="button"
                          disabled={busyId === expense.id}
                          onClick={() => void decide(expense, "REJECTED")}
                          style={{ ...smallButton, color: "#a33a29", borderColor: "#f0c4bd" }}
                        >
                          <X size={12} /> Reject
                        </button>
                      )}
                      {/*
                        **Approval and payment are separate acts**, so Pay only
                        appears once the expense is approved. An approved
                        expense is money owed; it becomes money moved when
                        somebody says which accounts funded it.
                      */}
                      {expense.status === "APPROVED" && (
                        <button
                          type="button"
                          onClick={() => setPaying(expense)}
                          style={{
                            ...smallButton,
                            color: paidOf(expense) >= expense.amount ? F.faint : "#2f7d78",
                            borderColor: paidOf(expense) >= expense.amount ? F.line : "#bfe0dc",
                          }}
                        >
                          <Wallet size={12} />
                          {paidOf(expense) >= expense.amount
                            ? "Paid"
                            : paidOf(expense) > 0
                              ? `Pay balance`
                              : "Pay from…"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditing(expense)}
                        style={smallButton}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      {isAdmin && expense.status !== "APPROVED" && (
                        <button
                          type="button"
                          disabled={busyId === expense.id}
                          onClick={() => void remove(expense)}
                          style={{ ...smallButton, color: "#a33a29" }}
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              <Pager pagination={page} variant="web" noun="expenses" />
            </>
          )}
        </FinanceCard>
      ) : (
        <>
          <FinanceCard
            title="Expenses over time"
            hint="Approved spend"
            action={
              <div style={{ display: "flex", gap: 4, background: F.hair, borderRadius: 999, padding: 3 }}>
                {(["day", "month", "year"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setGrain(value)}
                    style={{
                      borderRadius: 999,
                      border: "none",
                      background: grain === value ? F.surface : "transparent",
                      color: grain === value ? F.teal : F.muted,
                      padding: "5px 13px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {value === "day" ? "Daily" : value === "month" ? "Monthly" : "Yearly"}
                  </button>
                ))}
              </div>
            }
          >
            {byPeriod.length === 0 ? (
              <EmptyState>No approved spend in this period.</EmptyState>
            ) : (
              <>
                {trend !== null && (
                  <p
                    style={{
                      marginBottom: 12,
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: trend > 0 ? "#a33a29" : "#1f7a52",
                    }}
                  >
                    {trend > 0 ? "▲" : "▼"} {Math.abs(trend)}% against the previous{" "}
                    {grain === "day" ? "day" : grain}
                  </p>
                )}
                <div style={{ display: "grid", gap: 11 }}>
                  {byPeriod
                    .slice(-14)
                    .map((row) => (
                      <ShareBar
                        key={row.key}
                        label={row.key}
                        amount={row.amount}
                        max={Math.max(...byPeriod.map((entry) => entry.amount))}
                        hint={`${row.count} record${row.count === 1 ? "" : "s"}`}
                      />
                    ))}
                </div>
              </>
            )}
          </FinanceCard>

          <FinanceCard title="By category" hint="Approved spend only">
            {byCategory.length === 0 ? (
              <EmptyState>No approved spend to break down.</EmptyState>
            ) : (
              <div style={{ display: "grid", gap: 11 }}>
                {byCategory.map((row) => (
                  <ShareBar
                    key={row.category}
                    label={row.category}
                    amount={row.amount}
                    max={byCategory[0].amount}
                    hint={`${row.share}% · ${row.count}`}
                  />
                ))}
              </div>
            )}
          </FinanceCard>
        </>
      )}

      {(creating || editing) && (
        <ExpenseFormModal
          expense={editing}
          categories={categories}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(text) => {
            setCreating(false);
            setEditing(null);
            setBanner({ ok: true, text });
          }}
        />
      )}

      {managingCategories && (
        <ExpenseCategoriesModal
          onClose={() => setManagingCategories(false)}
          onChanged={(text) => {
            setBanner({ ok: true, text });
            reloadCategories();
          }}
        />
      )}

      {/*
        **The link the whole rebuild is for.** Choosing which accounts fund this
        expense posts one ledger transaction per account — so a 50,000 expense
        paid 30/10/10 leaves three rows and stays a 50,000 expense. If one of
        those accounts is the Committee, the Committee's statement shows its
        -10,000 named for this expense, without a line of Committee-specific
        code anywhere.
      */}
      {paying && (
        <PayFromAccounts
          open
          onClose={() => setPaying(null)}
          onPaid={(text) => setBanner({ ok: true, text })}
          accounts={ledger.accounts}
          balances={ledger.balances}
          getIdToken={getIdToken}
          source={{
            module: "OFFICE_EXPENSE",
            collection: "expenses",
            id: paying.id,
            label: paying.title,
            amount: paying.amount,
            alreadyPaid: paidOf(paying),
            direction: "OUT",
            type: "EXPENSE",
          }}
        />
      )}
    </div>
  );
}

const smallButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  borderRadius: 999,
  border: `1px solid ${F.line}`,
  background: F.surface,
  color: F.muted,
  padding: "4px 11px",
  fontSize: 11.5,
  fontWeight: 700,
  cursor: "pointer",
};

/**
 * What has already been paid against an expense.
 *
 * Records written before the ledger have no `paidAmount` at all, and an absent
 * field means nothing has been paid - not that the field is broken. The nine
 * existing expenses in the project are all in that state and keep working.
 */
function paidOf(expense: OfficeExpense & { paidAmount?: number }): number {
  return typeof expense.paidAmount === "number" ? expense.paidAmount : 0;
}
