// Bag scan: photo → shrink → server-side recognition → match against the catalogue.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { supabase } from '../data/supabase';
import { ensureUser, LocalOnlyError } from '../data/sync';

import type { Recipe } from '../data/types';
import { isSure } from './match';
import { shareableRecipe } from './validate';
import { safeHttpsUrl } from './url';

export { matchCatalog } from './match';

export type Confidence = 'high' | 'medium' | 'low';

export type ScanResult = {
  is_coffee_bag: boolean;
  name: string | null;
  roaster: string | null;
  origin_country: string | null;
  region: string | null;
  producer: string | null;
  process: string | null;
  variety: string | null;
  roast_level: 'hell' | 'mittel' | 'dunkel' | null;
  roast_for: 'espresso' | 'filter' | 'omni' | null;
  roast_date: string | null;
  notes: string[];
  /** The espresso recipe printed on the bag, if any. */
  espresso_recipe?: EspressoRecipe | null;
  confidence: { name: Confidence; roaster: Confidence; origin_country: Confidence };
  bag_box: { x: number; y: number; w: number; h: number } | null;
};

export type EspressoRecipe = { dose_g: number | null; yield_g: number | null; time_s: number | null; temp_c: number | null };

/** A scanned or looked-up recipe in the bean's fields; only with dose and yield, values out of range dropped. */
export function toRecipe(r: EspressoRecipe | null | undefined): Recipe | null {
  if (!r) return null;
  const out = shareableRecipe({ recipe_dose_g: r.dose_g, recipe_yield_g: r.yield_g, recipe_time_s: r.time_s, recipe_temp_c: r.temp_c });
  return out.recipe_dose_g && out.recipe_yield_g ? out : null;
}

export class ScanError extends Error {}

const LONG_SIDE = 1280;

/** Sends the photo to the scan-bag function and returns what it read, plus the photo cropped to the bag. */
export async function scanBag(uri: string, size: { width: number; height: number }): Promise<{ result: ScanResult; photo: string }> {
  const scale = Math.min(1, LONG_SIDE / Math.max(size.width, size.height));
  const small = await ImageManipulator.manipulate(uri)
    .resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) })
    .renderAsync();
  const saved = await small.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });

  try {
    await ensureUser();
  } catch (e) {
    throw new ScanError(e instanceof LocalOnlyError ? e.message : "Cannot connect to the server.");
  }
  const { data, error } = await supabase.functions.invoke('scan-bag', { body: { image: saved.base64 } });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 429) throw new ScanError("You’ve reached today’s scan limit. Try again tomorrow.");
    if (status === 503) throw new ScanError("Bag scanning is currently unavailable.");
    throw new ScanError("The bag could not be read. Please try again.");
  }
  const result = data.result as ScanResult;
  return { result, photo: await cropToBag(saved.uri, saved.width, saved.height, result.bag_box) };
}

/** Crops the photo to the bag with a little margin, so it works as the bean's picture. */
async function cropToBag(uri: string, width: number, height: number, box: ScanResult['bag_box']): Promise<string> {
  if (!box || box.w <= 0 || box.h <= 0) return uri;
  const pad = 0.04;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(1 - x, box.w + 2 * pad);
  const h = Math.min(1 - y, box.h + 2 * pad);
  // A box covering nearly the whole photo isn't worth a crop.
  if (w > 0.92 && h > 0.92) return uri;
  try {
    const cropped = await ImageManipulator.manipulate(uri)
      .crop({ originX: Math.round(x * width), originY: Math.round(y * height), width: Math.round(w * width), height: Math.round(h * height) })
      .renderAsync();
    const out = await cropped.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    return out.uri;
  } catch {
    return uri;
  }
}

export type OnlineResult = {
  found: boolean;
  product_url: string | null;
  name: string | null;
  roaster: string | null;
  origin_country: string | null;
  region: string | null;
  producer: string | null;
  process: string | null;
  variety: string | null;
  roast_level: ScanResult['roast_level'];
  roast_for: ScanResult['roast_for'];
  espresso_recipe?: EspressoRecipe | null;
  notes: string[];
  confidence: Confidence;
};

export type Online = { result: OnlineResult; image_url: string | null; verified: boolean };

/**
 * Looks the scanned bean up on the roaster's own shop. Never throws: without a result the
 * scan simply stays as it is. `sure` means the page was found, checked and is trustworthy enough
 * to fill fields and replace the photo without asking.
 */
export async function lookUpOnline(scan: ScanResult): Promise<(Online & { sure: boolean }) | null> {
  try {
    const { data, error } = await supabase.functions.invoke('enrich-bean', {
      body: { name: scan.name, roaster: scan.roaster, origin_country: scan.origin_country, process: scan.process, roast_for: scan.roast_for, notes: scan.notes },
    });
    // Only https links and photos are kept, even if the server sent something else.
    const productUrl = safeHttpsUrl(data?.result?.product_url);
    if (error || !data?.result?.found || !productUrl) return null;
    const online = { ...data, result: { ...data.result, product_url: productUrl }, image_url: safeHttpsUrl(data.image_url) } as Online;
    return { ...online, sure: isSure(online, scan) };
  } catch {
    return null;
  }
}
