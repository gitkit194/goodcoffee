// Review test 7 (phone side): espresso and filter versions of a bean stay apart; the same version is
// found again. The database side, with two users and with parallel sessions, is in
// supabase/tests/coffee_variants.test.sql and scripts/test-db.sh.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findSameCoffee } from '../src/lib/community.ts';
import type { Coffee } from '../src/data/types.ts';

const R = 'roaster-r';
const c = (id: string, name: string, roast_for: string | null): Coffee => ({ id, roaster_id: R, name, roast_for, roaster_notes: [] });

test('"House" for filter does not become the espresso bean "House"', () => {
  const catalog = [c('esp', 'House', 'espresso')];
  assert.equal(findSameCoffee(catalog, R, 'House', 'filter'), undefined);
  assert.equal(findSameCoffee(catalog, R, 'HOUSE', 'espresso')?.id, 'esp');
});

test('with both versions there, each finds its own', () => {
  const catalog = [c('esp', 'House', 'espresso'), c('fil', 'House', 'filter')];
  assert.equal(findSameCoffee(catalog, R, 'house', 'filter')?.id, 'fil');
  assert.equal(findSameCoffee(catalog, R, 'house', 'espresso')?.id, 'esp');
});

test('without a profile: the only version is used, between two versions nothing is guessed', () => {
  assert.equal(findSameCoffee([c('esp', 'House', 'espresso')], R, 'House', null)?.id, 'esp');
  assert.equal(findSameCoffee([c('esp', 'House', 'espresso'), c('fil', 'House', 'filter')], R, 'House', null), undefined);
  assert.equal(findSameCoffee([c('esp', 'House', 'espresso'), c('none', 'House', null)], R, 'House', null)?.id, 'none');
});

test('a profile never joins a bean without one, or omni', () => {
  assert.equal(findSameCoffee([c('none', 'House', null)], R, 'House', 'espresso'), undefined);
  assert.equal(findSameCoffee([c('omni', 'House', 'omni')], R, 'House', 'filter'), undefined);
});

test('the same bean listed twice (own copy and catalogue) is still one candidate', () => {
  const own = c('esp', 'House', 'espresso');
  assert.equal(findSameCoffee([own, { ...own }], R, 'House', null)?.id, 'esp');
});
