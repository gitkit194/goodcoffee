// Matching a scanned bag against the catalogue. Plain TypeScript, so the eval script can use it too.
import type { Coffee } from '../data/types';

type Scanned = { name: string | null; roaster: string | null; roast_for?: string | null };

/** Case, accents and umlauts don't count: "Röststätte", "ROESTSTAETTE" and "Roststatte" fold alike. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/([aou])e/g, '$1')
    .trim();
}

const ROASTER_FILLER = new Set(['coffee', 'roasters', 'roastery', 'kaffee', 'kaffeerosterei', 'rosterei', 'kaffeeroesterei', 'company', 'co', 'the', 'berlin']);
// Words that name the roast or the format rather than the bean ("Aponte Espresso", "Atlas Coffee").
const NAME_FILLER = new Set(['espresso', 'filter', 'omni', 'omniroast', 'roast', 'coffee', 'kaffee', 'bio', 'organic', 'finca']);
const ROAST_WORDS: Record<string, string[]> = { espresso: ['espresso'], filter: ['filter'], omni: ['omni', 'omniroast'] };

export function words(s: string, filler?: Set<string>): string[] {
  return fold(s)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !filler?.has(w));
}

/**
 * Share of the words in `a` that also appear in `b`. Spaces don't count: "Ayla Bombe" and "AylaBombe"
 * cover each other, because two neighbouring words also count as one joined word.
 */
function covered(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const inB = new Set([...b, ...b.slice(1).map((w, i) => b[i] + w)]);
  let found = 0;
  for (let i = 0; i < a.length; i++) {
    if (inB.has(a[i])) found++;
    else if (i + 1 < a.length && b.includes(a[i] + a[i + 1])) {
      found += 2;
      i++;
    }
  }
  return found / a.length;
}

/** "Kaffee Kirsche" and "KaffeeKirsche": the roaster's own words, joined, appear in the other name. */
function sameRoasterJoined(a: string, b: string): boolean {
  const key = (s: string, filler?: Set<string>) => words(s, filler).join('');
  const [ka, kb] = [key(a, ROASTER_FILLER), key(b, ROASTER_FILLER)];
  if (ka.length < 4 || kb.length < 4) return false;
  return key(b).includes(ka) || key(a).includes(kb);
}

/** Whether two roaster names mean the same roaster, as far as a scan or a typed name can tell. */
export function sameRoaster(a: string, b: string): boolean {
  const wa = words(a, ROASTER_FILLER);
  const wb = words(b, ROASTER_FILLER);
  return covered(wa, wb) >= 0.5 || covered(wb, wa) >= 0.5 || sameRoasterJoined(a, b);
}

function roastIn(name: string): string | null {
  const ws = words(name);
  for (const [key, list] of Object.entries(ROAST_WORDS)) if (list.some((w) => ws.includes(w))) return key;
  return null;
}

function roastFor(c: Coffee): string | null {
  return roastIn(c.name) ?? c.roast_for ?? null;
}

/** Espresso and Filter rule each other out; Omni and an unknown roast fit either. */
function roastClash(a: string | null, b: string | null): boolean {
  return (a === 'espresso' && b === 'filter') || (a === 'filter' && b === 'espresso');
}

/**
 * Finds the catalogue bean the scan most likely shows. A wrong match is worse than none, so every
 * word of the scanned name must appear in the catalogue name and the roaster must agree when the bag
 * shows one. A bean roasted for the other method (Espresso vs. Filter) never matches. If several
 * beans still fit, the roast decides; failing that, only a bean whose name is exactly what the bag
 * says, and only when the roaster is known. Otherwise nothing.
 */
export function matchCatalog(result: Scanned, coffees: Coffee[], roasterName: (id: string | null) => string): Coffee | null {
  if (!result.name) return null;
  const scanName = words(result.name, NAME_FILLER);
  if (!scanName.length) return null;
  const scanRoaster = result.roaster ? words(result.roaster, ROASTER_FILLER) : [];
  // "Aponte Filter" on the bag says the roast even when the model left roast_for empty.
  const scanRoast = result.roast_for ?? roastIn(result.name);

  let candidates: { c: Coffee; exact: boolean }[] = [];
  for (const c of coffees) {
    if (scanRoaster.length && !sameRoaster(result.roaster!, roasterName(c.roaster_id))) continue;
    if (roastClash(scanRoast, roastFor(c))) continue;
    const catName = words(c.name, NAME_FILLER);
    if (covered(scanName, catName) < 1) continue;
    candidates.push({ c, exact: covered(catName, scanName) === 1 });
  }
  if (candidates.length > 1 && scanRoast) {
    const sameRoast = candidates.filter((x) => roastFor(x.c) === scanRoast);
    if (sameRoast.length) candidates = sameRoast;
  }
  if (candidates.length === 1) return candidates[0].c;
  const exact = candidates.filter((x) => x.exact);
  return scanRoaster.length && exact.length === 1 ? exact[0].c : null;
}

type Looked = { verified: boolean; result: { confidence: 'high' | 'medium' | 'low'; roast_for?: string | null } };

/**
 * Whether an online answer may fill the form and replace the photo without asking. A checked page
 * with medium confidence is enough, unless the bag doesn't say its roast: then the shop may sell the
 * bean as Espresso and as Filter and the model can only guess the variant, so only a high answer
 * counts. An answer for the other roast never counts.
 */
export function isSure(online: Looked, bag: Scanned): boolean {
  if (!online.verified || online.result.confidence === 'low') return false;
  const bagRoast = bag.roast_for ?? (bag.name ? roastIn(bag.name) : null);
  if (roastClash(bagRoast, online.result.roast_for ?? null)) return false;
  return !!bagRoast || online.result.confidence === 'high';
}

/** A roaster name without "Coffee", "Roasters" & co., spaces and case: "Bonanza Coffee Roasters" → "bonanza". */
export function roasterKey(name: string): string {
  return words(name, ROASTER_FILLER).join('') || words(name).join('');
}
