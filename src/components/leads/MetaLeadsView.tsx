"use client";

/**
 * Meta Leads — a person's own Facebook leads, laid out exactly as the admin's
 * Meta Ads screen lays out the business's.
 *
 * **Same screen, same parts, their own leads** (owner, 2026-09-17: "how meta
 * leads are shown in admin they should exactly like shown in employee"). One
 * card per campaign folder, drawn by the admin's own `MetaCampaignCard`;
 * opening one shows that campaign's leads in the admin's folder list
 * (`MetaLeadsFolder`). What differs is authority, not appearance: nobody here
 * can reassign — the admin and a manager do that from the folder itself.
 *
 * **Built from the person's leads, not from the folders.** `dataBankFolders`
 * are managing-roles-only, so the cards are derived from the leads this person
 * may read (`lib/metaLeadGroups`), keyed by the folder id every lead from an ad
 * carries — the same folder the admin opens.
 *
 * **Offers sit on top.** A lead offered and not yet answered has a
 * five-minute clock, so it is answered here, with Accept and Pass on, before
 * anything else on the screen.
 *
 * Employees, and managers an admin has put in the rotation — a manager's query
 * returns their whole team, so the screen keeps only their own leads.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Check, Clock, Megaphone, Phone, Radio, Sparkles } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLeads, type Lead } from "@/hooks/useLeads";
import { acceptLead, passLead } from "@/lib/clientActions";
import { describeLeadSource } from "@/lib/leadSource";
import { ACCEPT_WINDOW_MINUTES } from "@/lib/constants/distribution";
import { formatTimeLeft } from "@/lib/distribution";
import { LEAD_SCORE_WEIGHTS } from "@/lib/leadPriority";
import { timestampMillis } from "@/lib/dates";
import { groupMetaLeads, isMetaLead } from "@/lib/metaLeadGroups";
import { FullPageSpinner, Banner } from "@/components/admin/AdminShared";
import { MetaCampaignCard } from "@/components/dataBank/MetaCampaignCard";

export function MetaLeadsView() {
  const { user, role, getIdToken } = useAuth();
  useProtectedRoute(["employee", "subadmin"]);
  const isMobile = useIsMobile();
  const basePath = role === "subadmin" ? "/subadmin" : "/employee";

  const { leads, loading, error } = useLeads(
    role === "employee" || role === "subadmin" ? role : null,
    user?.uid
  );

  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  // A manager's query returns their whole team; this screen is their own leads.
  const mine = useMemo(
    () => leads.filter((lead) => lead.assignedUserId === user?.uid && isMetaLead(lead)),
    [leads, user?.uid]
  );

  const offers = useMemo(
    () =>
      mine
        .filter((lead) => lead.status === "ASSIGNED")
        .sort(
          (a, b) =>
            (timestampMillis(a.acceptDeadlineAt) ?? Infinity) -
            (timestampMillis(b.acceptDeadlineAt) ?? Infinity)
        ),
    [mine]
  );

  const groups = useMemo(() => groupMetaLeads(mine, (lead) => timestampMillis(lead.createdAt)), [mine]);
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

  const answer = async (lead: Lead, kind: "ACCEPT" | "PASS") => {
    setBusy(lead.id);
    setBanner(null);
    try {
      const token = await getIdToken();
      const result = kind === "ACCEPT" ? await acceptLead(token, lead.id) : await passLead(token, lead.id);
      setBanner(
        result.ok
          ? {
              tone: "success",
              text:
                kind === "ACCEPT"
                  ? `${lead.name} is yours. Call them now — it came from a paid ad.`
                  : `${lead.name} passed to the next person in the lane.`,
            }
          : { tone: "error", text: result.error || "That did not go through." }
      );
    } catch {
      setBanner({ tone: "error", text: "Network error — the lead is still yours to answer." });
    } finally {
      setBusy(null);
    }
  };

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
            <h1 className="text-[24px] text-[#2b3a39]">Meta Leads</h1>
            <p className="mt-0.5 text-[13px] text-[#7e918f]">
              {groups.length} campaign{groups.length === 1 ? "" : "s"} · {totals.waiting.toLocaleString()} waiting
              for you · {totals.taken.toLocaleString()} yours
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
      {banner && (
        <div className="mb-4">
          <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />
        </div>
      )}

      {offers.length > 0 && (
        <div className="mb-5 space-y-2.5">
          <p className="flex items-center gap-1.5 text-[11px] tracking-[1px] text-[#2f7d78] uppercase">
            <Sparkles size={13} />
            Waiting for your answer
          </p>
          {offers.map((lead) => (
            <OfferCard
              key={lead.id}
              lead={lead}
              busy={busy === lead.id}
              disabled={busy !== null}
              isMobile={isMobile}
              onAnswer={(kind) => void answer(lead, kind)}
            />
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#cfe2e0] bg-white/70 px-6 py-16 text-center">
          <Radio className="mx-auto mb-3 text-[#a9cfcc]" size={30} />
          <p className="text-[14.5px] text-[#2b3a39]">No Facebook leads yet.</p>
          <p className="mx-auto mt-1.5 max-w-[520px] text-[13px] leading-relaxed text-[#7e918f]">
            When a lead from a Facebook or WhatsApp ad is offered to you, it appears above with{" "}
            {ACCEPT_WINDOW_MINUTES} minutes to accept, and the ones you take collect here under their
            campaign.
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
          {visible.map((group) => (
            <MetaCampaignCard
              key={group.folderId}
              name={group.name}
              basis={group.basis}
              href={`${basePath}/meta-leads/${group.folderId}`}
              figures={[
                { value: group.waiting, label: "Waiting for you", tone: "ink" },
                { value: group.taken, label: "Your leads", tone: "teal" },
              ]}
              lastLeadAt={group.lastLeadAt === null ? null : new Date(group.lastLeadAt)}
              actionLabel="Open your leads"
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OfferCard({
  lead,
  busy,
  disabled,
  isMobile,
  onAnswer,
}: {
  lead: Lead;
  busy: boolean;
  disabled: boolean;
  isMobile: boolean;
  onAnswer: (kind: "ACCEPT" | "PASS") => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#bfe0dc] bg-white">
      <div style={{ height: 3, background: "#4f9c99" }} />
      <div style={{ padding: isMobile ? "14px 15px" : "16px 18px" }}>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[16px] text-[#2b3a39]">{lead.name || "New lead"}</span>
          <Countdown deadline={lead.acceptDeadlineAt} />
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-[#5b6d6b]">
          <Phone size={13} className="shrink-0 text-[#2f7d78]" />
          <span className="tabular-nums">{lead.phone || "No number"}</span>
        </div>
        <p className="mt-1 text-[11.5px] text-[#9aacaa]">{describeLeadSource(lead)}</p>
        {lead.notes && (
          <p className="mt-2 rounded-lg bg-[#f2f8f7] px-2.5 py-2 text-[12px] leading-relaxed text-[#5b6d6b]">
            {lead.notes}
          </p>
        )}

        <div className="mt-3.5 flex gap-2.5">
          <button
            type="button"
            onClick={() => onAnswer("ACCEPT")}
            disabled={disabled}
            className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-[#4f9c99] px-3.5 py-3 text-[14px] text-white transition-colors hover:bg-[#3f8f8a]"
            style={{ opacity: disabled && !busy ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}
          >
            <Check size={16} />
            {busy ? "Working…" : "Accept"}
          </button>
          <button
            type="button"
            onClick={() => onAnswer("PASS")}
            disabled={disabled}
            title={`Passing costs ${LEAD_SCORE_WEIGHTS.pass} points on your lane score`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#dceae8] bg-[#f7fbfa] px-2.5 py-3 text-[13.5px] text-[#5b6d6b] transition-colors hover:border-[#8cc3bf]"
            style={{ opacity: disabled && !busy ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}
          >
            <ArrowRightLeft size={15} />
            Pass on
          </button>
        </div>
        {/* Said before the button, not discovered after it. */}
        <p className="mt-2 text-[10.5px] leading-normal text-[#9aacaa]">
          Passing hands it to the next person in the lane and costs {LEAD_SCORE_WEIGHTS.pass} points on
          your priority score.
        </p>
      </div>
    </div>
  );
}

/** Minutes and seconds left, ticking, or "Window closed" once it lapses. */
function Countdown({ deadline }: { deadline: Lead["acceptDeadlineAt"] }) {
  const expiresAt = timestampMillis(deadline);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (expiresAt === null) return;
    // `Date.now()` belongs in the timer, never in a render body — the lint rule
    // refuses an impure call there.
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  // 0 is "the clock has not been read yet", one render, not a lapsed window.
  if (expiresAt === null || now === 0) return null;

  const left = Math.max(0, Math.round((expiresAt - now) / 1000));
  const urgent = left <= 60;
  const lapsed = left === 0;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] tabular-nums"
      style={{
        background: lapsed ? "#eef5f4" : urgent ? "#fbe9e6" : "#e8f5f3",
        color: lapsed ? "#9aacaa" : urgent ? "#a8473b" : "#2f7d78",
      }}
    >
      <Clock size={11} />
      {lapsed ? "Window closed — moving on" : `${formatTimeLeft(left)} left`}
    </span>
  );
}
