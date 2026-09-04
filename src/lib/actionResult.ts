/**
 * Result type for Server Actions.
 *
 * Next.js redacts thrown error messages in production builds, so an action that
 * signals failure by throwing gives the user "An unexpected error occurred"
 * regardless of what actually went wrong. Returning a result keeps the real
 * message — "This lead was already assigned", "Your session has expired" —
 * which is the difference between a usable app and a mysterious one.
 *
 * Unexpected errors are still logged server-side and reduced to a generic
 * message, so internals never leak to the client.
 */

import { QUOTA_MESSAGE, isQuotaExhausted } from './quotaError';
import {
  CREDENTIALS_MESSAGE,
  credentialsKnownMissing,
  isCredentialFailure,
  noteCredentialFailure,
} from './configError';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/**
 * Runs an action body, converting expected failures into `{ ok: false }`.
 *
 * `AuthError` and `UserFacingError` messages are written for the user and pass
 * through verbatim. Anything else is a bug or an outage: logged in full, shown
 * as a generic message.
 */
/**
 * Actions slower than this print their duration to the server terminal.
 *
 * Without it, "the app is slow" is unanswerable: the failure is a spinner in a
 * browser and the cause is a round trip on a machine you cannot see. One line
 * naming the action and its wall time turns that into a fact.
 */
const SLOW_ACTION_MS = 2_000;

export async function runAction<T>(
  label: string,
  body: () => Promise<T>
): Promise<ActionResult<T>> {
  const startedAt = Date.now();

  // Already established that the server has no credentials. Discovering it
  // again costs ~3s of metadata probing per call and cannot produce a
  // different answer — the fix is an env change and a restart.
  if (credentialsKnownMissing()) {
    return { ok: false, error: CREDENTIALS_MESSAGE };
  }

  try {
    const data = await body();
    const took = Date.now() - startedAt;
    if (took >= SLOW_ACTION_MS) {
      console.warn(`[action:${label}] took ${took}ms — slower than expected.`);
    }
    return { ok: true, data };
  } catch (error) {
    const isUserFacing =
      error instanceof UserFacingError ||
      (error instanceof Error && error.name === 'AuthError');

    if (isUserFacing) {
      return { ok: false, error: (error as Error).message };
    }

    // No service account. A configuration failure, not a bug — and the one
    // that most looks like a bug, because the browser keeps working while
    // every Server Action fails. Say which it is.
    if (isCredentialFailure(error)) {
      noteCredentialFailure();
      console.error(
        `[action:${label}] no Firebase Admin credentials after ${Date.now() - startedAt}ms — ` +
          'set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env.local and restart.'
      );
      return { ok: false, error: CREDENTIALS_MESSAGE };
    }

    // A spent daily quota is not a bug and not an outage, and the generic
    // message below sends people looking for both. Say what it is.
    if (isQuotaExhausted(error)) {
      console.error(`[action:${label}] Firestore quota exhausted after ${Date.now() - startedAt}ms`);
      return { ok: false, error: QUOTA_MESSAGE };
    }

    console.error(`[action:${label}] failed after ${Date.now() - startedAt}ms`, error);
    return {
      ok: false,
      error: 'Something went wrong on our side. Please try again, or contact your administrator if it keeps happening.',
    };
  }
}
