import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSafeLink, judgePage, sameSite, site, trustedImage, trustedShop } from '../supabase/functions/_shared/page.ts';

const page = (title: string, image: string, body = '') =>
  `<html><head><title>${title}</title><meta property="og:title" content="${title}"><meta property="og:image" content="${image}"></head>` +
  `<body><h1>${title}</h1>${body}</body></html>`;

test('the bean only in "related products" of another coffee is not verified', () => {
  const html = page('Dreamteam Espresso – KaffeeKirsche', 'https://shop.example/dreamteam.jpg', '<h2>Das könnte dir auch gefallen</h2><a>Aponte Espresso</a>');
  const r = judgePage(html, 'https://shop.example/products/dreamteam-espresso', 'Aponte Espresso', 'espresso');
  assert.equal(r.verified, false);
});

test('the right product page is verified and gives its photo', () => {
  const html = page('Aponte Espresso &ndash; KaffeeKirsche', 'https://shop.example/aponte.jpg?v=1&amp;w=800');
  const r = judgePage(html, 'https://shop.example/products/aponte-espresso', 'Aponte Espresso', 'espresso');
  assert.deepEqual(r, { verified: true, image_url: 'https://shop.example/aponte.jpg?v=1&w=800' });
});

test('an espresso bag on the filter page is not verified', () => {
  const html = page('Aponte Filter', 'https://shop.example/aponte-f.jpg', '<p>Auch als Aponte Espresso erhältlich</p>');
  const r = judgePage(html, 'https://shop.example/products/aponte-filter', 'Aponte', 'espresso');
  assert.equal(r.verified, false);
});

test('umlauts and accents in the name still match', () => {
  const html = page('Äthiopien Waldespresso BIO | Berliner Kaffeerösterei', '//img.shop.example/w.jpg');
  const r = judgePage(html, 'https://shop.example/p/athiopien-waldespresso', 'Äthiopien Waldespresso', null);
  assert.deepEqual(r, { verified: true, image_url: 'https://img.shop.example/w.jpg' });
});

test('process and roast words on the bag need not be in the shop title', () => {
  const html = page('Guji – KaffeeKirsche', 'https://shop.example/guji.jpg');
  assert.equal(judgePage(html, 'https://shop.example/products/guji', 'Guji Natural Espresso', 'espresso').verified, true);
});

// --- Community URLs: what counts as verified, which links and images are kept ---

test('a matching URL path alone is not "verified"', () => {
  // Whoever picks the URL picks the path; the page itself says it is about another coffee.
  const html = page('Dreamteam Espresso', 'https://shop.example/d.jpg');
  assert.equal(judgePage(html, 'https://shop.example/products/aponte-espresso', 'Aponte Espresso', 'espresso').verified, false);
  // A page without any title of its own is never verified, whatever its path.
  assert.equal(judgePage('<html><body>hi</body></html>', 'https://evil.example/aponte-espresso', 'Aponte Espresso', null).verified, false);
});

test('the path still rules out the wrong roast', () => {
  const html = page('Aponte', 'https://shop.example/a.jpg');
  assert.equal(judgePage(html, 'https://shop.example/products/aponte-filter', 'Aponte', 'espresso').verified, false);
});

test('only https links to real domain names are safe', () => {
  for (const ok of ['https://thebarn.de/products/x', 'https://shop.example.com:443/a?b=c#d', 'https://xn--rststtte-r2a.de/']) {
    assert.equal(isSafeLink(ok), true, ok);
  }
  for (const bad of [
    'tel:+491234',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' https://thebarn.de/',
    'http://thebarn.de/',
    'intent://scan/#Intent;scheme=zxing;end',
    'mailto:a@b.de',
    'data:text/html,<script>',
    'file:///etc/passwd',
    'sms:123',
    'whatsapp://send?text=x',
    'https://user:pw@thebarn.de/',
    'https://thebarn.de@evil.example/',
    'https://127.0.0.1/',
    'https://localhost/',
    'https://[::1]/',
    'https://thebarn.de:8443/',
    'https://thebarn.de/a b',
    'https://thebarn.de/"onmouseover=',
    'https://thebarn.de\\@evil.example/',
    'https://thebarn.de/\nx',
    'https://thebarn.de/' + 'a'.repeat(2100),
    42,
    null,
  ]) {
    assert.equal(isSafeLink(bad), false, String(bad));
  }
});

test('site and sameSite', () => {
  assert.equal(site('https://shop.berliner-kaffeeroesterei.de/x'), 'berliner-kaffeeroesterei.de');
  assert.equal(site('https://a.b.co.uk/'), 'b.co.uk');
  assert.equal(sameSite('https://www.fathercarpenter.com/p', 'https://fathercarpenter.com/img.png'), true);
  assert.equal(sameSite('https://thebarn.de/', 'https://thebarn.de.evil.example/'), false);
});

test('foreign image hosts: only the shop itself or its shop system CDN', () => {
  const page = 'https://www.fiveelephant.com/products/x';
  assert.equal(trustedImage('https://www.fiveelephant.com/cdn/shop/a.png', page), 'https://www.fiveelephant.com/cdn/shop/a.png');
  assert.equal(trustedImage('https://cdn.shopify.com/s/files/a.png', page), 'https://cdn.shopify.com/s/files/a.png');
  assert.equal(trustedImage('https://tracker.example/pixel.gif', page), null);
  assert.equal(trustedImage('javascript:alert(1)', page), null);
  // The og:image of a page is judged against the page it came from.
  const html = `<html><head><title>Aponte</title><meta property="og:image" content="https://evil.example/a.jpg"></head></html>`;
  assert.equal(judgePage(html, 'https://shop.example/aponte', 'Aponte', null).image_url, null);
});

test('trusted shop: no marketplace, and the known roaster website when there is one', () => {
  assert.equal(trustedShop('https://www.amazon.de/dp/B0', null), false);
  assert.equal(trustedShop('https://www.ebay.de/itm/1', null), false);
  assert.equal(trustedShop('https://thebarn.de/products/a', 'https://thebarn.de/'), true);
  assert.equal(trustedShop('https://shop.thebarn.de/products/a', 'https://thebarn.de/'), true);
  assert.equal(trustedShop('https://thebarn-coffee.example/products/a', 'https://thebarn.de/'), false);
  assert.equal(trustedShop('https://new-roaster.example/a', null), true);
});
