"use client";

/**
 * The phone Day End Report, built to `Day End Dashboard Mobile.dc.html`.
 *
 * Every measurement here is the design file's own — the 26px header corner,
 * the `rgba(255,255,255,0.14)` attendance well, r=39/stroke 9 gauges capped at
 * 96px, 44px KPI rings with r=18/stroke 5, the 34px/radius-12 portfolio badges.
 * Nothing is measured off the picture.
 *
 * The data is this app's real data, not the mockup's constants: the same
 * hooks the desktop dashboard uses, at the same scope (an admin sees the team
 * summed, an employee sees only their own).
 *
 * Two places where the design's *labels* decided the wiring:
 *
 * - The two gauges read "ATTEND", so they are the attendance rate month- and
 *   year-to-date — not the KPI attainment the desktop shows in that slot.
 * - "Target Achieved" is drawn in red in the mockup because its sample is
 *   under target. Here the colour is derived, so hitting the target turns it
 *   teal rather than staying red for ever.
 */

import { useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLeads } from "@/hooks/useLeads";
import { useEmployeeKpi, useTeamKpi } from "@/hooks/useKpi";
import { useMyProfile } from "@/hooks/useEmployees";
import { useAttendance } from "@/hooks/useAttendance";
import { formatClock, formatWorkedHours } from "@/lib/attendance";
import { DEAL_CATEGORIES } from "@/lib/constants/deals";
import { telUrl } from "@/lib/phone";
import { AccountButton } from "./MobileAccount";
import { MobileBell } from "./MobileBell";
import { M, MobileCard, MobileHeader, Meter, Segmented, dash } from "./mobileChrome";
import { MobileBody, useMobileCentre } from "./MobileShell";
import type { CentreAction } from "./MobileTabBar";

/** The design's own icon paths, one per KPI, in `KPI_METRICS` order. */
const KPI_ICONS = [
  "M5 4h3l2 5-2.2 1.6a12 12 0 0 0 5.6 5.6L15 14l5 2v3a2 2 0 0 1-2.2 2A16 16 0 0 1 3 6.2 2 2 0 0 1 5 4Z",
  "M12 11a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8ZM5 20c0-3.3 3.1-5.2 7-5.2s7 1.9 7 5.2",
  "M4 5h16v15H4zM8 3v4M16 3v4M4 10h16",
];

function pkrMillions(amount: number): string {
  if (!amount) return "—";
  return `PKR ${(amount / 1_000_000).toFixed(1)}M`;
}

/** Long-form business date, as the design prints it. */
function longDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function MobileDashboard() {
  const { user, role, getIdToken } = useAuth();
  const isAdmin = role === "admin";

  const { leads } = useLeads((role as "admin" | "employee") ?? null, user?.uid);
  const profile = useMyProfile(user?.uid);
  const teamKpi = useTeamKpi(isAdmin);
  const ownKpi = useEmployeeKpi(isAdmin ? undefined : user?.uid, profile.targets);
  const kpi = isAdmin ? teamKpi : ownKpi;
  const attendance = useAttendance(user?.uid, getIdToken);

  const [range, setRange] = useState<"MTD" | "YTD">("MTD");

  const awaitingAccept = leads.filter((lead) => lead.status === "ASSIGNED");
  const callHref = telUrl(awaitingAccept[0]?.phone);

  // The centre tab action, memoised so the shell's effect registers it once
  // rather than on every render of this screen.
  const centre = useMemo<CentreAction>(
    () => (callHref ? { kind: "call", href: callHref } : null),
    [callHref]
  );
  useMobileCentre(centre);

  const displayName =
    profile.name ??
    (user?.email
      ? user.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : isAdmin
        ? "Admin"
        : "there");

  const readings = range === "MTD" ? kpi.mtdReadings : kpi.ytdReadings;
  const portfolioMax = Math.max(...DEAL_CATEGORIES.map((c) => kpi.portfolio[c] ?? 0), 0);
  const portfolioTotal = DEAL_CATEGORIES.reduce((sum, c) => sum + (kpi.portfolio[c] ?? 0), 0);

  const dataError = kpi.error ?? attendance.error;
  const [punchNote, setPunchNote] = useState<{ ok: boolean; message: string } | null>(null);

  const runPunch = async (kind: "IN" | "OUT") => {
    setPunchNote(await attendance.punch(kind));
  };
  const today = attendance.today;

  return (
    <>
      <MobileHeader>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "1.3px",
                textTransform: "uppercase",
                opacity: 0.78,
              }}
            >
              Day End Report
            </div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 800,
                letterSpacing: "-0.7px",
                marginTop: 3,
                color: "#fff",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Hi {displayName}
            </h1>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                opacity: 0.8,
                marginTop: 2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {longDate(new Date())}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <MobileBell uid={user?.uid} role={role ?? undefined} getIdToken={getIdToken} />
            <AccountButton initial={displayName} />
          </div>
        </div>

        {/* Attendance well — observed, never declared. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 18,
            padding: "14px 16px",
            borderRadius: 18,
            background: M.wellBg,
            border: `1px solid ${M.wellBorder}`,
          }}
        >
          {[
            { label: "CHECK IN", value: formatClock(today?.firstAt ?? null) },
            { label: "CHECK OUT", value: formatClock(today?.lastAt ?? null) },
            {
              label: "WORKED",
              // A day that has opened but barely run reads "0min"; the dash is
              // reserved for a day with no record at all.
              value: today?.firstAt ? (today.minutes > 0 ? formatWorkedHours(today.minutes) : "0min") : "—",
            },
          ].map((cell, index) => (
            <div
              key={cell.label}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                borderLeft: index > 0 ? "1px solid rgba(255,255,255,0.22)" : undefined,
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.4px",
                  opacity: 0.82,
                  whiteSpace: "nowrap",
                }}
              >
                {cell.label}
              </div>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 700,
                  letterSpacing: "-0.3px",
                  marginTop: 4,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {cell.value}
              </div>
            </div>
          ))}
        </div>
      </MobileHeader>

      <MobileBody>
        {dataError && (
          <div
            role="alert"
            style={{
              marginBottom: 14,
              borderRadius: M.rowRadius,
              border: "1px solid #f0c4bd",
              background: "#fdeeeb",
              color: "#a33a29",
              padding: "12px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.45,
            }}
          >
            {dataError}
          </div>
        )}

        {/* Check In / Check Out. Shown for both roles — an admin turns up to the
            office too, and theirs is the account most often signed in. */}
        {(
          <MobileCard style={{ padding: "15px 16px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.9px", textTransform: "uppercase", color: M.fainter }}>
                  Attendance
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: M.ink, marginTop: 3 }}>
                  {attendance.checkedOut
                    ? "Day closed"
                    : today?.firstAt
                      ? "You are checked in"
                      : "Not checked in"}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: M.faint }}>
                  In {formatClock(today?.firstAt ?? null)}
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: M.faint, marginTop: 2 }}>
                  Out {formatClock(today?.lastAt ?? null)}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 9, marginTop: 13 }}>
              <PunchButton
                label="Check In"
                done={Boolean(today?.firstAt)}
                busy={attendance.punching}
                onPress={() => void runPunch("IN")}
              />
              <PunchButton
                label="Check Out"
                done={Boolean(attendance.checkedOut)}
                busy={attendance.punching}
                disabled={!today?.firstAt}
                onPress={() => void runPunch("OUT")}
              />
            </div>

            {punchNote && (
              <div
                role="status"
                style={{
                  marginTop: 11,
                  borderRadius: M.fieldRadius,
                  border: `1px solid ${punchNote.ok ? "#bfe0dc" : "#f0c4bd"}`,
                  background: punchNote.ok ? "#eef8f7" : "#fdeeeb",
                  color: punchNote.ok ? M.tealDeep : "#a33a29",
                  padding: "9px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  lineHeight: 1.45,
                }}
              >
                {punchNote.message}
              </div>
            )}
          </MobileCard>
        )}

        {/* Attendance gauges */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            // `attendanceRate` already returns a 0–100 figure to one decimal.
            { label: "MTD", pct: attendance.rate.percent },
            { label: "YTD", pct: attendance.yearRate.percent },
          ].map((gauge) => (
            <MobileCard
              key={gauge.label}
              style={{
                padding: "16px 14px 18px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, alignSelf: "flex-start" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: M.teal }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.8px", color: M.muted }}>
                  {gauge.label}
                </span>
              </div>
              <div style={{ position: "relative", width: "100%", maxWidth: 96, aspectRatio: "1" }}>
                <svg width="100%" height="100%" viewBox="0 0 96 96" style={{ display: "block" }} aria-hidden>
                  <circle cx="48" cy="48" r="39" fill="none" stroke={M.track} strokeWidth="9" />
                  <circle
                    cx="48"
                    cy="48"
                    r="39"
                    fill="none"
                    stroke={M.teal}
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeDasharray={dash(gauge.pct, 39)}
                    transform="rotate(-90 48 48)"
                    style={{ transition: "stroke-dasharray 520ms cubic-bezier(0.22,0.61,0.36,1)" }}
                  />
                </svg>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                  }}
                >
                  <span
                    style={{
                      fontSize: 17,
                      fontWeight: 800,
                      letterSpacing: "-0.6px",
                      color: M.ink,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {gauge.pct.toFixed(1)}%
                  </span>
                  <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.5px", color: M.faint }}>
                    ATTEND
                  </span>
                </div>
              </div>
            </MobileCard>
          ))}
        </div>

        {/* Key Performance */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            margin: "22px 2px 12px",
          }}
        >
          <h2 style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: "-0.3px", color: M.ink }}>
            Key Performance
          </h2>
          <Segmented
            options={[
              { key: "MTD", label: "MTD" },
              { key: "YTD", label: "YTD" },
            ]}
            value={range}
            onChange={setRange}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {readings.map((reading, index) => {
            const good = reading.ratio >= 1;
            const colour = good ? M.teal : M.amber;
            return (
              <MobileCard
                key={reading.metric}
                radius={M.rowRadius}
                style={{
                  display: "grid",
                  gridTemplateColumns: "44px 1fr auto",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                }}
              >
                <div style={{ position: "relative", width: 44, height: 44 }}>
                  <svg width="44" height="44" viewBox="0 0 44 44" style={{ display: "block" }} aria-hidden>
                    <circle cx="22" cy="22" r="18" fill="none" stroke={M.track} strokeWidth="5" />
                    <circle
                      cx="22"
                      cy="22"
                      r="18"
                      fill="none"
                      stroke={colour}
                      strokeWidth="5"
                      strokeLinecap="round"
                      // Clamped at one full circle, printed uncapped — a ring
                      // that wrapped twice would be indistinguishable from 100%.
                      strokeDasharray={dash(Math.min(100, reading.percent), 18)}
                      transform="rotate(-90 22 22)"
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
                    }}
                  >
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={colour}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d={KPI_ICONS[index]} />
                    </svg>
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14.5,
                      fontWeight: 600,
                      letterSpacing: "-0.2px",
                      color: M.ink,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {reading.label}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: M.faint, marginTop: 1 }}>
                    {reading.actual.toLocaleString()} of {reading.target.toLocaleString()}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      letterSpacing: "-0.5px",
                      color: colour,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {reading.percent}%
                  </div>
                  <div
                    style={{
                      display: "inline-block",
                      marginTop: 3,
                      padding: "2px 9px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.3px",
                      background: good ? M.tealTint : M.amberBg,
                      color: good ? M.tealDeep : M.amberInk,
                    }}
                  >
                    {good ? "On track" : "Behind"}
                  </div>
                </div>
              </MobileCard>
            );
          })}
        </div>

        {/* Target Achieved */}
        <MobileCard style={{ marginTop: 22, padding: "18px 16px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <h2 style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.2px", color: M.ink }}>
              Target Achieved
            </h2>
            <span
              style={{
                padding: "4px 12px",
                borderRadius: 999,
                background: "#eef5f4",
                border: `1px solid ${M.cardBorder}`,
                fontSize: 11,
                fontWeight: 600,
                color: M.muted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {kpi.year}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
            {[
              { label: "MTD", actual: kpi.mtd.revenue, target: kpi.mtdTargets.revenue },
              { label: "YTD", actual: kpi.ytd.revenue, target: kpi.ytdTargets.revenue },
            ].map((row) => {
              const pct = row.target > 0 ? (row.actual / row.target) * 100 : 0;
              const hit = pct >= 100;
              return (
                <div key={row.label}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.4px", color: M.muted }}>
                      {row.label}
                    </span>
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        letterSpacing: "-0.4px",
                        color: hit ? M.tealDeep : M.red,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {pct.toFixed(2)}%
                    </span>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Meter
                      percent={pct}
                      fill={
                        hit
                          ? "linear-gradient(90deg,#3f8f8a,#63b3ad)"
                          : "linear-gradient(90deg,#d8735f,#c0574a)"
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </MobileCard>

        {/* Portfolio */}
        <MobileCard style={{ marginTop: 16, padding: "18px 16px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <h2 style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.2px", color: M.ink }}>Portfolio</h2>
            <span
              style={{
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: "-0.5px",
                color: M.tealDeep,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {portfolioTotal ? pkrMillions(portfolioTotal) : "PKR 0.0M"}
            </span>
          </div>
          {DEAL_CATEGORIES.map((category, index) => {
            const amount = kpi.portfolio[category] ?? 0;
            const has = amount > 0;
            return (
              <div
                key={category}
                style={{
                  display: "grid",
                  gridTemplateColumns: "34px 1fr auto",
                  alignItems: "center",
                  gap: 13,
                  padding: "13px 0",
                  borderBottom: index < DEAL_CATEGORIES.length - 1 ? `1px solid ${M.divider}` : undefined,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: "#fff",
                    background: has ? M.teal : "#bcd6d3",
                  }}
                  aria-hidden
                >
                  {category.charAt(0)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.2px", color: M.ink }}>
                    {category}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Meter
                      percent={portfolioMax > 0 ? (amount / portfolioMax) * 100 : 0}
                      height={6}
                      minWidth={has ? 5 : 0}
                      fill={has ? "linear-gradient(90deg,#3f8f8a,#63b3ad)" : "transparent"}
                    />
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 700,
                    letterSpacing: "-0.2px",
                    color: has ? M.tealDeep : M.ghost,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {has ? pkrMillions(amount) : "—"}
                </span>
              </div>
            );
          })}
        </MobileCard>
      </MobileBody>
    </>
  );
}

/** The phone's Check In / Check Out control — see the desktop `PunchButton`. */
function PunchButton({
  label,
  onPress,
  busy,
  done,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  done: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="mob-press"
      onClick={onPress}
      disabled={busy || disabled}
      style={{
        flex: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "12px 14px",
        borderRadius: 999,
        border: `1px solid ${done ? M.teal : M.cardBorder}`,
        background: done ? M.tealTint : M.teal,
        color: done ? M.tealDeep : "#fff",
        fontSize: 13,
        fontWeight: 700,
        cursor: busy || disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : busy ? 0.7 : 1,
        WebkitTapHighlightColor: "transparent",
        fontFamily: "inherit",
      }}
    >
      {done && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      <span>{busy ? "…" : label}</span>
    </button>
  );
}
