"use client";

/**
 * Shared chrome for Salary/Payroll and Office Expenses.
 *
 * The colour tokens are **imported from the attendance module rather than
 * restated**. Both modules are the same product and the same teal, and a
 * second copy of `#2f7d78` is how two screens end up almost matching. The card
 * and figure primitives are re-exported for the same reason: these screens sit
 * beside the attendance ones in the sidebar, and they should not look like a
 * different application.
 *
 * What is new here are the two status pills, because a payroll status and an
 * expense status carry meanings attendance has no equivalent of.
 */

import {
  A,
  AttendanceCard,
  EmptyState,
  Figure,
} from "@/components/attendance/attendanceChrome";
import {
  PAYROLL_STATUS_LABELS,
  type PayrollStatus,
} from "@/lib/payroll";
import { EXPENSE_STATUS_LABELS, type ExpenseStatus } from "@/lib/officeExpenses";

export const F = A;
export { AttendanceCard as FinanceCard, EmptyState, Figure };

interface Tone {
  soft: string;
  border: string;
  text: string;
  solid: string;
}

/**
 * Draft is quiet, Reviewed is in progress, Approved is a decision, Paid is
 * done. The ramp deliberately gets stronger left to right, so a glance down a
 * column of months says how far each one got without reading a word.
 */
const PAYROLL_TONES: Record<PayrollStatus, Tone> = {
  DRAFT: { soft: "#f2f6f6", border: "#dceae8", text: "#5b6d6b", solid: "#9aacaa" },
  REVIEWED: { soft: "#eef6fb", border: "#cfe2ee", text: "#3f7ea3", solid: "#4d86a8" },
  APPROVED: { soft: "#e4f3ec", border: "#bfe3d2", text: "#1f7a52", solid: "#2f9e68" },
  PAID: { soft: "#e2f0ee", border: "#bcdcd8", text: "#1f5c58", solid: "#2f7d78" },
};

const EXPENSE_TONES: Record<ExpenseStatus, Tone> = {
  PENDING: { soft: "#fdf5e0", border: "#ecdcae", text: "#8a6a17", solid: "#d9ad2b" },
  APPROVED: { soft: "#e4f3ec", border: "#bfe3d2", text: "#1f7a52", solid: "#2f9e68" },
  REJECTED: { soft: "#fdeeeb", border: "#f0c4bd", text: "#a33a29", solid: "#c0503c" },
};

function Pill({ tone, label, size }: { tone: Tone; label: string; size: "sm" | "md" }) {
  const medium = size === "md";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: tone.soft,
        color: tone.text,
        padding: medium ? "4px 12px" : "2px 9px",
        fontSize: medium ? 12 : 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: 999, background: tone.solid, flexShrink: 0 }}
      />
      {label}
    </span>
  );
}

export function PayrollStatusPill({
  status,
  size = "sm",
}: {
  status: PayrollStatus;
  size?: "sm" | "md";
}) {
  return <Pill tone={PAYROLL_TONES[status]} label={PAYROLL_STATUS_LABELS[status]} size={size} />;
}

export function ExpenseStatusPill({
  status,
  size = "sm",
}: {
  status: ExpenseStatus;
  size?: "sm" | "md";
}) {
  return <Pill tone={EXPENSE_TONES[status]} label={EXPENSE_STATUS_LABELS[status]} size={size} />;
}

/** Rupees, grouped, no decimals — payroll and expenses are whole-rupee here. */
export function rupees(amount: number | null | undefined): string {
  return `Rs ${Math.round(Number(amount) || 0).toLocaleString("en-PK")}`;
}

/** A message with the same weight on every finance screen. */
export function Banner({
  ok,
  children,
}: {
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <p
      role={ok ? "status" : "alert"}
      style={{
        borderRadius: 12,
        padding: "10px 14px",
        fontSize: 13,
        fontWeight: 600,
        border: `1px solid ${ok ? "#bfe3d2" : "#f0c4bd"}`,
        background: ok ? "#e4f3ec" : "#fdeeeb",
        color: ok ? "#1f7a52" : "#a33a29",
      }}
    >
      {children}
    </p>
  );
}

/**
 * A horizontal bar for a category or a period.
 *
 * The bar is a share of the **largest** row, not of the total: with ten
 * categories every bar would otherwise be a sliver, and the chart would carry
 * no information the numbers beside it do not already.
 */
export function ShareBar({
  label,
  amount,
  max,
  hint,
}: {
  label: string;
  amount: number;
  max: number;
  hint?: string;
}) {
  const width = max <= 0 ? 0 : Math.max(2, Math.round((amount / max) * 100));

  return (
    <div style={{ display: "grid", gap: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: F.ink,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: F.muted,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {rupees(amount)}
          {hint ? <span style={{ color: F.faint, fontWeight: 600 }}> · {hint}</span> : null}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: F.hair, overflow: "hidden" }}>
        <div
          style={{
            width: `${width}%`,
            height: "100%",
            borderRadius: 999,
            background: `linear-gradient(90deg, ${F.teal}, ${F.tealMid})`,
          }}
        />
      </div>
    </div>
  );
}

export const fieldStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: `1px solid ${F.line}`,
  background: "#fff",
  color: F.ink,
  padding: "9px 11px",
  // 16px, or iOS Safari zooms the page on focus and leaves the user somewhere
  // they did not ask to be.
  fontSize: 16,
  fontWeight: 600,
  outline: "none",
};

export const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.6px",
  textTransform: "uppercase",
  color: F.faint,
};

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
      <span style={labelStyle}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: F.faint }}>{hint}</span>}
    </label>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  tone = "teal",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "teal" | "quiet" | "danger";
}) {
  const palette =
    tone === "quiet"
      ? { background: F.surface, color: F.muted, border: `1px solid ${F.line}` }
      : tone === "danger"
        ? { background: "#fff", color: "#a33a29", border: "1px solid #f0c4bd" }
        : { background: F.teal, color: "#fff", border: "none" };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        borderRadius: 999,
        padding: "9px 18px",
        fontSize: 13,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        whiteSpace: "nowrap",
        ...palette,
      }}
    >
      {children}
    </button>
  );
}
