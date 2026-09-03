"use client";

/**
 * Leave approval (§7), and the balances behind it (§6).
 *
 * The decision is the whole screen, so the approver sees what they need to
 * decide **on the row itself**: who, which type, how many days, over what
 * dates, and the reason in their own words. Sending them to a second screen to
 * find the balance is how requests get approved without one being checked.
 *
 * Approving writes the leave onto those attendance days, which is what turns
 * the calendar yellow and keeps the absence sweep off them. Nothing else in the
 * app can write `APPROVED`.
 */

import { useMemo, useState } from "react";
import { Check, Minus, Plus, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useEmployees } from "@/hooks/useEmployees";
import { useLeaveRequests, type LeaveRequestRecord } from "@/hooks/useLeave";
import { decideLeave, adjustLeaveBalance } from "@/lib/clientActions";
import {
  LEAVE_TYPES,
  LEAVE_TYPE_LABELS,
  type LeaveStatus,
  type LeaveType,
} from "@/lib/attendancePolicy";
import { A, AttendanceCard, EmptyState, Figure } from "./attendanceChrome";
import { LeaveStatusChip } from "./MyAttendanceView";

const FILTERS: { key: LeaveStatus | "ALL"; label: string }[] = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL", label: "All" },
];

export function LeaveManagementView() {
  const { user, role, isHr, getIdToken } = useAuth();
  const [filter, setFilter] = useState<LeaveStatus | "ALL">("PENDING");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const { requests, loading, error } = useLeaveRequests(
    isHr ? "all" : "team",
    user?.uid,
    role === "admin" || role === "subadmin"
  );

  const visible = useMemo(
    () => (filter === "ALL" ? requests : requests.filter((request) => request.status === filter)),
    [requests, filter]
  );

  const decide = async (request: LeaveRequestRecord, decision: "APPROVED" | "REJECTED") => {
    setBusyId(request.id);
    const token = await getIdToken();
    const result = await decideLeave(token, request.id, decision, notes[request.id]);
    setBusyId(null);

    setBanner(
      result.ok
        ? {
            ok: true,
            text: `${request.employeeName ?? "The employee"}'s ${
              LEAVE_TYPE_LABELS[request.type]
            } was ${decision === "APPROVED" ? "approved" : "rejected"}. They have been notified.`,
          }
        : { ok: false, text: result.error }
    );
  };

  const pending = requests.filter((request) => request.status === "PENDING");
  const approvedDays = requests
    .filter((request) => request.status === "APPROVED")
    .reduce((sum, request) => sum + request.days, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
          gap: 12,
        }}
      >
        <Figure label="Pending" value={pending.length} tone="LEAVE" note="awaiting a decision" />
        <Figure label="Approved days" value={approvedDays} tone="PRESENT" />
        <Figure label="Requests" value={requests.length} tone="TEAL" note="this year" />
      </div>

      {banner && (
        <p
          role="status"
          style={{
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 600,
            border: `1px solid ${banner.ok ? "#bfe3d2" : "#f0c4bd"}`,
            background: banner.ok ? "#e4f3ec" : "#fdeeeb",
            color: banner.ok ? "#1f7a52" : "#a33a29",
          }}
        >
          {banner.text}
        </p>
      )}

      <AttendanceCard
        title="Leave requests"
        action={
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FILTERS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setFilter(entry.key)}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${filter === entry.key ? A.teal : A.line}`,
                  background: filter === entry.key ? A.tealSoft : A.surface,
                  color: filter === entry.key ? A.teal : A.muted,
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
        }
      >
        {error && (
          <p role="alert" style={{ fontSize: 13, color: "#a33a29", marginBottom: 10 }}>
            {error}
          </p>
        )}

        {visible.length === 0 ? (
          <EmptyState>
            {loading ? "Loading requests." : `No ${filter === "ALL" ? "" : filter.toLowerCase()} requests.`}
          </EmptyState>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {visible.map((request) => (
              <article
                key={request.id}
                style={{
                  borderRadius: 14,
                  border: `1px solid ${request.status === "PENDING" ? "#ecdcae" : A.line}`,
                  background: request.status === "PENDING" ? "#fffdf6" : A.surface,
                  padding: "13px 15px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14.5, fontWeight: 800, color: A.ink }}>
                      {request.employeeName ?? "An employee"}
                    </p>
                    <p style={{ fontSize: 12.5, color: A.muted, fontWeight: 600 }}>
                      {LEAVE_TYPE_LABELS[request.type]} · {request.days} day
                      {request.days === 1 ? "" : "s"} · {request.from}
                      {request.to !== request.from ? ` → ${request.to}` : ""}
                    </p>
                  </div>
                  <LeaveStatusChip status={request.status} />
                </div>

                <p
                  style={{
                    marginTop: 8,
                    borderRadius: 10,
                    background: A.hair,
                    padding: "9px 12px",
                    fontSize: 13,
                    color: A.ink,
                    lineHeight: 1.5,
                  }}
                >
                  {request.reason}
                </p>

                {request.decisionNote && (
                  <p style={{ marginTop: 6, fontSize: 12, color: A.muted }}>
                    Decision note: {request.decisionNote}
                    {request.decidedByName ? ` — ${request.decidedByName}` : ""}
                  </p>
                )}

                {request.status === "PENDING" && (
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <input
                      value={notes[request.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [request.id]: event.target.value }))
                      }
                      placeholder="Note (optional) — the employee sees this"
                      style={{
                        flex: "1 1 200px",
                        borderRadius: 10,
                        border: `1px solid ${A.line}`,
                        background: "#fff",
                        color: A.ink,
                        padding: "8px 11px",
                        fontSize: 16,
                        outline: "none",
                      }}
                    />
                    <button
                      type="button"
                      disabled={busyId === request.id}
                      onClick={() => void decide(request, "APPROVED")}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        borderRadius: 999,
                        border: "none",
                        background: "#2f9e68",
                        color: "#fff",
                        padding: "8px 16px",
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: busyId === request.id ? "wait" : "pointer",
                      }}
                    >
                      <Check size={14} /> Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === request.id}
                      onClick={() => void decide(request, "REJECTED")}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        borderRadius: 999,
                        border: `1px solid #f0c4bd`,
                        background: "#fff",
                        color: "#a33a29",
                        padding: "8px 16px",
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: busyId === request.id ? "wait" : "pointer",
                      }}
                    >
                      <X size={14} /> Reject
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </AttendanceCard>

      {/* Balance adjustments are HR's, not a Sales manager's — granting days is
          a policy decision, and §13 puts policy with HR. */}
      {isHr && <BalanceAdjuster onDone={(text) => setBanner({ ok: true, text })} />}
    </div>
  );
}

function BalanceAdjuster({ onDone }: { onDone: (message: string) => void }) {
  const { getIdToken } = useAuth();
  const { employees } = useEmployees(true);
  const [uid, setUid] = useState("");
  const [type, setType] = useState<LeaveType>("CASUAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (delta: number) => {
    if (!uid) {
      setError("Pick who the days are for.");
      return;
    }
    setError(null);
    setBusy(true);
    const token = await getIdToken();
    const result = await adjustLeaveBalance(token, uid, type, delta);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    const name = employees.find((employee) => employee.uid === uid)?.name ?? "That employee";
    onDone(
      `${name}'s ${LEAVE_TYPE_LABELS[type]} allowance is now adjusted by ${
        result.data.adjustment > 0 ? "+" : ""
      }${result.data.adjustment} day${Math.abs(result.data.adjustment) === 1 ? "" : "s"}.`
    );
  };

  return (
    <AttendanceCard
      title="Adjust a leave balance"
      hint="Added on top of the company allowance, not instead of it"
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <select
          value={uid}
          onChange={(event) => setUid(event.target.value)}
          style={{ ...selectStyle, flex: "1 1 200px" }}
        >
          <option value="">Choose an employee…</option>
          {employees.map((employee) => (
            <option key={employee.uid} value={employee.uid}>
              {employee.name}
            </option>
          ))}
        </select>

        <select
          value={type}
          onChange={(event) => setType(event.target.value as LeaveType)}
          style={{ ...selectStyle, flex: "0 1 170px" }}
        >
          {LEAVE_TYPES.map((value) => (
            <option key={value} value={value}>
              {LEAVE_TYPE_LABELS[value]}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void change(-1)}
            style={stepButton}
            aria-label="Remove a day"
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void change(1)}
            style={{ ...stepButton, background: A.teal, color: "#fff", borderColor: A.teal }}
            aria-label="Grant a day"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" style={{ marginTop: 8, fontSize: 12.5, color: "#a33a29", fontWeight: 600 }}>
          {error}
        </p>
      )}
      <p style={{ marginTop: 8, fontSize: 11.5, color: A.faint }}>
        Raising the company allowance later keeps these adjustments — that is what makes them an
        adjustment rather than a replacement.
      </p>
    </AttendanceCard>
  );
}

const selectStyle: React.CSSProperties = {
  borderRadius: 10,
  border: `1px solid ${A.line}`,
  background: "#fff",
  color: A.ink,
  padding: "9px 11px",
  fontSize: 14,
  fontWeight: 600,
  outline: "none",
  minWidth: 0,
};

const stepButton: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 10,
  border: `1px solid ${A.line}`,
  background: A.surface,
  color: A.ink,
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};
