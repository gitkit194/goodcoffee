// Lifecycle of the pinned transport (supabase/functions/_shared/pinned.ts) with a fake Deno.connect/startTls:
// a connection that only arrives after the deadline must be closed and never used for TLS or a request.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { safeFetch } from '../supabase/functions/_shared/net.ts';
import { pinnedTransport } from '../supabase/functions/_shared/pinned.ts';

type Log = { connect: number; tls: number; writes: number; closed: string[] };

function fakeConn(name: string, log: Log) {
  return {
    readable: new ReadableStream<Uint8Array>({ start() {} }), // never answers
    writable: new WritableStream<Uint8Array>({ write() { log.writes++; } }),
    close() { log.closed.push(name); },
  };
}

/** Installs a fake Deno whose connect and startTls resolve only when the test says so. */
function fakeDeno() {
  const log: Log = { connect: 0, tls: 0, writes: 0, closed: [] };
  let finishConnect: () => void = () => {};
  let finishTls: () => void = () => {};
  (globalThis as unknown as { Deno: unknown }).Deno = {
    connect() {
      log.connect++;
      return new Promise((r) => { finishConnect = () => r(fakeConn('tcp', log)); });
    },
    startTls() {
      log.tls++;
      return new Promise((r) => { finishTls = () => r(fakeConn('tls', log)); });
    },
  };
  return { log, connect: () => finishConnect(), tls: () => finishTls() };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('timeout while connect is pending, connect succeeds later: closed, no TLS, no request', async () => {
  const d = fakeDeno();
  const p = safeFetch('https://shop.example.com/', { resolve: async () => ['93.184.215.14'], transport: pinnedTransport(), timeoutMs: 10 });
  await assert.rejects(p);
  d.connect();
  await tick(5);
  assert.equal(d.log.connect, 1);
  assert.equal(d.log.tls, 0);
  assert.equal(d.log.writes, 0);
  assert.deepEqual(d.log.closed, ['tcp']);
});

test('timeout while the TLS handshake is pending: TCP closed, late TLS connection closed, no request', async () => {
  const d = fakeDeno();
  const ac = new AbortController();
  const p = pinnedTransport()(new URL('https://shop.example.com/'), ['93.184.215.14'], { signal: ac.signal });
  d.connect();
  await tick();
  assert.equal(d.log.tls, 1);
  ac.abort(new Error('timeout'));
  await assert.rejects(p, /timeout/);
  d.tls();
  await tick(5);
  assert.equal(d.log.writes, 0);
  assert.deepEqual(d.log.closed.sort(), ['tcp', 'tls']);
});

test('already aborted signal: no connect at all', async () => {
  const d = fakeDeno();
  const ac = new AbortController();
  ac.abort(new Error('timeout'));
  await assert.rejects(pinnedTransport()(new URL('https://shop.example.com/'), ['93.184.215.14'], { signal: ac.signal }), /timeout/);
  assert.equal(d.log.connect, 0);
});
