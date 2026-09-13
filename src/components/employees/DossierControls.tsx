"use client";

import { useRef } from "react";
import { isStageFilter, isActivityFilter, ACTIVITY_FILTER_HINTS } from "@/lib/leadBuckets";
import { STAGE_TONES } from "@/components/leads/StageChrome";
/**
 * The filter row and the pager the employee dossier uses on both surfaces.
 *
 * One implementation at two sizes, for the same reason as `AnalyticsPanels`:
 * a second copy would let the phone's idea of "This week" drift from the
 * desktop's. The geometry is a `variant`, the behaviour is not.
 */

import type { Pagination } from "@/hooks/usePagination";
import type { DossierActivity } from "@/hooks/useDossierActivity";
import type { SourceOption } from "@/lib/dataBankAssigned";
import { karachiDayKey, offsetDayKey, formatDayKeyDisplay } from "@/lib/dates";
import {
  E,
  DOSSIER_PERIODS,
  DOSSIER_LEAD_CUTS,
  LEAD_FILTER_LABELS,
  type DossierFilters,
  type DossierPeriod,
  type LeadFilterKey,
} from "./directoryChrome";

type Variant = "web" | "mobile";

/** One tone for all three activity cuts — see `CutChip`. */
const ACTIVITY_INK = "#4d7590";
const ACTIVITY_TINT = "#eaf1f6";

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
  counts,
  activity,
  sources,
}: {
  filters: DossierFilters;
  onChange: (next: DossierFilters) => void;
  variant: Variant;
  showCut?: boolean;
  countLine?: string;
  counts?: Partial<Record<LeadFilterKey, number>>;
  activity?: DossierActivity;
  /**
   * The origins this person's leads came from, with counts. Given only on the
   * Leads tab — the source is a fact about a lead, so a deal list or an
   * activity feed offering it would be a control that does nothing.
   */
  sources?: SourceOption[];
}) {
  const web = variant === "web";
  const dateInputRef = useRef<HTMLInputElement>(null);
  const todayKey = karachiDayKey();
  const currentDay = filters.day ?? todayKey;
  const isDayMode = filters.period === "DAY";
  const isFutureOrToday = isDayMode && currentDay >= todayKey;

  return (
    <>
    {activity && (
      <ActivitySummary
        activity={activity}
        variant={variant}
        heading={isDayMode ? formatDayKeyDisplay(currentDay) : (DOSSIER_PERIODS.find((p) => p.key === filters.period)?.label ?? "This period")}
      />
    )}
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
      <div style={{ display: "flex", alignItems: "center", gap: web ? 8 : 6, flexWrap: "wrap", minWidth: 0 }}>
        {/* Date Stepper & Picker */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            onClick={() => {
              const prev = offsetDayKey(currentDay, -1);
              onChange({ ...filters, period: "DAY", day: prev });
            }}
            aria-label="Previous day"
            title="Previous day"
            className={web ? undefined : "mob-press"}
            style={{
              width: web ? 32 : 34,
              height: web ? 32 : 34,
              borderRadius: web ? 8 : 999,
              border: `1px solid ${E.border}`,
              background: E.surface,
              color: E.tealInk,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m14 6-6 6 6 6" />
            </svg>
          </button>

          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              try {
                dateInputRef.current?.showPicker?.();
              } catch {
                dateInputRef.current?.focus();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                try {
                  dateInputRef.current?.showPicker?.();
                } catch {
                  dateInputRef.current?.focus();
                }
              }
            }}
            aria-label="Select date"
            className={web ? undefined : "mob-press"}
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: web ? 32 : 34,
              padding: web ? "0 12px" : "0 12px",
              borderRadius: web ? 8 : 999,
              border: `1px solid ${isDayMode ? E.teal : E.border}`,
              background: isDayMode ? E.tint : E.surface,
              color: E.tealInk,
              fontSize: web ? 12.5 : 12,
              fontWeight: 700,
              cursor: "pointer",
              userSelect: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span style={{ whiteSpace: "nowrap" }}>
              {isDayMode ? formatDayKeyDisplay(currentDay) : (
                DOSSIER_PERIODS.find((p) => p.key === filters.period)?.label ?? "Select Date"
              )}
            </span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ opacity: 0.6 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <input
              ref={dateInputRef}
              type="date"
              value={currentDay}
              max={todayKey}
              onChange={(e) => {
                if (e.target.value) {
                  onChange({ ...filters, period: "DAY", day: e.target.value });
                }
              }}
              aria-label="Choose date"
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0,
                width: "100%",
                height: "100%",
                cursor: "pointer",
              }}
            />
          </div>

          <button
            type="button"
            disabled={isFutureOrToday}
            onClick={() => {
              if (!isFutureOrToday) {
                const next = offsetDayKey(currentDay, 1);
                onChange({ ...filters, period: "DAY", day: next });
              }
            }}
            aria-label="Next day"
            title="Next day"
            className={web ? undefined : "mob-press"}
            style={{
              width: web ? 32 : 34,
              height: web ? 32 : 34,
              borderRadius: web ? 8 : 999,
              border: `1px solid ${E.border}`,
              background: E.surface,
              color: isFutureOrToday ? E.hair : E.tealInk,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: isFutureOrToday ? "default" : "pointer",
              opacity: isFutureOrToday ? 0.4 : 1,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m10 6 6 6-6 6" />
            </svg>
          </button>
        </div>

        {/* Range preset dropdown */}
        <select
          value={filters.period === "DAY" ? (currentDay === todayKey ? "TODAY" : currentDay === offsetDayKey(todayKey, -1) ? "YESTERDAY" : "DAY") : filters.period}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "TODAY") {
              onChange({ ...filters, period: "DAY", day: todayKey });
            } else if (val === "YESTERDAY") {
              onChange({ ...filters, period: "DAY", day: offsetDayKey(todayKey, -1) });
            } else if (val === "DAY") {
              onChange({ ...filters, period: "DAY", day: currentDay });
              try {
                dateInputRef.current?.showPicker?.();
              } catch {}
            } else {
              onChange({ ...filters, period: val as DossierPeriod });
            }
          }}
          aria-label="Filter range"
          style={{
            border: `1px solid ${E.border}`,
            background: E.surface,
            borderRadius: web ? 8 : 999,
            height: web ? 32 : 34,
            padding: web ? "0 10px" : "0 12px",
            fontSize: web ? 12 : 11.5,
            fontWeight: 700,
            color: E.muted,
            outline: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          <option value="TODAY">Today</option>
          <option value="YESTERDAY">Yesterday</option>
          <option value="DAY">Select date…</option>
          <option value="WEEK">This week</option>
          <option value="MONTH">This month</option>
          <option value="ALL">All time</option>
        </select>

        {/* Source — which sheet or campaign these leads came from, counted in
            the chosen period. Always shown on the Leads tab, even on a day with
            nothing in it: a control that vanishes when the date changes reads
            as a filter that stopped working. A picked source with no leads that
            day stays selected, at (0), rather than being silently dropped. */}
        {sources && (
          <select
            value={filters.source ?? ""}
            onChange={(e) => onChange({ ...filters, source: e.target.value || null })}
            aria-label="Filter leads by source"
            style={{
              border: `1px solid ${filters.source ? E.teal : E.border}`,
              background: filters.source ? E.tint : E.surface,
              borderRadius: web ? 8 : 999,
              height: web ? 32 : 34,
              padding: web ? "0 10px" : "0 12px",
              maxWidth: web ? 240 : "100%",
              fontSize: web ? 12 : 16,
              fontWeight: 700,
              color: filters.source ? E.tealInk : E.muted,
              outline: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              flexShrink: 1,
              minWidth: 0,
            }}
          >
            <option value="">All sources ({sources.reduce((sum, option) => sum + option.count, 0)})</option>
            {filters.source && !sources.some((option) => option.key === filters.source) && (
              <option value={filters.source}>{filters.source} (0)</option>
            )}
            {sources.map((option) => (
              <option key={option.key} value={option.key}>
                {option.key} ({option.count})
              </option>
            ))}
          </select>
        )}

        {showCut && (
          <div
            role="tablist"
            aria-label="Filter leads"
            style={{
              display: "flex",
              alignItems: "center",
              gap: web ? 4 : 6,
              padding: web ? 3 : 0,
              borderRadius: web ? 10 : 0,
              background: web ? "#f0f6f5" : "transparent",
              overflowX: "auto",
              minWidth: 0,
            }}
          >
            {/* **The unit, named once.** These chips carry the same four words
                as the activity summary above and count something different:
                chips count *leads*, the summary counts *entries*. One label
                here is what stops the two reading as contradictory copies of
                each other. */}
            <span
              style={{
                flexShrink: 0,
                paddingLeft: web ? 7 : 0,
                paddingRight: web ? 3 : 4,
                fontSize: web ? 10.5 : 10,
                fontWeight: 800,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: E.faint,
              }}
            >
              Leads
            </span>
            {DOSSIER_LEAD_CUTS.map((key) => (
              <CutChip
                key={key}
                cut={key}
                active={filters.cut === key}
                variant={variant}
                count={counts?.[key]}
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
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * **What this person actually wrote on the selected day.**
 *
 * This is the row that used to read "Written in this period", and it is the
 * only place on the dossier that counts **entries**. It was removed as
 * duplicated, which it looked like: the filter chips below carry the same four
 * words. They are not the same figure — the chips count **leads** and this
 * counts **entries**, so somebody who logs 30 follow-ups across 5 leads is "5"
 * on a chip and "30" here, and both are right.
 *
 * Kept, and restructured so the difference is legible rather than a trap:
 *
 * - it is headed with **the date itself**, so it reads as "what happened on
 *   this day" rather than as a second copy of the chips;
 * - the chip row below is labelled **Leads**, naming its unit once;
 * - a day with nothing on it says so, instead of showing four zeroes that look
 *   like a broken screen.
 *
 * These are the same four numbers Reports prints for the same dates, from the
 * same records through the same `entryTally` — that is the point of showing
 * them: the two screens can be checked against each other.
 */
function ActivitySummary({
  activity,
  variant,
  heading,
}: {
  activity: DossierActivity;
  variant: Variant;
  heading: string;
}) {
  const web = variant === "web";
  const { totals } = activity;
  const nothing =
    !activity.loading &&
    !activity.error &&
    totals.remarks + totals.followUps + totals.newConnects + totals.followUpConnects === 0;

  const figures = [
    { label: "Remarks", value: totals.remarks },
    { label: "New connects", value: totals.newConnects, sub: true },
    { label: "Follow-ups", value: totals.followUps },
    { label: "Follow-up connects", value: totals.followUpConnects, sub: true },
  ];

  return (
    <div
      style={{
        marginBottom: web ? 12 : 10,
        padding: web ? "10px 13px" : "10px 12px",
        borderRadius: 12,
        border: `1px solid ${activity.error ? "#f0c4bd" : "#dbe7ee"}`,
        background: activity.error ? "#fdeeeb" : ACTIVITY_TINT,
      }}
      aria-live="polite"
    >
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <span
          style={{
            fontSize: web ? 11 : 10.5,
            fontWeight: 800,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: activity.error ? "#a33a29" : ACTIVITY_INK,
          }}
        >
          Activity · {heading}
        </span>
        <span style={{ fontSize: web ? 11 : 10.5, fontWeight: 600, color: ACTIVITY_INK, opacity: 0.7 }}>
          entries written
        </span>
      </div>

      {activity.error ? (
        <p style={{ marginTop: 6, fontSize: web ? 12 : 11.5, fontWeight: 600, color: "#a33a29" }}>
          {activity.error}
        </p>
      ) : nothing ? (
        /* A real answer, not four zeroes. "Nothing" and "did not load" must not
           look the same, which is why the error case above is separate. */
        <p style={{ marginTop: 6, fontSize: web ? 12.5 : 12, fontWeight: 600, color: ACTIVITY_INK, opacity: 0.75 }}>
          Nothing logged on this day.
        </p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: web ? 7 : 6, marginTop: 7 }}>
          {figures.map((figure) => (
            <span
              key={figure.label}
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: 5,
                padding: web ? "3px 10px" : "3px 9px",
                borderRadius: 999,
                background: "#fff",
                border: `1px solid ${figure.sub ? "#e4eef4" : "#d3e2ea"}`,
                fontSize: web ? 12 : 11.5,
                color: ACTIVITY_INK,
                opacity: activity.loading ? 0.5 : 1,
              }}
            >
              <strong
                style={{
                  fontSize: web ? 13.5 : 13,
                  fontWeight: 800,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {activity.loading ? "—" : figure.value}
              </strong>
              <span style={{ fontWeight: 600, opacity: 0.85 }}>{figure.label}</span>
            </span>
          ))}
        </div>
      )}

      {activity.warning && !activity.error && (
        <p style={{ marginTop: 6, fontSize: web ? 11.5 : 11, fontWeight: 600, color: "#8a6d3b" }}>
          {activity.warning}
        </p>
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
  count,
  onSelect,
}: {
  cut: LeadFilterKey;
  active: boolean;
  variant: Variant;
  count?: number;
  onSelect: () => void;
}) {
  const web = variant === "web";
  const stageTone = isStageFilter(cut) ? STAGE_TONES[cut] : null;
  // The activity cuts share one tone of their own: they are a different kind
  // of question from the stages, and giving each its own colour would read as
  // three more stages.
  const activity = isActivityFilter(cut);
  const accent = stageTone ? stageTone.softText : activity ? ACTIVITY_INK : E.tealInk;
  const fill = stageTone ? stageTone.soft : activity ? ACTIVITY_TINT : E.surface;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={activity ? ACTIVITY_FILTER_HINTS[cut] : undefined}
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
      {count !== undefined && (
        <span
          style={{
            marginLeft: 6,
            fontSize: web ? 11 : 10.5,
            fontWeight: 800,
            opacity: active ? 0.85 : 0.6,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      )}
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
