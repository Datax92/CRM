"use client";

/**
 * Salary / Payroll.
 *
 * One month at a time, because payroll is a monthly act — the stepper is the
 * primary control and everything on screen belongs to the month it names.
 *
 * The workflow is visible rather than implied: the status pill says where the
 * month is, and the single button beside it says the one thing that can happen
 * next. A row of four buttons where three are disabled reads as three things
 * that have gone wrong.
 *
 * **Nothing here recomputes commission or attendance.** Both arrive on the
 * generated line from the modules that own them, and once the period is
 * approved the figures are frozen — the screen shows that state plainly rather
 * than silently refusing edits.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Pencil,
  RefreshCw,
  Settings2,
  Undo2,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  adjustPayrollLine,
  generatePayroll,
  getPayroll,
  setPayrollStatus,
} from "@/lib/clientActions";
import type { PayrollPeriod } from "@/app/actions/payroll";
import {
  PAYROLL_STATUS_LABELS,
  allowedTransitions,
  isEditable,
  payrollTotals,
  type PayrollLine,
  type PayrollStatus,
} from "@/lib/payroll";
import { karachiMonthKey } from "@/lib/dates";
import { monthLabel, shiftMonth } from "@/lib/attendanceCalendar";
import { MonthStepper } from "@/components/attendance/MyAttendanceView";
import {
  Banner,
  F,
  FinanceCard,
  EmptyState,
  Figure,
  PrimaryButton,
  rupees,
} from "./financeChrome";
import { PayrollLineModal } from "./PayrollLineModal";
import { SalaryProfilesPanel, useSalaryProfiles } from "./SalaryProfilesPanel";
import { PayslipPanel } from "./PayslipPanel";

/** The single next step, in the words of the person about to press it. */
const NEXT_LABEL: Record<PayrollStatus, string> = {
  DRAFT: "Send for review",
  REVIEWED: "Approve payroll",
  APPROVED: "Mark as paid",
  PAID: "",
};

export function PayrollView() {
  const { role, getIdToken } = useAuth();
  const isAdmin = role === "admin";
  // A nine-column money table at 390px is unreadable, so the phone gets
  // cards carrying the same figures rather than a table it has to scroll
  // sideways through. Same data, same actions — not a reduced version.
  const isMobile = useIsMobile();

  const [monthKey, setMonthKey] = useState(() => shiftMonth(karachiMonthKey(), 0));
  const [tab, setTab] = useState<"PAYROLL" | "PROFILES">("PAYROLL");
  const [period, setPeriod] = useState<PayrollPeriod | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<PayrollLine | null>(null);
  const [slipFor, setSlipFor] = useState<PayrollLine | null>(null);
  const [nonce, setNonce] = useState(0);
  const [search, setSearch] = useState("");

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  /**
   * Salary profiles, loaded **once** the first time the tab is opened and kept
   * afterwards. Fetching them on the panel's mount meant re-reading the whole
   * roster on every tab click.
   */
  const [profilesWanted, setProfilesWanted] = useState(false);
  const salaryProfiles = useSalaryProfiles(profilesWanted);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // First statement is an await, so nothing sets state synchronously in
      // the effect — and the screen never paints last month's figures under
      // this month's heading.
      const token = await getIdToken().catch(() => "");
      if (cancelled || !token) return;

      const result = await getPayroll(token, monthKey);
      if (cancelled) return;

      if (result.ok) {
        setPeriod(result.data);
        setBanner(null);
      } else {
        setPeriod(null);
        setBanner({ ok: false, text: result.error });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [monthKey, getIdToken, nonce]);

  const status = period?.status ?? "DRAFT";
  const editable = isEditable(status);
  const next = allowedTransitions(status).find((value) => NEXT_LABEL[value] !== "");
  const back = status === "REVIEWED" ? "DRAFT" : status === "APPROVED" ? "REVIEWED" : null;

  const lines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return period?.lines ?? [];
    return (period?.lines ?? []).filter((line) => line.name.toLowerCase().includes(needle));
  }, [period, search]);

  const totals = useMemo(() => payrollTotals(period?.lines ?? []), [period]);

  const run = async (work: (token: string) => Promise<{ ok: boolean; text: string }>) => {
    setBusy(true);
    setBanner(null);
    const token = await getIdToken();
    const outcome = await work(token);
    setBusy(false);
    setBanner(outcome);
    reload();
  };

  const generate = () =>
    run(async (token) => {
      const result = await generatePayroll(token, monthKey);
      return result.ok
        ? {
            ok: true,
            text: `${monthLabel(monthKey)} generated — ${result.data.people} people, ${rupees(
              result.data.net
            )} net.`,
          }
        : { ok: false, text: result.error };
    });

  const move = (to: PayrollStatus) =>
    run(async (token) => {
      const result = await setPayrollStatus(token, monthKey, to);
      return result.ok
        ? {
            ok: true,
            text:
              to === "PAID"
                ? `${monthLabel(monthKey)} marked paid. Everybody has been notified.`
                : to === "APPROVED"
                  ? `${monthLabel(monthKey)} approved. Payslips are now visible to each employee and the figures are fixed.`
                  : `${monthLabel(monthKey)} is now ${PAYROLL_STATUS_LABELS[to].toLowerCase()}.`,
          }
        : { ok: false, text: result.error };
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ---------------------------------------------------------------- */}
      {/* The month, its state, and the one thing that happens next          */}
      {/* ---------------------------------------------------------------- */}
      <section
        style={{
          borderRadius: 18,
          padding: "18px 20px",
          background: `linear-gradient(135deg, ${F.teal} 0%, ${F.tealMid} 100%)`,
          color: "#fff",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.7px", opacity: 0.82 }}>
            SALARY &amp; PAYROLL
          </p>
          <h2 style={{ fontSize: 23, fontWeight: 800 }}>{monthLabel(monthKey)}</h2>
          <p style={{ fontSize: 12.5, opacity: 0.9 }}>
            {period?.exists
              ? `${totals.people} on the payroll · ${rupees(totals.net)} net`
              : "Not generated yet"}
          </p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span
            style={{
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.45)",
              background: "rgba(255,255,255,0.18)",
              padding: "5px 14px",
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            {PAYROLL_STATUS_LABELS[status]}
          </span>
          <div style={{ background: "rgba(255,255,255,0.9)", borderRadius: 999, padding: "3px 6px" }}>
            <MonthStepper monthKey={monthKey} onChange={setMonthKey} />
          </div>
        </div>
      </section>

      {banner && <Banner ok={banner.ok}>{banner.text}</Banner>}

      {/* ---------------------------------------------------------------- */}
      {/* Tabs                                                              */}
      {/* ---------------------------------------------------------------- */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(
          [
            { key: "PAYROLL", label: "Monthly payroll", icon: Wallet },
            { key: "PROFILES", label: "Salary profiles", icon: Settings2 },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              if (key === "PROFILES") setProfilesWanted(true);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              borderRadius: 999,
              border: `1px solid ${tab === key ? F.teal : F.line}`,
              background: tab === key ? F.tealSoft : F.surface,
              color: tab === key ? F.teal : F.muted,
              padding: "7px 15px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === "PROFILES" ? (
        <SalaryProfilesPanel
          profiles={salaryProfiles.profiles}
          error={salaryProfiles.error}
          reload={salaryProfiles.reload}
          onSaved={(text) => setBanner({ ok: true, text })}
          isAdmin={isAdmin}
        />
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
            <Figure label="Employees" value={totals.people} tone="TEAL" />
            <Figure label="Gross" value={rupees(totals.additions)} />
            <Figure label="Commission" value={rupees(totals.commission)} note="from closed deals" />
            <Figure
              label="Deductions"
              value={rupees(totals.deductions)}
              tone="ABSENT"
              note={`${rupees(totals.attendanceDeduction)} from attendance`}
            />
            <Figure label="Net payable" value={rupees(totals.net)} tone="PRESENT" />
          </div>

          <FinanceCard
            title="Payroll"
            hint={
              period?.exists
                ? editable
                  ? "Figures can still be adjusted"
                  : "Finalised — figures are fixed"
                : undefined
            }
            action={
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                {period?.exists && (
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search employee"
                    style={{
                      borderRadius: 999,
                      border: `1px solid ${F.line}`,
                      background: "#fff",
                      color: F.ink,
                      padding: "6px 13px",
                      fontSize: 13,
                      outline: "none",
                      minWidth: 150,
                    }}
                  />
                )}

                {editable && (
                  <PrimaryButton onClick={generate} disabled={busy} tone="quiet">
                    <RefreshCw size={14} />
                    {period?.exists ? "Regenerate" : "Generate payroll"}
                  </PrimaryButton>
                )}

                {back && (
                  <PrimaryButton onClick={() => void move(back)} disabled={busy} tone="quiet">
                    <Undo2 size={14} /> Send back
                  </PrimaryButton>
                )}

                {period?.exists && next && (
                  <PrimaryButton
                    onClick={() => void move(next)}
                    disabled={busy || (next === "PAID" && !isAdmin)}
                  >
                    {next === "PAID" ? <Check size={14} /> : <ArrowRight size={14} />}
                    {NEXT_LABEL[status]}
                  </PrimaryButton>
                )}
              </div>
            }
          >
            {!period?.exists ? (
              <EmptyState>
                Nothing generated for {monthLabel(monthKey)} yet. Generating pulls each
                employee&apos;s salary profile, their commission from finalised deal splits, and
                their attendance deductions for the month.
              </EmptyState>
            ) : lines.length === 0 ? (
              <EmptyState>Nobody matches that search.</EmptyState>
            ) : isMobile ? (
              <div style={{ display: "grid", gap: 10 }}>
                {lines.map((line) => (
                  <article
                    key={line.uid}
                    style={{
                      borderRadius: 14,
                      border: `1px solid ${F.line}`,
                      background: F.surface,
                      padding: "12px 14px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setSlipFor(line)}
                        style={{
                          border: "none",
                          background: "none",
                          padding: 0,
                          textAlign: "left",
                          cursor: "pointer",
                          minWidth: 0,
                        }}
                      >
                        <p style={{ fontSize: 14, fontWeight: 800, color: F.ink }}>{line.name}</p>
                        <p style={{ fontSize: 11.5, color: F.faint }}>
                          {line.jobTitle ?? line.email ?? ""}
                          {line.lateCount > 0 ? ` · ${line.lateCount} late` : ""}
                          {line.absentCount > 0 ? ` · ${line.absentCount} absent` : ""}
                        </p>
                      </button>
                      <span
                        style={{
                          fontSize: 16,
                          fontWeight: 800,
                          color: F.ink,
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {rupees(line.net)}
                      </span>
                    </div>

                    <div
                      style={{
                        marginTop: 10,
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
                        gap: 8,
                      }}
                    >
                      {[
                        { label: "Basic", value: rupees(line.basic) },
                        { label: "Allowances", value: rupees(line.allowances) },
                        { label: "Bonus", value: rupees(line.bonus + line.extraAdditions) },
                        {
                          label: "Commission",
                          value: line.commission > 0 ? rupees(line.commission) : "—",
                          tone: line.commission > 0 ? "#1f7a52" : undefined,
                        },
                        {
                          label: "Attendance",
                          value:
                            line.attendanceDeduction > 0
                              ? `− ${rupees(line.attendanceDeduction)}`
                              : "—",
                          tone: line.attendanceDeduction > 0 ? "#a33a29" : undefined,
                        },
                        {
                          label: "Other",
                          value: line.otherDeductions > 0 ? `− ${rupees(line.otherDeductions)}` : "—",
                          tone: line.otherDeductions > 0 ? "#a33a29" : undefined,
                        },
                      ].map((item) => (
                        <div key={item.label} style={{ minWidth: 0 }}>
                          <p
                            style={{
                              fontSize: 9.5,
                              fontWeight: 700,
                              letterSpacing: "0.5px",
                              textTransform: "uppercase",
                              color: F.faint,
                            }}
                          >
                            {item.label}
                          </p>
                          <p
                            style={{
                              fontSize: 12.5,
                              fontWeight: 700,
                              color: item.tone ?? F.muted,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {item.value}
                          </p>
                        </div>
                      ))}
                    </div>

                    {editable && (
                      <button
                        type="button"
                        onClick={() => setEditing(line)}
                        style={{
                          marginTop: 11,
                          width: "100%",
                          borderRadius: 999,
                          border: `1px solid ${F.line}`,
                          background: F.surface,
                          color: F.muted,
                          padding: "9px 11px",
                          fontSize: 12.5,
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                        }}
                      >
                        <Pencil size={13} /> Adjust this line
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
                  <thead>
                    <tr>
                      {[
                        "Employee",
                        "Basic",
                        "Allowances",
                        "Bonus",
                        "Commission",
                        "Attendance",
                        "Other",
                        "Net",
                        "",
                      ].map((label, index) => (
                        <th
                          key={label || index}
                          style={{
                            textAlign: index === 0 || index === 8 ? "left" : "right",
                            fontSize: 10.5,
                            fontWeight: 700,
                            letterSpacing: "0.6px",
                            textTransform: "uppercase",
                            color: F.faint,
                            padding: "0 10px 8px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.uid} style={{ borderTop: `1px solid ${F.hair}` }}>
                        <td style={{ padding: "10px" }}>
                          <button
                            type="button"
                            onClick={() => setSlipFor(line)}
                            style={{
                              border: "none",
                              background: "none",
                              padding: 0,
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                          >
                            <p style={{ fontSize: 13, fontWeight: 700, color: F.ink }}>{line.name}</p>
                            <p style={{ fontSize: 11, color: F.faint }}>
                              {line.jobTitle ?? line.email ?? ""}
                              {line.lateCount > 0 ? ` · ${line.lateCount} late` : ""}
                              {line.absentCount > 0 ? ` · ${line.absentCount} absent` : ""}
                            </p>
                          </button>
                        </td>
                        <td style={cell}>{rupees(line.basic)}</td>
                        <td style={cell}>{rupees(line.allowances)}</td>
                        <td style={cell}>{rupees(line.bonus + line.extraAdditions)}</td>
                        <td style={{ ...cell, color: line.commission > 0 ? "#1f7a52" : F.faint }}>
                          {line.commission > 0 ? rupees(line.commission) : "—"}
                        </td>
                        <td
                          style={{
                            ...cell,
                            color: line.attendanceDeduction > 0 ? "#a33a29" : F.faint,
                          }}
                        >
                          {line.attendanceDeduction > 0 ? `− ${rupees(line.attendanceDeduction)}` : "—"}
                        </td>
                        <td style={{ ...cell, color: line.otherDeductions > 0 ? "#a33a29" : F.faint }}>
                          {line.otherDeductions > 0 ? `− ${rupees(line.otherDeductions)}` : "—"}
                        </td>
                        <td style={{ ...cell, fontWeight: 800, color: F.ink }}>{rupees(line.net)}</td>
                        <td style={{ padding: "10px" }}>
                          {editable && (
                            <button
                              type="button"
                              onClick={() => setEditing(line)}
                              aria-label={`Adjust ${line.name}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                borderRadius: 999,
                                border: `1px solid ${F.line}`,
                                background: F.surface,
                                color: F.muted,
                                padding: "4px 11px",
                                fontSize: 11.5,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              <Pencil size={12} /> Adjust
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </FinanceCard>

          {/* -------------------------------------------------------------- */}
          {/* Who did what, and when                                          */}
          {/* -------------------------------------------------------------- */}
          {period?.history && period.history.length > 0 && (
            <FinanceCard title="History" hint="Newest last">
              <div style={{ display: "grid", gap: 7 }}>
                {period.history.map((entry, index) => (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      borderRadius: 10,
                      border: `1px solid ${F.line}`,
                      padding: "8px 12px",
                    }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: F.ink }}>
                      {entry.byName ?? "Somebody"} · {entry.action.replace(/_/g, " ").toLowerCase()}
                    </span>
                    <span style={{ fontSize: 11.5, color: F.muted }}>
                      {entry.detail}
                      {entry.at ? ` · ${new Date(entry.at).toLocaleString("en-GB")}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </FinanceCard>
          )}

          <p style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: F.faint }}>
            <Users size={13} /> Commission comes from finalised deal splits and attendance
            deductions from the attendance module — neither is entered here, and neither changes
            once the month is approved.
          </p>
        </>
      )}

      {editing && (
        <PayrollLineModal
          monthKey={monthKey}
          line={editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setBanner({ ok: true, text });
            reload();
          }}
          save={adjustPayrollLine}
        />
      )}

      {slipFor && (
        <PayslipPanel
          monthKey={monthKey}
          line={slipFor}
          status={status}
          onClose={() => setSlipFor(null)}
        />
      )}
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "10px",
  textAlign: "right",
  fontSize: 12.5,
  fontWeight: 600,
  color: F.muted,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};
