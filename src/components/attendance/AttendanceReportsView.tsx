"use client";

/**
 * Attendance reports (§9).
 *
 * Every column is computed from the attendance records themselves over the
 * chosen range — nothing here is a stored statistic, so a corrected day moves
 * the report the moment it is corrected. That is also why the range is a real
 * From/To rather than a month picker: payroll periods do not always start on
 * the 1st, and a report that cannot express the period it is for is a report
 * somebody re-does in a spreadsheet.
 *
 * The download is CSV built in the browser from what is already on screen. It
 * cannot disagree with the table, and it needs no second server round trip.
 */

import { useMemo, useState } from "react";
import { Download, Filter } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTeamAttendance } from "@/hooks/useTeamAttendance";
import { formatWorkedHours } from "@/lib/attendance";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { A, AttendanceCard, EmptyState, Figure } from "./attendanceChrome";
import { MyAttendanceView } from "./MyAttendanceView";
import { Pager } from "@/components/employees/DossierControls";
import { usePagination } from "@/hooks/usePagination";

type SortKey = "name" | "present" | "late" | "absent" | "leave" | "rate" | "deduction";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "name", label: "Employee", numeric: false },
  { key: "present", label: "Present", numeric: true },
  { key: "late", label: "Late", numeric: true },
  { key: "absent", label: "Absent", numeric: true },
  { key: "leave", label: "Leave", numeric: true },
  { key: "rate", label: "Rate", numeric: true },
  { key: "deduction", label: "Deduction", numeric: true },
];

/** The first of the current month — the period a payroll question usually means. */
function monthStart(): string {
  return `${karachiMonthKey()}-01`;
}

export function AttendanceReportsView() {
  const { user } = useAuth();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(karachiDayKey());
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState<"ALL" | "LATE" | "ABSENT" | "LEAVE">("ALL");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });
  const [openUid, setOpenUid] = useState<string | null>(null);

  const team = useTeamAttendance(from, to);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const filtered = team.rows.filter((row) => {
      if (needle && !row.name.toLowerCase().includes(needle)) return false;
      if (only === "LATE") return row.late > 0;
      if (only === "ABSENT") return row.absent > 0;
      if (only === "LEAVE") return row.leave > 0;
      return true;
    });

    const direction = sort.desc ? -1 : 1;
    return [...filtered].sort((a, b) =>
      sort.key === "name"
        ? a.name.localeCompare(b.name) * direction
        : ((a[sort.key] as number) - (b[sort.key] as number)) * direction
    );
  }, [team.rows, search, only, sort]);

  const page = usePagination(rows, 12);

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          present: sum.present + row.present,
          late: sum.late + row.late,
          absent: sum.absent + row.absent,
          leave: sum.leave + row.leave,
          deduction: sum.deduction + row.deduction,
          minutes: sum.minutes + row.workedMinutes,
        }),
        { present: 0, late: 0, absent: 0, leave: 0, deduction: 0, minutes: 0 }
      ),
    [rows]
  );

  const download = () => {
    const header = [
      "Employee",
      "Manager",
      "Present",
      "Late",
      "Absent",
      "Leave",
      "Half day",
      "Hours",
      "Attendance %",
      "Deduction (PKR)",
    ];
    const body = rows.map((row) => [
      row.name,
      row.managerName ?? "",
      row.present,
      row.late,
      row.absent,
      row.leave,
      row.halfDay,
      formatWorkedHours(row.workedMinutes),
      row.rate,
      row.deduction,
    ]);

    // Quote every field: a name with a comma in it would otherwise shift every
    // column after it by one, silently.
    const csv = [header, ...body]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");

    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `attendance-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AttendanceCard title="Period and filters" hint={`${from} → ${to}`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={labelStyle}>From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              style={fieldStyle}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={labelStyle}>To</span>
            <input
              type="date"
              value={to}
              min={from}
              max={karachiDayKey()}
              onChange={(event) => setTo(event.target.value)}
              style={fieldStyle}
            />
          </label>
          <label style={{ display: "grid", gap: 4, flex: "1 1 180px" }}>
            <span style={labelStyle}>Employee</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name"
              style={{ ...fieldStyle, width: "100%" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={labelStyle}>Show</span>
            <select
              value={only}
              onChange={(event) => setOnly(event.target.value as typeof only)}
              style={fieldStyle}
            >
              <option value="ALL">Everyone</option>
              <option value="LATE">Anyone late</option>
              <option value="ABSENT">Anyone absent</option>
              <option value="LEAVE">Anyone on leave</option>
            </select>
          </label>
          <button
            type="button"
            onClick={download}
            disabled={rows.length === 0}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              borderRadius: 10,
              border: `1px solid ${A.line}`,
              background: A.surface,
              color: rows.length === 0 ? A.faint : A.teal,
              padding: "9px 15px",
              fontSize: 13,
              fontWeight: 700,
              cursor: rows.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            <Download size={15} /> CSV
          </button>
        </div>
      </AttendanceCard>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
          gap: 12,
        }}
      >
        <Figure label="Present days" value={totals.present} tone="PRESENT" />
        <Figure label="Late days" value={totals.late} tone="LATE" />
        <Figure label="Absent days" value={totals.absent} tone="ABSENT" />
        <Figure label="Leave days" value={totals.leave} tone="LEAVE" />
        <Figure
          label="Deductions"
          value={`Rs ${totals.deduction.toLocaleString("en-PK")}`}
          note="under the current rule"
        />
      </div>

      <AttendanceCard
        title="Attendance report"
        hint={`${rows.length} ${rows.length === 1 ? "person" : "people"}`}
        action={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: A.faint }}>
            <Filter size={13} /> Tap a row for the full record
          </span>
        }
      >
        {team.error && (
          <p role="alert" style={{ fontSize: 13, color: "#a33a29", marginBottom: 10 }}>
            {team.error}
          </p>
        )}

        {rows.length === 0 ? (
          <EmptyState>
            {team.loading ? "Running the report." : "Nobody matches these filters."}
          </EmptyState>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                <thead>
                  <tr>
                    {COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        onClick={() =>
                          setSort((current) => ({
                            key: column.key,
                            desc: current.key === column.key ? !current.desc : column.numeric,
                          }))
                        }
                        style={{
                          textAlign: column.numeric ? "right" : "left",
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: "0.6px",
                          textTransform: "uppercase",
                          color: sort.key === column.key ? A.teal : A.faint,
                          padding: "0 10px 8px",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                          userSelect: "none",
                        }}
                      >
                        {column.label}
                        {sort.key === column.key ? (sort.desc ? " ↓" : " ↑") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((row) => (
                    <tr
                      key={row.uid}
                      onClick={() => setOpenUid(row.uid)}
                      style={{ borderTop: `1px solid ${A.hair}`, cursor: "pointer" }}
                    >
                      <td style={{ padding: "9px 10px" }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: A.ink }}>{row.name}</p>
                        <p style={{ fontSize: 11, color: A.faint }}>
                          {row.managerName ? `Reports to ${row.managerName}` : row.jobTitle ?? ""}
                        </p>
                      </td>
                      <td style={numericCell}>{row.present}</td>
                      <td style={{ ...numericCell, color: row.late > 0 ? "#7a5230" : A.ink }}>
                        {row.late}
                      </td>
                      <td style={{ ...numericCell, color: row.absent > 0 ? "#a33a29" : A.ink }}>
                        {row.absent}
                      </td>
                      <td style={numericCell}>{row.leave}</td>
                      <td style={numericCell}>{row.rate}%</td>
                      <td
                        style={{
                          ...numericCell,
                          color: row.deduction > 0 ? "#a33a29" : A.faint,
                        }}
                      >
                        {row.deduction > 0 ? `Rs ${row.deduction.toLocaleString("en-PK")}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager pagination={page} variant="web" noun="people" />
          </>
        )}
      </AttendanceCard>

      {/* The full record for one person, reusing the screen they see themselves
          — one implementation, so the two cannot disagree. */}
      {openUid && (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpenUid(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: "rgba(15,42,40,0.45)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 940,
              background: A.ground,
              borderRadius: 18,
              padding: 18,
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => setOpenUid(null)}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${A.line}`,
                  background: A.surface,
                  color: A.muted,
                  padding: "6px 15px",
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
            <MyAttendanceView
              uid={openUid}
              readOnly={openUid !== user?.uid}
              heading="Attendance record"
              subject={rows.find((row) => row.uid === openUid)?.name}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.6px",
  textTransform: "uppercase",
  color: A.faint,
};

const fieldStyle: React.CSSProperties = {
  borderRadius: 10,
  border: `1px solid ${A.line}`,
  background: "#fff",
  color: A.ink,
  padding: "9px 11px",
  fontSize: 14,
  fontWeight: 600,
  outline: "none",
};

const numericCell: React.CSSProperties = {
  padding: "9px 10px",
  textAlign: "right",
  fontSize: 13,
  fontWeight: 600,
  color: A.ink,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};
