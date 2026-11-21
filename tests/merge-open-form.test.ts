// Review test 5: a bean is merged into the shared one while the taste screen is open.
// Rating, notes and cups must survive, and the bean must stay visible even before the catalogue knows it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { beanPatch, shown, untouched } from '../src/lib/beanForm.ts';
import { applyRemap, resolveId, standInsAfterRemap } from '../src/lib/community.ts';
import { emptyPending } from '../src/data/pending.ts';
import type { Coffee, Cup, MyBean } from '../src/data/types.ts';

const T0 = '2026-10-30T10:00:00.000Z';
const T1 = '2026-10-31T10:00:00.000Z';
const bean = (coffee_id: string, extra: Partial<MyBean> = {}): MyBean => ({ coffee_id, roast_date: null, rating: null, comment: null, added_at: T0, updated_at: T0, ...extra });
const coffee = (id: string, name: string): Coffee => ({ id, roaster_id: 'r1', name, roaster_notes: [], source: 'user' });
const cup = (id: string, coffee_id: string): Cup => ({ id, coffee_id, brewed_at: T0, grind: 20, dose_g: 18, yield_g: 36, time_s: 28, extraction: 5, sweetness: 5, acidity: 5, body: 5, aromas: [] });

// B has no rating; A (the shared bean B turns out to be) has five stars and a note from earlier.
const before = {
  roasters: [],
  coffees: [coffee('B', 'House Blend')],
  beans: { B: bean('B'), A: bean('A', { rating: 5, comment: 'Schokolade, rund', updated_at: T1 }) },
  cups: [cup('c1', 'B')],
  pending: { ...emptyPending, cups: ['c1'], beans: ['B'] },
};
const remap = { coffees: { B: 'A' }, roasters: {} };

test('saving an untouched form after a merge keeps the merged rating and note', () => {
  // The screen was opened for B: nothing touched yet.
  const ratingEdit = untouched;
  const commentEdit = untouched;
  const after = applyRemap(before, remap);
  const current = after.beans[resolveId(after.aliases, 'B')];
  assert.equal(current.rating, 5);
  // What the screen shows follows the bean.
  assert.equal(shown(ratingEdit, current.rating ?? 0), 5);
  assert.equal(shown(commentEdit, current.comment ?? ''), 'Schokolade, rund');
  // "Save cup" without touching rating or note writes nothing to the bean. (Before the fix it wrote
  // { rating: null, comment: null }, the values the screen had when B was opened.)
  assert.equal(beanPatch(current, ratingEdit, commentEdit), null);
  // The cup moved with the bean.
  assert.equal(after.cups[0].coffee_id, 'A');
});

test('only the field the user touched is written', () => {
  const after = applyRemap(before, remap);
  const current = after.beans.A;
  assert.deepEqual(beanPatch(current, { touched: true, value: 3 }, untouched), { rating: 3 });
  assert.deepEqual(beanPatch(current, untouched, { touched: true, value: '  nussig ' }), { comment: 'nussig' });
  // Clearing on purpose still clears.
  assert.deepEqual(beanPatch(current, { touched: true, value: 0 }, { touched: true, value: '' }), { rating: null, comment: null });
  // Touched but set back to what the bean has: nothing to write.
  assert.equal(beanPatch(current, { touched: true, value: 5 }, { touched: true, value: 'Schokolade, rund' }), null);
});

test('a bean merged into one the catalogue does not have yet stays visible with its data', () => {
  const after = applyRemap(before, remap);
  // The phone's own copy of B is dropped by the merge; the catalogue has no A yet.
  assert.equal(after.coffees.length, 0);
  const standIns = standInsAfterRemap(before, after, remap, []);
  assert.equal(standIns.A?.name, 'House Blend');
  assert.equal(standIns.A?.id, 'A');
  // So "My coffees" (bean entry + master data by id) still has a row for A, with rating and cup.
  const byId = new Map(Object.values(standIns).map((c) => [c.id, c]));
  const rows = Object.values(after.beans).filter((b) => byId.has(b.coffee_id));
  assert.deepEqual(rows.map((b) => [b.coffee_id, b.rating]), [['A', 5]]);
});

test('no stand-in when the catalogue already has the target, or for a catalogue bean merged on the server', () => {
  const after = applyRemap(before, remap);
  assert.deepEqual(standInsAfterRemap(before, after, remap, [coffee('A', 'House Blend')]), {});
  // A catalogue bean (not the user's own) merged on the server: its catalogue data stands in.
  const fromCatalog = { ...before, coffees: [] };
  const s2 = standInsAfterRemap(fromCatalog, applyRemap(fromCatalog, remap), remap, [coffee('B', 'House Blend')]);
  assert.equal(s2.A?.name, 'House Blend');
});
