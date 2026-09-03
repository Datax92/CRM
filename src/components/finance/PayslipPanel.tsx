"use client";

/**
 * A salary slip.
 *
 * The same component whether HR is looking at somebody's line or an employee
 * is looking at their own, so the two cannot show different figures for the
 * same month. It renders a **stored line**, never a recalculation — that is
 * what makes a slip from March still say what March said.
 *
 * Printing is the browser's own print dialog against a print stylesheet rather
 * than a generated PDF: a PDF library is a large dependency for a page the
 * browser already knows how to put on paper, and the artifact sandbox blocks
 * script-driven downloads anyway.
 */

import { Printer } from "lucide-react";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { computeLineTotals, PAYROLL_STATUS_LABELS, type PayrollLine, type PayrollStatus } from "@/lib/payroll";
import { monthLabel } from "@/lib/attendanceCalendar";
import { F, PayrollStatusPill, PrimaryButton, rupees } from "./financeChrome";

function Row({
  label,
  value,
  strong,
  negative,
}: {
  label: string;
  value: string;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 0",
        borderBottom: `1px solid ${F.hair}`,
      }}
    >
      <span style={{ fontSize: 12.5, color: strong ? F.ink : F.muted, fontWeight: strong ? 700 : 600 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: strong ? 14 : 13,
          fontWeight: strong ? 800 : 600,
          color: negative ? "#a33a29" : F.ink,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {negative ? `− ${value}` : value}
      </span>
    </div>
  );
}

export function PayslipPanel({
  monthKey,
  line,
  status,
  approvedBy,
  onClose,
}: {
  monthKey: string;
  line: PayrollLine;
  status: PayrollStatus;
  approvedBy?: string | null;
  onClose: () => void;
}) {
  const totals = computeLineTotals(line);

  return (
    <OverlayPanel
      title={line.name}
      subtitle={`Salary slip · ${monthLabel(monthKey)}`}
      maxWidth={620}
      onClose={onClose}
      headerAside={<PayrollStatusPill status={status} size="md" />}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: F.ink }}>
            Net {rupees(totals.net)}
          </span>
          <PrimaryButton onClick={() => window.print()} tone="quiet">
            <Printer size={14} /> Print
          </PrimaryButton>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <OverlayCard title="Employee">
          <Row label="Name" value={line.name} />
          <Row label="Role" value={line.jobTitle ?? "—"} />
          <Row label="Email" value={line.email ?? "—"} />
          <Row label="Salary month" value={monthLabel(monthKey)} />
          <Row label="Payment status" value={PAYROLL_STATUS_LABELS[status]} />
          {approvedBy && <Row label="Approved by" value={approvedBy} />}
        </OverlayCard>

        <OverlayCard title="Earnings">
          <Row label="Basic salary" value={rupees(line.basic)} />
          <Row label="Allowances" value={rupees(line.allowances)} />
          <Row label="Bonus" value={rupees(line.bonus)} />
          {line.extraAdditions > 0 && (
            <Row label="Other additions" value={rupees(line.extraAdditions)} />
          )}
          <Row label="Commission" value={rupees(line.commission)} />
          <Row label="Gross" value={rupees(totals.additions)} strong />
        </OverlayCard>

        <OverlayCard
          title="Attendance"
          hint={`${line.presentCount} worked · ${line.lateCount} late · ${line.absentCount} absent · ${line.leaveCount} leave`}
        >
          <Row
            label="Attendance deduction"
            value={rupees(line.attendanceDeduction)}
            negative={line.attendanceDeduction > 0}
          />
          <Row
            label="Other deductions"
            value={rupees(line.otherDeductions)}
            negative={line.otherDeductions > 0}
          />
          <Row label="Total deductions" value={rupees(totals.deductions)} strong negative={totals.deductions > 0} />
        </OverlayCard>

        <div
          style={{
            borderRadius: 14,
            background: `linear-gradient(135deg, ${F.teal} 0%, ${F.tealMid} 100%)`,
            color: "#fff",
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.6px", opacity: 0.9 }}>
            NET SALARY
          </span>
          <span style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            {rupees(totals.net)}
          </span>
        </div>

        {line.note && (
          <p style={{ fontSize: 12, color: F.muted, lineHeight: 1.6 }}>
            Note from payroll: {line.note}
          </p>
        )}
      </div>
    </OverlayPanel>
  );
}
