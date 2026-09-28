"use client";

/**
 * Invested Now — Active Capital Breakdown Summary.
 *
 * Transcribed and styled after the Committee Account design language
 * (`CommitteeStatement.tsx` & `AccountKindView.tsx`).
 *
 * Shows the exact answer to: "Where did the active invested money come from?"
 * Breaks down the open (unreceived) rounds by the funding accounts that provided
 * the capital (A Investor, Committee, UBL CC, Daddy Temporary, etc.).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useInvestmentBooks, useInvestmentRounds } from "@/hooks/useAccountSheets";
import { useLedger, type AccountDoc } from "@/hooks/useLedger";
import { useIsMobile } from "@/hooks/useIsMobile";
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import { ACCOUNT_KIND_LABELS, type AccountKind } from "@/lib/ledger";
import { isRoundOverdue, isRoundReceived, readFunding, type FundingLine } from "@/lib/investmentWithX";
import { EmptyState, Skeleton } from "./accountsChrome";

/* ---- tokens matching CommitteeStatement.tsx with high-contrast text ---- */
const C = {
  page: "#eef4f3",
  ink: "#141f1e",
  body: "#2d3d3b",
  muted: "#495b59",
  label: "#556e6b",
  faint: "#5e7572",
  hair: "#c3d5d3",
  line: "#d8e5e3",
  rowLine: "#edf4f3",
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

const Icon = ({ d, size = 17, w = 2.1 }: { d: string; size?: number; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);

interface ActiveFundingLeg {
  id: string;
  roundId: string;
  roundAmount: number;
  dayKey: string;
  returnDayKey: string | null;
  isOverdue: boolean;
  description: string | null;
  accountId: string;
  accountName: string;
  accountKind: AccountKind | "OTHER";
  amount: number;
  sharePct: number;
}

interface AccountSummary {
  accountId: string;
  name: string;
  kind: AccountKind | "OTHER";
  total: number;
  roundCount: number;
  pct: number;
}

export function InvestedNowSummaryView({
  bookId,
  from,
  to,
  onBack,
}: {
  bookId?: string | null;
  from?: string;
  to?: string;
  onBack?: () => void;
}) {
  const router = useRouter();
  const { role } = useAuth();
  const ready = role === "admin" || role === "subadmin";
  const isMobile = useIsMobile();
  const { books, loading: booksLoading } = useInvestmentBooks(ready);
  const { rounds: rawRounds, loading: roundsLoading } = useInvestmentRounds(ready);
  const ledger = useLedger(ready);

  const [selectedAccount, setSelectedAccount] = useState<string>("ALL");
  const [query, setQuery] = useState("");

  const book = books.find((entry) => (bookId ? entry.id === bookId : true)) ?? books[0] ?? null;

  const accountsMap = useMemo(() => {
    const map = new Map<string, AccountDoc>();
    for (const acc of ledger.accounts) {
      map.set(acc.id, acc);
    }
    return map;
  }, [ledger.accounts]);

  // Open (unreceived) rounds in this book (or all books if none selected), matching date range
  const openRounds = useMemo(() => {
    return rawRounds
      .filter((r) => (!book || r.bookId === book.id) && !isRoundReceived({ received: r.received }))
      .filter((r) => (!from || String(r.dayKey || "") >= from) && (!to || String(r.dayKey || "") <= to))
      .sort((a, b) => String(b.dayKey || "").localeCompare(String(a.dayKey || "")));
  }, [rawRounds, book, from, to]);

  const legs = useMemo<ActiveFundingLeg[]>(() => {
    const list: ActiveFundingLeg[] = [];
    const today = karachiDayKey();

    for (const round of openRounds) {
      const amount = typeof round.amount === "number" ? round.amount : 0;
      const dayKey = typeof round.dayKey === "string" ? round.dayKey : "";
      const returnDayKey = typeof round.returnDayKey === "string" ? round.returnDayKey : null;
      const isOverdue = isRoundOverdue({ received: false, returnDayKey }, today);
      const desc = typeof round.description === "string" ? round.description : null;

      const fundingLines = readFunding(round.funding);

      if (fundingLines.length === 0) {
        // Unlinked/internal funding
        list.push({
          id: `${round.id}_unlinked`,
          roundId: round.id,
          roundAmount: amount,
          dayKey,
          returnDayKey,
          isOverdue,
          description: desc,
          accountId: "unlinked",
          accountName: "Unlinked / Direct",
          accountKind: "OTHER",
          amount,
          sharePct: 100,
        });
      } else {
        for (const line of fundingLines) {
          const acc = accountsMap.get(line.accountId);
          const rawName = Array.isArray(round.funding)
            ? (round.funding as Array<{ accountId: string; accountName?: string }>).find((f) => f.accountId === line.accountId)?.accountName
            : null;
          const accountName = acc?.name ?? rawName ?? line.accountId;
          const accountKind = acc?.kind ?? "OTHER";
          const sharePct = amount > 0 ? Math.round((line.amount / amount) * 100) : 0;

          list.push({
            id: `${round.id}_${line.accountId}`,
            roundId: round.id,
            roundAmount: amount,
            dayKey,
            returnDayKey,
            isOverdue,
            description: desc,
            accountId: line.accountId,
            accountName,
            accountKind,
            amount: line.amount,
            sharePct,
          });
        }
      }
    }

    return list;
  }, [openRounds, accountsMap]);

  const totalFunded = useMemo(() => legs.reduce((s, leg) => s + leg.amount, 0), [legs]);

  const accountsSummary = useMemo<AccountSummary[]>(() => {
    const map = new Map<string, { name: string; kind: AccountKind | "OTHER"; total: number; roundIds: Set<string> }>();

    for (const leg of legs) {
      const existing = map.get(leg.accountId) ?? {
        name: leg.accountName,
        kind: leg.accountKind,
        total: 0,
        roundIds: new Set<string>(),
      };
      existing.total += leg.amount;
      existing.roundIds.add(leg.roundId);
      map.set(leg.accountId, existing);
    }

    const res: AccountSummary[] = [];
    for (const [accountId, val] of map.entries()) {
      res.push({
        accountId,
        name: val.name,
        kind: val.kind,
        total: val.total,
        roundCount: val.roundIds.size,
        pct: totalFunded > 0 ? Math.round((val.total / totalFunded) * 100) : 0,
      });
    }

    return res.sort((a, b) => b.total - a.total);
  }, [legs, totalFunded]);

  const filteredLegs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return legs.filter((leg) => {
      if (selectedAccount !== "ALL" && leg.accountId !== selectedAccount) return false;
      if (!q) return true;
      return (
        leg.accountName.toLowerCase().includes(q) ||
        (leg.description ?? "").toLowerCase().includes(q) ||
        leg.dayKey.includes(q) ||
        String(leg.amount).includes(q) ||
        String(leg.roundAmount).includes(q)
      );
    });
  }, [legs, selectedAccount, query]);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.push("/admin/accounts/investment-with-x");
    }
  };

  if (!ready) {
    return <EmptyState icon={<Icon d="M3 10 12 4l9 6M5 10v9h14v-9M9 19v-5h6v5" size={20} />} title="Access restricted" body="Capital summary is for administrators and HR." />;
  }

  if (booksLoading || roundsLoading || ledger.loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton height={140} count={1} />
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)" }}>
          <Skeleton height={100} count={3} />
        </div>
      </div>
    );
  }

  const topAccount = accountsSummary[0] ?? null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        fontFamily: "var(--font-directory), system-ui, sans-serif",
        letterSpacing: "-0.01em",
        color: "#22302f",
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
        textRendering: "optimizeLegibility",
      }}
    >
      {/* Back button */}
      <button
        type="button"
        onClick={handleBack}
        style={{
          alignSelf: "flex-start",
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          fontSize: 13,
          fontWeight: 700,
          color: C.tealInk,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          fontFamily: "inherit",
        }}
      >
        <Icon d="M19 12H5M11 6l-6 6 6 6" size={15} w={2.3} />
        <span>Back to {book?.name ?? "Investment with X"}</span>
      </button>

      {/* ---- Gradient Hero (matching Committee & Office Expenses) ---- */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 20,
          background: "linear-gradient(115deg,#1f5c58 0%,#3f8f8a 66%,#4fa39c 100%)",
          color: "#fff",
          padding: isMobile ? "20px 18px" : "24px 28px",
          boxShadow: "0 4px 20px rgba(31, 92, 88, 0.16)",
        }}
      >
        <svg viewBox="0 0 400 170" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.16 }} aria-hidden>
          <circle cx="356" cy="20" r="78" fill="none" stroke="#fff" strokeWidth="1.2" />
          <circle cx="356" cy="20" r="120" fill="none" stroke="#fff" strokeWidth="1.2" />
          <circle cx="296" cy="162" r="54" fill="none" stroke="#fff" strokeWidth="1.2" />
        </svg>

        <div style={{ position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                background: "rgba(255,255,255,0.18)",
                border: "1.5px solid rgba(255,255,255,0.42)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: "#fff",
              }}
            >
              <Icon d="M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 1 0 0 4 2 2 0 0 0 0-4" size={24} w={1.9} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.6px", textTransform: "uppercase", opacity: 0.85 }}>
                Invested Capital Summary
              </div>
              <div style={{ fontSize: isMobile ? 28 : 34, fontWeight: 800, letterSpacing: "-1.2px", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                {formatMoney(totalFunded)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.92, marginTop: 3 }}>
                {book?.name ?? "Investment with X"} · currently out across {openRounds.length} active round{openRounds.length === 1 ? "" : "s"} from {accountsSummary.length} account{accountsSummary.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={handleBack}
              className="acc-press"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                borderRadius: 999,
                background: "#fff",
                color: C.deep,
                fontSize: 13.5,
                fontWeight: 700,
                cursor: "pointer",
                border: "none",
                fontFamily: "inherit",
              }}
            >
              <Icon d="M12 5v14M5 12h14" size={15} w={2.4} />
              <span style={{ whiteSpace: "nowrap" }}>View all rounds</span>
            </button>
          </div>
        </div>
      </div>

      {/* ---- Three Stat Cards (matching CommitteeStatement.tsx) ---- */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 14 }}>
        {/* Card 1 */}
        <div className="acc-in" style={{ position: "relative", overflow: "hidden", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: C.teal }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={{ width: 30, height: 30, borderRadius: 10, background: C.tint, color: C.teal, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" size={16} w={2} />
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: C.label }}>
                Invested Now
              </span>
            </div>
            <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: C.tint, color: C.tealInk }}>
              {openRounds.length} rounds out
            </span>
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-1.2px", marginTop: 12, color: C.ink, fontVariantNumeric: "tabular-nums" }}>
            {formatMoney(totalFunded)}
          </div>
          <div style={{ height: 6, borderRadius: 999, background: C.page, marginTop: 14, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 999, width: "100%", background: C.teal }} />
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.faint, marginTop: 8 }}>
            Total money currently deployed with partner
          </div>
        </div>

        {/* Card 2 */}
        <div className="acc-in" style={{ position: "relative", overflow: "hidden", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: C.tealInk }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={{ width: 30, height: 30, borderRadius: 10, background: C.tint, color: C.tealInk, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon d="M3 10 12 4l9 6M5 10v9h14v-9M9 19v-5h6v5" size={16} w={2} />
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: C.label }}>
                Funding Sources
              </span>
            </div>
            <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: "#e8f5f3", color: C.tealInk }}>
              {accountsSummary.length} accounts
            </span>
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-1.2px", marginTop: 12, color: C.tealInk, fontVariantNumeric: "tabular-nums" }}>
            {accountsSummary.length} <span style={{ fontSize: 18, fontWeight: 700, color: C.muted }}>Accounts</span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: C.page, marginTop: 14, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 999, width: "100%", background: C.tealInk }} />
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.faint, marginTop: 8 }}>
            Investors, committees, credit cards and personal pots
          </div>
        </div>

        {/* Card 3 */}
        <div className="acc-in" style={{ position: "relative", overflow: "hidden", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "#c99a2e" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={{ width: 30, height: 30, borderRadius: 10, background: "#fdf5e6", color: "#a5762a", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" size={16} w={2} />
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: C.label }}>
                Main Provider
              </span>
            </div>
            {topAccount && (
              <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: "#fdf5e6", color: "#a5762a" }}>
                {topAccount.pct}% of total
              </span>
            )}
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.8px", marginTop: 12, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {topAccount ? topAccount.name : "None"}
          </div>
          <div style={{ height: 6, borderRadius: 999, background: C.page, marginTop: 14, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 999, width: `${topAccount?.pct ?? 0}%`, background: "#c99a2e" }} />
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.faint, marginTop: 8 }}>
            {topAccount ? `${formatMoney(topAccount.total)} in ${topAccount.roundCount} active round${topAccount.roundCount === 1 ? "" : "s"}` : "No active funding accounts"}
          </div>
        </div>
      </div>

      {/* ---- Account Cards Grid (matching AccountKindView / Committee page) ---- */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 16.5, fontWeight: 800, color: C.ink, margin: 0 }}>
              Where the Money is Taken From
            </h2>
            <p style={{ fontSize: 12.5, color: C.faint, margin: "2px 0 0 0" }}>
              Summary by source account. Click an account to filter the rounds below or jump into its full statement.
            </p>
          </div>
          {selectedAccount !== "ALL" && (
            <button
              type="button"
              onClick={() => setSelectedAccount("ALL")}
              style={{
                background: "none",
                border: "none",
                color: C.tealInk,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                padding: 0,
              }}
            >
              Clear filter
            </button>
          )}
        </div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {accountsSummary.map((acc, index) => {
            const isSelected = selectedAccount === acc.accountId;
            const kindLabel = acc.accountId === "unlinked" ? "DIRECT" : ACCOUNT_KIND_LABELS[acc.kind as AccountKind] ?? acc.kind;

            return (
              <div
                key={acc.accountId}
                className="acc-in acc-lift"
                onClick={() => setSelectedAccount((prev) => (prev === acc.accountId ? "ALL" : acc.accountId))}
                style={{
                  display: "block",
                  padding: "16px 18px",
                  cursor: "pointer",
                  borderRadius: 18,
                  border: isSelected ? `2px solid ${C.teal}` : `1px solid ${C.line}`,
                  background: isSelected ? "#f7fcfb" : "#fff",
                  boxShadow: isSelected ? "0 4px 14px rgba(63, 143, 138, 0.12)" : "0 1px 3px rgba(0, 0, 0, 0.03)",
                  animationDelay: `${Math.min(index, 7) * 35}ms`,
                  transition: "border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 24, height: 24, borderRadius: 7, background: C.tint, color: C.teal, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon d="M3 10 12 4l9 6M5 10v9h14v-9M9 19v-5h6v5" size={13} w={2} />
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.8px", textTransform: "uppercase", color: C.label }}>
                      {kindLabel}
                    </span>
                  </span>

                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 700,
                      background: isSelected ? C.teal : C.rowLine,
                      color: isSelected ? "#fff" : C.faint,
                    }}
                  >
                    {acc.pct}%
                  </span>
                </div>

                <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {acc.name}
                </div>

                <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.8px", color: C.tealInk, fontVariantNumeric: "tabular-nums", margin: "6px 0" }}>
                  {formatMoney(acc.total)}
                </div>

                {/* Progress bar of total pool */}
                <div style={{ height: 5, borderRadius: 999, background: C.page, marginTop: 8, marginBottom: 10, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 999, width: `${Math.max(4, acc.pct)}%`, background: C.teal }} />
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 9, borderTop: `1px solid ${C.rowLine}`, fontSize: 11.5 }}>
                  <span style={{ color: C.faint, fontWeight: 600 }}>
                    {acc.roundCount} active round{acc.roundCount === 1 ? "" : "s"}
                  </span>
                  {acc.accountId !== "unlinked" && (
                    <Link
                      href={`/admin/accounts/ledger/${acc.accountId}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: C.tealInk, fontWeight: 700, textDecoration: "none" }}
                    >
                      Statement →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- Statement Table Panel (exact CommitteeStatement style) ---- */}
      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, overflow: "hidden", marginTop: 4 }}>
        {/* Search header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "16px 20px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 240, background: C.field, border: `1px solid ${C.line}`, borderRadius: 999, padding: "10px 16px" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.label} strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by account name, amount, or date…"
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 13, fontWeight: 500, color: "#22302f", fontFamily: "inherit" }}
            />
          </div>
        </div>

        {/* Account chips */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 20px 16px", overflowX: "auto" }}>
          <button
            type="button"
            onClick={() => setSelectedAccount("ALL")}
            className="acc-press"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              flexShrink: 0,
              padding: "8px 16px",
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              border: `1px solid ${selectedAccount === "ALL" ? C.teal : C.line}`,
              background: selectedAccount === "ALL" ? C.teal : "#fff",
              color: selectedAccount === "ALL" ? "#fff" : C.muted,
            }}
          >
            <span>All Sources ({formatMoney(totalFunded)})</span>
          </button>

          {accountsSummary.map((acc) => {
            const active = selectedAccount === acc.accountId;
            return (
              <button
                key={acc.accountId}
                type="button"
                onClick={() => setSelectedAccount(acc.accountId)}
                className="acc-press"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  flexShrink: 0,
                  padding: "8px 16px",
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  border: `1px solid ${active ? C.teal : C.line}`,
                  background: active ? C.teal : "#fff",
                  color: active ? "#fff" : C.muted,
                }}
              >
                <span>
                  {acc.name} ({formatMoney(acc.total)})
                </span>
              </button>
            );
          })}
        </div>

        {/* Table summary subheader */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            padding: "12px 20px",
            background: C.tint,
            borderTop: `1px solid ${C.hair}`,
            borderBottom: `1px solid ${C.line}`,
            fontSize: 12,
            fontWeight: 700,
            color: C.tealInk,
          }}
        >
          <span>
            {filteredLegs.length} round allocation{filteredLegs.length === 1 ? "" : "s"}
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            Total: {formatMoney(filteredLegs.reduce((s, l) => s + l.amount, 0))}
          </span>
        </div>

        {/* List of active allocations */}
        {filteredLegs.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: C.faint, fontSize: 13.5 }}>
            No funding records match this filter.
          </div>
        ) : (
          <div>
            {filteredLegs.map((leg, index) => {
              const borderBottom = index < filteredLegs.length - 1 ? `1px solid ${C.rowLine}` : "none";

              return (
                <div
                  key={leg.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    padding: "15px 20px",
                    borderBottom,
                    background: "#fff",
                    flexWrap: isMobile ? "wrap" : "nowrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 0 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        background: C.tint,
                        color: C.teal,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      <Icon d="M4 16l5-5 4 3 7-8M15 6h6v6" size={17} w={2} />
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: C.ink }}>
                          Taken from <strong style={{ color: C.tealInk }}>{leg.accountName}</strong>
                        </span>
                        {leg.accountKind !== "OTHER" && (
                          <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", padding: "2px 7px", borderRadius: 6, background: C.page, color: C.faint }}>
                            {ACCOUNT_KIND_LABELS[leg.accountKind as AccountKind] ?? leg.accountKind}
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: 12, color: C.faint, marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span>Round of {formatMoney(leg.roundAmount)}</span>
                        <span>·</span>
                        <span>Out on {leg.dayKey}</span>
                        {leg.returnDayKey && (
                          <>
                            <span>·</span>
                            <span style={{ color: leg.isOverdue ? C.spendInk : C.faint, fontWeight: leg.isOverdue ? 700 : 500 }}>
                              Returns {leg.returnDayKey} {leg.isOverdue ? "(Overdue)" : ""}
                            </span>
                          </>
                        )}
                        {leg.description && (
                          <>
                            <span>·</span>
                            <span style={{ color: C.muted }}>{leg.description}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: isMobile ? 52 : 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(leg.amount)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.faint }}>
                        {leg.sharePct}% of round
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#e8f5f3", color: C.tealInk }}>
                        Active with partner
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
