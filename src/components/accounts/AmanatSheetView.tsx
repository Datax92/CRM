"use client";

/**
 * Amanat (Trust & Safekeeping Sheet) — Full trust money management.
 *
 * Matches the layout and UX of other sheets (Office Expenses, Personal Expenses, Receivables).
 * **Amanat is an account** (`lib/amanatSheet`): a receipt is held in the Amanat
 * account unless another is chosen, so every "Pay from…" in the CRM can spend
 * out of it. This screen reads those accounts' statements to show what the
 * rest of the CRM has paid from Amanat — an office expense, a salary — beside
 * what was received and what was returned.
 *
 * - Stat cards: Received, Returned / Disbursed, Used for payments, Pending, In hand
 * - Record Amanat Received into the Amanat account (or another, or none)
 * - Record Amanat Expenses and pay them from ANY account via PayFromAccounts
 * - Paid from Amanat: every movement other modules made on the Amanat accounts
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  CheckCircle2,
  Clock,
  Trash2,
  Edit2,
  Info,
  Calendar,
  Landmark,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLedger, type AccountDoc } from "@/hooks/useLedger";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useAmanatEntries, useInvestmentRounds } from "@/hooks/useAccountSheets";
import { amanatOutInRounds } from "@/lib/investmentWithX";
import {
  readAmanatEntry,
  calculateAmanatTotals,
  amanatPaymentState,
  pendingOfAmanat,
  amanatUsage,
  heldInAccountId,
  AMANAT_ACCOUNT_ID,
  AMANAT_ACCOUNT_NAME,
  type AmanatEntry,
  type AmanatType,
  type AmanatPaymentState,
} from "@/lib/amanatSheet";
import { formatMoney } from "@/lib/money";
import { TRANSACTION_TYPE_LABELS } from "@/lib/ledger";
import { karachiDayKey } from "@/lib/dates";
import {
  saveAmanatEntry,
  payAmanatExpenseThroughAccounts,
  deleteAmanatEntry,
} from "@/lib/clientActions";
import { PayFromAccounts } from "./PayFromAccounts";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { Field, FormGrid, FooterButtons, FormError, ConfirmPanel, fieldStyle } from "./sheetForms";
import {
  X,
  StatCards,
  type StatCard,
} from "@/components/finance/expensesChrome";

type TabMode = "ALL" | "EXPENSES" | "RECEIVED" | "USED";
type ExpenseFilterState = "ALL" | "UNPAID" | "PART" | "PAID";

const IN_ICON = "M17 7 7 17M15 17H7V9";
const OUT_ICON = "M7 17 17 7M9 7h8v8";

export function AmanatSheetView() {
  const { role, getIdToken } = useAuth();
  const ready = role === "admin" || role === "subadmin";
  const isMobile = useIsMobile();

  const { accounts, balances, transactions } = useLedger(ready);
  const { entries, loading } = useAmanatEntries(ready);
  const { rounds } = useInvestmentRounds(ready);
  /** Each person's Amanat still out in Investment with X rounds. */
  const outInRounds = useMemo(() => amanatOutInRounds(rounds), [rounds]);

  const [tab, setTab] = useState<TabMode>("ALL");
  const [expenseFilter, setExpenseFilter] = useState<ExpenseFilterState>("ALL");
  const [search, setSearch] = useState("");

  // Modals
  const [formOpen, setFormOpen] = useState<{ open: boolean; type: AmanatType; entry?: AmanatEntry | null }>({
    open: false,
    type: "RECEIVED",
    entry: null,
  });
  const [payingExpense, setPayingExpense] = useState<AmanatEntry | null>(null);
  const [viewingDetail, setViewingDetail] = useState<AmanatEntry | null>(null);
  const [deleting, setDeleting] = useState<AmanatEntry | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const totals = useMemo(() => calculateAmanatTotals(entries), [entries]);

  // The Amanat accounts, and what the rest of the CRM has paid out of them.
  const amanatAccounts = useMemo(() => accounts.filter((a) => a.kind === "AMANAT"), [accounts]);
  const usage = useMemo(
    () => amanatUsage(new Set(amanatAccounts.map((a) => a.id)), transactions),
    [amanatAccounts, transactions]
  );
  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  /** Held on trust, less what has been used for other payments. */
  const inHand = Math.round((totals.trustBalance - usage.used) * 100) / 100;
  const usedLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return usage.lines;
    return usage.lines.filter(
      (t) => (t.sourceLabel ?? "").toLowerCase().includes(q) || (t.note ?? "").toLowerCase().includes(q)
    );
  }, [usage.lines, search]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (tab === "EXPENSES" && e.type !== "EXPENSE") return false;
      if (tab === "RECEIVED" && e.type !== "RECEIVED") return false;

      if (e.type === "EXPENSE" && expenseFilter !== "ALL") {
        const state = amanatPaymentState(e);
        if (state !== expenseFilter) return false;
      }

      if (!q) return true;
      return (
        e.party.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        (e.purpose ?? "").toLowerCase().includes(q) ||
        (e.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [entries, tab, expenseFilter, search]);

  const statCards: StatCard[] = useMemo(() => [
    {
      label: "Total Amanat Received",
      value: formatMoney(totals.totalReceived),
      note: `${entries.filter((e) => e.type === "RECEIVED").length} trust deposit${entries.filter((e) => e.type === "RECEIVED").length === 1 ? "" : "s"}`,
      pill: null,
      pct: 100,
      color: "#141f1e",
      accent: X.teal,
      icon: IN_ICON,
    },
    {
      label: "Returned / Disbursed",
      value: formatMoney(totals.totalPaid),
      note: totals.totalExpenses > 0 ? `${Math.round((totals.totalPaid / totals.totalExpenses) * 100)}% of obligations paid` : "No disbursements yet",
      pill: totals.totalExpenses > 0 ? `${Math.round((totals.totalPaid / totals.totalExpenses) * 100)}%` : null,
      pct: totals.totalExpenses > 0 ? Math.min(100, Math.round((totals.totalPaid / totals.totalExpenses) * 100)) : 0,
      color: "#b4524a",
      accent: "#c0574a",
      icon: OUT_ICON,
      tone: "bad",
    },
    {
      label: "Used For Payments",
      value: formatMoney(usage.used),
      note: usage.lines.length > 0
        ? `${usage.lines.length} payment${usage.lines.length === 1 ? "" : "s"} made from Amanat elsewhere in the CRM`
        : "Nothing paid from Amanat yet",
      pill: usage.lines.length > 0 ? `${usage.lines.length}` : null,
      pct: totals.totalReceived > 0 ? Math.max(0, Math.min(100, Math.round((usage.used / totals.totalReceived) * 100))) : 0,
      color: usage.used > 0 ? "#3f7ea3" : X.deep,
      accent: "#3f7ea3",
      icon: "M3 7h18v12H3zM16 13h2",
      onClick: () => setTab("USED"),
    },
    {
      label: "Pending To Pay",
      value: formatMoney(totals.pendingExpenses),
      note: totals.pendingCount > 0 ? `${totals.pendingCount} expense obligation${totals.pendingCount === 1 ? "" : "s"} pending` : "All obligations funded",
      pill: totals.pendingCount > 0 ? `${totals.pendingCount} pending` : "Clear",
      pct: totals.totalExpenses > 0 ? Math.min(100, Math.round((totals.pendingExpenses / totals.totalExpenses) * 100)) : 0,
      color: totals.pendingExpenses > 0 ? "#b45309" : X.deep,
      accent: "#f59e0b",
      icon: "M12 5v14M5 12h14",
      tone: totals.pendingExpenses > 0 ? "bad" : "good",
    },
    {
      label: "Amanat In Hand",
      value: formatMoney(inHand),
      note: inHand < 0
        ? "More has gone out than was received"
        : `${formatMoney(totals.trustBalance)} still owed back to the people who placed it`,
      pill: inHand >= 0 ? "In hand" : "Deficit",
      pct: totals.totalReceived > 0 ? Math.max(0, Math.min(100, Math.round((inHand / totals.totalReceived) * 100))) : 0,
      color: inHand >= 0 ? X.deep : "#b4524a",
      accent: inHand >= 0 ? X.deep : "#c0574a",
      icon: "M3 7h18v12H3zM3 11h18M7 15h4",
      tone: inHand >= 0 ? "good" : "bad",
    },
  ], [totals, entries, usage, inHand]);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.status !== "ARCHIVED"), [accounts]);

  return (
    <div style={{ fontFamily: "Manrope, var(--font-directory), system-ui, sans-serif", letterSpacing: "-0.01em", color: "#22302f" }}>
      {/* Back link */}
      <Link href="/admin/accounts" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: X.deep, textDecoration: "none", marginBottom: 12 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
        <span>All accounts</span>
      </Link>

      {/* Hero Header Banner */}
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 20, background: X.gradient, color: "#fff", padding: isMobile ? "18px 20px" : "22px 26px", marginBottom: 14 }}>
        <svg viewBox="0 0 400 170" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.16 }} aria-hidden>
          <circle cx="356" cy="20" r="78" fill="none" stroke="#fff" strokeWidth="1.2" />
          <circle cx="356" cy="20" r="120" fill="none" stroke="#fff" strokeWidth="1.2" />
          <circle cx="296" cy="162" r="54" fill="none" stroke="#fff" strokeWidth="1.2" />
        </svg>
        <div style={{ position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.42)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff" }}>
              <ShieldCheck size={26} strokeWidth={2.1} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.6px", textTransform: "uppercase", opacity: 0.76 }}>Trust & Safekeeping</div>
              <div style={{ fontSize: isMobile ? 26 : 32, fontWeight: 800, letterSpacing: "-1.2px", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>
                {formatMoney(inHand)}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 500, opacity: 0.86, marginTop: 2 }}>
                Amanat in hand · {formatMoney(totals.totalReceived)} received · {formatMoney(totals.totalPaid)} returned
                {usage.used !== 0 && ` · ${formatMoney(usage.used)} used for payments`}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setFormOpen({ open: true, type: "RECEIVED", entry: null })}
              className="acc-press"
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "11px 20px", borderRadius: 999,
                background: "rgba(255,255,255,0.22)", border: "1.5px solid rgba(255,255,255,0.55)",
                color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit"
              }}
            >
              <Plus size={16} strokeWidth={2.4} />
              <span>+ Amanat Received</span>
            </button>
            <button
              type="button"
              onClick={() => setFormOpen({ open: true, type: "EXPENSE", entry: null })}
              className="acc-press"
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "11px 22px", borderRadius: 999,
                background: "#fff", color: X.darkest, fontSize: 13.5, fontWeight: 700, cursor: "pointer", border: "none", fontFamily: "inherit"
              }}
            >
              <Plus size={16} strokeWidth={2.4} />
              <span>+ Amanat Expense</span>
            </button>
          </div>
        </div>
      </div>

      {banner && (
        <div style={{ marginBottom: 14, padding: "11px 16px", borderRadius: 12, background: "#e8f5f3", border: "1px solid #bfe0dc", color: X.deep, fontSize: 13, fontWeight: 600 }}>
          {banner}
        </div>
      )}

      {/* 4 Stat Cards */}
      <StatCards cards={statCards} isMobile={isMobile} />

      {/* The Amanat accounts — the pots every "Pay from…" in the CRM offers. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 10, marginTop: 14 }}>
        {amanatAccounts.map((account) => {
          const balance = balances.get(account.id)?.balance ?? 0;
          return (
            <Link
              key={account.id}
              href={`/admin/accounts/ledger/${account.id}`}
              className="acc-lift"
              style={{
                display: "flex", alignItems: "center", gap: 12, flex: isMobile ? "1 1 100%" : "0 1 auto", minWidth: 0,
                padding: "11px 16px", borderRadius: 14, background: "#fff", border: `1px solid ${X.line}`, textDecoration: "none",
              }}
            >
              <span style={{ width: 34, height: 34, borderRadius: 11, background: "#e8f5f3", color: X.deep, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Wallet size={16} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: X.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {account.name}{account.status === "ARCHIVED" ? " · archived" : ""}
                </span>
                <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: X.muted }}>Account · open statement</span>
              </span>
              <span style={{ marginLeft: "auto", paddingLeft: 10, fontSize: 15, fontWeight: 800, color: balance < 0 ? "#b4524a" : X.deep, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {formatMoney(balance)}
              </span>
            </Link>
          );
        })}
        <p style={{ flex: "1 1 260px", margin: 0, alignSelf: "center", fontSize: 12.5, fontWeight: 500, lineHeight: 1.5, color: X.muted }}>
          {amanatAccounts.length === 0
            ? "The Amanat account is made with the first Amanat received. From then on it is offered wherever the CRM asks which account to pay from."
            : "Amanat is offered wherever the CRM asks which account to pay from — office and personal expenses, salaries, investments. Whatever is paid from it shows under Paid from Amanat."}
        </p>
      </div>

      {/* Main Panel */}
      <div style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 18, overflow: "hidden", marginTop: 16 }}>
        {/* Navigation Tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px 0", borderBottom: `1px solid ${X.line}`, overflowX: "auto" }}>
          {([
            ["ALL", `All Movements (${entries.length})`],
            ["EXPENSES", `Amanat Expenses (${entries.filter((e) => e.type === "EXPENSE").length})`],
            ["RECEIVED", `Amanat Received (${entries.filter((e) => e.type === "RECEIVED").length})`],
            ["USED", `Paid from Amanat (${usage.lines.length})`],
          ] as const).map(([key, label]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className="acc-press"
                style={{
                  padding: "10px 16px",
                  border: "none",
                  borderBottom: active ? `3px solid ${X.deep}` : "3px solid transparent",
                  background: "transparent",
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: active ? X.deep : X.muted,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  fontFamily: "inherit",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Filter bar: Search & Expense Status Chips */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "16px 20px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 240, background: X.well, border: `1px solid ${X.line}`, borderRadius: 999, padding: "10px 16px" }}>
            <Search size={16} color={X.muted} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "USED" ? "Search what was paid..." : "Search by party, title, or purpose..."}
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 13.5, fontWeight: 500, color: "#22302f", fontFamily: "inherit" }}
            />
          </div>

          {tab === "EXPENSES" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto" }}>
              {(["ALL", "UNPAID", "PART", "PAID"] as const).map((s) => {
                const active = expenseFilter === s;
                const label = s === "ALL" ? "All Status" : s === "UNPAID" ? "Unpaid" : s === "PART" ? "Part Paid" : "Paid";
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setExpenseFilter(s)}
                    style={{
                      padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                      border: `1px solid ${active ? X.deep : X.line}`,
                      background: active ? X.deep : "#fff",
                      color: active ? "#fff" : X.muted,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Entries Table / List */}
        <div style={{ borderTop: `1px solid ${X.line}` }}>
          {tab === "USED" && usedLines.map((t) => {
            const out = t.direction === "OUT";
            return (
              <Link
                key={t.id}
                href={`/admin/accounts/ledger/${t.accountId}`}
                className="cmt-row"
                style={{
                  display: "grid", gridTemplateColumns: "42px minmax(0, 1fr) auto", alignItems: "center", gap: 14,
                  padding: "14px 20px", borderBottom: `1px solid ${X.rowLine}`, textDecoration: "none",
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", background: out ? "#eff6fb" : "#e8f5f3", color: out ? "#3f7ea3" : X.deep }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={out ? OUT_ICON : IN_ICON} />
                  </svg>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: X.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.sourceLabel || (out ? "Paid from Amanat" : "Put back into Amanat")}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: X.muted, marginTop: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.dayKey} · {TRANSACTION_TYPE_LABELS[t.type] ?? t.type} · {accountNames.get(t.accountId) ?? "Amanat"}
                    {t.note ? ` · ${t.note}` : ""}
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.4px", color: out ? "#b4524a" : X.deep, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {out ? "−" : "+"}{formatMoney(t.amount)}
                </div>
              </Link>
            );
          })}
          {tab === "USED" && usedLines.length === 0 && (
            <div style={{ padding: "50px 20px", textAlign: "center", fontSize: 13.5, fontWeight: 500, color: X.faint }}>
              {search
                ? "Nothing paid from Amanat matches your search."
                : "Nothing has been paid from Amanat yet. Choose the Amanat account under “Pay from…” on an expense, a salary or an investment and it appears here."}
            </div>
          )}

          {tab !== "USED" && filteredEntries.map((e) => {
            const isReceived = e.type === "RECEIVED";
            const state = amanatPaymentState(e);
            const pending = pendingOfAmanat(e);
            const pct = e.amount > 0 ? Math.min(100, Math.round((e.paidAmount / e.amount) * 100)) : 0;
            const heldIn = isReceived ? heldInAccountId(e, transactions) : null;
            // What is owed back stays the same; this is where that money is right now.
            const outNow = isReceived ? outInRounds.get(e.id) ?? 0 : 0;
            const inHandNow = Math.max(0, pending - outNow);
            const heldInName = heldIn ? accountNames.get(heldIn) ?? e.depositAccountName ?? "an account" : null;

            return (
              <div
                key={e.id}
                className="cmt-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile
                    ? "38px 1fr auto"
                    : "42px minmax(0, 1.4fr) 130px minmax(110px, auto) auto",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 20px",
                  borderBottom: `1px solid ${X.rowLine}`,
                }}
              >
                {/* Icon */}
                <div
                  style={{
                    width: 40, height: 40, borderRadius: 13,
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    background: isReceived ? "#e8f5f3" : "#fdf5e6",
                    color: isReceived ? X.deep : "#a5762a",
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={isReceived ? IN_ICON : OUT_ICON} />
                  </svg>
                </div>

                {/* Info */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: X.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e.party}
                    </span>
                    <span style={{
                      flexShrink: 0, padding: "2px 9px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.3px", whiteSpace: "nowrap",
                      background: isReceived
                        ? "#e8f5f3"
                        : state === "PAID"
                          ? "#e8f5f3"
                          : state === "PART"
                            ? "#eff6fb"
                            : "#fdeeec",
                      color: isReceived
                        ? X.deep
                        : state === "PAID"
                          ? X.deep
                          : state === "PART"
                            ? "#3f7ea3"
                            : "#c0574a",
                    }}>
                      {isReceived ? "Trust Received" : state === "PAID" ? "Paid" : state === "PART" ? "Part Paid" : "Unpaid"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: X.muted, marginTop: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {e.dayKey} · {e.title}
                    {e.purpose && ` · ${e.purpose}`}
                    {isReceived && (heldInName ? ` · Held in ${heldInName}` : " · Not in an account")}
                  </div>
                </div>

                {/* Progress bar on Desktop for expenses */}
                {!isMobile && (
                  <div style={{ minWidth: 0 }}>
                    {!isReceived && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, fontWeight: 600, color: X.faint }}>
                          <span>{pct}% paid</span>
                          <span>{formatMoney(e.paidAmount)}</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 999, background: X.track, overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: 999, width: `${Math.max(4, pct)}%`,
                            background: state === "PAID" ? X.deep : "#a5762a"
                          }} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Amount */}
                <div style={{ textAlign: "right", minWidth: 100 }}>
                  <div style={{
                    fontSize: 16, fontWeight: 800, letterSpacing: "-0.4px",
                    color: isReceived ? X.deep : "#b4524a",
                    fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap"
                  }}>
                    {isReceived ? `+${formatMoney(e.amount)}` : formatMoney(e.amount)}
                  </div>
                  {isReceived && outNow > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#3f7ea3", fontVariantNumeric: "tabular-nums", marginTop: 2, whiteSpace: "nowrap" }}>
                      {formatMoney(outNow)} out in rounds · {formatMoney(inHandNow)} in hand
                    </div>
                  )}
                  {!isReceived && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: state === "PAID" ? X.deep : "#b45309", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                      {state === "PAID" ? "Paid in full" : `${formatMoney(pending)} to pay`}
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, gridColumn: isMobile ? "2 / -1" : undefined }}>
                  {!isReceived && state !== "PAID" && (
                    <button
                      type="button"
                      onClick={() => setPayingExpense(e)}
                      className="acc-press"
                      style={{
                        padding: "6px 14px", borderRadius: 999, background: X.deep, color: "#fff",
                        fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none", fontFamily: "inherit"
                      }}
                    >
                      Pay from account
                    </button>
                  )}
                  {e.history && e.history.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setViewingDetail(e)}
                      className="cmt-act"
                      title="View payment history"
                      style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: X.muted, border: "none", background: "transparent" }}
                    >
                      <Info size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setFormOpen({ open: true, type: e.type, entry: e })}
                    className="cmt-act"
                    title="Edit entry"
                    style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: X.muted, border: "none", background: "transparent" }}
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(e)}
                    className="cmt-del"
                    title="Delete entry"
                    style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#c99a94", border: "none", background: "transparent" }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}

          {tab !== "USED" && filteredEntries.length === 0 && (
            <div style={{ padding: "50px 20px", textAlign: "center", fontSize: 13.5, fontWeight: 500, color: X.faint }}>
              {search ? "No Amanat entries match your search." : "No entries recorded yet. Click '+ Amanat Received' or '+ Amanat Expense' to add."}
            </div>
          )}
        </div>
      </div>

      {/* Modal: Pay Amanat Expense from ANY Account */}
      {payingExpense && (
        <PayFromAccounts
          open={!!payingExpense}
          onClose={() => setPayingExpense(null)}
          onPaid={(msg) => {
            setPayingExpense(null);
            setBanner(msg);
          }}
          accounts={activeAccounts}
          balances={balances}
          getIdToken={getIdToken}
          copy={{
            title: `Pay Amanat: ${payingExpense.title}`,
            linesTitle: "Pay from which accounts?",
            full: `Pay full amount — ${formatMoney(pendingOfAmanat(payingExpense))}`,
            part: "Record payment",
            done: "Amanat payment posted to accounts.",
          }}
          source={{
            module: "AMANAT",
            collection: "amanatEntries",
            id: payingExpense.id,
            label: `Amanat: ${payingExpense.title} (${payingExpense.party})`,
            amount: payingExpense.amount,
            alreadyPaid: payingExpense.paidAmount,
            direction: "OUT",
            type: "EXPENSE",
          }}
          submit={async ({ allocations, dayKey, note }) => {
            const token = await getIdToken();
            const res = await payAmanatExpenseThroughAccounts(token, payingExpense.id, {
              allocations,
              dayKey,
              note,
            });
            return res.ok
              ? { ok: true, fullyPaid: res.data.fullyPaid, posted: res.data.posted }
              : { ok: false, error: res.error };
          }}
        />
      )}

      {/* Modal: Add or Edit Amanat Entry */}
      {formOpen.open && (
        <AmanatFormModal
          type={formOpen.type}
          entry={formOpen.entry ?? null}
          heldIn={formOpen.entry ? heldInAccountId(formOpen.entry, transactions) : null}
          accounts={activeAccounts}
          getIdToken={getIdToken}
          onClose={() => setFormOpen({ open: false, type: "RECEIVED", entry: null })}
          onSaved={(msg) => {
            setFormOpen({ open: false, type: "RECEIVED", entry: null });
            setBanner(msg);
          }}
        />
      )}

      {/* Modal: View Payment History Details */}
      {viewingDetail && (
        <OverlayPanel
          title={viewingDetail.title}
          subtitle={`Amanat for ${viewingDetail.party} · Total ${formatMoney(viewingDetail.amount)}`}
          icon={<ShieldCheck size={18} />}
          maxWidth={500}
          onClose={() => setViewingDetail(null)}
          footer={<button type="button" onClick={() => setViewingDetail(null)} style={{ padding: "8px 18px", borderRadius: 8, background: X.deep, color: "#fff", border: "none", fontWeight: 700, cursor: "pointer", marginLeft: "auto" }}>Close</button>}
        >
          <OverlayCard title="Payment History">
            {viewingDetail.history && viewingDetail.history.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {viewingDetail.history.map((leg, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: X.well, border: `1px solid ${X.line}`, borderRadius: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: X.ink }}>{leg.accountName || "Account"}</div>
                      <div style={{ fontSize: 11.5, color: X.muted }}>{leg.dayKey} {leg.note ? `· ${leg.note}` : ""}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#b4524a" }}>
                      -{formatMoney(leg.amount)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 12.5, color: X.muted }}>No account payments recorded yet.</p>
            )}
          </OverlayCard>
        </OverlayPanel>
      )}

      {/* Modal: Confirm Delete */}
      {deleting && (
        <ConfirmPanel
          title={`Delete ${deleting.party} — ${deleting.title}?`}
          confirmLabel="Delete"
          busy={busyDelete}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            setBusyDelete(true);
            try {
              const res = await deleteAmanatEntry(await getIdToken(), deleting.id);
              if (res.ok) {
                setBanner(
                  res.data.removed > 0
                    ? `Deleted ${deleting.party} Amanat entry and took it back off the account${res.data.removed === 1 ? "" : "s"}.`
                    : `Deleted ${deleting.party} Amanat entry.`
                );
                setDeleting(null);
              } else {
                alert(res.error);
              }
            } finally {
              setBusyDelete(false);
            }
          }}
        >
          {formatMoney(deleting.amount)} · {deleting.dayKey}. This removes the entry and its rows on the accounts.
          {deleting.type === "RECEIVED"
            ? " The money comes back out of the account holding it."
            : deleting.paidAmount > 0
              ? ` The ${formatMoney(deleting.paidAmount)} paid goes back into the accounts it came from.`
              : ""}
        </ConfirmPanel>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AmanatFormModal({
  type: initialType,
  entry,
  heldIn,
  accounts,
  getIdToken,
  onClose,
  onSaved,
}: {
  type: AmanatType;
  entry: AmanatEntry | null;
  /** Where an existing receipt's money actually sits, by the ledger. */
  heldIn: string | null;
  accounts: AccountDoc[];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const isMobile = useIsMobile();
  const field = fieldStyle(isMobile);

  const [type, setType] = useState<AmanatType>(entry?.type ?? initialType);
  const [party, setParty] = useState(entry?.party ?? "");
  const [title, setTitle] = useState(entry?.title ?? (type === "RECEIVED" ? "Amanat Deposit" : "Amanat Expense"));
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [dayKey, setDayKey] = useState(entry?.dayKey ?? karachiDayKey());
  const [purpose, setPurpose] = useState(entry?.purpose ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  // A new receipt goes into the Amanat account; an existing one stays where it is.
  const [depositAccountId, setDepositAccountId] = useState(entry ? heldIn ?? "" : AMANAT_ACCOUNT_ID);
  const amanatAccounts = accounts.filter((a) => a.kind === "AMANAT");
  const otherAccounts = accounts.filter((a) => a.kind !== "AMANAT");
  const hasMainAccount = amanatAccounts.some((a) => a.id === AMANAT_ACCOUNT_ID);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReceived = type === "RECEIVED";

  const submit = async () => {
    if (!party.trim()) {
      setError("Party or person name is required.");
      return;
    }
    const numAmount = Number(String(amount).replace(/[,\s]/g, "")) || 0;
    if (numAmount <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken();
      const res = await saveAmanatEntry(
        token,
        {
          type,
          party: party.trim(),
          title: title.trim(),
          amount: numAmount,
          dayKey,
          purpose: purpose.trim() || null,
          notes: notes.trim() || null,
          depositAccountId: isReceived ? depositAccountId || null : null,
        },
        entry?.id
      );

      if (res.ok) {
        onSaved(`${party.trim()} Amanat ${entry ? "updated" : "saved"}.`);
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
      title={entry ? `Edit ${entry.party}` : isReceived ? "Record Amanat Received (Money In)" : "Record Amanat Expense (Money Out)"}
      subtitle={isReceived ? "Trust money given by a party into your custody" : "An expense or disbursement obligation to pay"}
      icon={<ShieldCheck size={18} />}
      maxWidth={560}
      onClose={onClose}
      footer={
        <FooterButtons
          onCancel={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={entry ? "Save changes" : isReceived ? "Record Received" : "Save Expense"}
        />
      }
    >
      {!entry && (
        <div style={{ display: "flex", gap: 8, padding: 4, background: X.track, borderRadius: 12 }}>
          <button
            type="button"
            onClick={() => {
              setType("RECEIVED");
              if (!title || title === "Amanat Expense") setTitle("Amanat Deposit");
            }}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 9, border: "none",
              background: type === "RECEIVED" ? "#fff" : "transparent",
              color: type === "RECEIVED" ? X.deep : X.muted,
              fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit"
            }}
          >
            Amanat Received (Money In)
          </button>
          <button
            type="button"
            onClick={() => {
              setType("EXPENSE");
              if (!title || title === "Amanat Deposit") setTitle("Amanat Expense");
            }}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 9, border: "none",
              background: type === "EXPENSE" ? "#fff" : "transparent",
              color: type === "EXPENSE" ? "#b4524a" : X.muted,
              fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit"
            }}
          >
            Amanat Expense (Money Out)
          </button>
        </div>
      )}

      <OverlayCard title={isReceived ? "Trust Receipt Details" : "Expense Obligation Details"}>
        <FormGrid isMobile={isMobile}>
          <Field label="Party / Person Name" hint="Who placed this trust, or who is it for?">
            <input
              autoFocus
              value={party}
              onChange={(e) => setParty(e.target.value)}
              placeholder="e.g. Haji Farooq, Malik Sb, Buyer"
              style={field}
            />
          </Field>
          <Field label="Total Amount (Rs)" hint="Full rupee amount">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500,000"
              style={field}
            />
          </Field>
          <Field label="Title / Description">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isReceived ? "e.g. Plot Token Trust" : "e.g. Registry fee, site repair"}
              style={field}
            />
          </Field>
          <Field label="Date">
            <input type="date" value={dayKey} onChange={(e) => setDayKey(e.target.value)} style={field} />
          </Field>

          {isReceived && (
            <Field label="Held in" hint="Money in the Amanat account can be paid from anywhere in the CRM, and this screen shows what it was used for." wide>
              <select
                value={depositAccountId}
                onChange={(e) => setDepositAccountId(e.target.value)}
                style={field}
              >
                <optgroup label="Amanat">
                  {!hasMainAccount && <option value={AMANAT_ACCOUNT_ID}>{AMANAT_ACCOUNT_NAME} account</option>}
                  {amanatAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.id === AMANAT_ACCOUNT_ID ? " account" : ""}</option>
                  ))}
                </optgroup>
                {otherAccounts.length > 0 && (
                  <optgroup label="Bank it in another account">
                    {otherAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </optgroup>
                )}
                <option value="">Not in any account (cannot be paid from)</option>
              </select>
            </Field>
          )}

          <Field label="Purpose / Category" hint="e.g. Property Deal, Safekeeping, Family" wide>
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Optional category or deal reference"
              style={field}
            />
          </Field>

          <Field label="Notes" wide>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional additional notes"
              style={field}
            />
          </Field>
        </FormGrid>
      </OverlayCard>

      <FormError text={error} />
    </OverlayPanel>
  );
}
