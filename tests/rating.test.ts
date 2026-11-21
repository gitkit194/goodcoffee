import assert from 'node:assert/strict';
import { test } from 'node:test';

import { combineRating, parseRatingStats } from '../src/lib/rating.ts';

test('average of other users plus my own rating, rounded to one decimal', () => {
  // 6 others with sum 25, me 4 → 29 / 7 = 4.142…
  assert.deepEqual(combineRating({ sum: 25, count: 6 }, 4), { average: 4.1, count: 7 });
});

test('without my rating only the others count', () => {
  assert.deepEqual(combineRating({ sum: 9, count: 2 }, null), { average: 4.5, count: 2 });
});

test('only my own rating', () => {
  assert.deepEqual(combineRating({ sum: 0, count: 0 }, 5), { average: 5, count: 1 });
});

test('nobody has rated yet', () => {
  assert.deepEqual(combineRating({ sum: 0, count: 0 }, null), { average: 0, count: 0 });
});

test('unknown server state stays unknown, even with my own rating', () => {
  assert.equal(combineRating(null, 4), null);
});

test('an out-of-range own rating is ignored', () => {
  assert.deepEqual(combineRating({ sum: 8, count: 2 }, 0), { average: 4, count: 2 });
});

test('parses the RPC row, bigint values may arrive as strings', () => {
  assert.deepEqual(parseRatingStats([{ rating_sum: '29', rating_count: '7' }]), { sum: 29, count: 7 });
  assert.deepEqual(parseRatingStats({ rating_sum: 0, rating_count: 0 }), { sum: 0, count: 0 });
});

test('unexpected RPC data is not mistaken for zero ratings', () => {
  assert.equal(parseRatingStats(null), null);
  assert.equal(parseRatingStats([]), null);
  assert.equal(parseRatingStats([{ rating_sum: 'x', rating_count: 1 }]), null);
  assert.equal(parseRatingStats([{ rating_sum: 3, rating_count: -1 }]), null);
});
