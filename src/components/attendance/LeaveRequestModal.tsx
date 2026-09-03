"use client";

/**
 * Requesting leave (§6).
 *
 * The form does not stop somebody asking for more days than they have left —
 * it *says* so, and lets them send it. An employee who has run out of casual
 * leave and needs a day for a funeral still has to be able to ask; refusing at
 * the form would only push that conversation off the system, where nobody can
 * approve or record it. The approver sees the same balance and decides.
 */

import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { useAuth } from "@/context/AuthContext";
import { requestLeave } from "@/lib/clientActions";
import {
  LEAVE_TYPES,
  LEAVE_TYPE_LABELS,
  leaveDayCount,
  type LeaveBalance,
  type LeaveType,
} from "@/lib/attendancePolicy";
import { karachiDayKey } from "@/lib/dates";
import { A } from "./attendanceChrome";

export function LeaveRequestModal({
  balances,
  /** Set when HR is filing on somebody's behalf. */
  uid,
  subject,
  onClose,
  onDone,
}: {
  balances: LeaveBalance[];
  uid?: string;
  subject?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { getIdToken } = useAuth();
  const today = karachiDayKey();

  const [type, setType] = useState<LeaveType>("CASUAL");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => leaveDayCount(from, to), [from, to]);
  const balance = balances.find((entry) => entry.type === type);
  const overBalance = balance ? days > balance.remaining : false;

  const submit = async () => {
    setError(null);
    if (days <= 0) {
      setError("The end date is before the start date.");
      return;
    }
    if (!reason.trim()) {
      setError("Say why — an approver has to decide on something.");
      return;
    }

    setSaving(true);
    const token = await getIdToken();
    const result = await requestLeave(token, { type, from, to, reason, uid });
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone(
      `${LEAVE_TYPE_LABELS[type]} requested for ${result.data.days} day${
        result.data.days === 1 ? "" : "s"
      }. It is pending approval.`
    );
  };

  return (
    <OverlayPanel
      title="Request leave"
      subtitle={subject ?? "Sent to your manager for approval"}
      icon={<CalendarClock size={18} color="#fff" />}
      maxWidth={560}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={secondaryButton}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            style={{ ...primaryButton, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Sending…" : "Send request"}
          </button>
        </div>
      }
    >
      <OverlayCard title="Leave details">
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: A.muted }}>Type</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {LEAVE_TYPES.map((value) => {
                const active = value === type;
                const entry = balances.find((item) => item.type === value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setType(value)}
                    style={{
                      borderRadius: 12,
                      border: `1px solid ${active ? A.teal : A.line}`,
                      background: active ? A.tealSoft : "#fff",
                      color: active ? A.teal : A.muted,
                      padding: "9px 14px",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {LEAVE_TYPE_LABELS[value]}
                    <span style={{ display: "block", fontSize: 11, fontWeight: 600, opacity: 0.8 }}>
                      {entry ? `${entry.remaining} of ${entry.allowed} left` : "balance unknown"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 5 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: A.muted }}>From</span>
              <input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  // Keep the range valid rather than letting a backwards range
                  // sit there until Send is pressed.
                  if (event.target.value > to) setTo(event.target.value);
                }}
                style={fieldStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 5 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: A.muted }}>To</span>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(event) => setTo(event.target.value)}
                style={fieldStyle}
              />
            </label>
          </div>

          <p style={{ fontSize: 12.5, color: overBalance ? "#8a6a17" : A.muted, fontWeight: 600 }}>
            {days} day{days === 1 ? "" : "s"} requested
            {overBalance && balance
              ? ` — that is ${days - balance.remaining} more than the ${balance.remaining} you have left. You can still send it; your approver will decide.`
              : ""}
          </p>

          <label style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: A.muted }}>Reason</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="Why you need the time off."
              style={{ ...fieldStyle, resize: "vertical" }}
            />
          </label>

          {error && (
            <p role="alert" style={{ fontSize: 12.5, color: "#a33a29", fontWeight: 600 }}>
              {error}
            </p>
          )}
        </div>
      </OverlayCard>
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
  fontSize: 16,
  fontWeight: 600,
  outline: "none",
};

const primaryButton: React.CSSProperties = {
  borderRadius: 999,
  border: "none",
  background: A.teal,
  color: "#fff",
  padding: "9px 20px",
  fontSize: 13,
  fontWeight: 700,
};

const secondaryButton: React.CSSProperties = {
  borderRadius: 999,
  border: `1px solid ${A.line}`,
  background: A.surface,
  color: A.muted,
  padding: "9px 18px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};
