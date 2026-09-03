import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  autoPipelineStage,
  pipelineStage,
  explainPipelineStage,
  readStageOverride,
  meetsColdRule,
  PIPELINE_STAGES,
  COLD_FOLLOW_UP_THRESHOLD,
} from './pipelineStage.ts';

import {
  STAGE_STATUSES,
  STATUS_STAGE,
  USER_SETTABLE_STATUSES,
  stageForStatus,
  statusLabel,
  LEAD_STATUS_LABELS,
} from './leadStatus.ts';

test('the four stages run worst to best', () => {
  assert.deepEqual(PIPELINE_STAGES, ['COLD', 'P3', 'P2', 'P1']);
});

test('every status in a band maps to that band, and nowhere else', () => {
  for (const band of ['P3', 'P2', 'P1'] as const) {
    for (const status of STAGE_STATUSES[band]) {
      assert.equal(stageForStatus(status), band, `${status} should be ${band}`);
    }
  }
});

test('the bands hold exactly the statuses §13 lists', () => {
  assert.deepEqual(STAGE_STATUSES.P3.map((s) => LEAD_STATUS_LABELS[s]), [
    'Accepted',
    'Contacted',
    'Details Sent',
    'Follow-Up',
    'Seems Interested',
    'Negotiation',
    'Not Interested',
    'No Response',
  ]);
  assert.deepEqual(STAGE_STATUSES.P2.map((s) => LEAD_STATUS_LABELS[s]), [
    'Meeting Done',
    'Site Visit Done',
  ]);
  assert.deepEqual(STAGE_STATUSES.P1.map((s) => LEAD_STATUS_LABELS[s]), [
    'Document Received',
    'Token Received',
    'Deal Closed',
  ]);
});

test('no status appears in two bands', () => {
  const all = [...STAGE_STATUSES.P3, ...STAGE_STATUSES.P2, ...STAGE_STATUSES.P1];
  assert.equal(new Set(all).size, all.length);
});

test('picking a status sets the stage — nobody chooses one by hand', () => {
  assert.equal(autoPipelineStage({ status: 'DETAILS_SENT' }), 'P3');
  assert.equal(autoPipelineStage({ status: 'MEETING_DONE' }), 'P2');
  assert.equal(autoPipelineStage({ status: 'SITE_VISIT_DONE' }), 'P2');
  assert.equal(autoPipelineStage({ status: 'TOKEN_RECEIVED' }), 'P1');
  assert.equal(autoPipelineStage({ status: 'CLOSED_WON' }), 'P1');
});

test('negotiation is P3 now, not P1 — it is still only talking', () => {
  assert.equal(autoPipelineStage({ status: 'NEGOTIATION' }), 'P3');
});

test('intake and closed leads carry no stage', () => {
  for (const status of ['NEW', 'ASSIGNED', 'UNASSIGNED_NO_CAPACITY', 'CLOSED_LOST', 'NOT_INTERESTED']) {
    assert.equal(autoPipelineStage({ status }), null, status);
  }
});

/* -------------------------------------------------------------------------- */
/* Cold now needs a person                                                     */
/* -------------------------------------------------------------------------- */

test('the cold threshold is a boundary, not an approximation', () => {
  assert.equal(meetsColdRule({ status: 'FOLLOW_UP', followUpCount: COLD_FOLLOW_UP_THRESHOLD - 1 }), false);
  assert.equal(meetsColdRule({ status: 'FOLLOW_UP', followUpCount: COLD_FOLLOW_UP_THRESHOLD }), true);
});

test('meeting the rule does NOT make a lead cold on its own', () => {
  const chased = { status: 'FOLLOW_UP', followUpCount: 14 };

  const stage = pipelineStage(chased);
  assert.equal(stage.value, 'P3', 'it stays where its status puts it');
  assert.equal(stage.coldPending, true, 'and it is flagged for review');
  assert.equal(stage.manual, false);
});

test('a verified decision is what actually makes it cold', () => {
  const verified = { status: 'FOLLOW_UP', followUpCount: 14, pipelineStageOverride: 'COLD' as const };
  const stage = pipelineStage(verified);

  assert.equal(stage.value, 'COLD');
  assert.equal(stage.manual, true);
  assert.equal(stage.coldPending, false, 'it has been ruled on, so nothing is pending');
});

test('a lead that got somewhere never goes up for cold review', () => {
  for (const status of ['MEETING_DONE', 'SITE_VISIT_DONE', 'DOCUMENT_RECEIVED', 'TOKEN_RECEIVED']) {
    assert.equal(meetsColdRule({ status, followUpCount: 40 }), false, status);
  }
});

test('a closed lead ignores its verified Cold, so it cannot sit in the filter forever', () => {
  const lead = { status: 'NOT_INTERESTED', pipelineStageOverride: 'COLD' as const };
  assert.deepEqual(pipelineStage(lead), { value: null, manual: false, coldPending: false });
});

test('the retired HOT/COLD pins still resolve', () => {
  assert.equal(readStageOverride({ status: 'FOLLOW_UP', temperatureOverride: 'HOT' }), 'P2');
  assert.equal(readStageOverride({ status: 'FOLLOW_UP', temperatureOverride: 'COLD' }), 'COLD');
});

test('a junk override is ignored rather than shown as a stage', () => {
  assert.equal(readStageOverride({ status: 'FOLLOW_UP', pipelineStageOverride: 'P9' as never }), null);
});

test('the explanation names the real test, never an unobservable one', () => {
  const pending = explainPipelineStage({ status: 'FOLLOW_UP', followUpCount: 12 });

  assert.match(pending, /12 follow-ups/);
  assert.match(pending, /verify/i, 'it says a person still has to decide');
  // There is no telephony or inbox integration, so the app cannot know whether
  // anybody answered. Claiming otherwise is a lie the user would catch.
  assert.doesNotMatch(pending, /unanswered|no reply|did not reply/i);
});

test('a lead never holds two stages at once', () => {
  const leads = [
    { status: 'NEGOTIATION' },
    { status: 'MEETING_DONE' },
    { status: 'TOKEN_RECEIVED' },
    { status: 'FOLLOW_UP', followUpCount: 15 },
  ];

  for (const lead of leads) {
    const matches = PIPELINE_STAGES.filter((stage) => pipelineStage(lead).value === stage);
    assert.equal(matches.length, 1, JSON.stringify(lead));
  }
});

/* -------------------------------------------------------------------------- */
/* The status list itself                                                      */
/* -------------------------------------------------------------------------- */

test('every user-settable status has a label and a band, except the lost one', () => {
  for (const status of USER_SETTABLE_STATUSES) {
    assert.ok(LEAD_STATUS_LABELS[status], `${status} has no label`);
    if (status !== 'CLOSED_LOST') {
      assert.ok(STATUS_STAGE[status], `${status} has no band`);
    }
  }
});

test('an unknown stored status is shown, not blanked', () => {
  assert.equal(statusLabel('SOME_OLD_STATUS'), 'Some Old Status');
  assert.equal(statusLabel(''), '—');
  assert.equal(statusLabel('MEETING_DONE'), 'Meeting Done');
});
