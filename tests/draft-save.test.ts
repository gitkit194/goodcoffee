// After "Save recipe only" failed to write, going on to the taste step must change the
// same cup, not add a second one. The draft carries the new cup's id across both steps.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { editCup, emptyPending, mark } from '../src/data/pending.ts';
import { draftFor, saveTarget, switchBean, withNewCup } from '../src/lib/draft.ts';
import type { Cup } from '../src/data/types.ts';

type Values = Omit<Cup, 'id' | 'brewed_at'>;
const T0 = '2026-10-31T08:00:00.000Z';

/** The store's saveCup / updateCup, on a journal whose writes can fail. */
function journal() {
  let cups: Cup[] = [];
  let pending = emptyPending;
  let n = 0;
  let failing = false;
  const disk: Cup[][] = [];
  const write = () => (failing ? Promise.reject(new Error('disk full')) : (disk.push(cups), Promise.resolve()));
  return {
    get cups() {
      return cups;
    },
    disk,
    fail(on: boolean) {
      failing = on;
    },
    saveCup(v: Values) {
      const id = 'cup-' + ++n;
      cups = [{ ...v, id, brewed_at: T0 }, ...cups];
      pending = mark(pending, { cups: [id] });
      return { id, saved: write() };
    },
    updateCup(id: string, v: Values) {
      cups = editCup(cups, id, v);
      return write();
    },
  };
}

const values = (d: ReturnType<typeof draftFor>, taste: Partial<Values> = {}): Values => ({
  coffee_id: d.coffeeId, grind: d.grind, dose_g: d.dose_g, yield_g: d.yield_g, time_s: d.time_s, extraction: d.extraction,
  sweetness: null, acidity: null, body: null, aromas: [], ...taste,
});

/** What both screens do on save. */
async function save(j: ReturnType<typeof journal>, draft: ReturnType<typeof draftFor>, v: Values) {
  const target = saveTarget(draft);
  if (target.kind === 'update') return { draft, written: j.updateCup(target.id, v) };
  const added = j.saveCup(v);
  return { draft: withNewCup(draft, added.id), written: added.saved };
}

test('recipe save fails, user goes on to taste, storage works again: one cup, with the taste', async () => {
  const j = journal();
  let draft = draftFor('bean-a', []);
  j.fail(true);
  const r1 = await save(j, draft, values(draft));
  draft = r1.draft; // the screen stores the draft with the new cup's id at once
  await assert.rejects(r1.written);
  // "Continue to taste" – storage works again – "Save cup".
  j.fail(false);
  const r2 = await save(j, draft, values(draft, { sweetness: 7, acidity: 4, body: 6 }));
  await r2.written;
  assert.equal(j.cups.length, 1, 'no second cup');
  assert.equal(j.disk.at(-1)!.length, 1, 'one cup on disk');
  assert.equal(j.disk.at(-1)![0].sweetness, 7);
});

test('navigating on while the recipe write still runs also changes that cup', async () => {
  const j = journal();
  let draft = draftFor('bean-a', []);
  const r1 = await save(j, draft, values(draft)); // write not awaited yet
  draft = r1.draft;
  const r2 = await save(j, draft, values(draft, { sweetness: 5, acidity: 5, body: 5 }));
  await Promise.all([r1.written, r2.written]);
  assert.equal(j.cups.length, 1);
});

test('editing an existing cup always targets that cup', () => {
  const d = { ...draftFor('bean-a', []), cupId: 'old' };
  assert.deepEqual(saveTarget(d), { kind: 'update', id: 'old' });
  assert.equal(withNewCup(d, 'new'), d);
});

test('recipe save fails, user picks another bean via "Change", then saves the taste: still one cup, on the new bean', async () => {
  const j = journal();
  let draft = draftFor('bean-b', []);
  j.fail(true);
  const r1 = await save(j, draft, values(draft));
  draft = r1.draft;
  await assert.rejects(r1.written);
  // "Change" → bean C (bohne/waehlen and bohne/neu both use switchBean).
  draft = switchBean(draft, 'bean-c', j.cups);
  assert.equal(draft.newCupId, r1.draft.newCupId, 'the started cup keeps its identity');
  j.fail(false);
  const r2 = await save(j, draft, values(draft, { sweetness: 6, acidity: 5, body: 5 }));
  await r2.written;
  assert.equal(j.cups.length, 1, 'no second cup');
  assert.equal(j.disk.at(-1)!.length, 1);
  assert.equal(j.disk.at(-1)![0].coffee_id, 'bean-c', 'the cup moved to the corrected bean');
});

test('switching beans on a fresh draft still starts from that bean\'s last recipe', () => {
  const cups = [{ id: 'x', coffee_id: 'bean-c', brewed_at: T0, grind: 33, dose_g: 18, yield_g: 36, time_s: 28, extraction: 5, sweetness: null, acidity: null, body: null, aromas: [] }];
  const d = switchBean(draftFor('bean-b', []), 'bean-c', cups);
  assert.equal(d.grind, 33);
  assert.equal(d.newCupId, undefined);
});
