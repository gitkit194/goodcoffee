// Tasse bearbeiten: same cup, no duplicate, sync keeps edits, last recipe follows the correction.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { editCup, emptyPending, mark, settle, type Synced } from '../src/data/pending.ts';
import { draftFor, draftFromCup, draftToContinue, switchBean } from '../src/lib/draft.ts';
import type { Cup } from '../src/data/types.ts';

const cup = (id: string, coffee_id: string, brewed_at: string, grind: number): Cup => ({
  id,
  coffee_id,
  brewed_at,
  grind,
  dose_g: 18,
  yield_g: 36,
  time_s: 28,
  extraction: 3,
  sweetness: 6,
  acidity: 4,
  body: 7,
  aromas: ['choc'],
});

const newest = cup('c2', 'bean-a', '2026-10-31T08:00:00.000Z', 22);
const older = cup('c1', 'bean-a', '2026-10-30T08:00:00.000Z', 30);
const other = cup('c0', 'bean-b', '2026-10-29T08:00:00.000Z', 40);
const cups = [newest, older, other];

const change = { ...newest, grind: 18, time_s: 31, sweetness: 8, aromas: ['fruit:Beeren'] } as Omit<Cup, 'id' | 'brewed_at'> & Partial<Cup>;
delete change.id;
delete change.brewed_at;

test('editing opens the recipe with every stored value', () => {
  assert.deepEqual(draftFromCup(newest), { coffeeId: 'bean-a', grind: 22, dose_g: 18, yield_g: 36, time_s: 28, extraction: 3, cupId: 'c2' });
});

test('saving changes the same cup: same id, same date, same place, no new cup', () => {
  const next = editCup(cups, 'c2', change);
  assert.equal(next.length, cups.length);
  assert.equal(next[0].id, 'c2');
  assert.equal(next[0].brewed_at, newest.brewed_at);
  assert.equal(next[0].grind, 18);
  assert.equal(next[0].sweetness, 8);
  assert.deepEqual(next[0].aromas, ['fruit:Beeren']);
  assert.equal(next[1], older);
  assert.equal(next[2], other);
});

test('editing a cup that was deleted meanwhile changes nothing', () => {
  assert.equal(editCup(cups, 'gone', change), cups);
});

test('the last recipe for the bean uses the corrected values', () => {
  const next = editCup(cups, 'c2', change);
  assert.equal(draftFor('bean-a', next).grind, 18);
  assert.equal(draftFor('bean-a', next).time_s, 31);
});

test('picking another bean while editing keeps the cup and its values', () => {
  const editing = draftFromCup(newest);
  assert.deepEqual(switchBean(editing, 'bean-b', cups), { ...editing, coffeeId: 'bean-b' });
  // A new cup still starts from that bean's last recipe.
  assert.equal(switchBean(draftFor('bean-a', cups), 'bean-b', cups).grind, 40);
});

const state = (list: Cup[], pending = emptyPending): Synced => ({
  profile: { name: '', grinder: '', since: '' },
  roasters: [],
  coffees: [],
  beans: {},
  cups: list,
  pending,
});

test('an offline edit stays queued once, so the next sync upserts the same id', () => {
  const pending = mark(mark(emptyPending, { cups: ['c2'] }), { cups: ['c2'] });
  assert.deepEqual(pending.cups, ['c2']);
});

test('after a sync the edited cup is no longer queued', () => {
  const sent = mark(emptyPending, { cups: ['c2'] });
  const s = state(editCup(cups, 'c2', change), sent);
  assert.deepEqual(settle(s, s, sent).cups, []);
});

test('an edit made while a sync is running is sent again next time', () => {
  const sent = mark(emptyPending, { cups: ['c2'] });
  const snapshot = state(cups, sent);
  const now = state(editCup(cups, 'c2', change), sent);
  assert.deepEqual(settle(now, snapshot, sent).cups, ['c2']);
});

test('a left-over edit draft is not continued when a new cup is logged', () => {
  const editing = draftFromCup(newest);
  assert.equal(draftToContinue(editing, undefined), null);
  assert.equal(draftToContinue(editing, 'c1'), null);
  assert.equal(draftToContinue(editing, 'c2'), editing);
  const fresh = draftFor('bean-a', cups);
  assert.equal(draftToContinue(fresh, undefined), fresh);
  assert.equal(draftToContinue(null, 'c2'), null);
});
