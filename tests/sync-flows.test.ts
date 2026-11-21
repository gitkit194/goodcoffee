// Review tests 2, 3 and 4: offline → restart → online, changes during an upload, and the app being
// killed around every sync step. Phone and server are simulated (tests/support/device.ts); the phone
// runs the app's own sync steps and keeps its journal in (fake) storage across restarts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { editCup, hasPending, mark, sendable } from '../src/data/pending.ts';
import type { Cup, MyBean } from '../src/data/types.ts';
import { Phone, Server } from './support/device.ts';

const T0 = '2026-10-31T08:00:00.000Z';
const bean = (coffee_id: string, extra: Partial<MyBean> = {}): MyBean => ({ coffee_id, roast_date: null, rating: null, comment: null, added_at: T0, updated_at: T0, ...extra });
const cup = (id: string, coffee_id: string, grind = 20): Cup => ({ id, coffee_id, brewed_at: T0, grind, dose_g: 18, yield_g: 36, time_s: 28, extraction: 5, sweetness: 5, acidity: 5, body: 5, aromas: [] });

/** Offline: a new bean with a cup, both edited once. */
async function offlineWork(phone: Phone) {
  await phone.change((j) => ({
    ...j,
    coffees: [...j.coffees, { id: 'b1', roaster_id: null, name: 'Kenia Nyeri', roaster_notes: [] }],
    beans: { ...j.beans, b1: bean('b1') },
    cups: [cup('c1', 'b1', 20), ...j.cups],
    pending: mark(j.pending, { coffees: ['b1'], beans: ['b1'], cups: ['c1'] }),
  }));
  await phone.change((j) => ({
    ...j,
    beans: { ...j.beans, b1: { ...j.beans.b1, rating: 4, comment: 'Beere', updated_at: '2026-10-31T09:00:00.000Z' } },
    cups: editCup(j.cups, 'c1', { ...cup('c1', 'b1', 24) }),
    pending: mark(j.pending, { beans: ['b1'], cups: ['c1'] }),
  }));
}

test('2: offline work survives a restart and arrives exactly once when back online', async () => {
  const server = new Server();
  const phone = new Phone(server);
  server.offline = true;
  await offlineWork(phone);
  await phone.sync(); // fails offline
  assert.equal(server.inserts.length, 0);

  await phone.restart();
  assert.deepEqual(phone.journal.pending.cups, ['c1'], 'the queue is on disk, not only in memory');

  server.offline = false;
  await phone.syncUntilDone();
  assert.equal(hasPending(phone.journal.pending), false);
  assert.deepEqual(server.inserts.sort(), ['coffee:b1', 'cup:c1', 'rating:user-1/b1']);
  assert.equal(server.cups.get('c1')?.grind, 24, 'the edited version arrived');
  assert.equal(server.ratings.get('user-1/b1')?.comment, 'Beere');
});

test('3: a cup edited and another deleted during a slow upload end up as the user left them', async () => {
  const server = new Server();
  const phone = new Phone(server);
  await phone.change((j) => ({
    ...j,
    cups: [cup('c1', 'seed', 20), cup('c2', 'seed', 30)],
    pending: mark(j.pending, { cups: ['c1', 'c2'] }),
  }));
  let release!: () => void;
  server.gate = new Promise((r) => (release = r));
  await phone.sync({
    during: async () => {
      // While the upload hangs: edit c1, delete c2 (as the store's updateCup / deleteCup do).
      await phone.change((j) => ({ ...j, cups: editCup(j.cups, 'c1', cup('c1', 'seed', 18)), pending: mark(j.pending, { cups: ['c1'] }) }));
      await phone.change((j) => ({
        ...j,
        cups: j.cups.filter((c) => c.id !== 'c2'),
        pending: { ...j.pending, cups: j.pending.cups.filter((x) => x !== 'c2'), deletedCups: [...j.pending.deletedCups, 'c2'] },
      }));
      server.gate = null;
      release();
    },
  });
  // The old c1 and c2 arrived first; the newer state is still queued …
  assert.deepEqual(phone.journal.pending.cups, ['c1']);
  assert.deepEqual(phone.journal.pending.deletedCups, ['c2']);
  await phone.syncUntilDone();
  // … and after the next sync phone and server agree.
  assert.equal(hasPending(phone.journal.pending), false);
  assert.deepEqual([...server.cups.keys()], ['c1']);
  assert.equal(server.cups.get('c1')?.grind, 18);
  assert.deepEqual(phone.journal.cups.map((c) => [c.id, c.grind]), [['c1', 18]]);
});

test('4: killed before, during and after each sync step, nothing is lost and nothing doubled', async () => {
  // a) killed before the sync ran: the queue is on disk.
  {
    const server = new Server();
    const phone = new Phone(server);
    await offlineWork(phone);
    await phone.restart();
    await phone.syncUntilDone();
    assert.deepEqual(server.inserts.sort(), ['coffee:b1', 'cup:c1', 'rating:user-1/b1']);
  }
  // b) the server did the work but the answer got lost: retried, still once.
  {
    const server = new Server();
    const phone = new Phone(server);
    await offlineWork(phone);
    server.loseAnswers = 3; // share_coffee, rating, cup: all done, all answers lost
    await phone.sync();
    assert.ok(hasPending(sendable(phone.journal)), 'nothing confirmed, so everything is still queued');
    await phone.restart();
    await phone.syncUntilDone();
    assert.equal(hasPending(phone.journal.pending), false);
    assert.deepEqual(server.inserts.sort(), ['coffee:b1', 'cup:c1', 'rating:user-1/b1']);
    assert.equal(server.cups.size, 1);
  }
  // c) killed after the server answered, before the result was saved on the phone.
  {
    const server = new Server();
    const phone = new Phone(server);
    await offlineWork(phone);
    await phone.sync({ killBeforeSave: true });
    assert.deepEqual(phone.journal.pending.cups, ['c1'], 'after the restart the phone sends again');
    await phone.syncUntilDone();
    assert.equal(hasPending(phone.journal.pending), false);
    assert.deepEqual(server.inserts.sort(), ['coffee:b1', 'cup:c1', 'rating:user-1/b1']);
  }
  // d) killed after everything was saved: a restart has nothing left to send.
  {
    const server = new Server();
    const phone = new Phone(server);
    await offlineWork(phone);
    await phone.syncUntilDone();
    await phone.restart();
    assert.equal(hasPending(phone.journal.pending), false);
    assert.equal(await phone.sync(), null);
    assert.equal(server.inserts.length, 3);
  }
});
