"use client";

/**
 * One Meta campaign's leads, for the person who holds them — the admin's
 * folder screen, as that person sees it.
 *
 * **The admin's layout, not a lookalike.** Same 78px teal band, search row,
 * pill tabs, `AssignedLeadRow` rows with read-state shading, and the same
 * `LeadDetailPane` on the right, so an employee reading a lead from a campaign
 * reads it exactly as the admin does. On the phone the list stands alone and a
 * lead opens `MobileLeadDetail`, as it does from the leads tab.
 *
 * **No reassign, anywhere.** No selection boxes, no reassign bar, and the pane
 * is given no reassign handler. The admin and a manager move leads from the
 * folder itself; the person holding a lead works it.
 *
 * The rows are the person's own leads whose folder is this one, from
 * `useLeads` — `dataBankFolders` are managing-roles-only, so the folder is
 * identified by the id the leads carry rather than read.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLeads, type Lead } from "@/hooks/useLeads";
import { useOpenedLeads } from "@/hooks/useOpenedLeads";
import { usePagination } from "@/hooks/usePagination";
import { timestampMillis } from "@/lib/dates";
import { statusLabel } from "@/lib/leadStatus";
import { groupMetaLeads, isMetaLead, metaFolderOf } from "@/lib/metaLeadGroups";
import { FullPageSpinner, Banner } from "@/components/admin/AdminShared";
import { Pager } from "@/components/employees/DossierControls";
import { LeadDetailPane } from "@/components/leads/LeadDetailPane";
import { WorkspaceEmpty } from "@/components/leads/WorkspaceEmpty";
import { MobileLeadDetail } from "@/components/mobile/MobileLeadDetail";
import { AssignedLeadRow, type RowChip } from "@/components/dataBank/AssignedLeadRow";

type View = "ALL" | "WAITING" | "TAKEN";

const PAGE_SIZE = 15;

/** Waiting reads amber — it has a clock on it; everything else reads as the folder's teal. */
function chipFor(lead: Lead): RowChip {
  return lead.status === "ASSIGNED"
    ? { text: "Waiting for you", background: "#fdf3e3", color: "#8a6321" }
    : { text: statusLabel(lead.status), background: "#e8f5f3", color: "#2f7d78" };
}

export function MetaLeadsFolder({ folderId }: { folderId: string }) {
  const { user, role, getIdToken } = useAuth();
  useProtectedRoute(["employee", "subadmin"]);
  const isMobile = useIsMobile();
  const basePath = role === "subadmin" ? "/subadmin" : "/employee";
  const paneRole = role === "subadmin" ? "subadmin" : "employee";

  const { leads, loading, error } = useLeads(
    role === "employee" || role === "subadmin" ? role : null,
    user?.uid
  );
  const { isOpened, markOpened } = useOpenedLeads(user?.uid);

  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const inFolder = useMemo(
    () =>
      leads
        .filter(
          (lead) => lead.assignedUserId === user?.uid && isMetaLead(lead) && metaFolderOf(lead) === folderId
        )
        .sort((a, b) => (timestampMillis(b.createdAt) ?? 0) - (timestampMillis(a.createdAt) ?? 0)),
    [leads, user?.uid, folderId]
  );
  const summary = useMemo(
    () => groupMetaLeads(inFolder, (lead) => timestampMillis(lead.createdAt))[0] ?? null,
    [inFolder]
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return inFolder.filter((lead) => {
      if (view === "WAITING" && lead.status !== "ASSIGNED") return false;
      if (view === "TAKEN" && lead.status === "ASSIGNED") return false;
      if (!needle) return true;
      return (
        (lead.name ?? "").toLowerCase().includes(needle) ||
        (digits.length >= 3 && (lead.phone ?? "").replace(/\D/g, "").includes(digits))
      );
    });
  }, [inFolder, view, query]);
  const pages = usePagination(visible, PAGE_SIZE);

  // Resolved against the live list, so a status changed in the pane shows behind it.
  const selected = selectedId ? (inFolder.find((lead) => lead.id === selectedId) ?? null) : null;

  if (loading) return <FullPageSpinner />;

  const name = summary?.name ?? "Meta Ads";
  const waiting = summary?.waiting ?? 0;
  const tabs: Array<[View, string, number]> = [
    ["ALL", "All", inFolder.length],
    ["WAITING", "Waiting", waiting],
    ["TAKEN", "Yours", summary?.taken ?? 0],
  ];

  const list = (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-[#dceae8] bg-[#fbfdfd]"
      aria-label={`${name} leads`}
      style={isMobile ? { borderRight: "none", borderRadius: 16, overflow: "hidden" } : undefined}
    >
      {/* Same 78px teal band as the admin's folder. `text-white` on the <h1> is
          load-bearing: @layer base gives every heading its own colour. */}
      <div className="flex min-h-[78px] shrink-0 items-center justify-between gap-3 bg-[#4f9c99] px-5 py-3.5 text-white">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href={`${basePath}/meta-leads`}
            aria-label="Back to Meta Leads"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/20"
          >
            <ArrowLeft size={17} />
          </Link>
          <div className="min-w-0">
            <h1
              title={name}
              className="text-[15px] font-medium tracking-[0.9px] text-white uppercase"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                lineHeight: 1.15,
              }}
            >
              {name}
            </h1>
            <div className="text-[11.5px] tabular-nums text-white/80">
              {inFolder.length.toLocaleString()} lead{inFolder.length === 1 ? "" : "s"} ·{" "}
              {waiting.toLocaleString()} waiting for you
            </div>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2.5 px-[18px] pt-4 pb-2.5">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-[#dceae8] bg-[#eef5f4] px-3 py-2 focus-within:border-[#4f9c99]">
          <Search size={16} className="shrink-0 text-[#7e918f]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search leads"
            aria-label="Search this campaign's leads by name or phone number"
            className="min-w-0 flex-1 bg-transparent text-[#2b3a39] outline-none placeholder:text-[#7e918f]"
            // 16 on the phone, or iOS Safari zooms on focus.
            style={{ fontSize: isMobile ? 16 : 13.5 }}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 px-[18px] pt-1.5 pb-3.5" role="tablist" aria-label="Filter leads">
        {tabs.map(([key, label, count]) => {
          const active = view === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              onClick={() => setView(key)}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full border px-3 py-2 text-[12.5px] transition-colors ${
                active
                  ? "border-[#2f7d78] bg-[#2f7d78] text-white"
                  : "border-[#cfe2e0] bg-white text-[#5b6d6b] hover:border-[#8cc3bf]"
              }`}
            >
              <span>{label}</span>
              <span
                className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                  active ? "bg-white/20 text-white" : "bg-[#eef5f4] text-[#5b6d6b]"
                }`}
              >
                {count.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="shrink-0 px-4 pb-2">
          <Banner tone="error" text={error} />
        </div>
      )}

      <div className="teal-scrollbar flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pb-5">
        {visible.length === 0 ? (
          <p className="px-3 py-10 text-center text-[13px] text-[#8fa2a0]">
            {query.trim()
              ? `Nothing matches “${query.trim()}”.`
              : inFolder.length === 0
                ? "You hold no leads from this campaign."
                : "Nothing in this filter."}
          </p>
        ) : (
          pages.items.map((lead, index) => (
            <AssignedLeadRow
              key={lead.id}
              name={lead.name || "Unnamed lead"}
              phone={lead.phone}
              kindLabel="Lead"
              ringColor={lead.status === "ASSIGNED" ? "#c9973a" : "#2f7d78"}
              chip={chipFor(lead)}
              active={lead.id === selectedId}
              seen={isOpened(lead.id)}
              index={index}
              onClick={() => {
                setSelectedId(lead.id);
                markOpened(lead.id);
              }}
            />
          ))
        )}
        <div className="px-1">
          <Pager pagination={pages} variant={isMobile ? "mobile" : "web"} noun="leads" />
        </div>
      </div>
    </section>
  );

  if (isMobile) {
    return (
      <>
        {list}
        {selected && (
          <MobileLeadDetail
            key={selected.id}
            lead={selected}
            userRole={paneRole}
            getIdToken={getIdToken}
            onClose={() => setSelectedId(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className="leads-shell -m-6 grid grid-cols-1 overflow-hidden bg-[#e9f1f0] text-[#2b3a39] md:-m-8 lg:grid-cols-[372px_1fr]">
      <div className={`min-h-0 min-w-0 ${selected ? "hidden lg:flex" : "flex"} flex-col`}>{list}</div>
      <section
        className={`min-h-0 min-w-0 overflow-hidden ${selected ? "block" : "hidden lg:block"}`}
        aria-label="Lead detail"
      >
        {selected ? (
          <LeadDetailPane
            key={selected.id}
            lead={selected}
            onClose={() => setSelectedId(null)}
            userRole={paneRole}
            getIdToken={getIdToken}
          />
        ) : (
          <WorkspaceEmpty label="Select a Lead from the List" hint="Your leads from this campaign open here, to call and log." />
        )}
      </section>
    </div>
  );
}
