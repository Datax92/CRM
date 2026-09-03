"use client";

/**
 * An employee's own salary — their history and their slips, and nobody else's.
 *
 * Scoped on the server: `getPayslips` refuses another uid rather than
 * filtering, so there is no path where a mistake in this component leaks a
 * colleague's pay.
 *
 * **Only approved months appear.** A draft payroll is a working document, and
 * showing somebody a figure that HR is still adjusting would have them
 * budgeting against a number that is about to change.
 */

import { useEffect, useState } from "react";
import { FileText, Wallet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getPayslips } from "@/lib/clientActions";
import type { Payslip } from "@/app/actions/payroll";
import { computeLineTotals } from "@/lib/payroll";
import { monthLabel } from "@/lib/attendanceCalendar";
import {
  Banner,
  F,
  FinanceCard,
  EmptyState,
  Figure,
  PayrollStatusPill,
  rupees,
} from "./financeChrome";
import { PayslipPanel } from "./PayslipPanel";

export function MySalaryView({ uid, subject }: { uid?: string; subject?: string }) {
  const { getIdToken } = useAuth();
  const [slips, setSlips] = useState<Payslip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Payslip | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await getIdToken().catch(() => "");
      if (cancelled || !token) return;

      const result = await getPayslips(token, uid);
      if (cancelled) return;

      if (result.ok) {
        // A superseded slip is the record of a month that was reopened and
        // re-approved. Showing both would be two answers to one question.
        setSlips(result.data.slips.filter((slip) => slip.current));
        setError(null);
      } else {
        setSlips([]);
        setError(result.error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, getIdToken]);

  const latest = slips?.[0] ?? null;
  const yearToDate = (slips ?? [])
    .filter((slip) => slip.monthKey.startsWith(new Date().getFullYear().toString()))
    .reduce((sum, slip) => sum + computeLineTotals(slip.line).net, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section
        style={{
          borderRadius: 18,
          padding: "18px 20px",
          background: `linear-gradient(135deg, ${F.teal} 0%, ${F.tealMid} 100%)`,
          color: "#fff",
        }}
      >
        <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.7px", opacity: 0.82 }}>
          {subject ? "SALARY RECORD" : "MY SALARY"}
        </p>
        <h2 style={{ fontSize: 23, fontWeight: 800 }}>
          {subject ?? (latest ? monthLabel(latest.monthKey) : "No slips yet")}
        </h2>
        <p style={{ fontSize: 12.5, opacity: 0.9 }}>
          {latest
            ? `Latest: ${rupees(computeLineTotals(latest.line).net)} for ${monthLabel(latest.monthKey)}`
            : "Your payslip appears here once payroll for the month is approved."}
        </p>
      </section>

      {error && <Banner ok={false}>{error}</Banner>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        <Figure
          label="Latest net"
          value={latest ? rupees(computeLineTotals(latest.line).net) : "—"}
          tone="PRESENT"
        />
        <Figure label="This year" value={rupees(yearToDate)} tone="TEAL" note="net, approved months" />
        <Figure label="Slips" value={slips?.length ?? 0} />
      </div>

      <FinanceCard title="Salary history" hint="Approved months only">
        {slips === null ? (
          <EmptyState>Loading your salary history.</EmptyState>
        ) : slips.length === 0 ? (
          <EmptyState>
            No payslips yet. One appears for every month once payroll has been approved.
          </EmptyState>
        ) : (
          <div style={{ display: "grid", gap: 9 }}>
            {slips.map((slip) => {
              const totals = computeLineTotals(slip.line);
              return (
                <button
                  key={slip.id}
                  type="button"
                  onClick={() => setOpen(slip)}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    borderRadius: 12,
                    border: `1px solid ${F.line}`,
                    background: F.surface,
                    padding: "12px 14px",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
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
                      <FileText size={16} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: F.ink }}>
                        {monthLabel(slip.monthKey)}
                      </p>
                      <p style={{ fontSize: 11.5, color: F.faint }}>
                        Gross {rupees(totals.additions)}
                        {totals.deductions > 0 ? ` · ${rupees(totals.deductions)} deducted` : ""}
                        {slip.line.commission > 0
                          ? ` · ${rupees(slip.line.commission)} commission`
                          : ""}
                      </p>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <PayrollStatusPill status={slip.status} />
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        color: F.ink,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {rupees(totals.net)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </FinanceCard>

      <p style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: F.faint }}>
        <Wallet size={13} /> A slip shows the figures as they stood when the month was approved.
        Later changes to salary or attendance rules do not move it.
      </p>

      {open && (
        <PayslipPanel
          monthKey={open.monthKey}
          line={open.line}
          status={open.status}
          approvedBy={open.approvedByName}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
