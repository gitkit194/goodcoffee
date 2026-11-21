// Runs in Deno (not part of `npm test`): npm run test:deno, which first creates the test certificates
// (scripts/make-test-certs.sh) and then runs deno test --allow-net --allow-read tests/pinned.deno.ts
// The pinned transport against a real local TLS server with a test certificate for "shop.test":
// it connects to the address it is given, never resolves the name, and still checks the certificate
// against the original host name.
import { pinnedTransport } from '../supabase/functions/_shared/pinned.ts';
import { safeFetch } from '../supabase/functions/_shared/net.ts';

const cert = await Deno.readTextFile(new URL('./fixtures/shop.test.crt', import.meta.url));
const key = await Deno.readTextFile(new URL('./fixtures/shop.test.key', import.meta.url));
// Test-only CA that signed shop.test.crt; the transport trusts it in place of the public roots.
const ca = await Deno.readTextFile(new URL('./fixtures/test-ca.crt', import.meta.url));

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error('FAILED: ' + msg);
}

async function withServer(fn: (port: number) => Promise<void>) {
  const ac = new AbortController();
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, cert, key, signal: ac.signal, onListen() {} }, (req) => {
    const u = new URL(req.url);
    if (u.pathname === '/redirect') return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/admin' } });
    if (u.pathname === '/chunked') {
      const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('<title>Aponte')); c.enqueue(new TextEncoder().encode(' Espresso</title>')); c.close(); } });
      return new Response(body, { headers: { 'content-type': 'text/html' } });
    }
    return new Response(`<title>host=${req.headers.get('host')} path=${u.pathname}</title>`, { headers: { 'content-type': 'text/html' } });
  });
  try {
    await fn(server.addr.port);
  } finally {
    ac.abort();
    await server.finished;
  }
}

Deno.test('connects to the given address, sends the original host, checks the certificate', async () => {
  await withServer(async (port) => {
    const t = pinnedTransport({ caCerts: [ca], port });
    const res = await t(new URL('https://shop.test/p/a'), ['127.0.0.1'], { signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    assert(res.status === 200, 'status ' + res.status);
    assert(text.includes('host=shop.test') && text.includes('path=/p/a'), text);
    const chunked = await (await t(new URL('https://shop.test/chunked'), ['127.0.0.1'], { signal: AbortSignal.timeout(5000) })).text();
    assert(chunked === '<title>Aponte Espresso</title>', chunked);
  });
});

Deno.test('a certificate for another name is refused', async () => {
  await withServer(async (port) => {
    const t = pinnedTransport({ caCerts: [ca], port });
    let failed = false;
    try {
      await t(new URL('https://other.test/'), ['127.0.0.1'], { signal: AbortSignal.timeout(5000) });
    } catch {
      failed = true;
    }
    assert(failed, 'TLS must fail for a name the certificate does not cover');
  });
});

Deno.test('the transport never resolves the name: an unresolvable name still reaches the given address', async () => {
  await withServer(async (port) => {
    const t = pinnedTransport({ caCerts: [ca], port });
    // "shop.test" has no DNS entry at all; the connection works only because the checked address is used.
    const res = await t(new URL('https://shop.test/x'), ['127.0.0.1'], { signal: AbortSignal.timeout(5000) });
    assert(res.status === 200, 'status');
    await res.body?.cancel();
  });
});

Deno.test('safeFetch with the pinned transport: a redirect to an internal address is not followed', async () => {
  await withServer(async (port) => {
    let blocked = false;
    try {
      // The resolver says "public"; the transport is pinned to the local test server standing in for it.
      await safeFetch('https://shop.test/redirect', {
        resolve: async () => ['93.184.215.14'],
        transport: (u, _a, init) => pinnedTransport({ caCerts: [ca], port })(u, ['127.0.0.1'], init),
      });
    } catch (e) {
      blocked = (e as Error).message === 'blocked url: address';
    }
    assert(blocked, 'redirect to 127.0.0.1 blocked');
  });
});

Deno.test('the timeout closes a connection that never answers', async () => {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const conns: Deno.Conn[] = [];
  (async () => { for await (const c of listener) conns.push(c); })().catch(() => {});
  const t = pinnedTransport({ caCerts: [ca], port: (listener.addr as Deno.NetAddr).port });
  const started = Date.now();
  let failed = false;
  try {
    await t(new URL('https://shop.test/'), ['127.0.0.1'], { signal: AbortSignal.timeout(300) });
  } catch {
    failed = true;
  }
  assert(failed && Date.now() - started < 3000, 'gave up in time');
  conns.forEach((c) => c.close());
  listener.close();
});
