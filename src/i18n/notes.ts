import type { Language } from './core';

// Flavour notes come from roasters as they print them, in German or English. They are stored as
// written and only translated for display. Each row: English, German, then further spellings of
// either. A note that isn't listed is shown as it is. Pure module (no React), so tests can load it.
const NOTES: string[][] = [
  // Chocolate & cocoa
  ['Chocolate', 'Schokolade'],
  ['Dark chocolate', 'Dunkle Schokolade', 'Bitterschokolade', 'Zartbitterschokolade', 'Zartbitter-Schokolade'],
  ['Milk chocolate', 'Milchschokolade', 'Vollmilchschokolade'],
  ['White chocolate', 'Weiße Schokolade'],
  ['Chocolate truffle', 'Schokoladentrüffel'],
  ['Cocoa', 'Kakao', 'Cacao'],
  ['Cacao nibs', 'Kakaonibs'],
  ['Cocoa butter', 'Kakaobutter'],
  ['Nutty chocolate', 'Nuss-Schokolade'],
  ['Nutty, chocolatey', 'Nussig-schokoladig'],
  ['Rum raisin chocolate', 'Rum-Rosinen-Schokolade'],
  // Nuts
  ['Nuts', 'Nuss', 'Nüsse'],
  ['Nutty', 'Nussig'],
  ['Roasted nuts', 'Geröstete Nüsse'],
  ['Hazelnut', 'Haselnuss', 'Haselnüsse'],
  ['Roasted hazelnut', 'Geröstete Haselnuss', 'Geröstete Haselnüsse'],
  ['Almond', 'Mandel', 'Mandeln', 'Almonds'],
  ['Walnut', 'Walnuss', 'Walnüsse', 'Walnuts'],
  ['Pecan', 'Pekannuss', 'Pekan', 'Pekanuss', 'Pecans'],
  ['Macadamia', 'Macadamia'],
  ['Nougat', 'Nougat'],
  ['Nut nougat', 'Nuss-Nougat'],
  ['Marzipan', 'Marzipan'],
  // Sweet
  ['Caramel', 'Karamell', 'Karamel'],
  ['Caramelised sugar', 'Karamellisierter Zucker', 'Caramelized sugar'],
  ['Toffee', 'Toffee'],
  ['Honey', 'Honig'],
  ['Brown sugar', 'Brauner Zucker'],
  ['Cane sugar', 'Rohrzucker'],
  ['Sugar cane', 'Zuckerrohr'],
  ['Panela', 'Panela'],
  ['Molasses', 'Melasse'],
  ['Maple syrup', 'Ahornsirup'],
  ['Vanilla', 'Vanille'],
  ['Tonka bean', 'Tonkabohne'],
  ['Cream', 'Sahne'],
  ['Sweet', 'Süß'],
  ['Malt', 'Malz'],
  ['Cookies', 'Kekse', 'Biscuits'],
  ['Nuts & grains', 'Nüsse & Getreide', 'Nuts and grains', 'Nüsse und Getreide'],
  ['Cookie dough', 'Keksteig'],
  ['Choc chip cookie', 'Schoko-Cookie'],
  ['Speculoos', 'Spekulatius'],
  ['Panettone', 'Panettone'],
  ['Lemon cake', 'Zitronenkuchen'],
  ['Lemon curd', 'Zitronencreme'],
  ['Cherry Bakewell', 'Cherry Bakewell'],
  ['Candy floss', 'Zuckerwatte', 'Candy-floss', 'Cotton candy'],
  ['Cherry candy', 'Kirschbonbon'],
  ['Strawberry candy', 'Erdbeerbonbon'],
  ['Lemon candy', 'Zitronenbonbon'],
  ['Tutti frutti', 'Tutti-Frutti'],
  ['Cola', 'Cola'],
  ['Cherry cola', 'Kirsch-Cola'],
  ['Licorice', 'Lakritz', 'Liquorice'],
  // Berries
  ['Red berries', 'Rote Beeren'],
  ['Ripe berries', 'Reife Beeren'],
  ['Dark forest berries', 'Dunkle Waldbeeren'],
  ['Strawberry', 'Erdbeere', 'Erdbeeren', 'Strawberries'],
  ['Wild strawberries', 'Walderdbeeren', 'Wilde Erdbeeren'],
  ['Raspberry', 'Himbeere', 'Himbeeren', 'Raspberries'],
  ['Ripe raspberries', 'Reife Himbeeren'],
  ['Raspberry jam', 'Himbeermarmelade'],
  ['Blueberry', 'Blaubeere', 'Blaubeeren', 'Heidelbeere', 'Heidelbeeren', 'Blueberries'],
  ['Blueberry jam', 'Blaubeermarmelade'],
  ['Blackberry', 'Brombeere', 'Brombeeren', 'Blackberries'],
  ['Blackcurrant', 'Schwarze Johannisbeere', 'Schwarze Johannisbeeren', 'Black currant'],
  ['Ripe blackcurrant', 'Reife schwarze Johannisbeere'],
  ['Redcurrant', 'Rote Johannisbeere', 'Rote Johannisbeeren', 'Red currant'],
  ['Cranberry', 'Cranberry', 'Cranberries'],
  ['Lingonberry jam', 'Preiselbeermarmelade'],
  ['Rose hip', 'Hagebutte'],
  ['Rose hip tea', 'Hagebuttentee'],
  ['Purple fruits', 'Lila Früchte'],
  // Stone fruit
  ['Stone fruit', 'Steinfrucht', 'Steinfrüchte', 'Steinobst'],
  ['Cherry', 'Kirsche', 'Kirschen'],
  ['Dark cherry', 'Schwarzkirsche', 'Black cherry'],
  ['Juicy sweet cherry', 'Saftige Süßkirsche'],
  ['Cherry jam', 'Kirschmarmelade'],
  ['Cherry brandy', 'Kirsch-Cognac'],
  ['Peach', 'Pfirsich'],
  ['White peach', 'Weißer Pfirsich'],
  ['Peach jam', 'Pfirsichmarmelade'],
  ['Peach iced tea', 'Pfirsich-Eistee'],
  ['Apricot', 'Aprikose', 'Aprikosen'],
  ['Dried apricot', 'Getrocknete Aprikose'],
  ['Stewed apricot', 'Aprikosenkompott'],
  ['Nectarine', 'Nektarine'],
  ['Plum', 'Pflaume', 'Pflaumen'],
  ['Purple plum', 'Blaue Pflaume'],
  // Citrus
  ['Citrus fruits', 'Zitrusfrüchte', 'Citrus'],
  ['Lemon', 'Zitrone'],
  ['Lime', 'Limette'],
  ['Orange', 'Orange'],
  ['Blood orange', 'Blutorange'],
  ['Mandarin', 'Mandarine'],
  ['Grapefruit', 'Grapefruit'],
  ['Pink grapefruit', 'Rote Grapefruit', 'Red grapefruit'],
  ['Pomelo', 'Pomelo'],
  ['Bergamot', 'Bergamotte'],
  // Tropical & other fruit
  ['Tropical fruits', 'Tropische Früchte'],
  ['Mango', 'Mango'],
  ['Papaya', 'Papaya'],
  ['Pineapple', 'Ananas'],
  ['Passion fruit', 'Passionsfrucht', 'Maracuja'],
  ['Guava', 'Guave'],
  ['Kiwi', 'Kiwi'],
  ['Gold kiwi', 'Gold-Kiwi'],
  ['Starfruit', 'Sternfrucht'],
  ['Physalis', 'Physalis'],
  ['Prickly pear', 'Kaktusfeige'],
  ['Banana chips', 'Bananen-Chips'],
  ['Melon', 'Melone'],
  ['Honeydew melon', 'Honigmelone'],
  ['Cantaloupe', 'Cantaloupe-Melone'],
  ['Apple', 'Apfel'],
  ['Red apple', 'Roter Apfel'],
  ['Green apple', 'Grüner Apfel'],
  ['Fuji apple', 'Fuji-Apfel'],
  ['Baked apple', 'Bratapfel'],
  ['Grape', 'Trauben', 'Traube', 'Grapes'],
  ['Red grape', 'Rote Trauben', 'Red grapes'],
  ['Purple grape', 'Blaue Trauben'],
  ['Concord grape', 'Concord-Traube'],
  ['Rhubarb', 'Rhabarber'],
  ['Rhubarb jam', 'Rhabarbermarmelade'],
  ['Fig', 'Feige', 'Figs', 'Feigen'],
  ['Ripe fig', 'Reife Feige'],
  ['Dried fig', 'Getrocknete Feige'],
  ['Fig jam', 'Feigenmarmelade'],
  ['Raisin', 'Rosine', 'Rosinen', 'Raisins'],
  ['Rum raisin', 'Rum-Rosine'],
  ['Dried fruits', 'Trockenfrüchte'],
  ['Light fruity notes', 'Leichte Fruchtnoten'],
  ['Juicy', 'Saftig'],
  // Floral & tea
  ['Floral', 'Floral', 'Blumig'],
  ['Light floral notes', 'Leicht florale Noten', 'Leichte florale Noten'],
  ['Jasmine', 'Jasmin'],
  ['Rose', 'Rose'],
  ['Rose petals', 'Rosenblüte'],
  ['Rose water', 'Rosenwasser'],
  ['Hibiscus', 'Hibiskus'],
  ['Elderflower', 'Holunderblüte'],
  ['Orange blossom', 'Orangenblüte', 'Orangenblüten'],
  ['Apple blossom', 'Apfelblüte', 'Apfelblüten'],
  ['Linden blossom', 'Lindenblüte'],
  ['Lavender', 'Lavendel'],
  ['Black tea', 'Schwarzer Tee', 'Schwarztee'],
  ['Green tea', 'Grüner Tee', 'Grüntee'],
  ['Darjeeling tea', 'Darjeeling Tee', 'Darjeeling-Tee', 'Darjeeling'],
  ['Earl Grey', 'Earl Grey'],
  ['Rooibos tea', 'Rooibos-Tee', 'Rooibos'],
  // Spice & other
  ['Spices', 'Gewürze'],
  ['Warm spices', 'Warme Gewürze'],
  ['Nutmeg', 'Muskatnuss'],
  ['Anise', 'Anis'],
  ['Spruce', 'Fichte'],
  ['Elegant', 'Elegant'],
];

const fold = (s: string) => s.trim().toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ');

const INDEX = new Map<string, string[]>();
for (const row of NOTES) for (const name of row) if (!INDEX.has(fold(name))) INDEX.set(fold(name), row);

/** A roaster's flavour note in the app's language; parts separated by commas are translated one by one. */
export function noteLabel(note: string, language: Language): string {
  const whole = INDEX.get(fold(note));
  if (whole) return whole[language === 'de' ? 1 : 0];
  if (!note.includes(',')) return note;
  return note
    .split(',')
    .map((part) => {
      const row = INDEX.get(fold(part));
      return row ? row[language === 'de' ? 1 : 0] : part.trim();
    })
    .join(', ');
}

/** Whether noteLabel knows the note (every part of it, for "Walnüsse, Nougat"). */
export function isKnownNote(note: string): boolean {
  return INDEX.has(fold(note)) || note.split(',').every((part) => INDEX.has(fold(part)));
}

// Words bags print next to the flavours that describe body, acidity or balance, not a taste:
// "rund", "ausgewogen", "vollmundig". They are not tasting notes and are dropped from a scan.
const NOT_A_FLAVOUR = new Set([
  'rund', 'round', 'ausgewogen', 'balanced', 'harmonisch', 'harmonious', 'vollmundig', 'full bodied', 'full-bodied',
  'cremig', 'creamy', 'samtig', 'velvety', 'seidig', 'silky', 'weich', 'smooth', 'sanft', 'gentle', 'mild',
  'kräftig', 'stark', 'strong', 'intensiv', 'intense', 'komplex', 'complex', 'elegant', 'lebendig', 'lively',
  'bright', 'clean', 'sauber', 'leicht', 'light', 'schwer', 'heavy', 'dicht', 'dense', 'klar', 'süffig',
]);
const NOT_A_FLAVOUR_PARTS = ['säure', 'acidity', 'körper', 'body', 'abgang', 'finish', 'aftertaste', 'nachgeschmack', 'mundgefühl', 'mouthfeel'];

/** Whether a scanned "note" is a taste at all; "rund" or "milde Säure" are not. */
export function isFlavourNote(note: string): boolean {
  const n = fold(note);
  if (!n) return false;
  return !NOT_A_FLAVOUR.has(n) && !NOT_A_FLAVOUR_PARTS.some((p) => n.includes(p));
}

/** The flavour notes among what a scan or a shop page lists, without duplicates. */
export function flavourNotes(notes: string[]): string[] {
  const seen = new Set<string>();
  return notes.filter((n) => {
    const key = fold(n);
    if (!isFlavourNote(n) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
