// Guards every request an edge function makes to a URL it did not choose itself (today: the shop page
// the model names in enrich-bean). Plain TypeScript without Deno APIs, so tests can run it in Node; the
// DNS lookup is passed in (see dns.ts).
//
// The rule: only https on the default port, no user:password, no local names, and every address the
// host name resolves to must be a public unicast address. This is checked again for every redirect
// hop, so a public shop cannot bounce the request to 127.0.0.1, the metadata service or a private
// network. The transport gets the checked addresses and must connect only to those (pinned.ts), so the
// name is not resolved a second time between check and connect (DNS rebinding).
// The download is cut off after maxBytes and the whole call after timeoutMs.

export type Resolver = (host: string) => Promise<string[]>;
/** Sends one GET for `url` to one of `addresses` (already checked) and returns the answer as it is, no redirects. */
export type Transport = (url: URL, addresses: string[], init: { headers?: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

export class BlockedUrl extends Error {
  reason: string;
  constructor(reason: string) {
    super('blocked url: ' + reason);
    this.reason = reason;
  }
}

/** Dotted IPv4 "a.b.c.d" as four bytes, or null. URL() already turns 0x7f.1 or 2130706433 into this form. */
export function parseIPv4(s: string): number[] | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const b = m.slice(1).map(Number);
  return b.every((x) => x <= 255) ? b : null;
}

/** IPv6 (with or without brackets, "::" and an embedded IPv4 tail) as eight 16-bit groups, or null. */
export function parseIPv6(s: string): number[] | null {
  let str = s.replace(/^\[|\]$/g, '').toLowerCase();
  if (str.includes('%')) return null; // zone ids only exist for link-local addresses
  const tail = str.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (tail) {
    const v4 = parseIPv4(tail[1]);
    if (!v4) return null;
    str = str.slice(0, -tail[1].length) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = str.split('::');
  if (halves.length > 2) return null;
  const part = (h: string) => (h ? h.split(':') : []);
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...rest];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

const inV4 = (b: number[], net: number[], bits: number) => {
  const ip = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  const n = ((net[0] << 24) | (net[1] << 16) | (net[2] << 8) | net[3]) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (n & mask);
};

// Everything that is not a normal address on the internet (RFC 6890 and friends).
const V4_BLOCKED: [number[], number][] = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, cloud metadata (169.254.169.254)
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // documentation
  [[192, 88, 99, 0], 24], // 6to4 relay
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation
  [[203, 0, 113, 0], 24], // documentation
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, broadcast
];

function isPublicV4(b: number[]) {
  return !V4_BLOCKED.some(([net, bits]) => inV4(b, net, bits));
}

function isPublicV6(g: number[]) {
  // Only global unicast 2000::/3. That alone excludes ::, ::1, ::ffff:0:0/96 (IPv4-mapped),
  // 64:ff9b::/96 (NAT64), fc00::/7 (unique local), fe80::/10 (link-local) and ff00::/8 (multicast).
  if ((g[0] & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2001 && g[1] < 0x0200) return false; // 2001::/23 IETF special purpose (Teredo, ORCHID, …)
  if ((g[0] & 0xfff0) === 0x3ff0) return false; // 3fff::/20 documentation
  if (g[0] === 0x2002) return isPublicV4([g[1] >> 8, g[1] & 0xff, g[2] >> 8, g[2] & 0xff]); // 6to4 carries an IPv4
  return true;
}

/** True only for a public unicast IPv4 or IPv6 address. Anything unparsable is not public. */
export function isPublicAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPublicV4(v4);
  const v6 = parseIPv6(ip);
  return v6 ? isPublicV6(v6) : false;
}

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet', '.corp'];

/**
 * Checks what can be checked without DNS and returns the parsed URL; throws BlockedUrl otherwise.
 * IP literals are judged right here, host names need resolvePublic() as well.
 */
export function checkUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.length > 2048) throw new BlockedUrl('length');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrl('parse');
  }
  if (url.protocol !== 'https:') throw new BlockedUrl('scheme');
  if (url.username || url.password) throw new BlockedUrl('credentials');
  if (url.port !== '' && url.port !== '443') throw new BlockedUrl('port');
  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  if (!host) throw new BlockedUrl('host');
  if (host.startsWith('[') || parseIPv4(host)) {
    if (!isPublicAddress(host)) throw new BlockedUrl('address');
    return url;
  }
  if (host === 'localhost' || !host.includes('.') || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) throw new BlockedUrl('local name');
  return url;
}

/** Resolves the URL's host, throws unless every address it gets is public, and returns them. */
export async function resolvePublic(url: URL, resolve: Resolver): Promise<string[]> {
  const host = url.hostname.replace(/\.$/, '');
  if (host.startsWith('[')) return [host.slice(1, -1)]; // literal, already judged by checkUrl
  if (parseIPv4(host)) return [host];
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new BlockedUrl('dns');
  }
  if (!addresses.length) throw new BlockedUrl('dns');
  // All of them, not just the first: the HTTP client may pick any address the name has.
  if (!addresses.every(isPublicAddress)) throw new BlockedUrl('address');
  return addresses;
}

/**
 * Reads a body as text, at most maxBytes. A bigger body is not read to the end: the download stops
 * (the stream is cancelled) and the text up to the limit is returned with truncated = true.
 */
export async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = maxBytes - size;
      if (value.byteLength >= room) {
        chunks.push(value.subarray(0, room));
        size += room;
        truncated = value.byteLength > room;
        if (!truncated) {
          // Exactly at the limit: only a further chunk would make it too big.
          const next = await reader.read();
          truncated = !next.done;
        }
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => {});
    else reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return { text: new TextDecoder().decode(all), truncated };
}

export type SafeFetchOptions = {
  resolve: Resolver;
  transport: Transport;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export type SafeFetchResult = { url: string; status: number; ok: boolean; html: string; truncated: boolean };

/**
 * GETs a page from the public internet. Throws BlockedUrl when the URL or any redirect target is not
 * allowed, and the fetch's own error on timeout or network failure. Only HTML/text bodies are read.
 */
export async function safeFetch(raw: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 3;
  const maxBytes = opts.maxBytes ?? 600_000;
  // One deadline for everything: DNS, every hop and the download.
  const ctrl = new AbortController();
  const signal = ctrl.signal;
  const timer = setTimeout(() => ctrl.abort(new DOMException('safeFetch timed out', 'TimeoutError')), opts.timeoutMs ?? 8000);
  const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  aborted.catch(() => {});
  const inTime = <T>(p: Promise<T>) => Promise.race([p, aborted]);

  try {
    let url = checkUrl(raw);
    for (let hop = 0; ; hop++) {
      const addresses = await inTime(resolvePublic(url, opts.resolve));
      const res = await inTime(opts.transport(url, addresses, { headers: opts.headers, signal }));
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {});
        if (hop >= maxRedirects) throw new BlockedUrl('redirects');
        url = checkUrl(new URL(location, url).href);
        continue;
      }
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      if (!res.ok || (type && !/text\/html|application\/xhtml|text\/plain/.test(type))) {
        await res.body?.cancel().catch(() => {});
        return { url: url.href, status: res.status, ok: false, html: '', truncated: false };
      }
      const { text, truncated } = await inTime(readCapped(res, maxBytes));
      return { url: url.href, status: res.status, ok: true, html: text, truncated };
    }
  } finally {
    clearTimeout(timer);
  }
}
