"use client";

/**
 * Team → Reports.
 *
 * **A report, not a dashboard.** The earlier version opened with a full-height
 * gradient hero, six 252px stat cards and a pipeline panel — three screens of
 * chrome before the first name. What a manager actually opens this for is one
 * question: *what has this person done?* So the answer is the page. A slim
 * header says who and when, one strip carries the totals, and the table — the
 * thing being asked for — starts above the fold and is the largest element on
 * the screen.
 *
 * **The subject is chosen, not searched.** All Employees, All Managers, one
 * employee, one manager (with their team) or the admin. `buildTeamReport`
 * computes the figures server-side and returns the options this reader may
 * pick, so the selector cannot offer a subject the server would refuse. On a
 * composite report **a row is a link into that person's own report**, which is
 * how "open a report for this employee" is one click rather than a trip back to
 * the selector.
 *
 * **The columns are the work, then the outcome, then where things stand.**
 * Remarks and Follow-ups count every entry written in the range; the two
 * connect columns count the subset where somebody actually got through. They
 * are not meant to add up — a day of unanswered calls is real work, and it
 * reads here as remarks with no connects, which is the thing a manager needs to
 * be able to see. New Connects and Follow-up Connects are disjoint from each
 * other: the first connected contact on a lead is a New Connect, every later
 * one a Follow-up Connect.
 *
 * Below 820px every row becomes a card carrying every figure. A fourteen-column
 * table at 390px is unreadable, and dropping columns on the phone would make
 * the two surfaces disagree about what the report says.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { buildTeamReport } from "@/lib/clientActions";
import type { TeamReport, ReportRow, ReportOption } from "@/app/actions/reports";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import { E } from "@/components/employees/directoryChrome";
import type { PersonMetrics } from "@/lib/reportScope";

/* -------------------------------------------------------------------------- */
/* Columns                                                                     */
/* -------------------------------------------------------------------------- */

type MetricKey = keyof PersonMetrics;

/**
 * Three bands, in the order somebody reads a report in.
 *
 * `WORK` is what the person did, `OUTCOME` is what came of it, `PIPELINE` is
 * where their leads stand **today** and is the one group that is not
 * range-scoped — a stage is a property of a status now, and back-dating it
 * would need an event replay this report does not pretend to do. The groups are
 * tinted apart precisely so that difference is visible rather than explained in
 * a footnote nobody reads.
 */
type Band = "WORK" | "OUTCOME" | "PIPELINE";

interface Column {
  key: MetricKey;
  label: string;
  short: string;
  band: Band;
  accent: string;
  hint: string;
}

const COLUMNS: Column[] = [
  {
    key: "remarks",
    label: "Remarks",
    short: "Remarks",
    band: "WORK",
    accent: E.tealInk,
    hint: "First entries written on a lead in this range — a lead opened",
  },
  {
    key: "followUps",
    label: "Follow-ups",
    short: "Follow-ups",
    band: "WORK",
    accent: E.teal,
    hint: "Every later entry written in this range — a lead chased",
  },
  {
    key: "newConnects",
    label: "New Connects",
    short: "New conn.",
    band: "WORK",
    accent: E.tealInk,
    hint: "Of the remarks, the calls that were answered for 1:10 or longer",
  },
  {
    key: "followUpConnects",
    label: "Follow-up Connects",
    short: "F/U conn.",
    band: "WORK",
    accent: E.teal,
    hint: "Of the follow-ups, the calls that were answered — never the same call twice",
  },
  {
    key: "meetings",
    label: "Meetings",
    short: "Meetings",
    band: "OUTCOME",
    accent: E.blue,
    hint: "Entries with a meeting recorded",
  },
  {
    key: "siteVisits",
    label: "Site Visits",
    short: "Visits",
    band: "OUTCOME",
    accent: E.blue,
    hint: "Counted apart from meetings — usually a different day",
  },
  {
    key: "dealsClosed",
    label: "Deals Closed",
    short: "Deals",
    band: "OUTCOME",
    accent: E.tealInk,
    hint: "Deals settled in this range, from the deal entry",
  },
  {
    key: "tokensReceived",
    label: "Tokens",
    short: "Tokens",
    band: "OUTCOME",
    accent: E.amberInk,
    hint: "Leads whose token money arrived in this range",
  },
  {
    key: "p1",
    label: "P1",
    short: "P1",
    band: "PIPELINE",
    accent: E.tealInk,
    hint: "Closing — document, token or deal. Where their leads stand today, not in this range",
  },
  {
    key: "p2",
    label: "P2",
    short: "P2",
    band: "PIPELINE",
    accent: E.blue,
    hint: "They showed up — meeting or site visit done. Today, not in this range",
  },
  {
    key: "p3",
    label: "P3",
    short: "P3",
    band: "PIPELINE",
    accent: E.faint,
    hint: "Still talking. Today, not in this range",
  },
];

/** The bands as headings above the columns, in column order. */
const BANDS: Array<{ key: Band; label: string; tint: string }> = [
  { key: "WORK", label: "Activity in range", tint: "transparent" },
  { key: "OUTCOME", label: "Outcome in range", tint: "transparent" },
  { key: "PIPELINE", label: "Pipeline today", tint: "#f4f9f8" },
];

const BAND_TINT: Record<Band, string> = {
  WORK: "transparent",
  OUTCOME: "transparent",
  PIPELINE: "#f4f9f8",
};

const GROUP_LABELS: Record<ReportOption["group"], string> = {
  OVERALL: "Overall",
  EMPLOYEES: "Employees",
  MANAGERS: "Managers",
  ADMIN: "Admin",
};

const GROUP_ORDER: ReportOption["group"][] = ["OVERALL", "EMPLOYEES", "MANAGERS", "ADMIN"];

/*
 * Hover, entrance and the sticky header cannot be expressed inline, and a rule
 * in `globals.css` is exactly the build artefact that has twice gone missing on
 * this project. Shipping them in the tree means they arrive with the component
 * or not at all.
 */
const REPORT_CSS = `
.rep-row { transition: background-color 140ms ease; }
.rep-row:hover { background: #f4faf9; }
.rep-row:focus-visible { outline: 2px solid #4f9c99; outline-offset: -2px; }
.rep-head th { position: sticky; top: 0; z-index: 1; }
.rep-chip { transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease; }
.rep-chip:hover { border-color: #b6d9d5; color: #2f7d78; }
@keyframes rep-in { from { opacity: 0; transform: translate3d(0, 6px, 0); } to { opacity: 1; transform: none; } }
.rep-in { animation: rep-in 260ms cubic-bezier(0.22,0.61,0.36,1) both; }
@media (prefers-reduced-motion: reduce) {
  .rep-in { animation: none !important; }
  .rep-row, .rep-chip { transition: none !important; }
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

/** `2026-09-05` → `5 Sep`. The range line reads as a sentence, not as two keys. */
function shortDate(day: string): string {
  const parsed = Date.parse(`${day}T12:00:00+05:00`);
  if (Number.isNaN(parsed)) return day;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    day: "numeric",
    month: "short",
  }).format(new Date(parsed));
}

/** "Today" when the range is one day, otherwise the two ends of it. */
function describeRange(from: string, to: string): string {
  if (from === to) return from === karachiDayKey() ? `Today · ${shortDate(from)}` : shortDate(from);
  return `${shortDate(from)} — ${shortDate(to)}`;
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
  const page = usePagination(rows, isMobile ? 8 : 15);

  /**
   * Whether a row can be opened as a report of its own.
   *
   * Only if the server offered that person as a subject — a row this reader can
   * see inside a team total is not necessarily one they may ask about on their
   * own, and a click that produced "you cannot see that" would be worse than a
   * row that does not invite the click.
   */
  const selectable = useMemo(() => new Set(options.map((option) => option.value)), [options]);

  const openPerson = useCallback(
    (uid: string) => {
      if (!selectable.has(uid) || uid === subject) return;
      setSubject(uid);
      void run(from, to, uid);
    },
    [selectable, subject, run, from, to]
  );

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
    anchor.download = `report-${from}-to-${to}.csv`;
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
        padding: isMobile ? "16px 16px 26px" : "20px 28px 30px",
      }}
    >
      <style>{REPORT_CSS}</style>

      {/* ---------------------------------------------------------------- */}
      {/* Header — one line of who and when, and the way out to a file      */}
      {/* ---------------------------------------------------------------- */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              // Explicit family: `@layer base` sets font-family on h1–h6, which
              // beats a family inherited from the container.
              fontFamily: E.font,
              fontSize: isMobile ? 20 : 23,
              fontWeight: 800,
              letterSpacing: "-0.6px",
              color: E.ink,
              margin: 0,
            }}
          >
            Report
          </h1>
          <p style={{ margin: "3px 0 0", fontSize: 12.5, fontWeight: 600, color: E.muted }}>
            {loading ? (
              "Running…"
            ) : (
              <>
                {report?.subjectLabel ?? "—"}
                <span style={{ color: E.hair }}> · </span>
                <span style={{ color: E.tealInk }}>{describeRange(from, to)}</span>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={download}
          disabled={rows.length === 0}
          className="rep-chip"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "9px 15px",
            borderRadius: 999,
            border: `1px solid ${E.border}`,
            background: E.surface,
            color: rows.length === 0 ? E.hair : E.muted,
            fontSize: 12.5,
            fontWeight: 700,
            cursor: rows.length === 0 ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
          </svg>
          CSV
        </button>
      </header>

      {error && <Notice tone="error">{error}</Notice>}
      {report?.warning && <Notice tone="warn">{report.warning}</Notice>}

      {/* ---------------------------------------------------------------- */}
      {/* Controls — subject, range, presets, on one bar                    */}
      {/* ---------------------------------------------------------------- */}
      <section
        style={{
          background: E.surface,
          border: `1px solid ${E.border}`,
          borderRadius: 14,
          padding: isMobile ? "12px 13px" : "12px 14px",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          {/* Wider than the dates: the names inside it are the long values, and
              a truncated person is the one thing on this bar that must stay
              readable. */}
          <Field label="Report for" grow flexBasis={isMobile ? "100%" : "240px"}>
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
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 700,
              cursor: loading ? "progress" : "pointer",
              fontFamily: "inherit",
              flex: isMobile ? "1 1 100%" : undefined,
            }}
          >
            {loading ? "Running…" : "Run"}
          </button>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginLeft: isMobile ? 0 : "auto",
              flex: isMobile ? "1 1 100%" : undefined,
            }}
          >
            {PRESETS.map((preset) => {
              const range = presetRange(preset.days);
              const active = range.from === from && range.to === to;

              return (
                <button
                  key={preset.label}
                  type="button"
                  className="rep-chip"
                  aria-pressed={active}
                  onClick={() => {
                    setFrom(range.from);
                    setTo(range.to);
                    void run(range.from, range.to, subject);
                  }}
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${active ? E.teal : E.border}`,
                    background: active ? E.tealTint : E.field,
                    color: active ? E.tealInk : E.muted,
                    padding: "6px 13px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Totals — one strip, not six cards                                 */}
      {/* ---------------------------------------------------------------- */}
      {totals && <TotalsStrip totals={totals} isMobile={isMobile} />}

      {/* ---------------------------------------------------------------- */}
      {/* The report                                                        */}
      {/* ---------------------------------------------------------------- */}
      <section
        style={{
          background: E.surface,
          border: `1px solid ${E.border}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "11px 14px",
            borderBottom: `1px solid ${E.softBorder}`,
          }}
        >
          <h2
            style={{
              fontFamily: E.font,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "1.2px",
              textTransform: "uppercase",
              color: E.label,
              margin: 0,
            }}
          >
            {composite ? "By person" : "Summary"}
          </h2>
          <span style={{ fontSize: 11.5, color: E.faint, fontWeight: 600 }}>
            {composite ? "Open a row for that person's own report · " : ""}
            {rows.length} {rows.length === 1 ? "person" : "people"}
          </span>
        </div>

        {loading ? (
          <Skeleton rows={isMobile ? 4 : 6} />
        ) : rows.length === 0 ? (
          <Empty />
        ) : isMobile ? (
          <div style={{ padding: 12, display: "grid", gap: 9 }}>
            {page.items.map((row, index) => (
              <MobileRow
                key={row.uid}
                row={row}
                index={index}
                onOpen={selectable.has(row.uid) && row.uid !== subject ? () => openPerson(row.uid) : undefined}
              />
            ))}
            {composite && totals && <MobileTotals totals={totals} />}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                // Fourteen columns of tabular numbers. Below this they start
                // wrapping mid-heading, so the container scrolls instead.
                minWidth: 1120,
              }}
            >
              <thead className="rep-head">
                {/* The band row groups the columns, so the reader can see at a
                    glance that the last three are not a count of work done. */}
                <tr>
                  <th colSpan={3} style={bandCell("transparent", "left")} />
                  {BANDS.map((band) => (
                    <th
                      key={band.key}
                      colSpan={COLUMNS.filter((column) => column.band === band.key).length}
                      style={bandCell(band.tint)}
                    >
                      {band.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  <Th align="left">ID</Th>
                  <Th align="left">Name</Th>
                  <Th align="left">Team</Th>
                  {COLUMNS.map((column) => (
                    <Th key={column.key} title={column.hint} tint={BAND_TINT[column.band]}>
                      {column.short}
                    </Th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {page.items.map((row, index) => {
                  const openable = selectable.has(row.uid) && row.uid !== subject;

                  return (
                    <tr
                      key={row.uid}
                      className={`rep-row ${index < 10 ? "rep-in" : ""}`}
                      role={openable ? "button" : undefined}
                      tabIndex={openable ? 0 : undefined}
                      aria-label={openable ? `Open ${row.name}'s report` : undefined}
                      onClick={openable ? () => openPerson(row.uid) : undefined}
                      onKeyDown={
                        openable
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openPerson(row.uid);
                              }
                            }
                          : undefined
                      }
                      style={{
                        borderTop: `1px solid ${E.rowBorder}`,
                        cursor: openable ? "pointer" : "default",
                        animationDelay: index < 10 ? `${index * 24}ms` : undefined,
                      }}
                    >
                      <td
                        title={row.uid}
                        style={{
                          padding: "10px 14px",
                          fontSize: 11,
                          fontWeight: 700,
                          color: E.faint,
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.id}
                      </td>

                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                          <span
                            aria-hidden
                            style={{
                              width: 27,
                              height: 27,
                              borderRadius: 999,
                              background: E.tealTint,
                              color: E.tealInk,
                              display: "grid",
                              placeItems: "center",
                              fontSize: 11.5,
                              fontWeight: 800,
                              flexShrink: 0,
                            }}
                          >
                            {row.name.charAt(0).toUpperCase()}
                          </span>
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: E.ink,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              minWidth: 0,
                            }}
                          >
                            {row.name}
                          </span>
                          {row.role !== "employee" && <RolePill role={row.role} />}
                        </div>
                      </td>

                      <td
                        style={{
                          padding: "10px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: E.muted,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.team}
                      </td>

                      {COLUMNS.map((column) => (
                        <td
                          key={column.key}
                          style={{
                            padding: "10px 14px",
                            textAlign: "right",
                            fontSize: 13,
                            fontWeight: 700,
                            // A zero renders in the hairline tone, so a row of
                            // real work stands out from a row of nothing.
                            color: row[column.key] > 0 ? column.accent : E.hair,
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap",
                            background: BAND_TINT[column.band],
                          }}
                        >
                          {row[column.key]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>

              {/* A total identical to the only row above it is noise — the
                  phone drops it for the same reason. */}
              {totals && composite && (
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${E.border}`, background: E.field }}>
                    <td
                      colSpan={3}
                      style={{
                        padding: "11px 14px",
                        fontSize: 10.5,
                        fontWeight: 800,
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
                          padding: "11px 14px",
                          textAlign: "right",
                          fontSize: 13.5,
                          fontWeight: 800,
                          color: E.ink,
                          fontVariantNumeric: "tabular-nums",
                          background: BAND_TINT[column.band],
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
          <div style={{ padding: "0 12px 10px" }}>
            <Pager pagination={page} variant={isMobile ? "mobile" : "web"} noun="people" />
          </div>
        )}
      </section>

      <p style={{ marginTop: 12, fontSize: 11, color: E.faint, lineHeight: 1.6 }}>
        Every activity column counts <strong style={{ color: E.muted }}>entries written in the
        range</strong> — one row per call or note logged, not one per lead. An employee who logged
        thirty follow-ups today across five leads reads as 30 here and as 5 leads on their own
        record; both are right, and they are answers to different questions.{" "}
        <strong style={{ color: E.muted }}>Remarks</strong> and{" "}
        <strong style={{ color: E.muted }}>Follow-ups</strong> count every entry; the connect
        columns count only the calls that were answered, so the two do not add up and are not meant
        to. A manager&rsquo;s report includes their own work <em>and</em> their team&rsquo;s, and
        nobody is counted twice.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every headline figure on one line.
 *
 * The six stat cards this replaces occupied about 380px of vertical space to
 * carry six numbers, and the reader had to scroll past them to reach the report
 * they came for. The same six — plus the five the cards never showed — fit in
 * one strip, and the pipeline bands are separated by a rule and a tint rather
 * than by a second panel, because they answer a different question.
 */
function TotalsStrip({ totals, isMobile }: { totals: PersonMetrics; isMobile: boolean }) {
  return (
    <section
      aria-label="Totals"
      style={{
        background: E.surface,
        border: `1px solid ${E.border}`,
        borderRadius: 14,
        marginBottom: 12,
        overflowX: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          minWidth: isMobile ? undefined : "max-content",
          flexWrap: isMobile ? "wrap" : "nowrap",
        }}
      >
        {COLUMNS.map((column, index) => {
          const first = index > 0 && COLUMNS[index - 1].band !== column.band;

          return (
            <div
              key={column.key}
              title={column.hint}
              style={{
                // `1 0 auto`, never `1 1 0`: a shrinking basis sizes every cell
                // to its minimum and ellipsises the headings — "FOLLOW-…" — on
                // a strip that is allowed to scroll anyway. Grow to fill a wide
                // screen, never shrink below the words.
                flex: isMobile ? "1 1 33%" : "1 0 auto",
                minWidth: isMobile ? 0 : 96,
                padding: isMobile ? "11px 12px" : "12px 16px",
                background: BAND_TINT[column.band],
                // A hairline between figures, and a full rule where the meaning
                // of the numbers changes.
                borderLeft:
                  index === 0
                    ? "none"
                    : first
                      ? `1.5px solid ${E.border}`
                      : `1px solid ${E.rowBorder}`,
              }}
            >
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "0.8px",
                  textTransform: "uppercase",
                  color: E.label,
                  whiteSpace: "nowrap",
                }}
              >
                {column.short}
              </div>
              <div
                style={{
                  marginTop: 3,
                  fontSize: isMobile ? 19 : 21,
                  fontWeight: 800,
                  letterSpacing: "-0.6px",
                  color: totals[column.key] > 0 ? E.ink : E.hair,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {totals[column.key].toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RolePill({ role }: { role: ReportRow["role"] }) {
  const manager = role === "subadmin";
  return (
    <span
      style={{
        flexShrink: 0,
        borderRadius: 999,
        background: manager ? E.tealTint : E.amberBg,
        color: manager ? E.tealInk : E.amberInk,
        padding: "1px 7px",
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
      }}
    >
      {manager ? "Manager" : "Admin"}
    </span>
  );
}

/** A phone row: identity, then every figure the table shows — none dropped. */
function MobileRow({
  row,
  index,
  onOpen,
}: {
  row: ReportRow;
  index: number;
  /** Absent when this person is not a subject this reader may ask about. */
  onOpen?: () => void;
}) {
  return (
    <div
      className={index < 8 ? "rep-in" : undefined}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `Open ${row.name}'s report` : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      style={{
        border: `1px solid ${E.border}`,
        borderRadius: 14,
        background: E.surface,
        padding: "12px 13px",
        cursor: onOpen ? "pointer" : "default",
        animationDelay: index < 8 ? `${index * 28}ms` : undefined,
        WebkitTapHighlightColor: "transparent",
      }}
    >
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
        <div style={{ minWidth: 0, flex: 1 }}>
          <p
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: E.ink,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.name}
          </p>
          <p style={{ fontSize: 11, color: E.faint, fontWeight: 600 }}>
            {row.id} · {row.team}
          </p>
        </div>
        {row.role !== "employee" && <RolePill role={row.role} />}
      </div>

      <div
        style={{
          marginTop: 11,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(70px, 1fr))",
          gap: 8,
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
        padding: "12px 13px",
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
          marginTop: 9,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(70px, 1fr))",
          gap: 8,
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
          fontSize: 9,
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
          fontSize: 15.5,
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

/** The band heading above a group of columns. */
function bandCell(tint: string, align: "left" | "center" = "center"): React.CSSProperties {
  return {
    textAlign: align,
    padding: "8px 14px 2px",
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: "1px",
    textTransform: "uppercase",
    color: E.hair,
    whiteSpace: "nowrap",
    background: tint === "transparent" ? E.field : tint,
  };
}

function Th({
  children,
  align = "right",
  title,
  tint,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  title?: string;
  tint?: string;
}) {
  return (
    <th
      title={title}
      style={{
        textAlign: align,
        padding: "6px 14px 10px",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.9px",
        textTransform: "uppercase",
        color: E.label,
        whiteSpace: "nowrap",
        borderBottom: `1px solid ${E.border}`,
        background: !tint || tint === "transparent" ? E.field : tint,
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
        gap: 4,
        flex: grow ? `1 1 ${flexBasis ?? "150px"}` : undefined,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "1px",
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
  padding: "9px 11px",
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
        marginBottom: 12,
        borderRadius: 12,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.ink,
        padding: "10px 13px",
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
    <div style={{ padding: 14, display: "grid", gap: 9 }}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          style={{
            height: 42,
            borderRadius: 10,
            background: `linear-gradient(90deg, ${E.field} 25%, ${E.tint} 50%, ${E.field} 75%)`,
          }}
        />
      ))}
    </div>
  );
}

function Empty() {
  return (
    <div style={{ padding: "44px 24px", textAlign: "center" }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: E.ink }}>No activity in this range.</p>
      <p style={{ margin: "6px auto 0", maxWidth: 420, fontSize: 12.5, color: E.faint, lineHeight: 1.6 }}>
        Pick a wider range or a different person. Every figure here is computed from the records
        themselves, so an empty report means nothing was logged — not that something is missing.
      </p>
    </div>
  );
}
