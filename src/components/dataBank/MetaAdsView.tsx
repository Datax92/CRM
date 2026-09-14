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
import { Megaphone, FolderOpen, ChevronRight, Radio, AlertTriangle } from "lucide-react";
import { collection, onSnapshot, query, where, limit } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useDataBankFolders, type DataBankFolder } from "@/hooks/useDataBank";
import { FullPageSpinner, Banner } from "@/components/admin/AdminShared";
import { formatBusinessDate } from "@/lib/dates";

/**
 * A folder this screen owns — one Meta source.
 *
 * `metaSource` and `lastLeadAt` live on `DataBankFolder` itself, read out of
 * the snapshot by `folderFrom`. They were briefly declared only here, which
 * made every card read "Unattributed" — see the note in `useDataBank`.
 */
type MetaFolder = DataBankFolder;

const BASIS_LABEL: Record<string, string> = {
  CAMPAIGN: "Campaign",
  FORM: "Lead form",
  AD: "Ad",
  NONE: "Unattributed",
};

export function MetaAdsView() {
  const { role } = useAuth();
  useProtectedRoute(["admin", "subadmin"]);
  const isAdmin = role === "admin";
  const isManager = role === "admin" || role === "subadmin";
  const isMobile = useIsMobile();

  const { folders, loading, error } = useDataBankFolders(isManager, { role, uid: undefined });
  const [search, setSearch] = useState("");

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

  if (loading) return <FullPageSpinner />;

  return (
    <div className="-m-6 min-h-full bg-[#e9f1f0] px-6 py-6 text-[#2b3a39] md:-m-8 md:px-8 md:py-7">
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
            nothing to set up per campaign. If ads are running and nothing appears, check that the
            campaign&rsquo;s objective is <strong>Leads</strong> with an instant form attached, and
            that the ad account has no payment error.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {filtered.map((folder) => (
            <AdCard key={folder.id} folder={folder} basePath={isAdmin ? "/admin" : "/subadmin"} />
          ))}
        </div>
      )}
    </div>
  );
}

function AdCard({ folder, basePath }: { folder: MetaFolder; basePath: string }) {
  const waiting = folder.recordCount ?? 0;
  const given = folder.promotedCount ?? 0;
  const last = folder.lastLeadAt?.toDate?.() ?? null;
  const basis = folder.metaSource?.basis ?? "NONE";

  return (
    <div className="group overflow-hidden rounded-2xl border border-[#dceae8] bg-white transition-colors hover:border-[#8cc3bf]">
      <Link href={`${basePath}/data-bank/${folder.id}`} className="block px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="truncate text-[16px] text-[#2b3a39]">{folder.name}</span>
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[#e8f5f3] px-2.5 py-0.5 text-[11px] text-[#2f7d78]">
              <Megaphone size={11} />
              {BASIS_LABEL[basis] ?? "Meta"}
            </span>
          </div>
          <ChevronRight size={18} className="mt-1 shrink-0 text-[#a9cfcc]" />
        </div>

        <div className="mt-4 flex items-end gap-6">
          <div>
            {/* The number that means "somebody has to act on this". */}
            <div className="text-[24px] tabular-nums text-[#2b3a39]">{waiting.toLocaleString()}</div>
            <div className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">To give out</div>
          </div>
          <div>
            <div className="text-[24px] tabular-nums text-[#2f7d78]">{given.toLocaleString()}</div>
            <div className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">In pipeline</div>
          </div>
        </div>

        <p className="mt-3.5 text-[12px] text-[#9aacaa]">
          {last ? `Last lead ${formatBusinessDate(last)}` : "No leads yet"}
        </p>
      </Link>

      <div className="flex items-center gap-1 border-t border-[#f0f6f5] px-3 py-2">
        <Link
          href={`${basePath}/data-bank/${folder.id}`}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-[#5b6d6b] transition-colors hover:bg-[#f2f8f7]"
        >
          <FolderOpen size={13} />
          <span>Open and distribute</span>
        </Link>
      </div>
    </div>
  );
}
