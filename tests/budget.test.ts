// AI call limits in the edge functions: the claim goes through claim_ai_call with the service role and
// the verified user id; a refused claim never reaches OpenAI. The limits themselves are tested in
// supabase/tests/ai_budget.test.sql and in the parallel test of scripts/test-db.sh.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ENV, loadFunction, post, reset } from './edge/harness.ts';

const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDAoQ';
const ok = (text: string) => async (url: string) =>
  url.startsWith('https://api.openai.com/')
    ? new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 7, output_tokens: 3 } }))
    : new Response('', { status: 404 });

for (const [name, kind, body] of [
  ['scan-bag', 'scan', { image: JPEG }],
  ['enrich-bean', 'enrich', { name: 'Aponte' }],
] as const) {
  test(`${name}: claims with the verified user and kind, and logs the outcome through finish_ai_call`, async () => {
    const handle = await loadFunction(name);
    const s = reset(ok('{"found": false}'));
    s.user = { id: 'user-42' };
    assert.equal((await handle(post(body))).status, 200);
    assert.deepEqual(s.rpc.map((c) => c.name), ['claim_ai_call', 'finish_ai_call']);
    const claim = s.rpc[0].args as { p_user: string; p_kind: string; p_model: string };
    assert.equal(claim.p_user, 'user-42');
    assert.equal(claim.p_kind, kind);
    assert.deepEqual(s.rpc[1].args, { p_id: 1, p_ok: true, p_ms: (s.rpc[1].args as { p_ms: number }).p_ms, p_input_tokens: 7, p_output_tokens: 3, p_error: null });
  });

  for (const refused of ['day', 'minute', 'budget']) {
    test(`${name}: a refused claim (${refused}) answers 429 and never calls OpenAI`, async () => {
      const handle = await loadFunction(name);
      const s = reset(ok('{}'));
      s.claim = { id: null, refused };
      const res = await handle(post(body));
      assert.equal(res.status, 429);
      assert.deepEqual(await res.json(), { error: 'limit', limit: refused });
      assert.deepEqual(s.fetches, []);
    });
  }

  test(`${name}: without the service key nothing is claimed or called`, async () => {
    const handle = await loadFunction(name);
    const s = reset(ok('{}'));
    const key = ENV.SUPABASE_SERVICE_ROLE_KEY;
    delete ENV.SUPABASE_SERVICE_ROLE_KEY;
    try {
      assert.equal((await handle(post(body))).status, 503);
      assert.deepEqual(s.rpc, []);
      assert.deepEqual(s.fetches, []);
    } finally {
      ENV.SUPABASE_SERVICE_ROLE_KEY = key;
    }
  });
}
