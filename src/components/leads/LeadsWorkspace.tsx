"use client";

/**
 * The unified leads workspace — one screen replacing the old Active / New /
 * Closed routes.
 *
 * Two panes: a fixed-width list on the left, the lead detail on the right.
 * Both are fixed frames; only the list body and the detail's tab body scroll,
 * so nothing reflows as you move between leads.
 *
 * Below `lg` there isn't room for two panes, so the detail takes over the
 * frame and the header grows a back arrow. Selection state is identical in
 * both layouts — only the presentation differs.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePagination } from "@/hooks/usePagination";
import { MobileLeads } from "@/components/mobile/MobileLeads";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useLeads, type Lead } from "@/hooks/useLeads";
import { useEmployees } from "@/hooks/useEmployees";
import { resolveRange, formatBusinessDateTime } from "@/lib/dates";
import {
  LEAD_FILTER_LABELS,
  filterOrderFor,
  urgentFilterFor,
  matchesLeadFilter,
  countByFilter,
  parseFilterParam,
  type LeadFilterKey,
  type WorkspaceRole,
} from "@/lib/leadBuckets";
import { initialsOf, avatarRingColor } from "@/lib/leadDisplay";
import { pipelineStage } from "@/lib/pipelineStage";
import { describeLeadSource } from "@/lib/leadSource";
import { isStageFilter } from "@/lib/leadBuckets";
import { STAGE_TONES, StageIcon, StagePill } from "./StageChrome";
import { useOpenedLeads } from "@/hooks/useOpenedLeads";
import { LEAD_STATUS_LABELS } from "@/lib/leadStatus";
import { FullPageSpinner, Banner } from "@/components/admin/AdminShared";
import { AssignModal } from "@/components/admin/AssignModal";
import { LeadDetailPane } from "./LeadDetailPane";
import { WorkspaceEmpty } from "./WorkspaceEmpty";
import { Pager } from "@/components/employees/DossierControls";
import { Search, SlidersHorizontal, Database } from "lucide-react";

/**
 * What each role may do from this screen.
 *
 * Presentation only — the server actions and Firestore rules enforce all of
 * this independently. Hiding a control the backend would reject anyway just
 * keeps an employee from being offered a button that cannot work.
 *
 * Employees keep everything their job needs: accepting a lead, logging
 * follow-ups, moving the pipeline stage and recording a won deal. What they
 * don't get is pipeline administration — creating leads and reassigning owners,
 * both of which are admin decisions (PRD BR-4/BR-5).
 */
const CAPABILITIES = {
  admin: { canCreateLead: true, canReassign: true },
  employee: { canCreateLead: false, canReassign: false },
  // A sub admin runs a team: they hand out and re-route leads inside it, but
  // manual lead entry still belongs in the Data Bank for everyone.
  subadmin: { canCreateLead: false, canReassign: true },
} as const satisfies Record<WorkspaceRole, { canCreateLead: boolean; canReassign: boolean }>;

/**
 * Row shading by read state: a list you can skim and see what you have not
 * looked at yet.
 *
 * Three tones on one teal ramp, dark to light — **selected** is the deepest so
 * the row you are reading is unmistakable, **unopened** sits in the middle so
 * untouched work still has weight, and **opened** recedes almost to the panel's
 * own white. Ordering them that way means the eye lands on new work first and
 * on the current row instantly, with everything already handled falling back.
 *
 * Inline, not Tailwind arbitrary values — see the note in `StageChrome`.
 */
const ROW_TONES = {
  selected: { background: "#c6e0dc", border: "#3f8f8a" },
  unopened: { background: "#e2f0ee", border: "#c9dedb" },
  opened: { background: "#fbfdfd", border: "#e6f1ef" },
} as const;

/**
 * @param workspaceRole Which product this is: the admin console or an
 *   employee's own pipeline. It decides the data scope, the chip set and which
 *   write actions are offered — see `CAPABILITIES` below.
 * @param basePath The route this workspace lives at, so the filter chips write
 *   back to the right URL.
 */
export function LeadsWorkspace({
  workspaceRole,
  basePath,
}: {
  workspaceRole: WorkspaceRole;
  basePath: string;
}) {
  const { role, user, loading: authLoading, getIdToken } = useAuth();
  useProtectedRoute([workspaceRole]);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Both managing roles get the roster control; a sub admin's copy of it is
  // scoped to their own team by the hook, not trimmed afterwards.
  const isManager = workspaceRole === "admin" || workspaceRole === "subadmin";
  const roleReady = role === workspaceRole;
  // Phones get the design's own leads screen, not this two-pane one squeezed.
  const isMobile = useIsMobile();

  // Admins read the whole pipeline; employees are scoped to their own uid, which
  // Security Rules enforce independently of anything this component does.
  const { leads, loading: leadsLoading, error: leadsError } = useLeads(
    roleReady ? workspaceRole : null,
    user?.uid
  );
  // The roster and campaign list are admin-only reads — requesting them as an
  // employee would just earn a permission-denied banner.
  const { employees, error: employeesError } = useEmployees(isManager && roleReady, {
    role: workspaceRole,
    uid: user?.uid,
  });

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Read state is per-person and per-browser — see the hook for why it is not
  // a field on the lead.
  const { isOpened, markOpened } = useOpenedLeads(user?.uid);
  const [assigningLead, setAssigningLead] = useState<Lead | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  // The URL is the single source of truth for the chip — derived, never mirrored
  // into local state. That keeps the retired routes' deep links, the back
  // button and a page refresh all consistent for free.
  const filter: LeadFilterKey = parseFilterParam(searchParams.get("filter"), workspaceRole);
  const chips = filterOrderFor(workspaceRole);
  const urgentChip = urgentFilterFor(workspaceRole);

  const selectFilter = (next: LeadFilterKey) => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (next === "ALL") params.delete("filter");
    else params.set("filter", next.toLowerCase());
    const qs = params.toString();
    router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  };

  /**
   * The roster is an admin-only read, so an employee has no names to look up —
   * but every lead they can see is their own, which is more useful to say than
   * a bare "Assigned".
   */
  const employeeName = (uid: string | null | undefined) => {
    if (!uid) return undefined;
    if (uid === user?.uid) return "You";
    return employees.find((e) => e.uid === uid)?.name;
  };

  // Resolving the Karachi day boundary does Intl formatting, which is far too
  // costly to repeat per row on every keystroke — so it is resolved once per
  // mount. A session left open across midnight keeps yesterday's boundary until
  // the next navigation, which is the right trade for a workday tool.
  const todayRange = useMemo(() => resolveRange("TODAY"), []);

  /** Search first; the chip counts describe what the current search matched. */
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((lead) =>
      [lead.name, lead.phone, lead.email, lead.city, lead.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [leads, query]);

  const counts = useMemo(
    () => countByFilter(searched, todayRange, workspaceRole),
    [searched, todayRange, workspaceRole]
  );

  const visible = useMemo(
    () => searched.filter((lead) => matchesLeadFilter(lead, filter, todayRange, workspaceRole)),
    [searched, filter, todayRange, workspaceRole]
  );

  // 15 rows a page. The panel is 372px wide, so a long roster otherwise builds
  // a scroll container hundreds of rows deep for a list nobody reads past the
  // first screen of.
  const leadPages = usePagination(visible, 15);

  // Always read the selected lead back out of the live array so Firestore
  // updates (status change, new follow-up) reach the open pane immediately.
  //
  // Resolved against every lead rather than the visible ones on purpose: when
  // you close a deal while the Active chip is up, the lead leaves the list but
  // the pane should stay open on its new deal record, not blank out mid-action.
  // A lead deleted upstream drops to null here on its own.
  const selected = selectedId ? (leads.find((l) => l.id === selectedId) ?? null) : null;

  if (isMobile) return <MobileLeads workspaceRole={workspaceRole} basePath={basePath} />;

  if (authLoading || leadsLoading) return <FullPageSpinner />;

  const showDetailOnMobile = selected !== null;

  return (
    // Full-bleed: cancels the <main> padding so the panes meet the chrome the
    // way they do in the design.
    <div className="leads-shell -m-6 grid grid-cols-1 overflow-hidden bg-[#e9f1f0] text-[#2b3a39] md:-m-8 lg:grid-cols-[372px_1fr]">
      {/* ================================================================= */}
      {/* Left — lead list                                                  */}
      {/* ================================================================= */}
      <section
        className={`min-w-0 flex-col border-r border-[#dceae8] bg-[#fbfdfd] ${
          showDetailOnMobile ? "hidden min-h-0 lg:flex" : "flex min-h-0"
        }`}
        aria-label="All leads"
      >
        {/*
          `min-h` matches the detail header's height (46px avatar + 2×16px
          padding) so the two teal bars form one continuous band across the top
          instead of stepping down at the divider.

          The explicit `text-white` on the <h1> is load-bearing: @layer base
          gives every heading its own `color`, and a colour set on the element
          beats the one inherited from this teal parent.
        */}
        <div className="flex min-h-[78px] shrink-0 items-center justify-between gap-3 bg-[#4f9c99] px-5 py-3.5 text-white">
          <h1 className="text-base font-medium tracking-[1.2px] text-white">ALL LEADS</h1>
          {/*
            Manual entry has moved to the Data Bank. This pipeline is now
            inbound work only — Meta Ads intake, plus anything promoted out of
            a cold list — so the button that used to seed it by hand points at
            where that job lives instead.
          */}
          {CAPABILITIES[workspaceRole].canCreateLead && (
            <Link
              href="/admin/data-bank"
              className="inline-flex items-center gap-1.5 rounded-full bg-white/15 py-1.5 pr-3.5 pl-3 text-[12.5px] text-white transition-colors hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Database size={13} />
              <span>Data Bank</span>
            </Link>
          )}
        </div>

        {/* Search — 16px / 18px / 10px, per the design */}
        <div className="flex shrink-0 items-center gap-2.5 px-[18px] pt-4 pb-2.5">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-[#dceae8] bg-[#eef5f4] px-3 py-2 focus-within:border-[#4f9c99] focus-within:ring-2 focus-within:ring-[#4f9c99]/15">
            <Search size={16} className="shrink-0 text-[#7e918f]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Data"
              aria-label="Search leads by name, phone, email, city or ID"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-[#2b3a39] outline-none placeholder:text-[#7e918f]"
            />
          </div>
          <div
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md border border-[#dceae8] bg-[#eef5f4] text-[#5b6d6b]"
            aria-hidden
          >
            <SlidersHorizontal size={17} />
          </div>
        </div>

        {/* Filter chips */}
        {/*
          The design carried four chips in this 372px panel; merging the routes
          makes five. Chips are tightened to fit one row at the design width,
          and `flex-wrap` guarantees that at any zoom or font size they wrap
          rather than clip — a filter the user cannot see is a filter that does
          not exist.
        */}
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 px-[18px] pt-1.5 pb-3.5"
          role="tablist"
          aria-label="Filter leads"
        >
          {chips.map((key) => {
            const active = key === filter;
            const count = counts[key];
            // The four pipeline stages are a different axis from the workflow
            // chips, so when
            // one is active it wears its own colour rather than the shared
            // teal — the list below is filtered by temperature, and the chip
            // row should say which kind of cut is in force.
            const tone = isStageFilter(key) ? STAGE_TONES[key] : null;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => selectFilter(key)}
                style={
                  active && tone
                    ? { background: tone.solid, borderColor: tone.solid, color: tone.onSolid }
                    : !active && tone
                      ? { color: tone.softText, borderColor: tone.softBorder }
                      : undefined
                }
                className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-2 text-[12.5px] transition-colors ${
                  active
                    ? "border-[#4f9c99] bg-[#4f9c99] text-white"
                    : "border-[#cfe2e0] bg-white text-[#5b6d6b] hover:border-[#8cc3bf]"
                }`}
              >
                {tone && isStageFilter(key) && <StageIcon stage={key} size={12} />}
                <span>{LEAD_FILTER_LABELS[key]}</span>
                {/* Only the action bucket is badged — awaiting-acceptance for
                    an employee. The admin row has no such chip since New was
                    removed, so `urgentChip` is null there. */}
                {key === urgentChip && count > 0 && (
                  <span className="absolute -top-2 -right-2 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[#e05a4a] px-1.5 text-[11px] text-white">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Errors */}
        {(leadsError || employeesError || banner) && (
          <div className="shrink-0 px-4 pb-2">
            {leadsError && <Banner tone="error" text={leadsError} />}
            {employeesError && <Banner tone="error" text={employeesError} />}
            {banner && <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />}
          </div>
        )}

        {/* Rows */}
        <div className="teal-scrollbar flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pb-5">
          {visible.length === 0 ? (
            <p className="px-3 py-10 text-center text-[13px] text-[#8fa2a0]">
              {query.trim()
                ? `No leads match “${query.trim()}”.`
                : "No leads in this filter yet."}
            </p>
          ) : (
            leadPages.items.map((lead, index) => {
              const active = lead.id === selectedId;
              const seen = isOpened(lead.id);
              const tone = ROW_TONES[active ? "selected" : seen ? "opened" : "unopened"];
              const stage = pipelineStage(lead);
              return (
                <button
                  key={lead.id}
                  onClick={() => {
                    setSelectedId(lead.id);
                    markOpened(lead.id);
                  }}
                  aria-current={active ? "true" : undefined}
                  style={{
                    // Stagger only the first screenful; beyond that the delay
                    // would outlast the scroll and rows would appear to lag.
                    animationDelay: `${Math.min(index, 12) * 35}ms`,
                    background: tone.background,
                    borderColor: tone.border,
                  }}
                  className="animate-lead-row grid w-full grid-cols-[44px_1fr_auto] items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors hover:border-[#8cc3bf]"
                >
                  <span
                    className="flex h-11 w-11 items-center justify-center rounded-full border-2 bg-white text-[13.5px] font-medium text-[#4a5c5a]"
                    style={{ borderColor: avatarRingColor(lead.status) }}
                    aria-hidden
                  >
                    {initialsOf(lead.name)}
                  </span>

                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {/* Shading alone would carry the read state on colour
                          only — this dot, and the text below it, give it a
                          second and a third form. */}
                      {!seen && !active && (
                        <span
                          className="h-[7px] w-[7px] shrink-0 rounded-full"
                          style={{ background: "#3f8f8a" }}
                          aria-hidden
                        />
                      )}
                      <span className="truncate text-sm font-medium text-[#2b3a39]">{lead.name}</span>
                      {!seen && !active && <span className="sr-only">(not opened yet)</span>}
                    </span>
                    {/*
                      The design shows the lead ID here. The status rides along
                      because the avatar ring encodes it as colour, and colour
                      must never be the only signal — and on a merged list the
                      stage is the whole point of the filter chips.
                    */}
                    <span className="mt-0.5 block truncate text-[11.5px] text-[#7e918f]">
                      {/* Full id, visually ellipsised — a hard slice would render a
                          plausible-but-wrong id that someone could quote. */}
                      {LEAD_STATUS_LABELS[lead.status] ?? lead.status} · {lead.id}
                    </span>
                    {/* The exact origin, folder and all (§1). On the row rather
                        than only in the detail pane, because "which list did
                        this come from" is a question asked while scanning the
                        list, not after opening one. */}
                    <span
                      className="mt-0.5 block truncate text-[11px] text-[#9aacaa]"
                      title={describeLeadSource(lead)}
                    >
                      {describeLeadSource(lead)}
                    </span>
                  </span>

                  <span className="flex flex-col items-end gap-1.5">
                    <span className="text-right text-[11.5px] leading-tight text-[#5b6d6b]">
                      {formatBusinessDateTime(lead.createdAt)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {stage.value && <StagePill stage={stage.value} manual={stage.manual} />}
                      <span
                        title={`${lead.followUpCount ?? 0} follow-ups logged`}
                        className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#4f9c99] px-1 text-[11px] text-white"
                      >
                        {lead.followUpCount ?? 0}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })
          )}

          <div className="px-1">
            <Pager pagination={leadPages} variant="web" noun="leads" />
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* Right — detail                                                    */}
      {/* ================================================================= */}
      <section
        className={`min-h-0 min-w-0 overflow-hidden ${showDetailOnMobile ? "block" : "hidden lg:block"}`}
        aria-label="Lead detail"
      >
        {selected ? (
          // Keying on the lead id remounts the pane per selection: tab, banner
          // and draft deal form reset themselves, and the slide-in animation
          // replays — all without a single synchronising effect.
          <LeadDetailPane
            key={selected.id}
            lead={selected}
            onClose={() => setSelectedId(null)}
            userRole={workspaceRole}
            getIdToken={getIdToken}
            assigneeName={employeeName(selected.assignedUserId)}
            onReassignRequest={
              CAPABILITIES[workspaceRole].canReassign ? () => setAssigningLead(selected) : undefined
            }
          />
        ) : (
          <WorkspaceEmpty label="Select a Lead from the List" />
        )}
      </section>

      {/* ================================================================= */}
      {/* Overlays                                                          */}
      {/* ================================================================= */}
      {assigningLead && CAPABILITIES[workspaceRole].canReassign && (
        <AssignModal
          lead={assigningLead}
          employees={employees}
          onClose={() => setAssigningLead(null)}
          getIdToken={getIdToken}
          runAction={async (fn, success) => {
            try {
              const res = await fn();
              if (res.ok) setBanner({ tone: "success", text: success });
              else setBanner({ tone: "error", text: res.error || "Failed." });
              return res.ok;
            } catch {
              setBanner({ tone: "error", text: "Network error." });
              return false;
            }
          }}
        />
      )}
    </div>
  );
}
