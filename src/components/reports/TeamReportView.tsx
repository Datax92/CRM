"use client";

/**
 * Team → Reports.
 *
 * **Built in the Employee Directory's design language**, from the same
 * `directoryChrome` tokens: the gradient hero with its rings, the
 * `minmax(252px, 1fr)` stat cards with their accent stripe, the same card
 * radius, border, Manrope face and row hover. They sit next to each other in
 * the sidebar and are two views of the same people, so looking like different
 * products was the only thing wrong with them being separate screens.
 *
 * **The report has a subject**, chosen from a grouped selector rather than
 * found with a search box: All Employees, All Managers, one employee, one
 * manager (with their team), or the admin. A search filters a list you are
 * already looking at; this picks *what the report is about*, and the two are
 * not the same control. `buildTeamReport` computes the figures server-side and
 * returns the options this reader may pick, so the selector cannot offer a
 * subject the server would refuse.
 *
 * **New Connects and Follow-Up Connects are disjoint**: the first connected
 * contact on a lead is a New Connect, every later one a Follow-Up Connect.
 * Counting the opening call in both would make the columns sum to more work
 * than happened.
 *
 * Below 820px every row becomes a card. A twelve-column money-and-activity
 * table at 390px is unreadable, and a reduced version — dropping columns on
 * the phone — would mean the two surfaces disagree about what the report says.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { buildTeamReport } from "@/lib/clientActions";
import type { TeamReport, ReportRow, ReportOption } from "@/app/actions/reports";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import { E, HeroRings, Card, Bar } from "@/components/employees/directoryChrome";
import type { PersonMetrics } from "@/lib/reportScope";

/* -------------------------------------------------------------------------- */
/* Columns                                                                     */
/* -------------------------------------------------------------------------- */

type MetricKey = keyof PersonMetrics;

interface Column {
  key: MetricKey;
  label: string;
  short: string;
  accent: string;
  /** 24×24 stroke path, matching the directory's stat-card icons. */
  icon: string;
  hint: string;
}

const ICON = {
  phone: "M6.5 3.5 9 8.5l-2 1.5a11 11 0 0 0 5 5l1.5-2 5 2.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3 6.7 2 2 0 0 1 5 4.5Z",
  repeat: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
  calendar: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM9 14l2 2 4-4",
  pin: "M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  trophy: "M8 4h8v4a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M10 15h4M9 20h6M12 15v5",
  coins: "M12 8c3.9 0 7-1.1 7-2.5S15.9 3 12 3 5 4.1 5 5.5 8.1 8 12 8ZM5 5.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6M5 11.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6",
  bars: "M4 19h16M7 16V9M12 16v-4M17 16v-7",
} as const;

/**
 * In the order the owner asked for them: activity first, then the money, then
 * the pipeline bands **best first** — P1 is the column a manager looks at.
 */
const COLUMNS: Column[] = [
  {
    key: "newConnects",
    label: "New Connects",
    short: "New Conn.",
    accent: E.tealInk,
    icon: ICON.phone,
    hint: "Connected calls logged on a Remark — the first contact on a lead",
  },
  {
    key: "followUpConnects",
    label: "Follow-up Connects",
    short: "F/U Conn.",
    accent: E.teal,
    icon: ICON.repeat,
    hint: "Connected calls logged on a Follow-up — every contact after the first",
  },
  {
    key: "meetings",
    label: "Meetings Done",
    short: "Meetings",
    accent: E.blue,
    icon: ICON.calendar,
    hint: "Entries with a meeting recorded",
  },
  {
    key: "siteVisits",
    label: "Site Visits Done",
    short: "Site Visits",
    accent: E.amberInk,
    icon: ICON.pin,
    hint: "Counted apart from meetings — usually a different day",
  },
  {
    key: "dealsClosed",
    label: "Deals Closed",
    short: "Deals",
    accent: E.tealInk,
    icon: ICON.trophy,
    hint: "Deals settled in this range, from the deal entry",
  },
  {
    key: "tokensReceived",
    label: "Tokens Received",
    short: "Tokens",
    accent: E.amberInk,
    icon: ICON.coins,
    hint: "Leads whose token money arrived in this range",
  },
  { key: "p1", label: "P1", short: "P1", accent: E.tealInk, icon: ICON.bars, hint: "Closing" },
  { key: "p2", label: "P2", short: "P2", accent: E.blue, icon: ICON.bars, hint: "They showed up" },
  { key: "p3", label: "P3", short: "P3", accent: E.faint, icon: ICON.bars, hint: "Still talking" },
];

/**
 * The six the hero summarises — the activity and the money.
 *
 * The P-bands are deliberately not here: they are a distribution of a fixed
 * set of leads rather than a total, and putting them in a row of headline
 * figures invites reading them as throughput.
 */
const HEADLINE: MetricKey[] = [
  "newConnects",
  "followUpConnects",
  "meetings",
  "siteVisits",
  "dealsClosed",
  "tokensReceived",
];

const GROUP_LABELS: Record<ReportOption["group"], string> = {
  OVERALL: "Overall",
  EMPLOYEES: "Employees",
  MANAGERS: "Managers",
  ADMIN: "Admin",
};

const GROUP_ORDER: ReportOption["group"][] = ["OVERALL", "EMPLOYEES", "MANAGERS", "ADMIN"];

const REPORT_CSS = `
.report-row { transition: background-color 140ms ease; }
.report-row:hover { background: #f7fbfa; }
.report-stat { transition: border-color 160ms ease; }
.report-stat:hover { border-color: #b6d9d5; }
@keyframes report-row-in { from { opacity: 0; transform: translate3d(0, 8px, 0); } to { opacity: 1; transform: none; } }
.report-row-in { animation: report-row-in 300ms cubic-bezier(0.22,0.61,0.36,1) both; }
@media (prefers-reduced-motion: reduce) {
  .report-row-in { animation: none !important; }
  .report-row, .report-stat { transition: none !important; }
}
`;

function monthStart(): string {
  return `${karachiMonthKey()}-01`;
}

/** The presets people actually reach for, so a range is one tap not two pickers. */
const PRESETS = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 6 },
  { label: "30 days", days: 29 },
  { label: "This month", days: -1 },
] as const;

function presetRange(days: number): { from: string; to: string } {
  const to = karachiDayKey();
  if (days === -1) return { from: monthStart(), to };

  const [year, month, day] = to.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day - days));
  return {
    from: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(
      start.getUTCDate()
    ).padStart(2, "0")}`,
    to,
  };
}

/* -------------------------------------------------------------------------- */

export function TeamReportView() {
  const { getIdToken } = useAuth();
  const isMobile = useIsMobile();

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(karachiDayKey());
  /**
   * Null until the first report comes back and names the default. The server
   * owns which subject a reader lands on, so an employee — who has exactly one
   * option — never sees a selector defaulting to something they cannot have.
   */
  const [subject, setSubject] = useState<string | null>(null);
  const [report, setReport] = useState<TeamReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (nextFrom: string, nextTo: string, nextSubject: string | null) => {
      setLoading(true);
      setError(null);

      const token = await getIdToken().catch(() => "");
      if (!token) {
        setLoading(false);
        setError("Your session has ended. Please sign in again.");
        return;
      }

      const result = await buildTeamReport(token, nextFrom, nextTo, nextSubject);
      setLoading(false);

      if (result.ok) {
        setReport(result.data);
        // Echoed back rather than assumed: the server may have fallen back to
        // a subject this reader can actually see.
        setSubject(result.data.subject);
      } else {
        setReport(null);
        setError(result.error);
      }
    },
    [getIdToken]
  );

  useEffect(() => {
    // The first statement is an await, so nothing sets state synchronously
    // inside the effect.
    let cancelled = false;
    (async () => {
      const token = await getIdToken().catch(() => "");
      if (cancelled) return;
      if (!token) {
        setLoading(false);
        setError("Your session has ended. Please sign in again.");
        return;
      }

      const result = await buildTeamReport(token, monthStart(), karachiDayKey(), null);
      if (cancelled) return;

      setLoading(false);
      if (result.ok) {
        setReport(result.data);
        setSubject(result.data.subject);
      } else setError(result.error);
    })();

    return () => {
      cancelled = true;
    };
  }, [getIdToken]);

  const rows = report?.rows ?? [];
  const totals = report?.totals;
  // Memoised so `grouped` below has a stable dependency — `?? []` is a fresh
  // array on every render, which would re-group the selector each time.
  const options = useMemo(() => report?.options ?? [], [report]);

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        label: GROUP_LABELS[group],
        options: options.filter((option) => option.group === group),
      })).filter((section) => section.options.length > 0),
    [options]
  );

  /** True when the subject is a set of people rather than one person. */
  const composite = rows.length > 1;
  const page = usePagination(rows, isMobile ? 6 : 12);

  const download = () => {
    const header = ["ID", "Name", "Team", ...COLUMNS.map((column) => column.label)];
    const body = rows.map((row) => [
      row.id,
      row.name,
      row.team,
      ...COLUMNS.map((column) => row[column.key]),
    ]);
    if (totals) {
      body.push(["", "TOTAL", "", ...COLUMNS.map((column) => totals[column.key])]);
    }

    // Every field quoted: a name with a comma would otherwise shift every
    // column after it by one, silently.
    const csv = [header, ...body]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");

    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `team-report-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        fontFamily: E.font,
        letterSpacing: E.tracking,
        background: E.page,
        color: E.ink,
        minHeight: "100%",
        margin: isMobile ? "-18px -16px" : "-24px -28px",
        padding: isMobile ? "18px 16px 26px" : "24px 28px 32px",
      }}
    >
      {/* Hover and entrance cannot be expressed inline, and a rule in
          `globals.css` is exactly the build artefact that has twice gone
          missing on this project. Shipping them in the tree means they arrive
          with the component or not at all. */}
      <style>{REPORT_CSS}</style>

      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                              */}
      {/* ---------------------------------------------------------------- */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: isMobile ? 18 : 22,
          background: isMobile ? E.gradientMobile : E.gradient,
          color: "#fff",
          padding: isMobile ? "20px 18px" : "24px 28px",
          marginBottom: 16,
        }}
      >
        <HeroRings set={isMobile ? "phone" : "hero"} />

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
            <div
              style={{
                width: isMobile ? 44 : 52,
                height: isMobile ? 44 : 52,
                borderRadius: 16,
                background: "rgba(255,255,255,0.18)",
                border: "1.5px solid rgba(255,255,255,0.42)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
              aria-hidden
            >
              <svg
                width={isMobile ? 21 : 24}
                height={isMobile ? 21 : 24}
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />
              </svg>
            </div>

            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "1.6px",
                  textTransform: "uppercase",
                  opacity: 0.72,
                }}
              >
                Team
              </div>
              {/* Explicit family: `@layer base` sets font-family on h1–h6,
                  which beats a family inherited from the container. */}
              <h1
                style={{
                  fontSize: isMobile ? 23 : 29,
                  fontWeight: 800,
                  letterSpacing: "-1px",
                  margin: "1px 0 0",
                  color: "#fff",
                  fontFamily: E.font,
                }}
              >
                Performance Report
              </h1>
              <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.82, marginTop: 4 }}>
                {loading ? "Running…" : `${report?.subjectLabel ?? ""} · ${from} → ${to}`}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={download}
              disabled={rows.length === 0}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "11px 18px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.14)",
                border: "1px solid rgba(255,255,255,0.45)",
                color: "#fff",
                fontSize: 13.5,
                fontWeight: 600,
                cursor: rows.length === 0 ? "not-allowed" : "pointer",
                opacity: rows.length === 0 ? 0.55 : 1,
                fontFamily: "inherit",
                flex: isMobile ? "1 1 100%" : undefined,
                justifyContent: isMobile ? "center" : undefined,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
              </svg>
              Download CSV
            </button>
          </div>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {report?.warning && <Notice tone="warn">{report.warning}</Notice>}

      {/* ---------------------------------------------------------------- */}
      {/* Subject + range                                                   */}
      {/* ---------------------------------------------------------------- */}
      <Card style={{ padding: isMobile ? "14px 15px" : "16px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          {/* Wider than the dates: the names inside it are the long values,
              and a truncated person is the one thing on this bar that must
              stay readable. */}
          <Field label="Report for" grow flexBasis={isMobile ? "100%" : "260px"}>
            <select
              value={subject ?? ""}
              disabled={options.length <= 1}
              onChange={(event) => {
                setSubject(event.target.value);
                void run(from, to, event.target.value);
              }}
              aria-label="Choose who this report is about"
              style={{ ...field, cursor: options.length <= 1 ? "default" : "pointer" }}
            >
              {options.length === 0 && <option value="">—</option>}
              {grouped.map((section) => (
                <optgroup key={section.group} label={section.label}>
                  {section.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field label="From" grow={isMobile}>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              style={field}
            />
          </Field>
          <Field label="To" grow={isMobile}>
            <input
              type="date"
              value={to}
              min={from}
              max={karachiDayKey()}
              onChange={(event) => setTo(event.target.value)}
              style={field}
            />
          </Field>

          <button
            type="button"
            onClick={() => void run(from, to, subject)}
            disabled={loading}
            style={{
              borderRadius: 10,
              border: "none",
              background: E.tealInk,
              color: "#fff",
              padding: "11px 22px",
              fontSize: 13.5,
              fontWeight: 700,
              cursor: loading ? "progress" : "pointer",
              fontFamily: "inherit",
              flex: isMobile ? "1 1 100%" : undefined,
            }}
          >
            {loading ? "Running…" : "Submit"}
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 12 }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                const next = presetRange(preset.days);
                setFrom(next.from);
                setTo(next.to);
                void run(next.from, next.to, subject);
              }}
              style={{
                borderRadius: 999,
                border: `1px solid ${E.border}`,
                background: E.field,
                color: E.muted,
                padding: "6px 14px",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Stat cards — the directory's, to the pixel                        */}
      {/* ---------------------------------------------------------------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(252px, 1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        {COLUMNS.filter((column) => HEADLINE.includes(column.key)).map((column) => (
          <StatCard
            key={column.key}
            column={column}
            value={totals?.[column.key] ?? 0}
            /* Share of the biggest headline figure, so the bars compare with
               each other rather than against an invented ceiling. */
            peak={Math.max(1, ...HEADLINE.map((key) => totals?.[key] ?? 0))}
          />
        ))}
      </div>

      {/* The pipeline bands, apart from the activity figures — they describe
          where a fixed set of leads stands, not how much was done. */}
      {totals && <PipelineStrip totals={totals} isMobile={isMobile} />}

      {/* ---------------------------------------------------------------- */}
      {/* The report                                                        */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "14px 18px",
            borderBottom: `1px solid ${E.softBorder}`,
          }}
        >
          <h2
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "1.2px",
              textTransform: "uppercase",
              color: E.label,
              fontFamily: E.font,
            }}
          >
            {composite ? "Breakdown" : "Summary"}
          </h2>
          <span style={{ fontSize: 12, color: E.faint, fontWeight: 600 }}>
            {rows.length} {rows.length === 1 ? "person" : "people"}
          </span>
        </div>

        {loading ? (
          <Skeleton rows={isMobile ? 4 : 6} />
        ) : rows.length === 0 ? (
          <Empty />
        ) : isMobile ? (
          <div style={{ padding: 14, display: "grid", gap: 10 }}>
            {page.items.map((row, index) => (
              <MobileRow key={row.uid} row={row} index={index} />
            ))}
            {composite && totals && <MobileTotals totals={totals} />}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1060 }}>
              <thead>
                <tr>
                  <Th align="left">ID</Th>
                  <Th align="left">Name</Th>
                  <Th align="left">Team</Th>
                  {COLUMNS.map((column) => (
                    <Th key={column.key} title={column.hint}>
                      {column.short}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.items.map((row, index) => (
                  <tr
                    key={row.uid}
                    className={`report-row ${index < 10 ? "report-row-in" : ""}`}
                    style={{
                      borderTop: `1px solid ${E.rowBorder}`,
                      animationDelay: index < 10 ? `${index * 28}ms` : undefined,
                    }}
                  >
                    <td
                      title={row.uid}
                      style={{
                        padding: "12px 16px",
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: E.faint,
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.id}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <span
                          aria-hidden
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 999,
                            background: E.tealTint,
                            color: E.tealInk,
                            display: "grid",
                            placeItems: "center",
                            fontSize: 12.5,
                            fontWeight: 800,
                            flexShrink: 0,
                          }}
                        >
                          {row.name.charAt(0).toUpperCase()}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span
                            style={{
                              display: "block",
                              fontSize: 13.5,
                              fontWeight: 700,
                              color: E.ink,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {row.name}
                          </span>
                          {row.role !== "employee" && <RolePill role={row.role} />}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          borderRadius: 999,
                          border: `1px solid ${E.border}`,
                          background: E.field,
                          color: E.muted,
                          padding: "3px 11px",
                          fontSize: 11.5,
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.team}
                      </span>
                    </td>
                    {COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        style={{
                          padding: "12px 16px",
                          textAlign: "right",
                          fontSize: 13.5,
                          fontWeight: 700,
                          color: row[column.key] > 0 ? column.accent : E.hair,
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row[column.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>

              {/* A total identical to the only row above it is noise — the
                  phone drops it for the same reason. */}
              {totals && composite && (
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${E.border}`, background: E.field }}>
                    <td
                      colSpan={3}
                      style={{
                        padding: "12px 16px",
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "1.1px",
                        textTransform: "uppercase",
                        color: E.label,
                      }}
                    >
                      Total
                    </td>
                    {COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        style={{
                          padding: "12px 16px",
                          textAlign: "right",
                          fontSize: 14,
                          fontWeight: 800,
                          color: E.ink,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {totals[column.key]}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ padding: "0 14px 12px" }}>
            <Pager pagination={page} variant={isMobile ? "mobile" : "web"} noun="people" />
          </div>
        )}
      </Card>

      <p style={{ marginTop: 14, fontSize: 11.5, color: E.faint, lineHeight: 1.6 }}>
        <strong style={{ color: E.muted }}>New Connects</strong> is the first connected contact on a
        lead — the call logged with its Remark; <strong style={{ color: E.muted }}>Follow-up
        Connects</strong> is every one after it, so the two never count the same call. A manager&rsquo;s
        report includes their own work <em>and</em> their team&rsquo;s, and nobody is counted twice.
        P1 / P2 / P3 describe where each person&rsquo;s leads stand <strong style={{ color: E.muted }}>today</strong>,
        from their pipeline status — a lead accepted but not yet remarked on carries no band at all.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

function RolePill({ role }: { role: ReportRow["role"] }) {
  const manager = role === "subadmin";
  return (
    <span
      style={{
        display: "inline-block",
        marginTop: 3,
        borderRadius: 999,
        background: manager ? E.tealTint : E.amberBg,
        color: manager ? E.tealInk : E.amberInk,
        padding: "1px 8px",
        fontSize: 9.5,
        fontWeight: 800,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
      }}
    >
      {manager ? "Manager" : "Admin"}
    </span>
  );
}

/** P1 / P2 / P3 as a strip of their own, above the breakdown. */
function PipelineStrip({ totals, isMobile }: { totals: PersonMetrics; isMobile: boolean }) {
  const bands = [
    { key: "p1" as const, label: "P1 — Closing", accent: E.tealInk },
    { key: "p2" as const, label: "P2 — Met or visited", accent: E.blue },
    { key: "p3" as const, label: "P3 — In conversation", accent: E.faint },
  ];
  const total = bands.reduce((sum, band) => sum + totals[band.key], 0);

  return (
    <Card style={{ padding: isMobile ? "14px 15px" : "16px 18px", marginBottom: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <h2
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "1.2px",
            textTransform: "uppercase",
            color: E.label,
            fontFamily: E.font,
          }}
        >
          Pipeline today
        </h2>
        <span style={{ fontSize: 12, color: E.faint, fontWeight: 600 }}>
          {total} {total === 1 ? "lead" : "leads"} in a band
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
          gap: isMobile ? 12 : 18,
        }}
      >
        {bands.map((band) => (
          <div key={band.key} style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: E.muted, whiteSpace: "nowrap" }}>
                {band.label}
              </span>
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: totals[band.key] > 0 ? band.accent : E.hair,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {totals[band.key]}
              </span>
            </div>
            <div style={{ marginTop: 7 }}>
              <Bar percent={total === 0 ? 0 : (totals[band.key] / total) * 100} fill={band.accent} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StatCard({ column, value, peak }: { column: Column; value: number; peak: number }) {
  return (
    <div
      className="report-stat"
      style={{
        position: "relative",
        overflow: "hidden",
        background: E.surface,
        border: `1px solid ${E.border}`,
        borderRadius: 16,
        padding: "16px 18px",
      }}
    >
      <div
        aria-hidden
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: column.accent }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            background: E.tint,
            color: column.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-hidden
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={column.icon} />
          </svg>
        </div>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "1.1px",
            textTransform: "uppercase",
            color: E.label,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {column.label}
        </span>
      </div>

      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: "-1px",
          color: E.ink,
          fontVariantNumeric: "tabular-nums",
          marginTop: 11,
        }}
      >
        {value.toLocaleString()}
      </div>

      <div style={{ marginTop: 10 }}>
        <Bar percent={peak === 0 ? 0 : (value / peak) * 100} fill={column.accent} />
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: E.faint }}>{column.hint}</p>
    </div>
  );
}

/** A phone row: identity, then every figure the table shows — none dropped. */
function MobileRow({ row, index }: { row: ReportRow; index: number }) {
  return (
    <div
      className={index < 8 ? "report-row-in" : undefined}
      style={{
        border: `1px solid ${E.border}`,
        borderRadius: 14,
        background: E.surface,
        padding: "13px 14px",
        animationDelay: index < 8 ? `${index * 30}ms` : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            background: E.tealTint,
            color: E.tealInk,
            display: "grid",
            placeItems: "center",
            fontSize: 13,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {row.name.charAt(0).toUpperCase()}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p
            style={{
              fontSize: 14.5,
              fontWeight: 800,
              color: E.ink,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.name}
          </p>
          <p style={{ fontSize: 11.5, color: E.faint, fontWeight: 600 }}>
            {row.id} · {row.team}
          </p>
        </div>
        {row.role !== "employee" && <RolePill role={row.role} />}
      </div>

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(74px, 1fr))",
          gap: 9,
        }}
      >
        {COLUMNS.map((column) => (
          <Figure key={column.key} label={column.short} value={row[column.key]} accent={column.accent} />
        ))}
      </div>
    </div>
  );
}

/** The phone's totals card. A table footer has nowhere to live in a card list. */
function MobileTotals({ totals }: { totals: PersonMetrics }) {
  return (
    <div
      style={{
        border: `1.5px solid ${E.border}`,
        borderRadius: 14,
        background: E.field,
        padding: "13px 14px",
      }}
    >
      <p
        style={{
          fontSize: 10.5,
          fontWeight: 800,
          letterSpacing: "1.1px",
          textTransform: "uppercase",
          color: E.label,
        }}
      >
        Total
      </p>
      <div
        style={{
          marginTop: 10,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(74px, 1fr))",
          gap: 9,
        }}
      >
        {COLUMNS.map((column) => (
          <Figure key={column.key} label={column.short} value={totals[column.key]} accent={E.ink} strong />
        ))}
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  accent,
  strong,
}: {
  label: string;
  value: number;
  accent: string;
  strong?: boolean;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <p
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.5px",
          textTransform: "uppercase",
          color: E.label,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 16,
          fontWeight: 800,
          color: value > 0 || strong ? accent : E.hair,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function Th({
  children,
  align = "right",
  title,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  title?: string;
}) {
  return (
    <th
      title={title}
      style={{
        textAlign: align,
        padding: "12px 16px",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "1.1px",
        textTransform: "uppercase",
        color: E.label,
        whiteSpace: "nowrap",
        background: E.field,
      }}
    >
      {children}
    </th>
  );
}

function Field({
  label,
  grow,
  flexBasis,
  children,
}: {
  label: string;
  grow?: boolean;
  flexBasis?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "grid",
        gap: 5,
        flex: grow ? `1 1 ${flexBasis ?? "160px"}` : undefined,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "1.1px",
          textTransform: "uppercase",
          color: E.label,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const field: React.CSSProperties = {
  borderRadius: 10,
  border: `1px solid ${E.border}`,
  background: E.surface,
  color: E.ink,
  padding: "10px 12px",
  // 16px, or iOS Safari zooms the page on focus and leaves the reader
  // somewhere they did not ask to be.
  fontSize: 16,
  fontWeight: 600,
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
  minWidth: 0,
};

function Notice({ tone, children }: { tone: "error" | "warn"; children: React.ReactNode }) {
  const palette =
    tone === "error"
      ? { bg: E.redBg, border: "#f0c4bd", ink: E.redInk }
      : { bg: E.amberBg, border: "#ecdcae", ink: E.amberInk };

  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      style={{
        marginBottom: 16,
        borderRadius: 12,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.ink,
        padding: "11px 14px",
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.6,
      }}
    >
      {children}
    </p>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div style={{ padding: 16, display: "grid", gap: 10 }}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          style={{
            height: 46,
            borderRadius: 12,
            background: `linear-gradient(90deg, ${E.field} 25%, ${E.tint} 50%, ${E.field} 75%)`,
          }}
        />
      ))}
    </div>
  );
}

function Empty() {
  return (
    <div style={{ padding: "48px 24px", textAlign: "center" }}>
      <p style={{ fontSize: 14.5, fontWeight: 700, color: E.ink }}>No activity in this range.</p>
      <p style={{ margin: "6px auto 0", maxWidth: 420, fontSize: 12.5, color: E.faint, lineHeight: 1.6 }}>
        Pick a wider range or a different person. Every figure here is computed from the records
        themselves, so an empty report means nothing was logged — not that something is missing.
      </p>
    </div>
  );
}
