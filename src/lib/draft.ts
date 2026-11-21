import type { Draft } from '../data/store';
import type { Coffee, Cup } from '../data/types';
import { roastLevelOf } from './validate';

const DEFAULTS = { grind: 30, dose_g: 18, yield_g: 36, time_s: 28 };
const START_TIME_S = 28;

/**
 * Where a new cup starts:
 * 1. the last cup of this bean: all of its values, extraction included;
 * 2. a bean not brewed yet with a roaster's recipe: dose, yield and time exactly as the roaster gives
 *    them; the grind from the last cup at all (a roaster cannot know the user's grinder);
 * 3. no roaster's recipe: grind and dose from the last cup at all (else 18 g), ratio by roast level
 *    (light 1:2.5, medium and dark 1:2), 28 s.
 * Without the bean at hand it keeps the last cup's values, as before.
 */
export function draftFor(coffeeId: string, cups: Cup[], bean?: Coffee): Draft {
  const own = cups.find((c) => c.coffee_id === coffeeId);
  if (own) return { coffeeId, grind: own.grind, dose_g: own.dose_g, yield_g: own.yield_g, time_s: own.time_s, extraction: own.extraction };
  const base = cups[0] ?? DEFAULTS;
  const draft: Draft = { coffeeId, grind: base.grind, dose_g: base.dose_g, yield_g: base.yield_g, time_s: base.time_s, extraction: 5 };
  if (!bean) return draft;
  return { ...draft, ...startRecipe(bean, base.dose_g) };
}

/** Dose, yield, time and where they come from for the first cup of a bean; `dose_g` is the user's last dose. */
export function startRecipe(bean: Coffee, dose_g: number): { dose_g: number; yield_g: number; time_s: number; start: 'roaster' | 'standard' } {
  if (bean.recipe_dose_g && bean.recipe_yield_g) {
    return {
      dose_g: Number(bean.recipe_dose_g),
      yield_g: Number(bean.recipe_yield_g),
      time_s: bean.recipe_time_s ? Math.round(Number(bean.recipe_time_s)) : START_TIME_S,
      start: 'roaster',
    };
  }
  const ratio = roastLevelOf(bean).level === 'hell' ? 2.5 : 2;
  return { dose_g, yield_g: Math.round(dose_g * ratio), time_s: START_TIME_S, start: 'standard' };
}

/** Opens a saved cup for editing, with all of its stored values. */
export function draftFromCup(cup: Cup): Draft {
  return {
    coffeeId: cup.coffee_id,
    grind: cup.grind,
    dose_g: cup.dose_g,
    yield_g: cup.yield_g,
    time_s: cup.time_s,
    extraction: cup.extraction,
    cupId: cup.id,
  };
}

/**
 * The draft the recipe screen may continue with. An edit draft only counts when the screen was opened
 * to edit that very cup; otherwise it is left over from an edit that was abandoned (e.g. swipe back).
 */
export function draftToContinue(draft: Draft | null, editCupId: string | undefined): Draft | null {
  if (!draft) return null;
  if (draft.cupId && draft.cupId !== editCupId) return null;
  return draft;
}

/**
 * Another bean was picked in the recipe. A new cup starts from that bean's last recipe; a cup being
 * edited keeps its values. A new cup this draft already added (failed or running write) stays the same
 * cup: only its bean and recipe values change, so saving later does not add a second one.
 */
export function switchBean(draft: Draft | null, coffeeId: string, cups: Cup[], bean?: Coffee): Draft {
  if (draft?.cupId) return { ...draft, coffeeId };
  const fresh = draftFor(coffeeId, cups.filter((c) => c.id !== draft?.newCupId), bean);
  return draft?.newCupId ? { ...fresh, newCupId: draft.newCupId } : fresh;
}

/**
 * Which cup saving a draft writes: the cup being edited, the new cup an earlier try already added
 * (its write failed or is still running, on this step or the recipe step), or a new one.
 */
export function saveTarget(draft: Draft): { kind: 'update'; id: string } | { kind: 'add' } {
  const id = draft.cupId ?? draft.newCupId;
  return id ? { kind: 'update', id } : { kind: 'add' };
}

/** The draft after its new cup was added to the journal, so later saves change that cup. */
export function withNewCup(draft: Draft, id: string): Draft {
  return draft.cupId ? draft : { ...draft, newCupId: id };
}
