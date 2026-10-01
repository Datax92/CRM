"use client";

/**
 * Reassign leads — one person's open leads, picked from a list.
 *
 * The owner's instruction (2026-10-01), replacing a panel that took a number
 * per recipient: *"it should open up like the [Data Bank folder] and from there
 * we can select leads like all the leads or only some in bulk."* So this is
 * that screen about a person instead of a folder: the same shell, the same
 * `AssignedLeadRow` with a tick box beside it, the same `ReassignBar` (quick
 * picks, Assign-to, the button) and the same `LeadDetailPane` on the right, so
 * a lead can be read in full before deciding who gets it.
 *
 * **Nothing is copied and nothing is lost.** `assignLeadsBulk` moves the
 * assignment; the lead keeps its id, remarks, follow-ups, status, KYC and
 * audit trail, and the trail gains a line naming who it came from.
 *
 * Only open leads are listed. A closed lead is history and the server will not
 * move one, so offering it a tick box would be offering a refusal.
 *
 * A quick pick takes from the **whole filtered list**, not the page on screen:
 * "100" has to mean a hundred of this person's leads, and All every one.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEmployees, useSubAdmins } from "@/hooks/useEmployees";
import { useLeads } from "@/hooks/useLeads";
import { useOpenedLeads } from "@/hooks/useOpenedLeads";
import { usePagination } from "@/hooks/usePagination";
import { buildAssignOptions } from "@/lib/assignTargets";
import { isTerminal, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/leadStatus";
import { describeLeadSource } from "@/lib/leadSource";
import { matchesAssignedSearch, type AssignedItem } from "@/lib/dataBankAssigned";
import { Banner, FullPageSpinner } from "@/components/admin/AdminShared";
import { LeadDetailPane } from "@/components/leads/LeadDetailPane";
import { MobileLeadDetail } from "@/components/mobile/MobileLeadDetail";
import { MobileSheetFrame } from "@/components/mobile/MobileSheetFrame";
import { WorkspaceEmpty } from "@/components/leads/WorkspaceEmpty";
import { LeadWindowNotice } from "@/components/leads/LeadWindowNotice";
import { Pager } from "@/components/employees/DossierControls";
import { AssignedLeadRow } from "@/components/dataBank/AssignedLeadRow";
import { ReassignBar } from "@/components/dataBank/ReassignBar";

const DIRECTORY = "/admin/employees/directory";
const PER_PAGE = 50;

/** Whether anybody has written on the lead yet — the cut worth making before handing it on. */
type Cut = "ALL" | "UNTOUCHED" | "WORKED";
const CUT_LABELS: Record<Cut, string> = {
  ALL: "All",
  UNTOUCHED: "Not contacted",
  WORKED: "Contacted",
};

function millis(value: { toMillis?: () => number } | null | undefined): number {
  return value?.toMillis?.() ?? 0;
}

export function ReassignWorkspace({ uid }: { uid: string }) {
  const { user, role, loading: authLoading, getIdToken } = useAuth();
  const isMobile = useIsMobile();
  const ready = role === "admin";

  const { employees, loading: employeesLoading } = useEmployees(ready);
  const { subAdmins } = useSubAdmins(ready);
  const { leads, loading: leadsLoading, truncated } = useLeads(ready ? "admin" : null, user?.uid);
  const { isOpened, markOpened } = useOpenedLeads(user?.uid);

  const [query, setQuery] = useState("");
  const [cut, setCut] = useState<Cut>("ALL");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const source = useMemo(
    () => [...employees, ...subAdmins].find((person) => person.uid === uid) ?? null,
    [employees, subAdmins, uid]
  );
  const sourceName = source?.name ?? "This person";

  /** Everything they hold, newest first; `open` is the part that can move. */
  const held = useMemo(
    () =>
      leads
        .filter((lead) => lead.assignedUserId === uid)
        .sort((a, b) => millis(b.createdAt) - millis(a.createdAt) || a.id.localeCompare(b.id)),
    [leads, uid]
  );
  const open = useMemo(() => held.filter((lead) => !isTerminal(lead.status)), [held]);
  const byId = useMemo(() => new Map(open.map((lead) => [lead.id, lead])), [open]);

  /** The rows in the shape `ReassignBar` sends to the server — every one a lead. */
  const items = useMemo<AssignedItem[]>(
    () =>
      open.map((lead) => ({
        id: lead.id,
        kind: "LEAD",
        name: lead.name ?? "Unnamed lead",
        phone: lead.phone ?? "",
        assigneeUid: uid,
        assigneeName: sourceName,
        at: millis(lead.createdAt),
      })),
    [open, uid, sourceName]
  );

  const visible = useMemo(
    () =>
      items.filter((item) => {
        const worked = (byId.get(item.id)?.followUpCount ?? 0) > 0;
        if (cut === "UNTOUCHED" && worked) return false;
        if (cut === "WORKED" && !worked) return false;
        return matchesAssignedSearch(item, query);
      }),
    [items, byId, cut, query]
  );
  const pages = usePagination(visible, PER_PAGE);

  /** Everybody working, and the admin themselves — never the person being emptied. */
  const options = useMemo(
    () =>
      buildAssignOptions([...employees, ...subAdmins], {
        uid: user?.uid ?? "",
        name: "Me",
        role: role ?? null,
      }).filter((option) => option.uid !== uid),
    [employees, subAdmins, user?.uid, role, uid]
  );

  // A lead that has just been moved leaves `open`, so its tick goes with it.
  const selected = items.filter((item) => picked.has(item.id));
  const openLead = openId ? (byId.get(openId) ?? null) : null;
  const counts: Record<Cut, number> = {
    ALL: items.length,
    UNTOUCHED: items.filter((item) => (byId.get(item.id)?.followUpCount ?? 0) === 0).length,
    WORKED: items.filter((item) => (byId.get(item.id)?.followUpCount ?? 0) > 0).length,
  };

  if (authLoading || !ready || employeesLoading || leadsLoading) return <FullPageSpinner />;

  const take = (n: number) => {
    const ids = visible.slice(0, n).map((item) => item.id);
    setPicked(new Set(ids));
    return ids.length;
  };

  const header = (
    <div className="flex min-h-[78px] shrink-0 items-center gap-2.5 bg-[#4f9c99] px-5 py-3.5 text-white">
      <Link
        href={DIRECTORY}
        aria-label="Back to the directory"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/20"
        // Inline, not inherited: the global link colour is the band's own teal,
        // and beats the white this bar sets on its container — the arrow was
        // drawn and could not be seen.
        style={{ color: "#fff" }}
      >
        <ArrowLeft size={17} />
      </Link>
      <div className="min-w-0">
        <h1
          title={`Reassign ${sourceName}'s leads`}
          className="text-[15px] font-medium tracking-[0.9px] text-white uppercase"
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.15 }}
        >
          {sourceName} — reassign leads
        </h1>
        <div className="text-[11.5px] tabular-nums text-white/80">
          {open.length.toLocaleString()} open · {(held.length - open.length).toLocaleString()} closed, staying on their record
        </div>
      </div>
    </div>
  );

  const controls = (
    <>
      <div className="flex shrink-0 items-center gap-2.5 px-[18px] pt-4 pb-2.5">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-[#dceae8] bg-[#eef5f4] px-3 py-2 focus-within:border-[#4f9c99] focus-within:ring-2 focus-within:ring-[#4f9c99]/15">
          <Search size={16} className="shrink-0 text-[#7e918f]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search leads"
            aria-label="Search these leads by name or phone number"
            className="min-w-0 flex-1 bg-transparent text-[#2b3a39] outline-none placeholder:text-[#7e918f]"
            // 16px on the phone, or iOS Safari zooms the page on focus.
            style={{ fontSize: isMobile ? 16 : 13.5 }}
          />
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 px-[18px] pt-1 pb-3" role="tablist" aria-label="Filter leads">
        {(Object.keys(CUT_LABELS) as Cut[]).map((key) => {
          const active = cut === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              onClick={() => setCut(key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-2 text-[12.5px] transition-colors ${
                active
                  ? "border-[#4f9c99] bg-[#4f9c99] text-white"
                  : "border-[#cfe2e0] bg-white text-[#5b6d6b] hover:border-[#8cc3bf]"
              }`}
            >
              <span>{CUT_LABELS[key]}</span>
              <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${active ? "bg-white/20 text-white" : "bg-[#eef5f4] text-[#5b6d6b]"}`}>
                {counts[key].toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {(banner || truncated) && (
        <div className="shrink-0 px-4 pb-2">
          {truncated && <LeadWindowNotice subject="This list" />}
          {banner && <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />}
        </div>
      )}

      <div className="shrink-0 px-3.5 pb-2.5">
        <ReassignBar
          selected={selected}
          available={visible.length}
          options={options}
          getIdToken={getIdToken}
          onSelectCount={take}
          onSelectAll={() => take(visible.length)}
          onClear={() => setPicked(new Set())}
          onDone={(message) => {
            setPicked(new Set());
            setOpenId(null);
            setBanner({ tone: "success", text: message });
          }}
          compact={isMobile}
        />
      </div>
    </>
  );

  const rows = (
    <>
      {visible.length === 0 ? (
        <p className="px-3 py-10 text-center text-[13px] text-[#8fa2a0]">
          {items.length === 0
            ? `${sourceName} holds no open leads.`
            : query.trim()
              ? `Nothing matches “${query.trim()}”.`
              : "No leads in this filter."}
        </p>
      ) : (
        pages.items.map((item, index) => {
          const lead = byId.get(item.id)!;
          return (
            // The row is `flex-1`; without this wrapper it grows to the list's
            // full height. The tick sits outside the row button so ticking does
            // not also open the lead.
            <div key={item.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={picked.has(item.id)}
                aria-label={`Select ${item.name}`}
                onChange={() =>
                  setPicked((current) => {
                    const next = new Set(current);
                    if (!next.delete(item.id)) next.add(item.id);
                    return next;
                  })
                }
                className="h-4 w-4 shrink-0 accent-[#2f7d78]"
              />
              <AssignedLeadRow
                name={item.name}
                phone={item.phone}
                kindLabel={describeLeadSource(lead)}
                ringColor="#2f7d78"
                chip={{
                  text: LEAD_STATUS_LABELS[lead.status as LeadStatus] ?? lead.status,
                  background: "#e8f5f3",
                  color: "#2f7d78",
                }}
                active={item.id === openId}
                seen={isOpened(item.id)}
                index={index}
                onClick={() => {
                  setOpenId(item.id);
                  markOpened(item.id);
                }}
              />
            </div>
          );
        })
      )}
      <div className="px-1">
        <Pager pagination={pages} variant={isMobile ? "mobile" : "web"} noun="leads" />
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div className="flex flex-col bg-[#fbfdfd] text-[#2b3a39]" style={{ margin: -16, minHeight: "100%" }}>
        {header}
        {controls}
        <div className="flex flex-col gap-2.5 px-3.5 pb-6">{rows}</div>
        {/* Full-screen, not inset in the page — see `MobileSheetFrame`. */}
        {openLead && (
          <MobileSheetFrame>
            <MobileLeadDetail
              key={openLead.id}
              lead={openLead}
              onClose={() => setOpenId(null)}
              userRole="admin"
              getIdToken={getIdToken}
              assigneeName={sourceName}
            />
          </MobileSheetFrame>
        )}
      </div>
    );
  }

  return (
    <div className="leads-shell -m-6 grid grid-cols-1 overflow-hidden bg-[#e9f1f0] text-[#2b3a39] md:-m-8 lg:grid-cols-[372px_1fr]">
      <section
        className={`min-w-0 flex-col border-r border-[#dceae8] bg-[#fbfdfd] ${
          openLead ? "hidden min-h-0 lg:flex" : "flex min-h-0"
        }`}
        aria-label={`${sourceName}'s open leads`}
      >
        {header}
        {controls}
        <div className="teal-scrollbar flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pb-5">{rows}</div>
      </section>

      <section
        className={`min-h-0 min-w-0 overflow-hidden ${openLead ? "block" : "hidden lg:block"}`}
        aria-label="Lead detail"
      >
        {openLead ? (
          <LeadDetailPane
            key={openLead.id}
            lead={openLead}
            onClose={() => setOpenId(null)}
            userRole="admin"
            getIdToken={getIdToken}
            assigneeName={sourceName}
          />
        ) : (
          <WorkspaceEmpty
            label="Select a Lead from the List"
            hint="Tick the leads to move, choose who gets them, and press Reassign. Each lead keeps its remarks, follow-ups and history."
          />
        )}
      </section>
    </div>
  );
}
