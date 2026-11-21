// SSRF guard for shop fetches (supabase/functions/_shared/net.ts). DNS and transport are fakes, so nothing
// leaves the machine: the tests check that a blocked URL never reaches the transport at all, and that
// the transport only ever gets addresses that were checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BlockedUrl, checkUrl, isPublicAddress, readCapped, safeFetch, type Resolver, type Transport } from '../supabase/functions/_shared/net.ts';

const DNS: Record<string, string[]> = {
  'shop.example.com': ['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
  'cdn.shop.example.com': ['151.101.1.1'],
  'evil.example.com': ['127.0.0.1'],
  'intranet.example.com': ['10.0.0.5'],
  'mixed.example.com': ['93.184.215.14', '192.168.1.1'],
  'v6local.example.com': ['fd00::1'],
  'metadata.example.com': ['169.254.169.254'],
};
const resolve: Resolver = async (host) => {
  if (!(host in DNS)) throw new Error('NXDOMAIN');
  return DNS[host];
};

type Route = { status?: number; location?: string; body?: string; type?: string };
/** A fake transport that serves `routes`, records which URLs were requested and checks the addresses it got. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const f: Transport = async (u, addresses) => {
    const url = u.href;
    calls.push(url);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    assert.deepEqual(addresses, DNS[host] ?? [host], 'the transport gets exactly the checked addresses');
    assert.ok(addresses.every(isPublicAddress));
    const r = routes[url];
    if (!r) return new Response('not found', { status: 404 });
    const headers: Record<string, string> = { 'content-type': r.type ?? 'text/html; charset=utf-8' };
    if (r.location) headers.location = r.location;
    return new Response(r.body ?? '', { status: r.status ?? 200, headers });
  };
  return { f, calls };
}

async function blocked(url: string, routes: Record<string, Route> = {}) {
  const { f, calls } = fakeFetch(routes);
  await assert.rejects(safeFetch(url, { resolve, transport: f }), BlockedUrl, url);
  return calls;
}

test('loopback is blocked: names, IPv4 in every spelling, IPv6', async () => {
  for (const url of [
    'https://localhost/',
    'https://foo.localhost/',
    'https://127.0.0.1/',
    'https://127.1.2.3/',
    'https://2130706433/', // 127.0.0.1 as a number
    'https://0x7f.0.0.1/',
    'https://0177.0.0.1/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://0.0.0.0/',
    'https://[::]/',
  ]) {
    assert.deepEqual(await blocked(url), [], url + ' must not be fetched');
  }
});

test('private and special IPv4 ranges are blocked', async () => {
  for (const url of [
    'https://10.0.0.1/',
    'https://172.16.0.1/',
    'https://172.31.255.255/',
    'https://192.168.0.10/',
    'https://169.254.169.254/latest/meta-data/',
    'https://100.64.0.1/',
    'https://198.18.0.1/',
    'https://224.0.0.1/',
    'https://255.255.255.255/',
  ]) {
    assert.deepEqual(await blocked(url), [], url);
  }
});

test('private and special IPv6 ranges are blocked', async () => {
  for (const url of [
    'https://[fc00::1]/',
    'https://[fd12:3456::1]/',
    'https://[fe80::1]/',
    'https://[ff02::1]/',
    'https://[64:ff9b::a00:1]/', // NAT64 of 10.0.0.1
    'https://[2002:a00:1::]/', // 6to4 of 10.0.0.1
    'https://[2001:db8::1]/',
    'https://[::ffff:10.0.0.1]/',
    'https://[::ffff:192.168.1.1]/',
  ]) {
    assert.deepEqual(await blocked(url), [], url);
  }
});

test('a public name that resolves to a private or local address is blocked', async () => {
  for (const host of ['evil.example.com', 'intranet.example.com', 'mixed.example.com', 'v6local.example.com', 'metadata.example.com']) {
    assert.deepEqual(await blocked(`https://${host}/products/x`), [], host);
  }
  assert.deepEqual(await blocked('https://does-not-resolve.example.com/'), [], 'no DNS answer → not fetched');
});

test('scheme, port, credentials and local names are blocked', async () => {
  for (const url of [
    'http://shop.example.com/',
    'ftp://shop.example.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://shop.example.com:8443/',
    'https://user:pw@shop.example.com/',
    'https://router/',
    'https://printer.local/',
    'https://db.internal/',
    'https://nas.home.arpa/',
    'not a url',
    'https://shop.example.com/' + 'a'.repeat(3000),
  ]) {
    assert.deepEqual(await blocked(url), [], url);
  }
});

test('a redirect to an internal address is blocked before it is followed', async () => {
  const routes = {
    'https://shop.example.com/a': { status: 302, location: 'https://127.0.0.1/admin' },
    'https://shop.example.com/b': { status: 301, location: 'https://169.254.169.254/latest/meta-data/' },
    'https://shop.example.com/c': { status: 307, location: 'https://intranet.example.com/' },
    'https://shop.example.com/d': { status: 302, location: 'http://shop.example.com/plain' },
    'https://shop.example.com/e': { status: 308, location: 'https://[::1]/' },
  };
  for (const start of Object.keys(routes)) {
    const calls = await blocked(start, routes);
    assert.deepEqual(calls, [start], 'only the first hop was requested for ' + start);
  }
});

test('endless redirects stop', async () => {
  const routes = {
    'https://shop.example.com/1': { status: 302, location: '/2' },
    'https://shop.example.com/2': { status: 302, location: '/3' },
    'https://shop.example.com/3': { status: 302, location: '/4' },
    'https://shop.example.com/4': { status: 302, location: '/5' },
    'https://shop.example.com/5': { status: 302, location: '/1' },
  };
  assert.equal((await blocked('https://shop.example.com/1', routes)).length, 4);
});

test('a normal shop page still works, also behind a redirect to another public host', async () => {
  const { f, calls } = fakeFetch({
    'https://shop.example.com/products/aponte': { status: 301, location: 'https://cdn.shop.example.com/products/aponte-espresso' },
    'https://cdn.shop.example.com/products/aponte-espresso': { body: '<title>Aponte Espresso</title>' },
  });
  const r = await safeFetch('https://shop.example.com/products/aponte', { resolve, transport: f });
  assert.deepEqual(r, { url: 'https://cdn.shop.example.com/products/aponte-espresso', status: 200, ok: true, html: '<title>Aponte Espresso</title>', truncated: false });
  assert.equal(calls.length, 2);
});

test('a public IP literal and the default port are allowed', () => {
  assert.equal(checkUrl('https://93.184.215.14/x').hostname, '93.184.215.14');
  assert.equal(checkUrl('https://shop.example.com:443/x').hostname, 'shop.example.com');
  assert.equal(isPublicAddress('2606:4700::1111'), true);
  assert.equal(isPublicAddress('8.8.8.8'), true);
});

test('non-HTML answers and errors are not read', async () => {
  const { f } = fakeFetch({
    'https://shop.example.com/img': { body: 'GIF89a', type: 'image/gif' },
    'https://shop.example.com/gone': { status: 500, body: 'oops' },
  });
  assert.equal((await safeFetch('https://shop.example.com/img', { resolve, transport: f })).ok, false);
  assert.equal((await safeFetch('https://shop.example.com/gone', { resolve, transport: f })).ok, false);
});

/** A body that never ends; counts how many chunks were pulled from it. */
function endless(chunk = 64 * 1024) {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled++;
      c.enqueue(new Uint8Array(chunk).fill(0x61));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, stats: () => ({ pulled, cancelled }) };
}

test('a huge page is cut off during the download, not after it', async () => {
  const { body, stats } = endless();
  const f: Transport = async () => new Response(body, { headers: { 'content-type': 'text/html' } });
  const r = await safeFetch('https://shop.example.com/huge', { resolve, transport: f, maxBytes: 600_000 });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.html.length, 600_000);
  assert.ok(stats().pulled <= 12, 'read about 600 kB, not more: ' + stats().pulled + ' chunks');
  assert.equal(stats().cancelled, true, 'the download was cancelled');
});

test('readCapped returns a small body whole', async () => {
  const r = await readCapped(new Response('hello'), 5);
  assert.deepEqual(r, { text: 'hello', truncated: false });
  const r2 = await readCapped(new Response('hello!'), 5);
  assert.deepEqual(r2, { text: 'hello', truncated: true });
});

test('a server that never answers is given up after the timeout', async () => {
  const f: Transport = (_url, _a, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const started = Date.now();
  await assert.rejects(safeFetch('https://shop.example.com/slow', { resolve, transport: f, timeoutMs: 200 }), (e: Error) => e.name === 'TimeoutError');
  assert.ok(Date.now() - started < 2000);
});

test('a page that stalls mid-download is given up after the timeout', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('<html>'));
    },
  });
  const f: Transport = async () => new Response(body, { headers: { 'content-type': 'text/html' } });
  await assert.rejects(safeFetch('https://shop.example.com/stall', { resolve, transport: f, timeoutMs: 200 }), (e: Error) => e.name === 'TimeoutError');
});

test('a DNS lookup that hangs is given up after the timeout', async () => {
  const hang: Resolver = () => new Promise(() => {});
  const { f, calls } = fakeFetch({});
  await assert.rejects(safeFetch('https://shop.example.com/', { resolve: hang, transport: f, timeoutMs: 200 }), (e: Error) => e.name === 'TimeoutError');
  assert.deepEqual(calls, []);
});

test('each hop resolves the name once and the transport connects to exactly those addresses', async () => {
  // A name that answers public first and private afterwards (DNS rebinding) cannot reach the private
  // address: the transport never resolves on its own, it only gets the checked answer.
  let lookups = 0;
  const rebinding: Resolver = async () => (lookups++ === 0 ? ['93.184.215.14'] : ['127.0.0.1']);
  const seen: string[][] = [];
  const t: Transport = async (_u, addresses) => {
    seen.push(addresses);
    return new Response('<title>ok</title>', { headers: { 'content-type': 'text/html' } });
  };
  const r = await safeFetch('https://rebind.example.com/p', { resolve: rebinding, transport: t });
  assert.equal(r.ok, true);
  assert.equal(lookups, 1);
  assert.deepEqual(seen, [['93.184.215.14']]);
});

test('an IP literal goes to the transport as that address, without brackets for IPv6', async () => {
  const seen: string[][] = [];
  const t: Transport = async (_u, addresses) => {
    seen.push(addresses);
    return new Response('', { headers: { 'content-type': 'text/html' } });
  };
  await safeFetch('https://93.184.215.14/', { resolve, transport: t });
  await safeFetch('https://[2606:4700::1111]/', { resolve, transport: t });
  assert.deepEqual(seen, [['93.184.215.14'], ['2606:4700::1111']]);
});
