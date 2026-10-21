import test from 'node:test';
import assert from 'node:assert/strict';
import { mapInBatches } from '../../src/utils/concurrency.js';

test('mapInBatches preserves item order and caps concurrent work', async () => {
  let active = 0;
  let maxActive = 0;
  const result = await mapInBatches([1, 2, 3, 4, 5], 2, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return item * 2;
  });

  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.equal(maxActive, 2);
});

test('mapInBatches stops before starting later batches after a failure', async () => {
  const seen = [];
  await assert.rejects(
    mapInBatches([1, 2, 3, 4], 2, async (item) => {
      seen.push(item);
      if (item === 2) throw new Error('request failed');
      return item;
    }),
    /request failed/,
  );
  assert.deepEqual(seen.sort(), [1, 2]);
});

test('mapInBatches rejects invalid concurrency', async () => {
  await assert.rejects(mapInBatches([1], 0, async (item) => item), RangeError);
});
