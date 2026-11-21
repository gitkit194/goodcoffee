// Minimal HTTP/1.1 client side over an already open byte stream: writes one GET request and turns the
// answer into a Response with a streaming body. Used by pinned.ts, which opens the TLS connection to an
// address net.ts has checked, so the request can never go to an address nobody checked.
// Plain TypeScript without Deno APIs, so tests can run it in Node.

const enc = new TextEncoder();
const dec = new TextDecoder();
const MAX_HEAD = 32 * 1024;

/** The request bytes. Header values must not contain line breaks (they come from us, but check anyway). */
export function requestBytes(url: URL, headers: Record<string, string> = {}): Uint8Array {
  const all: Record<string, string> = {
    Host: url.host,
    'User-Agent': 'GoodCoffee',
    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    'Accept-Encoding': 'identity',
    ...headers,
    Connection: 'close',
  };
  let head = `GET ${url.pathname}${url.search} HTTP/1.1\r\n`;
  for (const [k, v] of Object.entries(all)) {
    if (/[\r\n]/.test(k + v)) throw new Error('header with line break');
    head += `${k}: ${v}\r\n`;
  }
  return enc.encode(head + '\r\n');
}

/** Pulls bytes from a reader, with one buffer of what was read but not used yet. */
class Bytes {
  private buf = new Uint8Array(0);
  private done = false;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
  }

  private async more(): Promise<boolean> {
    if (this.done) return false;
    const { done, value } = await this.reader.read();
    if (done) {
      this.done = true;
      return false;
    }
    const next = new Uint8Array(this.buf.length + value.length);
    next.set(this.buf);
    next.set(value, this.buf.length);
    this.buf = next;
    return true;
  }

  /** Everything up to and including the first CRLFCRLF (or CRLF), at most max bytes. */
  async until(marker: string, max: number): Promise<Uint8Array> {
    const m = enc.encode(marker);
    for (;;) {
      const at = indexOf(this.buf, m);
      if (at >= 0) return this.take(at + m.length);
      if (this.buf.length > max) throw new Error('http: head too large');
      if (!(await this.more())) throw new Error('http: connection closed early');
    }
  }

  /** Exactly n bytes. */
  async exactly(n: number): Promise<Uint8Array> {
    while (this.buf.length < n) if (!(await this.more())) throw new Error('http: body cut short');
    return this.take(n);
  }

  /** Whatever comes next (from the buffer first), or null at the end. */
  async some(max: number): Promise<Uint8Array | null> {
    if (!this.buf.length && !(await this.more())) return null;
    return this.take(Math.min(max, this.buf.length));
  }

  private take(n: number) {
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }

  cancel() {
    return this.reader.cancel().catch(() => {});
  }
}

function indexOf(hay: Uint8Array, needle: Uint8Array) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Reads status line and headers from `stream` and returns a Response whose body streams the rest. */
export async function readResponse(stream: ReadableStream<Uint8Array>, done: () => void = () => {}): Promise<Response> {
  let called = false;
  const onDone = () => {
    if (!called) {
      called = true;
      done();
    }
  };
  const bytes = new Bytes(stream.getReader());
  let status = 0;
  let headers: Headers;
  // 1xx answers (100 Continue, 103 Early Hints) come before the real one.
  do {
    const head = dec.decode(await bytes.until('\r\n\r\n', MAX_HEAD)).split('\r\n');
    const m = head[0].match(/^HTTP\/1\.[01] (\d{3})/);
    if (!m) throw new Error('http: bad status line');
    status = Number(m[1]);
    headers = new Headers();
    for (const line of head.slice(1)) {
      if (!line) continue;
      const i = line.indexOf(':');
      if (i <= 0) throw new Error('http: bad header');
      headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }
  } while (status < 200);

  const chunked = /(^|,)\s*chunked\s*$/i.test(headers.get('transfer-encoding') ?? '');
  const length = headers.get('content-length');
  if (!chunked && length !== null && !/^\d+$/.test(length)) throw new Error('http: bad content-length');
  let left = chunked || length === null ? Infinity : Number(length);
  let chunkLeft = 0;
  let finished = false;

  const finish = async (c: ReadableStreamDefaultController<Uint8Array>) => {
    finished = true;
    c.close();
    await bytes.cancel();
    onDone();
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        if (finished) return;
        if (chunked) {
          if (chunkLeft === 0) {
            const line = dec.decode(await bytes.until('\r\n', 1024)).trim();
            const size = parseInt(line.split(';')[0], 16);
            if (!Number.isFinite(size) || size < 0) throw new Error('http: bad chunk');
            if (size === 0) return finish(c);
            chunkLeft = size;
          }
          const part = await bytes.exactly(Math.min(chunkLeft, 64 * 1024));
          chunkLeft -= part.length;
          if (chunkLeft === 0) await bytes.exactly(2); // CRLF after the chunk
          c.enqueue(part);
          return;
        }
        if (left === 0) return finish(c);
        const part = await bytes.some(Math.min(left, 64 * 1024));
        if (!part) {
          if (left !== Infinity) throw new Error('http: body cut short');
          return finish(c);
        }
        left -= part.length;
        c.enqueue(part);
      } catch (e) {
        finished = true;
        c.error(e);
        await bytes.cancel();
        onDone();
      }
    },
    async cancel() {
      finished = true;
      await bytes.cancel();
      onDone();
    },
  });
  const nullBody = status === 204 || status === 205 || status === 304;
  if (nullBody) {
    await bytes.cancel();
    onDone();
  }
  return new Response(nullBody ? null : body, { status, headers });
}
