"use client";

/**
 * The team calendar (§3), in the two shapes the question actually takes.
 *
 * **One person, one month** — the calendar grid, for "what did she do in
 * August". **Everyone, one month** — a row per employee with a cell per day,
 * for "who was off on the 14th". They answer different questions and neither
 * substitutes for the other, so both are here behind one toggle rather than a
 * grid squeezed into doing both jobs badly.
 *
 * Clicking any day opens the same `DayDetailPanel` the employee's own screen
 * uses, which is where HR corrects a day (§11).
 */

import { useMemo, useState } from "react";
import { CalendarDays, Grid3x3 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTeamAttendance } from "@/hooks/useTeamAttendance";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { dayNumber, daysInMonth, monthRange } from "@/lib/attendanceCalendar";
import type { AttendanceStatus } from "@/lib/attendance";
import type { AttendanceDay } from "@/hooks/useAttendance";
import type { TeamAttendanceDay } from "@/app/actions/attendance";
import {
  A,
  ATTENDANCE_TONES,
  AttendanceCalendar,
  AttendanceCard,
  EmptyState,
  StatusLegend,
} from "./attendanceChrome";
import { MonthStepper } from "./MyAttendanceView";
import { DayDetailPanel } from "./DayDetailPanel";

/**
 * A server row is not a hook row: it has no `Date` objects, because it came
 * over the wire. The detail panel takes the hook's shape, so one adapter here
 * beats a second panel that renders the same eleven facts.
 */
function toAttendanceDay(day: TeamAttendanceDay): AttendanceDay {
  const parse = (clock: string | null) =>
    clock ? new Date(`${day.dayKey}T${clock}:00+05:00`) : null;

  return {
    day: dayNumber(day.dayKey),
    dayKey: day.dayKey,
    status: day.status,
    network: day.network,
    minutes: day.minutes,
    firstAt: parse(day.checkIn),
    lastAt: parse(day.checkOut),
    isFuture: false,
    record: {
      id: day.dayKey,
      uid: "",
      dayKey: day.dayKey,
      late: day.late,
      lateByMinutes: day.lateByMinutes,
      network: day.network,
      overrideNote: day.note,
      leaveType: (day.leaveType as "CASUAL" | "MEDICAL" | undefined) ?? undefined,
    },
  };
}

export function TeamCalendarView({ canAdjust }: { canAdjust: boolean }) {
  const { user } = useAuth();
  const [monthKey, setMonthKey] = useState(karachiMonthKey());
  const [mode, setMode] = useState<"person" | "grid">("person");
  const [personUid, setPersonUid] = useState<string | null>(null);
  const [open, setOpen] = useState<{ uid: string; name: string; day: TeamAttendanceDay } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const { from, to } = monthRange(monthKey);
  const team = useTeamAttendance(from, to);

  // Default to the reader's own record when they are on the roster, otherwise
  // the first person — a calendar that opens on nobody is a wasted screen.
  const activeUid = personUid ?? (team.rows.some((row) => row.uid === user?.uid) ? user?.uid : team.rows[0]?.uid) ?? null;
  const person = team.rows.find((row) => row.uid === activeUid) ?? null;

  const cells = useMemo(
    () =>
      (person?.days ?? []).map((day) => ({
        dayKey: day.dayKey,
        day: dayNumber(day.dayKey),
        status: day.status,
        hint: day.checkIn,
      })),
    [person]
  );

  const dayCount = daysInMonth(monthKey);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AttendanceCard
        title="Attendance calendar"
        action={
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", gap: 4, background: A.hair, borderRadius: 999, padding: 3 }}>
              {(
                [
                  { key: "person", label: "One person", icon: CalendarDays },
                  { key: "grid", label: "Whole team", icon: Grid3x3 },
                ] as const
              ).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMode(key)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    borderRadius: 999,
                    border: "none",
                    background: mode === key ? A.surface : "transparent",
                    color: mode === key ? A.teal : A.muted,
                    padding: "5px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: mode === key ? "0 1px 3px rgba(31,59,57,0.12)" : "none",
                  }}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
            <MonthStepper monthKey={monthKey} onChange={setMonthKey} />
          </div>
        }
      >
        <div style={{ marginBottom: 14 }}>
          <StatusLegend
            counts={
              person
                ? {
                    PRESENT: person.present,
                    LATE: person.late,
                    ABSENT: person.absent,
                    LEAVE: person.leave,
                  }
                : undefined
            }
          />
        </div>

        {banner && (
          <p
            role="status"
            style={{
              marginBottom: 12,
              borderRadius: 10,
              border: "1px solid #bfe3d2",
              background: "#e4f3ec",
              color: "#1f7a52",
              padding: "9px 12px",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            {banner}
          </p>
        )}

        {team.error && (
          <p role="alert" style={{ fontSize: 13, color: "#a33a29", marginBottom: 12 }}>
            {team.error}
          </p>
        )}

        {team.rows.length === 0 ? (
          <EmptyState>{team.loading ? "Loading." : "Nobody is on your team yet."}</EmptyState>
        ) : mode === "person" ? (
          <>
            <select
              value={activeUid ?? ""}
              onChange={(event) => setPersonUid(event.target.value)}
              style={{
                marginBottom: 14,
                borderRadius: 10,
                border: `1px solid ${A.line}`,
                background: "#fff",
                color: A.ink,
                padding: "9px 11px",
                fontSize: 14,
                fontWeight: 700,
                outline: "none",
                maxWidth: 320,
                width: "100%",
              }}
            >
              {team.rows.map((row) => (
                <option key={row.uid} value={row.uid}>
                  {row.name}
                </option>
              ))}
            </select>

            <AttendanceCalendar
              monthKey={monthKey}
              cells={cells}
              today={karachiDayKey()}
              onSelect={(dayKey) => {
                const day = person?.days.find((entry) => entry.dayKey === dayKey);
                if (day && person) setOpen({ uid: person.uid, name: person.name, day });
              }}
            />
          </>
        ) : (
          /* One row per employee, one cell per day. Scrolls inside its own
             container so the page never scrolls sideways. */
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 140 + dayCount * 26 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `140px repeat(${dayCount}, 26px)`,
                  gap: 3,
                  marginBottom: 4,
                }}
              >
                <span />
                {Array.from({ length: dayCount }, (_, index) => (
                  <span
                    key={index}
                    style={{ fontSize: 9.5, fontWeight: 700, color: A.faint, textAlign: "center" }}
                  >
                    {index + 1}
                  </span>
                ))}
              </div>

              {team.rows.map((row) => {
                const byDay = new Map(row.days.map((day) => [day.dayKey, day]));
                return (
                  <div
                    key={row.uid}
                    style={{
                      display: "grid",
                      gridTemplateColumns: `140px repeat(${dayCount}, 26px)`,
                      gap: 3,
                      marginBottom: 3,
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: A.ink,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        paddingRight: 6,
                      }}
                      title={row.name}
                    >
                      {row.name}
                    </span>
                    {Array.from({ length: dayCount }, (_, index) => {
                      const dayKey = `${monthKey}-${String(index + 1).padStart(2, "0")}`;
                      const day = byDay.get(dayKey);
                      const status: AttendanceStatus = day?.status ?? "UNRECORDED";
                      const tone = ATTENDANCE_TONES[status];
                      return (
                        <button
                          key={dayKey}
                          type="button"
                          disabled={!day}
                          onClick={() => day && setOpen({ uid: row.uid, name: row.name, day })}
                          aria-label={`${row.name} — ${dayKey}`}
                          title={`${dayKey} · ${status}`}
                          style={{
                            height: 24,
                            borderRadius: 6,
                            border: `1px solid ${tone.border}`,
                            background: tone.soft,
                            color: tone.text,
                            fontSize: 9,
                            fontWeight: 800,
                            cursor: day ? "pointer" : "default",
                            padding: 0,
                          }}
                        >
                          {tone.letter}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </AttendanceCard>

      {open && (
        <DayDetailPanel
          day={toAttendanceDay(open.day)}
          uid={open.uid}
          subject={open.name}
          canAdjust={canAdjust}
          onClose={() => setOpen(null)}
          onAdjusted={(message) => {
            setBanner(message);
            team.reload();
          }}
        />
      )}
    </div>
  );
}
