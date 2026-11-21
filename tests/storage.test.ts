// Review test 1: a failed read or write must never overwrite the journal or pretend it was saved.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createWriter, loadStored, type Storage } from '../src/data/persist.ts';

const KEY = 'goodcoffee:data:v1';
const journal = { cups: [{ id: 'cup-1', coffee_id: 'bean-a' }], beans: {}, pending: {} };

/** In-memory storage whose reads and writes can be made to fail. */
function fakeStorage(initial: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initial));
  const s = {
    disk,
    failReads: 0,
    failWrites: 0,
    writes: 0,
    async getItem(k: string) {
      if (s.failReads > 0) {
        s.failReads--;
        throw new Error('storage busy');
      }
      return disk.get(k) ?? null;
    },
    async setItem(k: string, v: string) {
      s.writes++;
      if (s.failWrites > 0) {
        s.failWrites--;
        throw new Error('disk full');
      }
      disk.set(k, v);
    },
  };
  return s satisfies Storage;
}

test('a read that fails once is tried again and finds the stored journal', async () => {
  const st = fakeStorage({ [KEY]: JSON.stringify(journal) });
  st.failReads = 1;
  const res = await loadStored(st, KEY, { delayMs: 0 });
  assert.equal(res.state, 'loaded');
  assert.deepEqual(res.state === 'loaded' && res.data, journal);
});

test('a read that keeps failing is an error, not an empty journal, and writes nothing', async () => {
  const st = fakeStorage({ [KEY]: JSON.stringify(journal) });
  st.failReads = 99;
  const res = await loadStored(st, KEY, { delayMs: 0 });
  assert.equal(res.state, 'error');
  assert.equal(res.state === 'error' && res.kind, 'read');
  // The store opens nothing on an error, so nothing is written: the cup is still on disk.
  assert.equal(st.writes, 0);
  assert.deepEqual(JSON.parse(st.disk.get(KEY)!), journal);
  // Once storage answers again, the same journal comes back.
  st.failReads = 0;
  const again = await loadStored(st, KEY, { delayMs: 0 });
  assert.deepEqual(again.state === 'loaded' && again.data, journal);
});

test('an unreadable journal is reported as damaged and left as it is', async () => {
  const st = fakeStorage({ [KEY]: '{"cups": [' });
  const res = await loadStored(st, KEY, { delayMs: 0 });
  assert.equal(res.state === 'error' && res.kind, 'corrupt');
  assert.equal(st.disk.get(KEY), '{"cups": [');
});

test('nothing stored is an empty journal', async () => {
  assert.equal((await loadStored(fakeStorage(), KEY)).state, 'empty');
});

test('a failed write is reported, not confirmed; the next try writes the newest state', async () => {
  const st = fakeStorage();
  const w = createWriter<object>(st, KEY);
  st.failWrites = 1;
  await assert.rejects(w.write({ cups: ['cup-1'] }), /disk full/);
  assert.equal(st.disk.has(KEY), false, 'not on disk, so not saved');
  await w.write({ cups: ['cup-1'] });
  assert.deepEqual(JSON.parse(st.disk.get(KEY)!), { cups: ['cup-1'] });
});

test('changes made while a write runs are written together, newest last; each caller hears when its change is on disk', async () => {
  const st = fakeStorage();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow: Storage = {
    getItem: st.getItem,
    async setItem(k, v) {
      await gate;
      return st.setItem(k, v);
    },
  };
  const w = createWriter<object>(slow, KEY);
  const order: string[] = [];
  const a = w.write({ v: 1 }).then(() => order.push('a'));
  const b = w.write({ v: 2 }).then(() => order.push('b'));
  const c = w.write({ v: 3 }).then(() => order.push('c'));
  release();
  await Promise.all([a, b, c]);
  assert.deepEqual(JSON.parse(st.disk.get(KEY)!), { v: 3 });
  assert.equal(st.writes, 2, 'v1, then v2 and v3 folded into one write of v3');
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('when the write carrying a change fails, that change is not confirmed even if an older one was', async () => {
  const st = fakeStorage();
  const w = createWriter<object>(st, KEY);
  await w.write({ v: 1 });
  st.failWrites = 1;
  await assert.rejects(w.write({ v: 2 }));
  assert.deepEqual(JSON.parse(st.disk.get(KEY)!), { v: 1 });
});
