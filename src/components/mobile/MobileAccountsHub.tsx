"use client";

/**
 * Accounts — the phone's financial section.
 *
 * **Replaces "Money" in the bottom bar for the admin.** Money was a hub of
 * links to reports and payouts; Accounts is where the money actually is, and it
 * is the section this product has grown around — every module now pays from the
 * same ledger, so "where did this come from and what is left" has one home.
 *
 * The slot only changes for whoever can open it. A sub admin and an employee
 * keep Money, because Accounts is admin-and-HR and a tab that lands on a
 * permission error is worse than the tab it replaced.
 *
 * **Two levels, and a way back from every one of them.** This screen lists the
 * accounts and the modules; tapping one opens it; `MobileBackBar` sits at the
 * top of every page underneath, so the phone never depends on a browser gesture
 * to get out of a section three routes deep.
 *
 * **The figures are live and cost nothing extra.** `useLedger` joins the shared
 * subscription in `lib/liveCollection` rather than opening its own, so tapping
 * in and out of the section does not re-read the ledger each time.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLedger } from "@/hooks/useLedger";
import { formatMoney, formatCompactMoney } from "@/lib/money";
import { ACCOUNT_KIND_LABELS } from "@/lib/ledger";
import { M, MobileHeader, MobileCard } from "./mobileChrome";
import { AccountButton } from "./MobileAccount";

interface Entry {
  label: string;
  detail: string;
  href: string;
  figure?: string;
  d: string;
}

/**
 * The modules, in the order the sidebar lists them.
 *
 * Deliberately the same order and the same words as the desktop menu — somebody
 * who has learnt where StateLife sits on one surface should not have to learn it
 * again on the other.
 */
const MODULES: Array<Omit<Entry, "figure" | "detail"> & { detail: string }> = [
  {
    label: "Office Expenses",
    detail: "What the company spends, and which account paid",
    href: "/admin/accounts/office-expenses",
    d: "M3 21h18M5 21V7l7-4 7 4v14M9 11h2M13 11h2M9 15h2M13 15h2",
  },
  {
    label: "Personal Expenses",
    detail: "Your own spending, and what has been paid back",
    href: "/admin/accounts/personal-expense",
    d: "M12 11a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8ZM5 20c0-3.3 3.1-5.2 7-5.2s7 1.9 7 5.2",
  },
  {
    label: "StateLife",
    detail: "Policies, and the commission slabs as they come in",
    href: "/admin/accounts/statelife",
    d: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  },
  {
    label: "Marketing Income",
    detail: "Sales, their cuts, and the profit they bank",
    href: "/admin/accounts/marketing-income",
    d: "M4 16l5-5 4 3 7-8M15 6h6v6",
  },
  {
    label: "Car Sale",
    detail: "Cars bought with partners, and what each one earned",
    href: "/admin/accounts/car-sale",
    d: "M5 17h14M6 17l-1-5 2-4h10l2 4-1 5M7.5 13.5h.01M16.5 13.5h.01",
  },
  {
    label: "Capital Investments",
    detail: "What went into a venture, and what it cost",
    href: "/admin/accounts/capital-investments",
    d: "M5 20V10M12 20V4M19 20v-7",
  },
  {
    label: "Committee",
    detail: "The pot, and what it has been spent on",
    href: "/admin/accounts/committee",
    d: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11ZM2.5 20c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5M17 5a3.2 3.2 0 0 1 0 6.4",
  },
  {
    label: "Receivable",
    detail: "Money owed to the business",
    href: "/admin/accounts/receivable",
    d: "M3 7h18v12H3zM3 11h18M7 15h4",
  },
  {
    label: "Income Sheet",
    detail: "Everything in and out, month by month",
    href: "/admin/accounts/income-sheet",
    d: "M4 7h16M7 12h10M10 17h4",
  },
];

export function MobileAccountsHub() {
  const { role } = useAuth();
  const ready = role === "admin" || role === "subadmin";
  const { accounts, balances, totalBalance, loading } = useLedger(ready);

  const open = useMemo(
    () => accounts.filter((account) => account.status !== "ARCHIVED"),
    [accounts]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", background: M.page }}>
      <MobileHeader>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.76 }}>
              Accounts
            </div>
            {/* The one number the section exists to answer. */}
            <div style={{ fontSize: 29, fontWeight: 800, letterSpacing: -1.1, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
              {loading ? "—" : formatMoney(totalBalance)}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.84, marginTop: 2 }}>
              across {open.length} account{open.length === 1 ? "" : "s"}
            </div>
          </div>
          <AccountButton />
        </div>
      </MobileHeader>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 16px calc(env(safe-area-inset-bottom, 0px) + 96px)" }}>
        <Section title="The accounts" hint={`${open.length}`}>
          {loading ? (
            <Placeholder>Loading the ledger.</Placeholder>
          ) : open.length === 0 ? (
            <Placeholder>
              No accounts yet. Create one from a Committee or a Capital Investment, and everything else can be paid from it.
            </Placeholder>
          ) : (
            open.map((account) => {
              const balance = balances.get(account.id)?.balance ?? 0;
              return (
                <Row
                  key={account.id}
                  href={`/admin/accounts/ledger/${account.id}`}
                  label={account.name}
                  detail={ACCOUNT_KIND_LABELS[account.kind]}
                  figure={formatCompactMoney(balance)}
                  negative={balance < 0}
                  d="M3 8h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM3 8V6a2 2 0 0 1 2-2h10M16 13h2"
                />
              );
            })
          )}
        </Section>

        <Section title="Where the money comes from and goes" hint={`${MODULES.length}`}>
          {MODULES.map((entry) => (
            <Row key={entry.href} href={entry.href} label={entry.label} detail={entry.detail} d={entry.d} />
          ))}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 4px 9px" }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1.3, textTransform: "uppercase", color: M.faint }}>
          {title}
        </span>
        {hint && (
          <span style={{ padding: "2px 9px", borderRadius: 999, background: "#fff", border: `1px solid ${M.cardBorder}`, fontSize: 10.5, fontWeight: 700, color: M.teal }}>
            {hint}
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{children}</div>
    </section>
  );
}

function Row({ href, label, detail, figure, negative, d }: {
  href: string; label: string; detail: string; figure?: string; negative?: boolean; d: string;
}) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <MobileCard style={{ padding: "13px 14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "38px minmax(0,1fr) auto", alignItems: "center", gap: 12 }}>
          <span aria-hidden style={{ width: 38, height: 38, borderRadius: 12, background: "#e8f5f3", color: M.teal, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {label}
            </span>
            <span style={{ display: "block", fontSize: 11.5, fontWeight: 500, color: M.faint, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {detail}
            </span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {figure && (
              <span style={{ fontSize: 14, fontWeight: 800, color: negative ? "#a8483c" : M.ink, fontVariantNumeric: "tabular-nums" }}>
                {figure}
              </span>
            )}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={M.faint} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
          </span>
        </div>
      </MobileCard>
    </Link>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <MobileCard style={{ padding: "22px 16px" }}>
      <p style={{ fontSize: 12.5, fontWeight: 500, color: M.faint, lineHeight: 1.6, textAlign: "center" }}>{children}</p>
    </MobileCard>
  );
}
