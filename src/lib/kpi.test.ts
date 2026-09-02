import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONNECT_MIN_SECONDS,
  DEFAULT_KPI_TARGETS,
  EMPTY_KPI_COUNTS,
  formatDuration,
  isConnect,
  kpiScore,
  monthKey,
  normalizeDurationSeconds,
  parseMonthKey,
  priorityFromScores,
  readKpi,
  sumCounts,
  ytdTargets,
  type KpiCounts,
} from './kpi.ts';

const counts = (over: Partial<KpiCounts> = {}): KpiCounts => ({ ...EMPTY_KPI_COUNTS, ...over });

describe('the connect rule', () => {
  test('1 minute 10 seconds is the threshold', () => {
    assert.equal(CONNECT_MIN_SECONDS, 70);
  });

  test('a call exactly on the threshold counts', () => {
    assert.equal(isConnect(70), true);
  });

  test('one second short does not count', () => {
    assert.equal(isConnect(69), false);
  });

  test('a long call counts', () => {
    assert.equal(isConnect(600), true);
  });

  test('a missing or nonsense duration is not a connect', () => {
    assert.equal(isConnect(null), false);
    assert.equal(isConnect(undefined), false);
    assert.equal(isConnect(Number.NaN), false);
    assert.equal(isConnect(-70), false);
  });
});

describe('duration handling', () => {
  test('negatives and rubbish collapse to zero', () => {
    assert.equal(normalizeDurationSeconds(-5), 0);
    assert.equal(normalizeDurationSeconds('abc'), 0);
    assert.equal(normalizeDurationSeconds(undefined), 0);
  });

  test('fractional seconds are floored, not rounded up past the threshold', () => {
    assert.equal(normalizeDurationSeconds(69.9), 69);
    assert.equal(isConnect(normalizeDurationSeconds(69.9)), false);
  });

  test('an absurd duration is clamped rather than accepted', () => {
    assert.equal(normalizeDurationSeconds(99_999_999), 4 * 60 * 60);
  });

  test('formats the way a call log reads', () => {
    assert.equal(formatDuration(70), '1:10');
    assert.equal(formatDuration(45), '0:45');
    assert.equal(formatDuration(3750), '1:02:30');
    assert.equal(formatDuration(0), '—');
  });
});

describe('KPI readings', () => {
  test('actual over target, as a percentage', () => {
    const reading = readKpi('connects', 620, 200);
    assert.equal(reading.percent, 310);
  });

  test('under target reads under 100%', () => {
    assert.equal(readKpi('registrations', 5, 8).percent, 63);
  });

  test('a zero target reports 0% instead of dividing by zero', () => {
    const reading = readKpi('meetings', 40, 0);
    assert.equal(Number.isFinite(reading.ratio), true);
    assert.equal(reading.percent, 0);
  });
});

describe('year-to-date targets', () => {
  test('scale with the months elapsed', () => {
    const yearly = ytdTargets(DEFAULT_KPI_TARGETS, 8);
    assert.equal(yearly.connects, DEFAULT_KPI_TARGETS.connects * 8);
    assert.equal(yearly.registrations, DEFAULT_KPI_TARGETS.registrations * 8);
  });

  test('never scale below one month, so January is not a division by zero', () => {
    assert.deepEqual(ytdTargets(DEFAULT_KPI_TARGETS, 0), DEFAULT_KPI_TARGETS);
  });
});

describe('the performance score', () => {
  test('hitting every target exactly scores 1', () => {
    const onTarget = counts({
      connects: DEFAULT_KPI_TARGETS.connects,
      registrations: DEFAULT_KPI_TARGETS.registrations,
      meetings: DEFAULT_KPI_TARGETS.meetings,
    });
    assert.equal(kpiScore(onTarget, DEFAULT_KPI_TARGETS), 1);
  });

  test('doing nothing scores 0', () => {
    assert.equal(kpiScore(EMPTY_KPI_COUNTS, DEFAULT_KPI_TARGETS), 0);
  });

  test('one runaway metric cannot mask two failing ones', () => {
    const lopsided = counts({ meetings: DEFAULT_KPI_TARGETS.meetings * 40 });
    const balanced = counts({
      connects: DEFAULT_KPI_TARGETS.connects * 0.8,
      registrations: DEFAULT_KPI_TARGETS.registrations * 0.8,
      meetings: DEFAULT_KPI_TARGETS.meetings * 0.8,
    });

    // 788% on meetings alone is worth its 20% weight and no more.
    assert.ok(kpiScore(balanced, DEFAULT_KPI_TARGETS) > kpiScore(lopsided, DEFAULT_KPI_TARGETS));
  });

  test('never exceeds 1, however far over target someone is', () => {
    const runaway = counts({ connects: 1e6, registrations: 1e6, meetings: 1e6 });
    assert.equal(kpiScore(runaway, DEFAULT_KPI_TARGETS), 1);
  });
});

describe('automatic lane priority', () => {
  test('the best performer goes first in line', () => {
    const assigned = priorityFromScores(
      [
        { uid: 'b', score: 0.4 },
        { uid: 'a', score: 0.9 },
        { uid: 'c', score: 0.6 },
      ],
      1,
      10
    );
    assert.equal(assigned.get('a'), 1);
    assert.equal(assigned.get('c'), 2);
    assert.equal(assigned.get('b'), 3);
  });

  test('ties break on uid, so repeated runs do not shuffle the lane', () => {
    const input = [
      { uid: 'zara', score: 0.5 },
      { uid: 'adam', score: 0.5 },
    ];
    assert.deepEqual(
      [...priorityFromScores(input, 1, 10)],
      [...priorityFromScores([...input].reverse(), 1, 10)]
    );
    assert.equal(priorityFromScores(input, 1, 10).get('adam'), 1);
  });

  test('a team larger than the priority scale piles up at the bottom', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      uid: `emp-${String(i).padStart(2, '0')}`,
      score: 1 - i / 100,
    }));
    const assigned = priorityFromScores(many, 1, 10);

    assert.equal(assigned.get('emp-00'), 1);
    assert.equal(assigned.get('emp-09'), 10);
    // Everyone past the scale sits on the last lane rather than overflowing it.
    assert.equal(assigned.get('emp-13'), 10);
  });

  test('an empty team produces no assignments', () => {
    assert.equal(priorityFromScores([], 1, 10).size, 0);
  });
});

describe('month keys', () => {
  test('pad to a sortable form', () => {
    assert.equal(monthKey(2026, 8), '2026-08');
    assert.ok(monthKey(2026, 8) < monthKey(2026, 11));
  });

  test('round-trip', () => {
    assert.deepEqual(parseMonthKey('2026-08'), { year: 2026, month: 8 });
  });

  test('reject anything that is not a month', () => {
    assert.equal(parseMonthKey('2026-13'), null);
    assert.equal(parseMonthKey('2026-8'), null);
    assert.equal(parseMonthKey('nonsense'), null);
  });
});

describe('summing counters', () => {
  test('adds every field across months', () => {
    const total = sumCounts([
      { connects: 10, registrations: 1, revenue: 100 },
      { connects: 5, meetings: 3, revenue: 250 },
    ]);
    assert.deepEqual(total, { calls: 0, connects: 15, registrations: 1, meetings: 3, revenue: 350 });
  });

  test('an empty list sums to zero, not to undefined', () => {
    assert.deepEqual(sumCounts([]), EMPTY_KPI_COUNTS);
  });
});
