// node --experimental-strip-types --test tests/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { applyRemap, findSameCoffee, isCommunity, matchKey, mergeBeans, ownView, resolveId } from '../src/lib/community.ts';
import { matchCatalog, roasterKey, sameRoaster } from '../src/lib/match.ts';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog-seed.json', import.meta.url), 'utf8'));

test('the match key ignores case, umlauts, accents and spaces', () => {
  assert.equal(matchKey('Röststätte'), matchKey('ROESTSTAETTE'));
  assert.equal(matchKey('Röststätte'), matchKey('Rost Statte'));
  assert.equal(matchKey('Kaffee Kirsche'), matchKey('kaffeekirsche'));
  assert.equal(matchKey('Corazón de Jesús'), matchKey('corazon de jesus'));
  assert.equal(matchKey('Großvater'), matchKey('GROSSVATER'));
  assert.notEqual(matchKey('Aponte Espresso'), matchKey('Aponte Filter'));
});

// A bean user A shared, as user B's phone gets it from the catalogue.
const ROASTER = { id: 'r-neu', name: 'Röststätte Neukölln' };
const shared = {
  id: 'c-a',
  roaster_id: ROASTER.id,
  name: 'Äthiopien Guji Natural',
  origin_country: 'Äthiopien',
  process: 'Natural',
  roaster_notes: ['Blaubeere'],
  source: 'user' as const,
  reviewed: false,
};
const coffees = [...catalog.coffees, shared];
const roasters = [...catalog.roasters, ROASTER];
const roasterName = (id: string | null) => roasters.find((r: { id: string }) => r.id === id)?.name ?? '';
const scan = (name: string, roaster: string | null) => matchCatalog({ name, roaster }, coffees, roasterName)?.id ?? null;

test('scanning the same bag finds the bean another user shared, however it is spelled', () => {
  assert.equal(scan('Äthiopien Guji Natural', 'Röststätte Neukölln'), 'c-a');
  assert.equal(scan('AETHIOPIEN GUJI NATURAL', 'ROESTSTAETTE NEUKOELLN'), 'c-a');
  assert.equal(scan('athiopien guji  natural', 'Roststatte Neukolln'), 'c-a');
  assert.equal(scan('ÄthiopienGuji Natural', 'RöststätteNeukölln'), 'c-a');
});

test('a different bean of the same roaster still does not match', () => {
  assert.equal(scan('Kenia Nyeri', 'Röststätte Neukölln'), null);
  assert.equal(scan('Äthiopien Guji Natural', 'Bonanza Coffee Roasters'), null);
});

test('roaster names: joined and split spellings are the same roaster, other roasters are not', () => {
  assert.ok(sameRoaster('Kaffee Kirsche', 'KaffeeKirsche'));
  assert.ok(sameRoaster('Bonanza', 'Bonanza Coffee Roasters'));
  assert.ok(!sameRoaster('Bonanza Coffee Roasters', 'Fjord Coffee Roasters'));
  assert.equal(roasterKey('Bonanza Coffee Roasters'), roasterKey('bonanza'));
  assert.notEqual(roasterKey('Berliner Kaffeerösterei'), roasterKey('Bonanza Coffee Roasters'));
});

test('typing a bean that is already in the catalogue finds it instead of adding a second one', () => {
  assert.equal(findSameCoffee(coffees, ROASTER.id, 'äthiopien guji natural')?.id, 'c-a');
  assert.equal(findSameCoffee(coffees, ROASTER.id, 'Äthiopien Guji Washed'), undefined);
  assert.equal(findSameCoffee(coffees, null, 'Äthiopien Guji Natural'), undefined);
});

test('user beans are community beans until reviewed; seed beans never are', () => {
  assert.equal(isCommunity(shared), true);
  assert.equal(isCommunity({ ...shared, reviewed: true }), false);
  // A catalogue cached by an older app version still carries the timestamp.
  assert.equal(isCommunity({ ...shared, reviewed: undefined, reviewed_at: '2026-10-31T10:00:00Z' }), false);
  assert.equal(isCommunity(catalog.coffees[0]), false);
  assert.equal(isCommunity({ source: 'seed', reviewed: false }), false);
});

const bean = (coffee_id: string, extra: object = {}) => ({ coffee_id, roast_date: null, rating: null, comment: null, added_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-30T10:00:00Z', ...extra });
const cup = (id: string, coffee_id: string) => ({ id, coffee_id, brewed_at: '2026-10-30T10:00:00Z', grind: 12, dose_g: 18, yield_g: 36, time_s: 28, extraction: 5, sweetness: null, acidity: null, body: null, aromas: [] });
const pending = { roasters: [], coffees: [], beans: [], cups: [], deletedCups: [], profile: false };

test('when the server already had the bean, the phone moves list entry, cups and own photo over to it', () => {
  const local = {
    roasters: [{ id: 'r-local', name: 'roeststaette neukoelln' }],
    coffees: [{ id: 'c-b', roaster_id: 'r-local', name: 'aethiopien guji natural', roaster_notes: [], photo_uri: 'file:///own.jpg' }],
    beans: { 'c-b': bean('c-b', { roast_date: '2026-10-20', rating: 4 }) },
    cups: [cup('cup-1', 'c-b')],
    pending: { ...pending, cups: ['cup-2'] },
    photos: {},
  };
  const after = applyRemap(local, { coffees: { 'c-b': 'c-a' }, roasters: { 'r-local': 'r-neu' } });
  assert.deepEqual(after.coffees, []);
  assert.deepEqual(Object.keys(after.beans), ['c-a']);
  assert.equal(after.beans['c-a'].roast_date, '2026-10-20');
  assert.equal(after.beans['c-a'].rating, 4);
  assert.equal(after.cups[0].coffee_id, 'c-a');
  assert.equal(after.photos['c-a'], 'file:///own.jpg');
  assert.deepEqual(after.roasters.map((r) => r.id), ['r-neu']);
  assert.deepEqual(after.pending.cups, ['cup-2']);
});

test('if the shared bean was already on the list, the entries merge and the merged one is sent again', () => {
  const local = {
    roasters: [],
    coffees: [{ id: 'c-b', roaster_id: 'r-neu', name: 'Guji', roaster_notes: [] }],
    beans: { 'c-a': bean('c-a', { rating: 5 }), 'c-b': bean('c-b', { comment: 'fruchtig', roast_date: '2026-10-20' }) },
    cups: [],
    pending,
  };
  const after = applyRemap(local, { coffees: { 'c-b': 'c-a' }, roasters: {} });
  assert.deepEqual(Object.keys(after.beans), ['c-a']);
  assert.equal(after.beans['c-a'].rating, 5);
  assert.equal(after.beans['c-a'].comment, 'fruchtig');
  assert.deepEqual(after.pending.beans, ['c-a']);
});

test('nothing to move leaves the data untouched', () => {
  const local = { roasters: [], coffees: [], beans: {}, cups: [], pending };
  assert.equal(applyRemap(local, { coffees: {}, roasters: {} }), local);
});

test('a recipe opened before the remap still saves its cup on the shared bean', () => {
  const local = {
    roasters: [],
    coffees: [{ id: 'c-b', roaster_id: 'r-neu', name: 'Guji', roaster_notes: [] }],
    beans: { 'c-b': bean('c-b') },
    cups: [],
    pending,
  };
  const draftCoffeeId = 'c-b';
  const after = applyRemap(local, { coffees: { 'c-b': 'c-a' }, roasters: {} });
  // The cup saved afterwards with the draft's old id ends up on the bean the server knows.
  assert.equal(resolveId(after.aliases, draftCoffeeId), 'c-a');
  // A second replacement later (c-a merged into c-z) still leads there from the oldest id.
  const later = applyRemap(after, { coffees: { 'c-a': 'c-z' }, roasters: {} });
  assert.equal(resolveId(later.aliases, 'c-b'), 'c-z');
  assert.equal(resolveId(later.aliases, 'unrelated'), 'unrelated');
});

test('beans the server merged after they were sent are moved and sent again', () => {
  const local = {
    roasters: [],
    coffees: [],
    beans: { 'c-old': bean('c-old', { rating: 4 }) },
    cups: [cup('cup-1', 'c-old')],
    pending,
  };
  const after = applyRemap(local, { coffees: { 'c-old': 'c-kept' }, roasters: {} }, { resend: true });
  assert.deepEqual(after.pending.beans, ['c-kept']);
  assert.deepEqual(after.pending.cups, ['cup-1']);
  assert.equal(after.cups[0].coffee_id, 'c-kept');
});

test('an own shared bean shows the server copy once reviewed; unsent changes and the own photo stay', () => {
  const own = [{ ...shared, photo_uri: 'file:///own.jpg' }];
  const reviewed = [{ ...shared, variety: 'Heirloom', reviewed: true }];
  const shown = ownView(reviewed, own, [])[0];
  assert.equal(isCommunity(shown), false);
  assert.equal(shown.variety, 'Heirloom');
  assert.equal(shown.photo_uri, 'file:///own.jpg');
  // Still waiting to be sent: the local copy wins.
  assert.equal(ownView(reviewed, own, ['c-a'])[0].reviewed, false);
  // Not in the catalogue yet: the local copy.
  assert.equal(ownView([], own, [])[0], own[0]);
});

const permutations = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

test('merging list entries: an older complete entry survives a newer empty one', () => {
  const older = bean('c-a', { rating: 5, comment: 'alt', roast_date: '2026-10-01', added_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z' });
  const newer = bean('c-b', { comment: '  ', added_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:00:00Z' });
  for (const list of permutations([older, newer])) {
    const m = mergeBeans(list, 'c-a');
    assert.equal(m.rating, 5);
    assert.equal(m.comment, 'alt');
    assert.equal(m.roast_date, '2026-10-01');
    assert.equal(m.added_at, '2026-10-01T10:00:00Z');
    // The merge itself is no change: the result is as new as the newest original.
    assert.equal(m.updated_at, '2026-10-05T10:00:00Z');
  }
});

test('merging three entries decides every field over all originals, in any order (same as the server)', () => {
  // The reviewer's case: target 1 (01.10.), duplicate A 2 (02.10.), duplicate B 5 (03.10.) → 5, as in SQL.
  const target = bean('c-t', { rating: 1, comment: 'Ziel', updated_at: '2026-10-01T10:00:00Z' });
  const a = bean('c-a', { rating: 2, roast_date: '2026-09-20', comment: '', updated_at: '2026-10-02T10:00:00Z' });
  const b = bean('c-b', { rating: 5, updated_at: '2026-10-03T10:00:00Z' });
  for (const list of permutations([target, a, b])) {
    const m = mergeBeans(list, 'c-t');
    assert.equal(m.coffee_id, 'c-t');
    assert.equal(m.rating, 5);
    assert.equal(m.comment, 'Ziel');
    assert.equal(m.roast_date, '2026-09-20');
  }
  for (const order of permutations(['c-t', 'c-a', 'c-b'])) {
    const local = {
      roasters: [],
      coffees: [],
      beans: Object.fromEntries(order.map((id) => [id, { 'c-t': target, 'c-a': a, 'c-b': b }[id]])),
      cups: [],
      pending,
    };
    const after = applyRemap(local, { coffees: { 'c-a': 'c-t', 'c-b': 'c-t' }, roasters: {} }, { resend: true });
    assert.deepEqual(Object.keys(after.beans), ['c-t']);
    assert.equal(after.beans['c-t'].rating, 5);
    assert.equal(after.beans['c-t'].comment, 'Ziel');
    assert.deepEqual(after.pending.beans, ['c-t']);
  }
});

test('a later merge decides by when each value was set, not by when the earlier merge happened', () => {
  // First merge: rating from 01.10., comment from 05.10. Then an entry with rating 3 from 03.10. joins.
  const first = mergeBeans(
    [bean('c-t', { rating: 4, updated_at: '2026-10-01T10:00:00Z' }), bean('c-a', { comment: 'neu', updated_at: '2026-10-05T10:00:00Z' })],
    'c-t',
  );
  const later = bean('c-z', { rating: 3, updated_at: '2026-10-03T10:00:00Z' });
  for (const list of permutations([first, later])) {
    const m = mergeBeans(list, 'c-t');
    assert.equal(m.rating, 3, 'the rating set on 03.10. is newer than the one from 01.10.');
    assert.equal(m.comment, 'neu');
  }
  // Once the user edits the merged entry, all of it counts as of that edit.
  const edited = { ...first, updated_at: '2026-10-06T10:00:00Z' };
  assert.equal(mergeBeans([edited, later], 'c-t').rating, 4);
});

test('on a real conflict the more recently changed value wins', () => {
  const older = bean('c-a', { rating: 2, comment: 'vorher', updated_at: '2026-10-01T10:00:00Z' });
  const newer = bean('c-b', { rating: 4, updated_at: '2026-10-03T10:00:00Z' });
  const m = mergeBeans([older, newer], 'c-a');
  assert.equal(m.rating, 4);
  assert.equal(m.comment, 'vorher');
});

test('the phone merges a newer empty local copy into a complete entry without losing values', () => {
  const local = {
    roasters: [],
    coffees: [],
    beans: {
      'c-a': bean('c-a', { rating: 5, comment: 'alt', roast_date: '2026-10-01', updated_at: '2026-10-01T10:00:00Z' }),
      'c-b': bean('c-b', { updated_at: '2026-10-09T10:00:00Z' }),
    },
    cups: [cup('cup-1', 'c-a'), cup('cup-2', 'c-b')],
    pending,
  };
  const after = applyRemap(local, { coffees: { 'c-b': 'c-a' }, roasters: {} }, { resend: true });
  assert.deepEqual(Object.keys(after.beans), ['c-a']);
  assert.equal(after.beans['c-a'].rating, 5);
  assert.equal(after.beans['c-a'].comment, 'alt');
  assert.equal(after.beans['c-a'].roast_date, '2026-10-01');
  assert.deepEqual(after.cups.map((c) => c.coffee_id), ['c-a', 'c-a']);
});
