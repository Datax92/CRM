"use client";

/**
 * One Meta campaign, as a card — the admin's Meta Ads screen and everybody's
 * Meta Leads screen draw the same one.
 *
 * **One component, because the owner asked for the two screens to look exactly
 * alike.** They answer different questions with different figures — an admin
 * sees what is still to give out, an employee sees what is waiting for them —
 * so the figures and the action are passed in; everything else is shared, and a
 * change to how a campaign looks lands on every role at once.
 */

import Link from "next/link";
import { ChevronRight, FolderOpen, Megaphone } from "lucide-react";
import { formatBusinessDate } from "@/lib/dates";

export const META_BASIS_LABEL: Record<string, string> = {
  CAMPAIGN: "Campaign",
  FORM: "Lead form",
  AD: "Ad",
  NONE: "Unattributed",
};

export interface CampaignFigure {
  value: number;
  label: string;
  /** Teal for the figure that is already handled, ink for the one needing action. */
  tone: "ink" | "teal";
}

export function MetaCampaignCard({
  name,
  basis,
  href,
  figures,
  lastLeadAt,
  actionLabel,
}: {
  name: string;
  basis: string;
  href: string;
  figures: CampaignFigure[];
  lastLeadAt: Date | null;
  actionLabel: string;
}) {
  return (
    <div className="group overflow-hidden rounded-2xl border border-[#dceae8] bg-white transition-colors hover:border-[#8cc3bf]">
      <Link href={href} className="block px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="block truncate text-[16px] text-[#2b3a39]">{name}</span>
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[#e8f5f3] px-2.5 py-0.5 text-[11px] text-[#2f7d78]">
              <Megaphone size={11} />
              {META_BASIS_LABEL[basis] ?? "Meta"}
            </span>
          </div>
          <ChevronRight size={18} className="mt-1 shrink-0 text-[#a9cfcc]" />
        </div>

        <div className="mt-4 flex items-end gap-6">
          {figures.map((figure) => (
            <div key={figure.label}>
              <div
                className="text-[24px] tabular-nums"
                style={{ color: figure.tone === "teal" ? "#2f7d78" : "#2b3a39" }}
              >
                {figure.value.toLocaleString()}
              </div>
              <div className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">{figure.label}</div>
            </div>
          ))}
        </div>

        <p className="mt-3.5 text-[12px] text-[#9aacaa]">
          {lastLeadAt ? `Last lead ${formatBusinessDate(lastLeadAt)}` : "No leads yet"}
        </p>
      </Link>

      <div className="flex items-center gap-1 border-t border-[#f0f6f5] px-3 py-2">
        <Link
          href={href}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-[#5b6d6b] transition-colors hover:bg-[#f2f8f7]"
        >
          <FolderOpen size={13} />
          <span>{actionLabel}</span>
        </Link>
      </div>
    </div>
  );
}
