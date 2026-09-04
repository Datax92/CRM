/**
 * The Admin SDK has no credentials.
 *
 * This is a **configuration** failure, not a bug and not an outage, and it has
 * exactly the shape that has cost this project the most time: the browser goes
 * on reading and writing Firestore perfectly — it uses the `NEXT_PUBLIC_*` web
 * config and the signed-in user's own token — while every **Server Action**
 * fails, because those run through `firebase-admin`, which needs a service
 * account.
 *
 * So the symptom is "one screen is broken and everything else works", and the
 * message the user actually saw was `runAction`'s catch-all: *"Something went
 * wrong on our side."* That sends people looking for a bug in the screen.
 *
 * **How it presents.** With `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`
 * unset, `getAdminApp()` falls through to Application Default Credentials. On
 * a machine with no ADC the SDK probes the GCE metadata server, retries, and
 * fails after **~3 seconds per call** — measured against this project — with
 * `Could not load the default credentials`. An action making two calls
 * therefore hangs for the better part of ten seconds before failing, which
 * reads as a slow network rather than a missing setting.
 *
 * Two things follow, and both are here:
 *
 *  - the condition is **named** rather than reduced to the generic message;
 *  - once seen, it is **remembered**, so the next action fails in
 *    milliseconds instead of burning another three seconds discovering the
 *    same thing.
 */

export const CREDENTIALS_MESSAGE =
  'The server has no Firebase credentials, so it cannot read the database. ' +
  'Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env.local from a ' +
  'service-account key (Firebase console → Project settings → Service accounts → ' +
  'Generate new private key), then restart the dev server. Everything the browser ' +
  'loads on its own will keep working until then, which is why only some screens fail.';

/**
 * Whether this error is the Admin SDK failing to find credentials.
 *
 * Matched on the message as well as the shape, because it arrives from three
 * different layers — `google-auth-library` throwing directly, the same error
 * wrapped by `google-gax`, and occasionally as an `UNAUTHENTICATED` status
 * from the REST transport with the text carried along.
 */
export function isCredentialFailure(error: unknown): boolean {
  if (!error) return false;

  const err = error as { code?: unknown; message?: string; errorInfo?: { code?: string } };
  const message = typeof err.message === 'string' ? err.message : '';

  if (/could not load the default credentials/i.test(message)) return true;
  if (/unable to detect a project ?id/i.test(message)) return true;
  if (/failed to determine (a )?project ?id/i.test(message)) return true;
  if (/error fetching access token/i.test(message)) return true;
  if (/invalid_grant|invalid jwt signature/i.test(message)) return true;
  if (err.errorInfo?.code === 'app/invalid-credential') return true;

  // gRPC UNAUTHENTICATED (16) / REST 401, but only when the text agrees — a
  // bare 16 can also be a revoked token, which is a different message.
  const code = err.code;
  const unauthenticated = code === 16 || code === 401 || code === 'unauthenticated';
  return unauthenticated && /credential|default credentials|access token/i.test(message);
}

/**
 * Sticky once seen.
 *
 * Credentials do not appear while a process is running — the fix is an env
 * change and a restart — so after the first failure every later action can say
 * so immediately rather than repeating the three-second discovery. Reset only
 * matters in tests.
 */
let seen = false;

export function noteCredentialFailure(): void {
  seen = true;
}

export function credentialsKnownMissing(): boolean {
  return seen;
}

export function resetCredentialFailure(): void {
  seen = false;
}
