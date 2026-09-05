"use client";

/**
 * The phone Employee Directory, built to `Employee Directory Mobile.dc.html`.
 *
 * It is a different screen from the desktop one, not a narrowed copy: a teal
 * header carrying the search and the three roster figures, stacked roster
 * cards, and a full-screen profile overlay with pill tabs.
 *
 * Every figure comes from the same `EmployeeMetrics` rollup the desktop table
 * reads, and every write calls the same client action, so the two surfaces
 * cannot drift.
 *
 * **The mockup's phone frame is deliberately not reproduced** — the 9:41 clock,
 * the signal bars and the home indicator are how a design file depicts a phone.
 * Drawing them in a real app puts a second, permanently-wrong status bar under
 * the device's own. `env(safe-area-inset-*)` does the real job instead.
 */

import { useEffect, useMemo, useState } from "react";
import { describeLeadSource } from "@/lib/leadSource";
import type { Lead } from "@/hooks/useLeads";
import type { DealRecord } from "@/hooks/useFinancials";
import type { EmployeeMetrics } from "@/lib/metrics";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/leadStatus";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate, formatBusinessDateTime } from "@/lib/dates";
import { initialsOf } from "@/lib/leadDisplay";
import {
  createEmployee,
  updateEmployee,
  disableEmployee,
  enableEmployee,
} from "@/lib/clientActions";
import { JOB_TITLES, DEFAULT_JOB_TITLE } from "@/lib/constants/roles";
import { MAX_PRIORITY } from "@/lib/constants/distribution";
import { DEFAULT_KPI_TARGETS, KPI_METRICS, KPI_METRIC_LABELS, type KpiTargets } from "@/lib/kpi";
import { usePagination } from "@/hooks/usePagination";
import {
  E,
  HeroRings,
  leadAccent,
  buildDirectoryAnalytics,
  buildActivity,
  compactRupees,
  applyLeadFilters,
  applyDealPeriod,
  applyActivityPeriod,
  DEFAULT_DOSSIER_FILTERS,
  type DossierFilters,
} from "@/components/employees/directoryChrome";
import { AnalyticsPanels, ActivityFeed, EmptyPanel } from "@/components/employees/AnalyticsPanels";
import { countByFilter } from "@/lib/leadBuckets";
import { DossierFilterBar, Pager } from "@/components/employees/DossierControls";

/** Roster cards, and rows inside a profile tab, per page. */
const ROSTER_PAGE_SIZE = 8;
const PROFILE_PAGE_SIZE = 6;
import { MobileHeader, HeaderCircle } from "./mobileChrome";
import { AccountButton } from "./MobileAccount";
import { MobileBody, useMobileCentre } from "./MobileShell";
import { MobileLeadDetail, Sheet, SheetAction } from "./MobileLeadDetail";
import { useAuth } from "@/context/AuthContext";
import { ManagerFormModal } from "@/components/employees/ManagerFormModal";
import { buildAllManagerMetrics, buildManagerMetrics } from "@/lib/managerMetrics";
import type { DataBankFolder } from "@/hooks/useDataBank";
import type { CentreAction } from "./MobileTabBar";

export type DirectoryFilter = "All" | "Active" | "Inactive";

const FILTERS: DirectoryFilter[] = ["All", "Active", "Inactive"];

/**
 * The phone's Team screen carries both halves of the hierarchy, because the
 * desktop directory does and the requirement is parity, not a lighter phone
 * edition. People is the employee roster; Managers is the management layer with
 * its own add/edit form, its team tick-list and its aggregated figures.
 */
type TeamView = "people" | "managers";
const PROFILE_TABS = [
  { key: "leads", label: "Leads" },
  { key: "deals", label: "Deals" },
  { key: "analytics", label: "Analytics" },
  { key: "activity", label: "Activity" },
] as const;

type ProfileTab = (typeof PROFILE_TABS)[number]["key"] | "team";

/** A manager's roll-call sits first: it is what the figures above are made of. */
const MANAGER_PROFILE_TABS = [
  { key: "team", label: "Team" },
  ...PROFILE_TABS,
] as const;

export function MobileEmployees({
  metrics,
  rows,
  subAdmins,
  folders,
  leads,
  deals,
  query,
  onQuery,
  filter,
  onFilter,
  accountInitial,
  error,
  notice,
  onDismissNotice,
  selected,
  onSelect,
  getIdToken,
  onSaved,
  onRecalculate,
  recalculating,
  canManage = true,
}: {
  metrics: EmployeeMetrics[];
  rows: EmployeeMetrics[];
  /** The management layer. Empty for anyone who cannot see it. */
  subAdmins: EmployeeMetrics[];
  /** Only to say how many folders each manager holds — assigned in Data Bank. */
  folders: DataBankFolder[];
  leads: Lead[];
  deals: DealRecord[];
  query: string;
  onQuery: (next: string) => void;
  filter: DirectoryFilter;
  onFilter: (next: DirectoryFilter) => void;
  accountInitial: string;
  error: string | null;
  notice: string | null;
  onDismissNotice: () => void;
  selected: EmployeeMetrics | null;
  onSelect: (employee: EmployeeMetrics | null) => void;
  getIdToken: () => Promise<string>;
  onSaved: (message: string) => void;
  onRecalculate: () => void;
  recalculating: boolean;
  /**
   * Whether this reader may change anything. False for a sub admin: every
   * mutating employee action is `requireAdmin` on the server, so the controls
   * are absent rather than present-and-failing. Reading is identical.
   */
  canManage?: boolean;
}) {
  /** `undefined` closed, `null` creating, an employee editing. */
  const [formFor, setFormFor] = useState<EmployeeMetrics | null | undefined>(undefined);
  const [managerFormFor, setManagerFormFor] = useState<EmployeeMetrics | null | undefined>(undefined);
  const [view, setView] = useState<TeamView>("people");

  // **The add control lives in this header, not in the tab bar.** It used to
  // be published through `useMobileCentre`, but an admin's centre slot is
  // pinned to the Data Bank on every screen — so the request was simply
  // discarded and the Team screen had no way to add anybody. A header button
  // is also the better place: it is visible while the list is, and it says
  // what it adds instead of changing meaning with the screen.
  //
  // It is still published for any role whose centre is contextual, so nothing
  // regresses for them.
  const centre: CentreAction = useMemo(
    () =>
      !canManage
        ? null
        : view === "managers"
          ? { kind: "add", onPress: () => setManagerFormFor(null), label: "Add a manager" }
          : { kind: "add", onPress: () => setFormFor(null), label: "Add an employee" },
    [view, canManage]
  );
  useMobileCentre(centre);

  const addLabel = view === "managers" ? "Add a manager" : "Add an employee";
  const openAddForm = () => (view === "managers" ? setManagerFormFor(null) : setFormFor(null));

  // Same aggregation the desktop panel uses: a manager's figures are the sum of
  // their team's, derived on read. See `lib/managerMetrics`.
  const managerTotals = useMemo(
    () => buildAllManagerMetrics(subAdmins, metrics),
    [subAdmins, metrics]
  );

  /**
   * Whether the open dossier belongs to a manager, and who reports to them.
   *
   * The same switch the desktop uses: `team` present means manager mode. A
   * manager is never in `metrics` — that roster query is `role == "employee"` —
   * so the check is against `subAdmins`.
   */
  const selectedIsManager = Boolean(
    selected && subAdmins.some((person) => person.uid === selected.uid)
  );
  const selectedTeam = useMemo(
    () =>
      selectedIsManager && selected
        ? metrics.filter((member) => member.subAdminUid === selected.uid)
        : undefined,
    [selectedIsManager, selected, metrics]
  );

  const totals = useMemo(() => {
    const handled = metrics.reduce((sum, e) => sum + e.assigned, 0);
    const profit = metrics.reduce((sum, e) => sum + e.profit, 0);
    return { handled, profit };
  }, [metrics]);

  const rosterPages = usePagination(rows, ROSTER_PAGE_SIZE);

  const heroStats = [
    { label: "TEAM", value: String(metrics.length) },
    { label: "HANDLED", value: String(totals.handled) },
    { label: "PROFIT", value: compactRupees(totals.profit) },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        position: "relative",
        background: E.page,
        fontFamily: E.font,
        letterSpacing: E.tracking,
        color: E.inkMobile,
      }}
    >
      <MobileHeader style={{ background: E.gradientMobile, position: "relative", overflow: "hidden" }}>
        <HeroRings set="phone" />

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                opacity: 0.76,
              }}
            >
              Directory
            </div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 800,
                letterSpacing: "-0.7px",
                margin: "2px 0 0",
                color: "#fff",
                // Explicit: `@layer base` sets font-family on h1-h6, which
                // beats an inherited family from the container.
                fontFamily: E.font,
              }}
            >
              Employees
            </h1>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {/* Both are `requireAdmin` on the server — absent, not disabled.
                The account button stays: everyone needs a way out. */}
            {canManage && (
              <>
            <HeaderCircle onClick={openAddForm} label={addLabel}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </HeaderCircle>
            <HeaderCircle onClick={onRecalculate} label="Recalculate lane priority">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                className={recalculating ? "animate-spin" : undefined}
                aria-hidden
              >
                <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
              </svg>
            </HeaderCircle>
              </>
            )}
            <AccountButton initial={accountInitial} />
          </div>
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 16,
            padding: "13px 15px",
            borderRadius: 18,
            background: "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.22)",
          }}
        >
          {heroStats.map((stat, index) => (
            <div
              key={stat.label}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                borderLeft: index > 0 ? "1px solid rgba(255,255,255,0.22)" : undefined,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", opacity: 0.8, whiteSpace: "nowrap" }}>
                {stat.label}
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  letterSpacing: "-0.5px",
                  marginTop: 3,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 9,
            marginTop: 12,
            padding: "11px 15px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.16)",
            border: "1px solid rgba(255,255,255,0.22)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search employees"
            aria-label="Search employees by name, email or role"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 13.5,
              fontWeight: 500,
              color: "#fff",
              fontFamily: "inherit",
            }}
          />
        </div>
      </MobileHeader>

      {/* Both halves of the hierarchy, one tap apart. */}
      {subAdmins.length > 0 || view === "managers" ? (
        <div
          role="tablist"
          aria-label="Team view"
          style={{
            display: "flex",
            gap: 4,
            margin: "14px 18px 0",
            padding: 3,
            borderRadius: 999,
            background: "#dceae8",
            flexShrink: 0,
          }}
        >
          {(
            [
              { key: "people" as const, label: `People (${metrics.length})` },
              { key: "managers" as const, label: `Managers (${subAdmins.length})` },
            ]
          ).map((option) => {
            const on = view === option.key;
            return (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setView(option.key)}
                className="mob-press"
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  border: "none",
                  background: on ? "#fff" : "transparent",
                  color: on ? E.tealInk : E.muted,
                  boxShadow: on ? "0 1px 3px rgba(18,54,52,0.14)" : "none",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="Filter by status"
        style={{
          display: view === "people" ? "flex" : "none",
          alignItems: "center",
          gap: 8,
          padding: "14px 18px 10px",
          overflowX: "auto",
          flexShrink: 0,
        }}
      >
        {FILTERS.map((option) => {
          const active = filter === option;
          return (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onFilter(option)}
              className="mob-press"
              style={{
                flexShrink: 0,
                padding: "9px 20px",
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                border: `1px solid ${active ? E.teal : "#dceae8"}`,
                background: active ? E.teal : "#fff",
                color: active ? "#fff" : E.muted,
                WebkitTapHighlightColor: "transparent",
                transition: "background-color 160ms ease, color 160ms ease",
              }}
            >
              {option}
            </button>
          );
        })}
      </div>

      <MobileBody padding="2px 18px 24px">
        {error && <MobileNotice tone="error" text={error} />}
        {notice && <MobileNotice tone="success" text={notice} onDismiss={onDismissNotice} />}

        {/* Named, not just a plus. On the Managers view especially, an icon
            alone does not say what it would create. Admin only — the server
            refuses the write for anyone else. */}
        {canManage && (
        <button
          type="button"
          onClick={openAddForm}
          className="mob-press"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            margin: "4px 0 12px",
            padding: "13px 16px",
            borderRadius: 16,
            border: `1px dashed ${E.teal}`,
            background: "#e8f5f3",
            color: E.tealInk,
            fontSize: 13.5,
            fontWeight: 700,
            fontFamily: "inherit",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          {view === "managers" ? "Add Manager" : "Add Employee"}
        </button>
        )}

        {view === "people" ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {rosterPages.items.map((employee, index) => (
                <RosterCard
                  key={employee.uid}
                  employee={employee}
                  index={index}
                  onOpen={() => onSelect(employee)}
                />
              ))}

              {rows.length === 0 && (
                <div
                  style={{
                    padding: "46px 12px",
                    textAlign: "center",
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: E.label,
                  }}
                >
                  No employees match this search.
                </div>
              )}
            </div>

            <Pager pagination={rosterPages} variant="mobile" noun="team members" />
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {managerTotals.map((manager, index) => (
              <ManagerCard
                key={manager.uid}
                manager={manager}
                folders={folders.filter((folder) => folder.subAdminUid === manager.uid).length}
                index={index}
                onOpen={() => {
                  const record = subAdmins.find((person) => person.uid === manager.uid) ?? null;
                  if (record) onSelect(record);
                }}
                onEdit={
                  canManage
                    ? () => {
                        const record = subAdmins.find((person) => person.uid === manager.uid) ?? null;
                        setManagerFormFor(record);
                      }
                    : undefined
                }
              />
            ))}

            {managerTotals.length === 0 && (
              <div
                style={{
                  padding: "40px 16px",
                  textAlign: "center",
                  fontSize: 13,
                  fontWeight: 500,
                  color: E.label,
                  lineHeight: 1.55,
                }}
              >
                No managers yet. Tap the centre button to add one — a manager runs a team of
                employees and a set of Data Bank folders, and takes no leads themselves.
              </div>
            )}
          </div>
        )}
      </MobileBody>

      {selected && (
        <ProfileOverlay
          key={selected.uid}
          employee={selected}
          leads={leads}
          deals={deals}
          team={selectedTeam}
          onOpenMember={(member) => onSelect(member)}
          onClose={() => onSelect(null)}
          onEdit={
            canManage
              ? () => {
                  onSelect(null);
                  // A manager is edited by the Add Manager form, not the
                  // employee one — different fields entirely.
                  if (selectedIsManager) setManagerFormFor(selected);
                  else setFormFor(selected);
                }
              : undefined
          }
        />
      )}

      {formFor !== undefined && (
        <MobileEmployeeForm
          employee={formFor}
          managers={subAdmins}
          getIdToken={getIdToken}
          onClose={() => setFormFor(undefined)}
          onSaved={(message) => {
            setFormFor(undefined);
            onSaved(message);
          }}
        />
      )}

      {/* The desktop manager form, not a phone-only copy of it. `OverlayPanel`
          already renders as a full-height sheet below 820px, so the phone gets
          every field — account, details, status and the team tick-list —
          rather than a reduced version that would drift from the real one. */}
      {managerFormFor !== undefined && (
        <ManagerFormModal
          manager={managerFormFor}
          employees={metrics}
          getIdToken={getIdToken}
          onClose={() => setManagerFormFor(undefined)}
          onSaved={(message) => {
            setManagerFormFor(undefined);
            onSaved(message);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A manager on the phone.
 *
 * Shows what the desktop panel shows — team size, leads, deals won, revenue,
 * conversion, folders held — because those figures are the reason to open the
 * screen at all, and dropping them would make the phone view decorative.
 */
function ManagerCard({
  manager,
  folders,
  index,
  onEdit,
  onOpen,
}: {
  manager: ReturnType<typeof buildAllManagerMetrics>[number];
  folders: number;
  index: number;
  /** Absent for a sub admin — editing is `requireAdmin` on the server. */
  onEdit?: () => void;
  /** Opens the manager's dossier — the same sheet an employee card opens. */
  onOpen?: () => void;
}) {
  return (
    <div
      className="mob-rise"
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `Open ${manager.name}'s record` : undefined}
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
        animationDelay: `${Math.min(index, 8) * 42}ms`,
        background: "#fbfdfd",
        border: "1px solid #dceae8",
        borderRadius: 18,
        padding: "14px 15px",
        cursor: onOpen ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span
          aria-hidden
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 42,
            height: 42,
            borderRadius: 13,
            background: "#e8f5f3",
            color: E.tealInk,
            fontSize: 14,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {initialsOf(manager.name)}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 800,
              color: E.inkMobile,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {manager.name}
            {manager.status === "DISABLED" && (
              <span style={{ marginLeft: 7, fontSize: 10, fontWeight: 800, color: "#a5762a" }}>INACTIVE</span>
            )}
          </div>
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: E.label,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {manager.email}
          </div>
        </div>

        {onEdit && (
        <button
          type="button"
          onClick={(event) => {
            // The card opens the dossier now; without this, Edit would open it
            // behind the form and stack two overlays.
            event.stopPropagation();
            onEdit();
          }}
          className="mob-press"
          style={{
            flexShrink: 0,
            borderRadius: 999,
            border: "1px solid #dceae8",
            background: "#fff",
            color: E.tealInk,
            padding: "7px 13px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          Edit
        </button>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 8,
          marginTop: 13,
          paddingTop: 12,
          borderTop: "1px solid #eef4f3",
        }}
      >
        <ManagerFigure label="Team" value={String(manager.headcount)} />
        <ManagerFigure label="Leads" value={String(manager.assigned)} />
        <ManagerFigure label="Won" value={String(manager.closedWon)} />
        <ManagerFigure label="Revenue" value={compactRupees(manager.revenue)} accent />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 10,
          fontSize: 11.5,
          fontWeight: 600,
          color: E.muted,
        }}
      >
        <span>{manager.conversionRate}% conversion</span>
        <span>
          {folders} folder{folders === 1 ? "" : "s"}
        </span>
      </div>

      {manager.team.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 500, color: E.label, lineHeight: 1.5 }}>
          {manager.team.map((person) => person.name).join(", ")}
        </div>
      )}
    </div>
  );
}

function ManagerFigure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          color: accent ? E.tealInk : E.inkMobile,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: E.label }}>
        {label}
      </div>
    </div>
  );
}

function RosterCard({
  employee,
  index,
  onOpen,
}: {
  employee: EmployeeMetrics;
  index: number;
  onOpen: () => void;
}) {
  const active = employee.status === "ACTIVE";
  const winRate = employee.assigned > 0 ? Math.round((employee.closedWon / employee.assigned) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="mob-rise mob-press"
      // Staggered for the first eight only — beyond that the delay outlasts
      // the scroll and the list reads as laggy.
      style={{
        animationDelay: index < 8 ? `${index * 34}ms` : "0ms",
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "#fff",
        border: `1px solid ${E.border}`,
        borderRadius: 20,
        padding: "15px 16px",
        cursor: "pointer",
        fontFamily: "inherit",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "48px minmax(0,1fr) auto", alignItems: "center", gap: 13 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: E.field,
            border: `2px solid ${active ? E.teal : E.hair}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 800,
            color: E.tealInk,
            flexShrink: 0,
          }}
          aria-hidden
        >
          {initialsOf(employee.name)}
        </div>

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 15.5,
              fontWeight: 700,
              letterSpacing: "-0.35px",
              color: E.inkMobile,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {employee.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, flexShrink: 0, color: active ? E.teal : "#93a5a3" }}>
              {active ? "Active" : "Inactive"}
            </span>
            <span style={{ fontSize: 12, color: E.hair, flexShrink: 0 }}>·</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: E.label,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {employee.jobTitle}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7, flexShrink: 0 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: E.faint, whiteSpace: "nowrap" }}>
            Priority {employee.priority}
          </span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={E.teal} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m6 6 6 6-6 6M14 6l6 6-6 6" />
          </svg>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginTop: 14,
          paddingTop: 13,
          borderTop: "1px solid #f0f6f5",
        }}
      >
        {[
          { label: "Handled", value: String(employee.assigned), color: E.inkMobile },
          { label: "Win rate", value: `${winRate}%`, color: E.inkMobile },
          { label: "Profit", value: compactRupees(employee.profit), color: employee.profit >= 0 ? E.tealInk : E.red },
        ].map((metric) => (
          <div key={metric.label}>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.9px",
                textTransform: "uppercase",
                color: E.faint,
              }}
            >
              {metric.label}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 800,
                letterSpacing: "-0.4px",
                marginTop: 3,
                color: metric.color,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {metric.value}
            </div>
          </div>
        ))}
      </div>
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function lastTouchAt(lead: Lead) {
  return lead.lastFollowUpAt ?? lead.lastActivityAt ?? lead.acceptedAt ?? lead.assignedAt ?? lead.createdAt;
}

function toMillis(value: { toMillis?: () => number; toDate?: () => Date } | undefined): number {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const date = value.toDate?.();
  return date ? date.getTime() : 0;
}

function ProfileOverlay({
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
   * Present when the subject is a **manager**: their employees. Its presence is
   * what makes this a manager's dossier — the same switch the desktop modal
   * uses, so the two surfaces cannot decide differently what a manager's record
   * contains.
   */
  team?: EmployeeMetrics[];
  onClose: () => void;
  /** Absent for a sub admin — editing is `requireAdmin` on the server. */
  onEdit?: () => void;
  /** Open one of the manager's employees. Manager mode only. */
  onOpenMember?: (member: EmployeeMetrics) => void;
}) {
  // Read from the context rather than threaded down: the directory is already
  // behind a role guard, and the lead sheet needs both of these.
  const { role, getIdToken } = useAuth();
  const viewerRole: "admin" | "subadmin" | "employee" =
    role === "admin" || role === "subadmin" ? role : "employee";

  const [tab, setTab] = useState<ProfileTab>("leads");
  const [filters, setFilters] = useState<DossierFilters>(DEFAULT_DOSSIER_FILTERS);
  /**
   * The lead being read. `MobileLeadDetail` is the phone's equivalent of the
   * desktop dossier's `LeadDetailPane` — the same document, the same actions,
   * so a lead opened from here is not a summary of the one in the pipeline.
   */
  const [openLead, setOpenLead] = useState<Lead | null>(null);

  const isManager = team !== undefined;

  /** The manager and their team — a manager can hold leads of their own. */
  const owners = useMemo(
    () => new Set<string>([employee.uid, ...(team ?? []).map((member) => member.uid)]),
    [employee.uid, team]
  );

  /** A manager's figures are their team's, summed by the shared builder. */
  const figures = useMemo(
    () => (isManager ? buildManagerMetrics(employee, team ?? []) : null),
    [isManager, employee, team]
  );

  /**
   * One shape for both subjects. The manager's own record keeps the fields a
   * total cannot have — the KPI targets Analytics measures against, the joining
   * date — with the team counts laid over them.
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

  // The filters cut the tab bodies only — the hero figures keep describing the
  // employee's whole record, exactly as on the desktop dossier.
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

  const leadPages = usePagination(shownLeads, PROFILE_PAGE_SIZE);
  const dealPages = usePagination(shownDeals, PROFILE_PAGE_SIZE);
  const activityPages = usePagination(shownActivity, PROFILE_PAGE_SIZE);

  // The hardware back gesture should leave the profile, not the directory —
  // and should close an open lead before it closes the profile behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openLead) setOpenLead(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, openLead]);

  return (
    <div
      className="mob-slide-in"
      role="dialog"
      aria-label={`${isManager ? "Manager" : "Employee"}: ${employee.name}`}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        background: E.page,
        display: "grid",
        gridTemplateRows: "auto auto 1fr",
        minHeight: 0,
      }}
    >
      <MobileHeader style={{ background: E.gradientMobile, position: "relative", overflow: "hidden" }}>
        <HeroRings set="phone" />

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <HeaderCircle onClick={onClose} label="Back to the directory" size={36}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" aria-hidden>
              <path d="m14 6-6 6 6 6" />
            </svg>
          </HeaderCircle>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", opacity: 0.82 }}>
            {isManager ? "Manager" : "Employee"}
          </span>
          {onEdit ? (
            <HeaderCircle onClick={onEdit} label={isManager ? "Edit this manager" : "Edit this employee"} size={36}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 20h4l11-11-4-4L4 16v4Z" />
              </svg>
            </HeaderCircle>
          ) : (
            // Keeps the title centred between the back button and this slot.
            <span style={{ width: 36, flexShrink: 0 }} aria-hidden />
          )}
        </div>

        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14, marginTop: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              background: "rgba(255,255,255,0.2)",
              border: "1.5px solid rgba(255,255,255,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 17,
              fontWeight: 800,
              flexShrink: 0,
            }}
            aria-hidden
          >
            {initialsOf(employee.name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 21,
                fontWeight: 800,
                letterSpacing: "-0.6px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {employee.name}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
              <span
                style={{
                  padding: "3px 11px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.24)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.7px",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {employee.status === "ACTIVE" ? "Active" : "Inactive"}
              </span>
              {/* A manager is not in the distribution lane, so a priority for
                  them would be a rank they do not hold. */}
              <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85, whiteSpace: "nowrap" }}>
                {isManager
                  ? `${(team ?? []).length} ${(team ?? []).length === 1 ? "employee" : "employees"}`
                  : `Priority ${employee.priority}`}
              </span>
              {!isManager && employee.autoAssign === false && (
                <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85, whiteSpace: "nowrap" }}>
                  · Manual only
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                opacity: 0.8,
                marginTop: 4,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {employee.email}
            </div>
          </div>
        </div>

        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 9, marginTop: 16 }}>
          {[
            { label: isManager ? "TEAM HANDLED" : "HANDLED", value: String(subject.assigned) },
            { label: "WON / LOST", value: `${subject.closedWon} / ${subject.lost}` },
            isManager
              ? { label: "REVENUE", value: compactRupees(subject.revenue) }
              : { label: "PROFIT", value: compactRupees(subject.profit) },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                padding: "11px 12px",
                borderRadius: 16,
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.22)",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "0.7px",
                  opacity: 0.8,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {stat.label}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  letterSpacing: "-0.5px",
                  marginTop: 3,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </MobileHeader>

      <div
        role="tablist"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          margin: "14px 18px 0",
          padding: 4,
          borderRadius: 999,
          background: "#dceae8",
        }}
      >
        {(isManager ? MANAGER_PROFILE_TABS : PROFILE_TABS).map((option) => {
          const active = option.key === tab;
          return (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(option.key)}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "9px 4px",
                borderRadius: 999,
                border: "none",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "-0.1px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontFamily: "inherit",
                color: active ? E.tealInk : "#6c7d7b",
                background: active ? "#fff" : "transparent",
                WebkitTapHighlightColor: "transparent",
                transition: "background-color 160ms ease, color 160ms ease",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <MobileBody padding="14px 18px 24px">
        <div key={tab} className="mob-fade">
          {tab === "leads" && (
            <>
              <DossierFilterBar
                filters={filters}
                onChange={setFilters}
                variant="mobile"
                counts={cutCounts}
                countLine={`${shownLeads.length} / ${ownLeads.length}`}
              />
              <MobileAssignedLeads
                leads={leadPages.items}
                empty={ownLeads.length === 0}
                onOpen={setOpenLead}
              />
              <Pager pagination={leadPages} variant="mobile" noun="leads" />
            </>
          )}
          {tab === "deals" && (
            <>
              <DossierFilterBar
                filters={filters}
                onChange={setFilters}
                variant="mobile"
                showCut={false}
                countLine={`${shownDeals.length} / ${ownDeals.length}`}
              />
              <MobileDeals deals={dealPages.items} empty={ownDeals.length === 0} />
              <Pager pagination={dealPages} variant="mobile" noun="deals" />
            </>
          )}
          {tab === "team" && <MobileTeamRoster team={team ?? []} onOpen={onOpenMember} />}
          {tab === "analytics" && (
            <AnalyticsPanels analytics={analytics} handled={subject.assigned} variant="mobile" />
          )}
          {tab === "activity" && (
            <>
              <DossierFilterBar
                filters={filters}
                onChange={setFilters}
                variant="mobile"
                showCut={false}
                countLine={`${shownActivity.length} / ${activity.length}`}
              />
              <ActivityFeed
                entries={activityPages.items}
                variant="mobile"
                formatWhen={(at) => (at ? formatBusinessDateTime(at) : "—")}
              />
              <Pager pagination={activityPages} variant="mobile" noun="entries" />
            </>
          )}
        </div>
      </MobileBody>

      {openLead && (
        <MobileLeadDetail
          key={openLead.id}
          /* Resolved against the live list rather than the captured object, so
             a status change made inside the sheet is reflected behind it. */
          lead={leads.find((row) => row.id === openLead.id) ?? openLead}
          onClose={() => setOpenLead(null)}
          userRole={viewerRole}
          getIdToken={getIdToken}
          /* On a manager's dossier the leads belong to several people, so the
             name has to come from the lead rather than from the subject —
             printing the manager here would label every lead as theirs. */
          assigneeName={
            isManager
              ? ([employee, ...(team ?? [])].find(
                  (person) => person.uid === openLead.assignedUserId
                )?.name ?? "Assigned")
              : employee.name
          }
        />
      )}
    </div>
  );
}

/**
 * A manager's team, on the phone.
 *
 * The roll-call that explains the figures above it: two numbers per person and
 * a tap into their own dossier for the rest. The manager themselves is not a
 * row here — they are the subject, not a member of their own team.
 */
function MobileTeamRoster({
  team,
  onOpen,
}: {
  team: EmployeeMetrics[];
  onOpen?: (member: EmployeeMetrics) => void;
}) {
  if (team.length === 0) {
    return (
      <div
        style={{
          padding: "40px 16px",
          textAlign: "center",
          fontSize: 13,
          fontWeight: 500,
          color: E.label,
          lineHeight: 1.55,
        }}
      >
        No employees on this team yet. Somebody joins it from their own record, in the Reports To
        field.
      </div>
    );
  }

  const sorted = [...team].sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {sorted.map((member, index) => (
        <button
          key={member.uid}
          type="button"
          className="mob-rise mob-press"
          onClick={onOpen ? () => onOpen(member) : undefined}
          style={{
            animationDelay: `${Math.min(index, 8) * 42}ms`,
            display: "grid",
            gridTemplateColumns: "38px minmax(0,1fr) auto",
            alignItems: "center",
            gap: 11,
            width: "100%",
            textAlign: "left",
            background: "#fbfdfd",
            border: "1px solid #dceae8",
            borderRadius: 16,
            padding: "12px 13px",
            cursor: onOpen ? "pointer" : "default",
            fontFamily: "inherit",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 38,
              height: 38,
              borderRadius: 12,
              background: "#e8f5f3",
              color: E.tealInk,
              fontSize: 13,
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
                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: "#a4682a" }}>
                  INACTIVE
                </span>
              )}
            </span>
            <span
              style={{
                display: "block",
                fontSize: 11.5,
                color: E.label,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {member.jobTitle || member.email}
            </span>
          </span>

          <span style={{ display: "flex", gap: 14, flexShrink: 0, textAlign: "right" }}>
            <span>
              <span
                style={{
                  display: "block",
                  fontSize: 15,
                  fontWeight: 800,
                  color: E.ink,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {member.assigned}
              </span>
              <span
                style={{ display: "block", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.6px", color: E.label }}
              >
                LEADS
              </span>
            </span>
            <span>
              <span
                style={{
                  display: "block",
                  fontSize: 15,
                  fontWeight: 800,
                  color: E.tealInk,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {member.closedWon}
              </span>
              <span
                style={{ display: "block", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.6px", color: E.label }}
              >
                WON
              </span>
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The employee's leads, each opening the **full lead record** — the same
 * `MobileLeadDetail` the pipeline uses, on the same document.
 *
 * These cards were previously inert, so a manager on a phone could see that a
 * lead existed and could not read a word of its history; on the desktop the
 * same row has always opened `LeadDetailPane`. That was the gap, not a
 * deliberate simplification.
 */
function MobileAssignedLeads({
  leads,
  empty,
  onOpen,
}: {
  leads: Lead[];
  empty: boolean;
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
        // §11 — the folder the lead actually came out of, not just "Data Bank".
        // Same helper the leads list and the deal record use.
        const source = describeLeadSource(lead);
        return (
          <button
            key={lead.id}
            type="button"
            className="mob-press"
            onClick={() => onOpen(lead)}
            style={{
              background: "#fff",
              border: `1px solid ${E.border}`,
              borderRadius: 18,
              padding: "14px 15px",
              textAlign: "left",
              width: "100%",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
              font: "inherit",
              color: "inherit",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "42px minmax(0,1fr) auto", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: E.field,
                  border: `2px solid ${accent}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12.5,
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
                    fontSize: 14.5,
                    fontWeight: 700,
                    letterSpacing: "-0.3px",
                    color: E.inkMobile,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {lead.name}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0, color: accent }}>
                    {LEAD_STATUS_LABELS[lead.status as LeadStatus] ?? lead.status}
                  </span>
                  <span style={{ fontSize: 11.5, color: E.hair, flexShrink: 0 }}>·</span>
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: E.label,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {lead.phone || lead.email || "No contact"}
                  </span>
                </div>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: E.faint, whiteSpace: "nowrap", flexShrink: 0 }}>
                {formatBusinessDate(lastTouchAt(lead))}
              </span>
            </div>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 500,
                color: E.faint,
                marginTop: 11,
                paddingTop: 10,
                borderTop: "1px solid #f0f6f5",
              }}
            >
              {lead.campaignName ? `${source} · ${lead.campaignName}` : source}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MobileDeals({ deals, empty }: { deals: DealRecord[]; empty: boolean }) {
  if (deals.length === 0) {
    return (
      <EmptyPanel>
        {empty ? "No closed deals recorded for this employee yet." : "No deals settled in this period."}
      </EmptyPanel>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {deals.map((deal) => (
        <div
          key={deal.id}
          style={{ background: "#fff", border: `1px solid ${E.border}`, borderRadius: 18, padding: "14px 15px" }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "42px minmax(0,1fr)", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
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
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 700,
                  letterSpacing: "-0.3px",
                  color: E.inkMobile,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {deal.customer?.name || "Customer"}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: E.label,
                  marginTop: 3,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                Settled {formatBusinessDate(deal.dealDate ?? deal.enteredAt)}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginTop: 12,
              paddingTop: 11,
              borderTop: "1px solid #f0f6f5",
            }}
          >
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.9px", textTransform: "uppercase", color: E.faint }}>
                Received
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: E.inkMobile,
                  marginTop: 3,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatMoney(deal.amountReceived)}
              </div>
            </div>
            <div style={{ padding: "8px 12px", borderRadius: 14, background: E.tint }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.9px", textTransform: "uppercase", color: "#7fb0ab" }}>
                Profit
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: E.tealInk,
                  marginTop: 2,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatMoney(deal.profit)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Add / edit sheet                                                            */
/* -------------------------------------------------------------------------- */

const SHEET_FIELD: React.CSSProperties = {
  border: `1px solid ${E.border}`,
  background: E.field,
  borderRadius: 14,
  padding: "13px 14px",
  fontSize: 14,
  fontWeight: 600,
  color: E.inkMobile,
  outline: "none",
  width: "100%",
  fontFamily: "inherit",
};

const SHEET_LABEL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 11.5,
  fontWeight: 600,
  color: E.muted,
  minWidth: 0,
};

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}

function dateInputValue(value: { toDate?: () => Date } | null | undefined): string {
  const date = typeof value?.toDate === "function" ? value.toDate() : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * The design's sheet carries six fields. This carries every field the desktop
 * form does — a password (Firebase Auth cannot create a user without one), the
 * lane priority, the joining date, the lead-assignment mode, the KPI targets
 * and notes — because an admin on a phone must be able to create a usable
 * account, not a half-configured one.
 */
function MobileEmployeeForm({
  employee,
  managers,
  getIdToken,
  onClose,
  onSaved,
}: {
  employee: EmployeeMetrics | null;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** The managers an employee can be assigned to. */
  managers: EmployeeMetrics[];
}) {
  const editing = Boolean(employee);

  const [name, setName] = useState(employee?.name ?? "");
  const [email, setEmail] = useState(employee?.email ?? "");
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [joinedAt, setJoinedAt] = useState(dateInputValue(employee?.joinedAt ?? employee?.createdAt));
  const [password, setPassword] = useState("");
  const [jobTitle, setJobTitle] = useState<string>(employee?.jobTitle ?? DEFAULT_JOB_TITLE);
  const [status, setStatus] = useState<"ACTIVE" | "DISABLED">(employee?.status ?? "ACTIVE");
  const [priority, setPriority] = useState(employee?.priority ?? MAX_PRIORITY);
  const [autoAssign, setAutoAssign] = useState(employee?.autoAssign !== false);
  const [notes, setNotes] = useState(employee?.notes ?? "");
  // Which manager they report to. On the desktop form this is "Reports To";
  // leaving it off the phone would make the hierarchy editable on one surface
  // only, which is the parity gap this round exists to close.
  const [subAdminUid, setSubAdminUid] = useState<string>(employee?.subAdminUid ?? "");
  const [targets, setTargets] = useState<KpiTargets>({ ...DEFAULT_KPI_TARGETS, ...employee?.targets });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (name.trim().length < 2) return setError("Enter the employee's full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (!editing && password.length < 8) return setError("The password must be at least 8 characters.");
    if (editing && password && password.length < 8)
      return setError("The new password must be at least 8 characters, or leave it blank.");

    setBusy(true);
    try {
      const token = await getIdToken();

      if (!editing) {
        const res = await createEmployee(token, {
          name: name.trim(),
          email: email.trim(),
          password,
          priority,
          jobTitle,
          status,
          targets,
          subAdminUid: subAdminUid || null,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          joinedAt: joinedAt || null,
          autoAssign,
        });
        if (res.ok) onSaved(`${name.trim()} added to the directory.`);
        else setError(res.error || "Could not create the account.");
        return;
      }

      const current = employee!;
      const res = await updateEmployee(token, current.uid, {
        name: name.trim() !== current.name ? name.trim() : undefined,
        email: email.trim() !== current.email ? email.trim() : undefined,
        password: password || undefined,
        priority: priority !== current.priority ? priority : undefined,
        jobTitle: jobTitle !== current.jobTitle ? jobTitle : undefined,
        targets,
        // Sent only when it changed, so an unrelated edit cannot silently
        // detach somebody from their team.
        subAdminUid:
          (subAdminUid || null) !== (current.subAdminUid ?? null) ? subAdminUid || null : undefined,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        joinedAt: joinedAt || null,
        autoAssign,
      });
      if (!res.ok) {
        setError(res.error || "Could not update the employee.");
        return;
      }

      if (status !== current.status) {
        const change =
          status === "DISABLED"
            ? await disableEmployee(token, current.uid)
            : await enableEmployee(token, current.uid);
        if (!change.ok) {
          setError(change.error || "Saved, but the status could not be changed.");
          return;
        }
      }

      onSaved(`${name.trim()} updated.`);
    } catch {
      setError("A network error occurred. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={editing ? "Edit Employee" : "New Employee"}
      subtitle={editing ? "Changes take effect on save." : "Add a team member to the directory."}
      onClose={onClose}
    >
      {error && <MobileNotice tone="error" text={error} />}

      <label style={SHEET_LABEL}>
        <span>Full Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ali Raza"
          autoComplete="name"
          disabled={busy}
          style={SHEET_FIELD}
        />
      </label>

      <label style={SHEET_LABEL}>
        <span>Email Address</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="e.g. ali@example.com"
          autoComplete="off"
          disabled={busy}
          style={SHEET_FIELD}
        />
      </label>

      <label style={SHEET_LABEL}>
        <span>Phone Number</span>
        <input
          value={phone ?? ""}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. 0300 1234567"
          inputMode="tel"
          autoComplete="tel"
          disabled={busy}
          style={SHEET_FIELD}
        />
      </label>

      <label style={SHEET_LABEL}>
        <span>Date Joined</span>
        <input
          type="date"
          value={joinedAt}
          onChange={(e) => setJoinedAt(e.target.value)}
          disabled={busy}
          style={SHEET_FIELD}
        />
      </label>

      <div style={{ ...SHEET_LABEL, gap: 6 }}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>{editing ? "New Password" : "Temporary Password"}</span>
          <button
            type="button"
            onClick={() => setPassword(generatePassword())}
            disabled={busy}
            style={{
              border: "none",
              background: "transparent",
              color: E.tealInk,
              fontSize: 11.5,
              fontWeight: 700,
              cursor: "pointer",
              padding: 0,
              fontFamily: "inherit",
            }}
          >
            Generate
          </button>
        </span>
        <input
          // Shown in the clear on the phone: the admin is reading it out to the
          // new employee, and a dotted field they cannot check is worse here
          // than on a desktop with a reveal button beside it.
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={editing ? "Leave blank to keep current" : "At least 8 characters"}
          autoComplete="new-password"
          disabled={busy}
          style={SHEET_FIELD}
        />
      </div>

      <label style={SHEET_LABEL}>
        <span>Role</span>
        <select
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          disabled={busy}
          style={SHEET_FIELD}
        >
          {JOB_TITLES.map((title) => (
            <option key={title} value={title}>
              {title}
            </option>
          ))}
        </select>
      </label>

      <label style={SHEET_LABEL}>
        <span>Reports To</span>
        <select
          value={subAdminUid}
          onChange={(e) => setSubAdminUid(e.target.value)}
          disabled={busy}
          style={SHEET_FIELD}
        >
          <option value="">Admin (directly)</option>
          {managers.map((manager) => (
            <option key={manager.uid} value={manager.uid}>
              {manager.name}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11, fontWeight: 500, color: E.label, marginTop: 2 }}>
          Their manager sees their leads and deals, and their numbers count toward that
          manager&rsquo;s totals.
        </span>
      </label>

      <label style={SHEET_LABEL}>
        <span>Monthly Target (PKR)</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={targets.revenue}
          onChange={(e) => setTargets((prev) => ({ ...prev, revenue: Math.max(0, Number(e.target.value) || 0) }))}
          disabled={busy}
          style={{ ...SHEET_FIELD, fontVariantNumeric: "tabular-nums" }}
        />
      </label>

      <div style={{ ...SHEET_LABEL, gap: 7 }}>
        <span>Status</span>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }} role="radiogroup" aria-label="Status">
          {(["ACTIVE", "DISABLED"] as const).map((value) => {
            const selected = status === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setStatus(value)}
                disabled={busy}
                className="mob-press"
                style={{
                  padding: "10px 20px",
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  border: `1px solid ${selected ? E.teal : E.border}`,
                  background: selected ? E.teal : E.field,
                  color: selected ? "#fff" : E.muted,
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {value === "ACTIVE" ? "Active" : "Inactive"}
              </button>
            );
          })}
        </div>
      </div>

      <label style={SHEET_LABEL}>
        <span>Lead Assignment</span>
        <select
          value={autoAssign ? "auto" : "manual"}
          onChange={(e) => setAutoAssign(e.target.value === "auto")}
          disabled={busy}
          style={SHEET_FIELD}
        >
          <option value="auto">Include in round-robin</option>
          <option value="manual">Manual assignment only</option>
        </select>
      </label>

      <label style={SHEET_LABEL}>
        <span>Lane Priority (1 = first in line)</span>
        <select
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          disabled={busy}
          style={SHEET_FIELD}
        >
          {Array.from({ length: MAX_PRIORITY }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              Priority {n}
            </option>
          ))}
        </select>
      </label>

      <div
        style={{
          border: `1px solid ${E.border}`,
          background: E.field,
          borderRadius: 16,
          padding: "13px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 11,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: E.tealInk }}>
          Monthly KPI Targets
        </span>
        {KPI_METRICS.map((metric) => (
          <label key={metric} style={{ ...SHEET_LABEL, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, minWidth: 0 }}>{KPI_METRIC_LABELS[metric]}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={100000}
              value={targets[metric]}
              onChange={(e) => setTargets((prev) => ({ ...prev, [metric]: Math.max(1, Number(e.target.value) || 1) }))}
              disabled={busy}
              style={{ ...SHEET_FIELD, width: 110, background: "#fff", fontVariantNumeric: "tabular-nums" }}
            />
          </label>
        ))}
      </div>

      <label style={SHEET_LABEL}>
        <span>Notes</span>
        <textarea
          rows={3}
          value={notes ?? ""}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Territory, reporting line, anything worth recording"
          disabled={busy}
          style={{ ...SHEET_FIELD, resize: "vertical" }}
        />
      </label>

      <SheetAction
        label={busy ? "Saving…" : editing ? "Save Changes" : "Add to Directory"}
        disabled={busy}
        onPress={submit}
      />
    </Sheet>
  );
}

function MobileNotice({
  tone,
  text,
  onDismiss,
}: {
  tone: "error" | "success";
  text: string;
  onDismiss?: () => void;
}) {
  const error = tone === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
        border: `1px solid ${error ? "#f0c4bd" : "#bfe0dc"}`,
        background: error ? E.redBg : E.tealTint,
        color: error ? "#a33a29" : E.deep,
        borderRadius: 14,
        padding: "11px 13px",
        fontSize: 12.5,
        fontWeight: 600,
        marginBottom: 11,
      }}
    >
      <span>{text}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", flexShrink: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
