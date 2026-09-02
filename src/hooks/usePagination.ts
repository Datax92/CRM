"use client";

import { useMemo, useState } from "react";

/**
 * Client-side pagination for a list already held in memory.
 *
 * Deliberately not a Firestore cursor. Every list this paginates —
 * the roster, an employee's leads, their deals, their activity — is derived
 * from documents the page has already loaded for its rollups, so a server
 * cursor would fetch data twice and make the totals disagree with the pages.
 * When volume makes holding them unreasonable the replacement is rollup
 * documents (architecture.md §4.5), not a cursor bolted onto this.
 *
 * The page **resets to 1 when the list shrinks**. Without that, typing in a
 * search box while on page 4 leaves you staring at an empty page, which reads
 * as "the search found nothing". A list that *grows* does not reset — that is
 * almost always a live Firestore update, and being yanked back to page 1
 * because a colleague logged a lead would be worse than the stale page.
 */
export interface Pagination<T> {
  /** The rows for the current page. */
  items: T[];
  page: number;
  pageCount: number;
  pageSize: number;
  /** 1-based index of the first row shown, or 0 when the list is empty. */
  from: number;
  /** 1-based index of the last row shown. */
  to: number;
  total: number;
  /** True when everything fits on one page — hide the control entirely. */
  single: boolean;
  setPage: (next: number) => void;
  next: () => void;
  previous: () => void;
}

export function usePagination<T>(rows: T[], pageSize: number): Pagination<T> {
  const [page, setPageState] = useState(1);
  const [seenTotal, setSeenTotal] = useState(rows.length);

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Reset **during render**, not from an effect. React sanctions this pattern
  // for state derived from a prop change, and it lands before paint — an
  // effect would render one frame of the wrong page first, and this project's
  // lint rule rejects `setState` inside an effect for exactly that reason.
  if (total !== seenTotal) {
    setSeenTotal(total);
    // Only a *shrinking* list resets. A list that grows is almost always a
    // live Firestore update — a new lead arriving must not yank the reader
    // back to page 1 mid-scroll — and `clamped` below keeps any page in range
    // regardless.
    if (total < seenTotal && page !== 1) setPageState(1);
  }

  const clamped = Math.min(Math.max(1, page), pageCount);

  const items = useMemo(
    () => rows.slice((clamped - 1) * pageSize, clamped * pageSize),
    [rows, clamped, pageSize]
  );

  return {
    items,
    page: clamped,
    pageCount,
    pageSize,
    from: total === 0 ? 0 : (clamped - 1) * pageSize + 1,
    to: Math.min(clamped * pageSize, total),
    total,
    single: pageCount <= 1,
    setPage: (next: number) => setPageState(Math.min(Math.max(1, next), pageCount)),
    next: () => setPageState((current) => Math.min(current + 1, pageCount)),
    previous: () => setPageState((current) => Math.max(current - 1, 1)),
  };
}
