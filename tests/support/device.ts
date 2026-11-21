// A simulated phone and server for the sync tests. The phone keeps its journal in a fake storage and
// syncs with the same steps as the app's store (sendable → push → applySent → write); only React is
// left out. The server behaves like the database: upserts by id, share_coffee returns the existing
// bean for a repeated id, refuses names without letters or digits. Its answers can be delayed or lost.
import { applySent, type Journal } from '../../src/data/journal.ts';
import { emptyPending, hasPending, sendable } from '../../src/data/pending.ts';
import { createWriter, loadStored } from '../../src/data/persist.ts';
import { push, type Api } from '../../src/data/push.ts';
import { matchKey } from '../../src/lib/community.ts';

export const KEY = 'goodcoffee:data:v1';

export function newJournal(): Journal {
  return { profile: { name: '', grinder: '', since: '2026-10-30T00:00:00.000Z' }, roasters: [], coffees: [], beans: {}, cups: [], pending: emptyPending };
}

type Row = Record<string, unknown>;

export class Server {
  coffees = new Map<string, Row>();
  cups = new Map<string, Row>();
  ratings = new Map<string, Row>();
  /** Every write that changed something, to count duplicates. */
  inserts: string[] = [];
  offline = false;
  /** The next n answers are lost after the server did the work (connection drops on the way back). */
  loseAnswers = 0;
  /** While set, every call waits for it (a slow upload). */
  gate: Promise<void> | null = null;
  /** Local bean id → id of the same bean someone else shared first; share_coffee answers with that one. */
  sameAs = new Map<string, string>();

  private async call<T>(work: () => T): Promise<{ data?: T; error: { code?: string; message: string } | null }> {
    if (this.gate) await this.gate;
    if (this.offline) return { error: { message: 'Network request failed' } };
    let data: T;
    try {
      data = work();
    } catch (e) {
      return { error: e as { code?: string; message: string } };
    }
    if (this.loseAnswers > 0) {
      this.loseAnswers--;
      return { error: { message: 'Network request failed' } };
    }
    return { data, error: null };
  }

  api(uid: string): Api {
    return {
      userId: async () => {
        if (this.offline) throw new Error('offline');
        return uid;
      },
      shareCoffee: async ({ p_id, p_coffee }) => {
        if (!matchKey(String(p_coffee.name))) return { error: { code: '22023', message: 'a coffee needs a name' } };
        return this.call(() => {
          const existing = this.sameAs.get(p_id);
          if (existing) {
            this.coffees.set(existing, this.coffees.get(existing) ?? { id: existing, ...p_coffee });
            return [{ coffee_id: existing, roaster_id: null }];
          }
          if (!this.coffees.has(p_id)) this.inserts.push('coffee:' + p_id);
          this.coffees.set(p_id, { id: p_id, ...p_coffee });
          return [{ coffee_id: p_id, roaster_id: null }];
        });
      },
      upsert: async (table, rows) =>
        this.call(() => {
          for (const r of rows) {
            if (table !== 'profiles' && !this.coffees.has(String(r.coffee_id)) && !String(r.coffee_id).startsWith('seed')) {
              throw Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
            }
          }
          for (const r of rows) {
            if (table === 'cups') {
              if (!this.cups.has(String(r.id))) this.inserts.push('cup:' + r.id);
              this.cups.set(String(r.id), r);
            } else if (table === 'user_coffees') {
              const k = `${r.user_id}/${r.coffee_id}`;
              if (!this.ratings.has(k)) this.inserts.push('rating:' + k);
              this.ratings.set(k, r);
            }
          }
          return null;
        }),
      deleteCups: async (ids) => this.call(() => ids.forEach((id) => this.cups.delete(id))),
    };
  }
}

/** One phone. `restart()` drops everything in memory, like the app being killed, and reads the disk again. */
export class Phone {
  disk = new Map<string, string>();
  journal: Journal = newJournal();
  /** The next n writes to the phone's storage fail. */
  failWrites = 0;
  private server: Server;
  private uid: string;
  private writer;

  constructor(server: Server, uid = 'user-1') {
    this.server = server;
    this.uid = uid;
    this.writer = this.newWriter();
  }

  private newWriter() {
    return createWriter<Journal>(
      {
        getItem: async (k) => this.disk.get(k) ?? null,
        setItem: async (k, v) => {
          if (this.failWrites > 0) {
            this.failWrites--;
            throw new Error('disk full');
          }
          this.disk.set(k, v);
        },
      },
      KEY,
    );
  }

  /** A user action: change the journal and save it, as the store's commit does. */
  async change(fn: (j: Journal) => Journal) {
    this.journal = fn(this.journal);
    await this.writer.write(this.journal);
  }

  async restart() {
    this.writer = this.newWriter();
    const res = await loadStored<Journal>({ getItem: async (k) => this.disk.get(k) ?? null, setItem: async () => undefined }, KEY);
    if (res.state === 'error') throw new Error('journal unreadable');
    this.journal = res.state === 'loaded' ? res.data : newJournal();
  }

  /**
   * One sync as the store runs it. With `killBeforeSave` the app dies after the server answered and
   * before the result is on disk: the server has the data, the phone still thinks it is pending.
   */
  async sync(opts: { during?: () => Promise<void>; killBeforeSave?: boolean } = {}) {
    const snapshot = this.journal;
    const toSend = sendable(snapshot);
    if (!hasPending(toSend)) return null;
    const pushing = push(this.server.api(this.uid), snapshot, toSend).catch((e) => ({ thrown: e }));
    if (opts.during) await opts.during();
    const sent = await pushing;
    if ('thrown' in sent) return sent;
    if (opts.killBeforeSave) {
      await this.restart();
      return sent;
    }
    // As the store: one change, one write; a failed write is not fatal for the sync itself.
    await this.change((now) => applySent(now, snapshot, sent, [])).catch(() => undefined);
    return sent;
  }

  /** Syncs until nothing is left to send, as the retries would; at most `max` rounds. */
  async syncUntilDone(max = 5) {
    for (let i = 0; i < max && hasPending(sendable(this.journal)); i++) await this.sync();
  }
}
