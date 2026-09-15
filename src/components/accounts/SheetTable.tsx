"use client";

/**
 * The owner's sheets, as a table — for the desktop.
 *
 * Investment with X, the Mahziyar performance sheet, the month's spending and
 * the receivables are all spreadsheets in the owner's own files, and the owner
 * reads them as spreadsheets: a header band, a row per record, figures right
 * aligned in tabular digits, and a **TOTAL** row at the foot. This draws that,
 * in the Accounts palette, and nothing else — the phone gets cards
 * (`ExpenseList` + `FigureStrip`), never this table squeezed, which is this
 * project's rule 7.
 *
 * Wide content scrolls **inside** the card; the page never scrolls sideways. The
 * first column stays pinned while the figures scroll under it, so a twelve-column
 * row can still be read against its date or its name.
 */

import type { CSSProperties, ReactNode } from "react";
import { X } from "@/components/finance/expensesChrome";

export interface SheetColumn<T> {
  key: string;
  header: ReactNode;
  align?: "left" | "right" | "center";
  /** CSS width for the column, e.g. `120px`. */
  width?: string;
  render: (row: T, index: number) => ReactNode;
  /** The TOTAL row's cell for this column. */
  total?: ReactNode;
  /** Tints the column: income teal, expense amber, net deep. */
  tone?: "income" | "expense" | "net";
}

const TONES = {
  income: { head: "#e3f1ee", cell: "#f7fbfa", ink: "#2f7d78" },
  expense: { head: "#fbf1de", cell: "#fffcf6", ink: "#8a6321" },
  net: { head: "#d6ebe7", cell: "#eef7f5", ink: "#1f5c58" },
} as const;

export function SheetTable<T>({
  title,
  aside,
  columns,
  rows,
  rowKey,
  onRowClick,
  totalsLabel = "TOTAL",
  showTotals = true,
  empty,
  rowStyle,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  columns: SheetColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  totalsLabel?: string;
  showTotals?: boolean;
  empty: string;
  /** Per-row background, for a closed month or a settled entry. */
  rowStyle?: (row: T) => CSSProperties | undefined;
}) {
  const cellBase: CSSProperties = {
    padding: "10px 12px",
    fontSize: 13,
    color: X.ink,
    borderBottom: `1px solid ${X.rowLine}`,
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  };
  const pinned = (index: number): CSSProperties =>
    index === 0 ? { position: "sticky", left: 0, zIndex: 1, boxShadow: `1px 0 0 ${X.line}` } : {};

  return (
    <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 18, overflow: "hidden" }}>
      {(title || aside) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            padding: "13px 18px",
            borderBottom: `1px solid ${X.panelLine}`,
            background: X.tint,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.muted }}>
            {title}
          </div>
          {aside}
        </div>
      )}

      <div className="teal-scrollbar" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "max-content" }}>
          <thead>
            <tr>
              {columns.map((column, index) => {
                const tone = column.tone ? TONES[column.tone] : null;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={{
                      ...pinned(index),
                      width: column.width,
                      textAlign: column.align ?? "left",
                      padding: "10px 12px",
                      fontSize: 10.5,
                      fontWeight: 800,
                      letterSpacing: "0.8px",
                      textTransform: "uppercase",
                      color: tone?.ink ?? X.muted,
                      background: tone?.head ?? "#f0f6f5",
                      borderBottom: `1px solid ${X.line}`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {column.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ ...cellBase, whiteSpace: "normal", textAlign: "center", color: X.faint, padding: "34px 16px" }}>
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => {
                const extra = rowStyle?.(row);
                return (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={onRowClick ? "sheet-row" : undefined}
                    style={{ cursor: onRowClick ? "pointer" : undefined }}
                  >
                    {columns.map((column, index) => {
                      const tone = column.tone ? TONES[column.tone] : null;
                      return (
                        <td
                          key={column.key}
                          style={{
                            ...cellBase,
                            ...pinned(index),
                            textAlign: column.align ?? "left",
                            background: extra?.background ?? tone?.cell ?? "#fff",
                            color: tone && column.tone === "net" ? tone.ink : cellBase.color,
                            fontWeight: column.tone === "net" ? 800 : index === 0 ? 700 : 600,
                            ...(extra && index === 0 ? { opacity: extra.opacity } : {}),
                          }}
                        >
                          {column.render(row, rowIndex)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
          {showTotals && rows.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((column, index) => {
                  const tone = column.tone ? TONES[column.tone] : null;
                  return (
                    <td
                      key={column.key}
                      style={{
                        ...cellBase,
                        ...pinned(index),
                        textAlign: column.align ?? "left",
                        fontWeight: 800,
                        fontSize: 13.5,
                        color: tone?.ink ?? X.ink,
                        background: tone?.head ?? "#f0f6f5",
                        borderTop: `2px solid ${X.track}`,
                        borderBottom: "none",
                      }}
                    >
                      {index === 0 ? column.total ?? totalsLabel : column.total ?? ""}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {/* Row hover, scoped to this component's class. */}
      <style>{`.sheet-row:hover td { background: #f3faf9 !important; }`}</style>
    </section>
  );
}

/** A small action pill for the end of a sheet row — stops the row's own click. */
export function SheetAction({
  label,
  d,
  tone = "quiet",
  onClick,
  disabled,
}: {
  label: string;
  d: string;
  tone?: "good" | "bad" | "quiet";
  onClick: () => void;
  disabled?: boolean;
}) {
  const color = tone === "good" ? "#2f7d78" : tone === "bad" ? "#a8483c" : "#5b6d6b";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={{
        width: 30,
        height: 30,
        borderRadius: 9,
        border: `1px solid ${X.line}`,
        background: "#fff",
        color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        marginLeft: 4,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    </button>
  );
}

/** A figure cell: blank for zero, as the owner's sheet leaves a share column empty. */
export function Amount({ value, dashZero = true, format }: { value: number; dashZero?: boolean; format: (n: number) => string }) {
  if (dashZero && (!value || Math.abs(value) < 0.005)) return <span style={{ color: "#c3d5d3" }}>–</span>;
  return <span style={{ color: value < 0 ? "#a8483c" : undefined }}>{format(value)}</span>;
}
