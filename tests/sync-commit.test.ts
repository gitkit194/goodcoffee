// A sync's acknowledgement and the move to server ids must reach the disk together.
// Before, the store wrote the cleared queue first and the new ids in a second write; if that second
// write failed (or the app died in between), a cup stayed on the local bean id with nothing queued,
// while the server had it under the shared bean. Nothing could repair that.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applySent } from '../src/data/journal.ts';
import { hasPending, mark, settle } from '../src/data/pending.ts';
import { applyRemap } from '../src/lib/community.ts';
import type { MyBean } from '../src/data/types.ts';
import { Phone, Server } from './support/device.ts';

const T0 = '2026-10-31T08:00:00.000Z';
const bean = (coffee_id: string): MyBean => ({ coffee_id, roast_date: null, rating: 3, comment: null, added_at: T0, updated_at: T0 });

async function localBeanWithCup(phone: Phone) {
  await phone.change((j) => ({
    ...j,
    coffees: [{ id: 'B', roaster_id: null, name: 'House', roaster_notes: [] }],
    beans: { B: bean('B') },
    cups: [{ id: 'C', coffee_id: 'B', brewed_at: T0, grind: 20, dose_g: 18, yield_g: 36, time_s: 28, extraction: 5, sweetness: 5, acidity: 5, body: 5, aromas: [] }],
    pending: mark(j.pending, { coffees: ['B'], beans: ['B'], cups: ['C'] }),
  }));
}

/** What is on disk after a restart, in the terms of the bug: where the cup points and what is queued. */
function state(phone: Phone) {
  return { cupOn: phone.journal.cups[0].coffee_id, alias: phone.journal.aliases?.B ?? null, queued: hasPending(phone.journal.pending) };
}

test('the acknowledgement and the new ids are one change: on disk it is all or nothing', async () => {
  const server = new Server();
  server.coffees.set('A', { id: 'A' });
  server.sameAs.set('B', 'A'); // someone shared the same bean first
  const phone = new Phone(server);
  await localBeanWithCup(phone);

  phone.failWrites = 1; // the one write after the sync fails
  await phone.sync();
  await phone.restart();
  // Nothing of the sync reached the disk: everything is still queued under B and will be sent again.
  assert.deepEqual(state(phone), { cupOn: 'B', alias: null, queued: true });

  await phone.syncUntilDone();
  await phone.restart();
  assert.deepEqual(state(phone), { cupOn: 'A', alias: 'A', queued: false });
  assert.equal(server.cups.get('C')?.coffee_id, 'A');
});

test('killed right after the server answered: resent under the shared id, nothing stuck', async () => {
  const server = new Server();
  server.coffees.set('A', { id: 'A' });
  server.sameAs.set('B', 'A');
  const phone = new Phone(server);
  await localBeanWithCup(phone);
  await phone.sync({ killBeforeSave: true });
  assert.deepEqual(state(phone), { cupOn: 'B', alias: null, queued: true });
  await phone.syncUntilDone();
  assert.deepEqual(state(phone), { cupOn: 'A', alias: 'A', queued: false });
  assert.equal(server.cups.size, 1);
});

test('the old two-step order leaves exactly the state the review found (why it is one step now)', async () => {
  // Same sync result, applied the old way: first only settle (written), then the remap (write fails).
  const server = new Server();
  server.coffees.set('A', { id: 'A' });
  server.sameAs.set('B', 'A');
  const phone = new Phone(server);
  await localBeanWithCup(phone);
  const snapshot = phone.journal;
  const { push } = await import('../src/data/push.ts');
  const sent = await push(server.api('user-1'), snapshot, snapshot.pending);
  const firstWrite = { ...snapshot, pending: settle(snapshot, snapshot, sent) };
  // Old: disk holds firstWrite, the remap write fails → after a restart:
  assert.equal(firstWrite.cups[0].coffee_id, 'B');
  assert.equal(hasPending(firstWrite.pending), false, 'queue empty while the cup still points to B: stuck');
  // New: the single change has both.
  const one = applySent(snapshot, snapshot, sent, []);
  assert.equal(one.cups[0].coffee_id, 'A');
  assert.equal(hasPending(one.pending), false);
  assert.deepEqual(one, { ...applyRemap(firstWrite, sent.remap), standIns: one.standIns });
});
