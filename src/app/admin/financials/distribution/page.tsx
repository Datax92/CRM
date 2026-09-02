"use client";

/**
 * Profit Distribution — the admin's queue of deals awaiting a split (§12–§21).
 *
 * The workflow §23 describes ends here: an employee closes a deal, the admin is
 * notified, and this is where the notification lands. **A deal leaves this
 * screen when it is finalised** and becomes part of the permanent record in
 * Closed Deals.
 *
 * The recently-settled list is kept below the queue rather than moved out
 * entirely, for one reason: Reopen. An admin who typed 20% instead of 2% needs
 * a way back, and it belongs beside the thing it undoes — not on the historical
 * record, where a button that rewrites history would be exactly the wrong
 * affordance.
 *
 * **A deal closed before this feature existed counts as waiting.** Its
 * `distributionStatus` is absent, and reading absence as "finalised" would
 * quietly hide every historical deal from the only screen that can split it.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useFinancials, type DealRecord } from "@/hooks/useFinancials";
import { useEmployees, useSubAdmins } from "@/hooks/useEmployees";
import { useAllDistributions } from "@/hooks/useDistributions";
import { resolveRange, formatBusinessDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { describeLeadSource } from "@/lib/leadSource";
import { reopenProfitDistribution } from "@/lib/clientActions";
import { Banner, FullPageSpinner } from "@/components/admin/AdminShared";
import {
  ProfitDistributionModal,
  DistributionSummaryCard,
} from "@/components/financials/ProfitDistributionModal";
import { PieChart, Clock, CheckCircle2, ArrowRight, Wallet } from "lucide-react";

const T = {
  ink: "#1f3b39",
  muted: "#5b6d6b",
  faint: "#9aacaa",
  line: "#dceae8",
  hair: "#f0f6f5",
  surface: "#ffffff",
  teal: "#2f7d78",
  tealSoft: "#e2f0ee",
  amber: "#a4682a",
  amberSoft: "#fdf1e3",
};

const ALL_TIME = resolveRange("ALL");

/** Absent means pending — see the note at the top of this file. */
const isSettled = (deal: DealRecord) => deal.distributionStatus === "FINALIZED";

export default function ProfitDistributionPage() {
  const { role, loading: authLoading, getIdToken } = useAuth();
  useProtectedRoute(["admin"]);
  const isAdmin = role === "admin";

  const { deals, loading } = useFinancials(ALL_TIME, isAdmin);
  const { employees } = useEmployees(isAdmin);
  const { subAdmins } = useSubAdmins(isAdmin);
  const { distributions } = useAllDistributions(isAdmin);

  const [active, setActive] = useState<DealRecord | null>(null);
  const [banner, setBanner] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const { pending, settled } = useMemo(() => {
    const pending: DealRecord[] = [];
    const settled: DealRecord[] = [];
    for (const deal of deals) (isSettled(deal) ? settled : pending).push(deal);
    return { pending, settled };
  }, [deals]);

  const nameOf = useMemo(() => new Map(employees.map((p) => [p.uid, p.name])), [employees]);
  const currentFor = (dealId: string) =>
    distributions.find((row) => row.dealId === dealId && row.current) ?? null;

  const reopen = async (deal: DealRecord) => {
    setBusy(true);
    try {
      const result = await reopenProfitDistribution(await getIdToken(), deal.id);
      setBanner(
        result.ok
          ? {
              tone: "success",
              text: `${deal.customer?.name ?? "That deal"} is back in the queue. The previous split is kept on record.`,
            }
          : { tone: "error", text: result.error }
      );
    } catch {
      setBanner({ tone: "error", text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || (isAdmin && loading)) return <FullPageSpinner />;
  if (!isAdmin) return null;

  const pendingProfit = pending.reduce((total, deal) => total + (deal.profit ?? 0), 0);
  // Only the handful the admin might still want to undo. The rest live in
  // Closed Deals, which is the record rather than the workspace.
  const recentlySettled = settled.slice(0, 5);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "26px clamp(16px, 3vw, 28px) 40px" }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            aria-hidden
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              borderRadius: 14,
              background: T.tealSoft,
              color: T.teal,
            }}
          >
            <PieChart size={20} />
          </span>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: T.ink }}>Profit Distribution</h1>
            <p style={{ fontSize: 13, color: T.faint }}>
              {pending.length} deal{pending.length === 1 ? "" : "s"} awaiting a split ·{" "}
              {formatMoney(pendingProfit)} of unallocated profit
            </p>
          </div>
        </div>

        <Link
          href="/admin/financials/deals"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            borderRadius: 999,
            border: `1px solid ${T.line}`,
            background: T.surface,
            padding: "9px 15px",
            fontSize: 13,
            fontWeight: 600,
            color: T.teal,
          }}
        >
          <Wallet size={14} /> Closed Deals <ArrowRight size={13} />
        </Link>
      </header>

      {banner && <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />}

      <Section icon={<Clock size={14} />} title="Awaiting distribution" count={pending.length}>
        {pending.length === 0 ? (
          <Empty>
            Every closed deal has been split. New ones appear here as soon as they are entered, and
            move to Closed Deals once finalised.
          </Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pending.map((deal) => (
              <article
                key={deal.id}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  borderRadius: 14,
                  border: `1px solid ${T.line}`,
                  background: T.surface,
                  padding: "14px 16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: "1 1 240px" }}>
                  <span
                    aria-hidden
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: T.amberSoft,
                      color: T.amber,
                      fontSize: 13,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {(deal.customer?.name ?? "?").slice(0, 2).toUpperCase()}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: T.ink,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {deal.customer?.name ?? "Client"}
                    </p>
                    <p
                      style={{
                        fontSize: 11.5,
                        color: T.faint,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {nameOf.get(deal.userId ?? "") ?? "Unknown employee"} · {describeLeadSource(deal)}
                      {deal.dealDate ? ` · ${formatBusinessDate(deal.dealDate)}` : ""}
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 18, flexShrink: 0 }}>
                  <div style={{ textAlign: "right" }}>
                    <p
                      style={{
                        fontSize: 10.5,
                        letterSpacing: "0.6px",
                        textTransform: "uppercase",
                        color: T.faint,
                      }}
                    >
                      Net profit
                    </p>
                    <p
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: T.teal,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatMoney(deal.profit)}
                    </p>
                  </div>

                  <button
                    onClick={() => setActive(deal)}
                    style={{
                      background: T.teal,
                      color: "#fff",
                      borderRadius: 999,
                      padding: "10px 18px",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Finalize Profit Distribution
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section
        icon={<CheckCircle2 size={14} />}
        title="Recently settled"
        count={settled.length}
        action={
          settled.length > recentlySettled.length ? (
            <Link href="/admin/financials/deals" style={{ fontSize: 12, color: T.teal }}>
              See all {settled.length} in Closed Deals →
            </Link>
          ) : undefined
        }
      >
        {recentlySettled.length === 0 ? (
          <Empty>Nothing has been split yet.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recentlySettled.map((deal) => {
              const distribution = currentFor(deal.id);
              return (
                <article
                  key={deal.id}
                  style={{
                    borderRadius: 14,
                    border: `1px solid ${T.line}`,
                    background: T.surface,
                    padding: "14px 16px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>
                        {deal.customer?.name ?? "Client"}
                      </p>
                      <p style={{ fontSize: 11.5, color: T.faint }}>
                        {nameOf.get(deal.userId ?? "") ?? "Unknown employee"} · net{" "}
                        {formatMoney(deal.profit)}
                      </p>
                    </div>
                  </div>

                  {distribution ? (
                    <DistributionSummaryCard
                      lines={distribution.lines}
                      netProfit={distribution.netProfit}
                      companyTotalAmount={distribution.companyTotalAmount}
                      remainingAmount={distribution.remainingAmount}
                      onReopen={busy ? undefined : () => reopen(deal)}
                    />
                  ) : (
                    <Empty>Marked settled, but the distribution record could not be read.</Empty>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Section>

      {active && (
        <ProfitDistributionModal
          deal={active}
          employees={employees}
          subAdmins={subAdmins}
          getIdToken={getIdToken}
          onClose={() => setActive(null)}
          onDone={(message) => {
            setActive(null);
            setBanner({ tone: "success", text: message });
          }}
        />
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 26 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          marginBottom: 11,
        }}
      >
        <h2
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: "0.7px",
            textTransform: "uppercase",
            color: T.muted,
          }}
        >
          <span style={{ color: T.teal }} aria-hidden>
            {icon}
          </span>
          {title}
          <span
            style={{ background: T.tealSoft, color: T.teal, borderRadius: 999, padding: "1px 8px", fontSize: 11 }}
          >
            {count}
          </span>
        </h2>
        {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        borderRadius: 14,
        border: `1px dashed ${T.line}`,
        background: "rgba(255,255,255,0.7)",
        padding: "26px 20px",
        textAlign: "center",
        fontSize: 13,
        color: T.faint,
      }}
    >
      {children}
    </p>
  );
}
