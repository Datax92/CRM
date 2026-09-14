import test from 'node:test';
import assert from 'node:assert/strict';

import {
  leadScore,
  leadScoreBreakdown,
  readLeadActivity,
  assignPriorities,
  LEAD_SCORE_WEIGHTS,
} from './leadPriority.ts';

/* -------------------------------------------------------------------------- */
/* The score                                                                   */
/* -------------------------------------------------------------------------- */

test("the owner's worked example: 18 connects and 24 follow-ups is 60", () => {
  assert.equal(leadScore({ connects: 18, followUps: 24, passes: 0 }), 60);
});

test('a connect is worth two follow-ups, not one', () => {
  // The whole reason the weights are not equal: logging notes must not outrank
  // having conversations.
  const talker = leadScore({ connects: 10, followUps: 0, passes: 0 });
  const typist = leadScore({ connects: 0, followUps: 10, passes: 0 });
  assert.equal(talker, 20);
  assert.equal(typist, 10);
  assert.ok(talker > typist);

  // Twenty notes exactly equal ten conversations — the point of the ratio.
  assert.equal(leadScore({ connects: 0, followUps: 20, passes: 0 }), talker);
});

test('passing a lead costs two points — one connected call given back', () => {
  const worked = { connects: 10, followUps: 0, passes: 0 };
  const passedOnce = { connects: 10, followUps: 0, passes: 1 };
  assert.equal(leadScore(worked) - leadScore(passedOnce), LEAD_SCORE_WEIGHTS.pass);
});

test('a month of nothing but passes floors at zero, never negative', () => {
  // A negative score would sort a passer *below* somebody who did nothing at
  // all. Both did no work; the lane must not invent a distinction.
  assert.equal(leadScore({ connects: 0, followUps: 0, passes: 9 }), 0);
  assert.equal(leadScore({ connects: 0, followUps: 0, passes: 0 }), 0);
  assert.equal(leadScore({ connects: 1, followUps: 0, passes: 5 }), 0);
});

test('junk counters read as zero rather than poisoning the arithmetic', () => {
  const activity = readLeadActivity({ connects: 'x', followUps: -4, passes: null });
  assert.deepEqual(activity, { connects: 0, followUps: 0, passes: 0 });
  assert.equal(leadScore(activity), 0);
  // A missing document is a zero month, not a crash.
  assert.deepEqual(readLeadActivity(undefined), { connects: 0, followUps: 0, passes: 0 });
});

test('the breakdown adds up to the score the lane sorts on', () => {
  const parts = leadScoreBreakdown({ connects: 5, followUps: 3, passes: 1 });
  assert.equal(parts.connects, 10);
  assert.equal(parts.followUps, 3);
  assert.equal(parts.passes, -2);
  assert.equal(parts.total, 11);
});

/* -------------------------------------------------------------------------- */
/* The lane                                                                    */
/* -------------------------------------------------------------------------- */

test('the best score takes priority 1, in order', () => {
  const lane = assignPriorities(
    [
      { uid: 'c', score: 10 },
      { uid: 'a', score: 60 },
      { uid: 'b', score: 35 },
    ],
    1,
    10
  );
  assert.equal(lane.get('a'), 1);
  assert.equal(lane.get('b'), 2);
  assert.equal(lane.get('c'), 3);
});

test('ties break on uid, so the same input always gives the same lane', () => {
  const once = assignPriorities([{ uid: 'z', score: 5 }, { uid: 'a', score: 5 }], 1, 10);
  const twice = assignPriorities([{ uid: 'a', score: 5 }, { uid: 'z', score: 5 }], 1, 10);
  assert.equal(once.get('a'), twice.get('a'));
  assert.equal(once.get('z'), twice.get('z'));
  assert.equal(once.get('a'), 1, 'a sorts before z');
});

test('a priority an admin pinned by hand is never moved', () => {
  // `autoPriority: false` means "this person is first whatever the numbers
  // say". A nightly recalculation undoing that would make the control useless.
  const lane = assignPriorities(
    [
      { uid: 'star', score: 0, autoPriority: false, priority: 1 },
      { uid: 'best', score: 90 },
      { uid: 'next', score: 40 },
    ],
    1,
    10
  );
  assert.equal(lane.get('star'), 1, 'pinned and kept, despite scoring zero');
  assert.equal(lane.get('best'), 2, 'the automatic ones fill what is left');
  assert.equal(lane.get('next'), 3);
});

test('everyone still gets a distinct place when several are pinned', () => {
  const lane = assignPriorities(
    [
      { uid: 'p1', score: 0, autoPriority: false, priority: 2 },
      { uid: 'p2', score: 0, autoPriority: false, priority: 4 },
      { uid: 'a', score: 50 },
      { uid: 'b', score: 30 },
      { uid: 'c', score: 10 },
    ],
    1,
    10
  );
  assert.equal(lane.get('p1'), 2);
  assert.equal(lane.get('p2'), 4);
  const auto = [lane.get('a'), lane.get('b'), lane.get('c')];
  assert.deepEqual(auto, [1, 3, 5], 'automatic people fill the gaps in score order');
  assert.equal(new Set([...lane.values()]).size, 5, 'no two people share a place');
});

test('the lane never runs past its ceiling', () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ uid: `u${i}`, score: 100 - i }));
  const lane = assignPriorities(many, 1, 10);
  for (const value of lane.values()) {
    assert.ok(value >= 1 && value <= 10, `priority ${value} is outside 1..10`);
  }
});

test('an empty roster produces an empty lane rather than throwing', () => {
  assert.equal(assignPriorities([], 1, 10).size, 0);
});
