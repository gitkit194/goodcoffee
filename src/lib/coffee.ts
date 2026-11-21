import { t, type MessageKey } from '../i18n';

// Domain helpers: extraction scale, aroma wheel categories and the roaster comparison.

export function extractionLabel(v: number): string {
  if (v <= 3) return t("Under-extracted");
  if (v >= 7) return t("Over-extracted");
  return t("Balanced");
}

export function extractionHint(v: number): string {
  if (v <= 1) return t("very sour, thin, short");
  if (v <= 3) return t("sour, thin, short");
  if (v === 4) return t("bright, slightly tart");
  if (v === 5) return t("sweet, round, dialled in");
  if (v === 6) return t("bold, slightly bitter");
  if (v <= 8) return t("bitter, dry");
  return t("very bitter, astringent");
}

export type AromaCategory = {
  key: string;
  name: MessageKey;
  inner: string;
  sub: string;
  subs: string[];
};

export const AROMA_CATEGORIES: AromaCategory[] = [
  { key: 'flower', name: "Floral", inner: '#E4D6CF', sub: '#E4D6CF', subs: [] },
  { key: 'fruit', name: "Fruity", inner: '#CFAD9B', sub: '#E6D3C5', subs: ['stone_fruit', 'berries', 'tropical', 'citrus', 'dried_fruit'] },
  { key: 'choc', name: "Chocolate", inner: '#D6C3B6', sub: '#D6C3B6', subs: [] },
  { key: 'nut', name: "Nuts & grains", inner: '#D3C0A5', sub: '#D3C0A5', subs: [] },
  { key: 'sweet', name: "Sweet", inner: '#D9C5A2', sub: '#E6DCC5', subs: ['maple_syrup', 'caramel', 'marshmallow', 'cream', 'honey', 'vanilla'] },
];

// Accept legacy German sub-keys while writing language-independent keys for new cups.
const LEGACY_SUBS: Record<string, string> = {"Steinobst": "stone_fruit", "Beeren": "berries", "Tropisch": "tropical", "Zitrus": "citrus", "Trockenobst": "dried_fruit", "Ahornsirup": "maple_syrup", "Karamell": "caramel", "Marshmallow": "marshmallow", "Sahne": "cream", "Honig": "honey", "Vanille": "vanilla"};
const SUB_NAMES: Record<string, MessageKey> = {"stone_fruit": "Stone fruit", "berries": "Berries", "tropical": "Tropical", "citrus": "Citrus", "dried_fruit": "Dried fruit", "maple_syrup": "Maple syrup", "caramel": "Caramel", "marshmallow": "Marshmallow", "cream": "Cream", "honey": "Honey", "vanilla": "Vanilla"};

export function normalizeAromaKey(key: string): string {
  const [category, sub] = key.split(':');
  return sub ? category + ':' + (LEGACY_SUBS[sub] ?? sub) : key;
}

export function aromaName(key: string): string {
  const [category, sub] = normalizeAromaKey(key).split(':');
  const c = AROMA_CATEGORIES.find((item) => item.key === category);
  if (sub) return SUB_NAMES[sub] ? t(SUB_NAMES[sub]) : sub;
  return c ? t(c.name) : key;
}

export function aromaCategory(key: string): string {
  return key.split(':')[0];
}

// Keywords (German and English, lower case) that map a roaster's tasting note to a wheel key.
const NOTE_KEYS: [string, string[]][] = [
  ['fruit:berries', ['beere', 'berry', 'berries', 'johannis', 'currant', 'cranberry', 'cassis', 'himbeer', 'erdbeer', 'brombeer', 'blaubeer', 'heidelbeer', 'preiselbeer', 'raspberr', 'strawberr', 'blackberr', 'blueberr', 'grape', 'traube']],
  ['fruit:stone_fruit', ['pfirsich', 'peach', 'aprikose', 'apricot', 'nektarine', 'nectarine', 'kirsch', 'cherry', 'pflaume', 'plum', 'steinfrucht', 'steinobst', 'stone fruit', 'mirabelle']],
  ['fruit:tropical', ['mango', 'papaya', 'ananas', 'pineapple', 'passionsfrucht', 'passion', 'guava', 'guave', 'maracuja', 'tropisch', 'tropical', 'banane', 'banana', 'kiwi', 'litschi', 'lychee', 'melone', 'melon', 'starfruit']],
  ['fruit:citrus', ['zitrone', 'lemon', 'limette', 'lime', 'orange', 'grapefruit', 'mandarin', 'bergamot', 'zitrus', 'citrus', 'pomelo', 'yuzu']],
  ['fruit:dried_fruit', ['rosine', 'raisin', 'feige', 'fig', 'dattel', 'date', 'trockenfr', 'dried', 'pflaumenmus']],
  ['fruit', ['apfel', 'apple', 'birne', 'pear', 'frucht', 'fruit', 'rhabarber', 'rhubarb']],
  ['flower', ['blüte', 'blossom', 'jasmin', 'rose', 'hibiskus', 'hibiscus', 'floral', 'flower', 'lavendel', 'lavender', 'holunder', 'elderflower', 'earl grey', 'tee', 'tea']],
  ['choc', ['schoko', 'chocolate', 'kakao', 'cacao', 'cocoa', 'nougat', 'truffle', 'trüffel']],
  ['nut', ['nuss', 'nüss', 'nut', 'mandel', 'almond', 'haselnuss', 'hazelnut', 'pekan', 'pecan', 'walnuss', 'walnut', 'macadamia', 'marzipan', 'getreide', 'malz', 'malt', 'keks', 'cookie', 'biscuit']],
  ['sweet:caramel', ['karamell', 'caramel', 'toffee', 'butterscotch', 'panela', 'brauner zucker', 'brown sugar', 'rohrzucker', 'cane sugar', 'melasse', 'molasses']],
  ['sweet:honey', ['honig', 'honey']],
  ['sweet:vanilla', ['vanille', 'vanilla', 'tonka']],
  ['sweet:maple_syrup', ['ahorn', 'maple']],
  ['sweet:cream', ['sahne', 'cream', 'creamy', 'milch', 'milk']],
  ['sweet', ['süß', 'sweet', 'zucker', 'sugar', 'candy', 'bonbon', 'cola', 'sirup', 'syrup', 'marshmallow']],
];

/** Best wheel key for a roaster note, or null when nothing matches. */
export function noteKey(note: string): string | null {
  const n = note.toLowerCase();
  for (const [key, words] of NOTE_KEYS) {
    if (words.some((w) => n.includes(w))) return key;
  }
  return null;
}

/** A roaster note counts as recognised when the user picked the same sub-aroma or its category. */
export function noteMatches(note: string, picked: string[]): boolean {
  const key = noteKey(note);
  if (!key) return false;
  const cat = aromaCategory(key);
  return picked.map(normalizeAromaKey).some((p) => p === key || p === cat || (key === cat && aromaCategory(p) === cat));
}
