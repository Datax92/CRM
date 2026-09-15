"use client";

/**
 * The small pieces every sheet's forms share: a labelled field, the footer's
 * two buttons, a confirmation, a status line.
 *
 * Inputs are **16px on the phone** or iOS Safari zooms the page on focus, and
 * figures are held as typed text and parsed on read, so "2." can become 2.5.
 */

import type { CSSProperties, ReactNode } from "react";
import { OverlayPanel } from "@/components/ui/OverlayPanel";
import { X, designField, designLabel } from "@/components/finance/expensesChrome";

export function fieldStyle(isMobile: boolean): CSSProperties {
  return { ...designField, fontSize: isMobile ? 16 : 13.5 };
}

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, gridColumn: wide ? "1 / -1" : undefined, minWidth: 0 }}>
      <span style={designLabel}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, fontWeight: 500, color: X.faint, lineHeight: 1.45 }}>{hint}</span>}
    </label>
  );
}

export function FormGrid({ isMobile, children }: { isMobile: boolean; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))" }}>
      {children}
    </div>
  );
}

export function FooterButtons({
  onCancel,
  onSubmit,
  busy,
  submitLabel,
  busyLabel = "Saving…",
  danger,
  disabled,
  left,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
  submitLabel: string;
  busyLabel?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Something for the far left — a Delete, a live total. */
  left?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", flexWrap: "wrap", width: "100%" }}>
      <div style={{ minWidth: 0 }}>{left}</div>
      <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
        <button
          type="button"
          onClick={onCancel}
          style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || disabled}
          style={{
            borderRadius: 10,
            border: "none",
            background: danger ? "#a8483c" : X.deep,
            color: "#fff",
            padding: "10px 20px",
            fontSize: 13.5,
            fontWeight: 700,
            cursor: busy || disabled ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            opacity: busy || disabled ? 0.55 : 1,
          }}
        >
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </div>
  );
}

export function FormError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" style={{ borderRadius: 10, border: "1px solid #f0c4bd", background: "#fdeeec", padding: "10px 12px", fontSize: 12.5, fontWeight: 600, color: "#a33a29", lineHeight: 1.5 }}>
      {text}
    </p>
  );
}

export function Notice({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p
      role="status"
      style={{
        borderRadius: 12,
        background: ok ? "#e8f5f3" : "#fdeeec",
        border: `1px solid ${ok ? "#bfe0dc" : "#f0c4bd"}`,
        padding: "11px 14px",
        fontSize: 12.5,
        fontWeight: 600,
        color: ok ? X.deep : "#a33a29",
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
}

export function ConfirmPanel({
  title,
  children,
  confirmLabel,
  busy,
  danger = true,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <OverlayPanel
      title={title}
      maxWidth={460}
      onClose={onCancel}
      footer={<FooterButtons onCancel={onCancel} onSubmit={onConfirm} busy={busy} submitLabel={confirmLabel} busyLabel="Working…" danger={danger} />}
    >
      <div style={{ fontSize: 13.5, color: X.body, lineHeight: 1.6 }}>{children}</div>
    </OverlayPanel>
  );
}

/** A glyph from an `ICON` path, sized for a pill. */
export function Glyph({ d, size = 16, width = 2 }: { d: string; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
