// The small HTTP/1.1 reader used by the pinned transport (supabase/functions/_shared/http1.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readResponse, requestBytes } from '../supabase/functions/_shared/http1.ts';

/** A stream that delivers the given string in pieces of `size` bytes (to cross every boundary). */
const stream = (s: string, size = 3) => {
  const bytes = new TextEncoder().encode(s);
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= bytes.length) return c.close();
      c.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
};

test('the request names the host, asks for no compression and closes the connection', () => {
  const r = new TextDecoder().decode(requestBytes(new URL('https://shop.example.com/p/a?x=1'), { 'User-Agent': 'UA' }));
  assert.equal(r, 'GET /p/a?x=1 HTTP/1.1\r\nHost: shop.example.com\r\nUser-Agent: UA\r\nAccept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.5\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n');
  assert.throws(() => requestBytes(new URL('https://a.example/'), { X: 'a\r\nEvil: 1' }));
});

test('Content-Length body', async () => {
  const res = await readResponse(stream('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 5\r\n\r\nhelloEXTRA'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html');
  assert.equal(await res.text(), 'hello');
});

test('chunked body, also with chunk extensions', async () => {
  const res = await readResponse(stream('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4;x=y\r\nWiki\r\n6\r\npedia \r\n0\r\n\r\n'));
  assert.equal(await res.text(), 'Wikipedia ');
});

test('body until the connection closes', async () => {
  const res = await readResponse(stream('HTTP/1.0 200 OK\r\n\r\nall of it'));
  assert.equal(await res.text(), 'all of it');
});

test('redirect, 1xx before the answer, and empty statuses', async () => {
  const r = await readResponse(stream('HTTP/1.1 301 Moved\r\nLocation: /b\r\nContent-Length: 0\r\n\r\n'));
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/b');
  const e = await readResponse(stream('HTTP/1.1 103 Early Hints\r\nLink: </a.css>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok'));
  assert.equal(e.status, 200);
  assert.equal(await e.text(), 'ok');
  assert.equal((await readResponse(stream('HTTP/1.1 304 Not Modified\r\n\r\n'))).body, null);
});

test('broken answers are errors', async () => {
  await assert.rejects(readResponse(stream('SSH-2.0-OpenSSH\r\n\r\n')));
  await assert.rejects(readResponse(stream('HTTP/1.1 200 OK\r\nno colon\r\n\r\n')));
  await assert.rejects(readResponse(stream('HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n')));
  await assert.rejects(readResponse(stream('HTTP/1.1 200 OK\r\nX: ' + 'a'.repeat(40_000))));
  const short = await readResponse(stream('HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nabc'));
  await assert.rejects(short.text());
});

test('cancelling the body closes the connection', async () => {
  let closed = 0;
  const res = await readResponse(stream('HTTP/1.1 200 OK\r\n\r\n' + 'x'.repeat(1000)), () => closed++);
  await res.body!.cancel();
  assert.equal(closed, 1);
});
