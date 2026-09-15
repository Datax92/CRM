"use client";

/**
 * **Pay the period's total** — every unpaid expense on screen, at once, from
 * one or more accounts.
 *
 * A strip under the hero that says what is owed ("Rs 1,24,300 unpaid · 14
 * expenses in this period") and opens the **same** split control a single
 * expense uses (`PayFromAccounts`), handed a submit that calls
 * `payExpensesTotal`. One control, so paying one bill and paying the month
 * cannot validate differently, and the total's lines are still "which accounts,
 * how much".
 *
 * Income accounts are offered first — Car Sale, Marketing, an investment's
 * profit — because that is where the owner pays the month from. Any account may
 * still be chosen.
 *
 * Absent when nothing in the period is unpaid, rather than a button that could
 * only be refused.
 */

import { useState } from "react";
import { PayFromAccounts } from "./PayFromAccounts";
import { payExpensesTotal } from "@/lib/clientActions";
import { formatMoney } from "@/lib/money";
import { X } from "@/components/finance/expensesChrome";
import type { AccountDoc } from "@/hooks/useLedger";

export interface PayableRow {
  id: string;
  amount: number;
  paid: number;
}

export function PayPeriodTotal({
  kind,
  rows,
  periodLabel,
  accounts,
  balances,
  getIdToken,
  isMobile,
  onPaid,
}: {
  kind: "OFFICE" | "PERSONAL";
  /** Only the rows that may be paid — approved, for office expenses. */
  rows: PayableRow[];
  periodLabel: string;
  accounts: AccountDoc[];
  balances: Map<string, { balance: number }>;
  getIdToken: () => Promise<string>;
  isMobile: boolean;
  onPaid: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const unpaid = rows.filter((row) => row.amount - row.paid > 0.004);
  const total = Math.round(unpaid.reduce((sum, row) => sum + (row.amount - row.paid), 0) * 100) / 100;
  if (unpaid.length === 0 || total <= 0) return null;

  // Income accounts first — where a month is normally paid from.
  const ordered = [...accounts].sort(
    (a, b) => Number(b.kind === "INCOME") - Number(a.kind === "INCOME") || a.name.localeCompare(b.name)
  );
  const noun = kind === "PERSONAL" ? "personal expense" : "office expense";

  return (
    <>
      <section
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "stretch" : "center",
          justifyContent: "space-between",
          gap: 12,
          background: "#fff",
          border: `1px solid ${X.line}`,
          borderLeft: `4px solid ${X.teal}`,
          borderRadius: 16,
          padding: isMobile ? "14px 16px" : "13px 18px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>
            Unpaid · {periodLabel}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 3 }}>
            <span style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.6px", color: X.ink, fontVariantNumeric: "tabular-nums" }}>
              {formatMoney(total)}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: X.muted }}>
              across {unpaid.length} {noun}{unpaid.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="acc-press"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            borderRadius: 999,
            border: "none",
            background: X.deep,
            color: "#fff",
            padding: "11px 20px",
            fontSize: 13.5,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 7h18v12H3zM3 11h18M7 15h4" />
          </svg>
          Pay total
        </button>
      </section>

      {open && (
        <PayFromAccounts
          open
          onClose={() => setOpen(false)}
          onPaid={onPaid}
          accounts={ordered}
          balances={balances}
          getIdToken={getIdToken}
          source={{
            module: kind === "PERSONAL" ? "PERSONAL_EXPENSE" : "OFFICE_EXPENSE",
            collection: kind === "PERSONAL" ? "personalExpenses" : "expenses",
            id: "period-total",
            label: `${unpaid.length} ${noun}${unpaid.length === 1 ? "" : "s"} · ${periodLabel}`,
            amount: total,
            alreadyPaid: 0,
            direction: "OUT",
            type: kind === "PERSONAL" ? "REIMBURSEMENT" : "EXPENSE",
          }}
          submit={async ({ allocations, dayKey, note }) => {
            const result = await payExpensesTotal(await getIdToken(), {
              kind,
              ids: unpaid.map((row) => row.id),
              allocations,
              dayKey,
              note,
            });
            return result.ok
              // `posted` is read as "from N accounts" by the panel's message.
              ? { ok: true, fullyPaid: result.data.fullyPaid, posted: allocations.length }
              : { ok: false, error: result.error };
          }}
        />
      )}
    </>
  );
}
