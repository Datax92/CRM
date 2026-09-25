import test from 'node:test';
import assert from 'node:assert/strict';

import { overlayFollowUps, overlayLeads, pendingStamp, type QueuedItem } from './outboxOverlay.ts';

const item = (name: string, args: unknown[], at = 1_000): QueuedItem => ({ id: `${name}-${at}`, name, args, at });

test('nothing queued leaves a list untouched', () => {
  const rows = [{ id: 'a', status: 'ASSIGNED' }];
  assert.equal(overlayLeads(rows, []), rows);
});

test('a queued status change, accept and pass show as made', () => {
  const rows = [
    { id: 'a', status: 'ASSIGNED' },
    { id: 'b', status: 'ACCEPTED' },
    { id: 'c', status: 'ASSIGNED' },
  ];
  const out = overlayLeads(rows, [
    item('acceptLead', ['a']),
    item('setLeadStatus', ['b', 'CONTACTED']),
    item('passLead', ['c']),
  ]);
  assert.deepEqual(out, [
    { id: 'a', status: 'ACCEPTED' },
    { id: 'b', status: 'CONTACTED' },
  ]);
});

test('a queued remark appears on its own lead, newest first, with its real time', () => {
  const rows = [{ id: 'old', occurredAt: pendingStamp(500), message: 'first' }];
  const out = overlayFollowUps('L1', rows, [
    item('addFollowUp', ['L1', { message: 'second', occurredAt: new Date(2_000).toISOString(), durationSeconds: 90 }], 3_000),
    item('addFollowUp', ['L2', { message: 'elsewhere' }]),
  ]);
  assert.equal(out.length, 2);
  assert.equal((out[0] as { message: string }).message, 'second');
  assert.equal((out[0] as { occurredAt: { toMillis(): number } }).occurredAt.toMillis(), 2_000);
  assert.equal((out[0] as unknown as { connect: boolean }).connect, true);
  assert.equal(out[0].id.startsWith('pending-'), true);
});

test('the first queued entry on an empty lead is its Remark', () => {
  const out = overlayFollowUps('L1', [], [item('addFollowUp', ['L1', { message: 'hi' }])]);
  assert.equal((out[0] as { kind: string }).kind, 'REMARK');
});

test('a queued edit changes the entry it names', () => {
  const rows = [{ id: 'f1', occurredAt: pendingStamp(500), message: 'before' }];
  const out = overlayFollowUps('L1', rows, [item('updateFollowUp', ['L1', 'f1', { message: 'after' }])]);
  assert.equal((out[0] as { message: string }).message, 'after');
});
