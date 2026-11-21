// Restore after reinstall together with the app's sync steps: a cup logged and a cup
// deleted while the restore answer is still on its way. The phone runs the same functions as the store
// (sendable → push → applySent, mergeRestored, touchBean); see tests/support/device.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasPending, mark, sendable } from '../src/data/pending.ts';
import { mergeRestored, touchBean, type Restored } from '../src/data/restore.ts';
import { applyRemap } from '../src/lib/community.ts';
import type { Cup, MyBean } from '../src/data/types.ts';
import { newJournal, Phone, Server } from './support/device.ts';

const T0 = '2026-10-25T08:00:00.000Z';
const cup = (id: string, coffee_id: string, brewed_at = T0): Cup => ({ id, coffee_id, brewed_at, grind: 20, dose_g: 18, yield_g: 36, time_s: 28, extraction: 5, sweetness: 5, acidity: 5, body: 5, aromas: [] });
const autoBean = (coffee_id: string): MyBean => ({ coffee_id, roast_date: null, rating: null, comment: null, added_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z' });
const cloudBean: MyBean = { coffee_id: 'seed-b', roast_date: '2026-10-25', rating: 5, comment: 'Keep me', added_at: '2026-10-20T00:00:00.000Z', updated_at: '2026-10-26T00:00:00.000Z' };

/** The server's copy of the account, as fetchRestore would have read it before the phone's changes. */
function cloud(server: Server, cups: Cup[]): Restored {
  for (const c of cups) server.cups.set(c.id, { ...c, user_id: 'user-1' });
  server.ratings.set('user-1/seed-b', { user_id: 'user-1', ...cloudBean });
  return { profile: { name: 'Alex', grinder: 'C40' }, beans: { 'seed-b': cloudBean }, cups, coffees: [] };
}

/** A fresh install: empty journal, restore pending. */
async function reinstalled(server: Server) {
  const phone = new Phone(server);
  await phone.change(() => ({ ...newJournal(), restore: 'pending' }));
  return phone;
}

/** saveCup as the store does it, for a bean not yet on the list. */
function logCup(c: Cup) {
  return (j: ReturnType<typeof newJournal>) => ({
    ...j,
    cups: [c, ...j.cups],
    beans: j.beans[c.coffee_id] ? j.beans : { ...j.beans, [c.coffee_id]: autoBean(c.coffee_id) },
    pending: mark(j.pending, { cups: [c.id], beans: j.beans[c.coffee_id] ? [] : [c.coffee_id] }),
  });
}

test('first cup during a slow restore: rating, comment and roast date survive on the phone and the server', async () => {
  const server = new Server();
  const answer = cloud(server, [cup('old', 'seed-b')]);
  const phone = await reinstalled(server);

  await phone.change(logCup(cup('new', 'seed-b', '2026-11-01T10:00:00.000Z')));
  assert.equal(hasPending(sendable(phone.journal)), false, 'nothing is sent while the restore is pending');
  assert.equal(await phone.sync(), null);
  assert.equal(server.ratings.get('user-1/seed-b')?.rating, 5, 'the server still has the rating');

  await phone.change((j) => mergeRestored(j, answer));
  assert.deepEqual(phone.journal.cups.map((c) => c.id), ['new', 'old']);
  const b = phone.journal.beans['seed-b'];
  assert.deepEqual([b.rating, b.comment, b.roast_date], [5, 'Keep me', '2026-10-25'], 'the automatic empty entry did not win');
  assert.equal(phone.journal.profile.name, 'Alex');

  await phone.syncUntilDone();
  assert.equal(hasPending(phone.journal.pending), false);
  const r = server.ratings.get('user-1/seed-b')!;
  assert.deepEqual([r.rating, r.comment, r.roast_date], [5, 'Keep me', '2026-10-25'], 'and the server keeps them');
  assert.ok(server.cups.has('new'));
});

test('a rating the user really changed during the restore wins; untouched fields come from the server', async () => {
  const server = new Server();
  const answer = cloud(server, []);
  const phone = await reinstalled(server);
  await phone.change(logCup(cup('new', 'seed-b')));
  await phone.change((j) => ({
    ...touchBean(j, 'seed-b', ['rating']),
    beans: { ...j.beans, 'seed-b': { ...j.beans['seed-b'], rating: 2, updated_at: '2026-11-01T11:00:00.000Z' } },
    pending: mark(j.pending, { beans: ['seed-b'] }),
  }));
  await phone.change((j) => mergeRestored(j, answer));
  await phone.syncUntilDone();
  const r = server.ratings.get('user-1/seed-b')!;
  assert.deepEqual([r.rating, r.comment, r.roast_date], [2, 'Keep me', '2026-10-25']);
});

test('a cup deleted before the late restore answer stays deleted, on the phone and the server', async () => {
  const server = new Server();
  // The restore failed once (offline) after the user logged cup C; C reached nobody yet.
  const answer = cloud(server, [cup('C', 'seed-b'), cup('old', 'seed-b')]);
  const phone = await reinstalled(server);
  await phone.change(logCup(cup('C', 'seed-b')));
  // Delete C as the store does; then the user returns to the app and a sync runs (reconnect, foreground).
  await phone.change((j) => ({ ...j, cups: j.cups.filter((c) => c.id !== 'C'), pending: { ...j.pending, cups: [], deletedCups: ['C'] } }));
  await phone.sync();
  assert.deepEqual(phone.journal.pending.deletedCups, ['C'], 'the delete is not confirmed (and forgotten) before the restore');

  await phone.change((j) => mergeRestored(j, answer)); // the older answer still holds C
  assert.deepEqual(phone.journal.cups.map((c) => c.id), ['old'], 'C does not come back');
  await phone.syncUntilDone();
  assert.equal(server.cups.has('C'), false, 'and is deleted on the server');
  assert.equal(hasPending(phone.journal.pending), false);
});

test('a restart while the restore is pending keeps it pending, and still sends nothing', async () => {
  const server = new Server();
  cloud(server, []);
  const phone = await reinstalled(server);
  await phone.change(logCup(cup('new', 'seed-b')));
  await phone.restart();
  assert.equal(phone.journal.restore, 'pending');
  assert.equal(await phone.sync(), null);
  assert.equal(server.ratings.get('user-1/seed-b')?.rating, 5);
});

test('a rating edited before the bean was merged into another one survives the restore', async () => {
  const server = new Server();
  // The cloud has the merged bean seed-c (rating 5, comment, roast date); the phone still knows it as seed-b.
  const cloudC: MyBean = { ...cloudBean, coffee_id: 'seed-c' };
  server.ratings.set('user-1/seed-c', { user_id: 'user-1', ...cloudC });
  const answer: Restored = { profile: null, beans: { 'seed-c': cloudC }, cups: [], coffees: [] };
  const phone = await reinstalled(server);
  await phone.change(logCup(cup('new', 'seed-b')));
  // updateBean('seed-b', { rating: 2 }) as the store does it.
  await phone.change((j) => ({
    ...touchBean(j, 'seed-b', ['rating']),
    beans: { ...j.beans, 'seed-b': { ...j.beans['seed-b'], rating: 2, updated_at: '2026-11-01T11:00:00.000Z' } },
    pending: mark(j.pending, { beans: ['seed-b'] }),
  }));
  // The catalogue refresh learns seed-b was merged into seed-c (refreshCatalog → remapAll), twice in a chain.
  await phone.change((j) => applyRemap(j, { coffees: { 'seed-b': 'seed-x' }, roasters: {} }, { resend: true }));
  await phone.change((j) => applyRemap(j, { coffees: { 'seed-x': 'seed-c' }, roasters: {} }, { resend: true }));
  assert.equal(phone.journal.beans['seed-c']?.rating, 2);

  await phone.change((j) => mergeRestored(j, answer));
  const b = phone.journal.beans['seed-c'];
  assert.deepEqual([b.rating, b.comment, b.roast_date], [2, 'Keep me', '2026-10-25'], 'the edit wins, untouched fields from the cloud');
  await phone.syncUntilDone();
  const r = server.ratings.get('user-1/seed-c')!;
  assert.deepEqual([r.rating, r.comment, r.roast_date], [2, 'Keep me', '2026-10-25']);
});
