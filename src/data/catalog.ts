import { originLabel } from '../i18n/coffeeLabels';
// The shared bean catalogue (seed plus beans users shared): bundled seed for offline use, refreshed from Supabase when online.
import AsyncStorage from '@react-native-async-storage/async-storage';

import seed from './catalog-seed.json';
import { supabase } from './supabase';
import type { Coffee, Roaster } from './types';

export type Catalog = { roasters: Roaster[]; coffees: Coffee[] };

const CACHE_KEY = 'goodcoffee:catalog:v2';

export const bundledCatalog: Catalog = seed as Catalog;

export async function loadCachedCatalog(): Promise<Catalog | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Catalog) : null;
  } catch {
    return null;
  }
}

export async function fetchCatalog(): Promise<Catalog> {
  const [roasters, coffees] = await Promise.all([
    supabase.from('roasters').select('id, slug, name, district, website').order('name'),
    supabase
      .from('coffees')
      .select('id, roaster_id, name, origin_country, region, producer, process, variety, roast_for, roast_level, roast_level_estimated, recipe_dose_g, recipe_yield_g, recipe_time_s, recipe_temp_c, roaster_notes, product_url, photo_path, source, reviewed')
      .is('merged_into', null)
      .or('source.eq.seed,visibility.eq.public')
      .order('name'),
  ]);
  if (roasters.error) throw roasters.error;
  if (coffees.error) throw coffees.error;
  const catalog = { roasters: roasters.data as Roaster[], coffees: coffees.data as Coffee[] };
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(catalog)).catch(() => undefined);
  return catalog;
}

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');
}

/** Every word of the query must appear in the bean name, roaster, origin or region. */
export function searchCoffees(coffees: Coffee[], roasterName: (id: string | null) => string, query: string, limit = 30): Coffee[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: { c: Coffee; score: number }[] = [];
  for (const c of coffees) {
    const name = fold(c.name);
    const hay = [name, fold(roasterName(c.roaster_id)), fold(c.origin_country ?? ''), fold(originLabel(c.origin_country, 'en')), fold(originLabel(c.origin_country, 'de')), fold(c.region ?? '')].join(' ');
    if (words.every((w) => hay.includes(w))) {
      hits.push({ c, score: words.filter((w) => name.includes(w)).length });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name)).slice(0, limit).map((h) => h.c);
}

/**
 * Beans among `ids` that were merged into another one on the server (duplicates found later), as
 * old id → kept id. Empty when offline.
 */
export async function fetchMerged(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const { data, error } = await supabase.from('coffees').select('id, merged_into').in('id', ids).not('merged_into', 'is', null);
  if (error || !data) return {};
  return Object.fromEntries((data as { id: string; merged_into: string }[]).map((r) => [r.id, r.merged_into]));
}
