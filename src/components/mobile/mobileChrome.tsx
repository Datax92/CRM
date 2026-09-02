"use client";

/**
 * Shared phone-layout primitives, built to `Day End Dashboard Mobile.dc.html`
 * and `Active Leads Mobile.dc.html`.
 *
 * Every value in `M` is lifted from those files rather than estimated — the
 * radii, the `rgba(255,255,255,0.14)` header wells, the 26px header corner,
 * the 52px centre action. Two rounds were lost earlier on this project to
 * building a screen from a screenshot, so nothing here is guessed.
 *
 * **Inline styles, not Tailwind.** Same reason as the desktop dashboard: a
 * content scanner that never saw a `bg-[#3f8f8a]` string emits no rule and the
 * element renders with no background at all. Inline styles cannot be missed.
 *
 * **The mockups' phone frame is not reproduced.** The `.dc.html` files draw a
 * 390×844 rounded rectangle with a 9:41 clock, signal bars and a home
 * indicator, because that is how a design file shows a phone. Rendering those
 * inside a real app would put a second, permanently-wrong status bar under the
 * device's own. The frame is replaced by the real thing: `env(safe-area-inset-*)`
 * padding, so the teal header flows under the notch and the tab bar clears the
 * home indicator on the actual hardware.
 */

import type { CSSProperties, ReactNode } from "react";

export const M = {
  /* ---- ground ---- */
  page: "#e9f1f0",
  cardBg: "#fbfdfd",
  cardBorder: "#dceae8",

  /* ---- ink ---- */
  ink: "#22302f",
  body: "#3c4d4b",
  muted: "#5b6d6b",
  faint: "#8fa2a0",
  fainter: "#9aacaa",
  ghost: "#a9bcba",

  /* ---- teal ---- */
  teal: "#3f8f8a",
  tealDeep: "#2f7d78",
  tealDark: "#1f5c58",
  tealTint: "#e8f5f3",
  track: "#e6f1f0",
  trackFlat: "#eef4f3",
  segmentBg: "#dceae8",
  divider: "#f0f6f5",

  /* ---- state ---- */
  amber: "#c99a2e",
  amberInk: "#a5762a",
  amberBg: "#fdf5e6",
  amberBorder: "#f0e0c0",
  red: "#c0574a",
  redSoft: "#e05a4a",
  blue: "#3f7ea3",
  blueBg: "#eef6fb",
  blueBorder: "#cfe2ee",

  /* ---- geometry, straight from the design ---- */
  headerRadius: 26,
  cardRadius: 20,
  rowRadius: 18,
  fieldRadius: 14,
  sheetRadius: 28,
  centreAction: 52,

  /* ---- header wells ---- */
  wellBg: "rgba(255,255,255,0.14)",
  wellBorder: "rgba(255,255,255,0.2)",
  searchBg: "rgba(255,255,255,0.16)",
  searchBorder: "rgba(255,255,255,0.22)",
  circleBg: "rgba(255,255,255,0.18)",
} as const;

/** `dash` from both design files: stroke-dasharray for a percentage. */
export function dash(percent: number, radius: number): string {
  const c = 2 * Math.PI * radius;
  return `${Math.max(0, Math.min(1, percent / 100)) * c} ${c}`;
}

/**
 * The teal header. `border-radius:0 0 26px 26px` in both files, and it must
 * extend under the status bar — hence the safe-area padding rather than a
 * fixed top inset.
 */
export function MobileHeader({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: M.teal,
        color: "#fff",
        borderRadius: `0 0 ${M.headerRadius}px ${M.headerRadius}px`,
        padding: "calc(env(safe-area-inset-top, 0px) + 14px) 20px 18px",
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A round 38px header control — bell, filter, avatar. */
export function HeaderCircle({
  children,
  onClick,
  label,
  filled,
  size = 38,
}: {
  children: ReactNode;
  onClick?: () => void;
  label?: string;
  filled?: boolean;
  size?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        border: "none",
        padding: 0,
        flexShrink: 0,
        background: filled ? "#fff" : M.circleBg,
        color: filled ? M.tealDeep : "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        fontWeight: 700,
        cursor: onClick ? "pointer" : "default",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

/** The white card both screens repeat. */
export function MobileCard({
  children,
  style,
  radius = M.cardRadius,
}: {
  children: ReactNode;
  style?: CSSProperties;
  radius?: number;
}) {
  return (
    <div
      style={{
        background: M.cardBg,
        border: `1px solid ${M.cardBorder}`,
        borderRadius: radius,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The pill segmented control — MTD/YTD on the dashboard, Follow-ups/Audit/Deal
 * on the lead detail. `background:#dceae8` with the active pill filled.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  variant = "teal",
  style,
}: {
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  /** `teal` fills the active pill teal; `white` fills it white (lead detail). */
  variant?: "teal" | "white";
  style?: CSSProperties;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: variant === "white" ? 4 : 3,
        borderRadius: 999,
        background: M.segmentBg,
        ...style,
      }}
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.key)}
            style={{
              flex: variant === "white" ? 1 : undefined,
              textAlign: "center",
              border: "none",
              padding: variant === "white" ? "9px 6px" : "6px 16px",
              borderRadius: 999,
              fontSize: variant === "white" ? 12.5 : 12,
              fontWeight: 700,
              letterSpacing: variant === "white" ? "-0.1px" : "0.4px",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
              color: active ? M.tealDeep : M.muted,
              background: active ? (variant === "white" ? "#fff" : M.teal) : "transparent",
              // Only the pill's own paint animates — no layout, so this stays
              // cheap on a low-end phone.
              transition: "background-color 160ms ease, color 160ms ease",
              ...(active && variant === "teal" ? { color: "#fff" } : null),
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A progress track. Used by targets, portfolio and the KPI bars. */
export function Meter({
  percent,
  fill,
  height = 9,
  track = M.trackFlat,
  minWidth = 2,
}: {
  percent: number;
  fill: string;
  height?: number;
  track?: string;
  minWidth?: number;
}) {
  return (
    <div style={{ height, borderRadius: 999, background: track, overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          borderRadius: 999,
          width: `${Math.max(minWidth, Math.min(100, percent))}%`,
          background: fill,
          transition: "width 420ms cubic-bezier(0.22,0.61,0.36,1)",
        }}
      />
    </div>
  );
}
