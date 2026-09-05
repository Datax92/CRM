"use client";

/**
 * The attendance bar, built to `Day End Dashboard.dc.html`.
 *
 * Check In and Check Out are the employee's own, at the owner's request — the
 * activity heartbeat that used to derive them is gone. The times are therefore
 * declared, and so, where the office uses that rule, is the **Wi-Fi network
 * name**: no browser exposes the SSID, so the field beside the buttons is where
 * the employee says which network they are on, once per device. The comparison
 * happens **on the server**, against names this screen never sees — a check
 * whose expected answer is printed beside the field is not a check
 * (see `lib/attendance`).
 *
 * Both roles get the buttons. `onPunch` stays optional so a caller can still
 * render the strip read-only, but nothing does today.
 */

import { formatBusinessDate } from "@/lib/dates";
import {
  formatClock,
  formatWorkedHours,
  NETWORK_LABELS,
  type AttendanceNetwork,
} from "@/lib/attendance";
import type { AttendanceDay } from "@/hooks/useAttendance";
import { NetworkNameField, PunchRulesHint } from "@/components/attendance/NetworkNameField";
import { D } from "./dayEndChrome";

const NETWORK_GLYPH: Record<AttendanceNetwork, string> = {
  // Building, wifi and question-mark, drawn in the design's own 24px stroke style.
  OFFICE: "M4 21V6l8-3 8 3v15M9 21v-5h6v5M8 10h.01M12 10h.01M16 10h.01",
  REMOTE: "M2 8.5a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 15.5a6 6 0 0 1 7 0M12 19h.01",
  UNKNOWN: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 17h.01M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6",
};

/** A value pill. The total is inverted to the darkest teal, as the design does. */
function TimeBox({ label, value, filled }: { label: string; value: string; filled: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 0 }}>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          letterSpacing: "0.1px",
          opacity: 0.92,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          padding: "9px 16px",
          borderRadius: 8,
          fontSize: 13.5,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          background: filled ? D.tealDark : "#fff",
          color: filled ? "#fff" : D.ink,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function AttendanceStrip({
  today,
  onPunch,
  punching,
  checkedOut,
  wifiRequired,
  locationRequired,
}: {
  today: AttendanceDay | null;
  /** Absent for an admin, who has no shift to record. */
  onPunch?: (kind: "IN" | "OUT") => void;
  punching?: boolean;
  checkedOut?: boolean;
  /**
   * Whether this office checks the Wi-Fi network name on check-in. Asked of
   * the server rather than assumed, so the field never appears in an office
   * that does not use the rule — and never *fails* to appear in one that does.
   */
  wifiRequired?: boolean;
  /** Whether check-in confirms the device is at the office. */
  locationRequired?: boolean;
}) {
  const network = today?.network ?? "UNKNOWN";
  const checkedIn = Boolean(today?.firstAt);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "18px 24px",
        minWidth: 0,
        overflow: "hidden",
        padding: "22px 26px",
        borderRadius: D.cardRadius,
        background: D.attendanceBg,
        color: "#fff",
        boxShadow: D.cardShadow,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.7px" }}>Attendance</span>
          <span
            title={`Recorded from ${NETWORK_LABELS[network].toLowerCase()} network`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 9px",
              borderRadius: 16,
              background: "rgba(255,255,255,0.18)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.2px",
              whiteSpace: "nowrap",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={NETWORK_GLYPH[network]} />
            </svg>
            {NETWORK_LABELS[network]}
          </span>
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            opacity: 0.85,
            marginTop: 2,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatBusinessDate(new Date())}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: "14px 20px",
          minWidth: 0,
        }}
      >
        <TimeBox label="Check In" value={formatClock(today?.firstAt ?? null)} filled={false} />
        <TimeBox label="Check Out" value={formatClock(today?.lastAt ?? null)} filled={false} />
        <TimeBox
          label="Total Working hr"
          // A day that has opened but barely run reads "0min". The dash is
          // reserved for a day with no record at all — one glyph for both would
          // hide someone who has just started.
          value={today?.firstAt ? (today.minutes > 0 ? formatWorkedHours(today.minutes) : "0min") : "—"}
          filled
        />

        {/* The declared half of the record, beside the observed half. It is
            deliberately in the same row as the times rather than tucked under
            the card: it is an input to the punch, not a setting. */}
        {onPunch && wifiRequired && <NetworkNameField variant="web" onDark />}

        {onPunch && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.92, whiteSpace: "nowrap" }}>
              {checkedOut ? "Day closed" : checkedIn ? "You are checked in" : "Not checked in"}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {/*
                Both buttons stay on screen rather than one swapping for the
                other. A control that disappears after use leaves no way to see
                what state you are in, and Check Out has to be reachable all day.
              */}
              <PunchButton
                label="Check In"
                onPress={() => onPunch("IN")}
                busy={punching}
                done={checkedIn}
              />
              <PunchButton
                label="Check Out"
                onPress={() => onPunch("OUT")}
                busy={punching}
                done={Boolean(checkedOut)}
                disabled={!checkedIn}
              />
            </div>
          </div>
        )}
      </div>

      {onPunch && (wifiRequired || locationRequired) && (
        <div style={{ flexBasis: "100%", minWidth: 0 }}>
          <PunchRulesHint wifi={Boolean(wifiRequired)} location={Boolean(locationRequired)} onDark />
        </div>
      )}
    </div>
  );
}

/**
 * One punch control.
 *
 * `done` does not disable it — a day can legitimately be re-closed later, and
 * the server keeps whichever time is further out. It only changes the styling,
 * so the button reads as "already done" without becoming a dead end.
 */
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
      onClick={onPress}
      disabled={busy || disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "9px 16px",
        borderRadius: 8,
        border: done ? "1px solid rgba(255,255,255,0.45)" : "1px solid transparent",
        background: done ? "rgba(255,255,255,0.16)" : "#fff",
        color: done ? "#fff" : D.ink,
        fontSize: 13,
        fontWeight: 700,
        whiteSpace: "nowrap",
        cursor: busy || disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : busy ? 0.7 : 1,
        fontFamily: "inherit",
        transition: "opacity 140ms ease",
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
