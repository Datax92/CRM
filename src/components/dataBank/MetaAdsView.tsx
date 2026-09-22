"use client";

/**
 * Meta Ads — the campaigns sending leads, and where those leads went.
 *
 * **One row per ad, one folder per ad.** Facebook leads are filed into the Data
 * Bank grouped by the campaign (or form, or ad) they came from, and a folder is
 * created by the first lead that needs it — so a campaign the client launches
 * next month appears here on its own, correctly named, with nobody configuring
 * anything.
 *
 * **It lists what has actually sent leads, not what Ads Manager says is live.**
 * Reading the live campaign list from Meta needs `ads_read`, which is stuck
 * behind App Review; and the more useful question on this screen is anyway
 * "which ads are producing" rather than "which ads exist". A campaign that is
 * running and has sent nothing is not shown, which is itself the answer.
 *
 * Built on `useDataBankFolders`, so it costs no extra read — the folder list is
 * already open for the Data Bank screen and the two share one listener.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Megaphone, Radio, AlertTriangle, BellRing, X } from "lucide-react";
import { collection, onSnapshot, query, where, limit } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useDataBankFolders, type DataBankFolder } from "@/hooks/useDataBank";
import { useEmployees, useSubAdmins } from "@/hooks/useEmployees";
import { FullPageSpinner, Banner } from "@/components/admin/AdminShared";
import { timestampMillis } from "@/lib/dates";
import { MetaCampaignCard } from "./MetaCampaignCard";
import { FolderLaneModal, buildLanePeople, describeLane } from "./FolderLaneModal";

/**
 * A folder this screen owns — one Meta source.
 *
 * `metaSource` and `lastLeadAt` live on `DataBankFolder` itself, read out of
 * the snapshot by `folderFrom`. They were briefly declared only here, which
 * made every card read "Unattributed" — see the note in `useDataBank`.
 */
type MetaFolder = DataBankFolder;


/**
 * How recently a lead must have landed for this screen to call it news.
 *
 * **Elapsed time, not a watermark.** The alternative is remembering what this
 * browser had already seen, which needs storage, goes stale the moment somebody
 * opens the panel on a second device, and answers the wrong question anyway —
 * an admin opening this screen wants to know what has *just* come in, whether
 * or not they happened to be watching when it did. Ten minutes appears on its
 * own and leaves on its own.
 */
const JUST_IN_MS = 10 * 60_000;

/**
 * The alert slides in, and does not under `prefers-reduced-motion`. Inline
 * styles cannot carry a media query, which is why this is a stylesheet.
 */
const ALERT_CSS = `
@keyframes meta-alert-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
.meta-alert { animation: meta-alert-in 320ms cubic-bezier(0.22,0.61,0.36,1) both; }
@media (prefers-reduced-motion: reduce) { .meta-alert { animation: none !important; } }
`;

export function MetaAdsView() {
  const { role, user, getIdToken } = useAuth();
  useProtectedRoute(["admin", "subadmin"]);
  const isAdmin = role === "admin";
  const isManager = role === "admin" || role === "subadmin";
  // A manager's folders open under their own routes; the admin's path 404s for them.
  const basePath = isAdmin ? "/admin" : "/subadmin";
  const isMobile = useIsMobile();

  const { folders, loading, error } = useDataBankFolders(isManager, { role, uid: undefined });
  const [search, setSearch] = useState("");

  /*
    **Who each folder's leads go to.** The routing is stored as uids, and a card
    has to print names — so the same roster the picker offers is read here and
    passed through `describeLane`, one lookup shared by both. The folder the
    picker is open on is held by id, not by value: the folder list is live, and
    holding the object would leave the modal showing a stale name after a
    rename.
  */
  const { employees } = useEmployees(isManager, { role, uid: user?.uid });
  const { subAdmins } = useSubAdmins(isAdmin);
  const people = useMemo(
    () =>
      buildLanePeople({
        self: { uid: user?.uid ?? "", name: user?.email || "You", role },
        managers: subAdmins,
        employees,
      }),
    [user?.uid, user?.email, role, subAdmins, employees]
  );
  const [routingFolderId, setRoutingFolderId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /*
    **Leads that arrived and could not be filed.** Almost always a Facebook form
    with no phone question. Surfaced here rather than left as an HTTP status in
    a Make.com log, because an unattended pipeline that drops a contact silently
    is worse than one that visibly stops.
  */
  const [issues, setIssues] = useState<Array<{ id: string; reason: string; detail: string; source: string | null }>>([]);
  useEffect(() => {
    if (!isManager) return;
    const unsubscribe = onSnapshot(
      query(collection(db, "metaIntakeIssues"), where("resolved", "==", false), limit(50)),
      (snap) =>
        setIssues(
          snap.docs.map((doc) => ({
            id: doc.id,
            reason: String(doc.data().reason ?? ""),
            detail: String(doc.data().detail ?? ""),
            source: (doc.data().source as string | null) ?? null,
          }))
        ),
      (err) => console.error("[metaIntakeIssues]", err)
    );
    return () => unsubscribe();
  }, [isManager]);

  /*
    **"A lead just came in."** The owner asked for an alert on this panel when
    one lands, and the folder's own `lastLeadAt` is the signal — it is written
    by `fileMetaLead` at the moment the lead is filed, so the banner appears
    without a second collection, a second listener or anything to poll.
  */
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!isManager) return;
    // Set from the timer, never from the effect body: `Date.now()` in a render
    // body and `setState` in an effect body are both refused by the lint rule.
    const timer = setInterval(() => setClock(Date.now()), 15_000);
    const first = setTimeout(() => setClock(Date.now()), 0);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, [isManager]);
  /** Ads the admin has waved away this session. */
  const [acknowledged, setAcknowledged] = useState<string[]>([]);

  /*
    A Meta folder is one the intake created — it carries `metaSource`. Matching
    on the id prefix as well, so a folder created before that field existed is
    still recognised rather than disappearing from this screen.
  */
  const metaFolders = useMemo(
    () =>
      (folders as MetaFolder[])
        .filter((folder) => folder.metaSource || folder.id.startsWith("meta_"))
        .sort((a, b) => (b.recordCount ?? 0) - (a.recordCount ?? 0)),
    [folders]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return metaFolders;
    return metaFolders.filter((folder) => folder.name.toLowerCase().includes(needle));
  }, [metaFolders, search]);

  const totals = useMemo(
    () => ({
      sources: metaFolders.length,
      waiting: metaFolders.reduce((sum, f) => sum + (f.recordCount ?? 0), 0),
      distributed: metaFolders.reduce((sum, f) => sum + (f.promotedCount ?? 0), 0),
    }),
    [metaFolders]
  );

  /*
    Newest first: if three ads fired at once the most recent is the one somebody
    is looking for. Unacknowledged only — the × is per ad, so waving away one
    quiet campaign does not hide the next arrival on another.
  */
  const justIn = useMemo(() => {
    if (clock === 0) return [];
    return metaFolders
      .map((folder) => ({ folder, at: timestampMillis(folder.lastLeadAt) }))
      .filter(
        (row): row is { folder: MetaFolder; at: number } =>
          row.at !== null && clock - row.at < JUST_IN_MS && !acknowledged.includes(row.folder.id)
      )
      .sort((a, b) => b.at - a.at);
  }, [metaFolders, clock, acknowledged]);

  // Resolved from the live list, so a rename or a saved selection is reflected
  // in the open modal rather than in a copy taken when it opened.
  const routingFolder = routingFolderId
    ? (metaFolders.find((folder) => folder.id === routingFolderId) ?? null)
    : null;

  if (loading) return <FullPageSpinner />;

  return (
    <div
      className="-m-6 min-h-full bg-[#e9f1f0] px-6 py-6 text-[#2b3a39] md:-m-8 md:px-8 md:py-7"
      // The phone shell pads 16px, not 24: the class bleed scrolled the page sideways there.
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
              {totals.sources} ad{totals.sources === 1 ? "" : "s"} sending leads ·{" "}
              {totals.waiting.toLocaleString()} waiting to be given out ·{" "}
              {totals.distributed.toLocaleString()} already in the pipeline
            </p>
          </div>
        </div>

        {metaFolders.length > 0 && (
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search campaign"
            className="rounded-full border border-[#dceae8] bg-white px-4 py-2 text-[13.5px] text-[#2b3a39] outline-none placeholder:text-[#9aacaa] focus:border-[#4f9c99]"
            style={{ fontSize: isMobile ? 16 : 13.5 }}
          />
        )}
      </header>

      {error && <div className="mb-4"><Banner tone="error" text={error} /></div>}
      {notice && (
        <div className="mb-4">
          <Banner tone="success" text={notice} onDismiss={() => setNotice(null)} />
        </div>
      )}

      {justIn.length > 0 && (
        <div className="mb-4 space-y-2">
          <style>{ALERT_CSS}</style>
          {justIn.map(({ folder, at }) => (
            <div
              key={folder.id}
              className="meta-alert flex items-center gap-3 rounded-2xl border border-[#bfe0dc] bg-[#e8f5f3] px-4 py-3"
              role="status"
              aria-live="polite"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2f7d78] text-white">
                <BellRing size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-[#1f5c58]">
                  A new lead just came in from {folder.name}
                </p>
                <p className="mt-0.5 text-[12px] text-[#3c6d69]">
                  {minutesAgo(clock, at)} · {(folder.recordCount ?? 0).toLocaleString()} waiting to
                  be given out
                </p>
              </div>
              <Link
                href={`${basePath}/data-bank/${folder.id}`}
                className="shrink-0 rounded-full bg-[#2f7d78] px-3.5 py-1.5 text-[12.5px] font-semibold text-white"
              >
                Open
              </Link>
              <button
                type="button"
                onClick={() => setAcknowledged((current) => [...current, folder.id])}
                aria-label={`Dismiss the alert for ${folder.name}`}
                className="shrink-0 rounded-full p-1 text-[#5b8b87] hover:bg-[#d6ebe8]"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {issues.length > 0 && (
        <div className="mb-4 rounded-2xl border border-[#ecdcae] bg-[#fdf5e6] px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#a5762a]" />
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-[#8a6321]">
                {issues.length} lead{issues.length === 1 ? "" : "s"} arrived but could not be filed
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[#8a6321]">
                {issues.some((i) => i.reason === "NO_PHONE")
                  ? "Some came in without a phone number — the Facebook form is probably not asking for one. Add the Phone number question to the form and future leads will file normally."
                  : "Something went wrong filing them."}{" "}
                Nothing is lost: each one is kept with everything Facebook sent, so the contact can be
                recovered.
              </p>
              <ul className="mt-2 space-y-0.5">
                {issues.slice(0, 5).map((issue) => (
                  <li key={issue.id} className="text-[12px] text-[#8a6321]">
                    · {issue.source ?? "Unknown ad"} — {issue.detail}
                  </li>
                ))}
                {issues.length > 5 && (
                  <li className="text-[12px] text-[#8a6321]">· and {issues.length - 5} more</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {metaFolders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#cfe2e0] bg-white/70 px-6 py-16 text-center">
          <Radio className="mx-auto mb-3 text-[#a9cfcc]" size={30} />
          <p className="text-[14.5px] text-[#2b3a39]">No Facebook leads yet.</p>
          <p className="mx-auto mt-1.5 max-w-[520px] text-[13px] leading-relaxed text-[#7e918f]">
            Each Facebook ad gets its own folder here the first time one of its leads arrives —
            nothing to set up per campaign. Lead-form ads and click-to-WhatsApp ads both land here.
            If ads are running and nothing appears, check the ad sends people to the WhatsApp number
            connected to the CRM, or has an instant form attached.
          </p>
        </div>
      ) : (
        <div
          className="grid gap-4"
          // Inline: an arbitrary Tailwind value only exists if the scanner saw it.
          style={{ gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))" }}
        >
          {filtered.map((folder) => (
            <MetaCampaignCard
              key={folder.id}
              name={folder.name}
              basis={folder.metaSource?.basis ?? "NONE"}
              href={`${basePath}/data-bank/${folder.id}`}
              figures={[
                // The number that means "somebody has to act on this".
                { value: folder.recordCount ?? 0, label: "To give out", tone: "ink" },
                { value: folder.promotedCount ?? 0, label: "In pipeline", tone: "teal" },
              ]}
              lastLeadAt={folder.lastLeadAt?.toDate?.() ?? null}
              actionLabel="Open and distribute"
              routedTo={describeLane(folder.laneUids, people)}
              onEditRouting={() => setRoutingFolderId(folder.id)}
            />
          ))}
        </div>
      )}

      {routingFolder && (
        <FolderLaneModal
          folder={routingFolder}
          getIdToken={getIdToken}
          onClose={() => setRoutingFolderId(null)}
          onSaved={(message) => {
            setNotice(message);
            setRoutingFolderId(null);
          }}
        />
      )}
    </div>
  );
}

/** "Just now" / "4 minutes ago" — a clock time would need reading twice. */
function minutesAgo(now: number, at: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes === 1) return "1 minute ago";
  return `${minutes} minutes ago`;
}
