"use client";

/**
 * Waits for a document to actually disappear from Firestore.
 *
 * **Why this exists.** A Server Action's return value is an HTTP response, and
 * on this project that response has repeatedly failed to arrive even though the
 * write itself committed — the record left its folder, the counter moved, and
 * the browser sat on "Working…" until it timed out. Waiting on the
 * acknowledgement was therefore waiting on the least reliable part of the
 * round trip.
 *
 * Firestore's realtime channel is a completely separate connection, already
 * open, already streaming this folder's document. When the promotion commits,
 * the deletion arrives on that channel whether or not the action's HTTP
 * response ever does. So the source of truth for "did it work" is the database,
 * not the function's return value — and that is what this watches.
 *
 * The action is still awaited, and its result still wins when it arrives first,
 * because only it can report *why* something was refused. This is the second
 * of two answers, not a replacement for the first.
 */

import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { IS_DEMO } from "@/lib/demo/store";

export interface GoneWatch {
  /** Resolves once the document is confirmed absent. Never rejects. */
  promise: Promise<void>;
  /** Always call this — an abandoned listener is a leak. */
  cancel: () => void;
}

/**
 * @param collectionName Collection holding the document, e.g. `"dataBankRecords"`.
 * @param id The document id.
 * @param isGone Optional test for "gone" when the write does not delete the
 *   document. Promotion files the row under a reserved folder id rather than
 *   deleting it — a delete is a separate daily allowance and is the operation
 *   Firestore refuses first — so for that caller the row is gone the moment its
 *   `folderId` changes, whether or not the document survives.
 */
export function watchGone(
  collectionName: string,
  id: string,
  isGone?: (data: Record<string, unknown>) => boolean
): GoneWatch {
  // In demo mode there is no realtime channel and the "action" is a synchronous
  // function call, so this would never resolve. A promise that never settles is
  // fine here: it is only ever raced against one that does.
  if (IS_DEMO || !id) {
    return { promise: new Promise<void>(() => {}), cancel: () => {} };
  }

  let stop: (() => void) | null = null;
  let settle: (() => void) | null = null;

  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });

  stop = onSnapshot(
    doc(db, collectionName, id),
    (snap) => {
      // The first snapshot describes the document as it is *now* — which is
      // still present, since we are watching something we just asked to be
      // deleted. Only a later "does not exist" means the write landed.
      if (snap.metadata.fromCache) return;
      if (!snap.exists()) {
        settle?.();
        return;
      }
      if (isGone?.(snap.data() as Record<string, unknown>)) settle?.();
    },
    () => {
      // A read error here says nothing about whether the write succeeded, so
      // this stays silent and lets the action's own result answer.
    }
  );

  return {
    promise,
    cancel: () => {
      stop?.();
      stop = null;
    },
  };
}
