import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVITY_FILTERS,
  ACTIVITY_FILTER_HINTS,
  ADMIN_FILTER_ORDER,
  EMPLOYEE_FILTER_ORDER,
  LEAD_FILTER_LABELS,
  countByFilter,
  isActivityFilter,
  isStageFilter,
  matchesActivityFilter,
  matchesLeadFilter,
  parseFilterParam,
} from './leadBuckets.ts';

/**
 * The activity cuts (Remarks / Follow-ups / Connected) read the counters the
 * follow-up transaction maintains on the lead. **The first entry on a lead is
 * its Remark and the rest are Follow-Ups**, so the two thresholds differ by
 * exactly one — which is the only thing here that is easy to get wrong.
 */

const untouched = { status: 'ACCEPTED', followUpCount: 0, connectCount: 0 };
const remarked = { status: 'ACCEPTED', followUpCount: 1, connectCount: 0 };
const followedUp = { status: 'CONTACTED', followUpCount: 2, connectCount: 0 };
const connected = { status: 'CONTACTED', followUpCount: 1, connectCount: 1 };

test('a lead with no entries answers none of the activity cuts', () => {
  for (const key of ACTIVITY_FILTERS) {
    assert.equal(matchesActivityFilter(untouched, key), false, key);
  }
});

test('one entry is a Remark, and is not yet a follow-up', () => {
  assert.equal(matchesActivityFilter(remarked, 'REMARKED'), true);
  assert.equal(matchesActivityFilter(remarked, 'FOLLOWED_UP'), false);
});

test('a lead that reaches its first follow-up LEAVES Remarks', () => {
  // The two are stops on one road. A Remarks cut that still returned every
  // lead with fifteen follow-ups could not answer the only question it exists
  // for: who has been remarked on and not chased yet.
  assert.equal(matchesActivityFilter(followedUp, 'REMARKED'), false);
  assert.equal(matchesActivityFilter(followedUp, 'FOLLOWED_UP'), true);
});

test('Remarks and Follow-ups never both hold the same lead', () => {
  for (let entries = 0; entries <= 12; entries += 1) {
    const lead = { status: 'CONTACTED', followUpCount: entries };
    const inRemarks = matchesActivityFilter(lead, 'REMARKED');
    const inFollowUps = matchesActivityFilter(lead, 'FOLLOWED_UP');

    assert.equal(inRemarks && inFollowUps, false, `${entries} entries is in both`);
    // And every worked lead is in exactly one of them.
    assert.equal(inRemarks || inFollowUps, entries >= 1, `${entries} entries is in neither`);
  }
});

test('Connected is a connect count, not an entry count, and cuts across both', () => {
  assert.equal(matchesActivityFilter(connected, 'CONNECTED'), true);
  assert.equal(matchesActivityFilter(followedUp, 'CONNECTED'), false);

  // A one-entry lead that connected is in Remarks and in Connected; a
  // many-entry one is in Follow-ups and in Connected. Connected asks a
  // different question, so it overlaps both on purpose.
  assert.equal(matchesActivityFilter(connected, 'REMARKED'), true);
  const chased = { status: 'CONTACTED', followUpCount: 5, connectCount: 2 };
  assert.equal(matchesActivityFilter(chased, 'FOLLOWED_UP'), true);
  assert.equal(matchesActivityFilter(chased, 'CONNECTED'), true);
  assert.equal(matchesActivityFilter(chased, 'REMARKED'), false);
});

test('a call too short to connect is not in Connected', () => {
  // `connectCount` only moves at CONNECT_MIN_SECONDS or longer — the same rule
  // the KPI and the report use. A logged call under it is contact, not a
  // connect, and counting it here would make three screens disagree.
  const called = { status: 'CONTACTED', followUpCount: 3, callCount: 3, connectCount: 0 };
  assert.equal(matchesActivityFilter(called, 'CONNECTED'), false);
  assert.equal(matchesActivityFilter(called, 'FOLLOWED_UP'), true);
});

test('missing counters read as nothing done, not as something done', () => {
  assert.equal(matchesActivityFilter({ status: 'ACCEPTED' }, 'REMARKED'), false);
  assert.equal(matchesActivityFilter({ status: 'ACCEPTED' }, 'CONNECTED'), false);
});

test('the activity cuts cut across the workflow buckets', () => {
  // A closed lead somebody worked still answers "did they connect with it".
  const closedButWorked = { status: 'CLOSED_WON', followUpCount: 4, connectCount: 2 };

  assert.equal(matchesLeadFilter(closedButWorked, 'CLOSED'), true);
  assert.equal(matchesLeadFilter(closedButWorked, 'CONNECTED'), true);
  assert.equal(matchesLeadFilter(closedButWorked, 'FOLLOWED_UP'), true);
  assert.equal(matchesLeadFilter(closedButWorked, 'REMARKED'), false);
});

test('an activity key is neither a stage nor a bucket', () => {
  for (const key of ACTIVITY_FILTERS) {
    assert.equal(isActivityFilter(key), true, key);
    assert.equal(isStageFilter(key), false, key);
  }
  assert.equal(isActivityFilter('P2'), false);
  assert.equal(isActivityFilter('ACTIVE'), false);
});

test('every activity cut has a label and an explanation', () => {
  for (const key of ACTIVITY_FILTERS) {
    assert.ok(LEAD_FILTER_LABELS[key], `${key} has no label`);
    assert.ok(ACTIVITY_FILTER_HINTS[key], `${key} has no hint`);
  }
});

test('the counts include the activity cuts alongside the buckets', () => {
  // untouched: 0 entries · remarked: 1 · followedUp: 2 · connected: 1 + a connect
  const counts = countByFilter([untouched, remarked, followedUp, connected]);

  assert.equal(counts.ALL, 4);
  assert.equal(counts.REMARKED, 2, 'the two one-entry leads');
  assert.equal(counts.FOLLOWED_UP, 1);
  assert.equal(counts.CONNECTED, 1);
  // The two cuts partition the worked leads, so they add up to them exactly.
  assert.equal(counts.REMARKED + counts.FOLLOWED_UP, 3);
});

test('a freshly accepted lead is counted in no pipeline band', () => {
  // The band starts at the Remark — see `pipelineStage`. Two accepted leads,
  // one worked and one not, must not both read as P3.
  const counts = countByFilter([untouched, remarked]);

  assert.equal(counts.P3, 1);
  assert.equal(counts.ACTIVE, 2, 'both are still being worked, band or no band');
});

test('the workspace chip rows are unchanged by the new cuts', () => {
  // These are dossier cuts. Adding them to the pipeline chip row would put
  // four more chips over a screen that answers a different question.
  for (const key of ACTIVITY_FILTERS) {
    assert.equal(ADMIN_FILTER_ORDER.includes(key), false, key);
    assert.equal(EMPLOYEE_FILTER_ORDER.includes(key), false, key);
  }
});

test('an activity cut is not accepted as a URL filter', () => {
  assert.equal(parseFilterParam('connected', 'admin'), 'ALL');
  assert.equal(parseFilterParam('active', 'admin'), 'ACTIVE');
});
