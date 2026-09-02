"use client";

/**
 * The four Analytics panels — KPI rings, Activity by Month, Target Achieved and
 * Lead Outcomes — drawn once for both the desktop dossier and the phone
 * overlay.
 *
 * The two design files draw the same four panels at different sizes (62px rings
 * against 56px, a 172px plot against 132px), so the geometry is a `variant`
 * rather than a second component. Two copies would let a win rate on the phone
 * disagree with the one on the desktop.
 *
 * Inline styles for the reason recorded in CLAUDE.md: a Tailwind arbitrary
 * value the content scanner never saw emits no rule, and the element renders
 * with no background at all.
 */

import type { ReactNode } from "react";
import { E, Bar, Card, ringDash, type DirectoryAnalytics, type ActivityEntry } from "./directoryChrome";

type Variant = "web" | "mobile";

interface Geometry {
  ring: number;
  ringRadius: number;
  ringStroke: number;
  ringValue: number;
  cardRadius: number;
  cardPad: string;
  title: number;
  chartHeight: number;
  barWidth: number;
  barGap: number;
  axisWidth: number;
  gap: number;
  ink: string;
}

const GEOMETRY: Record<Variant, Geometry> = {
  web: {
    ring: 62,
    ringRadius: 26,
    ringStroke: 7,
    ringValue: 13.5,
    cardRadius: 16,
    cardPad: "16px 18px",
    title: 15.5,
    chartHeight: 172,
    barWidth: 16,
    barGap: 7,
    axisWidth: 30,
    gap: 14,
    ink: E.ink,
  },
  mobile: {
    ring: 56,
    ringRadius: 23,
    ringStroke: 6.5,
    ringValue: 12.5,
    cardRadius: 18,
    cardPad: "14px 15px",
    title: 14.5,
    chartHeight: 132,
    barWidth: 12,
    barGap: 4,
    axisWidth: 24,
    gap: 12,
    ink: E.inkMobile,
  },
};

/** Leads / Deals-won, the two series both charts plot. */
const SERIES = [
  { label: "Leads", color: E.teal },
  { label: "Deals won", color: E.deep },
];

export function AnalyticsPanels({
  analytics,
  handled,
  variant,
}: {
  analytics: DirectoryAnalytics;
  handled: number;
  variant: Variant;
}) {
  const g = GEOMETRY[variant];

  return (
    <div style={{ display: "grid", gap: g.gap }}>
      {/* ---- KPI rings ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            variant === "web" ? "repeat(auto-fit, minmax(200px,1fr))" : "minmax(0,1fr)",
          gap: variant === "web" ? 14 : 10,
        }}
      >
        {analytics.kpis.map((kpi) => (
          <Card
            key={kpi.label}
            radius={g.cardRadius}
            style={{
              padding: g.cardPad,
              display: "grid",
              gridTemplateColumns: `${g.ring}px minmax(0,1fr)`,
              alignItems: "center",
              gap: variant === "web" ? 15 : 14,
            }}
          >
            <div style={{ position: "relative", width: g.ring, height: g.ring, flexShrink: 0 }}>
              <svg
                width={g.ring}
                height={g.ring}
                viewBox={`0 0 ${g.ring} ${g.ring}`}
                style={{ display: "block" }}
                aria-hidden
              >
                <circle
                  cx={g.ring / 2}
                  cy={g.ring / 2}
                  r={g.ringRadius}
                  fill="none"
                  stroke={E.page}
                  strokeWidth={g.ringStroke}
                />
                <circle
                  cx={g.ring / 2}
                  cy={g.ring / 2}
                  r={g.ringRadius}
                  fill="none"
                  stroke={kpi.color}
                  strokeWidth={g.ringStroke}
                  strokeLinecap="round"
                  // The arc is clamped to one full circle while the printed
                  // number is not — a ring that wrapped twice would be
                  // indistinguishable from 100%.
                  strokeDasharray={ringDash(kpi.pct, g.ringRadius)}
                  transform={`rotate(-90 ${g.ring / 2} ${g.ring / 2})`}
                  style={{ transition: "stroke-dasharray 520ms cubic-bezier(0.22,0.61,0.36,1)" }}
                />
              </svg>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: g.ringValue,
                  fontWeight: 800,
                  letterSpacing: "-0.4px",
                  color: g.ink,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {kpi.value}
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: variant === "web" ? 10 : 9.5,
                  fontWeight: 700,
                  letterSpacing: "1.1px",
                  textTransform: "uppercase",
                  color: variant === "web" ? E.label : E.faint,
                }}
              >
                {kpi.label}
              </div>
              <div
                style={{
                  fontSize: variant === "web" ? 14 : 13.5,
                  fontWeight: 700,
                  color: g.ink,
                  marginTop: variant === "web" ? 5 : 4,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {kpi.detail}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 500, color: E.faint, marginTop: 2 }}>
                {kpi.note}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* ---- Activity by Month ---- */}
      <Card
        radius={g.cardRadius}
        style={{ padding: variant === "web" ? "20px 22px 18px" : "16px 16px 14px" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: variant === "web" ? 14 : 12,
            flexWrap: "wrap",
          }}
        >
          <PanelTitle variant={variant}>Activity by Month</PanelTitle>
          <div style={{ display: "flex", alignItems: "center", gap: variant === "web" ? 16 : 12 }}>
            {SERIES.map((series) => (
              <div
                key={series.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: variant === "web" ? 7 : 6,
                  fontSize: variant === "web" ? 12 : 11,
                  fontWeight: 600,
                  color: "#7e918f",
                }}
              >
                <span
                  style={{
                    width: variant === "web" ? 13 : 11,
                    height: 4,
                    borderRadius: 2,
                    background: series.color,
                  }}
                />
                <span style={{ whiteSpace: "nowrap" }}>
                  {variant === "web" ? series.label : series.label === "Deals won" ? "Won" : series.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `${g.axisWidth}px 1fr`,
            gap: variant === "web" ? 10 : 8,
            marginTop: variant === "web" ? 18 : 14,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              height: g.chartHeight,
              fontSize: variant === "web" ? 11 : 10.5,
              fontWeight: 600,
              color: E.faint,
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>{analytics.max}</span>
            <span>{Math.round(analytics.max / 2)}</span>
            <span>0</span>
          </div>

          <div>
            <div style={{ position: "relative", height: g.chartHeight, borderBottom: "1px solid #e6efee" }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, borderTop: `1px dashed ${E.page}` }} />
              <div style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: `1px dashed ${E.page}` }} />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  gridTemplateColumns: "repeat(6, 1fr)",
                  alignItems: "end",
                }}
              >
                {analytics.months.map((month, index) => (
                  <div
                    key={`${month.label}-${index}`}
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                      gap: g.barGap,
                      height: "100%",
                    }}
                  >
                    {[
                      { value: month.leads, color: E.teal, name: "Leads" },
                      { value: month.won, color: E.deep, name: "Deals won" },
                    ].map((bar) => (
                      <div
                        key={bar.name}
                        title={`${bar.name}: ${bar.value}`}
                        style={{
                          width: g.barWidth,
                          borderRadius: variant === "web" ? "5px 5px 0 0" : "4px 4px 0 0",
                          // A zero month still draws a 4px stub, so the column
                          // reads as "nothing here" rather than as missing.
                          height:
                            bar.value > 0
                              ? Math.max(
                                  variant === "web" ? 8 : 7,
                                  Math.round((bar.value / analytics.max) * g.chartHeight)
                                )
                              : 4,
                          background: bar.value > 0 ? bar.color : "#e9f1f0",
                          transition: "height 480ms cubic-bezier(0.22,0.61,0.36,1)",
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, 1fr)",
                marginTop: variant === "web" ? 10 : 9,
                fontSize: variant === "web" ? 11.5 : 11,
                fontWeight: 600,
                color: E.label,
                textAlign: "center",
              }}
            >
              {analytics.months.map((month, index) => (
                <span key={`${month.label}-label-${index}`}>{month.label}</span>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* ---- Target Achieved + Lead Outcomes ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            variant === "web" ? "repeat(auto-fit, minmax(300px,1fr))" : "minmax(0,1fr)",
          gap: variant === "web" ? 14 : 12,
          alignItems: "start",
        }}
      >
        <Card radius={g.cardRadius} style={{ padding: variant === "web" ? "20px 22px" : 16 }}>
          <PanelTitle variant={variant}>Target Achieved</PanelTitle>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: variant === "web" ? 18 : 16,
              marginTop: variant === "web" ? 16 : 14,
            }}
          >
            {analytics.targets.map((target) => (
              <div key={target.label}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <span
                    style={{
                      fontSize: variant === "web" ? 11 : 10.5,
                      fontWeight: 700,
                      letterSpacing: "1.1px",
                      textTransform: "uppercase",
                      color: variant === "web" ? E.label : E.faint,
                    }}
                  >
                    {target.label}
                  </span>
                  <span
                    style={{
                      fontSize: variant === "web" ? 16 : 15,
                      fontWeight: 800,
                      letterSpacing: "-0.4px",
                      color: target.color,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {target.value}
                  </span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <Bar percent={target.pct} fill={target.fill} height={9} />
                </div>
                <div
                  style={{
                    fontSize: variant === "web" ? 11.5 : 11,
                    fontWeight: 500,
                    color: E.faint,
                    marginTop: 6,
                  }}
                >
                  {target.note}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          radius={g.cardRadius}
          style={{ padding: variant === "web" ? "20px 22px 10px" : "16px 16px 6px" }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <PanelTitle variant={variant}>Lead Outcomes</PanelTitle>
            <span
              style={{
                fontSize: variant === "web" ? 11.5 : 11,
                fontWeight: 600,
                color: E.faint,
                whiteSpace: "nowrap",
              }}
            >
              {handled} total
            </span>
          </div>
          {analytics.outcomes.map((outcome) => (
            <div
              key={outcome.label}
              style={{
                display: "grid",
                gridTemplateColumns:
                  variant === "web" ? "minmax(86px,auto) 1fr 26px" : "minmax(78px,auto) 1fr 24px",
                alignItems: "center",
                gap: variant === "web" ? 12 : 11,
                padding: variant === "web" ? "12px 0" : "11px 0",
                borderBottom: `1px solid ${E.rowBorder}`,
              }}
            >
              <span
                style={{
                  fontSize: variant === "web" ? 13 : 12.5,
                  fontWeight: 600,
                  color: E.body,
                  whiteSpace: "nowrap",
                }}
              >
                {outcome.label}
              </span>
              <Bar
                percent={outcome.pct}
                // An empty outcome shows an empty track, not a stub of colour
                // that would read as a small count.
                fill={outcome.count > 0 ? outcome.color : "transparent"}
                height={variant === "web" ? 8 : 7}
                minWidth={outcome.count > 0 ? 5 : 0}
              />
              <span
                style={{
                  fontSize: variant === "web" ? 13.5 : 13,
                  fontWeight: 700,
                  color: g.ink,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {outcome.count}
              </span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function PanelTitle({ children, variant }: { children: ReactNode; variant: Variant }) {
  return (
    <span
      style={{
        fontSize: GEOMETRY[variant].title,
        fontWeight: 800,
        letterSpacing: "-0.3px",
        color: GEOMETRY[variant].ink,
      }}
    >
      {children}
    </span>
  );
}

/**
 * The Activity feed. Web puts the timestamp in a right-hand column; the phone
 * stacks it under the detail, because a 390px row cannot hold
 * "26 Aug 2026, 11:15 am" beside a lead name without crushing one of them.
 */
export function ActivityFeed({
  entries,
  variant,
  formatWhen,
}: {
  entries: ActivityEntry[];
  variant: Variant;
  formatWhen: (at: Date | null) => string;
}) {
  const g = GEOMETRY[variant];
  const size = variant === "web" ? 40 : 38;

  if (entries.length === 0) {
    return <EmptyPanel>No activity recorded for this employee yet.</EmptyPanel>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {entries.map((entry, index) => (
        <Card
          key={`${entry.action}-${index}`}
          radius={variant === "web" ? 14 : 18}
          style={{
            display: "grid",
            gridTemplateColumns:
              variant === "web" ? `${size}px minmax(0,1fr) auto` : `${size}px minmax(0,1fr)`,
            alignItems: variant === "web" ? "center" : "start",
            gap: variant === "web" ? 16 : 13,
            padding: variant === "web" ? "14px 18px" : "14px 15px",
          }}
        >
          <div
            style={{
              width: size,
              height: size,
              borderRadius: 13,
              background: E.tint,
              color: E.tealInk,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width={variant === "web" ? 18 : 17}
              height={variant === "web" ? 18 : 17}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d={entry.icon} />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: variant === "web" ? 14.5 : 14,
                fontWeight: 700,
                letterSpacing: "-0.3px",
                color: g.ink,
                textWrap: "pretty",
              }}
            >
              {entry.action}
            </div>
            <div
              style={{
                fontSize: variant === "web" ? 12.5 : 12,
                fontWeight: 500,
                color: E.label,
                marginTop: 2,
              }}
            >
              {entry.detail}
            </div>
            {variant === "mobile" && (
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: E.faint,
                  marginTop: 4,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatWhen(entry.at)}
              </div>
            )}
          </div>
          {variant === "web" && (
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: E.faint,
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0,
              }}
            >
              {formatWhen(entry.at)}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: `1px dashed ${E.hair}`,
        borderRadius: 16,
        background: "rgba(255,255,255,0.7)",
        padding: "40px 20px",
        textAlign: "center",
        fontSize: 13.5,
        fontWeight: 500,
        color: E.label,
      }}
    >
      {children}
    </div>
  );
}
