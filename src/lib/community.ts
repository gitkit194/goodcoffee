// The shared catalogue: what counts as the same bean, which beans come from the community, and how the
// phone takes over the server's bean when someone else shared it first. Plain TypeScript, no React.
import type { Coffee, Cup, MyBean, Roaster } from '../data/types';

/**
 * The key two names must share to be the same bean or roaster. Ignores case, accents, umlauts
 * (ä = ae = a), ß/ss, spaces and punctuation. Mirrors public.match_key() in the database.
 */
export function matchKey(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ø/g, 'o')
    .replace(/ł/g, 'l')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/([aou])e/g, '$1');
}

/** Added by a user and not yet reviewed. Seed beans, and beans without a source (bundled seed), are not. */
export function isCommunity(c: Pick<Coffee, 'source' | 'reviewed' | 'reviewed_at'> | null | undefined): boolean {
  return c?.source === 'user' && !c.reviewed && !c.reviewed_at;
}

/**
 * The bean with the same roaster, the same name key and a roast profile that does not contradict:
 * "House" for espresso and "House" for filter are two products. A bean with the same profile wins
 * (no profile counts as a profile of its own). A bean without a profile joins another only if that is
 * the only candidate; a bean with a profile never joins one with a different or no profile.
 * Without a roaster, none. Mirrors public.find_same_coffee() in the database.
 */
export function findSameCoffee(coffees: Coffee[], roasterId: string | null, name: string, roastFor: string | null = null): Coffee | undefined {
  if (!roasterId) return undefined;
  const key = matchKey(name);
  if (!key) return undefined;
  const byId = new Map<string, Coffee>();
  for (const c of coffees) if (c.roaster_id === roasterId && matchKey(c.name) === key && !byId.has(c.id)) byId.set(c.id, c);
  const candidates = [...byId.values()];
  const want = roastFor || null;
  const same = candidates.find((c) => (c.roast_for || null) === want);
  if (same) return same;
  return !want && candidates.length === 1 ? candidates[0] : undefined;
}

/** Server ids that replace local ones after sharing: the bean (or roaster) already existed. */
export type Remap = { coffees: Record<string, string>; roasters: Record<string, string> };

export function isEmptyRemap(r: Remap | undefined): boolean {
  return !r || (!Object.keys(r.coffees).length && !Object.keys(r.roasters).length);
}

type PendingLike = { roasters: string[]; coffees: string[]; beans: string[]; cups: string[] };

export type LocalData<P extends PendingLike> = {
  roasters: Roaster[];
  coffees: Coffee[];
  beans: Record<string, MyBean>;
  cups: Cup[];
  pending: P;
  /** Own photos by bean id; they stay on the phone and survive a bean being replaced by the shared one. */
  photos?: Record<string, string>;
  /** Further own photos of a bean, from beans merged into it that had their own photo too. */
  morePhotos?: Record<string, string[]>;
  /** Old bean id → the id that replaced it, so an open page, a recipe draft or a late save still finds the bean. */
  aliases?: Record<string, string>;
};

/** Follows replaced ids to the bean that is current now. */
export function resolveId(aliases: Record<string, string> | undefined, id: string): string {
  let cur = id;
  for (let i = 0; i < 10 && aliases?.[cur] && aliases[cur] !== cur; i++) cur = aliases[cur];
  return cur;
}

/**
 * The user's own beans as the app shows them. Once a bean is shared and nothing about it is waiting to
 * be sent, the catalogue's copy is the truth (review mark, corrections); only the own photo stays local.
 */
export function ownView(catalog: Coffee[], own: Coffee[], pendingIds: string[]): Coffee[] {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return own.map((c) => {
    const server = byId.get(c.id);
    if (!server || pendingIds.includes(c.id)) return c;
    return c.photo_uri ? { ...server, photo_uri: c.photo_uri } : server;
  });
}

const MERGED_FIELDS = ['rating', 'comment', 'roast_date'] as const;
type MergedField = (typeof MERGED_FIELDS)[number];

/** When a field of an entry was last set: its own time if the entry came from a merge and is unchanged since. */
function fieldTime(b: MyBean, f: MergedField): string {
  const t = b.field_times;
  return t && t.stamp === b.updated_at && t[f] ? t[f]! : b.updated_at;
}

/**
 * All list entries for one bean (`target`), as one. Every field is decided over all original entries
 * together: an empty value (also blank text) never replaces one that is there; when several have a value,
 * the one set most recently wins (on a tie the target's own entry, then the lowest bean id).
 * The merge itself is not a change: the result keeps the newest original time, and remembers per field
 * when its value was set, so a later merge decides by that. Mirrors public.apply_coffee_merges().
 */
export function mergeBeans(entries: MyBean[], target: string): MyBean {
  const blank = (s: string | null | undefined) => (s && s.trim() ? s : null);
  const value = (b: MyBean, f: MergedField) => (f === 'comment' ? blank(b.comment) : b[f]);
  const updated_at = entries.reduce((m, b) => (b.updated_at > m ? b.updated_at : m), entries[0].updated_at);
  const out: MyBean = {
    coffee_id: target,
    rating: null,
    comment: null,
    roast_date: null,
    added_at: entries.reduce((m, b) => (b.added_at < m ? b.added_at : m), entries[0].added_at),
    updated_at,
  };
  const times: NonNullable<MyBean['field_times']> = { stamp: updated_at };
  for (const f of MERGED_FIELDS) {
    const best = entries
      .filter((b) => value(b, f) != null)
      .sort(
        (x, y) =>
          (fieldTime(y, f) > fieldTime(x, f) ? 1 : fieldTime(y, f) < fieldTime(x, f) ? -1 : 0) ||
          Number(y.coffee_id === target) - Number(x.coffee_id === target) ||
          (x.coffee_id < y.coffee_id ? -1 : x.coffee_id > y.coffee_id ? 1 : 0),
      )[0];
    if (!best) continue;
    (out as Record<MergedField, unknown>)[f] = value(best, f);
    times[f] = fieldTime(best, f);
  }
  return { ...out, field_times: times };
}

/**
 * Moves everything that pointed to a local bean or roaster over to the shared one: the bean on the
 * user's list (rating, comment and roast date are kept), the cups and the own photo. The local copy of
 * a bean someone else shared first is dropped; its master data now comes from the catalogue.
 */
export function applyRemap<P extends PendingLike, D extends LocalData<P>>(d: D, remap: Remap | undefined, opts: { resend?: boolean } = {}): D {
  if (!remap || isEmptyRemap(remap)) return d;
  const cid = (id: string) => remap.coffees[id] ?? id;
  const rid = (id: string | null) => (id ? remap.roasters[id] ?? id : id);
  const moved = (id: string) => cid(id) !== id;

  // Own photos follow the bean. If the bean they move to has an own photo already, the moved one is
  // kept as a further photo of that bean (morePhotos), never dropped.
  const photos = { ...(d.photos ?? {}) };
  const morePhotos: Record<string, string[]> = { ...(d.morePhotos ?? {}) };
  const addMore = (id: string, uris: string[]) => {
    const list = [...(morePhotos[id] ?? [])];
    for (const u of uris) if (u && u !== photos[id] && !list.includes(u)) list.push(u);
    if (list.length) morePhotos[id] = list;
  };
  for (const c of d.coffees) {
    if (moved(c.id) && c.photo_uri && !photos[c.id]) photos[c.id] = c.photo_uri;
  }
  // The target's own photo may sit on its local copy instead of in `photos`.
  const ownPhoto = (id: string) => photos[id] ?? d.coffees.find((c) => c.id === id && !moved(c.id))?.photo_uri ?? undefined;
  for (const id of Object.keys(photos)) {
    if (!moved(id)) continue;
    const to = cid(id);
    const existing = ownPhoto(to);
    if (!existing) photos[to] = photos[id];
    else if (existing !== photos[id]) addMore(to, [photos[id]]);
    delete photos[id];
  }
  for (const id of Object.keys(morePhotos)) {
    if (!moved(id)) continue;
    const list = morePhotos[id];
    delete morePhotos[id];
    addMore(cid(id), list);
  }

  // Remember the replacement, and point older aliases at the newest id.
  const aliases: Record<string, string> = {};
  for (const [from, to] of Object.entries(d.aliases ?? {})) aliases[from] = cid(to);
  for (const [from, to] of Object.entries(remap.coffees)) if (from !== to) aliases[from] = to;

  const roasters: Roaster[] = [];
  for (const r of d.roasters) {
    const id = rid(r.id)!;
    if (!roasters.some((x) => x.id === id)) roasters.push({ ...r, id });
  }

  const coffees = d.coffees.filter((c) => !moved(c.id)).map((c) => (rid(c.roaster_id) !== c.roaster_id ? { ...c, roaster_id: rid(c.roaster_id) } : c));

  // Entries that now belong to the same bean are decided together, from the unchanged originals.
  const groups = new Map<string, MyBean[]>();
  for (const b of Object.values(d.beans)) {
    const id = cid(b.coffee_id);
    groups.set(id, [...(groups.get(id) ?? []), b]);
  }
  const beans: Record<string, MyBean> = {};
  const merged: string[] = [];
  const movedBeans: string[] = [];
  for (const [id, list] of groups) {
    if (list.length > 1) {
      beans[id] = mergeBeans(list, id);
      merged.push(id);
    } else {
      const b = list[0];
      beans[id] = moved(b.coffee_id) ? { ...b, coffee_id: id } : b;
      if (moved(b.coffee_id)) movedBeans.push(id);
    }
  }

  const cups = d.cups.map((c) => (moved(c.coffee_id) ? { ...c, coffee_id: cid(c.coffee_id) } : c));

  // What still waits to be sent now waits under the new id; a merged list entry has to be sent again.
  // With `resend` (the server merged beans the phone had already sent) every moved row is sent again.
  const uniq = (ids: string[]) => Array.from(new Set(ids));
  const p = d.pending;
  const movedCups = opts.resend ? d.cups.filter((c) => moved(c.coffee_id)).map((c) => c.id) : [];
  const pending = {
    ...p,
    roasters: uniq(p.roasters.map((id) => rid(id)!)),
    coffees: p.coffees.filter((id) => !moved(id)),
    beans: uniq([...p.beans.map(cid), ...merged, ...(opts.resend ? movedBeans : [])]),
    cups: uniq([...p.cups, ...movedCups]),
  };

  return { ...d, roasters, coffees, beans, cups, pending, photos, aliases, ...(Object.keys(morePhotos).length ? { morePhotos } : {}) };
}

/**
 * Master data to show for beans the user's data now points to but the catalogue on the phone does not
 * have yet (the merge answer came before the catalogue refresh). Without it the bean would drop out of
 * "My coffees" until the next refresh, although rating, notes and cups are all there. The stand-in is
 * the replaced bean's data under the new id; the catalogue's copy wins as soon as it arrives.
 */
export function standInsAfterRemap(
  before: { coffees: Coffee[]; standIns?: Record<string, Coffee> },
  after: { coffees: Coffee[] },
  remap: Remap,
  catalog: Coffee[],
): Record<string, Coffee> {
  const out: Record<string, Coffee> = { ...(before.standIns ?? {}) };
  const known = (id: string) => !!out[id] || catalog.some((c) => c.id === id) || after.coffees.some((c) => c.id === id);
  for (const [from, to] of Object.entries(remap.coffees)) {
    if (from === to || known(to)) continue;
    const old = before.coffees.find((c) => c.id === from) ?? catalog.find((c) => c.id === from) ?? before.standIns?.[from];
    // The own photo moves on its own (photos); the stand-in carries only master data.
    if (old) out[to] = { ...old, id: to, photo_uri: null };
  }
  return out;
}
