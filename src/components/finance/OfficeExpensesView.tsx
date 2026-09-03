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
  BarChart3,
  Check,
  Download,
  ListFilter,
  Paperclip,
  Pencil,
  Plus,
  Receipt,
  Tags,
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
  Figure,
  PrimaryButton,
  ShareBar,
  fieldStyle,
  labelStyle,
  rupees,
} from "./financeChrome";
import { ExpenseFormModal } from "./ExpenseFormModal";
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
      <section
        style={{
          borderRadius: 18,
          padding: "18px 20px",
          background: `linear-gradient(135deg, ${F.teal} 0%, ${F.tealMid} 100%)`,
          color: "#fff",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.7px", opacity: 0.82 }}>
            OFFICE EXPENSES
          </p>
          <h2 style={{ fontSize: 23, fontWeight: 800 }}>{rupees(summary.spend)}</h2>
          <p style={{ fontSize: 12.5, opacity: 0.9 }}>
            approved in this period · {summary.count} record{summary.count === 1 ? "" : "s"}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 9,
            flexWrap: "wrap",
            width: isMobile ? "100%" : undefined,
          }}
        >
          <button
            type="button"
            onClick={() => setManagingCategories(true)}
            style={{ ...ghostButton, flex: isMobile ? "1 1 100%" : undefined, justifyContent: "center" }}
          >
            <Tags size={14} /> Categories
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            style={{
              ...ghostButton,
              background: "#fff",
              color: F.teal,
              border: "none",
              flex: isMobile ? "1 1 100%" : undefined,
              justifyContent: "center",
            }}
          >
            <Plus size={15} /> Add expense
          </button>
        </div>
      </section>

      {banner && <Banner ok={banner.ok}>{banner.text}</Banner>}
      {error && <Banner ok={false}>{error}</Banner>}

      {/* ------------------------------------------------------------------ */}
      {/* Dashboard                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        <Figure label="Total invoiced" value={rupees(summary.total)} note="every record in range" />
        <Figure label="This month" value={rupees(monthSummary.spend)} tone="TEAL" note="approved" />
        <Figure
          label="Pending"
          value={rupees(summary.pending)}
          tone="LEAVE"
          note={`${summary.pendingCount} awaiting a decision`}
        />
        <Figure
          label="Approved"
          value={rupees(summary.approved)}
          tone="PRESENT"
          note={`${summary.approvedCount} records`}
        />
        <Figure
          label="Rejected"
          value={rupees(summary.rejected)}
          tone="ABSENT"
          note={`${summary.rejectedCount} records`}
        />
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

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(
          [
            { key: "LEDGER", label: "Expense history", icon: ListFilter },
            { key: "REPORTS", label: "Reports", icon: BarChart3 },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              borderRadius: 999,
              border: `1px solid ${tab === key ? F.teal : F.line}`,
              background: tab === key ? F.tealSoft : F.surface,
              color: tab === key ? F.teal : F.muted,
              padding: "7px 15px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
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
    </div>
  );
}

const ghostButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.5)",
  background: "rgba(255,255,255,0.18)",
  color: "#fff",
  padding: "9px 16px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

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
