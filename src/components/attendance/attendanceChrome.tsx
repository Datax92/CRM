"use client";

/**
 * Shared attendance presentation — the status palette, the calendar, the pills.
 *
 * **One palette, four colours, fixed by §3** and since 2026-09-18 taken from
 * `Attendance Calendar.dc.html`: Present teal, Late brown, Absent red, Leave
 * olive. Every screen in the module reads them from here, so a day cannot be
 * one colour on the calendar and a different one in the report.
 *
 * Colours are inline rather than Tailwind arbitrary values, for the reason
 * recorded in `StageChrome`: this project has twice shipped a build whose
 * content scanner never saw a `bg-[#…]` string, and the element then renders
 * with no background at all.
 *
 * Colour is never the only signal. Every cell carries a letter and every pill
 * carries its word, because a calendar that distinguishes "late" from "absent"
 * by hue alone is unreadable to a good number of the people who have to use it.
 */

import { useMemo } from "react";
import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus } from "@/lib/attendance";
import { monthLabel, shiftMonth } from "@/lib/attendanceCalendar";
import { karachiMonthKey } from "@/lib/dates";
import { initialsOf } from "@/lib/leadDisplay";
import { useIsMobile } from "@/hooks/useIsMobile";
import { E } from "@/components/employees/directoryChrome";

/**
 * The module's ground tones.
 *
 * **Aliased onto `directoryChrome`'s `E`** rather than restated, so the
 * attendance screens and the Team screens cannot drift apart by a hex digit.
 * The four status colours below stay the module's own — nothing else in the
 * product has an equivalent.
 */
export const A = {
  ink: E.ink,
  muted: E.muted,
  faint: E.faint,
  line: E.border,
  hair: E.softBorder,
  surface: E.surface,
  ground: E.page,
  teal: E.tealInk,
  tealMid: E.teal,
  tealSoft: E.tealTint,
} as const;

export interface StatusTone {
  soft: string;
  border: string;
  text: string;
  solid: string;
  onSolid: string;
  /** One character for the calendar cell — never colour alone. */
  letter: string;
  /** The legend chip's ground — a shade apart from the cell's `soft`. */
  chip: string;
}

/**
 * §3's four colours, plus the quiet tones for the states it does not name.
 *
 * **Transcribed from `Attendance Calendar.dc.html`** (owner, 2026-09-18), not
 * measured: `color` → `text`/`solid`, `tint` → `soft`, `border` → `border`,
 * `chipTint` → `chip`. Present moved from green to the product's teal with it.
 * Every attendance screen reads this table, so the calendar, the dashboard and
 * the reports change together and a day cannot be one colour here and another
 * there.
 */
export const ATTENDANCE_TONES: Record<AttendanceStatus, StatusTone> = {
  PRESENT: { soft: "#eaf6f4", border: "#cbe6e2", text: "#2f7d78", solid: "#2f7d78", onSolid: "#fff", letter: "P", chip: "#e8f5f3" },
  LATE: { soft: "#fdf4e6", border: "#f0e2c6", text: "#8a6321", solid: "#8a6321", onSolid: "#fff", letter: "L", chip: "#fdf5e6" },
  ABSENT: { soft: "#fdeeec", border: "#f5d9d5", text: "#a8483c", solid: "#a8483c", onSolid: "#fff", letter: "A", chip: "#fdeeec" },
  LEAVE: { soft: "#fbf8e4", border: "#eee6c2", text: "#8a7a21", solid: "#8a7a21", onSolid: "#fff", letter: "V", chip: "#fbf8e4" },
  OFF: { soft: "#f2f6f6", border: "#e2eae9", text: "#8fa2a0", solid: "#c3d2d0", onSolid: "#25403e", letter: "—", chip: "#f2f6f6" },
  // The design's empty day: #fbfdfd ground, #eef4f3 border, the number in #b6cbc9.
  UNRECORDED: { soft: "#fbfdfd", border: "#eef4f3", text: "#b6cbc9", solid: "#e6eeed", onSolid: "#5b6d6b", letter: "·", chip: "#fbfdfd" },
};

/** The four §3 names, in the order a legend should read them. */
export const LEGEND_STATUSES: AttendanceStatus[] = ["PRESENT", "LATE", "ABSENT", "LEAVE"];

export function StatusPill({
  status,
  size = "sm",
}: {
  status: AttendanceStatus;
  size?: "sm" | "md";
}) {
  const tone = ATTENDANCE_TONES[status];
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
        padding: medium ? "4px 11px" : "2px 8px",
        fontSize: medium ? 12 : 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: 999, background: tone.solid, flexShrink: 0 }}
      />
      {ATTENDANCE_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The legend, optionally carrying a count per status.
 *
 * With counts it stops being a key and becomes the month's summary — which is
 * the question somebody actually has when they look at a calendar, and it
 * saves a second strip of figures above it. The chip is the calendar design's:
 * a tinted pill, a dot, the word, and the count in a white bubble.
 */
export function StatusLegend({
  compact = false,
  counts,
}: {
  compact?: boolean;
  counts?: Partial<Record<AttendanceStatus, number>>;
}) {
  return (
    <div
      style={
        // Two even columns on a phone: four chips wrapping 3 + 1 read ragged.
        compact
          ? { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 7, width: "100%" }
          : { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }
      }
    >
      {LEGEND_STATUSES.map((status) => {
        const tone = ATTENDANCE_TONES[status];
        const count = counts?.[status];

        return (
          <div
            key={status}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: compact ? "6px 11px" : "7px 14px",
              borderRadius: 999,
              background: tone.chip,
              border: `1px solid ${tone.border}`,
              fontSize: compact ? 12 : 12.5,
              fontWeight: 700,
              color: tone.text,
              minWidth: 0,
            }}
          >
            <span
              aria-hidden
              style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: tone.text }}
            />
            <span style={{ whiteSpace: "nowrap" }}>{ATTENDANCE_STATUS_LABELS[status]}</span>
            {count !== undefined && (
              <span
                style={{
                  minWidth: 20,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: "#fff",
                  fontSize: 11.5,
                  fontWeight: 800,
                  textAlign: "center",
                  fontVariantNumeric: "tabular-nums",
                  color: tone.text,
                  marginLeft: compact ? "auto" : undefined,
                }}
              >
                {count}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Transcribed from `Attendance Calendar.dc.html` (owner, 2026-09-18). Values are
 * copied from the file, never measured off a screenshot. The design draws the
 * desktop only; the phone variant (`compact`) keeps its colours, borders and
 * marks and drops what a 44px column cannot hold — the pill's word becomes its
 * letter and the time is left to the day's own panel.
 */

export interface CalendarCell {
  dayKey: string;
  day: number;
  status: AttendanceStatus;
  /** The check-in time, `HH:MM` — printed under the status beside a clock. */
  hint?: string | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The four statuses a cell is drawn for. A weekly off, a future day and a day
 * nobody recorded are the design's empty day: no tint, no stripe, a pale number.
 */
const MARKED = new Set<AttendanceStatus>(LEGEND_STATUSES);

/** The design's own greys for the frame, the empty day and the today mark. */
const CAL = {
  frame: "#e2ecea",
  hair: "#eef4f3",
  ink: "#141f1e",
  eyebrow: "#6c7d7b",
  muted: "#5b6d6b",
  dow: "#8fa2a0",
  emptyNumber: "#b6cbc9",
  emptyGround: "#fbfdfd",
  today: "#3f8f8a",
  teal: "#2f7d78",
  tile: "#e4f0ef",
  toggle: "#f0f6f5",
  activeShadow: "0 1px 3px rgba(31,92,88,0.14)",
} as const;

const CALENDAR_CSS = `
.att-cell { transition: transform 200ms cubic-bezier(0.22,0.61,0.36,1), box-shadow 200ms ease; }
.att-cell:hover { transform: translateY(-1px); }
.att-cell:focus-visible { outline: 2px solid #2f7d78; outline-offset: 2px; }
@keyframes att-cell-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; } }
.att-cell-in { animation: att-cell-in 260ms cubic-bezier(0.22,0.61,0.36,1) both; }
@media (prefers-reduced-motion: reduce) {
  .att-cell, .att-cell-in { animation: none !important; transition: none !important; }
  .att-cell:hover { transform: none; }
}
`;

/**
 * A month grid.
 *
 * Sized by `minmax(0, 1fr)` columns rather than fixed cells, so one component
 * is the full calendar on a desktop and a usable one at 390px. The leading
 * blanks come from the first of the month's own weekday, computed in UTC — a
 * calendar date's weekday is a property of the date, so no timezone conversion
 * is involved or wanted.
 */
export function AttendanceCalendar({
  monthKey,
  cells,
  selected,
  onSelect,
  compact,
  today,
}: {
  monthKey: string;
  cells: CalendarCell[];
  selected?: string | null;
  onSelect?: (dayKey: string) => void;
  /** Defaults to the phone layout below 820px. */
  compact?: boolean;
  /** `YYYY-MM-DD`. Marked when it falls inside this month. */
  today?: string;
}) {
  const isMobile = useIsMobile();
  const tight = compact ?? isMobile;
  const byDay = useMemo(() => new Map(cells.map((cell) => [cell.dayKey, cell])), [cells]);

  const [year, month] = monthKey.split("-").map(Number);
  const leading = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const gap = tight ? 5 : 8;

  return (
    <div>
      <style>{CALENDAR_CSS}</style>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap, marginBottom: 8 }}>
        {WEEKDAYS.map((label, index) => (
          <div
            key={index}
            style={{
              textAlign: "center",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: tight ? "1px" : "1.4px",
              textTransform: "uppercase",
              color: CAL.dow,
              paddingBottom: 2,
            }}
          >
            {/* One letter at 390px: "WED" in a 44px column wraps or clips. */}
            {tight ? label.charAt(0) : label}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap }}>
        {Array.from({ length: leading }, (_, index) => (
          <div key={`blank-${index}`} aria-hidden style={{ minHeight: tight ? 58 : 106 }} />
        ))}

        {Array.from({ length: dayCount }, (_, index) => {
          const day = index + 1;
          const dayKey = `${monthKey}-${String(day).padStart(2, "0")}`;
          const cell = byDay.get(dayKey);
          const status = cell?.status ?? "UNRECORDED";
          const marked = MARKED.has(status);
          const tone = ATTENDANCE_TONES[status];
          const isSelected = selected === dayKey;
          const isToday = today === dayKey;

          // The stripe says what the day was; the lift says it is today.
          const shadow =
            [marked ? `inset 3px 0 0 ${tone.text}` : null, isToday ? "0 6px 18px rgba(63,143,138,0.18)" : null]
              .filter(Boolean)
              .join(", ") || "none";

          return (
            <button
              key={dayKey}
              type="button"
              onClick={() => onSelect?.(dayKey)}
              aria-label={`${dayKey} — ${ATTENDANCE_STATUS_LABELS[status]}${cell?.hint ? `, in at ${cell.hint}` : ""}`}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              className={`att-cell ${index < 31 ? "att-cell-in" : ""}`}
              style={{
                position: "relative",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                width: "100%",
                minHeight: tight ? 58 : 106,
                borderRadius: tight ? 12 : 16,
                border:
                  isToday || isSelected
                    ? `1.5px solid ${CAL.today}`
                    : `1px solid ${marked ? tone.border : CAL.hair}`,
                background: marked ? tone.soft : CAL.emptyGround,
                boxShadow: shadow,
                cursor: onSelect ? "pointer" : "default",
                padding: 0,
                textAlign: "left",
                fontFamily: "inherit",
                animationDelay: `${index * 8}ms`,
              }}
            >
              <span
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  padding: tight ? "7px 6px 7px 8px" : "11px 12px",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: tight ? 3 : 6 }}>
                  {isToday ? (
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: tight ? 22 : 26,
                        height: tight ? 22 : 26,
                        borderRadius: "50%",
                        background: CAL.today,
                        color: "#fff",
                        fontSize: tight ? 11.5 : 13,
                        fontWeight: 800,
                        fontVariantNumeric: "tabular-nums",
                        flexShrink: 0,
                      }}
                    >
                      {day}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: tight ? 13 : 16,
                        fontWeight: 800,
                        letterSpacing: "-0.3px",
                        fontVariantNumeric: "tabular-nums",
                        color: marked ? CAL.ink : CAL.emptyNumber,
                      }}
                    >
                      {day}
                    </span>
                  )}
                  {marked && (
                    <span
                      aria-hidden
                      style={{
                        width: tight ? 6 : 8,
                        height: tight ? 6 : 8,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: tone.text,
                      }}
                    />
                  )}
                </span>

                <span style={{ flex: 1 }} />

                {/* The word is the second signal — colour is never on its own. */}
                {marked && (
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5, minWidth: 0 }}>
                    <span
                      style={{
                        maxWidth: "100%",
                        padding: tight ? "1px 6px" : "3px 9px",
                        borderRadius: 999,
                        fontSize: tight ? 9.5 : 10,
                        fontWeight: 800,
                        letterSpacing: "0.3px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        background: "#fff",
                        border: `1px solid ${tone.border}`,
                        color: tone.text,
                      }}
                    >
                      {tight ? tone.letter : ATTENDANCE_STATUS_LABELS[status]}
                    </span>
                    {!tight && cell?.hint && (
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: tone.text,
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden>
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 7.5V12l3.5 2" />
                        </svg>
                        <span>{cell.hint}</span>
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The calendar card                                                           */
/* -------------------------------------------------------------------------- */

export type CalendarScope = "person" | "grid";

const SCOPES: { key: CalendarScope; label: string; d: string }[] = [
  { key: "person", label: "One person", d: "M12 11a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8ZM5 20c0-3.3 3.1-5.2 7-5.2s7 1.9 7 5.2" },
  { key: "grid", label: "Whole team", d: "M4 5h16v14H4zM4 10h16M10 10v9" },
];

const PANEL_CSS = `
.att-step:hover:not(:disabled) { background: #f4f8f7 !important; color: #2f7d78 !important; }
.att-step:focus-visible, .att-scope:focus-visible { outline: 2px solid #2f7d78; outline-offset: 2px; }
.att-select:focus-visible { border-color: #3f8f8a !important; box-shadow: 0 0 0 3px #d6ebe8; }
`;

/**
 * The calendar's card: the month as its title, the scope toggle and the month
 * stepper, a legend bar that doubles as the month's counts, and the body.
 *
 * **One card for every calendar in the module** — the team calendar and a
 * person's own — so the two cannot come to look different. What differs is
 * passed in: the scope toggle only where there is a team to switch to, and the
 * `aside` right of the legend (the person picker, or what the counts cover).
 */
export function CalendarPanel({
  monthKey,
  onMonthChange,
  eyebrow = "Attendance Calendar",
  scope,
  counts,
  aside,
  children,
}: {
  monthKey: string;
  onMonthChange: (next: string) => void;
  eyebrow?: string;
  scope?: { value: CalendarScope; onChange: (next: CalendarScope) => void };
  counts?: Partial<Record<AttendanceStatus, number>>;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  // Never past the current month: a calendar that walks into next year shows
  // nothing but blanks and invites the reader to think data is missing.
  const atLatest = monthKey >= karachiMonthKey();

  const step = (by: number) => {
    const disabled = by > 0 && atLatest;
    return (
      <button
        type="button"
        className="att-step"
        onClick={() => onMonthChange(shiftMonth(monthKey, by))}
        disabled={disabled}
        aria-label={by > 0 ? "Next month" : "Previous month"}
        style={{
          width: 36,
          height: 36,
          borderRadius: 11,
          border: `1px solid ${CAL.frame}`,
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: disabled ? "not-allowed" : "pointer",
          color: disabled ? CAL.emptyNumber : CAL.muted,
          padding: 0,
          flexShrink: 0,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d={by > 0 ? "m10 6 6 6-6 6" : "m14 6-6 6 6 6"} />
        </svg>
      </button>
    );
  };

  const stepper = (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      {step(-1)}
      {step(1)}
    </div>
  );

  const toggle = scope && (
    <div
      role="group"
      aria-label="Calendar scope"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: 4,
        borderRadius: 999,
        background: CAL.toggle,
        width: isMobile ? "100%" : undefined,
      }}
    >
      {SCOPES.map((option) => {
        const active = scope.value === option.key;
        return (
          <button
            key={option.key}
            type="button"
            className="att-scope"
            aria-pressed={active}
            onClick={() => scope.onChange(option.key)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              flex: isMobile ? 1 : undefined,
              padding: "8px 16px",
              borderRadius: 999,
              border: "none",
              fontSize: 12.5,
              fontWeight: 700,
              fontFamily: "inherit",
              cursor: "pointer",
              color: active ? CAL.teal : CAL.muted,
              background: active ? "#fff" : "transparent",
              boxShadow: active ? CAL.activeShadow : "none",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={option.d} />
            </svg>
            <span style={{ whiteSpace: "nowrap" }}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <section
      style={{
        background: "#fff",
        border: `1px solid ${CAL.frame}`,
        borderRadius: 20,
        overflow: "hidden",
        lineHeight: "normal",
      }}
    >
      <style>{PANEL_CSS}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: isMobile ? 12 : 18,
          flexWrap: "wrap",
          padding: isMobile ? "16px 16px 14px" : "18px 22px 16px",
          borderBottom: `1px solid ${CAL.hair}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 14, minWidth: 0, flex: isMobile ? 1 : undefined }}>
          <div
            style={{
              width: isMobile ? 40 : 44,
              height: isMobile ? 40 : 44,
              borderRadius: 14,
              background: CAL.tile,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={CAL.teal} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="4" y="5" width="16" height="16" rx="3" />
              <path d="M8 3v4M16 3v4M4 11h16M9 15l1.8 1.8L15 13" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                color: CAL.eyebrow,
              }}
            >
              {eyebrow}
            </div>
            {/* Family set inline: `@layer base` gives h1–h6 their own. */}
            <h2
              style={{
                fontFamily: E.font,
                fontSize: isMobile ? 20 : 23,
                fontWeight: 800,
                letterSpacing: "-0.8px",
                color: CAL.ink,
                marginTop: 1,
                marginBottom: 0,
                lineHeight: "normal",
                whiteSpace: "nowrap",
              }}
            >
              {monthLabel(monthKey)}
            </h2>
          </div>
        </div>

        {isMobile ? (
          <>
            {stepper}
            {toggle}
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {toggle}
            {stepper}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: isMobile ? 12 : 18,
          flexWrap: "wrap",
          padding: isMobile ? "14px 16px" : "16px 22px",
          background: CAL.emptyGround,
          borderBottom: `1px solid ${CAL.hair}`,
        }}
      >
        <StatusLegend counts={counts} compact={isMobile} />
        {aside}
      </div>

      <div style={{ padding: isMobile ? "12px 12px 16px" : "14px 22px 22px" }}>{children}</div>
    </section>
  );
}

/** The design's person picker: an initials badge and the select beside it. */
export function CalendarPersonPicker({
  value,
  people,
  onChange,
}: {
  value: string;
  people: { uid: string; name: string }[];
  onChange: (uid: string) => void;
}) {
  const isMobile = useIsMobile();
  const current = people.find((person) => person.uid === value);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, width: isMobile ? "100%" : undefined }}>
      <div
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "#f2f8f7",
          border: "1.5px solid #b6d9d5",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 800,
          color: CAL.teal,
          flexShrink: 0,
        }}
      >
        {initialsOf(current?.name)}
      </div>
      <select
        aria-label="Whose calendar"
        className="att-select"
        value={value}
        // Read synchronously — see Lessons on a controlled select after an await.
        onChange={(event) => onChange(event.target.value)}
        style={{
          border: `1px solid ${CAL.frame}`,
          background: "#fff",
          borderRadius: 10,
          padding: "10px 14px",
          // 16px on a phone, or iOS Safari zooms the page on focus.
          fontSize: isMobile ? 16 : 13.5,
          fontWeight: 700,
          fontFamily: "inherit",
          color: CAL.ink,
          outline: "none",
          cursor: "pointer",
          minWidth: 0,
          flex: isMobile ? 1 : undefined,
        }}
      >
        {people.map((person) => (
          <option key={person.uid} value={person.uid}>
            {person.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared shells                                                               */
/* -------------------------------------------------------------------------- */

export function AttendanceCard({
  title,
  hint,
  icon,
  action,
  children,
}: {
  title?: string;
  hint?: string;
  /** Sits left of the heading. Optional — most cards need no icon. */
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{ background: A.surface, border: `1px solid ${A.line}`, borderRadius: 16, overflow: "hidden" }}
    >
      {title && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "12px 16px",
            borderBottom: `1px solid ${A.hair}`,
          }}
        >
          <h3
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "1.2px",
              textTransform: "uppercase",
              color: A.faint,
              fontFamily: E.font,
            }}
          >
            {icon}
            {title}
            {hint && <span style={{ marginLeft: 8, fontWeight: 500, textTransform: "none", color: A.faint }}>{hint}</span>}
          </h3>
          {action}
        </div>
      )}
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

export function Figure({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string | number;
  tone?: AttendanceStatus | "TEAL";
  note?: string;
}) {
  const accent = tone === "TEAL" ? A.teal : tone ? ATTENDANCE_TONES[tone].solid : E.hair;
  const color = tone === "TEAL" ? A.teal : tone ? ATTENDANCE_TONES[tone].text : A.ink;

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: A.surface,
        border: `1px solid ${A.line}`,
        borderRadius: 16,
        padding: "14px 16px",
        minWidth: 0,
      }}
    >
      {/* The directory's accent stripe, so a figure here and a stat card there
          read as the same object rather than two designs. */}
      <span
        aria-hidden
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent }}
      />
      <p
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "1.1px",
          textTransform: "uppercase",
          color: A.faint,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 24,
          fontWeight: 800,
          letterSpacing: "-0.8px",
          color,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.25,
          marginTop: 3,
        }}
      >
        {value}
      </p>
      {note && <p style={{ fontSize: 11, color: A.faint, marginTop: 2 }}>{note}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        borderRadius: 14,
        border: `1px dashed ${A.line}`,
        background: "rgba(255,255,255,0.7)",
        padding: "34px 20px",
        textAlign: "center",
        fontSize: 13,
        color: A.faint,
        lineHeight: 1.6,
      }}
    >
      {children}
    </p>
  );
}
