'use client';

/**
 * Asking the browser where it is.
 *
 * Wrapped rather than called inline because every one of its failures needs a
 * different sentence, and `getCurrentPosition` reports all of them through one
 * callback with a numeric code. "Could not get your location" is the message
 * that generates a support conversation; "your browser is set to block location
 * for this site" is the one somebody can act on.
 *
 * **Nothing here decides anything.** The verdict is reached on the server, in
 * `classifyLocation`, against coordinates this module never sees. A check that
 * concluded in the browser would be bypassed by editing one response.
 */

import type { Fix } from './attendance';

/** Why a position could not be read. `null` when one was. */
export type FixFailure =
  | 'UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'UNAVAILABLE'
  | 'TIMEOUT';

export interface FixResult {
  fix: Fix | null;
  failure: FixFailure | null;
}

/**
 * Long enough for a cold GPS fix, short enough that nobody thinks it has hung.
 *
 * A phone that has not used GPS recently takes 5–15 seconds to find satellites
 * the first time. Below about 20s the first check-in of the morning fails on a
 * timeout and then succeeds on the second tap, which reads as a broken button.
 */
const FIX_TIMEOUT_MS = 25_000;

/**
 * The employee's position, or the reason there isn't one.
 *
 * Never rejects: a refusal to share location is an ordinary outcome with its
 * own message, not an exception. `maximumAge: 0` because a cached fix from
 * whenever the phone was last outdoors is exactly the wrong answer here.
 */
export async function readPosition(): Promise<FixResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { fix: null, failure: 'UNSUPPORTED' };
  }

  return new Promise<FixResult>((resolve) => {
    let settled = false;
    const finish = (result: FixResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    navigator.geolocation.getCurrentPosition(
      (position) =>
        finish({
          fix: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            // Some desktop browsers report `null` here. Treated as "no idea",
            // which the server throws out rather than trusting.
            accuracy: Number.isFinite(position.coords.accuracy)
              ? position.coords.accuracy
              : Number.POSITIVE_INFINITY,
          },
          failure: null,
        }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          finish({ fix: null, failure: 'PERMISSION_DENIED' });
        } else if (error.code === error.TIMEOUT) {
          finish({ fix: null, failure: 'TIMEOUT' });
        } else {
          finish({ fix: null, failure: 'UNAVAILABLE' });
        }
      },
      {
        // Asks for GPS rather than the coarse network estimate. Costs a few
        // seconds and some battery on the one tap it is used for, and is the
        // difference between a 20m reading and a 2km one.
        enableHighAccuracy: true,
        timeout: FIX_TIMEOUT_MS,
        maximumAge: 0,
      }
    );

    // `getCurrentPosition` has been observed never to call back at all on some
    // Android WebViews when permission is in an odd state. The employee gets a
    // timeout message instead of a button that spins for ever.
    setTimeout(() => finish({ fix: null, failure: 'TIMEOUT' }), FIX_TIMEOUT_MS + 2_000);
  });
}

/**
 * What to tell somebody whose device would not say where it is.
 *
 * Written for the person reading it, not the developer: each one names the
 * thing they have to change. The server refuses the check-in either way — this
 * only explains why.
 */
export const FIX_FAILURE_MESSAGES: Record<FixFailure, string> = {
  UNSUPPORTED:
    'This browser cannot share its location, so check-in cannot confirm you are at the office. ' +
    'Try again in Chrome or Safari, or ask an admin to grant you an exception.',
  PERMISSION_DENIED:
    'Location is blocked for this site, so check-in cannot confirm you are at the office. ' +
    'Tap the padlock in the address bar, allow Location, and try again.',
  UNAVAILABLE:
    'Your device could not work out where it is. Step somewhere with a clearer view of the sky ' +
    'or turn Location Services on, then try again.',
  TIMEOUT:
    'Finding your location took too long. This is usually the first fix of the day — try again, ' +
    'and it is normally quicker the second time.',
};
