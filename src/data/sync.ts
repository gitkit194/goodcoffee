// Pushes local changes to Supabase as an anonymous user. The phone stays the source of truth.
// The push itself (row by row, refused rows marked) lives in push.ts; this file only connects it to Supabase.
import { ensureGuest, GuestUnavailable } from '../lib/guest';
import { supabase } from './supabase';
import type { Pending } from './pending';
import { push, type Api, type Sent, type Snapshot } from './push';
import { fetchRestore, type Restored, type RestoreApi } from './restore';

export { emptyPending, hasPending, sendable, type Pending } from './pending';
export type { Sent } from './push';

export class LocalOnlyError extends Error {}

export async function ensureUser(): Promise<string> {
  try {
    return await ensureGuest(supabase.auth);
  } catch (e) {
    if (e instanceof GuestUnavailable && e.reason === 'disabled') throw new LocalOnlyError("Guest sign-in is currently unavailable.");
    throw new LocalOnlyError("Cannot connect to the server.");
  }
}

const api: Api = {
  userId: ensureUser,
  shareCoffee: async (args) => await supabase.rpc('share_coffee', args),
  upsert: async (table, rows) => await supabase.from(table).upsert(rows),
  deleteCups: async (ids) => await supabase.from('cups').delete().in('id', ids),
};

/** Sends everything in `pending`; see push() for what comes back. */
export function pushPending(s: Snapshot, pending: Pending): Promise<Sent> {
  return push(api, s, pending);
}

const restoreApi: RestoreApi = {
  async storedUserId() {
    // Reads the stored session only; never signs in (a new account would have nothing to restore).
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.user.id ?? null;
  },
  page: async (table, uid, from, to) =>
    table === 'cups'
      ? await supabase
          .from('cups')
          .select('id, coffee_id, brewed_at, grind, dose_g, yield_g, time_s, extraction, sweetness, acidity, body, aromas')
          .eq('user_id', uid)
          .order('id')
          .range(from, to)
      : await supabase.from('user_coffees').select('coffee_id, roast_date, rating, comment, created_at, updated_at').eq('user_id', uid).order('coffee_id').range(from, to),
  profile: async (uid) => await supabase.from('profiles').select('display_name, grinder, created_at').eq('id', uid).limit(1),
  coffees: async (ids) =>
    await supabase
      .from('coffees')
      .select('id, roaster_id, name, origin_country, region, producer, process, variety, roast_for, roast_level, roast_level_estimated, recipe_dose_g, recipe_yield_g, recipe_time_s, recipe_temp_c, roaster_notes, product_url, photo_path, source, reviewed')
      .in('id', ids),
};

/** The stored account's journal on the server, or null if there is no stored session. See restore.ts. */
export function fetchFromCloud(): Promise<Restored | null> {
  return fetchRestore(restoreApi);
}
