"use client";

/**
 * Shared attendance presentation — the status palette, the calendar, the pills.
 *
 * **One palette, four colours, fixed by §3**: Present green, Late brown, Absent
 * red, Leave yellow. Every screen in the module reads them from here, so a day
 * cannot be one green on the calendar and a different green in the report.
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
}

/** §3's four colours, plus the quiet tones for the states it does not name. */
export const ATTENDANCE_TONES: Record<AttendanceStatus, StatusTone> = {
  PRESENT: { soft: "#e4f3ec", border: "#bfe3d2", text: "#1f7a52", solid: "#2f9e68", onSolid: "#fff", letter: "P" },
  LATE: { soft: "#f3ece2", border: "#e0cdb4", text: "#7a5230", solid: "#8a5a33", onSolid: "#fff", letter: "L" },
  ABSENT: { soft: "#fdeeeb", border: "#f0c4bd", text: "#a33a29", solid: "#c0503c", onSolid: "#fff", letter: "A" },
  LEAVE: { soft: "#fdf5e0", border: "#ecdcae", text: "#8a6a17", solid: "#d9ad2b", onSolid: "#3a2d05", letter: "V" },
  HALF_DAY: { soft: "#eef6fb", border: "#cfe2ee", text: "#3f7ea3", solid: "#4d86a8", onSolid: "#fff", letter: "H" },
  OFF: { soft: "#f2f6f6", border: "#e2eae9", text: "#8fa2a0", solid: "#c3d2d0", onSolid: "#25403e", letter: "—" },
  UNRECORDED: { soft: "#f9fbfb", border: "#eef3f2", text: "#b3c4c2", solid: "#e6eeed", onSolid: "#5b6d6b", letter: "·" },
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
 * saves a second strip of figures above it.
 */
export function StatusLegend({
  compact = false,
  counts,
}: {
  compact?: boolean;
  counts?: Partial<Record<AttendanceStatus, number>>;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: compact ? 7 : 9, alignItems: "center" }}>
      {LEGEND_STATUSES.map((status) => {
        const tone = ATTENDANCE_TONES[status];
        const count = counts?.[status];

        return (
          <span
            key={status}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              borderRadius: 999,
              border: `1px solid ${tone.border}`,
              background: tone.soft,
              color: tone.text,
              padding: compact ? "3px 9px" : "4px 11px",
              fontSize: compact ? 11 : 11.5,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            <span
              aria-hidden
              style={{ width: 9, height: 9, borderRadius: 3, background: tone.solid, flexShrink: 0 }}
            />
            {ATTENDANCE_STATUS_LABELS[status]}
            {count !== undefined && (
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>{count}</strong>
            )}
          </span>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                    */
/* -------------------------------------------------------------------------- */

export interface CalendarCell {
  dayKey: string;
  day: number;
  status: AttendanceStatus;
  /** Rendered under the letter when there is room — a time, usually. */
  hint?: string | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CALENDAR_CSS = `
.att-cell { transition: transform 130ms cubic-bezier(0.22,0.61,0.36,1), box-shadow 130ms ease; }
.att-cell:hover { transform: translateY(-1px); }
.att-cell:focus-visible { outline: 2px solid #2f7d78; outline-offset: 2px; }
@keyframes att-cell-in { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: none; } }
.att-cell-in { animation: att-cell-in 220ms cubic-bezier(0.22,0.61,0.36,1) both; }
@media (prefers-reduced-motion: reduce) {
  .att-cell, .att-cell-in { animation: none !important; transition: none !important; }
}
`;

/**
 * A month grid.
 *
 * Sized by `minmax(0, 1fr)` columns rather than fixed cells, so the same
 * component is a full calendar on a desktop and a comfortable one at 390px
 * without a second implementation. The leading blanks come from the first of
 * the month's own weekday, computed in UTC — a calendar date's weekday is a
 * property of the date, so no timezone conversion is involved or wanted.
 */
export function AttendanceCalendar({
  monthKey,
  cells,
  selected,
  onSelect,
  compact = false,
  today,
}: {
  monthKey: string;
  cells: CalendarCell[];
  selected?: string | null;
  onSelect?: (dayKey: string) => void;
  compact?: boolean;
  /** `YYYY-MM-DD`. Ringed when it falls inside this month. */
  today?: string;
}) {
  const byDay = useMemo(() => new Map(cells.map((cell) => [cell.dayKey, cell])), [cells]);

  const [year, month] = monthKey.split("-").map(Number);
  const leading = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return (
    <div>
      <style>{CALENDAR_CSS}</style>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: compact ? 5 : 8,
          marginBottom: 8,
        }}
      >
        {WEEKDAYS.map((label, index) => (
          <div
            key={index}
            style={{
              textAlign: "center",
              fontSize: compact ? 9.5 : 10.5,
              fontWeight: 700,
              letterSpacing: "0.9px",
              textTransform: "uppercase",
              color: A.faint,
            }}
          >
            {/* One letter at 390px: "Wed" in a 44px column wraps or clips. */}
            {compact ? label.charAt(0) : label}
          </div>
        ))}
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: compact ? 5 : 8 }}
      >
        {Array.from({ length: leading }, (_, index) => (
          <div key={`blank-${index}`} aria-hidden />
        ))}

        {Array.from({ length: dayCount }, (_, index) => {
          const day = index + 1;
          const dayKey = `${monthKey}-${String(day).padStart(2, "0")}`;
          const cell = byDay.get(dayKey);
          const status = cell?.status ?? "UNRECORDED";
          const tone = ATTENDANCE_TONES[status];
          const isSelected = selected === dayKey;
          const isToday = today === dayKey;

          return (
            <button
              key={dayKey}
              type="button"
              onClick={() => onSelect?.(dayKey)}
              aria-label={`${dayKey} — ${ATTENDANCE_STATUS_LABELS[status]}`}
              aria-pressed={isSelected}
              className={`att-cell ${index < 31 ? "att-cell-in" : ""}`}
              style={{
                position: "relative",
                aspectRatio: "1 / 1",
                minHeight: compact ? 42 : 58,
                borderRadius: compact ? 11 : 14,
                border: `1px solid ${isSelected ? A.teal : tone.border}`,
                background: tone.soft,
                color: tone.text,
                cursor: onSelect ? "pointer" : "default",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                padding: 2,
                boxShadow: isSelected
                  ? `0 0 0 2px ${A.tealSoft}, 0 6px 14px rgba(31,92,88,0.14)`
                  : "none",
                animationDelay: `${index * 8}ms`,
                fontFamily: "inherit",
              }}
            >
              {/* Today is **ringed, not filled**: a fill would need a fifth
                  colour competing with the four that carry meaning, whereas a
                  ring says "you are here" without claiming to be a status. */}
              {isToday && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 3,
                    borderRadius: compact ? 8 : 11,
                    border: `1.5px dashed ${A.teal}`,
                    opacity: 0.75,
                    pointerEvents: "none",
                  }}
                />
              )}

              <span
                style={{
                  fontSize: compact ? 13 : 15,
                  fontWeight: 800,
                  lineHeight: 1,
                  letterSpacing: "-0.4px",
                }}
              >
                {day}
              </span>
              {/* The letter is the second signal — colour is never on its own. */}
              <span
                style={{
                  fontSize: compact ? 8.5 : 9,
                  fontWeight: 800,
                  letterSpacing: "0.6px",
                  opacity: 0.72,
                  lineHeight: 1,
                }}
              >
                {tone.letter}
              </span>
              {!compact && cell?.hint && (
                <span style={{ fontSize: 8.5, fontWeight: 700, opacity: 0.66, lineHeight: 1 }}>
                  {cell.hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
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
