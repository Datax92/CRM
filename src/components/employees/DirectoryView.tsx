"use client";

/**
 * The Team directory — built to `Employee Directory.dc.html`.
 *
 * **One screen, two roles.** The admin sees the whole company; a sub admin sees
 * their own team, in the same hero, the same stat cards, the same roster table
 * and the same dossier. It is one component rather than two pages because the
 * sub admin's Team page was a different screen entirely, and two
 * implementations of "the directory" drift the first time either is touched.
 *
 * What differs is **authority, not appearance**. Every mutating employee action
 * — create, edit, pause, set a lane priority, recalculate the lane — is
 * `requireAdmin` on the server. So for a sub admin those controls are absent
 * rather than present-and-failing: offering a button whose only possible
 * outcome is "That action is for administrators" is worse than not offering it.
 * Everything that reads — search, the filters, the figures, the dossier with
 * its leads, deals, activity and analytics — is identical.
 *
 * Below 820px the phone renders `MobileEmployees` instead, built to
 * `Employee Directory Mobile.dc.html`. The switch is a JS width measurement,
 * not a media query, for the reason recorded in CLAUDE.md: a rule a build
 * silently lacks cannot break a number React read at runtime.
 *
 * Both surfaces read the same `buildEmployeeMetrics` rollup and call the same
 * client actions, so a figure on one cannot disagree with the other.
 */

export type DirectoryScope = "admin" | "subadmin";

import { useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePagination } from "@/hooks/usePagination";
import { useEmployees, useSubAdmins } from "@/hooks/useEmployees";
import { useDataBankFolders } from "@/hooks/useDataBank";
import { SubAdminPanel } from "@/components/employees/SubAdminPanel";
import { useLeads } from "@/hooks/useLeads";
import { useFinancials } from "@/hooks/useFinancials";
import { buildEmployeeMetrics, type EmployeeMetrics } from "@/lib/metrics";
import { formatMoney } from "@/lib/money";
import { initialsOf } from "@/lib/leadDisplay";
import { recalculateEmployeePriorities } from "@/lib/clientActions";
import { FullPageSpinner } from "@/components/admin/AdminShared";
import { E, HeroRings, buildDirectoryStats, type DirectoryStat } from "@/components/employees/directoryChrome";
import { Pager } from "@/components/employees/DossierControls";
import { EmployeeFormModal } from "@/components/employees/EmployeeFormModal";
import { EmployeeDetailModal } from "@/components/employees/EmployeeDetailModal";
import { MobileEmployees } from "@/components/mobile/MobileEmployees";

export type DirectoryFilter = "All" | "Active" | "Inactive";

export const DIRECTORY_FILTERS: DirectoryFilter[] = ["All", "Active", "Inactive"];

/** One definition of the roster cut, shared by both surfaces. */
export function filterRoster(
  metrics: EmployeeMetrics[],
  query: string,
  filter: DirectoryFilter
): EmployeeMetrics[] {
  const q = query.trim().toLowerCase();
  return metrics.filter((employee) => {
    if (filter === "Active" && employee.status !== "ACTIVE") return false;
    if (filter === "Inactive" && employee.status === "ACTIVE") return false;
    if (!q) return true;
    return `${employee.name} ${employee.email} ${employee.jobTitle}`.toLowerCase().includes(q);
  });
}

const GRID = "minmax(240px,2.4fr) 1fr 1fr 1fr 1.3fr";

/** Roster rows per page. */
const PAGE_SIZE = 10;

const DIRECTORY_CSS = `
.directory-row { transition: background-color 140ms ease; }
.directory-row:hover { background: #f7fbfa; }
.directory-row:focus-visible { background: #f2f8f7; outline: 2px solid #3f8f8a; outline-offset: -2px; }
.directory-stat { transition: border-color 160ms ease; }
.directory-stat:hover { border-color: #b6d9d5; }
@keyframes directory-row-in { from { opacity: 0; transform: translate3d(0, 8px, 0); } to { opacity: 1; transform: none; } }
.directory-row-in { animation: directory-row-in 300ms cubic-bezier(0.22,0.61,0.36,1) both; }
@media (prefers-reduced-motion: reduce) {
  .directory-row-in { animation: none !important; }
  .directory-row, .directory-stat { transition: none !important; }
}
`;

export function DirectoryView({ scope }: { scope: DirectoryScope }) {
  const { user, role, loading: authLoading, getIdToken } = useAuth();
  useProtectedRoute([scope]);

  const isAdmin = scope === "admin";
  /** Only an admin may change anything here — every action is `requireAdmin`. */
  const canManage = isAdmin && role === "admin";
  /** Wait for the role to resolve before any query goes out. */
  const ready = role === scope;
  const isMobile = useIsMobile();

  // Every read below is scoped by the same clause its Security Rule checks.
  // For a sub admin that is not an optimisation: Firestore refuses a list
  // query it cannot prove safe, so an unscoped read returns nothing at all.
  const teamScope = isAdmin ? undefined : { role, uid: user?.uid };

  const { employees, loading: empLoading, error: empError } = useEmployees(ready, teamScope);
  // Sub admins are a separate query because they are a separate `role` value;
  // the roster query reads `role == "employee"` and always has. Admin only —
  // a sub admin enumerating their peers is the visibility §22 forbids.
  const { subAdmins } = useSubAdmins(ready && isAdmin);
  // Read only to say how many folders each sub admin holds. Folders are
  // assigned from the Data Bank, which is where that decision belongs.
  const { folders } = useDataBankFolders(ready && isAdmin);
  const { leads, loading: leadsLoading } = useLeads(ready ? scope : null, user?.uid);
  const { allDeals } = useFinancials(
    { key: "ALL", from: null, to: null, label: "ALL" },
    ready,
    teamScope
  );

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DirectoryFilter>("All");
  const [formFor, setFormFor] = useState<{ employee: EmployeeMetrics | null } | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  const metrics = useMemo(
    () => buildEmployeeMetrics(employees, leads, allDeals),
    [employees, leads, allDeals]
  );

  // Sub admins go through the same builder so the panel can show real figures
  // rather than a name and a count — and so a manager who also works leads is
  // measured the same way everyone else is.
  const subAdminMetrics = useMemo(
    () => buildEmployeeMetrics(subAdmins, leads, allDeals),
    [subAdmins, leads, allDeals]
  );

  const rows = useMemo(
    () => [...filterRoster(metrics, query, filter)].sort((a, b) => a.name.localeCompare(b.name)),
    [metrics, query, filter]
  );

  const rosterPages = usePagination(rows, PAGE_SIZE);

  // Headline figures describe the whole roster, not the current filter — a
  // number that moved when you clicked "Inactive" would read as the team
  // having shrunk.
  const stats = useMemo(() => buildDirectoryStats(metrics, leads, allDeals), [metrics, leads, allDeals]);

  const totals = useMemo(() => {
    const handled = metrics.reduce((sum, e) => sum + e.assigned, 0);
    const won = metrics.reduce((sum, e) => sum + e.closedWon, 0);
    return { handled, winRate: handled > 0 ? Math.round((won / handled) * 100) : 0 };
  }, [metrics]);

  /**
   * Read live, so an edit saved from the dossier is reflected without
   * reopening — and resolved against **both** rosters, because a manager is
   * not in `metrics`: the roster query is `role == "employee"` and always has
   * been. Looking a manager up in the employee list is what made their card
   * unopenable rather than merely unstyled.
   */
  const selected = selectedUid
    ? (metrics.find((m) => m.uid === selectedUid) ??
      subAdminMetrics.find((m) => m.uid === selectedUid) ??
      null)
    : null;

  /** True when the open dossier is a manager's rather than an employee's. */
  const selectedIsManager = Boolean(
    selected && subAdminMetrics.some((m) => m.uid === selected.uid)
  );

  /** The employees whose figures a manager's dossier is the sum of. */
  const selectedTeam = useMemo(
    () =>
      selectedIsManager && selected
        ? metrics.filter((member) => member.subAdminUid === selected.uid)
        : undefined,
    [selectedIsManager, selected, metrics]
  );

  /** The phone header's account chip. The design draws a single letter. */
  const accountInitial = (user?.email ?? "A").trim().charAt(0).toUpperCase() || "A";

  /**
   * Re-ranks the lane from this month's KPIs. Only employees left on automatic
   * move; anyone whose priority an admin has set by hand keeps it.
   */
  const runRecalculation = async () => {
    setRecalculating(true);
    setBanner(null);
    try {
      const res = await recalculateEmployeePriorities(await getIdToken());
      if (res.ok) {
        const moved = res.data?.changes.length ?? 0;
        setBanner({
          tone: "success",
          text:
            moved === 0
              ? `Priorities recalculated — the lane order is unchanged (${res.data?.evaluated ?? 0} on automatic).`
              : `Priorities recalculated — ${moved} employee${moved === 1 ? "" : "s"} moved.`,
        });
      } else {
        setBanner({ tone: "error", text: res.error || "Could not recalculate priorities." });
      }
    } catch {
      setBanner({ tone: "error", text: "Network error." });
    } finally {
      setRecalculating(false);
    }
  };

  const modals = (
    <>
      {formFor && (
        <EmployeeFormModal
          employee={formFor.employee}
          getIdToken={getIdToken}
          onClose={() => setFormFor(null)}
          onSaved={(message) => {
            setFormFor(null);
            setBanner({ tone: "success", text: message });
          }}
        />
      )}

      {selected && (
        <EmployeeDetailModal
          key={selected.uid}
          employee={selected}
          leads={leads}
          deals={allDeals}
          // Present only for a manager. Its presence is what makes the dossier
          // a manager's; `undefined` is an employee, `[]` is a manager with
          // nobody under them yet.
          team={selectedTeam}
          onOpenMember={(member) => setSelectedUid(member.uid)}
          onClose={() => setSelectedUid(null)}
          // The dossier renders at z-110 and the form at z-120, but leaving both
          // mounted stacks two backdrops over the page. Close the dossier first.
          onEdit={
            // A manager is edited by the Add Manager form, not the employee
            // one — no lane priority, no KPI targets, no job title. Rather than
            // open the wrong form, the manager's dossier has no Edit and the
            // card behind it keeps its own.
            canManage && !selectedIsManager
              ? () => {
                  setSelectedUid(null);
                  setFormFor({ employee: selected });
                }
              : undefined
          }
        />
      )}
    </>
  );

  if (authLoading || empLoading || leadsLoading) return <FullPageSpinner />;

  if (isMobile) {
    // The phone owns its own add/edit sheet — a 680px centred dialog on a
    // 390px frame is the wrong shape, and the design file draws a bottom sheet.
    return (
      <MobileEmployees
        metrics={metrics}
        rows={rows}
        subAdmins={subAdminMetrics}
        folders={folders}
        leads={leads}
        deals={allDeals}
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        accountInitial={accountInitial}
        error={empError ?? (banner?.tone === "error" ? banner.text : null)}
        notice={banner?.tone === "success" ? banner.text : null}
        onDismissNotice={() => setBanner(null)}
        selected={selected}
        onSelect={(employee) => setSelectedUid(employee?.uid ?? null)}
        getIdToken={getIdToken}
        onSaved={(message) => setBanner({ tone: "success", text: message })}
        onRecalculate={runRecalculation}
        recalculating={recalculating}
        canManage={canManage}
      />
    );
  }

  return (
    // Full-bleed: cancels the <main> padding so the design's own 28px gutter is
    // the only one.
    <div
      className="-m-6 md:-m-8"
      style={{
        minHeight: "100%",
        background: E.page,
        color: "#2b3a39",
        fontFamily: E.font,
        letterSpacing: E.tracking,
        padding: "24px 28px 32px",
      }}
    >
      {/*
        Hover and entrance cannot be expressed inline, and a rule in
        `globals.css` is exactly the build artefact that has silently gone
        missing twice on this project. Shipping them in the tree means they
        arrive with the component or not at all. Transform/opacity only, so
        nothing here triggers layout.
      */}
      <style>{DIRECTORY_CSS}</style>

      {/* ---- hero ---- */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 22,
          background: E.gradient,
          color: "#fff",
          padding: "24px 28px",
          marginBottom: 16,
        }}
      >
        <HeroRings set="hero" />
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
                width: 52,
                height: 52,
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
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="9" cy="8" r="3.2" />
                <path d="M2.5 20c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5M17 4.5a3.2 3.2 0 0 1 0 7" />
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
                {isAdmin ? "Directory" : "My team"}
              </div>
              <h1
                style={{
                  fontSize: 29,
                  fontWeight: 800,
                  letterSpacing: "-1px",
                  margin: "1px 0 0",
                  color: "#fff",
                  // Explicit: `@layer base` sets font-family on h1-h6, which
                  // beats an inherited family from the container.
                  fontFamily: E.font,
                }}
              >
                {isAdmin ? "Employee Directory" : "Team Directory"}
              </h1>
              <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.82, marginTop: 4 }}>
                {metrics.length} team member{metrics.length === 1 ? "" : "s"} · {totals.handled} lead
                {totals.handled === 1 ? "" : "s"} handled · {totals.winRate}% win rate
              </div>
            </div>
          </div>

          {/* Both of these are `requireAdmin` on the server. A sub admin gets
              the screen without them rather than buttons that can only fail. */}
          {canManage && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={runRecalculation}
              disabled={recalculating}
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
                cursor: recalculating ? "progress" : "pointer",
                fontFamily: "inherit",
                opacity: recalculating ? 0.75 : 1,
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className={recalculating ? "animate-spin" : undefined}
                aria-hidden
              >
                <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
              </svg>
              <span style={{ whiteSpace: "nowrap" }}>
                {recalculating ? "Recalculating…" : "Recalculate Priority"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFormFor({ employee: null })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "11px 20px",
                borderRadius: 10,
                background: "#fff",
                border: "none",
                color: E.deep,
                fontSize: 13.5,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span style={{ whiteSpace: "nowrap" }}>New Employee</span>
            </button>
          </div>
          )}
        </div>
      </div>

      {(empError || banner) && (
        <div style={{ marginBottom: 16, display: "grid", gap: 10 }}>
          {empError && <Notice tone="error" text={empError} />}
          {banner && <Notice tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />}
        </div>
      )}

      {/* ---- stat cards ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(252px, 1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        {stats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </div>

      {/* ---- the management layer ----
          Admin only: a sub admin listing their peers, their team sizes and
          their revenue is exactly the cross-team visibility §22 forbids. */}
      {canManage && (
        <SubAdminPanel
          onOpen={(manager) => setSelectedUid(manager.uid)}
          subAdmins={subAdminMetrics}
          employees={metrics}
          folders={folders}
          getIdToken={getIdToken}
          onResult={setBanner}
        />
      )}

      {/* ---- roster ---- */}
      <div style={{ background: E.surface, border: `1px solid ${E.border}`, borderRadius: 18, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            padding: "16px 20px",
            borderBottom: `1px solid ${E.softBorder}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              width: 300,
              maxWidth: "100%",
              background: "#f4f8f7",
              border: `1px solid ${E.border}`,
              borderRadius: 10,
              padding: "10px 14px",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={E.label} strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search employees..."
              aria-label="Search employees by name, email or role"
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 13.5,
                fontWeight: 500,
                color: "#2b3a39",
                fontFamily: "inherit",
              }}
            />
          </div>

          <div
            role="tablist"
            aria-label="Filter by status"
            style={{ display: "flex", alignItems: "center", gap: 4, padding: 4, borderRadius: 11, background: "#f0f6f5" }}
          >
            {DIRECTORY_FILTERS.map((option) => {
              const active = filter === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(option)}
                  style={{
                    padding: "8px 20px",
                    borderRadius: 8,
                    border: "none",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: active ? E.tealInk : "#7e918f",
                    background: active ? "#fff" : "transparent",
                    boxShadow: active ? "0 1px 3px rgba(31,92,88,0.12)" : "none",
                    transition: "background-color 160ms ease, color 160ms ease",
                  }}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 860 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                gap: 16,
                padding: "13px 24px",
                background: E.field,
                borderBottom: `1px solid ${E.softBorder}`,
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "1.1px",
                textTransform: "uppercase",
                color: E.label,
              }}
            >
              <div>Employee</div>
              <div style={{ textAlign: "center" }}>Status</div>
              <div style={{ textAlign: "center" }}>Handled</div>
              <div style={{ textAlign: "center" }}>Won / Lost</div>
              <div style={{ textAlign: "right" }}>Profit Generated</div>
            </div>

            {rosterPages.items.map((employee, index) => (
              <RosterRow
                key={employee.uid}
                employee={employee}
                index={index}
                onOpen={() => setSelectedUid(employee.uid)}
              />
            ))}

            {rows.length === 0 && (
              <div
                style={{
                  padding: "52px 24px",
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
        </div>

        <div style={{ padding: "10px 24px 14px" }}>
          <Pager pagination={rosterPages} variant="web" noun="team members" />
          <div style={{ fontSize: 12.5, fontWeight: 500, color: E.faint, paddingTop: rosterPages.single ? 4 : 8 }}>
            {rows.length} of {metrics.length} team member{metrics.length === 1 ? "" : "s"} shown
          </div>
        </div>
      </div>

      {modals}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function StatCard({ stat }: { stat: DirectoryStat }) {
  const peak = Math.max(1, ...stat.spark);

  return (
    <div
      className="directory-stat"
      style={{
        position: "relative",
        overflow: "hidden",
        background: E.surface,
        border: `1px solid ${E.border}`,
        borderRadius: 16,
        padding: "16px 18px",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: stat.accent }} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 9,
              background: E.tint,
              color: stat.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            aria-hidden
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={stat.icon} />
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
            {stat.label}
          </span>
        </div>

        {stat.delta && (
          <span
            title="Change against last month"
            style={{
              flexShrink: 0,
              padding: "3px 9px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: "nowrap",
              background: stat.up ? E.tealTint : E.redBg,
              color: stat.up ? E.tealInk : E.redInk,
            }}
          >
            {stat.delta}
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, marginTop: 11 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: "-1px",
              color: E.ink,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {stat.value}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 500, color: E.faint, marginTop: 6 }}>{stat.note}</div>
        </div>

        <div
          style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 34, flexShrink: 0 }}
          aria-hidden
          title="The last seven months"
        >
          {stat.spark.map((value, index) => (
            <div
              key={index}
              style={{
                width: 6,
                borderRadius: "3px 3px 0 0",
                height: Math.max(5, Math.round((value / peak) * 34)),
                background: index === stat.spark.length - 1 ? stat.accent : "#d9e9e7",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RosterRow({
  employee,
  index,
  onOpen,
}: {
  employee: EmployeeMetrics;
  index: number;
  onOpen: () => void;
}) {
  const active = employee.status === "ACTIVE";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open ${employee.name}`}
      className="directory-row directory-row-in"
      // Staggered for the first eight only — past that the delay outlasts the
      // scroll and the list reads as laggy.
      style={{
        animationDelay: index < 8 ? `${index * 32}ms` : "0ms",
        display: "grid",
        gridTemplateColumns: GRID,
        gap: 16,
        alignItems: "center",
        padding: "15px 24px",
        borderBottom: `1px solid ${E.rowBorder}`,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            background: E.tint,
            border: "1.5px solid #b6d9d5",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700,
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
              color: E.ink,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {employee.name}
          </div>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              color: E.label,
              marginTop: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {employee.email}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <span
          style={{
            display: "inline-block",
            padding: "5px 15px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.2px",
            background: active ? E.tealTint : E.rowBorder,
            color: active ? E.tealInk : E.label,
          }}
        >
          {active ? "Active" : "Inactive"}
        </span>
      </div>

      <div
        style={{
          textAlign: "center",
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: "-0.4px",
          color: E.ink,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {employee.assigned}
      </div>

      <div
        style={{
          textAlign: "center",
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: "-0.3px",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ color: E.tealInk }}>{employee.closedWon}</span>
        <span style={{ color: "#cddfdd", fontWeight: 500 }}> / </span>
        <span style={{ color: E.red }}>{employee.lost}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 11 }}>
        <span
          style={{
            fontSize: 15.5,
            fontWeight: 700,
            letterSpacing: "-0.3px",
            color: employee.profit >= 0 ? E.tealInk : E.red,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {formatMoney(employee.profit)}
        </span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={E.teal} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 6 6 6-6 6M14 6l6 6-6 6" />
        </svg>
      </div>
    </div>
  );
}

function Notice({
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
        gap: 12,
        border: `1px solid ${error ? "#f0c4bd" : "#bfe0dc"}`,
        background: error ? E.redBg : E.tealTint,
        color: error ? "#a33a29" : E.deep,
        borderRadius: 12,
        padding: "12px 16px",
        fontSize: 13,
        fontWeight: 600,
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
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
