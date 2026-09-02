"use client";

import { IS_DEMO } from "@/lib/demo/store";
import { FlaskConical } from "lucide-react";

/**
 * Pinned to every screen while demo mode is on.
 *
 * Deliberately impossible to miss. The previous build's demo path was
 * indistinguishable from the real product, which is how fictional revenue ended
 * up looking like real revenue. Anyone watching this screen should know within
 * a second that the numbers are illustrative.
 */
export function DemoBanner() {
  if (!IS_DEMO) return null;

  return (
    <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-amber-950">
      <FlaskConical size={13} className="shrink-0" />
      <span>Demonstration mode — sample data, nothing is saved</span>
    </div>
  );
}
