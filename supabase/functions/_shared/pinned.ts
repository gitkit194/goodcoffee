// Transport for net.ts in the edge runtime: opens TCP to one of the addresses net.ts has checked, then
// TLS with the original host name (SNI and certificate check against that name), and speaks HTTP/1.1
// over it (http1.ts). The host name is never resolved a second time, so a DNS answer that changes
// between check and connect (DNS rebinding) cannot redirect the request.
import { readResponse, requestBytes } from './http1.ts';
import type { Transport } from './net.ts';

type Conn = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; close(): void };
type DenoNet = {
  connect(o: { hostname: string; port: number; transport?: 'tcp' }): Promise<Conn>;
  startTls(c: Conn, o: { hostname: string; caCerts?: string[]; alpnProtocols?: string[] }): Promise<Conn>;
};

/**
 * Waits for a connection step, but gives up as soon as the signal aborts. A connection that only
 * arrives after the abort is closed right away and never used.
 */
function untilAbort(step: Promise<Conn>, signal: AbortSignal): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    step.then(
      (c) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          try {
            c.close();
          } catch {
            // already closed
          }
          reject(signal.reason);
        } else resolve(c);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(signal.aborted ? signal.reason : e);
      },
    );
  });
}

/** caCerts only for tests against a local server with its own certificate. */
export function pinnedTransport(opts: { caCerts?: string[]; port?: number } = {}): Transport {
  return async (url, addresses, { headers, signal }) => {
    const deno = (globalThis as unknown as { Deno: DenoNet }).Deno;
    let lastError: unknown = new Error('no address');
    for (const ip of addresses) {
      signal.throwIfAborted();
      let tcp: Conn | null = null;
      let tls: Conn | null = null;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          (tls ?? tcp)?.close();
        } catch {
          // already closed
        }
      };
      try {
        tcp = await untilAbort(deno.connect({ hostname: ip, port: opts.port ?? 443, transport: 'tcp' }), signal);
        // From here on an abort closes the open connection, which also ends a pending TLS handshake or read.
        signal.addEventListener('abort', close, { once: true });
        tls = await untilAbort(
          deno.startTls(tcp, { hostname: url.hostname.replace(/\.$/, ''), caCerts: opts.caCerts, alpnProtocols: ['http/1.1'] }),
          signal,
        );
        signal.throwIfAborted();
        const w = tls.writable.getWriter();
        await w.write(requestBytes(url, headers));
        w.releaseLock();
        signal.throwIfAborted();
        return await readResponse(tls.readable, () => {
          signal.removeEventListener('abort', close);
          close();
        });
      } catch (e) {
        signal.removeEventListener('abort', close);
        close();
        if (signal.aborted) throw signal.reason;
        lastError = e;
        // Try the next checked address (e.g. IPv6 not reachable from here).
      }
    }
    throw lastError;
  };
}
