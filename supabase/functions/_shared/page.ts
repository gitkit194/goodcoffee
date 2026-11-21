// Judges a shop page fetched by enrich-bean. Plain TypeScript without Deno APIs, so tests can run it in Node.

export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Words a shop often leaves out of the product title; the roast is checked on its own below.
const GENERIC = new Set(['espresso', 'filter', 'omni', 'omniroast', 'roast', 'coffee', 'kaffee', 'bio', 'organic', 'natural', 'washed', 'honey', 'anaerob']);

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&ndash;|&#8211;/g, '–');

// --- Which links and images the app may keep (mirrored in src/lib/url.ts and public.is_safe_https_url) ---

/**
 * A link the app may store and open: https, a real domain name (no IP, no localhost), port 443 at most,
 * no user:password, no spaces, quotes, angle brackets or backslashes. tel:, javascript:, intent: and
 * every other scheme fail here.
 */
export const SAFE_HTTPS = /^https:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\.?(:443)?([/?#][^\s<>"'\\`]*)?$/i;
// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function isSafeLink(u: unknown): u is string {
  return typeof u === 'string' && u.length <= 2048 && !CONTROL.test(u) && SAFE_HTTPS.test(u);
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
};

// Second-level labels under which a country code hands out names (shop.co.uk, kaffee.or.at).
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'or', 'gv', 'gov', 'edu']);

/** The registrable part of a host, roughly: "shop.thebarn.de" → "thebarn.de", "a.b.co.uk" → "b.co.uk". */
export function site(u: string): string {
  const labels = host(u).split('.').filter(Boolean);
  const n = labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-n).join('.');
}

export const sameSite = (a: string, b: string) => !!site(a) && site(a) === site(b);

// Image hosts shop systems serve product photos from on behalf of the shop.
export const SHOP_CDNS = ['cdn.shopify.com', 'images.squarespace-cdn.com', 'static.wixstatic.com'];

/** Rule for foreign images: a product photo is kept only from the shop's own site or its shop system's CDN. */
export function trustedImage(image: string | null, pageUrl: string): string | null {
  if (!image || !isSafeLink(image)) return null;
  return sameSite(image, pageUrl) || SHOP_CDNS.includes(host(image)) ? image : null;
}

// Marketplaces and resellers: a bean found there is never "verified" as the roaster's own page.
const MARKETPLACES = ['amazon', 'ebay', 'etsy', 'idealo', 'otto', 'kaufland', 'galaxus', 'rakuten', 'aliexpress', 'temu'];

/**
 * Is the page from a source we trust for this roaster? Not a marketplace, and when the catalogue knows
 * the roaster's website (seed data, checked by us), on that same site.
 */
export function trustedShop(pageUrl: string, roasterWebsite: string | null): boolean {
  if (!isSafeLink(pageUrl)) return false;
  const brand = site(pageUrl).split('.')[0];
  if (MARKETPLACES.includes(brand)) return false;
  return roasterWebsite ? sameSite(pageUrl, roasterWebsite) : true;
}

/**
 * Is this the product page of the bean, and which photo does it show? The name must be in what names
 * the page itself (URL path, og:title, <title>, first <h1>), not just somewhere on it: a shop page for
 * another coffee lists this one under "related products", and its og:image is the other coffee's.
 * An Espresso bag must not land on the Filter page and vice versa.
 */
export function judgePage(html: string, url: string, name: string | null, roastFor: string | null): { verified: boolean; image_url: string | null } {
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'))?.[1];
  let image = meta('og:image:secure_url') ?? meta('og:image') ?? meta('twitter:image') ?? null;
  if (image?.startsWith('//')) image = 'https:' + image;
  if (image?.startsWith('http://')) image = 'https://' + image.slice(7);
  image = image ? trustedImage(decode(image), url) : null;

  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '';
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ') ?? '';
  let path = '';
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    path = '';
  }
  // The name must be in what the page says about itself. The URL path alone never counts: whoever
  // picks the URL picks the path (https://anything.example/aponte-espresso).
  const label = ' ' + fold(decode([meta('og:title') ?? '', title, h1].join(' '))) + ' ';
  const withPath = ' ' + fold(path) + label;
  const words = fold(name ?? '').split(' ').filter((w) => w.length > 2 && !GENERIC.has(w));
  const other = roastFor === 'espresso' ? 'filter' : roastFor === 'filter' ? 'espresso' : null;
  // The path still counts against a match: ".../aponte-filter" is no Espresso page.
  const wrongRoast = !!other && withPath.includes(' ' + other) && !withPath.includes(' ' + roastFor);
  const verified = isSafeLink(url) && words.length > 0 && words.every((w) => label.includes(' ' + w)) && !wrongRoast;
  return { verified, image_url: image };
}
