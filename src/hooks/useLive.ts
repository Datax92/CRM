'use client';

/**
 * Subscribe to a Firestore query, or join the subscription that already exists.
 *
 * **This is the read-cost fix, and it is structural rather than a tuning knob.**
 * Every hook in this app used to open its own `onSnapshot`. Measured against the
 * live project on 2026-09-11, one visit to each of eight admin screens cost
 * **2,267 document reads** — because `leads` (296 documents) is read by the
 * dashboard, the leads workspace, the directory *and* the deals screen, and the
 * notification list (100) by all of them. Nothing was wrong with any single
 * query; the cost was that each one was paid over and over.
 *
 * Two mechanisms, both in `lib/liveCollection`:
 *
 * 1. **One listener per key.** Every component and every screen asking for the
 *    same query shares one subscription and one copy of the data.
 * 2. **A keep-alive after the last unmount**, so moving between screens — which
 *    is how this app is actually used — re-reads nothing.
 *
 * `build` **must be stable**: wrap it in `useCallback` at the call site. An
 * unstable one resubscribes every render and undoes the whole point, which is
 * why it is a dependency here rather than smuggled past the linter in a ref.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { Query, DocumentData } from 'firebase/firestore';
import { subscribeLive, liveState, SERVER_STATE, type LiveState } from '@/lib/liveCollection';

export function useLive(
  key: string,
  build: () => Query<DocumentData>,
  enabled: boolean,
  describeError: (error: unknown) => string
): LiveState {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!enabled) return () => {};
      return subscribeLive(key, build, describeError, notify);
    },
    [key, enabled, build, describeError]
  );

  const read = useCallback(() => (enabled ? liveState(key) : SERVER_STATE), [key, enabled]);
  return useSyncExternalStore(subscribe, read, () => SERVER_STATE);
}
