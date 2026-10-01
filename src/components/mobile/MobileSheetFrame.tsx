"use client";

/**
 * A full-screen frame for a phone sheet opened from a page that does not own
 * the screen.
 *
 * `MobileLeadDetail` is `position: absolute; inset: 0` — it fills whatever
 * contains it. On the phone's own screens (Leads, Team, Data Bank) that is a
 * root the size of the display. On every other route the shell wraps the page
 * in a padded scroll region, and the page transition's `will-change: transform`
 * makes that wrapper the containing block: the sheet then drew as an inset box
 * the height of the list, with the list showing round its edges.
 *
 * So a host on such a route puts the sheet in this: portalled to the body and
 * pinned to the viewport, clear of every transformed ancestor. Render it only
 * in response to a tap, so `document` exists.
 */

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { M } from "./mobileChrome";

export function MobileSheetFrame({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        // Above the tab bar, below `OverlayPanel` (200), which the sheet opens.
        zIndex: 60,
        background: M.page,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* The sheet's own containing block, inside the safe-area padding. */}
      <div style={{ position: "relative", width: "100%", height: "100%" }}>{children}</div>
    </div>,
    document.body
  );
}
