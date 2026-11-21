// Review test 10 (server half): the app's own sync code against a separate Supabase TEST project, with
// two real anonymous users. Writes test data, so it refuses to run against the live project unless
// E2E_ALLOW_LIVE=1 is set; then remove the data afterwards (the run prints the roaster name and each user id as soon as it exists).
//
//   SUPABASE_TEST_URL=https://<test-ref>.supabase.co SUPABASE_TEST_KEY=sb_publishable_… npm run test:e2e
//
// The test project needs all migrations in supabase/migrations applied and anonymous sign-ins enabled.
// What it checks: a bean with umlauts, rating, note and a cup are created, edited and deleted through
// push(); ids, brew time, taste and note on the server match the phone; a refused bean does not block
// the rest; espresso and filter of the same name stay two beans across two users.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

import { applySent } from '../src/data/journal.ts';
import { emptyPending, hasPending, mark, sendable, editCup } from '../src/data/pending.ts';
import { push, type Api } from '../src/data/push.ts';
import type { Journal } from '../src/data/journal.ts';
import { SUPABASE_URL } from '../src/data/config.ts';

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_KEY;
if (!url || !key) throw new Error('SUPABASE_TEST_URL and SUPABASE_TEST_KEY must point to a separate test project.');
if (url.replace(/\/+$/, '') === SUPABASE_URL.replace(/\/+$/, '') && process.env.E2E_ALLOW_LIVE !== '1') throw new Error('Refusing to run against the live project (set E2E_ALLOW_LIVE=1 and clean up afterwards).');

async function user() {
  const client = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('anonymous sign-in failed');
  const uid = data.user.id;
  const api: Api = {
    userId: async () => uid,
    shareCoffee: async (args) => await client.rpc('share_coffee', args),
    upsert: async (table, rows) => await client.from(table).upsert(rows),
    deleteCups: async (ids) => await client.from('cups').delete().in('id', ids),
  };
  return { client, uid, api };
}

const journal = (): Journal => ({ profile: { name: '', grinder: '', since: new Date().toISOString() }, roasters: [], coffees: [], beans: {}, cups: [], pending: emptyPending });

async function syncUntilDone(api: Api, j: Journal): Promise<Journal> {
  for (let i = 0; i < 5 && hasPending(sendable(j)); i++) {
    const sent = await push(api, j, sendable(j));
    if (sent.error) throw sent.error;
    j = applySent(j, j, sent, []);
  }
  return j;
}

const run = randomUUID().slice(0, 8);
const roasterName = `E2E Rösterei ${run}`;
// Printed as soon as each piece exists, so a run that fails halfway still says what to clean up.
console.log(`cleanup: roaster "${roasterName}"`);
const now = new Date().toISOString();

// 1. Create: bean, rating and note, a cup, and a bean the server refuses.
const a = await user();
console.log(`cleanup: user ${a.uid}`);
const beanId = randomUUID();
const badId = randomUUID();
const cupId = randomUUID();
const cupBad = randomUUID();
let j = journal();
j = {
  ...j,
  roasters: [{ id: randomUUID(), name: roasterName }],
  coffees: [
    { id: beanId, roaster_id: null, name: 'Äthiopien Guji', roast_for: 'filter', roaster_notes: ['Jasmin'] },
    { id: badId, roaster_id: null, name: '☕', roaster_notes: [] },
  ],
  beans: { [beanId]: { coffee_id: beanId, roast_date: null, rating: 4, comment: 'blumig', added_at: now, updated_at: now } },
  cups: [
    { id: cupId, coffee_id: beanId, brewed_at: now, grind: 22, dose_g: 15, yield_g: 250, time_s: 180, extraction: 5, sweetness: 7, acidity: 6, body: 4, aromas: ['floral'] },
    { id: cupBad, coffee_id: badId, brewed_at: now, grind: 22, dose_g: 15, yield_g: 250, time_s: 180, extraction: 5, sweetness: null, acidity: null, body: null, aromas: [] },
  ],
};
j.coffees[0].roaster_id = j.roasters[0].id;
j = { ...j, pending: mark(emptyPending, { roasters: [j.roasters[0].id], coffees: [beanId, badId], beans: [beanId], cups: [cupId, cupBad] }) };
j = await syncUntilDone(a.api, j);
assert.ok(j.pending.rejected?.[`coffee:${badId}`], 'the refused bean is marked');
assert.deepEqual(j.pending.cups, [cupBad], 'only the cup of the refused bean waits');

const cup = await a.client.from('cups').select('*').eq('id', cupId).single();
assert.equal(cup.error, null);
assert.equal(new Date(cup.data.brewed_at).toISOString(), now, 'brew time unchanged');
assert.deepEqual([cup.data.sweetness, cup.data.acidity, cup.data.body, cup.data.aromas], [7, 6, 4, ['floral']]);
const rating = await a.client.from('user_coffees').select('*').eq('coffee_id', beanId).single();
assert.deepEqual([rating.data?.rating, rating.data?.comment], [4, 'blumig']);

// 2. Edit the cup: same id, same brew time, new values.
j = { ...j, cups: editCup(j.cups, cupId, { ...j.cups[0], grind: 20, sweetness: 8 }), pending: mark(j.pending, { cups: [cupId] }) };
j = await syncUntilDone(a.api, j);
const edited = await a.client.from('cups').select('*').eq('id', cupId).single();
assert.deepEqual([edited.data.grind, edited.data.sweetness, new Date(edited.data.brewed_at).toISOString()], [20, 8, now]);
const count = await a.client.from('cups').select('id', { count: 'exact', head: true }).eq('coffee_id', beanId);
assert.equal(count.count, 1, 'no second cup');

// 3. Delete it.
j = { ...j, cups: j.cups.filter((c) => c.id !== cupId), pending: mark(j.pending, { deletedCups: [cupId] }) };
j = await syncUntilDone(a.api, j);
const gone = await a.client.from('cups').select('id').eq('id', cupId);
assert.deepEqual(gone.data, []);

// 4. Two users: espresso and filter of one name stay apart, the same version is found again.
const b = await user();
console.log(`cleanup: user ${b.uid}`);
const share = async (u: typeof a, roastFor: string) => {
  const { data, error } = await u.client.rpc('share_coffee', { p_id: randomUUID(), p_roaster_id: null, p_roaster_name: roasterName, p_coffee: { name: 'House', roast_for: roastFor } });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data).coffee_id as string;
};
const [esp, fil] = await Promise.all([share(a, 'espresso'), share(b, 'filter')]);
assert.notEqual(esp, fil, 'espresso and filter are two beans');
assert.equal(await share(b, 'espresso'), esp, 'B finds A\'s espresso');

console.log(`ok: e2e against ${new URL(url).host} (run ${run})`);
