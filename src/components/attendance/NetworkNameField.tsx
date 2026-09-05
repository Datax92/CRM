"use client";

/**
 * "Which Wi-Fi are you on?" — the one thing the browser cannot answer for
 * itself.
 *
 * **No web API exposes the SSID**, on any platform or browser. Presence is
 * already declared (Check In is a button, not an observation); with this rule
 * switched on, *where* is declared too, and this field is where the employee
 * declares it. The comparison still happens on the server, against the list an
 * admin typed into Attendance Settings — a client-side comparison would be
 * bypassed in seconds, and a dropdown of accepted names would hand the answer
 * to anyone who wanted to guess it, so this is a plain text field.
 *
 * It is remembered **per device** (`useStoredNetworkName`), so it is typed once
 * and never again: one person's phone and their desk machine are on different
 * networks, and a value stored against the account would make each overwrite
 * the other.
 *
 * One implementation, two sizes. A second phone-only copy is how the two
 * surfaces end up disagreeing about what they are asking for.
 */

import { useStoredNetworkName, writeStoredNetworkName } from "@/hooks/useAttendance";

export function NetworkNameField({
  variant,
  /** Rendered on the dark attendance strip rather than on a white card. */
  onDark = false,
}: {
  variant: "web" | "phone";
  onDark?: boolean;
}) {
  const value = useStoredNetworkName();
  const phone = variant === "phone";

  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
        // Wide enough for a real SSID and no wider: it sits beside three time
        // pills on the desktop strip and must not push Check Out off the row.
        flex: phone ? "1 1 100%" : "0 1 210px",
      }}
    >
      <span
        style={{
          fontSize: phone ? 10.5 : 12.5,
          fontWeight: phone ? 700 : 600,
          letterSpacing: phone ? "0.9px" : "0.1px",
          textTransform: phone ? "uppercase" : "none",
          whiteSpace: "nowrap",
          color: onDark ? undefined : "#8fa2a0",
          opacity: onDark ? 0.92 : 1,
        }}
      >
        {phone ? "Your Wi-Fi network" : "Wi-Fi network"}
      </span>

      <input
        type="text"
        value={value}
        onChange={(event) => writeStoredNetworkName(event.target.value)}
        placeholder="e.g. Leadway-Office"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-label="The name of the Wi-Fi network you are connected to"
        style={{
          width: "100%",
          minWidth: 0,
          borderRadius: 8,
          padding: phone ? "11px 13px" : "9px 12px",
          // 16px on the phone, or iOS Safari zooms the whole page on focus.
          fontSize: phone ? 16 : 13.5,
          fontWeight: 600,
          fontFamily: "inherit",
          outline: "none",
          border: onDark ? "1px solid rgba(255,255,255,0.45)" : "1px solid #dceae8",
          background: onDark ? "rgba(255,255,255,0.92)" : "#f7fbfa",
          color: "#1f3b39",
        }}
      />
    </label>
  );
}

/**
 * The sentence under the controls: what check-in is about to check, in advance.
 *
 * **Location is named before it is asked for.** A permission prompt that
 * arrives with no explanation is one people decline out of caution, and a
 * declined prompt is an employee who cannot check in at all. Saying "it reads
 * your location when you press Check In, and only then" before the browser asks
 * is the difference between a tap and a support conversation.
 *
 * A rule the employee cannot see is a rule they will not trust — and one they
 * believe is automatic is one they will report as broken the first time it
 * refuses them.
 */
export function PunchRulesHint({
  wifi,
  location,
  onDark = false,
}: {
  wifi: boolean;
  location: boolean;
  onDark?: boolean;
}) {
  if (!wifi && !location) return null;

  return (
    <p
      style={{
        margin: 0,
        fontSize: 11.5,
        fontWeight: 500,
        lineHeight: 1.45,
        color: onDark ? undefined : "#8fa2a0",
        opacity: onDark ? 0.82 : 1,
      }}
    >
      {location && (
        <>
          Check-in confirms you are at the office, so your browser will ask to share your location.
          It is read at the moment you press Check In and at no other time.{" "}
        </>
      )}
      {wifi && (
        <>
          Type the Wi-Fi network name exactly as it appears on your device — this browser remembers
          it, so you only do it once.{" "}
        </>
      )}
      Check <em>out</em> is never blocked, from anywhere.
    </p>
  );
}
