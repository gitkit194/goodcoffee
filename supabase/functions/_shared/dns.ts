// DNS lookup for net.ts in the edge runtime: all A and AAAA records of a host name.
// Fails closed: the only thing tolerated is a clear "this name has no record of this type". Any other
// failure (timeout, SERVFAIL, refused, no permission) for either type means the lookup is incomplete,
// and then the URL is not fetched, because an unchecked address could be the one the connection uses.
import type { Resolver } from './net.ts';

type DenoDns = { resolveDns?: (host: string, type: 'A' | 'AAAA', o?: { signal?: AbortSignal }) => Promise<string[]> };
type Lookup = (host: string, type: 'A' | 'AAAA') => Promise<string[]>;

export class DnsError extends Error {}

/** True only for the error Deno raises when the name exists but has no record of this type, or does not exist. */
const isNoRecord = (e: unknown) => e instanceof Error && e.name === 'NotFound';

/** Both families through one lookup; a failure of either (other than "no record") fails the whole lookup. */
export async function bothFamilies(host: string, lookup: Lookup, noRecord: (e: unknown) => boolean = isNoRecord): Promise<string[]> {
  const out: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try {
      out.push(...(await lookup(host, type)));
    } catch (e) {
      if (!noRecord(e)) throw new DnsError(`${type} lookup failed`);
    }
  }
  return out;
}

class NoRecord extends Error {
  constructor() {
    super('no record');
    this.name = 'NotFound';
  }
}

/** DNS over HTTPS (JSON API). Status 0 = NOERROR, 3 = NXDOMAIN; anything else (SERVFAIL …) is a failure. */
export function dohLookup(doFetch: typeof fetch = fetch): Lookup {
  return async (host, type) => {
    const res = await doFetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new DnsError('doh http ' + res.status);
    const body = await res.json();
    if (body.Status === 3) throw new NoRecord();
    if (body.Status !== 0) throw new DnsError('doh status ' + body.Status);
    if (body.TC) throw new DnsError('doh truncated');
    // 1 = A, 28 = AAAA; CNAME steps (5) are followed by the resolver and left out here.
    const want = type === 'A' ? 1 : 28;
    return (body.Answer ?? []).filter((a: { type: number }) => a.type === want).map((a: { data: string }) => String(a.data));
  };
}

/**
 * Deno.resolveDns where the runtime offers it. If that lookup fails in any way other than "no record"
 * (or the API is missing), both families are looked up again over DoH, and that answer must be complete.
 */
export function makeResolver(deno: DenoDns | undefined, doh: Lookup = dohLookup()): Resolver {
  return async (host) => {
    if (typeof deno?.resolveDns === 'function') {
      const native = deno.resolveDns.bind(deno);
      try {
        return await bothFamilies(host, (h, t) => native(h, t, { signal: AbortSignal.timeout(3000) }));
      } catch {
        // incomplete: fall through to DoH for both families
      }
    }
    return bothFamilies(host, doh);
  };
}

export const resolveHost: Resolver = makeResolver((globalThis as { Deno?: DenoDns }).Deno);
