// Reading and writing the journal on the phone. No React, so it can be tested with a fake storage.
//
// Two rules keep the journal safe:
// * A failed read is not an empty journal. The app does not start (and so never writes) until the
//   stored journal was read, or the storage really holds none.
// * A change counts as saved only once it is on disk. `write` answers when the version it was given,
//   or a newer one, has been written, and fails if that write failed.

export type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type Loaded<T> =
  | { state: 'empty' }
  | { state: 'loaded'; data: T }
  /** Storage could not be read (try again), or holds something that is not a journal (kept untouched). */
  | { state: 'error'; kind: 'read' | 'corrupt'; error: unknown };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reads the stored journal. A read that fails is tried a few times before it counts as an error. */
export async function loadStored<T>(storage: Storage, key: string, opts: { attempts?: number; delayMs?: number } = {}): Promise<Loaded<T>> {
  const attempts = opts.attempts ?? 3;
  let raw: string | null = null;
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      raw = await storage.getItem(key);
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await wait(opts.delayMs ?? 200);
    }
  }
  if (lastError) return { state: 'error', kind: 'read', error: lastError };
  if (raw == null || raw === '') return { state: 'empty' };
  try {
    const data = JSON.parse(raw) as T;
    if (!data || typeof data !== 'object') throw new Error('stored journal is not an object');
    return { state: 'loaded', data };
  } catch (e) {
    return { state: 'error', kind: 'corrupt', error: e };
  }
}

/**
 * Writes the newest journal, one write at a time. Writes that arrive while one is running are folded
 * into a single write of the newest version. `write(v)` resolves once v or a newer version is on disk,
 * and rejects if the write that should have carried v failed.
 */
export function createWriter<T>(storage: Storage, key: string, serialize: (v: T) => string = JSON.stringify) {
  let version = 0;
  let written = 0;
  let latest: { version: number; value: T } | null = null;
  let running = false;
  let waiters: { version: number; resolve: () => void; reject: (e: unknown) => void }[] = [];

  const run = async () => {
    if (running) return;
    running = true;
    try {
      while (latest && latest.version > written) {
        const job = latest;
        try {
          await storage.setItem(key, serialize(job.value));
          written = job.version;
          const done = waiters.filter((w) => w.version <= written);
          waiters = waiters.filter((w) => w.version > written);
          done.forEach((w) => w.resolve());
        } catch (e) {
          // Everything up to this version is not on disk. Newer versions get their own attempt.
          const failed = waiters.filter((w) => w.version <= job.version);
          waiters = waiters.filter((w) => w.version > job.version);
          failed.forEach((w) => w.reject(e));
          if (latest === job) latest = null;
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    write(value: T): Promise<void> {
      version += 1;
      const v = version;
      latest = { version: v, value };
      const p = new Promise<void>((resolve, reject) => waiters.push({ version: v, resolve, reject }));
      void run();
      return p;
    },
  };
}
