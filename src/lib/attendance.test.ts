import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceRate,
  classifyWifi,
  clientIpFromHeaders,
  deriveStatus,
  formatWorkedHours,
  classifyLocation,
  distanceMeters,
  formatDistance,
  isValidCoordinate,
  resolveNetwork,
  normalizeIp,
  normalizeNetworkName,
  workedMinutes,
} from './attendance.ts';

const headers = (map: Record<string, string>) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
});

describe('IP normalisation', () => {
  test('unwraps the IPv4-mapped IPv6 form Node reports on dual-stack sockets', () => {
    assert.equal(normalizeIp('::ffff:203.0.113.9'), '203.0.113.9');
  });

  test('strips a trailing port from IPv4 but never mangles IPv6', () => {
    assert.equal(normalizeIp('203.0.113.9:51234'), '203.0.113.9');
    assert.equal(normalizeIp('2001:db8::1'), '2001:db8::1');
  });

  test('trims and lowercases', () => {
    assert.equal(normalizeIp('  2001:DB8::AB  '), '2001:db8::ab');
  });

  test('empty input stays empty rather than becoming a match', () => {
    assert.equal(normalizeIp(undefined), '');
    assert.equal(normalizeIp(null), '');
  });
});

describe('reading the client address from a proxy chain', () => {
  test('takes the FIRST x-forwarded-for entry, not the last', () => {
    // The last entry is the proxy itself, which is identical for every
    // employee — using it would make every day read the same.
    assert.equal(
      clientIpFromHeaders(headers({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18, 150.172.238.178' })),
      '203.0.113.9'
    );
  });

  test('falls back to x-real-ip', () => {
    assert.equal(clientIpFromHeaders(headers({ 'x-real-ip': '198.51.100.7' })), '198.51.100.7');
  });

  test('no headers yields no address', () => {
    assert.equal(clientIpFromHeaders(headers({})), '');
  });
});

describe('worked time', () => {
  const at = (h: number, m = 0) => new Date(`2026-08-24T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`).getTime();

  test('is the span between first and last activity', () => {
    // 09:15 -> 19:13 is 9h58m. (The design mock labels these same times
    // "9hr 57min"; the mock is a drawing, this is arithmetic.)
    assert.equal(workedMinutes(at(9, 15), at(19, 13)), 598);
  });

  test('formats the way the dashboard shows it', () => {
    assert.equal(formatWorkedHours(598), '9hr 58min');
    assert.equal(formatWorkedHours(45), '45min');
    assert.equal(formatWorkedHours(0), '—');
  });

  test('a single ping is zero minutes, not a negative or a NaN', () => {
    assert.equal(workedMinutes(at(9), at(9)), 0);
    assert.equal(workedMinutes(null, at(9)), 0);
    assert.equal(workedMinutes(at(9), undefined), 0);
  });

  test('a last time before the first cannot produce negative hours', () => {
    assert.equal(workedMinutes(at(19), at(9)), 0);
  });
});

describe('derived day status', () => {
  test('a full day is present', () => {
    assert.equal(deriveStatus(597, true), 'PRESENT');
  });

  test('exactly six hours is still a full day', () => {
    assert.equal(deriveStatus(360, true), 'PRESENT');
  });

  test('a short day is a half day, not an absence', () => {
    assert.equal(deriveStatus(200, true), 'HALF_DAY');
  });

  test('no activity at all is an absence', () => {
    assert.equal(deriveStatus(0, false), 'ABSENT');
  });
});

describe('attendance rate', () => {
  test('counts a half day as half, not as present', () => {
    const { percent } = attendanceRate(['PRESENT', 'PRESENT', 'HALF_DAY', 'PRESENT']);
    assert.equal(percent, 87.5);
  });

  test('weekly offs are not working days', () => {
    const { workingDays } = attendanceRate(['PRESENT', 'OFF', 'PRESENT']);
    assert.equal(workingDays, 2);
  });

  test('unrecorded future days do not drag the rate down', () => {
    const { percent } = attendanceRate(['PRESENT', 'PRESENT', 'UNRECORDED']);
    assert.equal(percent, 100);
  });

  test('a month with no working days is 0%, not a division by zero', () => {
    const { percent } = attendanceRate(['OFF', 'OFF']);
    assert.equal(Number.isFinite(percent), true);
    assert.equal(percent, 0);
  });

  test('approved leave leaves the denominator rather than counting as a miss', () => {
    // Changed with the Attendance module (§7): leave is granted time off, and
    // an approved day must not read as a failure to attend. It drops out of
    // the working days entirely rather than counting as a zero.
    assert.equal(attendanceRate(['PRESENT', 'LEAVE']).percent, 100);
    assert.equal(attendanceRate(['PRESENT', 'LEAVE']).workingDays, 1);
  });

  test('a late day is a full day attended', () => {
    // The penalty for lateness is the deduction rule (§5), not a second,
    // hidden penalty inside the attendance percentage.
    assert.equal(attendanceRate(['LATE']).percent, 100);
    assert.equal(attendanceRate(['PRESENT', 'LATE', 'ABSENT']).percent, 66.7);
  });
});

/* -------------------------------------------------------------------------- */
/* Manual punch — the invariants the Check In / Check Out action relies on      */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors the resolution in `punchAttendance`. Kept here as a pure function so
 * the rules are testable without Firestore — the action applies exactly these
 * two lines to decide what it writes.
 */
function resolvePunch(
  kind: 'IN' | 'OUT',
  existingFirst: Date | null,
  existingLast: Date | null,
  at: Date
): { firstAt: Date | null; lastAt: Date | null } {
  const firstAt = kind === 'IN' ? (existingFirst ?? at) : existingFirst;
  const lastAt =
    kind === 'OUT' ? (existingLast && existingLast > at ? existingLast : at) : existingLast;
  return { firstAt, lastAt };
}

const T = (hhmm: string) => new Date(`2026-09-01T${hhmm}:00Z`);

test('punch: check in opens the day', () => {
  const { firstAt, lastAt } = resolvePunch('IN', null, null, T('09:05'));
  assert.deepEqual(firstAt, T('09:05'));
  assert.equal(lastAt, null);
});

test('punch: a second check in never rewinds the first', () => {
  const { firstAt } = resolvePunch('IN', T('09:05'), null, T('11:30'));
  assert.deepEqual(firstAt, T('09:05'), 'the earliest check-in of the day stands');
});

test('punch: check out closes the day', () => {
  const { firstAt, lastAt } = resolvePunch('OUT', T('09:05'), null, T('18:10'));
  assert.deepEqual(firstAt, T('09:05'));
  assert.deepEqual(lastAt, T('18:10'));
  assert.equal(workedMinutes(firstAt!.getTime(), lastAt!.getTime()), 545);
});

test('punch: a later check out extends the day', () => {
  const { lastAt } = resolvePunch('OUT', T('09:05'), T('17:00'), T('18:10'));
  assert.deepEqual(lastAt, T('18:10'));
});

test('punch: an earlier check out never shortens a recorded day', () => {
  // A stray tap, or a request that arrives late, must not cost someone an hour.
  const { lastAt } = resolvePunch('OUT', T('09:05'), T('18:10'), T('17:00'));
  assert.deepEqual(lastAt, T('18:10'));
});

test('punch: a day checked in but not out is never graded absent', () => {
  // `workedMinutes` is 0 until check-out, and 0 minutes with a record present
  // must still count as attendance — otherwise everyone reads absent all morning.
  assert.equal(deriveStatus(0, true), 'HALF_DAY');
  assert.notEqual(deriveStatus(0, true), 'ABSENT');
});


/* -------------------------------------------------------------------------- */
/* The Wi-Fi name — a declared signal                                          */
/* -------------------------------------------------------------------------- */

describe('office Wi-Fi classification', () => {
  test('case and stray whitespace do not matter', () => {
    assert.equal(classifyWifi('  leadway   office ', ['Leadway Office']), 'OFFICE');
  });

  test('punctuation does matter — two radios are two networks', () => {
    assert.equal(classifyWifi('Office 5G', ['Office-5G']), 'OTHER');
  });

  test('an unconfigured list is UNKNOWN, not OTHER', () => {
    assert.equal(classifyWifi('Anything', []), 'UNKNOWN');
  });

  test('a device that reported nothing is UNKNOWN, not OTHER', () => {
    assert.equal(classifyWifi('', ['Leadway-Office']), 'UNKNOWN');
    assert.equal(classifyWifi(null, ['Leadway-Office']), 'UNKNOWN');
  });

  test('any one of several office networks is accepted', () => {
    const office = ['Leadway-Office', 'Leadway-Office 5G'];
    assert.equal(classifyWifi('Leadway-Office 5G', office), 'OFFICE');
    assert.equal(classifyWifi('Cafe-Guest', office), 'OTHER');
  });

  test('normalising keeps what the admin typed, minus the noise', () => {
    assert.equal(normalizeNetworkName('  Leadway   Office  '), 'Leadway Office');
    assert.equal(normalizeNetworkName(undefined), '');
  });
});

describe('the badge a day carries', () => {
  test('location decides it whenever location has an answer', () => {
    // The strong signal wins outright: a Wi-Fi name is text somebody typed and
    // can carry home, a position is where the phone actually was.
    assert.equal(resolveNetwork('OFFICE', 'UNKNOWN'), 'OFFICE');
    assert.equal(resolveNetwork('OFFICE', 'OTHER'), 'OFFICE');
    assert.equal(resolveNetwork('AWAY', 'OFFICE'), 'REMOTE');
  });

  test('the network name is the fallback when location knows nothing', () => {
    assert.equal(resolveNetwork('UNKNOWN', 'OFFICE'), 'OFFICE');
    assert.equal(resolveNetwork('UNKNOWN', 'OTHER'), 'REMOTE');
    assert.equal(resolveNetwork('IMPRECISE', 'OFFICE'), 'OFFICE');
  });

  test('nothing configured, or nothing reported, stays unverified', () => {
    // A month of "Remote" must stay distinguishable from a month of nobody
    // having filled the settings in.
    assert.equal(resolveNetwork('UNKNOWN', 'UNKNOWN'), 'UNKNOWN');
  });
});

/* -------------------------------------------------------------------------- */
/* The address is recorded, never matched                                      */
/* -------------------------------------------------------------------------- */

describe('the address after the allow-list was removed', () => {
  test('it is still read off the request, first hop first', () => {
    // Still recorded on every punch, and still the thing an admin checks a
    // suspicious day against — there is simply nothing to compare it to.
    assert.equal(
      clientIpFromHeaders({
        get: (name: string) =>
          name.toLowerCase() === 'x-forwarded-for'
            ? '203.0.113.9, 70.41.3.18, 150.172.238.178'
            : null,
      }),
      '203.0.113.9'
    );
  });

  test('normalising still unwraps the dual-stack form', () => {
    assert.equal(normalizeIp('::ffff:203.0.113.9'), '203.0.113.9');
  });
});


/* -------------------------------------------------------------------------- */
/* Where the device says it is                                                 */
/* -------------------------------------------------------------------------- */

/** A real office, and points measured off it. Karachi, so the maths is real. */
const OFFICE = { lat: 24.8607, lng: 67.0011, radiusMeters: 150 };

describe('distance between two points', () => {
  test('the same point is zero', () => {
    assert.equal(Math.round(distanceMeters(OFFICE, OFFICE)), 0);
  });

  test('a tenth of a degree of latitude is about 11 km', () => {
    // Latitude is the one axis with a constant scale, so this pins the formula
    // against a number that can be checked by hand: 1 degree = 111.19 km.
    const north = { lat: OFFICE.lat + 0.1, lng: OFFICE.lng };
    const metres = distanceMeters(OFFICE, north);
    assert.ok(metres > 11_000 && metres < 11_200, `got ${metres}`);
  });

  test('longitude shrinks with latitude, and the formula knows it', () => {
    // At 24.86 N a degree of longitude is cos(24.86) = 0.907 of a degree of
    // latitude. Subtracting coordinates flat would miss this entirely.
    const east = { lat: OFFICE.lat, lng: OFFICE.lng + 0.1 };
    const metres = distanceMeters(OFFICE, east);
    assert.ok(metres > 10_000 && metres < 10_200, `got ${metres}`);
  });

  test('it is symmetric', () => {
    const other = { lat: 24.9, lng: 67.1 };
    assert.equal(
      Math.round(distanceMeters(OFFICE, other)),
      Math.round(distanceMeters(other, OFFICE))
    );
  });
});

describe('is this person at the office', () => {
  test('standing in it is at it', () => {
    const at = classifyLocation({ lat: 24.8607, lng: 67.0011, accuracy: 20 }, OFFICE);
    assert.equal(at.verdict, 'OFFICE');
    assert.equal(at.distance, 0);
  });

  test('just inside the radius is still at it', () => {
    // ~110m north.
    const near = classifyLocation({ lat: 24.8617, lng: 67.0011, accuracy: 20 }, OFFICE);
    assert.equal(near.verdict, 'OFFICE');
  });

  test('home is away, and the distance is reported for the message', () => {
    const home = classifyLocation({ lat: 24.9, lng: 67.05, accuracy: 20 }, OFFICE);
    assert.equal(home.verdict, 'AWAY');
    assert.ok((home.distance ?? 0) > 4_000);
  });

  test('a vague reading is IMPRECISE, never AWAY', () => {
    // A laptop positioning itself from surrounding Wi-Fi can be a kilometre
    // out. Refusing that person as though they were at home would be wrong;
    // accepting them would make the check meaningless. They retry.
    const vague = classifyLocation({ lat: 24.8607, lng: 67.0011, accuracy: 1_500 }, OFFICE);
    assert.equal(vague.verdict, 'IMPRECISE');
  });

  test('a vague reading from far away is still only IMPRECISE', () => {
    const vague = classifyLocation({ lat: 24.9, lng: 67.05, accuracy: 1_500 }, OFFICE);
    assert.equal(vague.verdict, 'IMPRECISE');
  });

  test('the error bar is never subtracted from the distance', () => {
    // ~300m away with a 190m error bar. Allowing `distance - accuracy <= radius`
    // would pass this, quietly turning a 150m rule into a 340m one that the
    // admin who typed 150 has no way to see.
    const away = classifyLocation({ lat: 24.8634, lng: 67.0011, accuracy: 190 }, OFFICE);
    assert.equal(away.verdict, 'AWAY');
  });

  test('no office marked refuses nobody', () => {
    // Enforcing against an unconfigured setting is how the address allow-list
    // locked the whole company out.
    assert.equal(
      classifyLocation({ lat: 24.8607, lng: 67.0011, accuracy: 10 }, null).verdict,
      'UNKNOWN'
    );
  });

  test('no position given is UNKNOWN, not AWAY', () => {
    assert.equal(classifyLocation(null, OFFICE).verdict, 'UNKNOWN');
  });

  test('a wider radius accepts a wider area', () => {
    const wide = { ...OFFICE, radiusMeters: 1_000 };
    const near = classifyLocation({ lat: 24.8657, lng: 67.0011, accuracy: 20 }, wide);
    assert.equal(near.verdict, 'OFFICE');
  });
});

describe('coordinate validation', () => {
  test('accepts a real place', () => {
    assert.equal(isValidCoordinate(24.8607, 67.0011), true);
  });

  test('rejects null island, which is what an unset field looks like', () => {
    assert.equal(isValidCoordinate(0, 0), false);
  });

  test('rejects out-of-range values and non-numbers', () => {
    assert.equal(isValidCoordinate(91, 0), false);
    assert.equal(isValidCoordinate(0, 181), false);
    assert.equal(isValidCoordinate('24.8', 67), false);
    assert.equal(isValidCoordinate(Number.NaN, 67), false);
  });
});

describe('distance, as somebody reads it', () => {
  test('metres below a kilometre, kilometres above', () => {
    assert.equal(formatDistance(420), '420 m');
    assert.equal(formatDistance(4_200), '4.2 km');
    assert.equal(formatDistance(42_000), '42 km');
  });

  test('no distance says so rather than reading zero', () => {
    assert.equal(formatDistance(null), 'an unknown distance');
  });
});
