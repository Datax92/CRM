"use client";

/**
 * Whether the app should render its phone layout.
 *
 * **Not a CSS media query, deliberately.** Twice on this project a layout that
 * depended on a compiled stylesheet rule rendered wrongly on the owner's
 * machine because the build silently lacked that rule (see the Tailwind
 * arbitrary-value and `.dayend-row-*` entries in CLAUDE.md). A width read in
 * JavaScript cannot be dropped by a bundler, so the phone/desktop decision is
 * made here instead.
 *
 * Served through `useSyncExternalStore` rather than an effect:
 *
 * - `getServerSnapshot` returns `false`, so the server always renders the
 *   desktop tree and the client's hydration pass matches it exactly. React
 *   then re-renders with the real measurement on the very next tick — before
 *   paint in practice, so a phone never shows a frame of desktop chrome.
 * - Seeding state from `window.innerWidth` in an effect instead would either
 *   mismatch during hydration or cost an extra committed render.
 *
 * One shared listener serves every subscriber, and the snapshot is a boolean,
 * so a resize that does not cross the breakpoint re-renders nothing.
 */

import { useSyncExternalStore } from "react";

/**
 * Below this, the phone layout takes over.
 *
 * 820 rather than a round 768: the desktop leads workspace needs its 372px
 * list panel *plus* a readable detail pane, and it starts to crush at about
 * 810. Tablets in portrait therefore get the phone layout, which is the right
 * call — the phone layout is a complete product, not a degraded one.
 */
export const MOBILE_BREAKPOINT = 820;

let listeners: Array<() => void> = [];
/** Cached so `getSnapshot` is pure and returns a stable value between resizes. */
let current = false;

function measure(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

function subscribe(onChange: () => void): () => void {
  if (listeners.length === 0) {
    current = measure();
    window.addEventListener("resize", handleResize, { passive: true });
    // Rotating a phone fires resize late on some browsers; this fires first.
    window.addEventListener("orientationchange", handleResize, { passive: true });
  }
  listeners.push(onChange);

  return () => {
    listeners = listeners.filter((fn) => fn !== onChange);
    if (listeners.length === 0) {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    }
  };
}

function handleResize(): void {
  const next = measure();
  // Only wake React when the answer actually changes. Dragging a desktop
  // window fires resize at frame rate; without this every one of those would
  // re-render the whole app.
  if (next === current) return;
  current = next;
  for (const fn of listeners) fn();
}

function getSnapshot(): boolean {
  // `subscribe` runs before the first `getSnapshot` in React's flow, so
  // `current` is already measured — but guard anyway for a snapshot read that
  // somehow lands first.
  return listeners.length === 0 ? measure() : current;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
