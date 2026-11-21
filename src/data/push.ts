// Sends the local changes, row by row where it matters: a row the server refuses is marked and kept,
// and everything that does not depend on it still goes out. No React and no Supabase import, so it
// can be tested against a fake server (see tests/sync-queue.test.ts).
import type { Remap } from '../lib/community';
import { beanProblem, coffeeProblem, cupProblem, shareableRecipe, shareableRoastFor, shareableRoastLevel } from '../lib/validate';
import { rowKey, type Pending } from './pending';
import type { Coffee, Cup, MyBean, Profile, Roaster } from './types';

export type ApiError = { code?: string; message?: string } | Error;
type Res<T = unknown> = { data?: T; error: ApiError | null };

/** The few server calls a push needs. sync.ts implements them with Supabase. */
export type Api = {
  userId(): Promise<string>;
  shareCoffee(args: { p_id: string; p_roaster_id: string | null; p_roaster_name: string | null; p_coffee: Record<string, unknown> }): Promise<Res>;
  upsert(table: 'profiles' | 'user_coffees' | 'cups', rows: Record<string, unknown>[]): Promise<Res>;
  deleteCups(ids: string[]): Promise<Res>;
};

export type Snapshot = {
  profile: Profile;
  roasters: Roaster[];
  coffees: Coffee[];
  beans: Record<string, MyBean>;
  cups: Cup[];
};

/**
 * What a push did. The id lists hold only what reached the server (so the caller clears exactly that),
 * `rejected` the rows the server refused for good, `remap` the server ids that replace local ones,
 * and `error` the first error that may go away by itself (offline, server down): those rows stay
 * pending and the caller tries again later.
 */
export type Sent = Pending & { remap: Remap; rejected: Record<string, string>; error?: unknown };

/**
 * Errors that will come back on every retry until the row changes: the database refused the value
 * (class 22 data, 23 constraint, P0 raise exception, 42 permission). Anything else (no network, 5xx,
 * timeouts, auth) may pass by itself.
 */
export function isPermanent(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^(22|23|P0|42)/.test(code);
}

function reason(e: unknown): string {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m ? m : 'The server did not accept this entry.';
}

function coffeePayload(c: Coffee, withLinks: boolean): Record<string, unknown> {
  return {
    name: c.name,
    origin_country: c.origin_country ?? null,
    region: c.region ?? null,
    producer: c.producer ?? null,
    variety: c.variety ?? null,
    roast_for: shareableRoastFor(c.roast_for),
    process: c.process ?? null,
    roast_level: shareableRoastLevel(c.roast_level),
    roast_level_estimated: !shareableRoastLevel(c.roast_level) || !!c.roast_level_estimated,
    ...shareableRecipe(c),
    roaster_notes: c.roaster_notes,
    // Master data only. The own photo (photo_uri) and the roast date never leave the phone.
    photo_path: withLinks && c.photo_path?.startsWith('https://') ? c.photo_path : null,
    product_url: withLinks ? c.product_url ?? null : null,
  };
}

/**
 * Sends `pending`. New beans go to the shared catalogue; if the same bean is there already, the server
 * answers with that one and list entries and cups are sent for it instead (`remap`).
 * Each bean, list entry and cup is accepted or refused on its own; one bad row never stops the others.
 */
export async function push(api: Api, s: Snapshot, pending: Pending): Promise<Sent> {
  const uid = await api.userId();
  const remap: Remap = { coffees: {}, roasters: {} };
  const rejected: Record<string, string> = {};
  let error: unknown;
  const out: Pending = { roasters: pending.roasters, coffees: [], beans: [], cups: [], deletedCups: [], profile: false };
  const transient = (e: unknown) => {
    if (error === undefined) error = e;
  };
  // New beans that did not reach the server: their list entries and cups wait for them.
  const waiting = new Set<string>();

  for (const c of s.coffees.filter((x) => pending.coffees.includes(x.id))) {
    const problem = coffeeProblem(c);
    if (problem) {
      rejected[rowKey('coffee', c.id)] = problem;
      waiting.add(c.id);
      continue;
    }
    const roasterId = c.roaster_id ? remap.roasters[c.roaster_id] ?? c.roaster_id : null;
    const localRoaster = s.roasters.find((r) => r.id === c.roaster_id);
    const call = (withLinks: boolean) =>
      api.shareCoffee({ p_id: c.id, p_roaster_id: roasterId, p_roaster_name: localRoaster?.name ?? null, p_coffee: coffeePayload(c, withLinks) });
    let res = await call(true);
    // A shop link or image the server does not trust must not keep the bean itself out of the catalogue.
    if (res.error && isPermanent(res.error) && (c.product_url || c.photo_path)) res = await call(false);
    if (res.error) {
      if (isPermanent(res.error)) rejected[rowKey('coffee', c.id)] = reason(res.error);
      else transient(res.error);
      waiting.add(c.id);
      continue;
    }
    const row = (Array.isArray(res.data) ? res.data[0] : res.data) as { coffee_id: string; roaster_id: string | null } | undefined;
    if (!row) {
      transient(new Error('share_coffee returned nothing'));
      waiting.add(c.id);
      continue;
    }
    out.coffees.push(c.id);
    if (row.coffee_id !== c.id) remap.coffees[c.id] = row.coffee_id;
    if (c.roaster_id && row.roaster_id && row.roaster_id !== c.roaster_id) remap.roasters[c.roaster_id] = row.roaster_id;
  }
  const cid = (id: string) => remap.coffees[id] ?? id;

  if (pending.profile) {
    const res = await api.upsert('profiles', [
      { id: uid, display_name: s.profile.name || null, grinder: s.profile.grinder || null, updated_at: new Date().toISOString() },
    ]);
    if (!res.error) out.profile = true;
    else if (isPermanent(res.error)) rejected[rowKey('profile')] = reason(res.error);
    else transient(res.error);
  }

  /**
   * Sends rows in one request; if the server refuses that request, row by row, so only the bad rows
   * are marked. A transient error leaves all of them pending.
   */
  const sendRows = async (table: 'user_coffees' | 'cups', items: { id: string; key: string; row: Record<string, unknown> }[], done: string[]) => {
    if (!items.length) return;
    const all = await api.upsert(table, items.map((x) => x.row));
    if (!all.error) {
      done.push(...items.map((x) => x.id));
      return;
    }
    if (!isPermanent(all.error)) return transient(all.error);
    for (const x of items) {
      const one = await api.upsert(table, [x.row]);
      if (!one.error) done.push(x.id);
      else if (isPermanent(one.error)) rejected[x.key] = reason(one.error);
      else transient(one.error);
    }
  };

  // Two local beans can now be the same shared bean; send it once (and clear both).
  const beanIds = pending.beans.filter((id) => s.beans[id] && !waiting.has(s.beans[id].coffee_id));
  const byTarget = new Map<string, { ids: string[]; bean: MyBean }>();
  for (const id of beanIds) {
    const b = s.beans[id];
    const problem = beanProblem(b);
    if (problem) {
      rejected[rowKey('bean', id)] = problem;
      continue;
    }
    const t = cid(b.coffee_id);
    byTarget.set(t, { ids: [...(byTarget.get(t)?.ids ?? []), id], bean: b });
  }
  const beansDone: string[] = [];
  await sendRows(
    'user_coffees',
    [...byTarget.entries()].map(([target, { ids, bean }]) => ({
      id: ids.join('\n'),
      key: rowKey('bean', ids[ids.length - 1]),
      row: { user_id: uid, coffee_id: target, roast_date: bean.roast_date, rating: bean.rating, comment: bean.comment, updated_at: bean.updated_at },
    })),
    beansDone,
  );
  out.beans = beansDone.flatMap((x) => x.split('\n'));
  // Ids of beans that are not on the phone any more were nothing to send: clear them.
  out.beans.push(...pending.beans.filter((id) => !s.beans[id]));

  const cupItems: { id: string; key: string; row: Record<string, unknown> }[] = [];
  for (const c of s.cups.filter((x) => pending.cups.includes(x.id))) {
    if (waiting.has(c.coffee_id)) continue;
    const problem = cupProblem(c);
    if (problem) {
      rejected[rowKey('cup', c.id)] = problem;
      continue;
    }
    cupItems.push({
      id: c.id,
      key: rowKey('cup', c.id),
      row: {
        id: c.id,
        user_id: uid,
        coffee_id: cid(c.coffee_id),
        brewed_at: c.brewed_at,
        grind: c.grind,
        dose_g: c.dose_g,
        yield_g: c.yield_g,
        time_s: c.time_s,
        extraction: c.extraction,
        sweetness: c.sweetness,
        acidity: c.acidity,
        body: c.body,
        aromas: c.aromas,
        updated_at: new Date().toISOString(),
      },
    });
  }
  await sendRows('cups', cupItems, out.cups);
  // Cups deleted meanwhile were nothing to send.
  out.cups.push(...pending.cups.filter((id) => !s.cups.some((c) => c.id === id)));

  if (pending.deletedCups.length) {
    const res = await api.deleteCups(pending.deletedCups);
    if (!res.error) out.deletedCups = [...pending.deletedCups];
    else transient(res.error);
  }

  return { ...out, remap, rejected, ...(error !== undefined ? { error } : {}) };
}
