"use client";

/**
 * The Day End Dashboard's visual vocabulary.
 *
 * **Every value here is taken from the design file** (`Day End Dashboard.dc.html`
 * in the Claude Design project), not estimated from a screenshot — the radii,
 * paddings, stroke widths, gradients and type sizes below are the ones the
 * design actually specifies.
 *
 * They are written as **inline styles**, not Tailwind classes. Tailwind only
 * emits an arbitrary value like `bg-[#3d8b85]` if its content scanner saw that
 * exact string in a file it was watching; a stale cache or a partial copy drops
 * the rule silently and the card renders with no background at all. This screen
 * has to be exact on machines we do not control, so nothing about it depends on
 * a build step noticing it.
 *
 * Every figure is an attainment — actual against target — so the primitives
 * take both rather than a pre-computed percentage.
 */

import type { CSSProperties, ReactNode } from "react";

/** Straight from the design file. */
export const D = {
  page: "#e9f1f0",
  ink: "#22302f",
  body: "#3c4d4b",
  muted: "#5b6d6b",
  axis: "#8fa2a0",
  monthLabel: "#7e918f",

  cardBg: "#fbfdfd",
  cardBorder: "#dceae8",
  cardRadius: 12,

  teal: "#3f8f8a",
  tealDeep: "#2f7d78",
  tealDark: "#1f5c58",
  tealLight: "#4f9c99",
  amber: "#e0b44f",
  red: "#c0574a",

  donutTrack: "#e6f1f0",
  targetTrack: "#e0eeec",
  rowDivider: "#f0f6f5",

  attendanceBg: "linear-gradient(135deg,#2f7d78 0%,#3f8f8a 100%)",
  mtdBg: "linear-gradient(135deg,#4f9c99 0%,#5aa9a5 100%)",
  ytdBg: "linear-gradient(135deg,#5fa7ab 0%,#6fb4b6 100%)",
  cardShadow: "0 8px 22px rgba(31,92,88,0.16)",
  gaugeShadow: "0 8px 22px rgba(31,92,88,0.14)",

  /** The series colours the KPI-YTD chart and its legend share. */
  series: ["#3f8f8a", "#1f4f4c", "#8cc3bf"] as const,
  /** Per-metric ring colour once the target is met. */
  kpiOnTarget: ["#3f8f8a", "#3f8f8a", "#4f9c99"] as const,

  chartHeight: 184,
  /** The chart's y-axis is fixed at 0 / 500 / 1000 in the design. */
  chartMax: 1000,
} as const;

/** `dash` in the design: the stroke-dasharray for a given percentage. */
export function dashArray(percent: number, radius: number): string {
  const circumference = 2 * Math.PI * radius;
  const shown = Math.max(0, Math.min(1, percent / 100)) * circumference;
  return `${shown} ${circumference}`;
}

const cardBase: CSSProperties = {
  background: D.cardBg,
  border: `1px solid ${D.cardBorder}`,
  borderRadius: D.cardRadius,
  minWidth: 0,
};

/** The 32px teal rounded square that heads every card. */
export function CardIcon({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        width: 32,
        height: 32,
        borderRadius: 9,
        background: D.teal,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

/** The design's own icon paths, so the glyphs match rather than approximate. */
export const TrendIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17l6-6 4 3 8-8M15 6h6v6" />
  </svg>
);

export const TargetIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3.6" />
  </svg>
);

export const BriefcaseIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round">
    <rect x="3" y="7.5" width="18" height="12.5" rx="2" />
    <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 13h18" />
  </svg>
);

export function SectionCard({
  icon,
  title,
  actions,
  children,
  padding,
  headerGap = 18,
}: {
  icon: ReactNode;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  /** The design gives each card its own bottom padding. */
  padding: string;
  headerGap?: number;
}) {
  return (
    <div style={{ ...cardBase, padding }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: actions ? "space-between" : "flex-start",
          gap: actions ? 16 : 11,
          marginBottom: headerGap,
          flexWrap: actions ? "wrap" : "nowrap",
          minWidth: 0,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <CardIcon>{icon}</CardIcon>
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "-0.2px",
              color: D.ink,
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </span>
        </span>
        {actions}
      </div>
      {children}
    </div>
  );
}

/**
 * A ring.
 *
 * The arc is clamped to one full circle but the printed number is not, so 310%
 * reads 310% over a complete ring — the design does exactly this (its Connects
 * gauge carries `pct: 100, value: "310%"`). A ring that wrapped twice would be
 * indistinguishable from 100%.
 */
export function Ring({
  percent,
  label,
  color,
  trackColor,
  viewBox,
  radius,
  strokeWidth,
  maxWidth,
  valueSize = 17,
  valueColor = D.ink,
}: {
  percent: number;
  label: string;
  color: string;
  trackColor: string;
  viewBox: number;
  radius: number;
  strokeWidth: number;
  maxWidth: number;
  valueSize?: number;
  valueColor?: string;
}) {
  const centre = viewBox / 2;

  return (
    <div style={{ position: "relative", width: "100%", maxWidth, aspectRatio: "1" }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${viewBox} ${viewBox}`} style={{ display: "block" }}>
        <circle cx={centre} cy={centre} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={dashArray(percent, radius)}
          transform={`rotate(-90 ${centre} ${centre})`}
          style={{ transition: "stroke-dasharray 600ms ease-out" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: valueSize,
          fontWeight: 700,
          letterSpacing: "-0.5px",
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {label}
      </div>
    </div>
  );
}

/** The KPI-YTD legend: a 14x4 swatch and a label per series. */
export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <>
      {items.map((item) => (
        <span
          key={item.label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 12.5,
            fontWeight: 500,
            color: D.muted,
          }}
        >
          <span style={{ width: 14, height: 4, borderRadius: 2, background: item.color }} />
          <span>{item.label}</span>
        </span>
      ))}
    </>
  );
}

export interface MonthBars {
  label: string;
  /** One value per series, in `D.series` order. */
  values: number[];
}

/**
 * The twelve-month grouped chart.
 *
 * Bars are scaled against a fixed 1000 ceiling with fixed 1000/500/0 gridlines,
 * exactly as the design does — not against the data's own peak. A chart that
 * rescaled itself each month would make two months impossible to compare.
 */
export function MonthChart({ months }: { months: MonthBars[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "38px 1fr", gap: 8 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          height: D.chartHeight,
          fontSize: 11.5,
          fontWeight: 500,
          color: D.axis,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>1000</span>
        <span>500</span>
        <span>0</span>
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            position: "relative",
            height: D.chartHeight,
            borderBottom: `1px solid ${D.cardBorder}`,
          }}
        >
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, borderTop: `1px dashed ${D.donutTrack}` }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: `1px dashed ${D.donutTrack}` }} />

          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              gridTemplateColumns: "repeat(12, 1fr)",
              alignItems: "end",
            }}
          >
            {months.map((month) => (
              <div
                key={month.label}
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  gap: 3,
                  height: "100%",
                }}
              >
                {month.values.map((value, index) => {
                  const height = Math.max(
                    value > 0 ? 3 : 1,
                    Math.round((Math.min(value, D.chartMax) / D.chartMax) * D.chartHeight)
                  );
                  return (
                    <div
                      key={index}
                      title={`${month.label} · ${value.toLocaleString()}`}
                      style={{
                        width: 7,
                        height,
                        borderRadius: "3px 3px 0 0",
                        background: value > 0 ? D.series[index] : D.donutTrack,
                        transition: "height 600ms ease-out",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(12, 1fr)",
            marginTop: 8,
            fontSize: 11.5,
            fontWeight: 500,
            color: D.monthLabel,
            textAlign: "center",
          }}
        >
          {months.map((month) => (
            <span key={month.label}>{month.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A portfolio row.
 *
 * The bar is scaled against the **largest** category, not the total — the
 * design does this so the biggest line always fills the track and the others
 * read as a proportion of it. Scaling to the total would leave every bar short
 * and the comparison harder to read.
 */
export function PortfolioRow({
  label,
  amount,
  max,
  formatValue,
}: {
  label: string;
  amount: number;
  max: number;
  formatValue: (value: number) => string;
}) {
  const filled = amount > 0;
  const width = Math.max(filled ? 4 : 0, Math.round((amount / (max || 1)) * 100));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "34px minmax(120px,0.7fr) minmax(0,1.5fr) auto",
        alignItems: "center",
        gap: 16,
        padding: "15px 2px",
        borderBottom: `1px solid ${D.rowDivider}`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 700,
          color: "#fff",
          background: filled ? D.teal : "#a9cfcc",
        }}
      >
        {label.charAt(0)}
      </span>

      <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.2px", color: D.ink }}>
        {label}
      </span>

      <div style={{ height: 7, borderRadius: 4, background: D.donutTrack, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            borderRadius: 4,
            width: `${width}%`,
            background: filled ? "linear-gradient(90deg,#3f8f8a,#5fb3ae)" : "transparent",
            transition: "width 600ms ease-out",
          }}
        />
      </div>

      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "-0.2px",
          color: D.tealDeep,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {formatValue(amount)}
      </span>
    </div>
  );
}
