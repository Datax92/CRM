'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The measured width of an element, in CSS pixels.
 *
 * The Day End Report switches between its stacked and side-by-side layouts on
 * this rather than on a CSS media query. Two reasons:
 *
 *  1. A media query lives in a stylesheet, and a stylesheet is a build
 *     artefact. If the build does not pick up the rule — a stale cache, a
 *     partial copy — the breakpoint silently never fires and the whole page
 *     renders in its narrow layout on a wide screen. That is exactly the
 *     failure this replaces.
 *  2. It measures the *container*, not the viewport, so the layout is correct
 *     regardless of how much width the sidebar is taking.
 *
 * Returns 0 until the first measurement, so callers should treat 0 as "not yet
 * known" and render the narrow layout, which is always safe.
 */
export function useElementWidth<E extends HTMLElement>() {
  const ref = useRef<E | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Measure immediately: waiting for the first ResizeObserver callback would
    // paint the narrow layout for a frame on every load.
    setWidth(element.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
