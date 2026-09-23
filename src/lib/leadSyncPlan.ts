/**
 * When a device may fetch only the leads that changed, and when it must fetch
 * them all — the pure half of `lib/leadSync`.
 *
 * **Why this exists** (owner, 2026-09-23): the free plan's 50,000 reads a day
 * ran out at 17:15. A live listener is billed a read per document every time it
 * starts cold, and Firestore's own resume only spans 30 minutes — so the admin
 * or an HR manager reopening the CRM after lunch paid for all ~570 leads again,
 * on every device, every time. Leads are now stamped with `updatedAt` on every
 * write (`lib/leadStamp`), so a device holding yesterday's copy can ask for
 * `updatedAt > (when it last looked)` instead.
 *
 * **A full sync is still forced every `FULL_RESYNC_MS`.** Two things a delta
 * cannot see: a lead deleted outright (only the owner's purge script does
 * that), and a write made outside the stamp (a maintenance script). Six hours
 * bounds how long either can linger; it is also one full read of the pipeline
 * per device per working day, which is affordable where one per visit was not.
 *
 * **The watermark is server time, less a margin.** It advances only to
 * `updatedAt` values the server wrote, never to this device's clock — except
 * on a first full sync that saw no stamped lead at all, where the device's
 * start time is the only reference and `DELTA_SKEW_MS` absorbs a clock that
 * runs a few minutes fast.
 *
 * Dependency-free so the raw `--experimental-strip-types` test loader runs it.
 */

export const FULL_RESYNC_MS = 6 * 3600_000;
export const DELTA_SKEW_MS = 10 * 60_000;

export interface SyncMeta {
  /** When this device last completed a full sync, device ms. */
  fullAt: number;
  /** The newest `updatedAt` this device has seen, server ms. */
  watermark: number;
}

export type SyncPlan = { mode: "FULL" } | { mode: "DELTA"; since: number };

/** Stored meta, or null when absent or malformed — which means "sync in full". */
export function readSyncMeta(raw: string | null | undefined): SyncMeta | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    const fullAt = Number(parsed.fullAt);
    const watermark = Number(parsed.watermark);
    if (!Number.isFinite(fullAt) || !Number.isFinite(watermark) || fullAt <= 0 || watermark <= 0) return null;
    return { fullAt, watermark };
  } catch {
    return null;
  }
}

export function planSync(meta: SyncMeta | null, now: number): SyncPlan {
  if (!meta) return { mode: "FULL" };
  if (now - meta.fullAt >= FULL_RESYNC_MS || meta.fullAt > now + DELTA_SKEW_MS) return { mode: "FULL" };
  // A watermark from the future can only be a corrupted value; trusting it
  // would skip every change between now and then.
  if (meta.watermark > now + DELTA_SKEW_MS) return { mode: "FULL" };
  return { mode: "DELTA", since: meta.watermark - DELTA_SKEW_MS };
}

/** The newest of the current watermark and any stamps just seen. */
export function advanceWatermark(current: number, seen: ReadonlyArray<number | null | undefined>): number {
  let next = current;
  for (const value of seen) if (typeof value === "number" && Number.isFinite(value) && value > next) next = value;
  return next;
}
