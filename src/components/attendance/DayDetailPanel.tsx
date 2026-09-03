"use client";

/**
 * One day, in full (§3) — and, for HR, the place a day gets corrected (§11).
 *
 * The correction never overwrites what was observed. The recorded check-in and
 * check-out stay on screen beside the adjusted ones, and every change is
 * appended to the day's own history with who made it and when. A correction
 * that destroyed the original would leave nothing to check the correction
 * against, which is precisely what a payroll dispute needs.
 */

import { useState } from "react";
import { History, ShieldCheck } from "lucide-react";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { useAuth } from "@/context/AuthContext";
import { adjustAttendance } from "@/lib/clientActions";
import { formatWorkedHours, NETWORK_LABELS, ATTENDANCE_STATUS_LABELS } from "@/lib/attendance";
import type { AttendanceStatus } from "@/lib/attendance";
import type { AttendanceDay } from "@/hooks/useAttendance";
import { A, StatusPill } from "./attendanceChrome";

const ADJUSTABLE: AttendanceStatus[] = ["PRESENT", "LATE", "ABSENT", "LEAVE", "HALF_DAY", "OFF"];

function clock(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        padding: "7px 0",
        borderBottom: `1px solid ${A.hair}`,
      }}
    >
      <span style={{ fontSize: 12, color: A.faint, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 13, color: A.ink, fontWeight: 600, textAlign: "right", minWidth: 0 }}>
        {value}
      </span>
    </div>
  );
}

export function DayDetailPanel({
  day,
  uid,
  subject,
  canAdjust,
  onClose,
  onAdjusted,
}: {
  day: AttendanceDay;
  uid: string;
  subject: string;
  /** HR and the admin only. A Sales manager may correct their own team too. */
  canAdjust: boolean;
  onClose: () => void;
  onAdjusted?: (message: string) => void;
}) {
  const { getIdToken } = useAuth();
  const record = day.record;

  const [status, setStatus] = useState<AttendanceStatus | "">("");
  const [checkIn, setCheckIn] = useState(record?.adjustedCheckIn ?? "");
  const [checkOut, setCheckOut] = useState(record?.adjustedCheckOut ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!status && !checkIn && !checkOut && !note.trim()) {
      setError("Change something first — a status, a time, or a note explaining the day.");
      return;
    }
    setSaving(true);
    const token = await getIdToken();
    const result = await adjustAttendance(token, uid, day.dayKey, {
      ...(status ? { status } : {}),
      ...(checkIn ? { checkIn } : {}),
      ...(checkOut ? { checkOut } : {}),
      note,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onAdjusted?.(`${day.dayKey} updated. ${subject} has been notified.`);
    onClose();
  };

  return (
    <OverlayPanel
      title={day.dayKey}
      subtitle={subject}
      maxWidth={640}
      onClose={onClose}
      headerAside={<StatusPill status={day.status} size="md" />}
      footer={
        canAdjust ? (
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                borderRadius: 999,
                border: `1px solid ${A.line}`,
                background: A.surface,
                color: A.muted,
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              style={{
                borderRadius: 999,
                border: "none",
                background: A.teal,
                color: "#fff",
                padding: "9px 20px",
                fontSize: 13,
                fontWeight: 700,
                cursor: saving ? "wait" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving…" : "Save correction"}
            </button>
          </div>
        ) : undefined
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <OverlayCard title="What was recorded">
          <div style={{ padding: "2px 2px 0" }}>
            <Row label="Status" value={ATTENDANCE_STATUS_LABELS[day.status]} />
            <Row label="Check in" value={clock(day.firstAt)} />
            <Row label="Check out" value={clock(day.lastAt)} />
            <Row label="Hours" value={formatWorkedHours(day.minutes)} />
            <Row label="Network" value={NETWORK_LABELS[day.network]} />
            {record?.checkInIp && <Row label="IP" value={record.checkInIp} />}
            {record?.late && (
              <Row
                label="Late by"
                value={`${record.lateByMinutes ?? 0} min${
                  record.lateAfter ? ` (after ${record.lateAfter})` : ""
                }`}
              />
            )}
            {record?.leaveType && <Row label="Leave" value={record.leaveType} />}
            {record?.overrideNote && <Row label="Note" value={record.overrideNote} />}
          </div>
        </OverlayCard>

        {/* The record of every correction, in the order they were made. */}
        {record?.adjustments && record.adjustments.length > 0 && (
          <OverlayCard title="Corrections" icon={<History size={14} color={A.muted} />}>
            <div style={{ display: "grid", gap: 8 }}>
              {record.adjustments.map((entry, index) => (
                <div
                  key={index}
                  style={{
                    borderRadius: 10,
                    border: `1px solid ${A.line}`,
                    padding: "8px 11px",
                    fontSize: 12,
                    color: A.muted,
                  }}
                >
                  <p style={{ fontWeight: 700, color: A.ink }}>
                    {entry.byName ?? "An administrator"}
                    {entry.to?.status ? ` set ${ATTENDANCE_STATUS_LABELS[entry.to.status]}` : " made a change"}
                  </p>
                  {entry.note && <p>{entry.note}</p>}
                </div>
              ))}
            </div>
          </OverlayCard>
        )}

        {canAdjust && (
          <OverlayCard
            title="Correct this day"
            icon={<ShieldCheck size={14} color={A.teal} />}
            hint="The recorded times above are kept."
          >
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 5 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: A.muted }}>Status</span>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as AttendanceStatus | "")}
                  style={fieldStyle}
                >
                  <option value="">Leave as recorded</option>
                  {ADJUSTABLE.map((value) => (
                    <option key={value} value={value}>
                      {ATTENDANCE_STATUS_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "grid", gap: 5 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: A.muted }}>Check in</span>
                  <input
                    type="time"
                    value={checkIn}
                    onChange={(event) => setCheckIn(event.target.value)}
                    style={fieldStyle}
                  />
                </label>
                <label style={{ display: "grid", gap: 5 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: A.muted }}>Check out</span>
                  <input
                    type="time"
                    value={checkOut}
                    onChange={(event) => setCheckOut(event.target.value)}
                    style={fieldStyle}
                  />
                </label>
              </div>

              <label style={{ display: "grid", gap: 5 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: A.muted }}>
                  Reason — the employee sees this
                </span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  placeholder="Client visit, approved leave, system error…"
                  style={{ ...fieldStyle, resize: "vertical" }}
                />
              </label>

              {error && (
                <p style={{ fontSize: 12.5, color: "#a33a29", fontWeight: 600 }} role="alert">
                  {error}
                </p>
              )}
            </div>
          </OverlayCard>
        )}
      </div>
    </OverlayPanel>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: `1px solid ${A.line}`,
  background: "#fff",
  color: A.ink,
  padding: "9px 11px",
  // 16px on the phone or iOS zooms the whole page on focus.
  fontSize: 16,
  fontWeight: 600,
  outline: "none",
};
