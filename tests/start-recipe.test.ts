// A bean's first cup: the roaster's recipe as given, else a ratio by roast level. Later cups: the last cup.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { draftFor } from '../src/lib/draft.ts';
import { estimateRoastLevel, roastLevelOf, shareableRecipe } from '../src/lib/validate.ts';
import type { Coffee, Cup } from '../src/data/types.ts';

const bean = (c: Partial<Coffee>): Coffee => ({ id: 'b', roaster_id: null, name: 'Bean', roaster_notes: [], ...c });
const cup = (c: Partial<Cup>): Cup => ({
  id: 'c', coffee_id: 'other', brewed_at: '2026-11-01T08:00:00.000Z', grind: 12, dose_g: 20, yield_g: 44, time_s: 31,
  extraction: 5, sweetness: null, acidity: null, body: null, aromas: [], ...c,
});

test('roast level is estimated from the roast profile when nobody names it', () => {
  assert.equal(estimateRoastLevel('filter'), 'hell');
  assert.equal(estimateRoastLevel('omni'), 'hell');
  assert.equal(estimateRoastLevel('espresso'), 'mittel');
  assert.equal(estimateRoastLevel(null), 'mittel');
  assert.deepEqual(roastLevelOf(bean({ roast_for: 'filter' })), { level: 'hell', estimated: true });
  assert.deepEqual(roastLevelOf(bean({ roast_level: 'dunkel', roast_for: 'filter' })), { level: 'dunkel', estimated: false });
});

test('first cup ever: 18 g, ratio by roast level', () => {
  assert.deepEqual(draftFor('b', [], bean({ roast_level: 'hell' })), { coffeeId: 'b', grind: 30, dose_g: 18, yield_g: 45, time_s: 28, extraction: 5, start: 'standard' });
  assert.equal(draftFor('b', [], bean({ roast_level: 'dunkel' })).yield_g, 36);
});

test('new bean with a roaster recipe: dose, yield and time as the roaster gives them, grind from the last cup', () => {
  const d = draftFor('b', [cup({})], bean({ recipe_dose_g: 19, recipe_yield_g: 47.5, recipe_time_s: 33 }));
  assert.deepEqual([d.grind, d.dose_g, d.yield_g, d.time_s, d.extraction, d.start], [12, 19, 47.5, 33, 5, 'roaster']);
});

test('new bean without a recipe: the last dose, ratio by roast level', () => {
  const d = draftFor('b', [cup({})], bean({ roast_level: 'hell' }));
  assert.deepEqual([d.grind, d.dose_g, d.yield_g, d.time_s, d.start], [12, 20, 50, 28, 'standard']);
});

test('a bean brewed before keeps its own last cup, extraction included, not the roaster recipe', () => {
  const d = draftFor('b', [cup({ coffee_id: 'b', extraction: 4 })], bean({ recipe_dose_g: 19, recipe_yield_g: 47.5 }));
  assert.deepEqual([d.grind, d.dose_g, d.yield_g, d.time_s, d.extraction, d.start], [12, 20, 44, 31, 4, undefined]);
});

test('rounding at the upper bound stays storable', () => {
  assert.equal(shareableRecipe({ recipe_temp_c: 99.96 }).recipe_temp_c, 100);
  assert.equal(shareableRecipe({ recipe_temp_c: 100 }).recipe_temp_c, 100);
});

test('recipe values the database refuses are dropped', () => {
  assert.deepEqual(shareableRecipe({ recipe_dose_g: 50, recipe_yield_g: 40.04, recipe_time_s: 27.6, recipe_temp_c: 120 }), {
    recipe_dose_g: null, recipe_yield_g: 40, recipe_time_s: 28, recipe_temp_c: null,
  });
});
