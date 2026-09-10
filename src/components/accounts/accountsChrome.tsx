"use client";

/**
 * The Accounts section's visual language.
 *
 * One place for the tokens, the semantic colours, the cards, the trend
 * indicator, the skeletons and the empty states — so the eight screens under
 * Accounts look like one product rather than eight, and so the phone versions
 * cannot drift from the desktop ones.
 *
 * It sits **on top of** `employees/directoryChrome`'s palette rather than
 * beside it: same greys, same teal, same rounding. Accounts adds the money
 * semantics the rest of the CRM has no need for.
 */

import type { CSSProperties, ReactNode } from "react";
import {
  ArrowDownRight, ArrowUpRight, Minus, Landmark, Banknote, Wallet,
  Users2, TrendingUp, CircleDollarSign,
} from "lucide-react";
import { E } from "@/components/employees/directoryChrome";
import { formatMoney } from "@/lib/money";
import type { AccountKind } from "@/lib/ledger";

/** Accounts' own tokens. Everything else comes from `E`. */
export const A = {
  ...E,
  /** Money in, approved, positive. */
  positive: "#1f7a52",
  positiveBg: "#eaf6f0",
  /** Money out, rejected, negative. */
  negative: "#b4443a",
  negativeBg: "#fdeeec",
  /** Waiting on somebody. */
  pending: "#9a7420",
  pendingBg: "#fdf7e7",
  /** Transfers and anything purely informational. */
  neutral: "#4d6b86",
  neutralBg: "#eef3f8",
  /** The glass panel: a hair of translucency over the page ground. */
  glass: "rgba(255,255,255,0.72)",
  glassBorder: "rgba(226,236,234,0.9)",
} as const;

export const CARD: CSSProperties = {
  borderRadius: 16,
  border: `1px solid ${A.glassBorder}`,
  background: A.glass,
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
};

/** An icon per account kind, so a card is recognisable before it is read. */
export const ACCOUNT_ICONS: Record<AccountKind, typeof Landmark> = {
  BANK: Landmark,
  CASH: Banknote,
  WALLET: Wallet,
  INVESTMENT: TrendingUp,
  COMMITTEE: Users2,
  OTHER: CircleDollarSign,
};

/* -------------------------------------------------------------------------- */
/* Trend                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The ↑ / ↓ / → beside a figure.
 *
 * **Never colour alone.** Each direction carries its own arrow and, where there
 * is a percentage, its own words — so the meaning survives a monochrome screen
 * and a colour-blind reader. `changePct: null` renders the arrow and no
 * number, because a comparison that does not exist must not be implied.
 */
export function Trend({
  direction, changePct, note, size = 12,
}: {
  direction: "up" | "down" | "flat";
  changePct?: number | null;
  note?: string;
  size?: number;
}) {
  const tone = direction === "up" ? A.positive : direction === "down" ? A.negative : A.faint;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  const label = direction === "up" ? "increase" : direction === "down" ? "decrease" : "no change";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: size, fontWeight: 700, color: tone }}>
      <Icon size={size + 1} aria-hidden />
      <span className="sr-only">{label}</span>
      {changePct !== null && changePct !== undefined && (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.abs(changePct).toFixed(1)}%</span>
      )}
      {note && <span style={{ fontWeight: 600, color: A.faint }}>{note}</span>}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

const STATUS_TONES: Record<string, { fg: string; bg: string }> = {
  PAID: { fg: A.positive, bg: A.positiveBg },
  APPROVED: { fg: A.positive, bg: A.positiveBg },
  POSTED: { fg: A.positive, bg: A.positiveBg },
  REIMBURSED: { fg: A.positive, bg: A.positiveBg },
  PENDING: { fg: A.pending, bg: A.pendingBg },
  SUBMITTED: { fg: A.pending, bg: A.pendingBg },
  PARTIALLY_PAID: { fg: A.pending, bg: A.pendingBg },
  UNPAID: { fg: A.faint, bg: A.field },
  DRAFT: { fg: A.faint, bg: A.field },
  REJECTED: { fg: A.negative, bg: A.negativeBg },
  CANCELLED: { fg: A.faint, bg: A.field },
  VOIDED: { fg: A.faint, bg: A.field },
  TRANSFER: { fg: A.neutral, bg: A.neutralBg },
};

/** A status, as a word in its own colour — the word is what carries it. */
export function StatusPill({ status, small }: { status: string; small?: boolean }) {
  const tone = STATUS_TONES[status] ?? { fg: A.faint, bg: A.field };
  return (
    <span
      style={{
        display: "inline-block", borderRadius: 999,
        padding: small ? "2px 8px" : "3px 10px",
        fontSize: small ? 10 : 10.5, fontWeight: 800, letterSpacing: 0.3,
        color: tone.fg, background: tone.bg, whiteSpace: "nowrap",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary card                                                                */
/* -------------------------------------------------------------------------- */

export function SummaryCard({
  label, value, icon, tone, direction, changePct, comparison, mobile,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: string;
  direction?: "up" | "down" | "flat";
  changePct?: number | null;
  comparison?: string;
  mobile?: boolean;
}) {
  return (
    <div style={{ ...CARD, padding: mobile ? "13px 14px" : "15px 17px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span style={{ display: "inline-flex", width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", background: A.tint, color: tone ?? A.tealInk, flexShrink: 0 }}>
          {icon}
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: A.faint, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {label}
        </span>
      </div>
      <p style={{ fontSize: mobile ? 18 : 21, fontWeight: 800, color: tone ?? A.ink, fontVariantNumeric: "tabular-nums", letterSpacing: -0.4 }}>
        {formatMoney(value)}
      </p>
      {direction && (
        <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          <Trend direction={direction} changePct={changePct} />
          {/* Only rendered when there is something real to compare against. */}
          {comparison && changePct !== null && changePct !== undefined && (
            <span style={{ fontSize: 10.5, color: A.faint, fontWeight: 600 }}>{comparison}</span>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading and empty                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A skeleton the exact height of what it replaces, so the page does not jump
 * when the data lands.
 */
export function Skeleton({ height = 76, radius = 16, count = 1 }: { height?: number; radius?: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          aria-hidden
          className="acc-shimmer"
          style={{ height, borderRadius: radius, background: A.field, border: `1px solid ${A.softBorder}` }}
        />
      ))}
      <span className="sr-only">Loading…</span>
    </>
  );
}

/**
 * An empty state that says what would appear here and offers the way to make
 * it happen — never a blank table.
 */
export function EmptyState({
  icon, title, body, action, mobile,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  mobile?: boolean;
}) {
  return (
    <div style={{ ...CARD, padding: mobile ? "28px 20px" : "38px 26px", textAlign: "center" }}>
      <span
        style={{
          display: "inline-flex", width: 46, height: 46, borderRadius: 14,
          alignItems: "center", justifyContent: "center",
          background: A.tint, color: A.teal, marginBottom: 12,
        }}
      >
        {icon}
      </span>
      <p style={{ fontSize: 15, fontWeight: 700, color: A.ink }}>{title}</p>
      <p style={{ fontSize: 12.5, color: A.faint, marginTop: 5, maxWidth: 380, marginInline: "auto", lineHeight: 1.5 }}>{body}</p>
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons and chips                                                           */
/* -------------------------------------------------------------------------- */

export function Button({
  children, onClick, primary, icon, disabled, full,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  icon?: ReactNode;
  disabled?: boolean;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="acc-press"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        width: full ? "100%" : undefined,
        borderRadius: 11,
        border: primary ? "none" : `1px solid ${A.border}`,
        background: primary ? `linear-gradient(135deg, ${A.teal}, ${A.tealInk})` : A.surface,
        color: primary ? "#fff" : A.tealInk,
        padding: "10px 16px", fontSize: 13, fontWeight: 700,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
        fontFamily: "inherit",
        boxShadow: primary ? "0 1px 2px rgba(31,92,88,0.25)" : "none",
      }}
    >
      {icon}{children}
    </button>
  );
}

/** A filter chip. Active carries a tint *and* a tick, never colour alone. */
export function Chip({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="acc-press"
      style={{
        borderRadius: 999,
        border: `1px solid ${active ? A.teal : A.border}`,
        background: active ? A.tealTint : A.surface,
        color: active ? A.deep : A.muted,
        padding: "6px 13px", fontSize: 12, fontWeight: 700,
        cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
      }}
    >
      {active ? "✓ " : ""}{label}
    </button>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "18px 0 10px" }}>
      <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: A.faint }}>{children}</h2>
      {action}
    </div>
  );
}
