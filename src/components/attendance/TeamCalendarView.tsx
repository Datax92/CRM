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
 * The frame is `Attendance Calendar.dc.html` (owner, 2026-09-18), drawn by
 * `CalendarPanel` so the person's own calendar wears the same one.
 *
 * Clicking any day opens the same `DayDetailPanel` the employee's own screen
 * uses, which is where HR corrects a day (§11).
 */

import { useMemo, useState } from "react";
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
  CalendarPanel,
  CalendarPersonPicker,
  EmptyState,
  type CalendarScope,
} from "./attendanceChrome";
import { DayDetailPanel } from "./DayDetailPanel";

function resolveDay(dayKey: string, existing?: TeamAttendanceDay): TeamAttendanceDay {
  return (
    existing ?? {
      dayKey,
      status: "UNRECORDED",
      late: false,
      lateByMinutes: 0,
      minutes: 0,
      network: "UNKNOWN",
      checkIn: null,
      checkOut: null,
      leaveType: null,
      note: null,
      adjusted: false,
    }
  );
}

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
      adjustedCheckIn: day.checkIn,
      adjustedCheckOut: day.checkOut,
      leaveType: (day.leaveType as "CASUAL" | "MEDICAL" | undefined) ?? undefined,
    },
  };
}

export function TeamCalendarView({ canAdjust }: { canAdjust: boolean }) {
  const { user } = useAuth();
  const [monthKey, setMonthKey] = useState(karachiMonthKey());
  const [mode, setMode] = useState<CalendarScope>("person");
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

  // In the team view the legend counts everybody's days, and the aside says so
  // — one person's figures beside a grid of forty rows would read as the team's.
  const teamCounts = useMemo(
    () =>
      team.rows.reduce(
        (sum, row) => ({
          PRESENT: sum.PRESENT + row.present,
          LATE: sum.LATE + row.late,
          ABSENT: sum.ABSENT + row.absent,
          LEAVE: sum.LEAVE + row.leave,
        }),
        { PRESENT: 0, LATE: 0, ABSENT: 0, LEAVE: 0 }
      ),
    [team.rows]
  );

  const counts: Partial<Record<AttendanceStatus, number>> | undefined =
    mode === "grid"
      ? teamCounts
      : person
        ? { PRESENT: person.present, LATE: person.late, ABSENT: person.absent, LEAVE: person.leave }
        : undefined;

  const dayCount = daysInMonth(monthKey);
  const today = karachiDayKey();

  const aside =
    team.rows.length === 0 ? undefined : mode === "person" ? (
      <CalendarPersonPicker value={activeUid ?? ""} people={team.rows} onChange={setPersonUid} />
    ) : (
      <span style={{ fontSize: 12.5, fontWeight: 700, color: A.muted }}>
        Whole team · {team.rows.length} {team.rows.length === 1 ? "person" : "people"}
      </span>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <CalendarPanel
        monthKey={monthKey}
        onMonthChange={setMonthKey}
        scope={{ value: mode, onChange: setMode }}
        counts={counts}
        aside={aside}
      >
        {banner && (
          <p
            role="status"
            style={{
              marginBottom: 12,
              borderRadius: 10,
              border: `1px solid ${ATTENDANCE_TONES.PRESENT.border}`,
              background: ATTENDANCE_TONES.PRESENT.soft,
              color: ATTENDANCE_TONES.PRESENT.text,
              padding: "9px 12px",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            {banner}
          </p>
        )}

        {team.error && (
          <p role="alert" style={{ fontSize: 13, color: ATTENDANCE_TONES.ABSENT.text, marginBottom: 12 }}>
            {team.error}
          </p>
        )}

        {team.rows.length === 0 ? (
          <EmptyState>{team.loading ? "Loading." : "Nobody is on your team yet."}</EmptyState>
        ) : mode === "person" ? (
          <AttendanceCalendar
            monthKey={monthKey}
            cells={cells}
            today={today}
            onSelect={(dayKey) => {
              if (!person) return;
              const existingDay = person.days.find((entry) => entry.dayKey === dayKey);
              const day = resolveDay(dayKey, existingDay);
              setOpen({ uid: person.uid, name: person.name, day });
            }}
          />
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
                  marginBottom: 6,
                }}
              >
                <span />
                {Array.from({ length: dayCount }, (_, index) => {
                  const isToday = `${monthKey}-${String(index + 1).padStart(2, "0")}` === today;
                  return (
                    <span
                      key={index}
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        color: isToday ? "#fff" : "#8fa2a0",
                        background: isToday ? "#3f8f8a" : "transparent",
                        borderRadius: 999,
                        textAlign: "center",
                        fontVariantNumeric: "tabular-nums",
                        lineHeight: "18px",
                      }}
                    >
                      {index + 1}
                    </span>
                  );
                })}
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
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: "#141f1e",
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
                      const targetDay = resolveDay(dayKey, day);
                      const status: AttendanceStatus = targetDay.status;
                      const tone = ATTENDANCE_TONES[status];
                      return (
                        <button
                          key={dayKey}
                          type="button"
                          disabled={!canAdjust && !day}
                          onClick={() => (canAdjust || day) && setOpen({ uid: row.uid, name: row.name, day: targetDay })}
                          aria-label={`${row.name} — ${dayKey}`}
                          title={`${dayKey} · ${status}`}
                          style={{
                            height: 26,
                            borderRadius: 7,
                            border: `1px solid ${tone.border}`,
                            background: tone.soft,
                            color: tone.text,
                            fontSize: 9.5,
                            fontWeight: 800,
                            cursor: canAdjust || day ? "pointer" : "default",
                            padding: 0,
                            fontFamily: "inherit",
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
      </CalendarPanel>

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
