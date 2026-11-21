// Review test 6: a bean the server refuses for good must not hold up other cups and ratings.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptyPending, hasPending, mark, sendable, settle, type Pending, type Synced } from '../src/data/pending.ts';
import { isPermanent, push, type Api } from '../src/data/push.ts';
import { matchKey } from '../src/lib/community.ts';
import { coffeeNameProblem } from '../src/lib/validate.ts';
import type { Coffee, Cup, MyBean } from '../src/data/types.ts';

const T0 = '2026-10-30T10:00:00.000Z';
const coffee = (id: string, name: string, extra: Partial<Coffee> = {}): Coffee => ({ id, roaster_id: null, name, roaster_notes: [], source: 'user', ...extra });
const bean = (coffee_id: string, extra: Partial<MyBean> = {}): MyBean => ({ coffee_id, roast_date: null, rating: null, comment: null, added_at: T0, updated_at: T0, ...extra });
const cup = (id: string, coffee_id: string, extra: Partial<Cup> = {}): Cup => ({ id, coffee_id, brewed_at: T0, grind: 20, dose_g: 18, yield_g: 36, time_s: 28, extraction: 5, sweetness: 5, acidity: 5, body: 5, aromas: [], ...extra });

/**
 * A server that behaves like the database: share_coffee refuses a name without letters or digits
 * (22023) and a bean called "Verboten" (as any other check would, 23514); cups need a shared bean
 * (foreign key, 23503) and a positive dose (23514). `offline` makes every call fail like a dead network.
 */
function fakeServer(known: string[] = ['seed-1']) {
  const coffees = new Set(known);
  const cups = new Map<string, Record<string, unknown>>();
  const ratings = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const s = { coffees, cups, ratings, calls, offline: false };
  const net = () => (s.offline ? { error: Object.assign(new TypeError('Network request failed'), {}) } : null);
  const api: Api = {
    userId: async () => 'user-1',
    async shareCoffee({ p_id, p_coffee }) {
      calls.push('share:' + p_id);
      const down = net();
      if (down) return down;
      if (!matchKey(String(p_coffee.name))) return { error: { code: '22023', message: 'a coffee needs a name' } };
      if (p_coffee.name === 'Verboten') return { error: { code: '23514', message: 'new row violates check constraint' } };
      coffees.add(p_id);
      return { data: [{ coffee_id: p_id, roaster_id: null }], error: null };
    },
    async upsert(table, rows) {
      calls.push(`upsert:${table}:${rows.length}`);
      const down = net();
      if (down) return down;
      for (const r of rows) {
        if (table !== 'profiles' && !coffees.has(String(r.coffee_id))) return { error: { code: '23503', message: 'violates foreign key constraint' } };
        if (table === 'cups' && !((r.dose_g as number) > 0)) return { error: { code: '23514', message: 'cups_dose_g_check' } };
      }
      for (const r of rows) {
        if (table === 'cups') cups.set(String(r.id), r);
        if (table === 'user_coffees') ratings.set(String(r.coffee_id), r);
      }
      return { error: null };
    },
    async deleteCups(ids) {
      const down = net();
      if (down) return down;
      ids.forEach((id) => cups.delete(id));
      return { error: null };
    },
  };
  return { s, api };
}

const profile = { name: '', grinder: '', since: T0 };

function journal(): Synced {
  return {
    profile,
    roasters: [],
    // "☕" was allowed by the form before this fix; such a bean can still be waiting in the queue.
    coffees: [coffee('emoji', '☕'), coffee('ok', 'Kenia Nyeri')],
    beans: { emoji: bean('emoji', { rating: 4 }), ok: bean('ok', { rating: 5 }), 'seed-1': bean('seed-1', { comment: 'lecker' }) },
    cups: [cup('cup-emoji', 'emoji'), cup('cup-ok', 'ok'), cup('cup-seed', 'seed-1')],
    pending: { ...emptyPending, coffees: ['emoji', 'ok'], beans: ['emoji', 'ok', 'seed-1'], cups: ['cup-emoji', 'cup-ok', 'cup-seed'] },
  };
}

test('the form and the server agree on which names are refused', () => {
  assert.equal(coffeeNameProblem('☕'), 'The name needs at least one letter or digit.');
  assert.equal(coffeeNameProblem('  '), 'Enter a name first');
  assert.equal(coffeeNameProblem('Kenia ☕'), null);
});

test('a refused bean does not stop independent cups and ratings; its own cup waits on the phone', async () => {
  const { s, api } = fakeServer();
  const d = journal();
  const sent = await push(api, d, d.pending);
  assert.equal(sent.error, undefined, 'no transient error');
  // Everything independent of the refused bean reached the server.
  assert.deepEqual([...s.cups.keys()].sort(), ['cup-ok', 'cup-seed']);
  assert.deepEqual([...s.ratings.keys()].sort(), ['ok', 'seed-1']);
  // The "☕" bean was refused by the shared rule without a request.
  assert.ok(!s.calls.includes('share:emoji'));
  assert.ok(sent.rejected['coffee:emoji']);

  const next: Synced = { ...d, pending: settle(d, d, sent) };
  // Bean, its rating and its cup stay pending (nothing lost) …
  assert.deepEqual(next.pending.coffees, ['emoji']);
  assert.deepEqual(next.pending.beans, ['emoji']);
  assert.deepEqual(next.pending.cups, ['cup-emoji']);
  // … but the next sync has nothing to try until the user fixes the bean: no endless retries.
  assert.equal(hasPending(sendable(next)), false);
});

test('fixing the refused bean sends it, and then its rating and cup', async () => {
  const { s, api } = fakeServer();
  const d0 = journal();
  const d1: Synced = { ...d0, pending: settle(d0, d0, await push(api, d0, d0.pending)) };
  // The user renames the bean: the change marks it again, which clears the refusal.
  const d2: Synced = {
    ...d1,
    coffees: d1.coffees.map((c) => (c.id === 'emoji' ? { ...c, name: 'Hausmischung ☕' } : c)),
    pending: mark(d1.pending, { coffees: ['emoji'] }),
  };
  assert.equal(d2.pending.rejected, undefined);
  const todo = sendable(d2);
  assert.deepEqual([todo.coffees, todo.beans, todo.cups], [['emoji'], ['emoji'], ['cup-emoji']]);
  const sent = await push(api, d2, todo);
  const d3: Synced = { ...d2, pending: settle(d2, d2, sent) };
  assert.equal(hasPending(d3.pending), false);
  assert.ok(s.cups.has('cup-emoji'));
  assert.equal(s.ratings.get('emoji')?.rating, 4);
});

test('a refused bean the app cannot pre-check is marked from the server answer, and does not block others', async () => {
  const { s, api } = fakeServer();
  const d: Synced = {
    profile,
    roasters: [],
    coffees: [coffee('bad', 'Verboten'), coffee('ok', 'Kenia Nyeri')],
    beans: {},
    cups: [cup('cup-bad', 'bad'), cup('cup-ok', 'ok')],
    pending: { ...emptyPending, coffees: ['bad', 'ok'], cups: ['cup-bad', 'cup-ok'] },
  };
  const sent = await push(api, d, d.pending);
  assert.match(sent.rejected['coffee:bad'], /check constraint/);
  assert.deepEqual([...s.cups.keys()], ['cup-ok']);
  const next = settle(d, d, sent);
  assert.deepEqual(next.cups, ['cup-bad']);
  assert.equal(hasPending(sendable({ cups: d.cups, pending: next })), false);
});

test('one bad cup in a batch is found row by row; the other cups go through', async () => {
  const { s, api } = fakeServer();
  const d: Synced = {
    profile,
    roasters: [],
    coffees: [],
    beans: {},
    cups: [cup('good-1', 'seed-1'), cup('bad', 'seed-1', { dose_g: 0 }), cup('good-2', 'seed-1')],
    pending: { ...emptyPending, cups: ['good-1', 'bad', 'good-2'] },
  };
  // The phone's own check catches this one before sending …
  const sent = await push(api, d, d.pending);
  assert.ok(sent.rejected['cup:bad']);
  assert.deepEqual([...s.cups.keys()].sort(), ['good-1', 'good-2']);
  assert.deepEqual(sent.cups.sort(), ['good-1', 'good-2']);
});

test('a batch the server refuses is retried row by row', async () => {
  const { s, api } = fakeServer();
  // A cup whose bean the server does not know (e.g. deleted): the whole batch fails with 23503 first.
  const d: Synced = {
    profile,
    roasters: [],
    coffees: [],
    beans: {},
    cups: [cup('good', 'seed-1'), cup('orphan', 'gone')],
    pending: { ...emptyPending, cups: ['good', 'orphan'] },
  };
  const sent = await push(api, d, d.pending);
  assert.deepEqual([...s.cups.keys()], ['good']);
  assert.ok(sent.rejected['cup:orphan']);
  assert.deepEqual(settle(d, d, sent).cups, ['orphan']);
});

test('offline: nothing is marked as refused, everything stays pending, and the error is reported for a retry', async () => {
  const { s, api } = fakeServer();
  s.offline = true;
  const d = journal();
  const sent = await push(api, d, d.pending);
  assert.ok(sent.error);
  assert.equal(isPermanent(sent.error), false);
  const next = settle(d, d, sent);
  assert.deepEqual(next.cups.sort(), ['cup-emoji', 'cup-ok', 'cup-seed']);
  assert.deepEqual(Object.keys(next.rejected ?? {}), ['coffee:emoji']);
  // Back online: the next try sends the rest.
  s.offline = false;
  const d2: Synced = { ...d, pending: next };
  const sent2 = await push(api, d2, sendable(d2));
  assert.equal(sent2.error, undefined);
  assert.deepEqual(settle(d2, d2, sent2).cups, ['cup-emoji']);
});

test('a row changed while the push ran is sent again, even if the server refused the old version', () => {
  const d = journal();
  const p: Pending = { ...d.pending, rejected: {} };
  const sentFrom: Synced = { ...d, pending: p };
  // While the push ran, the user edited cup-ok.
  const now: Synced = { ...sentFrom, cups: sentFrom.cups.map((c) => (c.id === 'cup-ok' ? { ...c, grind: 22 } : c)) };
  const next = settle(now, sentFrom, { ...emptyPending, cups: [], rejected: { 'cup:cup-ok': 'refused' } });
  assert.equal(next.rejected, undefined);
  assert.ok(sendable({ cups: now.cups, pending: next }).cups.includes('cup-ok'));
});
