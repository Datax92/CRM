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
 * Every figure comes from the records themselves over the chosen range —
 * `buildTeamReport` computes them server-side, scoped to whoever is asking
 * (admin and HR see everyone, a Sales manager their own team, an employee only
 * themselves). Nothing here is a maintained statistic.
 *
 * **Connect and Follow-Up Connect are disjoint**: Connect is the first
 * connected contact on a lead, Follow-Up Connect every later one. Counting the
 * opening call in both would make the columns sum to more work than happened.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { buildTeamReport } from "@/lib/clientActions";
import type { TeamReport, ReportRow } from "@/app/actions/reports";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import { E, HeroRings, Card, Bar } from "@/components/employees/directoryChrome";

/* -------------------------------------------------------------------------- */
/* Columns                                                                     */
/* -------------------------------------------------------------------------- */

type MetricKey = keyof Omit<ReportRow, "uid" | "name" | "assignedTo">;

interface Column {
  key: MetricKey;
  label: string;
  short: string;
  accent: string;
  /** 24×24 stroke path, matching the directory's stat-card icons. */
  icon: string;
  hint: string;
}

const COLUMNS: Column[] = [
  {
    key: "connects",
    label: "Connect",
    short: "Connect",
    accent: E.tealInk,
    icon: "M6.5 3.5 9 8.5l-2 1.5a11 11 0 0 0 5 5l1.5-2 5 2.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3 6.7 2 2 0 0 1 5 4.5Z",
    hint: "First connected contact on a lead",
  },
  {
    key: "followUpConnects",
    label: "Follow-Up Connect",
    short: "F/U Connect",
    accent: E.teal,
    icon: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
    hint: "Every connected contact after the first",
  },
  {
    key: "meetings",
    label: "Meeting Done",
    short: "Meetings",
    accent: E.blue,
    icon: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM9 14l2 2 4-4",
    hint: "Follow-ups with a meeting recorded",
  },
  {
    key: "siteVisits",
    label: "Site Visit",
    short: "Site Visit",
    accent: E.amberInk,
    icon: "M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
    hint: "Counted apart from meetings — usually a different day",
  },
  {
    key: "p3",
    label: "P3",
    short: "P3",
    accent: E.faint,
    icon: "M4 19h16M7 16V9M12 16v-4M17 16v-7",
    hint: "Still talking",
  },
  {
    key: "p2",
    label: "P2",
    short: "P2",
    accent: E.blue,
    icon: "M4 19h16M7 16V9M12 16v-4M17 16v-7",
    hint: "They showed up",
  },
  {
    key: "p1",
    label: "P1",
    short: "P1",
    accent: E.tealInk,
    icon: "M4 19h16M7 16V9M12 16v-4M17 16v-7",
    hint: "Closing",
  },
];

/** The four the hero summarises. The P-bands are a distribution, not a total. */
const HEADLINE: MetricKey[] = ["connects", "followUpConnects", "meetings", "siteVisits"];

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
  const [search, setSearch] = useState("");
  const [report, setReport] = useState<TeamReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (nextFrom: string, nextTo: string) => {
      setLoading(true);
      setError(null);

      const token = await getIdToken().catch(() => "");
      if (!token) {
        setLoading(false);
        setError("Your session has ended. Please sign in again.");
        return;
      }

      const result = await buildTeamReport(token, nextFrom, nextTo);
      setLoading(false);

      if (result.ok) setReport(result.data);
      else {
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
      const initial = { from: monthStart(), to: karachiDayKey() };
      const token = await getIdToken().catch(() => "");
      if (cancelled) return;
      if (!token) {
        setLoading(false);
        setError("Your session has ended. Please sign in again.");
        return;
      }

      const result = await buildTeamReport(token, initial.from, initial.to);
      if (cancelled) return;

      setLoading(false);
      if (result.ok) setReport(result.data);
      else setError(result.error);
    })();

    return () => {
      cancelled = true;
    };
  }, [getIdToken]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return report?.rows ?? [];
    return (report?.rows ?? []).filter(
      (row) =>
        row.name.toLowerCase().includes(needle) || row.assignedTo.toLowerCase().includes(needle)
    );
  }, [report, search]);

  const page = usePagination(rows, isMobile ? 8 : 12);
  const totals = report?.totals;

  const download = () => {
    const header = ["Name", "Assigned To", ...COLUMNS.map((column) => column.label)];
    const body = rows.map((row) => [
      row.name,
      row.assignedTo,
      ...COLUMNS.map((column) => row[column.key]),
    ]);

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
                Summary Report
              </h1>
              <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.82, marginTop: 4 }}>
                {loading
                  ? "Running…"
                  : `${rows.length} ${rows.length === 1 ? "person" : "people"} · ${from} → ${to}`}
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
      {/* Range                                                             */}
      {/* ---------------------------------------------------------------- */}
      <Card style={{ padding: isMobile ? "14px 15px" : "16px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
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
          <Field label="Search" grow>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or manager"
              style={field}
            />
          </Field>

          <button
            type="button"
            onClick={() => void run(from, to)}
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
                void run(next.from, next.to);
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
            Summary
          </h2>
          {totals && (
            <span style={{ fontSize: 12, color: E.faint, fontWeight: 600 }}>
              {totals.p3 + totals.p2 + totals.p1} leads in the pipeline
            </span>
          )}
        </div>

        {loading ? (
          <Skeleton rows={isMobile ? 4 : 6} />
        ) : rows.length === 0 ? (
          <Empty search={Boolean(search)} />
        ) : isMobile ? (
          <div style={{ padding: 14, display: "grid", gap: 10 }}>
            {page.items.map((row, index) => (
              <MobileRow key={row.uid} row={row} index={index} />
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr>
                  <Th align="left">Name</Th>
                  <Th align="left">Assigned To</Th>
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
                        <span
                          style={{
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
                        {row.assignedTo}
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

              {totals && (
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${E.border}`, background: E.field }}>
                    <td
                      colSpan={2}
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
        <strong style={{ color: E.muted }}>Connect</strong> is the first connected contact on a
        lead; <strong style={{ color: E.muted }}>Follow-Up Connect</strong> is every one after it —
        they never double-count the same call. P3 / P2 / P1 describe where each person&rsquo;s leads
        stand today, from their pipeline status.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

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

/** A phone row: the name, who runs them, then the seven figures in a grid. */
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
            Assigned to {row.assignedTo}
          </p>
        </div>
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
          <div key={column.key} style={{ minWidth: 0 }}>
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
              {column.short}
            </p>
            <p
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: row[column.key] > 0 ? column.accent : E.hair,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {row[column.key]}
            </p>
          </div>
        ))}
      </div>
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
  children,
}: {
  label: string;
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 5, flex: grow ? "1 1 160px" : undefined, minWidth: 0 }}>
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

function Empty({ search }: { search: boolean }) {
  return (
    <div style={{ padding: "48px 24px", textAlign: "center" }}>
      <p style={{ fontSize: 14.5, fontWeight: 700, color: E.ink }}>
        {search ? "Nobody matches that search." : "No activity in this range."}
      </p>
      <p style={{ margin: "6px auto 0", maxWidth: 420, fontSize: 12.5, color: E.faint, lineHeight: 1.6 }}>
        {search
          ? "Try a different name, or clear the search to see the whole team."
          : "Pick a wider range, or check back once follow-ups have been logged. Every figure here is computed from the records themselves."}
      </p>
    </div>
  );
}
