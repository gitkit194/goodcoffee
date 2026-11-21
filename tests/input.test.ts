// Input limits for scan-bag and enrich-bean (supabase/functions/_shared/input.ts), plus the real
// handlers loaded with fakes (tests/edge/harness.ts): a bad or oversized request must be answered
// before the daily limit is claimed and before OpenAI is called.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LIMITS, parseEnrich, parseScan, readJson, TIMEOUTS } from '../supabase/functions/_shared/input.ts';
import { loadFunction, post, reset } from './edge/harness.ts';

const MODELS = ['gpt-6.1-terra', 'gpt-6-luna'];
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDAoQ';

test('enrich: a normal scan passes and unknown keys are dropped', () => {
  const r = parseEnrich({ name: ' Aponte Espresso ', roaster: 'KaffeeKirsche', roast_for: 'espresso', notes: ['Kirsche', ' '], extra: 'x' });
  assert.deepEqual(r, { ok: true, value: { name: 'Aponte Espresso', roaster: 'KaffeeKirsche', origin_country: null, process: null, roast_for: 'espresso', notes: ['Kirsche'] } });
});

test('enrich: wrong types, too long fields and odd values are refused', () => {
  const bad: Record<string, unknown>[] = [
    {},
    { name: '' },
    { name: 42 },
    { name: { $gt: '' } },
    { name: 'x'.repeat(LIMITS.name + 1) },
    { name: 'A', roaster: 'x'.repeat(LIMITS.field + 1) },
    { name: 'A', roaster: ['a'] },
    { name: 'A', roast_for: 'cold brew' },
    { name: 'A', notes: 'Kirsche' },
    { name: 'A', notes: Array(LIMITS.notes + 1).fill('n') },
    { name: 'A', notes: ['x'.repeat(LIMITS.note + 1)] },
    { name: 'A', notes: [1] },
    { name: 'A\u0000B' },
  ];
  for (const b of bad) assert.equal(parseEnrich(b).ok, false, JSON.stringify(b).slice(0, 80));
});

test('scan: a base64 JPEG or an https image URL passes', () => {
  assert.deepEqual(parseScan({ image: JPEG }, MODELS), { ok: true, value: { image: 'data:image/jpeg;base64,' + JPEG, model: null } });
  assert.deepEqual(parseScan({ image_url: 'https://shop.example/a.png', model: 'gpt-6-luna' }, MODELS), { ok: true, value: { image: 'https://shop.example/a.png', model: 'gpt-6-luna' } });
});

test('scan: missing, oversized, non-JPEG or foreign images and unknown models are refused', () => {
  const bad: Record<string, unknown>[] = [
    {},
    { image: JPEG, image_url: 'https://shop.example/a.png' },
    { image: 123 },
    { image: 'not base64!' },
    { image: 'iVBORw0KGgoAAAANSUhEUgAA' }, // PNG
    { image: '/9j/' + 'A'.repeat(LIMITS.imageBase64Chars) },
    { image: JPEG + 'A' }, // broken padding
    { image_url: 'http://shop.example/a.png' },
    { image_url: 'file:///etc/passwd' },
    { image_url: 'javascript:alert(1)' },
    { image_url: 'https://u:p@shop.example/a.png' },
    { image_url: 'https://shop.example/' + 'a'.repeat(LIMITS.url) },
    { image: JPEG, model: 'gpt-7-ultra' },
    { image: JPEG, model: ['gpt-6-luna'] },
  ];
  for (const b of bad) assert.equal(parseScan(b, MODELS).ok, false, JSON.stringify(b).slice(0, 80));
});

const req = (body: BodyInit, headers: Record<string, string> = {}) => new Request('https://fn.example/', { method: 'POST', body, headers });

test('readJson: a body over the limit is refused while reading, even without Content-Length', async () => {
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled++;
      c.enqueue(new Uint8Array(64 * 1024).fill(0x20));
    },
  });
  const r = await readJson(new Request('https://fn.example/', { method: 'POST', body: endless, duplex: 'half' } as RequestInit), 256 * 1024);
  assert.deepEqual(r, { ok: false, error: 'too_large', status: 413 });
  assert.ok(pulled <= 6, 'stopped after the limit: ' + pulled);
});

test('readJson: a declared Content-Length over the limit is refused before reading', async () => {
  const r = await readJson(req('{}', { 'content-length': String(10 * 1024 * 1024) }), 1024);
  assert.deepEqual(r, { ok: false, error: 'too_large', status: 413 });
});

test('readJson: only a JSON object is accepted', async () => {
  for (const body of ['', 'nope', '[1,2]', '"x"', 'null', '{"a":']) {
    assert.equal((await readJson(req(body), 1024)).ok, false, body);
  }
  assert.deepEqual(await readJson(req('{"a":1}'), 1024), { ok: true, value: { a: 1 } });
});

// --- The real handlers, loaded with fakes ---

const openai = (text: string) => async (url: string) =>
  url.startsWith('https://api.openai.com/')
    ? new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 1, output_tokens: 1 } }))
    : new Response('not found', { status: 404 });

test('scan-bag refuses bad and oversized requests before claiming the limit or calling OpenAI', async () => {
  const handle = await loadFunction('scan-bag');
  const cases: [Request, number][] = [
    [post('not json'), 400],
    [post({}), 400],
    [post({ image: 'iVBORw0KGgo=' }), 400],
    [post({ image: JPEG, model: 'gpt-7-ultra' }), 400],
    [post({ image_url: 'http://169.254.169.254/' }), 400],
    [post({ image: '/9j/' + 'A'.repeat(LIMITS.scanBodyBytes) }), 413],
  ];
  for (const [r, status] of cases) {
    const s = reset(openai('{}'));
    const res = await handle(r);
    assert.equal(res.status, status);
    assert.deepEqual(s.rpc, [], 'no claim_ai_call');
    assert.deepEqual(s.fetches, [], 'no OpenAI call');
  }
});

test('scan-bag still works for a normal photo', async () => {
  const handle = await loadFunction('scan-bag');
  const s = reset(openai('{"is_coffee_bag": true}'));
  const res = await handle(post({ image: JPEG }));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).result, { is_coffee_bag: true });
  assert.deepEqual(s.rpc.map((c) => c.name), ['claim_ai_call', 'finish_ai_call']);
});

const hanging = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)));

for (const name of ['scan-bag', 'enrich-bean'] as const) {
  test(name + ' gives up on a hanging OpenAI call, answers 504 and logs it', async () => {
    const handle = await loadFunction(name);
    const key = name === 'scan-bag' ? 'scan' : 'enrich';
    const before = TIMEOUTS[key];
    TIMEOUTS[key] = 150;
    // Node does not wait for AbortSignal.timeout on its own (Deno.serve keeps the edge runtime alive).
    const keepAlive = setInterval(() => {}, 1000);
    try {
      const s = reset(hanging);
      const res = await handle(post(name === 'scan-bag' ? { image: JPEG } : { name: 'Aponte' }));
      assert.equal(res.status, 504);
      assert.deepEqual(s.rpc.map((c) => c.name), ['claim_ai_call', 'finish_ai_call']);
      assert.equal((s.rpc[1].args as { p_error: string }).p_error, 'timeout');
    } finally {
      clearInterval(keepAlive);
      TIMEOUTS[key] = before;
    }
  });
}

// OpenAI answers 200 with headers right away, then the body stalls: the deadline must still count as a timeout.
const stallsAfterHeaders = (_url: string, init?: RequestInit) => {
  const signal = init!.signal!;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('{'));
      signal.addEventListener('abort', () => c.error(signal.reason));
    },
  });
  return Promise.resolve(new Response(body, { status: 200 }));
};

for (const name of ['scan-bag', 'enrich-bean'] as const) {
  test(name + ' counts a stall while reading the OpenAI answer as timeout (504, logged)', async () => {
    const handle = await loadFunction(name);
    const key = name === 'scan-bag' ? 'scan' : 'enrich';
    const before = TIMEOUTS[key];
    TIMEOUTS[key] = 30;
    const keepAlive = setInterval(() => {}, 1000);
    try {
      const s = reset(stallsAfterHeaders);
      const res = await handle(post(name === 'scan-bag' ? { image: JPEG } : { name: 'Aponte' }));
      assert.equal(res.status, 504);
      const finish = s.rpc[1].args as { p_error: string; p_ms: number };
      assert.equal(finish.p_error, 'timeout');
      assert.ok(finish.p_ms >= 25, 'time includes the body read: ' + finish.p_ms);
    } finally {
      clearInterval(keepAlive);
      TIMEOUTS[key] = before;
    }
  });
}

test('enrich-bean refuses bad and oversized requests before claiming the limit or calling OpenAI', async () => {
  const handle = await loadFunction('enrich-bean');
  const cases: [Request, number][] = [
    [post('nope'), 400],
    [post({ roaster: 'X' }), 400],
    [post({ name: 'A', notes: Array(100).fill('x') }), 400],
    [post({ name: 'x'.repeat(5000) }), 400],
    [post({ name: 'A', pad: 'x'.repeat(LIMITS.enrichBodyBytes) }), 413],
  ];
  for (const [r, status] of cases) {
    const s = reset(openai('{}'));
    const res = await handle(r);
    assert.equal(res.status, status);
    assert.deepEqual(s.rpc, [], 'no claim_ai_call');
    assert.deepEqual(s.fetches, [], 'no OpenAI call');
  }
});
