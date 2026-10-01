import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeShares, planRedistribution, totalOf } from './leadRedistribution.ts';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `L${i + 1}`);

test('rows left at zero are dropped, not refused', () => {
  const result = normalizeShares([{ uid: 'a', count: 5 }, { uid: 'b', count: 0 }, { uid: 'c', count: '' }], 'src');
  assert.deepEqual(result, { shares: [{ uid: 'a', count: 5 }] });
});

test('nothing chosen, a fraction, a negative, a repeat and the source are each refused', () => {
  assert.ok('error' in normalizeShares([], 'src'));
  assert.ok('error' in normalizeShares([{ uid: 'a', count: 0 }], 'src'));
  assert.ok('error' in normalizeShares([{ uid: 'a', count: 1.5 }], 'src'));
  assert.ok('error' in normalizeShares([{ uid: 'a', count: -2 }], 'src'));
  assert.ok('error' in normalizeShares([{ uid: 'a', count: 2 }, { uid: 'a', count: 3 }], 'src'));
  assert.ok('error' in normalizeShares([{ uid: 'src', count: 2 }], 'src'));
  assert.ok('error' in normalizeShares('junk', 'src'));
});

test('everybody gets exactly the number asked for, and no lead goes twice', () => {
  const shares = [{ uid: 'a', count: 100 }, { uid: 'b', count: 60 }, { uid: 'c', count: 25 }];
  const plan = planRedistribution(ids(185), shares);
  assert.equal(plan.get('a')!.length, 100);
  assert.equal(plan.get('b')!.length, 60);
  assert.equal(plan.get('c')!.length, 25);
  const all = [...plan.values()].flat();
  assert.equal(new Set(all).size, totalOf(shares));
});

test('the leads are dealt round, so each person gets fresh ones as well as old', () => {
  const plan = planRedistribution(ids(6), [{ uid: 'a', count: 3 }, { uid: 'b', count: 3 }]);
  assert.deepEqual(plan.get('a'), ['L1', 'L3', 'L5']);
  assert.deepEqual(plan.get('b'), ['L2', 'L4', 'L6']);
});

test('a smaller share stops early and the rest carry on', () => {
  const plan = planRedistribution(ids(5), [{ uid: 'a', count: 4 }, { uid: 'b', count: 1 }]);
  assert.deepEqual(plan.get('a'), ['L1', 'L3', 'L4', 'L5']);
  assert.deepEqual(plan.get('b'), ['L2']);
});

test('fewer leads than asked for runs out without inventing any', () => {
  const plan = planRedistribution(ids(3), [{ uid: 'a', count: 5 }, { uid: 'b', count: 5 }]);
  assert.equal([...plan.values()].flat().length, 3);
});

test('part of the pile leaves the oldest where they are', () => {
  const plan = planRedistribution(ids(10), [{ uid: 'a', count: 2 }]);
  assert.deepEqual(plan.get('a'), ['L1', 'L2']);
});
