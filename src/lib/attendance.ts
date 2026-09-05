/**
 * Attendance — presence derived from work, located by network.
 *
 * Dependency-free on purpose (raw `node --test` imports this without a
 * bundler), and deliberately not a "Mark Present" button. Two ideas:
 *
 *  1. **Presence is derived, not declared.** The day opens on the employee's
 *     first signed-in activity and closes on their last. There is no control to
 *     press, so there is nothing to falsify except by actually being at work.
 *
 *  2. **Location is where the device says it is, checked on the server.** Two
 *     signals, and they answer different questions.
 *
 *     - **Where the phone is** (`classifyLocation`). The browser's geolocation
 *       API, compared against the office's coordinates. This is the one that
 *       answers "are they actually here" — a saved Wi-Fi name travels home in
 *       somebody's pocket, a set of coordinates does not. Faking it takes
 *       deliberate technical effort (a mock-location app, or devtools);
 *       forgetting to is impossible.
 *     - **The Wi-Fi network name** (`classifyWifi`). Cheap corroboration, and
 *       the answer for a device that will not share its location at all.
 *
 *     The office network name is static — it is the one thing about the office
 *     connection that does not change — which is why it replaced the address
 *     check.
 *
 *     **The address was removed, deliberately.** A business line's public IP is
 *     dynamic: the ISP hands out a new one on reconnect, an allow-list built
 *     from today's address silently stops matching, and the restriction then
 *     refuses the entire company. That is not a tuning problem, it is the
 *     mechanism being wrong for the network it was pointed at. The address is
 *     still *recorded* on every punch — it costs nothing and it is what an
 *     admin checks a suspicious day against — but nothing is ever matched
 *     against it and there is no list of addresses to maintain.
 *
 *     **What the Wi-Fi check is worth, stated plainly.** No browser exposes the
 *     SSID — there is no web API for it, on any platform — so the name is typed
 *     once per device, remembered there, sent with the punch and compared on
 *     the server. It stops the ordinary case, somebody checking in from home
 *     out of habit. It does not stop somebody who decides to type the office
 *     network's name instead. It is exactly as trustworthy as the punch time
 *     beside it, which is also declared, and the system is built to match:
 *     **the expected names are never shown to an employee**, every claim is
 *     stored, and a refusal tells the admin. Bypassable but visible is the
 *     achievable goal; unbypassable is not.
 *
 * None of this is proof — no web app can prove where a body is. It raises the
 * cost of faking attendance above the cost of simply doing the job, which is
 * the achievable goal.
 */

export type AttendanceNetwork = 'OFFICE' | 'REMOTE' | 'UNKNOWN';

/**
 * `LATE` is a *present* day, not a separate kind of absence — the employee
 * turned up, after the configured time. It is its own status because the
 * calendar colours it differently (§3), the reports count it separately (§9)
 * and the deduction rule counts occurrences of it (§5); folding it into
 * PRESENT would make all three impossible.
 */
export type AttendanceStatus =
  | 'PRESENT'
  | 'LATE'
  | 'HALF_DAY'
  | 'ABSENT'
  | 'LEAVE'
  | 'OFF'
  | 'UNRECORDED';

/** A full day, below which the day is a half day. Minutes. */
export const FULL_DAY_MINUTES = 6 * 60;
export const HALF_DAY_MINUTES = 2 * 60;

/** Pakistan's working week runs Monday to Saturday; Sunday is the weekly off. */
export const WEEKLY_OFF_DAY = 0;

/**
 * Normalises an IP for comparison.
 *
 * Node reports an IPv4 address over a dual-stack socket as `::ffff:1.2.3.4`,
 * and proxies pad addresses with spaces. Comparing raw strings would silently
 * fail to match the office on some deployments and not others.
 */
export function normalizeIp(value: string | null | undefined): string {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return '';

  const mapped = text.startsWith('::ffff:') ? text.slice(7) : text;
  // Strip a port if one came along (`1.2.3.4:56789`), but never touch IPv6,
  // where colons are part of the address itself.
  const withoutPort = /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(mapped)
    ? mapped.slice(0, mapped.lastIndexOf(':'))
    : mapped;

  return withoutPort;
}

/**
 * The client's address from a proxy chain.
 *
 * `x-forwarded-for` is a comma-separated list appended to by each hop, so the
 * original client is the *first* entry. Taking the last would yield the proxy's
 * own address, which on Vercel is the same for every employee — every day would
 * then read as either all-office or all-remote.
 */
export function clientIpFromHeaders(headers: {
  get(name: string): string | null;
}): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) return normalizeIp(first);
  }
  return normalizeIp(headers.get('x-real-ip'));
}

/* -------------------------------------------------------------------------- */
/* Where the device says it is                                                 */
/* -------------------------------------------------------------------------- */

/** A position as the browser reports it. Metres for `accuracy`. */
export interface Fix {
  lat: number;
  lng: number;
  /** The radius the browser is 95% confident the true position lies within. */
  accuracy: number;
}

/** Where the office is, and how far from it still counts as being there. */
export interface OfficeLocation {
  lat: number;
  lng: number;
  radiusMeters: number;
}

/**
 * What a position says about somebody's whereabouts.
 *
 * `IMPRECISE` is deliberately its own answer rather than folded into `AWAY`. A
 * laptop with no GPS positions itself from surrounding Wi-Fi and can be a
 * kilometre out; refusing that person as though they were at home would be
 * wrong, and accepting them would make the check meaningless. They are told to
 * try again, which on a phone almost always succeeds.
 */
export type LocationVerdict = 'OFFICE' | 'AWAY' | 'IMPRECISE' | 'UNKNOWN';

/**
 * How wrong a fix may be before it is worthless.
 *
 * 200m: a phone with GPS reports 5–30m outdoors and 10–60m indoors, and a
 * laptop on Wi-Fi positioning typically 30–150m. Beyond that the reading is
 * usually an IP-based guess at the city, which would let somebody in the next
 * town "round" into the office.
 */
export const MAX_FIX_ACCURACY_METERS = 200;

/** Metres between two coordinates, over a sphere. */
export function distanceMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  // The haversine formula. Earth is not a sphere, but across the few kilometres
  // this is ever asked about, the error is centimetres.
  const EARTH_RADIUS_M = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Whether a coordinate pair is a real one. `0,0` is in the Atlantic. */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/**
 * Whether a reported position is at the office.
 *
 * **The radius is compared against the distance alone**, not against distance
 * minus the accuracy. Subtracting the error bar is how a 150m rule quietly
 * becomes a 350m one, and the admin who typed 150 has no way to know. The
 * accuracy is used for one thing only: throwing out readings too vague to mean
 * anything. The radius is meant to be set generously instead, which is a number
 * on a screen somebody can see and change.
 */
export function classifyLocation(
  fix: Fix | null | undefined,
  office: OfficeLocation | null | undefined
): { verdict: LocationVerdict; distance: number | null } {
  if (!office || !isValidCoordinate(office.lat, office.lng)) {
    return { verdict: 'UNKNOWN', distance: null };
  }
  if (!fix || !isValidCoordinate(fix.lat, fix.lng)) {
    return { verdict: 'UNKNOWN', distance: null };
  }

  const distance = Math.round(distanceMeters(fix, office));

  // A reading this vague cannot tell the office from the next suburb.
  if (!Number.isFinite(fix.accuracy) || fix.accuracy > MAX_FIX_ACCURACY_METERS) {
    return { verdict: 'IMPRECISE', distance };
  }

  const radius = Math.max(1, Math.round(office.radiusMeters));
  return { verdict: distance <= radius ? 'OFFICE' : 'AWAY', distance };
}

/** `450 m` / `4.2 km` — for a message somebody has to act on. */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return 'an unknown distance';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

/* -------------------------------------------------------------------------- */
/* Wi-Fi network name                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What the reported Wi-Fi name says about where somebody is.
 *
 * `UNKNOWN` covers both "no office network is configured" and "the device did
 * not report one" — the same distinction `classifyNetwork` draws, for the same
 * reason: a month of `OTHER` must be distinguishable from a setting nobody
 * filled in.
 */
export type WifiVerdict = 'OFFICE' | 'OTHER' | 'UNKNOWN';

/**
 * Normalises a network name for comparison.
 *
 * SSIDs are typed by hand at both ends — once by the admin into Settings, once
 * by the employee on their device — so the comparison is case-insensitive and
 * ignores runs of whitespace. It deliberately does **not** strip punctuation:
 * `Office-5G` and `Office 5G` are routinely two different radios on one router,
 * and folding them together would accept the wrong one.
 */
export function normalizeNetworkName(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

/** The comparison key: `normalizeNetworkName`, case-folded. */
export function networkNameKey(value: string | null | undefined): string {
  return normalizeNetworkName(value).toLowerCase();
}

/** Whether a reported network name is one the admin calls the office. */
export function classifyWifi(
  reported: string | null | undefined,
  officeWifiNames: string[]
): WifiVerdict {
  const allowed = officeWifiNames.map((name) => networkNameKey(name)).filter(Boolean);
  if (allowed.length === 0) return 'UNKNOWN';

  const candidate = networkNameKey(reported);
  if (!candidate) return 'UNKNOWN';

  return allowed.includes(candidate) ? 'OFFICE' : 'OTHER';
}

/**
 * The badge a day carries, from both signals.
 *
 * **Location wins when it has an answer.** It is the stronger evidence by a
 * wide margin: a Wi-Fi name is text somebody typed and can carry anywhere,
 * whereas coordinates say where the phone actually was. So a day whose position
 * was at the office is an office day even if the network name was never set,
 * and a day whose position was five kilometres away is a remote day whatever
 * the device typed.
 *
 * `UNKNOWN` survives only when *neither* signal knows anything — nothing
 * configured, or nothing reported. A month of "Remote" must stay
 * distinguishable from a month of a setting nobody filled in.
 */
export function resolveNetwork(location: LocationVerdict, wifi: WifiVerdict): AttendanceNetwork {
  if (location === 'OFFICE') return 'OFFICE';
  if (location === 'AWAY') return 'REMOTE';

  // Location was unknown or too vague to use — fall back to what was claimed.
  if (wifi === 'OFFICE') return 'OFFICE';
  if (wifi === 'OTHER') return 'REMOTE';
  return 'UNKNOWN';
}

/** Minutes between the first and last activity of the day. */
export function workedMinutes(
  firstAt: number | null | undefined,
  lastAt: number | null | undefined
): number {
  if (!firstAt || !lastAt) return 0;
  const minutes = Math.floor((lastAt - firstAt) / 60_000);
  return minutes > 0 ? minutes : 0;
}

/** `9hr 57min` — the reference dashboard's format. */
export function formatWorkedHours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  if (hours === 0) return `${mins}min`;
  return `${hours}hr ${String(mins).padStart(2, '0')}min`;
}

/** `9:15 AM`, in the business timezone the caller has already applied. */
export function formatClock(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * The status a day earns from the hours actually worked.
 *
 * An admin override always wins — someone at a client site all day worked, and
 * only a human knows that. This is the default the override starts from.
 */
export function deriveStatus(minutes: number, hadActivity: boolean): AttendanceStatus {
  if (!hadActivity) return 'ABSENT';
  if (minutes >= FULL_DAY_MINUTES) return 'PRESENT';
  if (minutes >= HALF_DAY_MINUTES) return 'HALF_DAY';
  return 'HALF_DAY';
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  LEAVE: 'Leave',
  OFF: 'Weekly off',
  UNRECORDED: 'Not recorded',
};

export const NETWORK_LABELS: Record<AttendanceNetwork, string> = {
  OFFICE: 'Office',
  REMOTE: 'Remote',
  UNKNOWN: 'Unverified',
};

export const WIFI_LABELS: Record<WifiVerdict, string> = {
  OFFICE: 'Office Wi-Fi',
  OTHER: 'Other network',
  UNKNOWN: 'Not reported',
};

export const LOCATION_LABELS: Record<LocationVerdict, string> = {
  OFFICE: 'At the office',
  AWAY: 'Away from the office',
  IMPRECISE: 'Location too vague to use',
  UNKNOWN: 'Location not reported',
};

/** Present days ÷ working days, as a percentage. */
export function attendanceRate(
  statuses: AttendanceStatus[]
): { present: number; workingDays: number; percent: number } {
  // Approved leave is not a working day the employee failed to attend, so it
  // leaves the denominator entirely rather than counting as an absence.
  const workingDays = statuses.filter(
    (s) => s !== 'OFF' && s !== 'UNRECORDED' && s !== 'LEAVE'
  ).length;
  // A half day is half a day, not a whole one — counting it as present would
  // let a month of two-hour appearances read as perfect attendance. A late day
  // is a full day attended: the penalty for it is the deduction rule, not a
  // second punishment hidden in the attendance percentage.
  const present = statuses.reduce(
    (total, s) => total + (s === 'PRESENT' || s === 'LATE' ? 1 : s === 'HALF_DAY' ? 0.5 : 0),
    0
  );

  return {
    present,
    workingDays,
    percent: workingDays > 0 ? Math.round((present / workingDays) * 1000) / 10 : 0,
  };
}
