// Strict DNS lookup for the SSRF guard (supabase/functions/_shared/dns.ts): only a clear "no record"
// is tolerated; any other failure of either family stops the fetch.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bothFamilies, dohLookup, makeResolver } from '../supabase/functions/_shared/dns.ts';
import { safeFetch, type Transport } from '../supabase/functions/_shared/net.ts';

const err = (name: string) => Object.assign(new Error(name), { name });
type Answer = string[] | Error;
/** A fake Deno.resolveDns with one answer (or error) per record type. */
const fakeDeno = (a: Answer, aaaa: Answer) => ({
  resolveDns: async (_h: string, type: 'A' | 'AAAA') => {
    const r = type === 'A' ? a : aaaa;
    if (r instanceof Error) throw r;
    return r;
  },
});
/** A fake DoH: per type the JSON status and answers; counts calls. */
function fakeDoh(byType: Record<string, { Status: number; Answer?: { type: number; data: string }[] }>) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    const type = new URL(url).searchParams.get('type')!;
    calls.push(type);
    return new Response(JSON.stringify(byType[type]));
  }) as unknown as typeof fetch;
  return { lookup: dohLookup(f), calls };
}
const dohFails = fakeDoh({ A: { Status: 2 }, AAAA: { Status: 2 } }); // SERVFAIL

test('public A plus a failed AAAA lookup is not a complete answer, and nothing is fetched', async () => {
  for (const failure of [err('TimedOut'), err('PermissionDenied'), err('ConnectionRefused'), new Error('SERVFAIL')]) {
    const resolve = makeResolver(fakeDeno(['93.184.215.14'], failure), dohFails.lookup);
    let requests = 0;
    const transport: Transport = async () => {
      requests++;
      return new Response('');
    };
    await assert.rejects(safeFetch('https://shop.example.com/', { resolve, transport }), /blocked url: dns/);
    assert.equal(requests, 0, failure.name);
  }
});

test('when the native lookup is incomplete, DoH must answer both families', async () => {
  const doh = fakeDoh({ A: { Status: 0, Answer: [{ type: 1, data: '93.184.215.14' }] }, AAAA: { Status: 0, Answer: [{ type: 5, data: 'x.example.' }, { type: 28, data: 'fd00::1' }] } });
  const resolve = makeResolver(fakeDeno(['93.184.215.14'], err('TimedOut')), doh.lookup);
  // DoH reveals the private AAAA the native lookup missed; the guard then blocks it.
  assert.deepEqual(await resolve('shop.example.com'), ['93.184.215.14', 'fd00::1']);
  assert.deepEqual(doh.calls, ['A', 'AAAA']);
});

test('"no record" for one family is fine', async () => {
  const resolve = makeResolver(fakeDeno(['93.184.215.14'], err('NotFound')), dohFails.lookup);
  assert.deepEqual(await resolve('shop.example.com'), ['93.184.215.14']);
});

test('DoH: SERVFAIL, HTTP errors and truncated answers fail; NXDOMAIN counts as no record', async () => {
  for (const status of [2, 5]) {
    const { lookup } = fakeDoh({ A: { Status: status }, AAAA: { Status: 0 } });
    await assert.rejects(bothFamilies('shop.example.com', lookup));
  }
  const http500 = dohLookup((async () => new Response('', { status: 500 })) as unknown as typeof fetch);
  await assert.rejects(bothFamilies('shop.example.com', http500));
  const tc = dohLookup((async () => new Response(JSON.stringify({ Status: 0, TC: true, Answer: [] }))) as unknown as typeof fetch);
  await assert.rejects(bothFamilies('shop.example.com', tc));
  const { lookup } = fakeDoh({ A: { Status: 3 }, AAAA: { Status: 3 } });
  assert.deepEqual(await bothFamilies('gone.example.com', lookup), []);
});

test('without Deno.resolveDns the resolver uses DoH for both families', async () => {
  const doh = fakeDoh({ A: { Status: 0, Answer: [{ type: 1, data: '93.184.215.14' }] }, AAAA: { Status: 0, Answer: [] } });
  assert.deepEqual(await makeResolver(undefined, doh.lookup)('shop.example.com'), ['93.184.215.14']);
});
