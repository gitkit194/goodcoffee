// Storage for the Supabase session (access and refresh token) in the phone's keychain / keystore.
//
// Before, the session lay in AsyncStorage: an unencrypted file in the app's sandbox, which Android's
// auto backup also copies to the cloud. Now it lives in SecureStore. What this file takes care of:
// * Size: some iOS versions reject keychain values above about 2 KB, and a session is larger. The value
//   is split into chunks.
// * No mixed or stale sessions: every write gets a new, higher generation number. Its chunks are stored
//   under their own keys (`<key>.<generation>.<i>`), and only a final single write of the commit marker
//   (`<key>.n` = `<generation>:<chunks>`) makes them current. A write that breaks off half-way leaves
//   the previous complete session in place; chunks of two writes can never be put together.
// * Fallback: if the keychain fails, the session goes to AsyncStorage as one entry together with its
//   generation (`<key>.fallback`). Reading picks the highest generation of the two, so the newest
//   successful write always wins, also after a restart. Sign-out leaves a tombstone with a newer
//   generation where the keychain can't be cleared, so an old session can't come back.
// * Reading never guesses: if the keychain or AsyncStorage can't be read (after one retry), getItem
//   throws SessionStorageUnavailable instead of answering "no session" or with a possibly older copy.
//   "No session" would make the app sign in a new anonymous account.
// * Moving over: a session still in AsyncStorage under the plain key (older app version) is moved on
//   first read, so nobody gets a new anonymous account (and loses the link to their synced cups).
//
// Losing the session means losing the anonymous account, so every step is chosen so the last complete
// session stays readable whatever fails. Pure logic with injected stores, tested in
// tests/secure-storage.test.ts.

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/**
 * Thrown by getItem when the stored session can't be read right now (keychain or AsyncStorage not
 * reachable, or a committed session incomplete). Never answered with "no session": Supabase would then
 * sign in a new anonymous account, and the user would lose the link to everything synced so far.
 * The message carries no data. Supabase passes the error on from getSession(); the app then stays local.
 */
export class SessionStorageUnavailable extends Error {
  constructor(where: string) {
    super(`session storage unavailable (${where})`);
    this.name = 'SessionStorageUnavailable';
  }
}

/** Characters per chunk. 600 characters stay below 2 KB even if every one takes three bytes in UTF-8. */
export const CHUNK_CHARS = 600;
/** More chunks than this is not a session; refuse instead of filling the keychain. */
const MAX_CHUNKS = 64;

/** SecureStore keys may only contain letters, digits, `.`, `-` and `_`. */
export function secureKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function splitChunks(value: string, size = CHUNK_CHARS): string[] {
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += size) parts.push(value.slice(i, i + size));
  return parts.length ? parts : [''];
}

type Marker = { gen: number; count: number };
/** A stored state: a session, or `null` for "signed out" (tombstone). */
type Entry = { gen: number; value: string | null };

function parseMarker(raw: string | null): Marker | null {
  const m = raw ? /^(\d{1,16}):(\d{1,3})$/.exec(raw) : null;
  if (!m) return null;
  const gen = Number(m[1]);
  const count = Number(m[2]);
  return Number.isSafeInteger(gen) && count >= 1 && count <= MAX_CHUNKS ? { gen, count } : null;
}

function parseFallback(raw: string | null): Entry | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { gen?: unknown; value?: unknown };
    if (!Number.isSafeInteger(o.gen) || (typeof o.value !== 'string' && o.value !== null)) return null;
    return { gen: o.gen as number, value: o.value as string | null };
  } catch {
    return null;
  }
}

/**
 * `secure` is SecureStore, `legacy` AsyncStorage (where the session used to live, and the fallback).
 * `onError` gets failures of the secure store; it must not log the value. `now` is only for tests.
 */
export function createSecureSessionStorage(
  secure: KeyValueStore,
  legacy: KeyValueStore,
  onError: (where: string, e: unknown) => void = () => undefined,
  now: () => number = Date.now,
): KeyValueStore {
  const markerKey = (key: string) => `${secureKey(key)}.n`;
  const chunkKey = (key: string, gen: number, i: number) => `${secureKey(key)}.${gen}.${i}`;
  const fallbackKey = (key: string) => `${key}.fallback`;
  // Highest generation seen per key in this run: a new write is always above it, even if the clock jumps back.
  const seen = new Map<string, number>();
  const note = (key: string, gen: number) => seen.set(key, Math.max(seen.get(key) ?? 0, gen));

  async function readMarker(key: string): Promise<Marker | null> {
    return parseMarker(await secure.getItem(markerKey(key)));
  }

  /** Runs a read, once more if it throws; a second failure becomes SessionStorageUnavailable. */
  async function retried<T>(where: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch {
      try {
        return await read();
      } catch (e) {
        onError(where, e);
        throw new SessionStorageUnavailable(where);
      }
    }
  }

  /** The keychain's committed generation (marker) and its session; `entry` is null if a chunk is missing. */
  async function readSecure(key: string): Promise<{ marker: Marker | null; entry: Entry | null }> {
    const marker = await readMarker(key);
    if (!marker) return { marker: null, entry: null };
    note(key, marker.gen);
    const parts = await Promise.all(Array.from({ length: marker.count }, (_, i) => secure.getItem(chunkKey(key, marker.gen, i))));
    if (parts.some((p) => p === null)) return { marker, entry: null };
    return { marker, entry: { gen: marker.gen, value: parts.join('') } };
  }

  async function readFallback(key: string): Promise<Entry | null> {
    const entry = parseFallback(await legacy.getItem(fallbackKey(key)));
    if (entry) note(key, entry.gen);
    return entry;
  }

  /**
   * The newest successful write of both stores. Throws SessionStorageUnavailable when that can't be
   * known: if either store can't be read, the other one may hold an older session, and "no session"
   * would be just as wrong.
   */
  async function readNewest(key: string): Promise<{ secure: Entry | null; newest: Entry | null }> {
    const fromSecure = await retried('read', () => readSecure(key));
    const fromFallback = await retried('read fallback', () => readFallback(key));
    if (fromSecure.marker && !fromSecure.entry) {
      // A committed generation with a chunk missing. Only a newer fallback (written because that very
      // commit failed half-way) is known to be right; otherwise don't guess.
      if (fromFallback && fromFallback.gen > fromSecure.marker.gen) return { secure: null, newest: fromFallback };
      onError('incomplete', new Error('incomplete'));
      throw new SessionStorageUnavailable('incomplete');
    }
    const s = fromSecure.entry;
    const newest = s && (!fromFallback || s.gen > fromFallback.gen) ? s : fromFallback;
    return { secure: s, newest };
  }

  async function nextGen(key: string): Promise<number> {
    if (!seen.has(key)) {
      // Learn the stored generations first; if that fails, the clock alone has to do.
      await readNewest(key).catch(() => undefined);
      seen.set(key, seen.get(key) ?? 0);
    }
    const gen = Math.max(now(), (seen.get(key) ?? 0) + 1);
    note(key, gen);
    return gen;
  }

  /** Writes all chunks of a new generation, then commits it with one marker write. */
  async function writeSecure(key: string, gen: number, value: string): Promise<void> {
    const parts = splitChunks(value);
    if (parts.length > MAX_CHUNKS) throw new Error('value too large for secure storage');
    const previous = await readMarker(key).catch(() => null);
    try {
      for (let i = 0; i < parts.length; i++) await secure.setItem(chunkKey(key, gen, i), parts[i]);
      await secure.setItem(markerKey(key), `${gen}:${parts.length}`);
    } catch (e) {
      // Not committed: the previous generation is still the current one. Tidy up what was written.
      for (let i = 0; i < parts.length; i++) await secure.removeItem(chunkKey(key, gen, i)).catch(() => undefined);
      throw e;
    }
    if (previous && previous.gen !== gen) await removeChunks(key, previous);
  }

  async function removeChunks(key: string, marker: Marker): Promise<void> {
    for (let i = 0; i < marker.count; i++) await secure.removeItem(chunkKey(key, marker.gen, i)).catch(() => undefined);
  }

  async function writeFallback(key: string, entry: Entry): Promise<void> {
    await legacy.setItem(fallbackKey(key), JSON.stringify(entry));
  }

  async function store(key: string, value: string): Promise<void> {
    const gen = await nextGen(key);
    try {
      await writeSecure(key, gen, value);
    } catch (e) {
      // Without a stored session the next start would create a new anonymous account. So rather than
      // that, keep it in AsyncStorage; its higher generation makes it win over the older keychain copy.
      onError('write', e);
      await writeFallback(key, { gen, value });
      await legacy.removeItem(key).catch(() => undefined);
      return;
    }
    // The keychain holds the newest session now; older copies elsewhere lose on generation anyway.
    await legacy.removeItem(fallbackKey(key)).catch(() => undefined);
    await legacy.removeItem(key).catch(() => undefined);
  }

  return {
    async getItem(key) {
      const { secure: fromSecure, newest } = await readNewest(key);
      if (newest) {
        // A fallback newer than the keychain: move it back into the keychain.
        if (newest.value !== null && newest !== fromSecure) await store(key, newest.value).catch(() => undefined);
        return newest.value;
      }
      const old = await retried('read legacy', () => legacy.getItem(key));
      if (old === null) return null;
      // Session of an older app version: move it over; the plain copy is only dropped once it is stored.
      try {
        await store(key, old);
      } catch (e) {
        onError('migrate', e);
      }
      return old;
    },
    setItem: store,
    async removeItem(key) {
      const gen = await nextGen(key);
      // A tombstone first, so that if clearing the keychain fails the old session can't come back.
      const tombstone = await writeFallback(key, { gen, value: null }).then(() => true, () => false);
      let cleared = false;
      try {
        const marker = await readMarker(key);
        await secure.removeItem(markerKey(key));
        if (marker) await removeChunks(key, marker);
        cleared = true;
      } catch (e) {
        onError('remove', e);
      }
      await legacy.removeItem(key).catch(() => undefined);
      if (cleared || !tombstone) await legacy.removeItem(fallbackKey(key)).catch(() => undefined);
    },
  };
}
