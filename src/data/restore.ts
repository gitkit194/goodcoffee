// Brings the journal back from Supabase when the phone has none: after the app was deleted and
// installed again, the keychain still holds the anonymous session (see secureStorage.ts), so the same
// user is signed in again and can read their own beans, cups and profile.
//
// Rules:
// * Only for a journal that started empty on this phone (`restore: 'pending'`, set by the store).
//   A journal that was on the phone is never touched.
// * Never signs in. Without a stored session there is no account to restore from; signing in would
//   only create a new, empty one.
// * Nothing is sent while the restore is pending (see sendable in pending.ts). So nothing made on the
//   phone meanwhile can overwrite the server's rows, and a delete stays in `pending.deletedCups` until
//   the restore is done.
// * Only adds what the user did not change here: cups deleted on the phone stay deleted, cups logged
//   here stay. On a list entry, only the fields the user really edited meanwhile (`restoreTouched`)
//   win; an entry the app made by itself (first cup of a bean) takes the server's rating, comment and
//   roast date. Profile fields left empty here are filled in.
// * Restored rows are not queued for sync: they are on the server already.
// * A failure (offline, keychain locked) keeps `restore: 'pending'`; the store tries again later.
//
// No React and no Supabase import, so it can be tested with a fake server (tests/restore.test.ts).
import { resolveId } from '../lib/community';
import type { Journal } from './journal';
import type { Coffee, Cup, MyBean, Profile } from './types';

type Row = Record<string, unknown>;

export type BeanField = 'rating' | 'comment' | 'roast_date';

/** Kept in the journal while a restore is pending. */
export type RestoreState = {
  /** The account's journal still has to be loaded from the server. */
  restore?: 'pending';
  /** List-entry fields the user edited while the restore was pending, by bean id. */
  restoreTouched?: Record<string, BeanField[]>;
};

/** Notes that the user edited these fields of a list entry; only while a restore is pending. */
export function touchBean<D extends RestoreState>(d: D, coffeeId: string, fields: BeanField[]): D {
  if (d.restore !== 'pending' || !fields.length) return d;
  const before = d.restoreTouched?.[coffeeId] ?? [];
  return { ...d, restoreTouched: { ...(d.restoreTouched ?? {}), [coffeeId]: Array.from(new Set([...before, ...fields])) } };
}

/** Ends a pending restore without data (no stored account). */
export function endRestore<D extends RestoreState>(d: D): D {
  const next = { ...d };
  delete next.restore;
  delete next.restoreTouched;
  return next;
}
type Res = { data: Row[] | null; error: unknown };

/** The few server calls a restore needs. restoreApi.ts implements them with Supabase. */
export type RestoreApi = {
  /** The stored session's user id, null if there really is none. Throws if it can't be known now. */
  storedUserId(): Promise<string | null>;
  /** One page (`from`..`to`, inclusive) of the user's rows of a table, in a stable order. */
  page(table: 'cups' | 'user_coffees', uid: string, from: number, to: number): Promise<Res>;
  profile(uid: string): Promise<Res>;
  /** Beans by id; RLS returns shared ones and the user's own. */
  coffees(ids: string[]): Promise<Res>;
};

export type Restored = {
  profile: Partial<Profile> | null;
  beans: Record<string, MyBean>;
  cups: Cup[];
  /** Master data of beans the user has, so they show before the catalogue on the phone has them. */
  coffees: Coffee[];
};

/** Rows per request; PostgREST answers at most 1000 by default. */
export const PAGE = 1000;
/** Ids per `in (...)` filter, so the URL stays short. */
const ID_BATCH = 100;

async function all(api: RestoreApi, table: 'cups' | 'user_coffees', uid: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await api.page(table, uid, from, from + PAGE - 1);
    if (error) throw error;
    const got = data ?? [];
    rows.push(...got);
    if (got.length < PAGE) return rows;
  }
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function cupFromRow(r: Row): Cup {
  return {
    id: String(r.id),
    coffee_id: String(r.coffee_id),
    brewed_at: String(r.brewed_at),
    grind: num(r.grind),
    dose_g: num(r.dose_g),
    yield_g: num(r.yield_g),
    time_s: num(r.time_s),
    extraction: num(r.extraction),
    sweetness: numOrNull(r.sweetness),
    acidity: numOrNull(r.acidity),
    body: numOrNull(r.body),
    aromas: Array.isArray(r.aromas) ? r.aromas.map(String) : [],
  };
}

export function beanFromRow(r: Row): MyBean {
  const updated = strOrNull(r.updated_at) ?? new Date().toISOString();
  return {
    coffee_id: String(r.coffee_id),
    roast_date: strOrNull(r.roast_date),
    rating: numOrNull(r.rating),
    comment: strOrNull(r.comment),
    added_at: strOrNull(r.created_at) ?? updated,
    updated_at: updated,
  };
}

/**
 * Reads everything the stored account has on the server. `null`: there is no stored session, so
 * nothing to restore. Throws if the session or the server can't be reached now (try again later).
 */
export async function fetchRestore(api: RestoreApi): Promise<Restored | null> {
  const uid = await api.storedUserId();
  if (!uid) return null;
  const [cupRows, beanRows, prof] = await Promise.all([all(api, 'cups', uid), all(api, 'user_coffees', uid), api.profile(uid)]);
  if (prof.error) throw prof.error;
  const cups = cupRows.map(cupFromRow).sort((a, b) => b.brewed_at.localeCompare(a.brewed_at));
  const beans: Record<string, MyBean> = {};
  for (const r of beanRows) {
    const b = beanFromRow(r);
    beans[b.coffee_id] = b;
  }
  const ids = Array.from(new Set([...Object.keys(beans), ...cups.map((c) => c.coffee_id)]));
  const coffees: Coffee[] = [];
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const { data, error } = await api.coffees(ids.slice(i, i + ID_BATCH));
    // Master data only helps the display; the catalogue refresh brings it too. Don't fail for it.
    if (!error && data) coffees.push(...(data as Coffee[]));
  }
  const p = prof.data?.[0];
  const profile: Partial<Profile> | null = p
    ? {
        ...(typeof p.display_name === 'string' && p.display_name ? { name: p.display_name } : {}),
        ...(typeof p.grinder === 'string' && p.grinder ? { grinder: p.grinder } : {}),
        ...(typeof p.created_at === 'string' ? { since: p.created_at } : {}),
      }
    : null;
  return { profile, beans, cups, coffees };
}

/** The server's list entry, with only the fields the user edited here taken from the phone. */
function mergeBean(cloud: MyBean, local: MyBean, touched: BeanField[]): MyBean {
  const out: MyBean = {
    ...cloud,
    added_at: local.added_at < cloud.added_at ? local.added_at : cloud.added_at,
    updated_at: touched.length ? local.updated_at : cloud.updated_at,
  };
  if (touched.includes('rating')) out.rating = local.rating;
  if (touched.includes('comment')) out.comment = local.comment;
  if (touched.includes('roast_date')) out.roast_date = local.roast_date;
  return out;
}

/**
 * `restoreTouched` by the bean ids the journal uses now. A bean edited here may have been merged into
 * another one since (catalogue refresh → applyRemap, also in chains); its marks belong to that one.
 */
function touchedByCurrentId(d: Journal): Record<string, BeanField[]> {
  const out: Record<string, BeanField[]> = {};
  for (const [id, fields] of Object.entries(d.restoreTouched ?? {})) {
    const to = resolveId(d.aliases, id);
    out[to] = Array.from(new Set([...(out[to] ?? []), ...fields]));
  }
  return out;
}

/**
 * Adds restored rows to the journal as it is now and ends the restore. Never resurrects a cup deleted
 * here or drops one logged here; list entries and profile: see the rules at the top.
 */
export function mergeRestored<D extends Journal>(d: D, r: Restored): D {
  const have = new Set(d.cups.map((c) => c.id));
  const deleted = new Set(d.pending.deletedCups);
  const added = r.cups.filter((c) => !have.has(c.id) && !deleted.has(c.id));
  const cups = added.length ? [...d.cups, ...added].sort((a, b) => b.brewed_at.localeCompare(a.brewed_at)) : d.cups;
  const touched = touchedByCurrentId(d);
  const beans: Record<string, MyBean> = { ...r.beans, ...d.beans };
  for (const [id, cloud] of Object.entries(r.beans)) {
    if (d.beans[id]) beans[id] = mergeBean(cloud, d.beans[id], touched[id] ?? []);
  }
  // A bean that only has cups still belongs on the list (as it does when a cup is logged on the phone).
  for (const c of added) {
    if (!beans[c.coffee_id]) beans[c.coffee_id] = { coffee_id: c.coffee_id, roast_date: null, rating: null, comment: null, added_at: c.brewed_at, updated_at: c.brewed_at };
  }
  // Fields still empty here were never set on this phone (the journal started empty).
  const rp = r.profile ?? {};
  const profile = {
    ...d.profile,
    name: d.profile.name || rp.name || '',
    grinder: d.profile.grinder || rp.grinder || '',
    since: rp.since && rp.since < d.profile.since ? rp.since : d.profile.since,
  };
  const known = new Set(d.coffees.map((c) => c.id));
  const standIns = { ...(d.standIns ?? {}) };
  for (const c of r.coffees) if (!known.has(c.id) && !standIns[c.id]) standIns[c.id] = c;
  return endRestore({ ...d, profile, beans, cups, standIns });
}
