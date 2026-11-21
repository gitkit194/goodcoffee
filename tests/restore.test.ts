// Restoring the journal from the server after the app was installed again (src/data/restore.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mark } from '../src/data/pending.ts';
import { fetchRestore, mergeRestored, PAGE, type RestoreApi } from '../src/data/restore.ts';
import type { Journal } from '../src/data/journal.ts';
import { newJournal } from './support/device.ts';

type Row = Record<string, unknown>;

function cupRow(id: string, coffee_id: string, brewed_at: string, extra: Row = {}): Row {
  return { id, coffee_id, brewed_at, grind: '20.0', dose_g: 18, yield_g: '36.5', time_s: 28, extraction: 5, sweetness: null, acidity: 4, body: 6, aromas: ['choc'], ...extra };
}

function fakeApi(opts: { uid?: string | null; cups?: Row[]; beans?: Row[]; profile?: Row[]; failSession?: boolean; offline?: boolean }) {
  const calls: string[] = [];
  const api: RestoreApi = {
    async storedUserId() {
      calls.push('session');
      if (opts.failSession) throw new Error('keychain locked');
      return opts.uid === undefined ? 'user-1' : opts.uid;
    },
    async page(table, uid, from, to) {
      calls.push(`${table}:${from}-${to}`);
      if (opts.offline) return { data: null, error: new Error('Network request failed') };
      const rows = (table === 'cups' ? opts.cups : opts.beans) ?? [];
      return { data: rows.filter((r) => (r.user_id ?? uid) === uid).slice(from, to + 1), error: null };
    },
    async profile() {
      calls.push('profile');
      return { data: opts.profile ?? [], error: null };
    },
    async coffees(ids) {
      calls.push('coffees');
      return { data: ids.map((id) => ({ id, name: 'Bohne ' + id, roaster_id: null, roaster_notes: [] })), error: null };
    },
  };
  return { api, calls };
}

test('no stored session: nothing to restore, and no sign-in is attempted', async () => {
  const { api, calls } = fakeApi({ uid: null });
  assert.equal(await fetchRestore(api), null);
  assert.deepEqual(calls, ['session']);
});

test('a session that cannot be read or a server that cannot be reached throws (tried again later)', async () => {
  await assert.rejects(fetchRestore(fakeApi({ failSession: true }).api));
  await assert.rejects(fetchRestore(fakeApi({ offline: true }).api));
});

test('reads cups, list, profile and master data; numbers from the database become numbers', async () => {
  const { api } = fakeApi({
    cups: [cupRow('c1', 'k1', '2026-10-01T08:00:00Z'), cupRow('c2', 'k2', '2026-10-02T08:00:00Z')],
    beans: [{ coffee_id: 'k1', roast_date: '2026-09-20', rating: 4, comment: 'Beere', created_at: '2026-09-25T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }],
    profile: [{ display_name: 'Alex', grinder: 'Comandante', created_at: '2026-09-01T00:00:00Z' }],
  });
  const r = await fetchRestore(api);
  assert.ok(r);
  assert.deepEqual(r.cups.map((c) => c.id), ['c2', 'c1'], 'newest first');
  assert.equal(r.cups[0].grind, 20);
  assert.equal(r.cups[0].yield_g, 36.5);
  assert.equal(r.cups[0].sweetness, null);
  assert.deepEqual(r.beans.k1, { coffee_id: 'k1', roast_date: '2026-09-20', rating: 4, comment: 'Beere', added_at: '2026-09-25T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' });
  assert.deepEqual(r.profile, { name: 'Alex', grinder: 'Comandante', since: '2026-09-01T00:00:00Z' });
  assert.deepEqual(r.coffees.map((c) => c.id).sort(), ['k1', 'k2']);
});

test('more cups than one page are all read', async () => {
  const cups = Array.from({ length: PAGE + 5 }, (_, i) => cupRow('c' + i, 'k1', new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));
  const { api, calls } = fakeApi({ cups });
  const r = await fetchRestore(api);
  assert.equal(r?.cups.length, PAGE + 5);
  assert.ok(calls.includes(`cups:${PAGE}-${2 * PAGE - 1}`));
});

test('merge: cups logged here stay, deleted cups stay deleted, edited fields and profile win, nothing is queued', async () => {
  const { api } = fakeApi({
    cups: [cupRow('c1', 'k1', '2026-10-01T08:00:00Z'), cupRow('c2', 'k1', '2026-10-02T08:00:00Z'), cupRow('c3', 'k3', '2026-10-03T08:00:00Z')],
    beans: [{ coffee_id: 'k1', roast_date: null, rating: 2, comment: null, updated_at: '2026-10-01T00:00:00Z' }],
    profile: [{ display_name: 'Server-Name', grinder: null }],
  });
  const r = (await fetchRestore(api))!;
  // While the restore ran, the user logged a cup c1 (same id, edited here), deleted c2 and set a name.
  const base = newJournal();
  const phone: Journal & { restore?: 'pending' } = {
    ...base,
    restore: 'pending',
    restoreTouched: { k1: ['rating'] },
    profile: { ...base.profile, name: 'Phone-Name' },
    beans: { k1: { coffee_id: 'k1', roast_date: null, rating: 5, comment: null, added_at: 'x', updated_at: 'y' } },
    cups: [{ ...r.cups.find((c) => c.id === 'c1')!, grind: 30 }],
    pending: mark(mark(base.pending, { cups: ['c1'], beans: ['k1'], profile: true }), { deletedCups: ['c2'] }),
  };
  const merged = mergeRestored(phone, r);
  assert.equal(merged.restore, undefined, 'done');
  assert.equal(merged.restoreTouched, undefined);
  assert.deepEqual(merged.cups.map((c) => c.id), ['c3', 'c1']);
  assert.equal(merged.cups.find((c) => c.id === 'c1')!.grind, 30, "the phone's edit wins");
  assert.equal(merged.beans.k1.rating, 5, 'the rating edited here wins');
  assert.ok(merged.beans.k3, 'a bean with only cups is on the list');
  assert.equal(merged.profile.name, 'Phone-Name');
  assert.deepEqual(merged.pending, phone.pending, 'restored rows are not sent again');
  assert.ok(merged.standIns?.k3, 'master data for display until the catalogue has it');
});

test('a fresh journal gets everything, profile included', async () => {
  const { api } = fakeApi({ cups: [cupRow('c1', 'k1', '2026-10-01T08:00:00Z')], profile: [{ display_name: 'Alex', grinder: 'C40' }] });
  const merged = mergeRestored({ ...newJournal(), restore: 'pending' as const }, (await fetchRestore(api))!);
  assert.deepEqual(merged.cups.map((c) => c.id), ['c1']);
  assert.equal(merged.profile.name, 'Alex');
  assert.equal(merged.profile.grinder, 'C40');
});
