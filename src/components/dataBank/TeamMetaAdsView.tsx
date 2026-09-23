"use client";

/**
 * A manager's Meta Ads — every Facebook lead their team holds, one card per
 * campaign, laid out exactly as the admin's Meta Ads (owner, 2026-09-23).
 *
 * **Built from the team's leads, not from the folders.** The campaign folders
 * belong to the admin and a manager's folder query is `subAdminUid == me`, so
 * the admin's screen rendered for a manager with nothing in it. A manager's
 * `useLeads` already returns their team's leads and their own, each carrying
 * the folder id it came from, so the cards are grouped by that id
 * (`lib/metaLeadGroups`) — the same folder the admin opens, keyed the same way.
 *
 * **Meta Ads is the team; Meta Leads is the manager's own.** Opening a card
 * goes to `/subadmin/meta-ads/{folderId}`, the admin's folder list with each
 * row naming who holds the lead.
 */

import { useMemo, useState } from "react";
import { Megaphone, Radio } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLeads } from "@/hooks/useLeads";
import { timestampMillis } from "@/lib/dates";
import { groupMetaLeads, isMetaLead, metaFolderOf } from "@/lib/metaLeadGroups";
import { FullPageSpinner, Banner } from "@/components/admin/AdminShared";
import { LeadWindowNotice } from "@/components/leads/LeadWindowNotice";
import { MetaCampaignCard } from "./MetaCampaignCard";

export function TeamMetaAdsView() {
  const { user, role } = useAuth();
  useProtectedRoute(["subadmin"]);
  const isMobile = useIsMobile();

  const { leads, loading, error, truncated } = useLeads(role === "subadmin" ? "subadmin" : null, user?.uid);
  const [search, setSearch] = useState("");

  const teamMeta = useMemo(() => leads.filter(isMetaLead), [leads]);
  const groups = useMemo(() => groupMetaLeads(teamMeta, (lead) => timestampMillis(lead.createdAt)), [teamMeta]);

  /** How many people hold leads in each campaign — the card's third figure. */
  const peopleByFolder = useMemo(() => {
    const people = new Map<string, Set<string>>();
    for (const lead of teamMeta) {
      const folderId = metaFolderOf(lead);
      const holders = people.get(folderId) ?? new Set<string>();
      if (lead.assignedUserId) holders.add(lead.assignedUserId);
      people.set(folderId, holders);
    }
    return people;
  }, [teamMeta]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? groups.filter((group) => group.name.toLowerCase().includes(needle)) : groups;
  }, [groups, search]);

  const totals = useMemo(
    () => ({
      waiting: groups.reduce((sum, group) => sum + group.waiting, 0),
      taken: groups.reduce((sum, group) => sum + group.taken, 0),
    }),
    [groups]
  );

  if (loading) return <FullPageSpinner />;

  return (
    <div
      className="-m-6 min-h-full bg-[#e9f1f0] px-6 py-6 text-[#2b3a39] md:-m-8 md:px-8 md:py-7"
      // The phone shell pads 16px, not 24: the class bleed would scroll the page sideways.
      style={isMobile ? { margin: -16, padding: "16px 14px 28px" } : undefined}
    >
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#4f9c99] text-white">
            <Megaphone size={22} />
          </span>
          <div>
            <h1 className="text-[24px] text-[#2b3a39]">Meta Ads</h1>
            <p className="mt-0.5 text-[13px] text-[#7e918f]">
              {groups.length} campaign{groups.length === 1 ? "" : "s"} · {totals.waiting.toLocaleString()} waiting on
              your team · {totals.taken.toLocaleString()} accepted
            </p>
          </div>
        </div>

        {groups.length > 0 && (
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search campaign"
            aria-label="Search campaigns"
            className="rounded-full border border-[#dceae8] bg-white px-4 py-2 text-[#2b3a39] outline-none placeholder:text-[#9aacaa] focus:border-[#4f9c99]"
            // 16 on the phone, or iOS Safari zooms on focus.
            style={{ fontSize: isMobile ? 16 : 13.5, width: isMobile ? "100%" : undefined }}
          />
        )}
      </header>

      {error && <div className="mb-4"><Banner tone="error" text={error} /></div>}
      {truncated && <div className="mb-4"><LeadWindowNotice /></div>}

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#cfe2e0] bg-white/70 px-6 py-16 text-center">
          <Radio className="mx-auto mb-3 text-[#a9cfcc]" size={30} />
          <p className="text-[14.5px] text-[#2b3a39]">No Facebook leads on your team yet.</p>
          <p className="mx-auto mt-1.5 max-w-[520px] text-[13px] leading-relaxed text-[#7e918f]">
            When a lead from a Facebook or WhatsApp ad goes to anybody on your team — or to you — it
            collects here under its campaign.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="px-3 py-10 text-center text-[13px] text-[#8fa2a0]">
          No campaign matches &ldquo;{search.trim()}&rdquo;.
        </p>
      ) : (
        <div
          className="grid gap-4"
          // Inline: an arbitrary Tailwind value only exists if the scanner saw it.
          style={{ gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))" }}
        >
          {visible.map((group) => {
            const people = peopleByFolder.get(group.folderId)?.size ?? 0;
            return (
              <MetaCampaignCard
                key={group.folderId}
                name={group.name}
                basis={group.basis}
                href={`/subadmin/meta-ads/${group.folderId}`}
                figures={[
                  { value: group.waiting, label: "Waiting", tone: "ink" },
                  { value: group.taken, label: "Accepted", tone: "teal" },
                  { value: people, label: people === 1 ? "Person" : "People", tone: "ink" },
                ]}
                lastLeadAt={group.lastLeadAt === null ? null : new Date(group.lastLeadAt)}
                actionLabel="Open team leads"
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
