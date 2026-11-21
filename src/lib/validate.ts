// What the database accepts, checked on the phone before a value is saved or sent. Mirrors the checks
// in supabase/migrations (share_coffee, coffees, cups, user_coffees). Messages are English source
// strings for t(); the app translates them where it shows them.
import type { Coffee, Cup, MyBean } from '../data/types';
import { matchKey } from './community';

export const ROAST_FOR = ['espresso', 'filter', 'omni'] as const;
export const ROAST_LEVELS = ['hell', 'mittel', 'dunkel'] as const;

/** Why a bean name cannot be saved, or null. share_coffee() refuses a name without letters or digits ("☕"). */
export function coffeeNameProblem(name: string | null | undefined): string | null {
  if (!name || !name.trim()) return 'Enter a name first';
  if (!matchKey(name)) return 'The name needs at least one letter or digit.';
  return null;
}

/** Why a bean cannot be shared as it is, or null. Only problems the user has to fix; see `shareableCoffee`. */
export function coffeeProblem(c: Pick<Coffee, 'name'>): string | null {
  return coffeeNameProblem(c.name);
}

/** Drops values the database would refuse but the user cannot see or fix (an unknown roast profile). */
export function shareableRoastFor(v: string | null | undefined): string | null {
  return v && (ROAST_FOR as readonly string[]).includes(v) ? v : null;
}

export function shareableRoastLevel(v: string | null | undefined): string | null {
  return v && (ROAST_LEVELS as readonly string[]).includes(v) ? v : null;
}

/** The roast level when nobody named it: filter and omni roasts are light, espresso roasts and unknown medium. Same as estimate_roast_level() in the database. */
export function estimateRoastLevel(roastFor: string | null | undefined): (typeof ROAST_LEVELS)[number] {
  return roastFor === 'filter' || roastFor === 'omni' ? 'hell' : 'mittel';
}

/** A bean's roast level, always filled: the one given, else the estimate (and whether it is one). */
export function roastLevelOf(c: Pick<Coffee, 'roast_level' | 'roast_level_estimated' | 'roast_for'>): { level: (typeof ROAST_LEVELS)[number]; estimated: boolean } {
  const given = shareableRoastLevel(c.roast_level) as (typeof ROAST_LEVELS)[number] | null;
  return given ? { level: given, estimated: !!c.roast_level_estimated } : { level: estimateRoastLevel(c.roast_for), estimated: true };
}

const RECIPE_LIMITS = { recipe_dose_g: [5, 30], recipe_yield_g: [5, 150], recipe_time_s: [5, 90], recipe_temp_c: [80, 100] } as const;
type RecipeKey = keyof typeof RECIPE_LIMITS;

/** The roaster's recipe fields as the database accepts them (coffees checks); a value out of range is dropped. */
export function shareableRecipe(c: Partial<Record<RecipeKey, number | null>>): Record<RecipeKey, number | null> {
  const out = {} as Record<RecipeKey, number | null>;
  for (const k of Object.keys(RECIPE_LIMITS) as RecipeKey[]) {
    const v = c[k];
    const [lo, hi] = RECIPE_LIMITS[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? (k === 'recipe_time_s' ? Math.round(v) : Math.round(v * 10) / 10) : null;
  }
  return out;
}

const inRange = (v: number | null | undefined, lo: number, hi: number) => v == null || (Number.isFinite(v) && v >= lo && v <= hi);

/** Why a cup cannot be sent, or null. Mirrors the checks on public.cups. */
export function cupProblem(c: Cup): string | null {
  if (!(c.dose_g > 0) || !(c.yield_g > 0) || !(c.time_s >= 0)) return 'Check dose, yield and time of this cup.';
  if (!inRange(c.extraction, 0, 10) || !inRange(c.sweetness, 0, 10) || !inRange(c.acidity, 0, 10) || !inRange(c.body, 0, 10)) {
    return 'Check the values of this cup.';
  }
  return null;
}

/** Why a list entry cannot be sent, or null. Mirrors the check on public.user_coffees.rating. */
export function beanProblem(b: MyBean): string | null {
  return b.rating == null || (Number.isInteger(b.rating) && b.rating >= 1 && b.rating <= 5) ? null : 'Check the rating of this coffee.';
}
