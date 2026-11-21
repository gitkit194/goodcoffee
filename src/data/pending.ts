// Pure bookkeeping for local changes that still have to reach Supabase. No React, no network.
import type { Coffee, Cup, MyBean, Profile, Roaster } from './types';

export type Pending = {
  roasters: string[];
  coffees: string[];
  beans: string[];
  cups: string[];
  deletedCups: string[];
  profile: boolean;
  /**
   * Rows the server refused for good (e.g. a name it does not accept), by `rowKey`, with the reason.
   * They stay pending and on the phone, but are not sent again until they change. They never hold up
   * other rows; only cups and list entries of a refused new bean wait for it.
   */
  rejected?: Record<string, string>;
};

export type RowKind = 'coffee' | 'bean' | 'cup' | 'profile';

export function rowKey(kind: RowKind, id = ''): string {
  return kind === 'profile' ? 'profile' : kind + ':' + id;
}

export const emptyPending: Pending = { roasters: [], coffees: [], beans: [], cups: [], deletedCups: [], profile: false };

export function hasPending(p: Pending): boolean {
  return p.profile || p.roasters.length + p.coffees.length + p.beans.length + p.cups.length + p.deletedCups.length > 0;
}

export type Synced = {
  profile: Profile;
  roasters: Roaster[];
  coffees: Coffee[];
  beans: Record<string, MyBean>;
  cups: Cup[];
  pending: Pending;
};

export function uniq(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

/** Queues rows for the next sync. A row that changes is sent again, even if the server refused it before. */
export function mark(p: Pending, patch: Partial<Pending>): Pending {
  let rejected = p.rejected;
  if (rejected) {
    const changed = [
      ...(patch.coffees ?? []).map((id) => rowKey('coffee', id)),
      ...(patch.beans ?? []).map((id) => rowKey('bean', id)),
      ...(patch.cups ?? []).map((id) => rowKey('cup', id)),
      ...(patch.profile ? [rowKey('profile')] : []),
    ].filter((k) => k in rejected!);
    if (changed.length) {
      rejected = { ...rejected };
      for (const k of changed) delete rejected[k];
    }
  }
  return {
    ...(rejected && Object.keys(rejected).length ? { rejected } : {}),
    roasters: uniq([...p.roasters, ...(patch.roasters ?? [])]),
    coffees: uniq([...p.coffees, ...(patch.coffees ?? [])]),
    beans: uniq([...p.beans, ...(patch.beans ?? [])]),
    cups: uniq([...p.cups, ...(patch.cups ?? [])]),
    deletedCups: uniq([...p.deletedCups, ...(patch.deletedCups ?? [])]),
    profile: p.profile || !!patch.profile,
  };
}

/**
 * After a push: clear what was sent, except rows that changed again while the push was running.
 * Every change replaces the row object, so "same object as in the snapshot" means "nothing new to send".
 */
export function settle(now: Synced, sentFrom: Synced, sent: Pending): Pending {
  const p = now.pending;
  const same = <T extends { id: string }>(list: T[], before: T[], id: string) => list.find((x) => x.id === id) === before.find((x) => x.id === id);
  // A refusal counts only for the row as it was sent; a row changed since gets another try.
  const rejected: Record<string, string> = { ...(p.rejected ?? {}) };
  for (const [key, reason] of Object.entries(sent.rejected ?? {})) {
    const [kind, id] = key.split(/:(.*)/s) as [RowKind, string];
    const unchanged =
      kind === 'coffee'
        ? same(now.coffees, sentFrom.coffees, id) && p.coffees.includes(id)
        : kind === 'bean'
          ? now.beans[id] === sentFrom.beans[id] && p.beans.includes(id)
          : kind === 'cup'
            ? same(now.cups, sentFrom.cups, id) && p.cups.includes(id)
            : now.profile === sentFrom.profile && p.profile;
    if (unchanged) rejected[key] = reason;
  }
  return {
    ...(Object.keys(rejected).length ? { rejected } : {}),
    roasters: p.roasters.filter((id) => !(sent.roasters.includes(id) && same(now.roasters, sentFrom.roasters, id))),
    coffees: p.coffees.filter((id) => !(sent.coffees.includes(id) && same(now.coffees, sentFrom.coffees, id))),
    beans: p.beans.filter((id) => !(sent.beans.includes(id) && now.beans[id] === sentFrom.beans[id])),
    cups: p.cups.filter((id) => !(sent.cups.includes(id) && same(now.cups, sentFrom.cups, id))),
    deletedCups: p.deletedCups.filter((id) => !sent.deletedCups.includes(id)),
    profile: p.profile && !(sent.profile && now.profile === sentFrom.profile),
  };
}

/**
 * What the next sync should try: everything pending except rows the server refused and that did not
 * change since, and the cups and list entries of a new bean it refused (they need that bean first).
 */
export function sendable(d: Pick<Synced, 'cups' | 'pending'> & { restore?: 'pending' }): Pending {
  // Nothing goes out while the account's journal is still to be loaded from the server (restore.ts):
  // a list entry made meanwhile would overwrite the server's rating with empty values, and a confirmed
  // delete would drop the marker that keeps the restore from bringing the cup back.
  if (d.restore === 'pending') return emptyPending;
  const p = d.pending;
  const r = p.rejected ?? {};
  const refusedCoffees = new Set(p.coffees.filter((id) => rowKey('coffee', id) in r));
  const cupCoffee = new Map(d.cups.map((c) => [c.id, c.coffee_id]));
  return {
    roasters: p.roasters,
    coffees: p.coffees.filter((id) => !refusedCoffees.has(id)),
    beans: p.beans.filter((id) => !(rowKey('bean', id) in r) && !refusedCoffees.has(id)),
    cups: p.cups.filter((id) => !(rowKey('cup', id) in r) && !refusedCoffees.has(cupCoffee.get(id) ?? '')),
    deletedCups: p.deletedCups,
    profile: p.profile && !(rowKey('profile') in r),
  };
}

export type CupChange = Omit<Cup, 'id' | 'brewed_at'>;

/** Replaces the values of an existing cup in place: same id, same date, same place in the journal. */
export function editCup(cups: Cup[], id: string, change: CupChange): Cup[] {
  const i = cups.findIndex((c) => c.id === id);
  if (i < 0) return cups;
  const next = [...cups];
  next[i] = { ...change, id, brewed_at: cups[i].brewed_at };
  return next;
}
