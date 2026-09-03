"use client";

/**
 * The phone leads pipeline, built to `Active Leads Mobile.dc.html`.
 *
 * The design's list is reproduced exactly — the pill search inside the teal
 * header, the horizontally scrolling chip row with a badge on the urgent one,
 * 20px cards on a `48px 1fr auto` grid, a 48px avatar ringed in the status
 * accent, the teal touch-count pill and the double chevron.
 *
 * Two departures, both deliberate:
 *
 * - The mockup's four chips (All / Today / Done / Overdue) are replaced by the
 *   app's real buckets from `lib/leadBuckets`, so the phone and the desktop
 *   filter the same pipeline by the same predicates. Inventing a second set
 *   would mean two definitions of "done" that could drift apart.
 * - Read-state shading rides along, because the same person uses both surfaces
 *   and a lead they opened on the desktop should not read as untouched here.
 */

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useLeads, type Lead } from "@/hooks/useLeads";
import { useEmployees } from "@/hooks/useEmployees";
import { useOpenedLeads } from "@/hooks/useOpenedLeads";
import { resolveRange } from "@/lib/dates";
import {
  LEAD_FILTER_LABELS,
  countByFilter,
  filterOrderFor,
  matchesLeadFilter,
  isStageFilter,
  parseFilterParam,
  urgentFilterFor,
  type LeadFilterKey,
  type WorkspaceRole,
} from "@/lib/leadBuckets";
import { initialsOf, avatarRingColor } from "@/lib/leadDisplay";
import { LEAD_STATUS_LABELS } from "@/lib/leadStatus";
import { pipelineStage, PIPELINE_STAGE_LABELS } from "@/lib/pipelineStage";
import { STAGE_TONES, StageIcon } from "@/components/leads/StageChrome";
import { AssignModal } from "@/components/admin/AssignModal";
import { M, HeaderCircle, MobileHeader } from "./mobileChrome";
import { AccountButton } from "./MobileAccount";
import { Pager } from "@/components/employees/DossierControls";
import { usePagination } from "@/hooks/usePagination";
import { useMobileCentre } from "./MobileShell";
import { MobileLeadDetail } from "./MobileLeadDetail";
import type { CentreAction } from "./MobileTabBar";
import type { LeadScope } from "@/components/leads/LeadsWorkspace";

/**
 * `30 Aug, 4:30 pm` — and the year only when it is not the current one.
 *
 * The design prints the full date, but its sample names are short ("newLead").
 * With a real name the `48px 1fr auto` grid gives the date whatever it asks
 * for and the name ellipsises to three characters, which is worse than losing
 * a year everybody already knows. A lead from a previous year keeps its year,
 * because that is the case where it carries information.
 */
function compactDate(value: { toDate?: () => Date } | Date | null | undefined): string {
  const date =
    value instanceof Date ? value : typeof value?.toDate === "function" ? value.toDate() : null;
  if (!date || Number.isNaN(date.getTime())) return "—";

  const thisYear = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", year: "numeric" }).format(
    new Date()
  );
  const year = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", year: "numeric" }).format(date);

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    day: "numeric",
    month: "short",
    ...(year === thisYear ? null : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(",", "")
    .replace(" am", " am")
    .replace(" pm", " pm");
}

/** Same three tones as the desktop list, so read state means one thing. */
const ROW_TONES = {
  selected: { background: "#c6e0dc", border: M.teal },
  unopened: { background: "#e2f0ee", border: "#c9dedb" },
  opened: { background: M.cardBg, border: M.cardBorder },
} as const;

/**
 * The phone leads screen.
 *
 * Takes the same optional `scope` the desktop workspace does, so a Client
 * folder on a phone is this screen restricted to the folder — not a
 * separate list with a separate detail view.
 */
export function MobileLeads({
  workspaceRole,
  basePath,
  scope,
}: {
  workspaceRole: WorkspaceRole;
  basePath: string;
  scope?: LeadScope;
}) {
  const { user, role, getIdToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAdmin = workspaceRole === "admin";
  // The employee's name for a row. `assigneeName` is denormalised onto the lead
  // at assignment; the roster is the fallback for leads assigned before it was.
  const assigneeName = (lead: Lead) =>
    lead.assigneeName ??
    employees.find((employee) => employee.uid === lead.assignedUserId)?.name ??
    null;
  // Both managing roles get the roster and the reassign control; a sub admin's
  // copy is scoped to their own team by the hook, not trimmed afterwards.
  const isManager = workspaceRole === "admin" || workspaceRole === "subadmin";
  const roleReady = role === workspaceRole;

  const { leads: allLeads, loading, error } = useLeads(roleReady ? workspaceRole : null, user?.uid);
  // Scoped to the folder when there is one, before anything else reads it.
  const leads = useMemo(
    () => (scope ? allLeads.filter((lead) => scope.leadIds.has(lead.id)) : allLeads),
    [allLeads, scope]
  );
  const { employees } = useEmployees(isManager && roleReady, {
    role: workspaceRole,
    uid: user?.uid,
  });
  const { isOpened, markOpened } = useOpenedLeads(user?.uid);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<Lead | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

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

  // Resolved once: the Karachi day boundary costs Intl formatting, far too
  // much to repeat per row on every keystroke.
  const todayRange = useMemo(() => resolveRange("TODAY"), []);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((lead) =>
      [lead.name, lead.phone, lead.email, lead.city, lead.id].filter(Boolean).join(" ").toLowerCase().includes(q)
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

  // 12 rows a page: enough that scrolling still feels like a list rather than a
  // deck of cards, few enough that a slow phone is not laying out 400 rows.
  const leadPages = usePagination(visible, 12);

  // Always read back out of the live array, so a status change lands in the
  // open detail immediately.
  const selected = selectedId ? (leads.find((l) => l.id === selectedId) ?? null) : null;

  const employeeName = (uid: string | null | undefined) => {
    if (!uid) return undefined;
    if (uid === user?.uid) return "You";
    return employees.find((e) => e.uid === uid)?.name;
  };

  // Manual entry has moved to the Data Bank, so the centre slot no longer adds
  // a lead. Both roles now get the same action: dial whoever is on the
  // acceptance clock, and nothing at all when there is no one — an empty slot
  // beats a button that does not belong on this screen any more.
  const pendingPhone = leads.find((l) => l.status === "ASSIGNED")?.phone;
  const centre = useMemo<CentreAction>(
    () => (pendingPhone ? { kind: "call", href: `tel:${pendingPhone}` } : null),
    [pendingPhone]
  );
  useMobileCentre(centre);

  return (
    <>
      <MobileHeader>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: "1.4px",
                textTransform: "uppercase",
                opacity: 0.78,
              }}
            >
              Pipeline
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.7px", marginTop: 2, color: "#fff" }}>
              {isAdmin ? "All Leads" : workspaceRole === "subadmin" ? "Team Leads" : "My Leads"}
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <HeaderCircle label="Filters" onClick={() => selectFilter("ALL")}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M4 7h16M7 12h10M10 17h4" />
              </svg>
            </HeaderCircle>
            <AccountButton />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            marginTop: 16,
            padding: "11px 15px",
            borderRadius: 999,
            background: M.searchBg,
            border: `1px solid ${M.searchBorder}`,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone or ID"
            aria-label="Search leads"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 13.5,
              fontWeight: 500,
              color: "#fff",
            }}
          />
        </div>
      </MobileHeader>

      {/* Chips — horizontally scrollable, since the real set is six wide. */}
      <div
        role="tablist"
        aria-label="Filter leads"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "14px 18px 10px",
          overflowX: "auto",
          overscrollBehavior: "contain",
          flexShrink: 0,
          scrollbarWidth: "none",
        }}
      >
        {chips.map((key) => {
          const active = key === filter;
          const tone = isStageFilter(key) ? STAGE_TONES[key] : null;
          const badge = key === urgentChip ? counts[key] : 0;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              onClick={() => selectFilter(key)}
              className="mob-press"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                flexShrink: 0,
                padding: "9px 17px",
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
                border: `1px solid ${active ? (tone ? tone.solid : M.teal) : tone ? tone.softBorder : M.cardBorder}`,
                background: active ? (tone ? tone.solid : M.teal) : M.cardBg,
                color: active ? "#fff" : tone ? tone.softText : M.muted,
                transition: "background-color 160ms ease, color 160ms ease, border-color 160ms ease",
              }}
            >
              {tone && isStageFilter(key) && <StageIcon stage={key} size={12} />}
              <span>{LEAD_FILTER_LABELS[key]}</span>
              {badge > 0 && (
                <span
                  style={{
                    minWidth: 19,
                    padding: "1px 6px",
                    borderRadius: 999,
                    fontSize: 10.5,
                    fontWeight: 700,
                    textAlign: "center",
                    background: active ? "rgba(255,255,255,0.28)" : M.redSoft,
                    color: "#fff",
                  }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div
        style={{
          minHeight: 0,
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          padding: "2px 18px calc(env(safe-area-inset-bottom, 0px) + 18px)",
          display: "flex",
          flexDirection: "column",
          gap: 11,
        }}
      >
        {banner && (
          <div
            role="status"
            style={{
              borderRadius: M.rowRadius,
              border: "1px solid #bfe0dc",
              background: "#eef8f7",
              color: M.tealDeep,
              padding: "11px 13px",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            {banner}
          </div>
        )}
        {error && (
          <div
            role="alert"
            style={{
              borderRadius: M.rowRadius,
              border: "1px solid #f0c4bd",
              background: "#fdeeeb",
              color: "#a33a29",
              padding: "11px 13px",
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.45,
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <SkeletonRows />
        ) : visible.length === 0 ? (
          <div
            style={{
              padding: "46px 12px",
              textAlign: "center",
              fontSize: 13.5,
              fontWeight: 500,
              color: M.faint,
              lineHeight: 1.5,
            }}
          >
            {query.trim() ? `No leads match “${query.trim()}”.` : "No leads in this filter."}
          </div>
        ) : (
          leadPages.items.map((lead, index) => {
            const seen = isOpened(lead.id);
            const tone = ROW_TONES[seen ? "opened" : "unopened"];
            const accent = avatarRingColor(lead.status);
            const stage = pipelineStage(lead);
            return (
              <button
                key={lead.id}
                className="mob-press"
                onClick={() => {
                  setSelectedId(lead.id);
                  markOpened(lead.id);
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "48px minmax(0,1fr) auto",
                  alignItems: "center",
                  gap: 13,
                  background: tone.background,
                  border: `1px solid ${tone.border}`,
                  borderRadius: M.cardRadius,
                  padding: "14px 16px",
                  textAlign: "left",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                  // Only the first screenful is staggered; beyond that the
                  // delay would outlast the scroll and rows would look laggy.
                  animation:
                    index < 8
                      ? `mob-rise 300ms cubic-bezier(0.22,0.61,0.36,1) ${index * 32}ms both`
                      : undefined,
                }}
              >
                <span
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "#fff",
                    border: `2px solid ${accent}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: "0.2px",
                    color: "#4a5c5a",
                    flexShrink: 0,
                  }}
                  aria-hidden
                >
                  {initialsOf(lead.name)}
                </span>

                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      minWidth: 0,
                    }}
                  >
                    {!seen && (
                      <span
                        style={{ width: 7, height: 7, borderRadius: "50%", background: M.teal, flexShrink: 0 }}
                        aria-hidden
                      />
                    )}
                    <span
                      style={{
                        fontSize: 15.5,
                        fontWeight: 700,
                        letterSpacing: "-0.35px",
                        color: M.ink,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {lead.name}
                    </span>
                    {!seen && <span className="sr-only">(not opened yet)</span>}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: accent, flexShrink: 0 }}>
                      {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "#a0b2b0", flexShrink: 0 }}>·</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: M.faint,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {/* §8 — the assignee takes the number's place. Knowing
                          who is on a lead is the question asked while scanning
                          a list; the number is one tap away in the detail, and
                          is still there in full. */}
                      {assigneeName(lead) ?? "Unassigned"}
                    </span>
                  </span>
                </span>

                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7, flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: M.fainter,
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {compactDate(lead.createdAt)}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    {stage.value && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          padding: "2px 7px",
                          borderRadius: 999,
                          border: `1px solid ${STAGE_TONES[stage.value].softBorder}`,
                          background: STAGE_TONES[stage.value].soft,
                          color: STAGE_TONES[stage.value].softText,
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        <StageIcon stage={stage.value} size={9} />
                        {PIPELINE_STAGE_LABELS[stage.value]}
                      </span>
                    )}
                    <span
                      style={{
                        minWidth: 22,
                        height: 22,
                        padding: "0 6px",
                        borderRadius: 999,
                        background: M.teal,
                        color: "#fff",
                        fontSize: 11.5,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title={`${lead.followUpCount ?? 0} follow-ups`}
                    >
                      {lead.followUpCount ?? 0}
                    </span>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={M.teal} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="m6 6 6 6-6 6M14 6l6 6-6 6" />
                    </svg>
                  </span>
                </span>
              </button>
            );
          })
        )}

        <Pager pagination={leadPages} variant="mobile" noun="leads" />
      </div>

      {selected && (
        <MobileLeadDetail
          key={selected.id}
          lead={selected}
          userRole={workspaceRole}
          getIdToken={getIdToken}
          assigneeName={employeeName(selected.assignedUserId)}
          onClose={() => setSelectedId(null)}
          onReassign={isManager ? () => setAssigning(selected) : undefined}
        />
      )}


      {assigning && isManager && (
        <AssignModal
          lead={assigning}
          employees={employees}
          onClose={() => setAssigning(null)}
          getIdToken={getIdToken}
          runAction={async (fn, success) => {
            try {
              const res = await fn();
              if (res.ok) setBanner(success);
              return res.ok;
            } catch {
              return false;
            }
          }}
        />
      )}
    </>
  );
}

/**
 * Placeholder rows while the first snapshot lands.
 *
 * A skeleton rather than a spinner because the list's shape is known — the
 * screen does not jump when the data arrives, which is what makes a slow
 * connection feel fast rather than broken. Opacity only, so it costs nothing.
 */
function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          aria-hidden
          style={{
            display: "grid",
            gridTemplateColumns: "48px 1fr",
            alignItems: "center",
            gap: 13,
            background: M.cardBg,
            border: `1px solid ${M.cardBorder}`,
            borderRadius: M.cardRadius,
            padding: "14px 16px",
            opacity: 0.55,
            animation: `mob-fade 260ms ease ${i * 60}ms both`,
          }}
        >
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: M.track }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ height: 12, width: "58%", borderRadius: 6, background: M.track }} />
            <div style={{ height: 10, width: "40%", borderRadius: 5, background: M.trackFlat }} />
          </div>
        </div>
      ))}
    </>
  );
}
