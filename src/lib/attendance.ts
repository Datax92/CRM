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
 *  2. **Location comes from the network, checked on the server.** The office
 *     internet connection has one public IP shared by everyone on it. A request
 *     arriving from it is `OFFICE`; anything else is `REMOTE`. The comparison
 *     happens server-side because a client-side check is trivially bypassed.
 *
 * None of this is proof — no web app can prove where a body is. It raises the
 * cost of faking attendance above the cost of simply doing the job, which is
 * the achievable goal.
 */

export type AttendanceNetwork = 'OFFICE' | 'REMOTE' | 'UNKNOWN';

export type AttendanceStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'LEAVE' | 'OFF' | 'UNRECORDED';

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

/**
 * Whether an address belongs to the office.
 *
 * An empty allow-list means "not configured yet", which reports UNKNOWN rather
 * than REMOTE — the distinction matters, because an admin looking at a month of
 * "Remote" should be able to tell a team working from home from a setting
 * nobody has filled in.
 */
export function classifyNetwork(ip: string, officeIps: string[]): AttendanceNetwork {
  const allowed = officeIps.map(normalizeIp).filter(Boolean);
  if (allowed.length === 0) return 'UNKNOWN';

  const candidate = normalizeIp(ip);
  if (!candidate) return 'UNKNOWN';

  return allowed.includes(candidate) ? 'OFFICE' : 'REMOTE';
}

/** Rejects anything that is not a plain IPv4 or IPv6 address. */
export function isValidIp(value: string): boolean {
  const ip = normalizeIp(value);
  if (!ip) return false;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (ipv4) {
    return ipv4.slice(1).every((part) => {
      const n = Number(part);
      // Reject leading zeros: `01.2.3.4` is ambiguous and some parsers read it
      // as octal.
      return n >= 0 && n <= 255 && String(n) === part;
    });
  }

  return /^[0-9a-f:]+$/.test(ip) && ip.includes(':') && ip.length >= 3;
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

/** Present days ÷ working days, as a percentage. */
export function attendanceRate(
  statuses: AttendanceStatus[]
): { present: number; workingDays: number; percent: number } {
  const workingDays = statuses.filter((s) => s !== 'OFF' && s !== 'UNRECORDED').length;
  // A half day is half a day, not a whole one — counting it as present would
  // let a month of two-hour appearances read as perfect attendance.
  const present = statuses.reduce(
    (total, s) => total + (s === 'PRESENT' ? 1 : s === 'HALF_DAY' ? 0.5 : 0),
    0
  );

  return {
    present,
    workingDays,
    percent: workingDays > 0 ? Math.round((present / workingDays) * 1000) / 10 : 0,
  };
}
