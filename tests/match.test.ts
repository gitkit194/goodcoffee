// node --experimental-strip-types --test tests/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { isSure, matchCatalog } from '../src/lib/match.ts';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog-seed.json', import.meta.url), 'utf8'));
const roasterName = (id: string | null) => catalog.roasters.find((r: { id: string }) => r.id === id)?.name ?? '';
const match = (name: string, roaster: string | null, roast_for: string | null = null) =>
  matchCatalog({ name, roaster, roast_for }, catalog.coffees, roasterName)?.name ?? null;

test('a filter bag never matches the only, espresso, catalogue bean', () => {
  assert.equal(match('Berliner Perle', 'Berliner Kaffeerösterei', 'filter'), null);
});

test('the roast picks the right variant', () => {
  assert.equal(match('Aponte', 'KaffeeKirsche', 'espresso'), 'Aponte Espresso');
  assert.equal(match('Aponte', 'KaffeeKirsche', 'filter'), 'Aponte Filter');
});

test('a roast word in the scanned name counts as the roast', () => {
  assert.equal(match('Aponte Filter', 'KaffeeKirsche'), 'Aponte Filter');
  assert.equal(match('Ayla Bombe Espresso', 'Röststätte Berlin'), 'Ayla Bombe – Espresso');
});

test('without any roast, two variants stay ambiguous', () => {
  assert.equal(match('Aponte', 'KaffeeKirsche'), null);
});

test('a single fitting bean still matches', () => {
  assert.equal(match('Berliner Perle', 'Berliner Kaffeerösterei', 'espresso'), 'Berliner Perle Espresso');
  assert.equal(match('Berliner Perle', 'Berliner Kaffeerösterei'), 'Berliner Perle Espresso');
});

const online = (confidence: 'high' | 'medium' | 'low', roast_for: string | null = null, verified = true) => ({ verified, result: { confidence, roast_for } });

test('a medium answer is sure only when the bag says its roast', () => {
  assert.equal(isSure(online('medium', 'espresso'), { name: 'Ayla Bombe', roaster: 'Röststätte', roast_for: 'espresso' }), true);
  assert.equal(isSure(online('medium', 'espresso'), { name: 'Ayla Bombe', roaster: 'Röststätte', roast_for: null }), false);
  assert.equal(isSure(online('high', 'espresso'), { name: 'Ayla Bombe', roaster: 'Röststätte', roast_for: null }), true);
  assert.equal(isSure(online('medium', 'filter'), { name: 'Aponte Filter', roaster: 'KaffeeKirsche', roast_for: null }), true);
});

test('an answer for the other roast, unchecked or low is never sure', () => {
  assert.equal(isSure(online('high', 'filter'), { name: 'Aponte', roaster: 'KaffeeKirsche', roast_for: 'espresso' }), false);
  assert.equal(isSure(online('high', 'espresso', false), { name: 'Aponte', roaster: 'KaffeeKirsche', roast_for: 'espresso' }), false);
  assert.equal(isSure(online('low', 'espresso'), { name: 'Aponte', roaster: 'KaffeeKirsche', roast_for: 'espresso' }), false);
});
