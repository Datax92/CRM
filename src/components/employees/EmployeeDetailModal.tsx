"use client";

/**
 * Performance dossier, built to `Employee Directory.dc.html`.
 *
 * **One dossier, two subjects.** Pass `team` and it becomes a *manager's*: the
 * same header, the same figure strip, the same tabs, reading their team's
 * leads, deals and activity instead of one person's, with a Team tab listing
 * the people the figures are the sum of. A manager takes no leads themselves,
 * so their numbers **are** their team's — the rule `lib/managerMetrics` exists
 * for — and a second component that restated it would drift from this one the
 * first time either changed. The admin could previously open any employee and
 * no manager at all, which is the gap this closes.
 *
 * Everything here is derived from documents the directory page already holds —
 * the employee's leads and closed deals — rather than fetched per employee.
 * Same trade as `buildEmployeeMetrics`: right at a few hundred leads, replaced
 * by rollup documents when it isn't.
 *
 * Inline styles, not Tailwind: an arbitrary value the content scanner never saw
 * emits no rule and the element renders with no background (CLAUDE.md,
 * 2026-08-29).
 */

import { useEffect, useMemo, useState } from "react";
import { describeLeadSource } from "@/lib/leadSource";
import { createPortal } from "react-dom";
import { LeadDetailPane } from "@/components/leads/LeadDetailPane";
import { useAuth } from "@/context/AuthContext";
import type { Lead } from "@/hooks/useLeads";
import type { DealRecord } from "@/hooks/useFinancials";
import type { EmployeeMetrics } from "@/lib/metrics";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/leadStatus";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate, formatBusinessDateTime } from "@/lib/dates";
import { initialsOf } from "@/lib/leadDisplay";
import { usePagination } from "@/hooks/usePagination";
import {
  E,
  Card,
  HeroRings,
  leadAccent,
  buildDirectoryAnalytics,
  buildActivity,
  applyLeadFilters,
  applyDealPeriod,
  applyActivityPeriod,
  DEFAULT_DOSSIER_FILTERS,
  type DossierFilters,
} from "./directoryChrome";
import { AnalyticsPanels, ActivityFeed, EmptyPanel } from "./AnalyticsPanels";
import { buildManagerMetrics } from "@/lib/managerMetrics";
import { formatCompactMoney } from "@/lib/money";
import { countByFilter } from "@/lib/leadBuckets";
import { DossierFilterBar, Pager } from "./DossierControls";

/** Rows per page inside the dossier's tabs. */
const PAGE_SIZE = 6;

type Tab = "leads" | "deals" | "activity" | "analytics" | "team";

/** Most recent meaningful moment on a lead. */
function lastTouchAt(lead: Lead) {
  return lead.lastFollowUpAt ?? lead.lastActivityAt ?? lead.acceptedAt ?? lead.assignedAt ?? lead.createdAt;
}

function toMillis(value: { toMillis?: () => number; toDate?: () => Date } | undefined): number {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const date = value.toDate?.();
  return date ? date.getTime() : 0;
}

export function EmployeeDetailModal({
  employee,
  leads,
  deals,
  team,
  onClose,
  onEdit,
  onOpenMember,
}: {
  employee: EmployeeMetrics;
  leads: Lead[];
  deals: DealRecord[];
  /**
   * Present when the subject is a **manager**: the employees assigned to them.
   * Its presence is what switches this dossier into manager mode — an empty
   * array is a manager with nobody under them yet, which is a real state and
   * reads as zeros, not as an employee.
   */
  team?: EmployeeMetrics[];
  onClose: () => void;
  /**
   * Absent for a sub admin: editing an employee is `requireAdmin` on the
   * server, so the button would only ever produce "That action is for
   * administrators". Everything else in the dossier reads the same for both.
   */
  onEdit?: () => void;
  /** Open one of the manager's employees. Manager mode only. */
  onOpenMember?: (member: EmployeeMetrics) => void;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("leads");
  /**
   * §12 — a lead opened from the dossier shows the *complete* record: the same
   * `LeadDetailPane` the pipeline uses, on the same document. A summary built
   * here would be a second description of a lead to keep true.
   */
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  const { getIdToken } = useAuth();
  const [filters, setFilters] = useState<DossierFilters>(DEFAULT_DOSSIER_FILTERS);

  const isManager = team !== undefined;

  /**
   * Whose work this dossier is about.
   *
   * For an employee, themselves. For a manager, **themselves and their team** —
   * a manager can hold leads of their own (a Data Bank record taken into their
   * Client section is assigned to them), and dropping those would show a
   * manager a smaller number than the pipeline does.
   */
  const owners = useMemo(
    () => new Set<string>([employee.uid, ...(team ?? []).map((member) => member.uid)]),
    [employee.uid, team]
  );

  /**
   * A manager's headline figures are their team's, summed once.
   *
   * `buildManagerMetrics` is the same function the Managers panel behind this
   * modal uses, so the card and the dossier cannot disagree about the same
   * manager. The manager's own row is included, for the reason above.
   */
  const figures = useMemo(
    () => (isManager ? buildManagerMetrics(employee, team ?? []) : null),
    [isManager, employee, team]
  );

  /**
   * The subject in one shape, so nothing below has to ask which kind it is.
   *
   * The manager's **own record** supplies the fields a total cannot have — the
   * KPI targets the Analytics tab measures against, the job title, the joining
   * date — and the team totals are laid over the counts. Summing a target
   * across a team would compare a manager's revenue to one person's goal.
   */
  const subject: EmployeeMetrics = useMemo(
    () =>
      figures
        ? {
            ...employee,
            assigned: figures.assigned,
            accepted: figures.accepted,
            missed: figures.missed,
            active: figures.active,
            closedWon: figures.closedWon,
            lost: figures.lost,
            followUps: figures.followUps,
            calls: figures.calls,
            revenue: figures.revenue,
            payable: figures.payable,
            profit: figures.profit,
          }
        : employee,
    [figures, employee]
  );

  const ownLeads = useMemo(
    () =>
      leads
        .filter((l) => (l.assignedUserId ? owners.has(l.assignedUserId) : false))
        .sort((a, b) => toMillis(lastTouchAt(b)) - toMillis(lastTouchAt(a))),
    [leads, owners]
  );
  const ownDeals = useMemo(
    () =>
      deals
        .filter((d) => (d.userId ? owners.has(d.userId) : false))
        .sort((a, b) => toMillis(b.dealDate ?? b.enteredAt) - toMillis(a.dealDate ?? a.enteredAt)),
    [deals, owners]
  );
  const analytics = useMemo(
    () => buildDirectoryAnalytics(subject, leads, deals, owners),
    [subject, leads, deals, owners]
  );
  const activity = useMemo(
    () => buildActivity(employee, leads, deals, owners),
    [employee, leads, deals, owners]
  );

  // The filters cut the tab bodies only. The figure strip and the Analytics
  // tab keep describing the employee's whole record — a headline that moved
  // when you clicked "Today" would read as their career having shrunk.
  const shownLeads = useMemo(() => applyLeadFilters(ownLeads, filters), [ownLeads, filters]);
  /**
   * How many leads sit under each cut, within the chosen period.
   *
   * Counted on the period-filtered list rather than the whole record, so the
   * numbers on the chips are the numbers the chips will produce. `countByFilter`
   * is the same function the leads workspace counts with.
   */
  const cutCounts = useMemo(
    () => countByFilter(applyLeadFilters(ownLeads, { ...filters, cut: "ALL" })),
    [ownLeads, filters]
  );

  const shownDeals = useMemo(() => applyDealPeriod(ownDeals, filters.period), [ownDeals, filters.period]);
  const shownActivity = useMemo(
    () => applyActivityPeriod(activity, filters.period),
    [activity, filters.period]
  );

  const leadPages = usePagination(shownLeads, PAGE_SIZE);
  const dealPages = usePagination(shownDeals, PAGE_SIZE);
  const activityPages = usePagination(shownActivity, PAGE_SIZE);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "unset";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const winRate = subject.assigned > 0 ? ((subject.closedWon / subject.assigned) * 100).toFixed(1) : "0.0";
  // Offered, then taken away when the window lapsed — the denominator is
  // everything they were ever offered, not just what they kept.
  const offered = subject.accepted + subject.missed;
  const acceptanceRate = offered > 0 ? ((subject.accepted / offered) * 100).toFixed(1) : "100.0";

  const tabs: Array<{ key: Tab; label: string; count: number | null }> = [
    // A manager's list is their team's, so it is not "assigned" to them.
    { key: "leads", label: isManager ? "Team Leads" : "Assigned Leads", count: ownLeads.length },
    { key: "deals", label: "Deals Closed", count: ownDeals.length },
    ...(isManager
      ? [{ key: "team" as Tab, label: "Team", count: (team ?? []).length }]
      : []),
    { key: "activity", label: "Activity", count: activity.length },
    { key: "analytics", label: "Analytics", count: null },
  ];

  const stats: Array<{ label: string; value: string; color: string }> = isManager
    ? [
        // Headcount replaces acceptance rate: a manager accepts nothing, and a
        // rate summed over a team answers a question nobody asked of them. How
        // many people they run is the first thing anybody wants to know.
        { label: "Team Size", value: String((team ?? []).length), color: E.ink },
        { label: "Leads Handled", value: String(subject.assigned), color: E.ink },
        { label: "Win Rate", value: `${winRate}%`, color: E.ink },
        { label: "Missed Leads", value: String(subject.missed), color: subject.missed > 0 ? E.red : E.ink },
        { label: "Won / Lost", value: `${subject.closedWon} / ${subject.lost}`, color: E.tealInk },
        { label: "Revenue", value: formatCompactMoney(subject.revenue), color: E.tealInk },
      ]
    : [
        { label: "Leads Handled", value: String(subject.assigned), color: E.ink },
        { label: "Acceptance Rate", value: `${acceptanceRate}%`, color: E.ink },
        { label: "Win Rate", value: `${winRate}%`, color: E.ink },
        { label: "Missed Leads", value: String(subject.missed), color: subject.missed > 0 ? E.red : E.ink },
        { label: "Won / Lost", value: `${subject.closedWon} / ${subject.lost}`, color: E.tealInk },
        { label: "Profit Generated", value: formatMoney(subject.profit), color: E.tealInk },
      ];

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 110,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "34px 24px",
        fontFamily: E.font,
        letterSpacing: E.tracking,
      }}
    >
      <div
        className="animate-modal-fade"
        style={{ position: "fixed", inset: 0, background: "rgba(24,52,50,0.4)" }}
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${isManager ? "Manager" : "Employee"}: ${employee.name}`}
        className="animate-modal-pop"
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 1000,
          maxHeight: "100%",
          background: E.surface,
          borderRadius: 20,
          boxShadow: "0 30px 80px rgba(18,54,52,0.3)",
          display: "grid",
          gridTemplateRows: "auto auto auto 1fr",
          overflow: "hidden",
          color: E.ink,
        }}
      >
        {/* ---- gradient identity header ---- */}
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "22px 26px",
            background: E.gradient,
            color: "#fff",
          }}
        >
          <HeroRings set="modal" />

          <div
            style={{
              position: "relative",
              width: 54,
              height: 54,
              borderRadius: 17,
              background: "rgba(255,255,255,0.2)",
              border: "1.5px solid rgba(255,255,255,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 800,
              flexShrink: 0,
            }}
            aria-hidden
          >
            {initialsOf(employee.name)}
          </div>

          <div style={{ position: "relative", minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
              <span style={{ fontSize: 23, fontWeight: 800, letterSpacing: "-0.7px" }}>{employee.name}</span>
              <span
                style={{
                  padding: "4px 12px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.22)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.8px",
                  textTransform: "uppercase",
                }}
              >
                {employee.status === "ACTIVE" ? "Active" : "Inactive"}
              </span>
              {/* A manager has no place in the distribution lane — the Add
                  Manager form does not offer a priority, so printing one would
                  be inventing a rank they are not in. */}
              {isManager ? (
                <span
                  style={{
                    padding: "4px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.5)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  Manager · {(team ?? []).length} {(team ?? []).length === 1 ? "employee" : "employees"}
                </span>
              ) : (
                <span
                  style={{
                    padding: "4px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.5)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  Priority {employee.priority}
                </span>
              )}
              {!isManager && employee.autoAssign === false && (
                <span
                  style={{
                    padding: "4px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.5)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                  title="Automatic distribution skips this employee — leads reach them only when an admin assigns one."
                >
                  Manual only
                </span>
              )}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 500, opacity: 0.85, marginTop: 4 }}>
              {employee.email}
              {employee.jobTitle && <> &nbsp;·&nbsp; {employee.jobTitle}</>}
              {(employee.joinedAt || employee.createdAt) && (
                <> &nbsp;·&nbsp; Joined {formatBusinessDate(employee.joinedAt ?? employee.createdAt)}</>
              )}
            </div>
          </div>

          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: "#fff",
                color: E.tealInk,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
                <path d="M4 20h4l11-11-4-4L4 16v4Z" />
              </svg>
              <span style={{ whiteSpace: "nowrap" }}>Edit Details</span>
            </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                border: "none",
                background: "transparent",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* ---- six-figure strip ---- */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, minmax(0,1fr))",
            gap: 1,
            background: E.page,
            borderBottom: `1px solid ${E.page}`,
          }}
        >
          {stats.map((stat, index) => (
            <div key={stat.label} style={{ background: index === 5 ? E.tint : E.surface, padding: "14px 18px" }}>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  color: E.label,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {stat.label}
              </div>
              <div
                style={{
                  fontSize: 21,
                  fontWeight: 800,
                  marginTop: 4,
                  letterSpacing: "-0.6px",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  color: stat.color,
                }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* ---- tabs ---- */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 26px",
            background: E.surface,
            borderBottom: `1px solid ${E.page}`,
            overflowX: "auto",
          }}
          role="tablist"
        >
          {tabs.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "15px 4px",
                  marginRight: 26,
                  border: "none",
                  borderBottom: `2.5px solid ${active ? E.teal : "transparent"}`,
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "-0.2px",
                  fontFamily: "inherit",
                  color: active ? E.tealInk : "#7e918f",
                  flexShrink: 0,
                }}
              >
                <span style={{ whiteSpace: "nowrap" }}>{tab.label}</span>
                {tab.count !== null && (
                  <span
                    style={{
                      minWidth: 22,
                      padding: "1px 7px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      textAlign: "center",
                      background: active ? "#dcecea" : E.rowBorder,
                      color: active ? E.tealInk : E.label,
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ---- tab body ---- */}
        <div
          className="teal-scrollbar"
          style={{ minHeight: 0, overflowY: "auto", padding: "20px 26px 26px", background: E.field }}
        >
          <div key={activeTab} className="animate-lead-tab">
            {activeTab === "leads" && (
              <>
                <DossierFilterBar
                  filters={filters}
                  onChange={setFilters}
                  variant="web"
                  counts={cutCounts}
                  countLine={`${shownLeads.length} of ${ownLeads.length} lead${ownLeads.length === 1 ? "" : "s"}`}
                />
                <AssignedLeads
                  leads={leadPages.items}
                  empty={ownLeads.length === 0}
                  onOpen={setOpenLead}
                />
                <Pager pagination={leadPages} variant="web" noun="leads" />
              </>
            )}

            {activeTab === "deals" && (
              <>
                <DossierFilterBar
                  filters={filters}
                  onChange={setFilters}
                  variant="web"
                  showCut={false}
                  countLine={`${shownDeals.length} of ${ownDeals.length} deal${ownDeals.length === 1 ? "" : "s"}`}
                />
                <DealsList deals={dealPages.items} empty={ownDeals.length === 0} />
                <Pager pagination={dealPages} variant="web" noun="deals" />
              </>
            )}

            {activeTab === "activity" && (
              <>
                <DossierFilterBar
                  filters={filters}
                  onChange={setFilters}
                  variant="web"
                  showCut={false}
                  countLine={`${shownActivity.length} of ${activity.length} entr${activity.length === 1 ? "y" : "ies"}`}
                />
                <ActivityFeed
                  entries={activityPages.items}
                  variant="web"
                  formatWhen={(at) => (at ? formatBusinessDateTime(at) : "—")}
                />
                <Pager pagination={activityPages} variant="web" noun="entries" />
              </>
            )}

            {activeTab === "team" && (
              <TeamRoster
                team={team ?? []}
                onOpen={onOpenMember}
              />
            )}

            {activeTab === "analytics" && (
              <AnalyticsPanels analytics={analytics} handled={subject.assigned} variant="web" />
            )}
          </div>
        </div>
      </div>

      {/* §12 — the complete lead record, opened over the dossier. The same
          pane the pipeline uses, reading the same document, so the KYC, the
          remark and follow-ups, the status, the stage and the deal are all
          there rather than a reduced copy. */}
      {openLead && (
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpenLead(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 210,
            background: "rgba(15, 42, 40, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "clamp(0px, 3vw, 32px)",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 900,
              height: "min(92vh, 100dvh)",
              borderRadius: 18,
              overflow: "hidden",
              background: "#f3faf9",
              boxShadow: "0 26px 64px rgba(15,42,40,0.32)",
            }}
          >
            <LeadDetailPane
              key={openLead.id}
              lead={leads.find((row) => row.id === openLead.id) ?? openLead}
              onClose={() => setOpenLead(null)}
              userRole="admin"
              getIdToken={getIdToken}
              assigneeName={employee.name}
            />
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

/* -------------------------------------------------------------------------- */

function AssignedLeads({
  leads,
  empty,
  onOpen,
}: {
  leads: Lead[];
  empty: boolean;
  /** §12 — opens the complete lead record, not a summary of it. */
  onOpen: (lead: Lead) => void;
}) {
  if (leads.length === 0) {
    return (
      <EmptyPanel>
        {empty
          ? "No leads currently assigned to this employee."
          : "No leads match this filter — widen the period or the cut."}
      </EmptyPanel>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {leads.map((lead) => {
        const accent = leadAccent(lead.status);
        return (
          <Card
            key={lead.id}
            radius={14}
            style={{
              display: "grid",
              gridTemplateColumns: "44px minmax(0,1.4fr) minmax(0,1fr) auto",
              alignItems: "center",
              gap: 16,
              padding: "15px 18px",
              cursor: "pointer",
            }}
            onClick={() => onOpen(lead)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(lead);
              }
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: E.field,
                border: `2px solid ${accent}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 700,
                color: "#4a5c5a",
                flexShrink: 0,
              }}
              aria-hidden
            >
              {initialsOf(lead.name)}
            </div>

            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 15.5,
                  fontWeight: 700,
                  letterSpacing: "-0.35px",
                  color: E.ink,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {lead.name}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0, color: accent }}>
                  {LEAD_STATUS_LABELS[lead.status as LeadStatus] ?? lead.status}
                </span>
                <span style={{ fontSize: 12, color: E.hair }}>·</span>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: E.label,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {lead.phone || lead.email || "No contact info"}
                </span>
              </div>
            </div>

            <div style={{ minWidth: 0 }}>
              <ColumnLabel>Source</ColumnLabel>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: E.body,
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {describeLeadSource(lead)}
              </div>
              {lead.campaignName && (
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: E.faint,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {lead.campaignName}
                </div>
              )}
            </div>

            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <ColumnLabel>Last touch</ColumnLabel>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: E.body,
                  marginTop: 2,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {formatBusinessDate(lastTouchAt(lead))}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function DealsList({ deals, empty }: { deals: DealRecord[]; empty: boolean }) {
  if (deals.length === 0) {
    return (
      <EmptyPanel>
        {empty
          ? "No closed deals recorded for this employee yet."
          : "No deals settled in this period."}
      </EmptyPanel>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {deals.map((deal) => (
        <Card
          key={deal.id}
          radius={14}
          style={{
            display: "grid",
            gridTemplateColumns: "44px minmax(0,1.5fr) auto auto",
            alignItems: "center",
            gap: 18,
            padding: "15px 18px",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: E.tealTint,
              color: E.tealInk,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            aria-hidden
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 15.5,
                fontWeight: 700,
                letterSpacing: "-0.35px",
                color: E.ink,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {deal.customer?.name || "Customer"}
            </div>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                color: E.label,
                marginTop: 3,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {deal.customer?.phone || deal.serviceDescription || "—"} &nbsp;·&nbsp; Settled{" "}
              {formatBusinessDate(deal.dealDate ?? deal.enteredAt)}
            </div>
          </div>

          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <ColumnLabel>Received</ColumnLabel>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: E.ink,
                marginTop: 2,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {formatMoney(deal.amountReceived)}
            </div>
          </div>

          <div
            style={{
              textAlign: "right",
              flexShrink: 0,
              padding: "8px 14px",
              borderRadius: 12,
              background: E.tint,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "1.1px",
                textTransform: "uppercase",
                color: "#7fb0ab",
              }}
            >
              Profit
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: E.tealInk,
                marginTop: 2,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {formatMoney(deal.profit)}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * The people a manager's figures are the sum of.
 *
 * Deliberately not a second directory table: it is the roll-call that explains
 * the numbers above it, so each row carries the two figures those numbers are
 * built from and opens that person's own dossier for the rest. The manager's
 * own row is not here — they are the subject, not a member of their own team.
 */
function TeamRoster({
  team,
  onOpen,
}: {
  team: EmployeeMetrics[];
  onOpen?: (member: EmployeeMetrics) => void;
}) {
  if (team.length === 0) {
    return (
      <EmptyPanel>
        No employees on this team yet. Somebody joins it from their own record, in the Reports To
        field.
      </EmptyPanel>
    );
  }

  const sorted = [...team].sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {sorted.map((member, index) => {
        const winRate = member.assigned > 0 ? Math.round((member.closedWon / member.assigned) * 100) : 0;

        return (
          <div
            key={member.uid}
            role={onOpen ? "button" : undefined}
            tabIndex={onOpen ? 0 : undefined}
            onClick={onOpen ? () => onOpen(member) : undefined}
            onKeyDown={
              onOpen
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(member);
                    }
                  }
                : undefined
            }
            className={index < 10 ? "directory-row-in" : undefined}
            style={{
              display: "grid",
              gridTemplateColumns: "34px minmax(0,1fr) auto",
              alignItems: "center",
              gap: 12,
              border: `1px solid ${E.border}`,
              borderRadius: 12,
              background: E.surface,
              padding: "11px 14px",
              cursor: onOpen ? "pointer" : "default",
              animationDelay: index < 10 ? `${index * 28}ms` : undefined,
            }}
          >
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
                fontSize: 12.5,
                fontWeight: 800,
              }}
            >
              {initialsOf(member.name)}
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
                {member.name}
                {member.status === "DISABLED" && (
                  <span style={{ marginLeft: 7, fontSize: 10, fontWeight: 800, color: E.amber }}>
                    INACTIVE
                  </span>
                )}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 11.5,
                  color: E.faint,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {member.jobTitle || member.email}
              </span>
            </span>

            <span style={{ display: "flex", gap: 18, textAlign: "right", flexShrink: 0 }}>
              <MemberFigure label="Leads" value={String(member.assigned)} />
              <MemberFigure label="Won" value={String(member.closedWon)} accent />
              {/* A zero renders in the hairline tone, so a row of real work
                  stands out from a row of nothing. */}
              <MemberFigure label="Win rate" value={`${winRate}%`} muted={winRate === 0} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MemberFigure({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <span style={{ display: "block", minWidth: 46 }}>
      <span
        style={{
          display: "block",
          fontSize: 15,
          fontWeight: 800,
          fontVariantNumeric: "tabular-nums",
          color: muted ? E.hair : accent ? E.tealInk : E.ink,
        }}
      >
        {value}
      </span>
      <span
        style={{
          display: "block",
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.7px",
          textTransform: "uppercase",
          color: E.label,
        }}
      >
        {label}
      </span>
    </span>
  );
}

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "1.1px",
        textTransform: "uppercase",
        color: E.faint,
      }}
    >
      {children}
    </div>
  );
}
