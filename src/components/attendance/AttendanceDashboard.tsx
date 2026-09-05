"use client";

/**
 * The attendance dashboard — today, for everyone the reader may see.
 *
 * **Built in the Employee Directory's design language**, from the same
 * `directoryChrome` tokens: gradient hero with rings, `minmax(252px,1fr)` stat
 * cards with their accent stripe and bar, the same card radius, borders,
 * Manrope face and row hover. The attendance module sits beside Team in the
 * sidebar and describes the same people, so it should not look like a
 * different product.
 *
 * **The punch lives on the main dashboard, not here.** There is exactly one
 * Check In / Check Out in the product — the strip on `/home`, which every role
 * lands on — and this screen shows the same day read-only with a link to it.
 * Two controls writing one document only ever created doubt about which had
 * been pressed, and the office-network rule is enforced on the server either
 * way, so nothing is lost by having one.
 *
 * Every figure is derived from the same range read the reports use, so the
 * dashboard and the report cannot disagree about a day.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useAttendance } from "@/hooks/useAttendance";
import { useTeamAttendance } from "@/hooks/useTeamAttendance";
import { useLeaveRequests } from "@/hooks/useLeave";
import { karachiDayKey } from "@/lib/dates";
import { formatWorkedHours, NETWORK_LABELS, ATTENDANCE_STATUS_LABELS } from "@/lib/attendance";
import type { AttendanceStatus } from "@/lib/attendance";
import { LEAVE_TYPE_LABELS } from "@/lib/attendancePolicy";
import { E, HeroRings, Card, Bar } from "@/components/employees/directoryChrome";
import { ATTENDANCE_TONES, StatusPill } from "./attendanceChrome";

const DASH_CSS = `
.att-row { transition: background-color 140ms ease; }
.att-row:hover { background: #f7fbfa; }
.att-stat { transition: border-color 160ms ease; }
.att-stat:hover { border-color: #b6d9d5; }
@keyframes att-in { from { opacity: 0; transform: translate3d(0, 8px, 0); } to { opacity: 1; transform: none; } }
.att-in { animation: att-in 300ms cubic-bezier(0.22,0.61,0.36,1) both; }
@media (prefers-reduced-motion: reduce) {
  .att-in { animation: none !important; }
  .att-row, .att-stat { transition: none !important; }
}
`;

/** The four states the day is summarised by, each with the module's colour. */
const SUMMARY: { status: AttendanceStatus; icon: string; hint: string }[] = [
  {
    status: "PRESENT",
    icon: "M20 6 9 17l-5-5",
    hint: "Checked in on time",
  },
  {
    status: "LATE",
    icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
    hint: "Checked in after the allowed time",
  },
  {
    status: "ABSENT",
    icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9 9l6 6M15 9l-6 6",
    hint: "No check-in before the cutoff",
  },
  {
    status: "LEAVE",
    icon: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
    hint: "Approved leave",
  },
];

export function AttendanceDashboard({ basePath }: { basePath: string }) {
  const { user, role, isHr, getIdToken } = useAuth();
  const isMobile = useIsMobile();
  const today = karachiDayKey();

  const [dayKey, setDayKey] = useState(today);

  const team = useTeamAttendance(dayKey, dayKey);
  const mine = useAttendance(user?.uid, getIdToken);
  const leave = useLeaveRequests(
    isHr ? "all" : "team",
    user?.uid,
    role === "admin" || role === "subadmin"
  );

  const pending = leave.requests.filter((request) => request.status === "PENDING");

  /**
   * One row per person for the chosen day. Somebody with no record at all on a
   * past working day is an absence the sweep has not written yet — shown as
   * Absent rather than blank, because a blank row reads as "no data" when it
   * means "did not come in".
   */
  const people = useMemo(
    () =>
      team.rows.map((row) => {
        const day = row.days.find((entry) => entry.dayKey === dayKey) ?? null;
        const status: AttendanceStatus = day?.status ?? (dayKey < today ? "ABSENT" : "UNRECORDED");
        return { row, day, status };
      }),
    [team.rows, dayKey, today]
  );

  const count = (status: AttendanceStatus) =>
    people.filter((person) => person.status === status).length;

  const attention = people.filter(
    (person) => person.status === "LATE" || person.status === "ABSENT"
  );

  const todayRecord = mine.today;
  const peak = Math.max(1, ...SUMMARY.map((entry) => count(entry.status)));

  return (
    // The frame — ground, padding, the negative margin that cancels the
    // <main> padding — belongs to `AttendanceShell`. A page that set its own
    // negative margin climbed over the tab strip above it, which is exactly
    // the bug this arrangement removes.
    <div>
      <style>{DASH_CSS}</style>

      {/* ---------------------------------------------------------------- */}
      {/* Hero — identity, today's own punch, the day picker                 */}
      {/* ---------------------------------------------------------------- */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: isMobile ? 18 : 22,
          background: isMobile ? E.gradientMobile : E.gradient,
          color: "#fff",
          padding: isMobile ? "20px 18px" : "24px 28px",
          marginBottom: 16,
        }}
      >
        <HeroRings set={isMobile ? "phone" : "hero"} />

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 22,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
            <div
              style={{
                width: isMobile ? 44 : 52,
                height: isMobile ? 44 : 52,
                borderRadius: 16,
                background: "rgba(255,255,255,0.18)",
                border: "1.5px solid rgba(255,255,255,0.42)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
              aria-hidden
            >
              <svg
                width={isMobile ? 21 : 24}
                height={isMobile ? 21 : 24}
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8.5 14.5l2.5 2.5 4.5-5" />
              </svg>
            </div>

            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "1.6px",
                  textTransform: "uppercase",
                  opacity: 0.72,
                }}
              >
                Attendance
              </div>
              <h1
                style={{
                  fontSize: isMobile ? 23 : 29,
                  fontWeight: 800,
                  letterSpacing: "-1px",
                  margin: "1px 0 0",
                  color: "#fff",
                  fontFamily: E.font,
                }}
              >
                {team.companyWide ? "Everyone" : "My team"}
              </h1>
              <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.82, marginTop: 4 }}>
                {people.length} {people.length === 1 ? "person" : "people"} · {dayKey}
                {dayKey === today ? " · today" : ""}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "1.2px",
                  textTransform: "uppercase",
                  opacity: 0.8,
                }}
              >
                Day
              </span>
              <input
                type="date"
                value={dayKey}
                max={today}
                onChange={(event) => setDayKey(event.target.value || today)}
                style={{
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.45)",
                  background: "rgba(255,255,255,0.14)",
                  color: "#fff",
                  padding: "10px 12px",
                  fontSize: 14,
                  fontWeight: 700,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
            </label>
          </div>
        </div>

        {/* ---- the reader's own day, and the only punch control they get ---- */}
        <div
          style={{
            position: "relative",
            marginTop: 18,
            borderRadius: 16,
            background: "rgba(255,255,255,0.13)",
            border: "1px solid rgba(255,255,255,0.3)",
            padding: isMobile ? "14px 15px" : "15px 18px",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "1.2px",
                textTransform: "uppercase",
                opacity: 0.78,
              }}
            >
              Your day
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>
              {todayRecord?.firstAt
                ? `In ${clock(todayRecord.firstAt)}`
                : "Not checked in yet"}
              {todayRecord?.lastAt && mine.checkedOut ? ` · Out ${clock(todayRecord.lastAt)}` : ""}
              {" · "}
              {formatWorkedHours(todayRecord?.minutes ?? 0)}
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
              {todayRecord ? NETWORK_LABELS[todayRecord.network] : "No record for today"}
            </div>
          </div>

          {/* One punch control in the product, and it is not this screen.
              A link rather than a second pair of buttons: the same document
              written from two places is how a day ends up with two stories. */}
          <Link
            href="/home"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.45)",
              background: "rgba(255,255,255,0.18)",
              color: "#fff",
              padding: "11px 18px",
              fontSize: 13.5,
              fontWeight: 700,
              textDecoration: "none",
              flexShrink: 0,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
            </svg>
            Check in / out on the dashboard
          </Link>
        </div>
      </div>

      {team.error && (
        <p
          role="alert"
          style={{
            marginBottom: 16,
            borderRadius: 12,
            border: "1px solid #f0c4bd",
            background: E.redBg,
            color: E.redInk,
            padding: "11px 14px",
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          {team.error}
        </p>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Stat cards                                                        */}
      {/* ---------------------------------------------------------------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(252px, 1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        {SUMMARY.map((entry) => (
          <StatCard
            key={entry.status}
            label={ATTENDANCE_STATUS_LABELS[entry.status]}
            value={count(entry.status)}
            accent={ATTENDANCE_TONES[entry.status].solid}
            icon={entry.icon}
            hint={entry.hint}
            peak={peak}
          />
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Needs attention — the reason anyone opens this screen              */}
      {/* ---------------------------------------------------------------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.35fr) minmax(0, 1fr)",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Panel
          title="Needs attention"
          hint={attention.length === 0 ? undefined : `${attention.length} on this day`}
          action={
            <Link href={`${basePath}/records`} style={linkStyle}>
              Late / absence →
            </Link>
          }
        >
          {attention.length === 0 ? (
            <Quiet>Nobody is late or unaccounted for on this day.</Quiet>
          ) : (
            <div style={{ display: "grid", gap: 8, padding: 14 }}>
              {attention.map(({ row, day, status }, index) => (
                <div
                  key={row.uid}
                  className={index < 8 ? "att-in" : undefined}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    borderRadius: 12,
                    border: `1px solid ${ATTENDANCE_TONES[status].border}`,
                    background: ATTENDANCE_TONES[status].soft,
                    padding: "10px 13px",
                    animationDelay: index < 8 ? `${index * 28}ms` : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <Avatar name={row.name} tone={ATTENDANCE_TONES[status].solid} />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 800, color: E.ink }}>{row.name}</p>
                      <p style={{ fontSize: 11.5, color: E.muted, fontWeight: 600 }}>
                        {status === "LATE"
                          ? `In at ${day?.checkIn ?? "—"} · ${day?.lateByMinutes ?? 0} min late`
                          : "No check-in recorded"}
                        {row.managerName ? ` · ${row.managerName}` : ""}
                      </p>
                    </div>
                  </div>
                  <StatusPill status={status} />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Leave awaiting a decision"
          hint={pending.length === 0 ? undefined : `${pending.length} pending`}
          action={
            <Link href={`${basePath}/leave`} style={linkStyle}>
              Leave →
            </Link>
          }
        >
          {pending.length === 0 ? (
            <Quiet>Nothing is waiting on you.</Quiet>
          ) : (
            <div style={{ display: "grid", gap: 8, padding: 14 }}>
              {pending.slice(0, 5).map((request) => (
                <Link
                  key={request.id}
                  href={`${basePath}/leave`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    borderRadius: 12,
                    border: `1px solid ${E.border}`,
                    background: E.surface,
                    padding: "10px 13px",
                    textDecoration: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <Avatar name={request.employeeName ?? "?"} tone={E.amber} />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 800, color: E.ink }}>
                        {request.employeeName ?? "An employee"}
                      </p>
                      <p style={{ fontSize: 11.5, color: E.faint, fontWeight: 600 }}>
                        {LEAVE_TYPE_LABELS[request.type]} · {request.days} day
                        {request.days === 1 ? "" : "s"} · {request.from}
                      </p>
                    </div>
                  </div>
                  <span style={{ color: E.hair, flexShrink: 0 }} aria-hidden>
                    ›
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* The roster                                                        */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        title="The roster"
        hint={`${people.length} on this day`}
        action={
          <Link href={`${basePath}/calendar`} style={linkStyle}>
            Calendar →
          </Link>
        }
      >
        {people.length === 0 ? (
          <Quiet>{team.loading ? "Loading the roster." : "Nobody is on your team yet."}</Quiet>
        ) : isMobile ? (
          <div style={{ padding: 14, display: "grid", gap: 10 }}>
            {people.map(({ row, day, status }, index) => (
              <div
                key={row.uid}
                className={index < 8 ? "att-in" : undefined}
                style={{
                  border: `1px solid ${E.border}`,
                  borderRadius: 14,
                  background: E.surface,
                  padding: "12px 13px",
                  animationDelay: index < 8 ? `${index * 28}ms` : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Avatar name={row.name} tone={ATTENDANCE_TONES[status].solid} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p
                      style={{
                        fontSize: 14.5,
                        fontWeight: 800,
                        color: E.ink,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.name}
                    </p>
                    <p style={{ fontSize: 11.5, color: E.faint, fontWeight: 600 }}>
                      {row.jobTitle ?? row.email ?? ""}
                    </p>
                  </div>
                  <StatusPill status={status} />
                </div>

                <div
                  style={{
                    marginTop: 11,
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 9,
                  }}
                >
                  <Micro label="In" value={day?.checkIn ?? "—"} />
                  <Micro label="Out" value={day?.checkOut ?? "—"} />
                  <Micro label="Hours" value={formatWorkedHours(day?.minutes ?? 0)} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead>
                <tr>
                  {["Employee", "Status", "In", "Out", "Hours", "Network"].map((label, index) => (
                    <th
                      key={label}
                      style={{
                        textAlign: index === 0 ? "left" : "right",
                        padding: "12px 16px",
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: "1.1px",
                        textTransform: "uppercase",
                        color: E.label,
                        background: E.field,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map(({ row, day, status }, index) => (
                  <tr
                    key={row.uid}
                    className={`att-row ${index < 10 ? "att-in" : ""}`}
                    style={{
                      borderTop: `1px solid ${E.rowBorder}`,
                      animationDelay: index < 10 ? `${index * 26}ms` : undefined,
                    }}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <Avatar name={row.name} tone={ATTENDANCE_TONES[status].solid} />
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: 13.5, fontWeight: 700, color: E.ink }}>{row.name}</p>
                          <p style={{ fontSize: 11, color: E.faint }}>
                            {row.jobTitle ?? row.email ?? ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <StatusPill status={status} />
                    </td>
                    <td style={cell}>{day?.checkIn ?? "—"}</td>
                    <td style={cell}>{day?.checkOut ?? "—"}</td>
                    <td style={cell}>{formatWorkedHours(day?.minutes ?? 0)}</td>
                    <td style={{ ...cell, color: E.faint }}>
                      {day ? NETWORK_LABELS[day.network] : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p style={{ marginTop: 14, fontSize: 11.5, color: E.faint, lineHeight: 1.6 }}>
        Check in and out from the dashboard — one control, so a day cannot be opened twice. Check In
        is refused off the office Wi-Fi when the restriction is on;{" "}
        <strong style={{ color: E.muted }}>Check Out works from anywhere</strong>, so a day never
        stays open because somebody finished at a client site. Scoped on the server — a manager sees
        their own team, an admin and HR see everyone.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

function clock(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function StatCard({
  label,
  value,
  accent,
  icon,
  hint,
  peak,
}: {
  label: string;
  value: number;
  accent: string;
  icon: string;
  hint: string;
  peak: number;
}) {
  return (
    <div
      className="att-stat"
      style={{
        position: "relative",
        overflow: "hidden",
        background: E.surface,
        border: `1px solid ${E.border}`,
        borderRadius: 16,
        padding: "16px 18px",
      }}
    >
      <div
        aria-hidden
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            background: E.tint,
            color: accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-hidden
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={icon} />
          </svg>
        </div>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "1.1px",
            textTransform: "uppercase",
            color: E.label,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>

      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: "-1px",
          color: E.ink,
          fontVariantNumeric: "tabular-nums",
          marginTop: 11,
        }}
      >
        {value}
      </div>

      <div style={{ marginTop: 10 }}>
        <Bar percent={(value / peak) * 100} fill={accent} />
      </div>
      <p style={{ marginTop: 8, fontSize: 11, color: E.faint }}>{hint}</p>
    </div>
  );
}

function Panel({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "14px 18px",
          borderBottom: `1px solid ${E.softBorder}`,
        }}
      >
        <h2
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "1.2px",
            textTransform: "uppercase",
            color: E.label,
            fontFamily: E.font,
          }}
        >
          {title}
          {hint && (
            <span style={{ marginLeft: 8, fontWeight: 600, textTransform: "none", color: E.faint }}>
              {hint}
            </span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ padding: "34px 20px", textAlign: "center", fontSize: 13, color: E.faint }}>
      {children}
    </p>
  );
}

function Avatar({ name, tone }: { name: string; tone: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 34,
        height: 34,
        borderRadius: 999,
        background: E.tealTint,
        color: tone,
        display: "grid",
        placeItems: "center",
        fontSize: 13,
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function Micro({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.5px",
          textTransform: "uppercase",
          color: E.label,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 13.5,
          fontWeight: 700,
          color: E.ink,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "12px 16px",
  textAlign: "right",
  fontSize: 13,
  fontWeight: 600,
  color: E.ink,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const linkStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: E.tealInk,
  textDecoration: "none",
};
