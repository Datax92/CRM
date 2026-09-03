"use client";

/**
 * One person's own attendance (§10) — the same screen for all three roles.
 *
 * An admin, a manager and an employee all turn up to work, so there is one
 * implementation and the route files differ only in where they sit in the
 * menu. A manager or HR opening somebody else's record passes `uid`; the
 * server refuses a uid outside their scope rather than filtering it away, so
 * this component never has to decide who may be looked at.
 *
 * Everything a person needs to check their own pay against is here: the month
 * graded day by day, the lates with the rule each was charged under, the leave
 * they have left, and the requests they have in flight.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, LogIn, LogOut, Plus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useAttendance } from "@/hooks/useAttendance";
import { useLeaveRequests } from "@/hooks/useLeave";
import { getAttendanceSummary, getLeaveSummary, cancelLeave } from "@/lib/clientActions";
import type { AttendanceSummary } from "@/app/actions/attendance";
import type { LeaveSummary } from "@/app/actions/leave";
import { formatWorkedHours, NETWORK_LABELS } from "@/lib/attendance";
import { LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, formatClockLabel } from "@/lib/attendancePolicy";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { monthLabel, shiftMonth } from "@/lib/attendanceCalendar";
import {
  A,
  AttendanceCalendar,
  AttendanceCard,
  EmptyState,
  Figure,
  StatusLegend,
  type CalendarCell,
} from "./attendanceChrome";
import { DayDetailPanel } from "./DayDetailPanel";
import { LeaveRequestModal } from "./LeaveRequestModal";

export function MonthStepper({
  monthKey,
  onChange,
}: {
  monthKey: string;
  onChange: (next: string) => void;
}) {
  // Never past the current month: a calendar that walks into next year shows
  // nothing but blanks and invites the reader to think data is missing.
  const atLatest = monthKey >= karachiMonthKey();

  const step = (by: number) => (
    <button
      type="button"
      onClick={() => onChange(shiftMonth(monthKey, by))}
      disabled={by > 0 && atLatest}
      aria-label={by > 0 ? "Next month" : "Previous month"}
      style={{
        width: 30,
        height: 30,
        borderRadius: 9,
        border: `1px solid ${A.line}`,
        background: A.surface,
        color: by > 0 && atLatest ? A.faint : A.ink,
        cursor: by > 0 && atLatest ? "not-allowed" : "pointer",
        display: "grid",
        placeItems: "center",
      }}
    >
      {by > 0 ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
    </button>
  );

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {step(-1)}
      <span style={{ fontSize: 13, fontWeight: 700, color: A.ink, minWidth: 120, textAlign: "center" }}>
        {monthLabel(monthKey)}
      </span>
      {step(1)}
    </div>
  );
}

export function MyAttendanceView({
  uid,
  heading = "My Attendance",
  /** Set when a manager is looking at somebody else — hides the punch buttons. */
  readOnly = false,
  /**
   * Whether this screen owns the Check In / Check Out control.
   *
   * **Exactly one screen per role does**, and it defaults to false. An admin
   * and a manager punch on the Attendance Dashboard; an employee punches here,
   * because they have no dashboard. Two screens both able to open the same day
   * is the loophole this flag closes — the record is one document either way,
   * so the second control only ever created doubt about which one had been
   * pressed.
   */
  canPunch = false,
  subject,
}: {
  uid?: string;
  heading?: string;
  readOnly?: boolean;
  canPunch?: boolean;
  subject?: string;
}) {
  const { user, getIdToken } = useAuth();
  const targetUid = uid ?? user?.uid;
  const isSelf = !uid || uid === user?.uid;

  const [monthKey, setMonthKey] = useState(karachiMonthKey());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [leave, setLeave] = useState<LeaveSummary | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const attendance = useAttendance(targetUid, getIdToken, monthKey);
  const requests = useLeaveRequests("self", targetUid, isSelf);

  useEffect(() => {
    if (!targetUid) return;
    let cancelled = false;

    (async () => {
      // The first statement is an await, so nothing sets state synchronously
      // inside the effect — the lint rule this project enforces is right about
      // that, and it also stops a paint with last month's figures.
      const token = await getIdToken().catch(() => "");
      if (cancelled || !token) return;

      const [attendanceResult, leaveResult] = await Promise.all([
        getAttendanceSummary(token, uid, monthKey),
        getLeaveSummary(token, uid, monthKey.slice(0, 4)),
      ]);
      if (cancelled) return;

      setSummary(attendanceResult.ok ? attendanceResult.data : null);
      setLeave(leaveResult.ok ? leaveResult.data : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [targetUid, uid, monthKey, getIdToken, reloadKey]);

  const cells: CalendarCell[] = useMemo(
    () =>
      attendance.days.map((day) => ({
        dayKey: day.dayKey,
        day: day.day,
        status: day.status,
        hint: day.minutes > 0 ? formatWorkedHours(day.minutes) : null,
      })),
    [attendance.days]
  );

  const selected = selectedDay ? attendance.days.find((day) => day.dayKey === selectedDay) : null;

  const punch = useCallback(
    async (kind: "IN" | "OUT") => {
      const result = await attendance.punch(kind);
      setBanner({ ok: result.ok, text: result.message });
      // The summary counts lates, and a check-in can create one.
      setReloadKey((key) => key + 1);
    },
    [attendance]
  );

  const today = attendance.today;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ---------------------------------------------------------------- */}
      {/* Today, and the two buttons                                        */}
      {/* ---------------------------------------------------------------- */}
      <section
        style={{
          borderRadius: 18,
          padding: "18px 20px",
          background: `linear-gradient(135deg, ${A.teal} 0%, ${A.tealMid} 100%)`,
          color: "#fff",
          boxShadow: "0 12px 28px rgba(47,125,120,0.22)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.7px", opacity: 0.82 }}>
              {heading.toUpperCase()}
            </p>
            <h2 style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.25 }}>
              {subject ?? "Today"}
            </h2>
            <p style={{ fontSize: 12.5, opacity: 0.9, marginTop: 2 }}>
              {today
                ? `${today.firstAt ? `In ${today.firstAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Not checked in"} · ${
                    today.lastAt && attendance.checkedOut
                      ? `Out ${today.lastAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                      : "Day open"
                  } · ${NETWORK_LABELS[today.network]}`
                : "Nothing recorded yet today."}
            </p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.6px", opacity: 0.8 }}>
                WORKED
              </p>
              <p style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                {formatWorkedHours(today?.minutes ?? 0)}
              </p>
            </div>

            {canPunch && !readOnly && isSelf && (
              <div style={{ display: "flex", gap: 8 }}>
                {/* Both buttons stay on screen all day. One that swapped for
                    the other would leave no way to see which state you are in,
                    and Check Out has to be reachable at any hour. */}
                <PunchButton
                  icon={<LogIn size={15} />}
                  label="Check In"
                  busy={attendance.punching}
                  onClick={() => void punch("IN")}
                />
                <PunchButton
                  icon={<LogOut size={15} />}
                  label="Check Out"
                  busy={attendance.punching}
                  onClick={() => void punch("OUT")}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      {!canPunch && !readOnly && isSelf && (
        <p style={{ fontSize: 12, color: A.faint, lineHeight: 1.6 }}>
          Check In and Check Out live on the Attendance dashboard — one place, so a day cannot be
          opened twice from two screens.
        </p>
      )}

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

      {attendance.error && (
        <p
          role="alert"
          style={{
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 13,
            border: "1px solid #f0c4bd",
            background: "#fdeeeb",
            color: "#a33a29",
          }}
        >
          {attendance.error}
        </p>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* The month's figures                                               */}
      {/* ---------------------------------------------------------------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
          gap: 12,
        }}
      >
        <Figure label="Present" value={summary?.present ?? 0} tone="PRESENT" />
        <Figure label="Late" value={summary?.late ?? 0} tone="LATE" />
        <Figure label="Absent" value={summary?.absent ?? 0} tone="ABSENT" />
        <Figure label="Leave" value={summary?.leave ?? 0} tone="LEAVE" />
        <Figure label="Attendance" value={`${summary?.rate ?? attendance.rate}%`} tone="TEAL" />
        <Figure
          label="Hours"
          value={formatWorkedHours(summary?.workedMinutes ?? 0)}
          note={`${monthLabel(monthKey)}`}
        />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Calendar                                                          */}
      {/* ---------------------------------------------------------------- */}
      <AttendanceCard
        title="Calendar"
        action={<MonthStepper monthKey={monthKey} onChange={setMonthKey} />}
      >
        {/* The legend carries the month's counts, so it answers the question
            somebody actually has when they look at a calendar rather than
            being a key they have to translate. */}
        <div style={{ marginBottom: 14 }}>
          <StatusLegend
            counts={{
              PRESENT: summary?.present ?? 0,
              LATE: summary?.late ?? 0,
              ABSENT: summary?.absent ?? 0,
              LEAVE: summary?.leave ?? 0,
            }}
          />
        </div>
        <AttendanceCalendar
          monthKey={monthKey}
          cells={cells}
          selected={selectedDay}
          onSelect={setSelectedDay}
          today={karachiDayKey()}
        />
        <p style={{ marginTop: 10, fontSize: 11.5, color: A.faint }}>
          Tap a date for the full record of that day.
        </p>
      </AttendanceCard>

      {/* ---------------------------------------------------------------- */}
      {/* Leave                                                             */}
      {/* ---------------------------------------------------------------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <AttendanceCard
          title="Leave balance"
          hint={leave ? leave.year : undefined}
          action={
            isSelf && !readOnly ? (
              <button
                type="button"
                onClick={() => setRequesting(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 999,
                  border: "none",
                  background: A.teal,
                  color: "#fff",
                  padding: "6px 13px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <Plus size={14} /> Request leave
              </button>
            ) : undefined
          }
        >
          <div style={{ display: "grid", gap: 10 }}>
            {(leave?.balances ?? []).map((balance) => (
              <div
                key={balance.type}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  borderRadius: 12,
                  border: `1px solid ${A.line}`,
                  padding: "10px 13px",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: A.ink }}>
                    {LEAVE_TYPE_LABELS[balance.type]}
                  </p>
                  <p style={{ fontSize: 11.5, color: A.faint }}>
                    {balance.used} used of {balance.allowed} this year
                  </p>
                </div>
                <p
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: balance.remaining > 0 ? A.teal : "#a33a29",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {balance.remaining}
                </p>
              </div>
            ))}
            {leave && leave.pendingDays > 0 && (
              <p style={{ fontSize: 12, color: A.muted }}>
                {leave.pendingDays} day{leave.pendingDays === 1 ? "" : "s"} awaiting a decision — not
                deducted until approved.
              </p>
            )}
            {!leave && <EmptyState>Leave balances are loading.</EmptyState>}
          </div>
        </AttendanceCard>

        <AttendanceCard title="My leave requests">
          {requests.requests.length === 0 ? (
            <EmptyState>No leave requested yet this year.</EmptyState>
          ) : (
            <div style={{ display: "grid", gap: 9 }}>
              {requests.requests.slice(0, 8).map((request) => (
                <div
                  key={request.id}
                  style={{
                    borderRadius: 12,
                    border: `1px solid ${A.line}`,
                    padding: "10px 13px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: A.ink }}>
                      {LEAVE_TYPE_LABELS[request.type]} · {request.days} day
                      {request.days === 1 ? "" : "s"}
                    </p>
                    <p style={{ fontSize: 11.5, color: A.faint }}>
                      {request.from}
                      {request.to !== request.from ? ` → ${request.to}` : ""}
                      {request.decisionNote ? ` · ${request.decisionNote}` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <LeaveStatusChip status={request.status} />
                    {request.status === "PENDING" && isSelf && !readOnly && (
                      <button
                        type="button"
                        onClick={async () => {
                          const token = await getIdToken();
                          const result = await cancelLeave(token, request.id);
                          setBanner(
                            result.ok
                              ? { ok: true, text: "Request withdrawn." }
                              : { ok: false, text: result.error }
                          );
                          setReloadKey((key) => key + 1);
                        }}
                        style={{
                          borderRadius: 999,
                          border: `1px solid ${A.line}`,
                          background: A.surface,
                          color: A.muted,
                          padding: "3px 10px",
                          fontSize: 11.5,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </AttendanceCard>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Lates and what they cost                                          */}
      {/* ---------------------------------------------------------------- */}
      <AttendanceCard
        title="Late record"
        hint={
          summary
            ? `Late after ${formatClockLabel(summary.rules.lateAfter)} · ${summary.rules.allowedLates} allowed each month`
            : undefined
        }
      >
        {!summary || summary.deductions.length === 0 ? (
          <EmptyState>
            No late arrivals recorded this month.
            {summary
              ? ` Checking in after ${formatClockLabel(summary.rules.lateAfter)} counts as late.`
              : ""}
          </EmptyState>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {summary.deductions.map((deduction) => (
              <div
                key={deduction.occurrence}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderRadius: 12,
                  border: `1px solid ${deduction.deducted ? "#e0cdb4" : A.line}`,
                  background: deduction.deducted ? "#f3ece2" : A.surface,
                  padding: "9px 13px",
                }}
              >
                <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
                  <Clock size={15} color={deduction.deducted ? "#7a5230" : A.faint} />
                  <div>
                    <p style={{ fontSize: 12.5, fontWeight: 700, color: A.ink }}>
                      Late #{deduction.occurrence}
                    </p>
                    {/* The rule in words, stored with the figure — §12 wants a
                        deduction that can still explain itself after the
                        policy moves. */}
                    <p style={{ fontSize: 11.5, color: A.muted }}>{deduction.basis}</p>
                  </div>
                </div>
                <p
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: deduction.deducted ? "#a33a29" : A.faint,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {deduction.deducted ? `− Rs ${deduction.amount.toLocaleString("en-PK")}` : "No charge"}
                </p>
              </div>
            ))}
            <p style={{ fontSize: 13, fontWeight: 700, color: A.ink, textAlign: "right" }}>
              Deducted this month: Rs {summary.deductionTotal.toLocaleString("en-PK")}
            </p>
          </div>
        )}
      </AttendanceCard>

      {selected && (
        <DayDetailPanel
          day={selected}
          uid={targetUid ?? ""}
          subject={subject ?? "You"}
          canAdjust={false}
          onClose={() => setSelectedDay(null)}
        />
      )}

      {requesting && (
        <LeaveRequestModal
          balances={leave?.balances ?? []}
          onClose={() => setRequesting(false)}
          onDone={(message) => {
            setRequesting(false);
            setBanner({ ok: true, text: message });
            setReloadKey((key) => key + 1);
          }}
        />
      )}
    </div>
  );
}

function PunchButton({
  icon,
  label,
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.5)",
        background: "rgba(255,255,255,0.18)",
        color: "#fff",
        padding: "9px 16px",
        fontSize: 13,
        fontWeight: 700,
        cursor: busy ? "wait" : "pointer",
        opacity: busy ? 0.7 : 1,
      }}
    >
      {icon}
      {busy ? "Working…" : label}
    </button>
  );
}

export function LeaveStatusChip({ status }: { status: keyof typeof LEAVE_STATUS_LABELS }) {
  const tone =
    status === "APPROVED"
      ? { bg: "#e4f3ec", border: "#bfe3d2", text: "#1f7a52" }
      : status === "REJECTED"
        ? { bg: "#fdeeeb", border: "#f0c4bd", text: "#a33a29" }
        : status === "CANCELLED"
          ? { bg: "#f2f6f6", border: "#e2eae9", text: "#8fa2a0" }
          : { bg: "#fdf5e0", border: "#ecdcae", text: "#8a6a17" };

  return (
    <span
      style={{
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.text,
        padding: "2px 9px",
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {LEAVE_STATUS_LABELS[status]}
    </span>
  );
}
