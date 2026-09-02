"use client";

/**
 * Money — the phone's financial section (§3, §4).
 *
 * Replaces the bottom bar's "Reports" slot. Reports was one screen among
 * several; a phone bar has five slots and one of them should open the whole
 * money side of the product, not a single report.
 *
 * **A hub, not a dashboard.** Every destination here already exists and works;
 * this screen's whole job is to be a legible way in on a small screen, so it is
 * cards with a figure and a sentence rather than a squeezed copy of the desktop
 * ledgers. Nothing is duplicated — each card is a link to the real page.
 *
 * The list is role-scoped, and the scoping is honest: a manager sees their own
 * and their team's earnings, an employee sees only their own commission, and
 * neither is shown a card that would land on a permission error.
 *
 * Built from `mobileChrome`'s `M` tokens and `MobileHeader`/`MobileCard`, so it
 * reads as part of the phone app rather than a new design.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useFinancials } from "@/hooks/useFinancials";
import { useMyPayouts } from "@/hooks/useDistributions";
import { resolveRange } from "@/lib/dates";
import { formatCompactMoney } from "@/lib/money";
import { M, MobileHeader, MobileCard } from "./mobileChrome";

const ALL_TIME = resolveRange("ALL");

interface Destination {
  label: string;
  detail: string;
  href: string;
  /** A live number where one is cheap and meaningful; omitted otherwise. */
  figure?: string;
  /** 24×24 path data, in the flat outline style the rest of the phone uses. */
  d: string;
  /** Draws attention: something is waiting for this person to act. */
  urgent?: boolean;
}

export function MoneyHub() {
  const { role, user } = useAuth();
  const isAdmin = role === "admin";
  const isManager = role === "admin" || role === "subadmin";

  // The admin's cards carry real figures because the deals query is already
  // open for them elsewhere; nobody else's cards claim numbers they cannot
  // cheaply and correctly produce.
  const { deals } = useFinancials(ALL_TIME, isAdmin);
  const { payouts } = useMyPayouts(user?.uid, role === "subadmin" ? "team" : "self", !isAdmin);

  const totals = useMemo(() => {
    const settled = deals.filter((deal) => deal.distributionStatus === "FINALIZED");
    const awaiting = deals.filter((deal) => deal.distributionStatus !== "FINALIZED");
    return {
      settled: settled.length,
      awaiting: awaiting.length,
      awaitingProfit: awaiting.reduce((sum, deal) => sum + (deal.profit ?? 0), 0),
      revenue: deals.reduce((sum, deal) => sum + (deal.amountReceived ?? 0), 0),
      mine: payouts
        .filter((payout) => payout.recipientUid === user?.uid)
        .reduce((sum, payout) => sum + payout.amount, 0),
      team: payouts.reduce((sum, payout) => sum + payout.amount, 0),
    };
  }, [deals, payouts, user?.uid]);

  const destinations: Destination[] = isAdmin
    ? [
        {
          label: "Profit Distribution",
          detail: totals.awaiting
            ? `${totals.awaiting} deal${totals.awaiting === 1 ? "" : "s"} waiting to be split`
            : "Everything closed has been split",
          figure: totals.awaiting ? formatCompactMoney(totals.awaitingProfit) : undefined,
          href: "/admin/financials/distribution",
          urgent: totals.awaiting > 0,
          d: "M12 3v9l7 4M21 12a9 9 0 1 1-9-9",
        },
        {
          label: "Closed Deals",
          detail: `${totals.settled} settled · full record of each deal`,
          figure: formatCompactMoney(totals.revenue),
          href: "/admin/financials/deals",
          d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 12l2.5 2.5 4.5-5",
        },
        {
          label: "Office Expenses",
          detail: "What the business spent",
          href: "/admin/financials/expenses",
          d: "M3 8h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM3 8V6a2 2 0 0 1 2-2h10M16 13h2",
        },
        {
          label: "Reports",
          detail: "Employee and campaign performance",
          href: "/admin/financials/reports",
          d: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4",
        },
        {
          label: "Income Sheet",
          detail: "Every revenue and expense line",
          href: "/admin/accounts/income-sheet",
          d: "M4 19h16M7 16V9M12 16V5M17 16v-4",
        },
        {
          label: "Receivables",
          detail: "What is still owed",
          href: "/admin/accounts/receivable",
          d: "M4 6h16v12H4zM4 10h16M8 14h4",
        },
        {
          label: "Investments",
          detail: "Committee, capital and investment ledgers",
          href: "/admin/accounts/investment",
          d: "M4 19h16M6 16V8M11 16V4M16 16v-6M21 16v-3",
        },
      ]
    : isManager
      ? [
          {
            label: "My Earnings",
            detail: "Your share of every finalised deal",
            figure: formatCompactMoney(totals.mine),
            href: "/subadmin/earnings",
            d: "M3 8h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM3 8V6a2 2 0 0 1 2-2h10M16 13h2",
          },
          {
            label: "Team Earnings",
            detail: "What your team has been paid",
            figure: formatCompactMoney(totals.team),
            href: "/subadmin/earnings",
            d: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11ZM2.5 20c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5M17 5a3.2 3.2 0 0 1 0 6.4",
          },
          {
            label: "Team Performance",
            detail: "Leads, deals and revenue per employee",
            href: "/subadmin/team",
            d: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4",
          },
        ]
      : [
          {
            label: "My Earnings",
            detail: "Your commission on the deals you closed",
            figure: formatCompactMoney(totals.mine),
            href: "/employee/earnings",
            d: "M3 8h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM3 8V6a2 2 0 0 1 2-2h10M16 13h2",
          },
          {
            label: "My Deals & Stats",
            detail: "What you have closed, and your KPI",
            href: "/employee/performance/stats",
            d: "M4 19h16M7 16V9M12 16V5M17 16v-4",
          },
        ];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <MobileHeader>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "1.1px", opacity: 0.78 }}>
          {isAdmin ? "FINANCIALS" : "YOUR MONEY"}
        </div>
        <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-0.3px", marginTop: 2 }}>Money</h1>
        <p style={{ fontSize: 12.5, fontWeight: 500, opacity: 0.85, marginTop: 4 }}>
          {isAdmin
            ? "Settle deals, split profit, and read the books."
            : "Your share of what the team has closed."}
        </p>
      </MobileHeader>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "16px 16px 24px" }}>
        {destinations.map((destination, index) => (
          <Link key={`${destination.label}-${destination.href}`} href={destination.href} style={{ display: "block" }}>
            <MobileCard
              radius={M.rowRadius}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: "15px 16px",
                // Only the first eight stagger: past that the delay outlasts
                // the scroll and the list reads as laggy.
                animation: index < 8 ? `mob-rise 320ms ${index * 40}ms both` : undefined,
                ...(destination.urgent ? { borderColor: M.amberBorder, background: M.amberBg } : null),
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 42,
                  height: 42,
                  borderRadius: 13,
                  flexShrink: 0,
                  background: destination.urgent ? "#f7ead0" : M.tealTint,
                  color: destination.urgent ? M.amberInk : M.tealDeep,
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={destination.d} />
                </svg>
              </span>

              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: M.ink }}>
                  {destination.label}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 500,
                    color: M.fainter,
                    marginTop: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {destination.detail}
                </span>
              </span>

              {destination.figure && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: destination.urgent ? M.amberInk : M.tealDeep,
                    fontVariantNumeric: "tabular-nums",
                    flexShrink: 0,
                  }}
                >
                  {destination.figure}
                </span>
              )}

              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke={M.ghost}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
                aria-hidden
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </MobileCard>
          </Link>
        ))}
      </div>
    </div>
  );
}
