// App data: the user's beans, cups and profile, kept on the phone and pushed to Supabase in the background.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { bundledCatalog, fetchCatalog, fetchMerged, loadCachedCatalog, type Catalog } from './catalog';
import { editCup, mark, uniq, type CupChange } from './pending';
import { applySent } from './journal';
import { createWriter, loadStored, type Loaded } from './persist';
import { photoFiles } from './photoFiles';
import { endRestore, mergeRestored, touchBean, type BeanField } from './restore';
import { emptyPending, fetchFromCloud, hasPending, LocalOnlyError, pushPending, sendable, type Pending } from './sync';
import type { Coffee, Cup, MyBean, Profile, Recipe, Roaster, SyncStatus } from './types';
import { estimateRoastLevel, shareableRecipe } from '../lib/validate';

import { applyRemap, findSameCoffee, isEmptyRemap, matchKey, ownView, resolveId, standInsAfterRemap, type Remap } from '../lib/community';
import { backupStatus, REFUSED_REASON } from '../lib/backup';
import { logError } from '../lib/log';
import { copyOldPhotos, replacePhotoUris } from '../lib/photos';
import { roasterKey } from '../lib/match';

const KEY = 'goodcoffee:data:v1';

/** Waits before the next try after a failed sync: 5 s, 15 s, 1 min, 5 min, then every 15 min. */
const RETRY_MS = [5_000, 15_000, 60_000, 300_000, 900_000];

/** Why the journal could not be opened: storage did not answer, or holds something unreadable. */
export type LoadProblem = { kind: 'read' | 'corrupt' };

type Data = {
  profile: Profile;
  /** Roasters and beans the user created; catalogue entries live in `catalog`. */
  roasters: Roaster[];
  coffees: Coffee[];
  beans: Record<string, MyBean>;
  /** Newest first */
  cups: Cup[];
  pending: Pending;
  /** Own bag photos by bean id, for beans whose master data comes from the shared catalogue. Never uploaded. */
  photos?: Record<string, string>;
  /** Bean ids that were replaced by the shared bean (old → new). */
  aliases?: Record<string, string>;
  /** Further own photos per bean, from beans merged into it (see applyRemap). Never uploaded. */
  morePhotos?: Record<string, string[]>;
  /** Master data for replacement beans the catalogue on the phone does not have yet (see standInsAfterRemap). */
  standIns?: Record<string, Coffee>;
  /**
   * Set when the phone had no journal at start (first start, or the app was installed again): the
   * stored account's beans and cups are still to be loaded from the server. See restore.ts.
   */
  restore?: 'pending';
  /** List-entry fields edited while the restore was pending (see restore.ts). */
  restoreTouched?: Record<string, BeanField[]>;
};

export type Draft = {
  coffeeId: string;
  grind: number;
  dose_g: number;
  yield_g: number;
  time_s: number;
  extraction: number;
  /** Set when an existing cup is being edited; saving then changes that cup instead of adding one. */
  cupId?: string;
  /**
   * The new cup this draft already added to the journal (its write failed or is still running).
   * Saving again, on any step, changes that cup instead of adding a second one.
   */
  newCupId?: string;
  /** A bean's first cup: started from the roaster's recipe, or from the standard by roast level. */
  start?: 'roaster' | 'standard';
};

export type NewCoffee = {
  name: string;
  roasterName?: string;
  origin?: string;
  region?: string | null;
  producer?: string | null;
  variety?: string | null;
  roastFor?: string | null;
  process?: string;
  roastLevel?: string;
  /** The roaster's espresso recipe from the bag or shop page. */
  recipe?: Recipe | null;
  notes?: string[];
  photoUri?: string | null;
  photoPath?: string | null;
  productUrl?: string | null;
  roastDate?: string | null;
};

export type BeanRow = { coffee: Coffee; bean: MyBean; cups: number; lastCup: Cup | null };

function initialData(): Data {
  return {
    profile: { name: '', grinder: '', since: new Date().toISOString() },
    roasters: [],
    coffees: [],
    beans: {},
    cups: [],
    pending: emptyPending,
  };
}

function newBean(coffeeId: string, roastDate: string | null = null): MyBean {
  const now = new Date().toISOString();
  return { coffee_id: coffeeId, roast_date: roastDate, rating: null, comment: null, added_at: now, updated_at: now };
}

function useStoreValue() {
  const [data, setData] = useState<Data | null>(null);
  const [loadProblem, setLoadProblem] = useState<LoadProblem | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>(bundledCatalog);
  const [sync, setSync] = useState<SyncStatus>({ state: 'idle' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  // The journal as last committed. Every change starts from here, so changes made in a row build on each
  // other even before React re-renders.
  const dataRef = useRef<Data | null>(null);
  const catalogRef = useRef(catalog);
  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);
  const syncing = useRef(false);
  const restoring = useRef(false);
  const failures = useRef(0);
  const retryAt = useRef(0);
  const writer = useMemo(() => createWriter<Data>(AsyncStorage, KEY), []);

  /** Writes the journal; the promise settles when this version is on disk (or failed to get there). */
  const persist = useCallback(
    (next: Data) => {
      const written = writer.write(next);
      written.then(
        () => setSaveFailed(false),
        (e) => {
          logError('Saving the journal failed', e);
          setSaveFailed(true);
        },
      );
      return written;
    },
    [writer],
  );

  /**
   * Changes the journal and writes it to the phone. Resolves once the change is on disk; rejects if it
   * could not be written (the change stays in memory, is shown as unsaved and written with the next try).
   */
  const commit = useCallback(
    (fn: (d: Data) => Data): Promise<void> => {
      const cur = dataRef.current;
      if (!cur) {
        const notOpen = Promise.reject(new Error('The journal is not open.'));
        notOpen.catch(() => undefined);
        return notOpen;
      }
      const next = fn(cur);
      if (next === cur) return Promise.resolve();
      dataRef.current = next;
      setData(next);
      return persist(next);
    },
    [persist],
  );

  /** Tries again to write what is in memory, after a failed write. */
  const retrySave = useCallback((): Promise<void> => (dataRef.current ? persist(dataRef.current) : Promise.resolve()), [persist]);

  /** Moves the user's data, and a recipe that is being entered, from replaced bean ids to the current ones. */
  const remapAll = useCallback(
    (remap: Remap, opts?: { resend?: boolean }) => {
      if (isEmptyRemap(remap)) return;
      commit((d) => {
        const next = applyRemap(d, remap, opts);
        return { ...next, standIns: standInsAfterRemap(d, next, remap, catalogRef.current.coffees) };
      }).catch(() => undefined);
      setDraft((dr) => (dr && remap.coffees[dr.coffeeId] ? { ...dr, coffeeId: remap.coffees[dr.coffeeId] } : dr));
    },
    [commit],
  );

  // Beans other users shared show up after the next refresh: at start, when the app comes back, after a sync.
  // Beans the server merged into another one since (duplicates) are moved over on the phone too.
  const refreshCatalog = useCallback(() => {
    fetchCatalog()
      .then((c) => c.coffees.length && setCatalog(c))
      .catch(() => undefined);
    const d = dataRef.current;
    if (!d) return;
    const ids = Array.from(new Set([...Object.keys(d.beans), ...d.coffees.map((c) => c.id), ...d.cups.map((c) => c.coffee_id)]));
    fetchMerged(ids)
      .then((merged) => remapAll({ coffees: merged, roasters: {} }, { resend: true }))
      .catch(() => undefined);
  }, [remapAll]);

  /**
   * Loads the stored account's journal from the server into a journal that started empty on this
   * phone (app installed again: the keychain kept the session). Stays pending if it fails; the next
   * start, return to the app or reconnect tries again.
   */
  const runRestore = useCallback(async () => {
    if (restoring.current || dataRef.current?.restore !== 'pending') return;
    restoring.current = true;
    try {
      const found = await fetchFromCloud();
      await commit((d) => {
        if (d.restore !== 'pending') return d;
        if (found) return mergeRestored(d, found);
        return endRestore(d);
      });
      if (found && (found.cups.length || Object.keys(found.beans).length)) refreshCatalog();
    } catch (e) {
      logError('Restoring the journal failed', e);
    } finally {
      restoring.current = false;
    }
  }, [commit, refreshCatalog]);

  /**
   * Opens the journal. If the phone's storage cannot be read, the app shows that and does not start:
   * starting with an empty journal would write it over the stored one at the first change.
   */
  const applyLoaded = useCallback(
    async (res: Loaded<Data>) => {
      if (res.state === 'error') {
        logError('Reading the journal failed', res.error);
        setLoadProblem({ kind: res.kind });
        return;
      }
      // Nothing on the phone: the same account may have a journal on the server (app installed again).
      const loaded: Data = res.state === 'loaded' ? { ...initialData(), ...res.data } : { ...initialData(), restore: 'pending' };
      dataRef.current = loaded;
      setData(loaded);
      setLoadProblem(null);
      const cached = await loadCachedCatalog();
      if (cached?.coffees.length) setCatalog(cached);
      refreshCatalog();
      void runRestore();
      // Photos saved before they were copied into the app's folder: copy them now, while the file is there.
      // The app is already running meanwhile (merges, edits), so only the photo references are swapped,
      // on the journal as it is then, never the start snapshot.
      const moved = await copyOldPhotos(loaded, photoFiles, () => Crypto.randomUUID()).catch(() => new Map<string, string>());
      if (moved.size) commit((d) => replacePhotoUris(d, moved)).catch(() => undefined);
    },
    [refreshCatalog, commit, runRestore],
  );
  const openJournal = useCallback(() => loadStored<Data>(AsyncStorage, KEY).then(applyLoaded), [applyLoaded]);

  /**
   * Only for a journal that cannot be read at all: keeps the stored text under a backup key and starts
   * an empty journal. Nothing is overwritten unless the backup was written.
   */
  const startNewJournal = useCallback(async () => {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) await AsyncStorage.setItem(`${KEY}:backup:${new Date().toISOString()}`, raw);
    const fresh = initialData();
    dataRef.current = fresh;
    setData(fresh);
    setLoadProblem(null);
    await persist(fresh);
  }, [persist]);

  useEffect(() => {
    loadStored<Data>(AsyncStorage, KEY).then(applyLoaded);
  }, [applyLoaded]);

  const runSync = useCallback(async () => {
    const snapshot = dataRef.current;
    if (!snapshot || syncing.current) return;
    // Rows the server refused stay on the phone, but are only sent again once they change.
    const toSend = sendable(snapshot);
    if (!hasPending(toSend)) return;
    syncing.current = true;
    setSync({ state: 'syncing' });
    try {
      const sent = await pushPending(snapshot, toSend);
      // Acknowledge and move to server ids in ONE change, so one write puts both on disk: a crash or a
      // failed write in between could otherwise leave cleared queue entries pointing to a local id.
      await commit((d) => applySent(d, snapshot, sent, catalogRef.current.coffees)).catch(() => undefined);
      const moved = sent.remap.coffees;
      setDraft((dr) => (dr && moved[dr.coffeeId] ? { ...dr, coffeeId: moved[dr.coffeeId] } : dr));
      // New beans are in the shared catalogue now (or turned out to be there already): show the server's view.
      if (sent.coffees.length || !isEmptyRemap(sent.remap)) refreshCatalog();
      if (sent.error !== undefined) throw sent.error;
      failures.current = 0;
      retryAt.current = 0;
      const refused = Object.keys(dataRef.current?.pending.rejected ?? {}).length;
      setSync(
        refused
          ? { state: 'local', reason: REFUSED_REASON }
          : { state: 'synced', at: new Date().toISOString() },
      );
    } catch (e) {
      if (!(e instanceof LocalOnlyError)) logError('Sync failed', e);
      const reason = e instanceof LocalOnlyError ? e.message : "Sync failed. Please try again later.";
      setSync({ state: 'local', reason });
      // Try again by itself, a bit later each time, also if nothing changes on the phone meanwhile.
      retryAt.current = Date.now() + RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)];
      failures.current += 1;
      setRetryTick((n) => n + 1);
    } finally {
      syncing.current = false;
    }
  }, [commit, refreshCatalog]);

  useEffect(() => {
    if (!data || !hasPending(sendable(data))) return;
    const t = setTimeout(runSync, Math.max(1200, retryAt.current - Date.now()));
    return () => clearTimeout(t);
  }, [data, runSync, retryTick]);

  /** Sync now, without waiting for the next retry (button, app back in front). */
  const syncNow = useCallback(() => {
    retryAt.current = 0;
    return runSync();
  }, [runSync]);

  // Back online: try at once instead of waiting for the next retry.
  useEffect(() => {
    let offline = false;
    return NetInfo.addEventListener((s) => {
      const online = s.isConnected !== false && s.isInternetReachable !== false;
      if (online && offline) {
        syncNow();
        void runRestore();
      }
      offline = !online;
    });
  }, [syncNow, runRestore]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      syncNow();
      refreshCatalog();
      void runRestore();
    });
    return () => sub.remove();
  }, [syncNow, refreshCatalog, runRestore]);

  const update = commit;

  const actions = useMemo(
    () => ({
      addBean(id: string) {
        update((d) => {
          const coffeeId = resolveId(d.aliases, id);
          return d.beans[coffeeId] ? d : { ...d, beans: { ...d.beans, [coffeeId]: newBean(coffeeId) }, pending: mark(d.pending, { beans: [coffeeId] }) };
        });
      },

      /**
       * Adds a bean. If the catalogue already has it (same roaster, same name up to case, umlauts and
       * spaces), that bean goes on the list instead and its id is returned: no duplicate.
       */
      createCoffee(input: NewCoffee): string {
        const d0 = dataRef.current;
        const rn = input.roasterName?.trim();
        const allRoasters = [...catalog.roasters, ...(d0?.roasters ?? [])];
        const knownRoaster = rn
          ? allRoasters.find((r) => matchKey(r.name) === matchKey(rn)) ?? allRoasters.find((r) => roasterKey(r.name) === roasterKey(rn))
          : undefined;
        // Espresso and filter versions of a name are two beans; see findSameCoffee.
        const existing = knownRoaster ? findSameCoffee([...(d0?.coffees ?? []), ...catalog.coffees], knownRoaster.id, input.name, input.roastFor ?? null) : undefined;
        if (existing) {
          const eid = existing.id;
          update((d) => {
            const bean = d.beans[eid] ?? newBean(eid);
            const withDate = input.roastDate ? { ...bean, roast_date: input.roastDate, updated_at: new Date().toISOString() } : bean;
            return {
              ...touchBean(d, eid, input.roastDate ? ['roast_date'] : []),
              beans: { ...d.beans, [eid]: withDate },
              photos: input.photoUri ? { ...(d.photos ?? {}), [eid]: input.photoUri } : d.photos,
              pending: withDate !== d.beans[eid] ? mark(d.pending, { beans: [eid] }) : d.pending,
            };
          });
          return eid;
        }
        const id = Crypto.randomUUID();
        update((d) => {
          let roasterId: string | null = null;
          const roasters = [...d.roasters];
          const newRoasters: string[] = [];
          if (rn) {
            if (knownRoaster) roasterId = knownRoaster.id;
            else {
              roasterId = Crypto.randomUUID();
              roasters.push({ id: roasterId, name: rn });
              newRoasters.push(roasterId);
            }
          }
          const coffee: Coffee = {
            id,
            roaster_id: roasterId,
            name: input.name.trim(),
            origin_country: input.origin?.trim() || null,
            region: input.region?.trim() || null,
            producer: input.producer?.trim() || null,
            variety: input.variety?.trim() || null,
            roast_for: input.roastFor ?? null,
            process: input.process ?? null,
            // Never empty: what the bag, the shop or the user says, else estimated from the roast profile.
            roast_level: input.roastLevel ?? estimateRoastLevel(input.roastFor),
            roast_level_estimated: !input.roastLevel,
            ...shareableRecipe(input.recipe ?? {}),
            roaster_notes: input.notes ?? [],
            photo_uri: input.photoUri ?? null,
            photo_path: input.photoPath ?? null,
            product_url: input.productUrl ?? null,
            source: 'user',
            reviewed: false,
          };
          return {
            ...d,
            roasters,
            coffees: [...d.coffees, coffee],
            beans: { ...d.beans, [id]: newBean(id, input.roastDate ?? null) },
            pending: mark(d.pending, { roasters: newRoasters, coffees: [id], beans: [id] }),
          };
        });
        return id;
      },

      /** Changes one of the user's own coffees, e.g. when the online lookup finishes after saving. */
      updateCoffee(id: string, change: (c: Coffee) => Partial<Coffee>) {
        update((d) => {
          const coffeeId = resolveId(d.aliases, id);
          const i = d.coffees.findIndex((c) => c.id === coffeeId);
          if (i < 0) return d;
          const coffees = [...d.coffees];
          // Start from what the app shows: the server's copy once the bean is shared and unchanged here.
          const base = ownView(catalog.coffees, [coffees[i]], d.pending.coffees)[0];
          coffees[i] = { ...base, ...change(base) };
          return { ...d, coffees, pending: mark(d.pending, { coffees: [coffeeId] }) };
        });
      },

      updateBean(id: string, patch: Partial<Pick<MyBean, 'rating' | 'comment' | 'roast_date'>>): Promise<void> {
        return update((d) => {
          const coffeeId = resolveId(d.aliases, id);
          const bean = { ...(d.beans[coffeeId] ?? newBean(coffeeId)), ...patch, updated_at: new Date().toISOString() };
          const touched = touchBean(d, coffeeId, Object.keys(patch) as BeanField[]);
          return { ...touched, beans: { ...d.beans, [coffeeId]: bean }, pending: mark(d.pending, { beans: [coffeeId] }) };
        });
      },

      /** Changes a saved cup in place (same id and date) and queues it for the next sync. */
      updateCup(id: string, input: CupChange): Promise<void> {
        return update((d) => {
          if (!d.cups.some((c) => c.id === id)) return d;
          const cup = { ...input, coffee_id: resolveId(d.aliases, input.coffee_id) };
          const known = !!d.beans[cup.coffee_id];
          return {
            ...d,
            cups: editCup(d.cups, id, cup),
            beans: known ? d.beans : { ...d.beans, [cup.coffee_id]: newBean(cup.coffee_id) },
            pending: mark(d.pending, { cups: [id], beans: known ? [] : [cup.coffee_id] }),
          };
        });
      },

      /**
       * Adds a cup. `saved` resolves once the cup is stored on the phone; only then may the app say
       * "saved". If it rejects, the cup is still in the journal in memory and goes to disk with the next try.
       */
      saveCup(input: CupChange): { id: string; saved: Promise<void> } {
        const id = Crypto.randomUUID();
        const saved = update((d) => {
          // The recipe may have been started before the bean was replaced by the shared one.
          const cup = { ...input, coffee_id: resolveId(d.aliases, input.coffee_id) };
          const full: Cup = { ...cup, id, brewed_at: new Date().toISOString() };
          return {
            ...d,
            cups: [full, ...d.cups],
            beans: d.beans[cup.coffee_id] ? d.beans : { ...d.beans, [cup.coffee_id]: newBean(cup.coffee_id) },
            pending: mark(d.pending, { cups: [id], beans: d.beans[cup.coffee_id] ? [] : [cup.coffee_id] }),
          };
        });
        return { id, saved };
      },

      deleteCup(id: string) {
        update((d) => ({
          ...d,
          cups: d.cups.filter((c) => c.id !== id),
          pending: d.pending.cups.includes(id)
            ? { ...d.pending, cups: d.pending.cups.filter((x) => x !== id), deletedCups: uniq([...d.pending.deletedCups, id]) }
            : mark(d.pending, { deletedCups: [id] }),
        }));
      },

      updateProfile(patch: Partial<Profile>) {
        update((d) => ({ ...d, profile: { ...d.profile, ...patch }, pending: mark(d.pending, { profile: true }) }));
      },

      setDraft,
      syncNow,
      retrySave,
      openJournal,
      startNewJournal,
    }),
    [update, catalog, syncNow, retrySave, openJournal, startNewJournal],
  );

  const selectors = useMemo(() => {
    const d = data ?? initialData();
    const roasterById = new Map<string, Roaster>();
    [...catalog.roasters, ...d.roasters].forEach((r) => roasterById.set(r.id, r));
    // Own beans that are shared and unchanged here show the catalogue's copy (review mark, corrections);
    // unsent ones show the local copy. Own photos are laid over either.
    const coffeeById = new Map<string, Coffee>();
    // Stand-ins first: the catalogue's copy replaces them as soon as it is there.
    [...Object.values(d.standIns ?? {}), ...catalog.coffees, ...ownView(catalog.coffees, d.coffees, d.pending.coffees)].forEach((c) =>
      coffeeById.set(c.id, d.photos?.[c.id] ? { ...c, photo_uri: d.photos[c.id] } : c),
    );
    const cupsByCoffee = new Map<string, Cup[]>();
    d.cups.forEach((c) => cupsByCoffee.set(c.coffee_id, [...(cupsByCoffee.get(c.coffee_id) ?? []), c]));

    const myBeans: BeanRow[] = Object.values(d.beans)
      .map((bean) => {
        const coffee = coffeeById.get(bean.coffee_id);
        const cups = cupsByCoffee.get(bean.coffee_id) ?? [];
        const row: BeanRow | null = coffee ? { coffee, bean, cups: cups.length, lastCup: cups[0] ?? null } : null;
        return row;
      })
      .filter((x): x is BeanRow => !!x)
      .sort((a, b) => (b.lastCup?.brewed_at ?? b.bean.added_at).localeCompare(a.lastCup?.brewed_at ?? a.bean.added_at));

    return {
      /** Also finds a bean by an id it had before it was replaced by the shared one (open pages, drafts). */
      coffee: (id: string | null | undefined) => (id ? coffeeById.get(resolveId(d.aliases, id)) : undefined),
      roaster: (id: string | null | undefined) => (id ? roasterById.get(id) : undefined),
      roasterName: (id: string | null | undefined) => (id ? roasterById.get(id)?.name ?? '' : ''),
      cupsFor: (coffeeId: string) => cupsByCoffee.get(resolveId(d.aliases, coffeeId)) ?? [],
      /** The user's list entry for a bean, also by an id the bean had before it was replaced. */
      bean: (id: string | null | undefined) => (id ? d.beans[resolveId(d.aliases, id)] : undefined),
      cup: (id: string) => d.cups.find((c) => c.id === id),
      /** Own photos of beans that were merged into this one (the main photo is on the coffee). */
      morePhotosFor: (id: string) => d.morePhotos?.[resolveId(d.aliases, id)] ?? [],
      myBeans,
      allCoffees: [...coffeeById.values()],
      roasters: catalog.roasters,
    };
  }, [data, catalog]);

  return {
    ready: !!data,
    /** Set when the stored journal could not be read; the app then shows that instead of an empty journal. */
    loadProblem,
    /** The last write to the phone failed: the latest changes are only in memory. */
    saveFailed,
    profile: data?.profile ?? initialData().profile,
    cups: data?.cups ?? [],
    beans: data?.beans ?? {},
    /** What the profile shows under "Backup"; see lib/backup.ts. */
    backup: backupStatus(sync, { cups: data?.cups ?? [], pending: data?.pending ?? emptyPending, beanCount: Object.keys(data?.beans ?? {}).length }),
    sync,
    draft,
    ...actions,
    ...selectors,
  };
}

type Store = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<Store | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue();
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore outside DataProvider');
  return s;
}
