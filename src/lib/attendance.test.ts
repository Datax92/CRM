import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceRate,
  classifyNetwork,
  clientIpFromHeaders,
  deriveStatus,
  formatWorkedHours,
  isValidIp,
  normalizeIp,
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

describe('office / remote classification', () => {
  test('an address on the list is the office', () => {
    assert.equal(classifyNetwork('198.51.100.7', ['198.51.100.7']), 'OFFICE');
  });

  test('anything else is remote', () => {
    assert.equal(classifyNetwork('203.0.113.9', ['198.51.100.7']), 'REMOTE');
  });

  test('matches through the IPv6-mapped form', () => {
    assert.equal(classifyNetwork('::ffff:198.51.100.7', ['198.51.100.7']), 'OFFICE');
  });

  test('an unconfigured allow-list reports UNKNOWN, not REMOTE', () => {
    // A month of "Remote" must not be indistinguishable from a setting nobody
    // has filled in yet.
    assert.equal(classifyNetwork('203.0.113.9', []), 'UNKNOWN');
  });

  test('a missing address reports UNKNOWN even with a list configured', () => {
    assert.equal(classifyNetwork('', ['198.51.100.7']), 'UNKNOWN');
  });

  test('several office lines are all accepted', () => {
    const office = ['198.51.100.7', '203.0.113.1'];
    assert.equal(classifyNetwork('203.0.113.1', office), 'OFFICE');
  });
});

describe('IP validation', () => {
  test('accepts ordinary IPv4 and IPv6', () => {
    assert.equal(isValidIp('198.51.100.7'), true);
    assert.equal(isValidIp('2001:db8::1'), true);
  });

  test('rejects out-of-range octets', () => {
    assert.equal(isValidIp('256.1.1.1'), false);
  });

  test('rejects leading zeros, which some parsers read as octal', () => {
    assert.equal(isValidIp('01.2.3.4'), false);
  });

  test('rejects text and empties', () => {
    assert.equal(isValidIp('office-wifi'), false);
    assert.equal(isValidIp(''), false);
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

  test('leave counts against attendance but is still a working day', () => {
    const { percent } = attendanceRate(['PRESENT', 'LEAVE']);
    assert.equal(percent, 50);
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
