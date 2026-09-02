import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  autoPipelineStage,
  pipelineStage,
  explainPipelineStage,
  readStageOverride,
  PIPELINE_STAGES,
  COLD_FOLLOW_UP_THRESHOLD,
} from './pipelineStage.ts';

test('the four stages run worst to best', () => {
  assert.deepEqual(PIPELINE_STAGES, ['COLD', 'P3', 'P2', 'P1']);
});

test('negotiation is P1 — final steps only', () => {
  assert.equal(autoPipelineStage({ status: 'NEGOTIATION' }), 'P1');
});

test('interested is P2', () => {
  assert.equal(autoPipelineStage({ status: 'INTERESTED' }), 'P2');
});

test('a held meeting lifts a lead to P2 whatever the status says', () => {
  assert.equal(autoPipelineStage({ status: 'FOLLOW_UP', meetingHeld: true }), 'P2');
});

test('a lead being worked normally is P3', () => {
  assert.equal(autoPipelineStage({ status: 'CONTACTED' }), 'P3');
  assert.equal(autoPipelineStage({ status: 'FOLLOW_UP', followUpCount: 3 }), 'P3');
});

test('the cold threshold is a boundary, not an approximation', () => {
  const nine = { status: 'FOLLOW_UP', followUpCount: COLD_FOLLOW_UP_THRESHOLD - 1 };
  const ten = { status: 'FOLLOW_UP', followUpCount: COLD_FOLLOW_UP_THRESHOLD };

  assert.equal(autoPipelineStage(nine), 'P3');
  assert.equal(autoPipelineStage(ten), 'COLD');
});

test('a lead that engaged never goes cold, however many calls it took', () => {
  assert.equal(autoPipelineStage({ status: 'NEGOTIATION', followUpCount: 40 }), 'P1');
  assert.equal(autoPipelineStage({ status: 'INTERESTED', followUpCount: 40 }), 'P2');
});

test('intake and closed leads carry no stage', () => {
  for (const status of ['NEW', 'UNASSIGNED_NO_CAPACITY', 'CLOSED_WON', 'CLOSED_LOST', 'NOT_INTERESTED']) {
    assert.equal(autoPipelineStage({ status }), null, status);
  }
});

test('a manual stage overrules the rule and is marked as manual', () => {
  const lead = { status: 'FOLLOW_UP', followUpCount: 20, pipelineStageOverride: 'P1' as const };
  assert.deepEqual(pipelineStage(lead), { value: 'P1', manual: true });
});

test('a closed lead ignores its pin, so it cannot sit in a working filter forever', () => {
  const lead = { status: 'CLOSED_LOST', pipelineStageOverride: 'P1' as const };
  assert.deepEqual(pipelineStage(lead), { value: null, manual: false });
});

test('the retired HOT/COLD pins still resolve', () => {
  assert.equal(readStageOverride({ status: 'FOLLOW_UP', temperatureOverride: 'HOT' }), 'P2');
  assert.equal(readStageOverride({ status: 'FOLLOW_UP', temperatureOverride: 'COLD' }), 'COLD');
});

test('a junk override is ignored rather than shown as a stage', () => {
  assert.equal(readStageOverride({ status: 'FOLLOW_UP', pipelineStageOverride: 'P9' as never }), null);
  assert.equal(pipelineStage({ status: 'CONTACTED', pipelineStageOverride: '' as never }).manual, false);
});

test('the explanation names the real test, never an unobservable one', () => {
  const cold = explainPipelineStage({ status: 'FOLLOW_UP', followUpCount: 12 });

  assert.match(cold, /12 follow-ups/);
  // There is no telephony or inbox integration, so the app cannot know whether
  // anybody answered. Claiming otherwise in the copy would be a lie the user
  // would eventually catch.
  assert.doesNotMatch(cold, /unanswered|no response|did not reply/i);
});

test('a lead never holds two stages at once', () => {
  const leads = [
    { status: 'NEGOTIATION' },
    { status: 'INTERESTED' },
    { status: 'CONTACTED' },
    { status: 'FOLLOW_UP', followUpCount: 15 },
  ];

  for (const lead of leads) {
    const matches = PIPELINE_STAGES.filter((stage) => pipelineStage(lead).value === stage);
    assert.equal(matches.length, 1, JSON.stringify(lead));
  }
});
