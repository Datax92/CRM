"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Says out loud that the leads window is full.
 *
 * `useLeads` reads the newest `LEAD_PAGE_SIZE` leads and nothing else. When the
 * pipeline outgrows that, the oldest leads are not loaded — and every screen
 * that answers a question *about* a lead from that array then answers as though
 * those leads do not exist. A Client folder is the sharpest case: it counts the
 * members still assigned to its owner, so a member outside the window is read
 * as somebody else's and quietly disappears from the folder and its count.
 *
 * On 2026-09-23 that showed the admin **14** clients in a folder holding 34,
 * with nothing deleted and nothing reassigned. The cap was doing exactly what
 * it was written to do; what it never did was say so, which is the only reason
 * it read as lost data. This is that sentence.
 *
 * Kept as its own component because three screens need the identical wording:
 * two of them phrase it as a count being short, and a count that is wrong in
 * two different voices is worse than one that is wrong in one.
 */
export function LeadWindowNotice({ subject = "Some figures" }: { subject?: string }) {
  return (
    <div
      className="mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12.5px]"
      style={{ borderColor: "#e3d3ab", background: "#fdf8ec", color: "#8a6321" }}
      role="status"
    >
      <AlertTriangle size={15} className="mt-px shrink-0" style={{ color: "#a8823a" }} />
      <span>
        <strong className="font-semibold">The pipeline is larger than this screen loads.</strong>{" "}
        {subject} may be short, because only the newest leads are held in memory and the
        oldest are not among them. Nothing has been deleted or reassigned — raise the lead
        window in <code className="rounded bg-white/70 px-1">useLeads</code> and the missing
        leads reappear.
      </span>
    </div>
  );
}
