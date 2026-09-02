"use client";

import { isStageFilter } from "@/lib/leadBuckets";
import { STAGE_TONES } from "@/components/leads/StageChrome";
/**
 * The filter row and the pager the employee dossier uses on both surfaces.
 *
 * One implementation at two sizes, for the same reason as `AnalyticsPanels`:
 * a second copy would let the phone's idea of "This week" drift from the
 * desktop's. The geometry is a `variant`, the behaviour is not.
 */

import type { Pagination } from "@/hooks/usePagination";
import {
  E,
  DOSSIER_PERIODS,
  DOSSIER_LEAD_CUTS,
  LEAD_FILTER_LABELS,
  type DossierFilters,
  type LeadFilterKey,
  type RangeKey,
} from "./directoryChrome";

type Variant = "web" | "mobile";

/**
 * Period + lead cut.
 *
 * `showCut` is false on the Deals and Activity tabs — a deal has no pipeline
 * status and no pipeline stage, so offering "P2" there would be a control that
 * silently does nothing.
 */
export function DossierFilterBar({
  filters,
  onChange,
  variant,
  showCut = true,
  countLine,
}: {
  filters: DossierFilters;
  onChange: (next: DossierFilters) => void;
  variant: Variant;
  showCut?: boolean;
  countLine?: string;
}) {
  const web = variant === "web";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: web ? 12 : 10,
        marginBottom: web ? 14 : 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: web ? 10 : 8, flexWrap: "wrap", minWidth: 0 }}>
        <select
          value={filters.period}
          onChange={(e) => onChange({ ...filters, period: e.target.value as RangeKey })}
          aria-label="Filter by period"
          style={{
            border: `1px solid ${E.border}`,
            background: E.surface,
            borderRadius: web ? 10 : 999,
            padding: web ? "8px 12px" : "9px 14px",
            fontSize: web ? 12.5 : 12,
            fontWeight: 700,
            color: E.muted,
            outline: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          {DOSSIER_PERIODS.map((period) => (
            <option key={period.key} value={period.key}>
              {period.label}
            </option>
          ))}
        </select>

        {showCut && (
          <div
            role="tablist"
            aria-label="Filter leads"
            style={{
              display: "flex",
              alignItems: "center",
              gap: web ? 4 : 6,
              padding: web ? 4 : 0,
              borderRadius: web ? 11 : 0,
              background: web ? "#f0f6f5" : "transparent",
              overflowX: "auto",
              minWidth: 0,
            }}
          >
            {DOSSIER_LEAD_CUTS.map((key) => (
              <CutChip
                key={key}
                cut={key}
                active={filters.cut === key}
                variant={variant}
                onSelect={() => onChange({ ...filters, cut: key })}
              />
            ))}
          </div>
        )}
      </div>

      {countLine && (
        <span
          style={{
            fontSize: web ? 12.5 : 11.5,
            fontWeight: 600,
            color: E.faint,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {countLine}
        </span>
      )}
    </div>
  );
}

/**
 * The stage chips wear their own colours rather than the shared teal, exactly
 * as the leads workspace does — an active stage chip has to say which
 * *kind* of cut is in force, not merely that one is.
 */
function CutChip({
  cut,
  active,
  variant,
  onSelect,
}: {
  cut: LeadFilterKey;
  active: boolean;
  variant: Variant;
  onSelect: () => void;
}) {
  const web = variant === "web";
  const stageTone = isStageFilter(cut) ? STAGE_TONES[cut] : null;
  const accent = stageTone ? stageTone.softText : E.tealInk;
  const fill = stageTone ? stageTone.soft : E.surface;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={web ? undefined : "mob-press"}
      style={{
        flexShrink: 0,
        padding: web ? "8px 15px" : "9px 15px",
        borderRadius: web ? 8 : 999,
        border: web ? "none" : `1px solid ${active ? accent : "#dceae8"}`,
        fontSize: web ? 12.5 : 12,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        color: active ? (web ? accent : cut === "ALL" ? "#fff" : accent) : "#7e918f",
        background: active ? (web ? fill : cut === "ALL" ? E.teal : fill) : web ? "transparent" : "#fff",
        boxShadow: web && active ? "0 1px 3px rgba(31,92,88,0.12)" : "none",
        WebkitTapHighlightColor: "transparent",
        transition: "background-color 160ms ease, color 160ms ease",
      }}
    >
      {LEAD_FILTER_LABELS[cut]}
    </button>
  );
}

/**
 * The pager. Hidden entirely when everything fits on one page — a control that
 * can only ever say "1 of 1" is noise.
 */
export function Pager({
  pagination,
  variant,
  noun = "rows",
}: {
  pagination: Pagination<unknown>;
  variant: Variant;
  noun?: string;
}) {
  if (pagination.single) return null;
  const web = variant === "web";

  // A window of at most five numbers around the current page: a roster of two
  // hundred would otherwise print forty buttons.
  const start = Math.max(1, Math.min(pagination.page - 2, pagination.pageCount - 4));
  const end = Math.min(pagination.pageCount, start + 4);
  const numbers: number[] = [];
  for (let n = start; n <= end; n += 1) numbers.push(n);

  return (
    <nav
      aria-label="Pagination"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        padding: web ? "12px 0 2px" : "14px 2px 2px",
      }}
    >
      <span style={{ fontSize: web ? 12.5 : 11.5, fontWeight: 500, color: E.faint, whiteSpace: "nowrap" }}>
        {pagination.from}–{pagination.to} of {pagination.total} {noun}
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Step
          label="Previous page"
          disabled={pagination.page === 1}
          onPress={pagination.previous}
          variant={variant}
          d="m14 6-6 6 6 6"
        />
        {numbers.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => pagination.setPage(n)}
            aria-label={`Page ${n}`}
            aria-current={n === pagination.page ? "page" : undefined}
            className={web ? undefined : "mob-press"}
            style={{
              minWidth: web ? 32 : 34,
              height: web ? 32 : 34,
              borderRadius: web ? 9 : 999,
              border: `1px solid ${n === pagination.page ? E.teal : E.border}`,
              background: n === pagination.page ? E.teal : E.surface,
              color: n === pagination.page ? "#fff" : E.muted,
              fontSize: 12.5,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              cursor: "pointer",
              fontFamily: "inherit",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {n}
          </button>
        ))}
        <Step
          label="Next page"
          disabled={pagination.page === pagination.pageCount}
          onPress={pagination.next}
          variant={variant}
          d="m10 6 6 6-6 6"
        />
      </div>
    </nav>
  );
}

function Step({
  label,
  disabled,
  onPress,
  variant,
  d,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  variant: Variant;
  d: string;
}) {
  const web = variant === "web";
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      className={web ? undefined : "mob-press"}
      style={{
        width: web ? 32 : 34,
        height: web ? 32 : 34,
        borderRadius: web ? 9 : 999,
        border: `1px solid ${E.border}`,
        background: E.surface,
        color: disabled ? E.hair : E.tealInk,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    </button>
  );
}

/**
 * The pager for a list paged by a **Firestore cursor** rather than in memory.
 *
 * Visually the same family as `Pager` — the same `Step` arrows, the same
 * count line on the left — but there are no page numbers, because a cursor
 * cannot jump to page 7: Firestore has no offset, and faking one costs a read
 * per skipped row. Printing numbers that only ever step by one would promise
 * something the query cannot do.
 *
 * It also has no total, for the same reason: counting a 40,000-row folder to
 * render "of 1,600 pages" is a whole extra aggregation on every page turn.
 */
export function CursorPager({
  page,
  pageSize,
  count,
  hasNext,
  hasPrevious,
  busy,
  onNext,
  onPrevious,
  variant,
  noun = "records",
}: {
  page: number;
  pageSize: number;
  /** Rows on the current page — the last page is usually short. */
  count: number;
  hasNext: boolean;
  hasPrevious: boolean;
  busy?: boolean;
  onNext: () => void;
  onPrevious: () => void;
  variant: Variant;
  noun?: string;
}) {
  // A single page that is also the only page is not worth a control.
  if (!hasNext && !hasPrevious) return null;

  const web = variant === "web";
  const from = (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + count;

  return (
    <nav
      aria-label="Pagination"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        padding: web ? "12px 0 2px" : "14px 2px 2px",
      }}
    >
      <span style={{ fontSize: web ? 12.5 : 11.5, fontWeight: 500, color: E.faint, whiteSpace: "nowrap" }}>
        {count === 0 ? `Page ${page}` : `${from}–${to} ${noun}`}
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Step
          label="Previous page"
          disabled={!hasPrevious || Boolean(busy)}
          onPress={onPrevious}
          variant={variant}
          d="m14 6-6 6 6 6"
        />
        <span
          aria-current="page"
          style={{
            minWidth: web ? 32 : 34,
            height: web ? 32 : 34,
            borderRadius: web ? 9 : 999,
            border: `1px solid ${E.teal}`,
            background: E.teal,
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {page}
        </span>
        <Step
          label="Next page"
          disabled={!hasNext || Boolean(busy)}
          onPress={onNext}
          variant={variant}
          d="m10 6 6 6-6 6"
        />
      </div>
    </nav>
  );
}
