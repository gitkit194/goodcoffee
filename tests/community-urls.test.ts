// Community URLs in enrich-bean: the real handler (tests/edge/harness.ts) never hands an unsafe link to
// the app, whatever the model answers. The rules themselves are tested in page.test.ts and
// supabase/tests/community_urls.test.sql.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadFunction, post, reset } from './edge/harness.ts';

const modelSays = (answer: object) => async (url: string) =>
  url.startsWith('https://api.openai.com/')
    ? new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }], usage: {} }))
    : new Response('not found', { status: 404 });

test('enrich-bean drops tel:, javascript:, IP and other unsafe product links from the model', async () => {
  const handle = await loadFunction('enrich-bean');
  for (const product_url of ['tel:+4930123', 'javascript:alert(1)', 'intent://x#Intent;end', 'http://shop.example/a', 'https://127.0.0.1/a', 'https://localhost/a']) {
    const s = reset(modelSays({ found: true, product_url, name: 'Aponte', confidence: 'high' }));
    const body = await (await handle(post({ name: 'Aponte' }))).json();
    assert.equal(body.result.product_url, null, product_url);
    assert.equal(body.result.found, false, product_url);
    assert.equal(body.verified, false);
    assert.equal(body.image_url, null);
    assert.deepEqual(s.fetches.filter((u) => !u.startsWith('https://api.openai.com/')), [], 'the unsafe link was not opened: ' + product_url);
  }
});
