import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ensureGuest, GuestUnavailable } from '../src/lib/guest.ts';
import { describeError, logError } from '../src/lib/log.ts';
import { CHUNK_CHARS, createSecureSessionStorage, secureKey, SessionStorageUnavailable, splitChunks, type KeyValueStore } from '../src/lib/secureStorage.ts';

type Op = 'get' | 'set' | 'remove';
/** In-memory store like SecureStore (key characters, 2 KB per value). `fail` decides per call whether it throws. */
function keychain(fail: (op: Op, key: string) => boolean = () => false) {
  const map = new Map<string, string>();
  const store: KeyValueStore & { map: Map<string, string>; fail: (op: Op, key: string) => boolean } = {
    map,
    fail,
    async getItem(k) {
      if (store.fail('get', k)) throw new Error('unavailable');
      return map.has(k) ? map.get(k)! : null;
    },
    async setItem(k, v) {
      if (store.fail('set', k)) throw new Error('unavailable');
      if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error('bad key ' + k);
      if (Buffer.byteLength(v) > 2048) throw new Error('too large');
      map.set(k, v);
    },
    async removeItem(k) {
      if (store.fail('remove', k)) throw new Error('unavailable');
      map.delete(k);
    },
  };
  return store;
}
/** Like AsyncStorage. */
function asyncStorage(fail: (op: Op, key: string) => boolean = () => false) {
  return keychain(fail) as ReturnType<typeof keychain>;
}
/** Fails exactly the n-th set call (0-based) and nothing else. */
function failNthSet(n: number) {
  let calls = 0;
  return (op: Op) => op === 'set' && calls++ === n;
}

const KEY = 'sb-project-auth-token';
const sessionJson = (tag: string) => JSON.stringify({ access_token: tag.repeat(1500), refresh_token: 'refresh-' + tag, user: { id: 'u', name: 'Röststätte ☕' } });
const A = sessionJson('a');
const B = sessionJson('b');
const chunksOf = (v: string) => splitChunks(v).length;
let clock = 1_000;
const tick = () => (clock += 10);

test('a session larger than one keychain entry is stored in chunks and read back whole, also after a restart', async () => {
  const secure = keychain();
  const legacy = asyncStorage();
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, A);
  assert.ok(chunksOf(A) > 1);
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), A);
  assert.equal(legacy.map.size, 0, 'nothing in AsyncStorage');
});

test('chunks stay below 2 KB even with three-byte characters', () => {
  for (const part of splitChunks('☕'.repeat(5000))) assert.ok(Buffer.byteLength(part) <= 2048);
  assert.ok(CHUNK_CHARS * 3 <= 2048);
});

test('a failure at any step of a keychain write: the newer session wins via the fallback, after a restart too', async () => {
  const steps = chunksOf(B) + 1; // every chunk, then the commit marker
  for (let n = 0; n < steps; n++) {
    const secure = keychain();
    const legacy = asyncStorage();
    await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, A);
    secure.fail = failNthSet(n);
    await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, B);
    secure.fail = () => false;
    const restarted = createSecureSessionStorage(secure, legacy, undefined, tick);
    assert.equal(await restarted.getItem(KEY), B, `failure at step ${n}: newest session, never A or a mix`);
    assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), B, `step ${n}: stable`);
  }
});

test('a failure at any step while the keychain stays broken: still the newer session after a restart', async () => {
  for (let n = 0; n < chunksOf(B) + 1; n++) {
    const secure = keychain();
    const legacy = asyncStorage();
    await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, A);
    secure.fail = failNthSet(n);
    await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, B);
    // After the restart the keychain answers reads, but every write still fails.
    secure.fail = (op) => op === 'set';
    assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), B, `step ${n}`);
  }
});

test('if the keychain and the fallback both fail, the last complete session stays readable', async () => {
  for (let n = 0; n < chunksOf(B) + 1; n++) {
    const secure = keychain();
    const legacy = asyncStorage();
    await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, A);
    secure.fail = failNthSet(n);
    legacy.fail = (op) => op === 'set';
    await assert.rejects(createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, B));
    secure.fail = () => false;
    legacy.fail = () => false;
    assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), A, `step ${n}: A, not a mix`);
  }
});

test('once the keychain works again, the fallback session moves back into it', async () => {
  const secure = keychain();
  const legacy = asyncStorage();
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, A);
  secure.fail = (op) => op === 'set';
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, B);
  assert.ok(legacy.map.has(KEY + '.fallback'));
  secure.fail = () => false;
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), B);
  assert.equal(legacy.map.size, 0, 'fallback cleared once B is in the keychain');
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), B);
});

test('a stale fallback (older generation) loses to the keychain', async () => {
  const secure = keychain();
  const legacy = asyncStorage();
  secure.fail = (op) => op === 'set';
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, A);
  secure.fail = () => false;
  legacy.fail = (op) => op === 'remove'; // the old fallback can't be removed
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, B);
  legacy.fail = () => false;
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), B);
});

test('a keychain that can briefly not be read: no answer, nothing overwritten, the right session afterwards', async () => {
  const secure = keychain();
  const legacy = asyncStorage();
  secure.fail = (op) => op === 'set';
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, A); // A in the fallback
  secure.fail = () => false;
  legacy.fail = (op) => op === 'remove';
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, B); // B in the keychain, stale A stays
  legacy.fail = () => false;
  secure.fail = (op) => op === 'get';
  await assert.rejects(createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), SessionStorageUnavailable, 'neither A nor "no session"');
  secure.fail = () => false;
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), B, 'B was not overwritten');
});

type Where = 'keychain' | 'fallback';
const readFailures: [string, Where[], (secure: ReturnType<typeof keychain>, legacy: ReturnType<typeof asyncStorage>) => void][] = [
  ['keychain not readable', ['keychain', 'fallback'], (secure) => { secure.fail = (op) => op === 'get'; }],
  // Only matters where the session has chunks in the keychain.
  ['keychain marker readable, chunks not', ['keychain'], (secure) => { secure.fail = (op, k) => op === 'get' && !k.endsWith('.n'); }],
  ['AsyncStorage not readable', ['keychain', 'fallback'], (_s, legacy) => { legacy.fail = (op) => op === 'get'; }],
];

for (const [name, wheres, breakIt] of readFailures) {
  test(`read failure (${name}) with a session stored: never "no session", nothing deleted`, async () => {
    for (const where of wheres) {
      const secure = keychain();
      const legacy = asyncStorage();
      if (where === 'fallback') secure.fail = (op) => op === 'set';
      await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, A);
      secure.fail = () => false;
      const before = [new Map(secure.map), new Map(legacy.map)];
      breakIt(secure, legacy);
      const s = createSecureSessionStorage(secure, legacy, undefined, tick);
      await assert.rejects(s.getItem(KEY), SessionStorageUnavailable, `${where}: rejects instead of null`);
      assert.deepEqual([secure.map, legacy.map], before, `${where}: nothing changed`);
      secure.fail = () => false;
      legacy.fail = () => false;
      assert.equal(await s.getItem(KEY), A, `${where}: same instance reads A once the store is back`);
      assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), A, `${where}: and after a restart`);
    }
  });
}

test('a newer session in the fallback is not swapped for the older keychain copy when AsyncStorage cannot be read', async () => {
  const secure = keychain();
  const legacy = asyncStorage();
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, A);
  secure.fail = (op) => op === 'set';
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, B); // B newer, in the fallback
  secure.fail = () => false;
  legacy.fail = (op) => op === 'get';
  await assert.rejects(createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), SessionStorageUnavailable);
  legacy.fail = () => false;
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), B);
});

test('a single failed read is retried and answered normally', async () => {
  const secure = keychain();
  const legacy = asyncStorage();
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, A);
  let once = true;
  secure.fail = (op) => op === 'get' && once && !(once = false);
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), A);
});

test('a committed session with a chunk missing is not reported as "no session"', async () => {
  const secure = keychain();
  const legacy = asyncStorage();
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, A);
  const chunk = [...secure.map.keys()].find((k) => k.endsWith('.1'))!;
  secure.map.delete(chunk);
  await assert.rejects(createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), SessionStorageUnavailable);
});

test('a keychain read failure never starts a new guest account; afterwards the original account is used', async () => {
  // The auth client supabase-js uses, with the real storage adapter; ensureGuest() is what ensureUser() runs.
  const { AuthClient } = await import('@supabase/auth-js');
  const secure = keychain();
  const legacy = asyncStorage();
  const stored = JSON.stringify({ access_token: 'x', refresh_token: 'refresh-A', expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: 'user-A' } });
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, stored);
  const before = [new Map(secure.map), new Map(legacy.map)];
  secure.fail = (op) => op === 'get';
  const requests: string[] = [];
  const auth = new AuthClient({
    url: 'http://127.0.0.1:9/auth/v1',
    storage: createSecureSessionStorage(secure, legacy, undefined, tick),
    storageKey: KEY,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    // Any request (sign-up of a guest, token refresh) would be a failure of this test.
    fetch: async (url: RequestInfo | URL) => { requests.push(String(url)); return new Response(JSON.stringify({ user: { id: 'user-B' } }), { status: 200 }); },
  });
  await assert.rejects(auth.getSession(), SessionStorageUnavailable, 'getSession() passes the failure on');
  await assert.rejects(ensureGuest(auth), (e) => e instanceof GuestUnavailable && e.reason === 'storage');
  assert.deepEqual(requests, [], 'no signInAnonymously, no refresh');
  assert.deepEqual([secure.map, legacy.map], before, 'nothing stored or deleted');
  secure.fail = () => false;
  assert.equal(await ensureGuest(auth), 'user-A', 'the original guest account once the keychain is back');
  assert.equal(await ensureGuest(new AuthClient({ url: 'http://127.0.0.1:9/auth/v1', storage: createSecureSessionStorage(secure, legacy, undefined, tick), storageKey: KEY, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, fetch: async () => { throw new Error('offline'); } })), 'user-A', 'and after a restart');
  assert.deepEqual(requests, []);
});

test('only a session that is really not there leads to a new guest account', async () => {
  let signIns = 0;
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    signInAnonymously: async () => { signIns++; return { data: { user: { id: 'new' } }, error: null }; },
  };
  assert.equal(await ensureGuest(auth), 'new');
  assert.equal(signIns, 1);
  const failing = { ...auth, getSession: async () => ({ data: { session: null }, error: { message: 'refresh failed' } }) };
  await assert.rejects(ensureGuest(failing), GuestUnavailable);
  assert.equal(signIns, 1, 'an error from getSession() is not "no session"');
});

test('the newest write wins even if the clock jumps back', async () => {
  const secure = keychain();
  const legacy = asyncStorage();
  let t = 10_000;
  const back = () => (t -= 100);
  const s = createSecureSessionStorage(secure, legacy, undefined, back);
  await s.setItem(KEY, A);
  secure.fail = (op) => op === 'set';
  await s.setItem(KEY, B);
  secure.fail = () => false;
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, back).getItem(KEY), B);
});

test('a shorter session leaves no chunks of the longer one behind', async () => {
  const secure = keychain();
  const s = createSecureSessionStorage(secure, asyncStorage(), undefined, tick);
  await s.setItem(KEY, A);
  await s.setItem(KEY, 'short');
  assert.equal(await s.getItem(KEY), 'short');
  assert.equal(secure.map.size, 2, 'one chunk and the marker');
});

test('a session from an older app version moves from AsyncStorage to the keychain', async () => {
  const secure = keychain();
  const legacy = asyncStorage();
  legacy.map.set(KEY, A);
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), A, 'same session, so no new anonymous account');
  assert.equal(legacy.map.size, 0, 'old copy gone');
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), A, 'now read from the keychain');
});

test('if the keychain is unavailable, an old-version session is neither lost nor reported as "no session"', async () => {
  const secure = keychain(() => true);
  const legacy = asyncStorage();
  legacy.map.set(KEY, A);
  const errors: string[] = [];
  await assert.rejects(createSecureSessionStorage(secure, legacy, (w) => errors.push(w), tick).getItem(KEY), SessionStorageUnavailable);
  assert.ok(errors.includes('read'));
  assert.equal(legacy.map.get(KEY), A, 'not removed while it is the only copy');
  secure.fail = () => false;
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), A, 'moved over once the keychain is back');
  assert.equal(legacy.map.has(KEY), false);
});

test('if AsyncStorage cannot be read, an old-version session is not reported as "no session"', async () => {
  const secure = keychain();
  const legacy = asyncStorage((op) => op === 'get');
  legacy.map.set(KEY, A);
  await assert.rejects(createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), SessionStorageUnavailable);
  legacy.fail = () => false;
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), A);
});

test('signing out removes the session everywhere', async () => {
  const secure = keychain();
  const legacy = asyncStorage();
  const s = createSecureSessionStorage(secure, legacy, undefined, tick);
  await s.setItem(KEY, A);
  await s.removeItem(KEY);
  assert.equal(secure.map.size, 0);
  assert.equal(legacy.map.size, 0);
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), null);
});

test('signing out while the keychain cannot be cleared: the old session does not come back after a restart', async () => {
  const secure = keychain();
  const legacy = asyncStorage();
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, A);
  secure.fail = (op) => op === 'remove';
  await createSecureSessionStorage(secure, legacy, undefined, tick).removeItem(KEY);
  secure.fail = () => false;
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), null);
  // A new sign-in after that is stored and read normally.
  await createSecureSessionStorage(secure, legacy, undefined, tick).setItem(KEY, B);
  assert.equal(await createSecureSessionStorage(secure, legacy, undefined, tick).getItem(KEY), B);
});

test('keys only use characters SecureStore accepts', () => {
  assert.equal(secureKey('sb-abc-auth-token'), 'sb-abc-auth-token');
  assert.equal(secureKey('a:b/c d'), 'a_b_c_d');
});

test('logged errors carry no message, details or tokens', () => {
  const pgError = { name: 'PostgrestError', code: '23505', message: 'duplicate key', details: 'Key (id)=(secret-row) already exists.', hint: null };
  const text = describeError(pgError);
  assert.equal(text, 'PostgrestError, code 23505');
  assert.ok(!text.includes('secret-row'));
  const authError = Object.assign(new Error('Invalid Refresh Token: eyJhbGciOi'), { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' });
  assert.equal(describeError(authError), 'AuthApiError, code refresh_token_not_found, status 400');
  assert.equal(describeError('eyJ-token-as-string'), 'string');
});

test('nothing is logged outside development builds', () => {
  const warn = console.warn;
  const seen: unknown[] = [];
  console.warn = (...a: unknown[]) => { seen.push(a); };
  try {
    logError('Sync failed', new Error('x'));
  } finally {
    console.warn = warn;
  }
  assert.equal(seen.length, 0);
});
