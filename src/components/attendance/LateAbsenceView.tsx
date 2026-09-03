"use client";

/**
 * Late and absence records (§5), and the deduction they add up to (§12).
 *
 * Every late is listed as its own line — the date, how many minutes, and
 * **the rule it was charged under, in words**. A month's total that cannot be
 * broken back down into the days that produced it is a figure nobody can
 * dispute or verify, which is exactly what payroll arguments are made of.
 *
 * The deductions shown here are a *proposal*, not a posting. Nothing is
 * written to the Money hub until an admin finalises the period, and §12 is
 * explicit that finalising must not be re-run over a period already closed.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Lock, Unlock } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTeamAttendance } from "@/hooks/useTeamAttendance";
import {
  finalizeAttendanceDeductions,
  getAttendancePeriod,
  reopenAttendancePeriod,
} from "@/lib/clientActions";
import type { AttendancePeriod } from "@/app/actions/attendance";
import { lateDeduction, formatClockLabel } from "@/lib/attendancePolicy";
import { karachiMonthKey } from "@/lib/dates";
import { monthRange } from "@/lib/attendanceCalendar";
import { A, AttendanceCard, EmptyState, Figure, StatusPill } from "./attendanceChrome";
import { MonthStepper } from "./MyAttendanceView";

export function LateAbsenceView({ canFinalize = false }: { canFinalize?: boolean }) {
  const { getIdToken } = useAuth();
  const [monthKey, setMonthKey] = useState(karachiMonthKey());
  const [tab, setTab] = useState<"LATE" | "ABSENT">("LATE");
  const [period, setPeriod] = useState<AttendancePeriod | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [nonce, setNonce] = useState(0);

  const { from, to } = monthRange(monthKey);
  const team = useTeamAttendance(from, to);
  const policy = team.policy;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await getIdToken().catch(() => "");
      if (cancelled || !token) return;

      const result = await getAttendancePeriod(token, monthKey);
      if (cancelled) return;
      setPeriod(result.ok ? result.data : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [monthKey, getIdToken, nonce]);

  const closed = Boolean(period?.finalized);

  const runFinalize = async (reopen: boolean) => {
    setBusy(true);
    setBanner(null);
    const token = await getIdToken();
    const result = reopen
      ? await reopenAttendancePeriod(token, monthKey)
      : await finalizeAttendanceDeductions(token, monthKey);
    setBusy(false);
    setNonce((value) => value + 1);

    if (!result.ok) {
      setBanner({ ok: false, text: result.error });
      return;
    }
    setBanner({
      ok: true,
      text: reopen
        ? `${monthKey} reopened. The figures follow the live rules again until it is closed.`
        : `${monthKey} closed. Those figures are now fixed and will not move if the rules change.`,
    });
  };

  /**
   * Every late in the month, per person, numbered in date order — the
   * occurrence number is what decides whether it is inside the allowance, so
   * the order has to be the order they happened in, not the order they were
   * read in.
   */
  const lates = useMemo(() => {
    if (!policy) return [];

    return team.rows.flatMap((row) => {
      const days = row.days.filter((day) => day.status === "LATE" || day.late);
      return days
        .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
        .map((day, index) => ({
          uid: row.uid,
          name: row.name,
          dayKey: day.dayKey,
          checkIn: day.checkIn,
          lateByMinutes: day.lateByMinutes,
          outcome: lateDeduction(index + 1, policy, row.monthlySalary),
        }));
    });
  }, [team.rows, policy]);

  const absences = useMemo(
    () =>
      team.rows.flatMap((row) =>
        row.days
          .filter((day) => day.status === "ABSENT")
          .map((day) => ({
            uid: row.uid,
            name: row.name,
            dayKey: day.dayKey,
            note: day.note,
            adjusted: day.adjusted,
          }))
      ),
    [team.rows]
  );

  const deductionTotal = closed
    ? (period?.total ?? 0)
    : team.rows.reduce((sum, row) => sum + row.deduction, 0);

  // The rows shown under "Deductions by person": the frozen lines for a closed
  // month, the live calculation for an open one. Never a mix — a screen that
  // showed some of each would be unreadable, and the difference between them
  // is exactly what §12 is about.
  const deductionRows = closed
    ? (period?.lines ?? []).map((line) => ({
        uid: line.uid,
        name: line.name,
        late: line.lateCount,
        deduction: line.amount,
      }))
    : team.rows
        .filter((row) => row.deduction > 0)
        .map((row) => ({ uid: row.uid, name: row.name, late: row.late, deduction: row.deduction }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {banner && (
        <p
          role={banner.ok ? "status" : "alert"}
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
          gap: 12,
        }}
      >
        <Figure label="Late arrivals" value={lates.length} tone="LATE" />
        <Figure
          label="Chargeable"
          value={lates.filter((entry) => entry.outcome.deducted).length}
          tone="ABSENT"
          note={policy ? `over ${policy.allowedLates} allowed` : undefined}
        />
        <Figure label="Absences" value={absences.length} tone="ABSENT" />
        <Figure
          label={closed ? "Deduction (closed)" : "Proposed deduction"}
          value={`Rs ${deductionTotal.toLocaleString("en-PK")}`}
          note={closed ? "fixed for this month" : "not yet posted to payroll"}
        />
      </div>

      <AttendanceCard
        title={tab === "LATE" ? "Late arrivals" : "Absences"}
        hint={
          policy && tab === "LATE"
            ? `Late after ${formatClockLabel(
                policy.startTime
              )} + ${policy.graceMinutes} min grace · ${policy.allowedLates} free each month`
            : policy && tab === "ABSENT"
              ? `No check-in by ${formatClockLabel(policy.absentCutoff)} is recorded as absent`
              : undefined
        }
        action={
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", gap: 4, background: A.hair, borderRadius: 999, padding: 3 }}>
              {(["LATE", "ABSENT"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  style={{
                    borderRadius: 999,
                    border: "none",
                    background: tab === key ? A.surface : "transparent",
                    color: tab === key ? A.teal : A.muted,
                    padding: "5px 13px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {key === "LATE" ? "Late" : "Absent"}
                </button>
              ))}
            </div>
            <MonthStepper monthKey={monthKey} onChange={setMonthKey} />
          </div>
        }
      >
        {team.error && (
          <p role="alert" style={{ fontSize: 13, color: "#a33a29", marginBottom: 10 }}>
            {team.error}
          </p>
        )}

        {tab === "LATE" ? (
          lates.length === 0 ? (
            <EmptyState>
              {team.loading ? "Loading." : "Nobody was late this month."}
            </EmptyState>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {lates.map((entry) => (
                <div
                  key={`${entry.uid}-${entry.dayKey}`}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    borderRadius: 12,
                    border: `1px solid ${entry.outcome.deducted ? "#e0cdb4" : A.line}`,
                    background: entry.outcome.deducted ? "#f3ece2" : A.surface,
                    padding: "10px 13px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <Clock size={16} color="#8a5a33" />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: A.ink }}>
                        {entry.name}
                        <span style={{ fontWeight: 600, color: A.faint }}> · {entry.dayKey}</span>
                      </p>
                      <p style={{ fontSize: 11.5, color: A.muted }}>
                        In at {entry.checkIn ?? "—"} · {entry.lateByMinutes} min late ·{" "}
                        {entry.outcome.basis}
                      </p>
                    </div>
                  </div>
                  <p
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color: entry.outcome.deducted ? "#a33a29" : A.faint,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.outcome.deducted
                      ? `− Rs ${entry.outcome.amount.toLocaleString("en-PK")}`
                      : "No charge"}
                  </p>
                </div>
              ))}
            </div>
          )
        ) : absences.length === 0 ? (
          <EmptyState>{team.loading ? "Loading." : "Nobody was absent this month."}</EmptyState>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {absences.map((entry) => (
              <div
                key={`${entry.uid}-${entry.dayKey}`}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  borderRadius: 12,
                  border: `1px solid ${A.line}`,
                  padding: "10px 13px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <AlertTriangle size={16} color="#c0503c" />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13.5, fontWeight: 700, color: A.ink }}>
                      {entry.name}
                      <span style={{ fontWeight: 600, color: A.faint }}> · {entry.dayKey}</span>
                    </p>
                    <p style={{ fontSize: 11.5, color: A.muted }}>
                      {entry.note ?? "No check-in recorded before the cutoff."}
                      {entry.adjusted ? " · corrected by hand" : ""}
                    </p>
                  </div>
                </div>
                <StatusPill status="ABSENT" />
              </div>
            ))}
          </div>
        )}
      </AttendanceCard>

      <AttendanceCard
        title="Deductions by person"
        icon={closed ? <Lock size={13} color={A.teal} /> : undefined}
        hint={
          closed
            ? `Closed${period?.finalizedByName ? ` by ${period.finalizedByName}` : ""} — these figures are fixed`
            : "Calculated from the current rules"
        }
        action={
          canFinalize ? (
            <button
              type="button"
              onClick={() => void runFinalize(closed)}
              disabled={busy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                borderRadius: 999,
                border: closed ? `1px solid ${A.line}` : "none",
                background: closed ? A.surface : A.teal,
                color: closed ? A.muted : "#fff",
                padding: "7px 15px",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.7 : 1,
              }}
            >
              {closed ? <Unlock size={14} /> : <Lock size={14} />}
              {busy ? "Working…" : closed ? "Reopen month" : "Close the month"}
            </button>
          ) : undefined
        }
      >
        {deductionRows.length === 0 ? (
          <EmptyState>Nothing to deduct this month.</EmptyState>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {[...deductionRows]
              .sort((a, b) => b.deduction - a.deduction)
              .map((row) => (
                <div
                  key={row.uid}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    borderRadius: 12,
                    border: `1px solid ${A.line}`,
                    padding: "10px 13px",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13.5, fontWeight: 700, color: A.ink }}>{row.name}</p>
                    <p style={{ fontSize: 11.5, color: A.faint }}>
                      {row.late} late{row.late === 1 ? "" : "s"} this month
                    </p>
                  </div>
                  <p
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: "#a33a29",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    − Rs {row.deduction.toLocaleString("en-PK")}
                  </p>
                </div>
              ))}
            <p style={{ fontSize: 11.5, color: A.faint, lineHeight: 1.6 }}>
              {closed
                ? `Closed${
                    period?.finalizedAt
                      ? ` on ${new Date(period.finalizedAt).toLocaleDateString("en-GB")}`
                      : ""
                  }. These are the amounts as they stood at closing, together with the rule each was charged under — changing the policy now does not move them. Reopen the month if they genuinely need to change.`
                : "Calculated from the policy as it stands today, and not yet fixed. Closing the month copies these amounts and the rule behind each one, so a later change to the deduction cannot rewrite a month that has been paid."}
            </p>
          </div>
        )}
      </AttendanceCard>
    </div>
  );
}
