// Logging without private data. Release builds write console output to the system log (logcat, the
// iOS console), which other tools on the device and crash reporters can read. So:
// * only in development builds,
// * only the kind of error (name, code, HTTP status), never its message or details: Supabase errors can
//   quote row values ("Key (id)=(…)"), and a request or response may carry a token.

declare const __DEV__: boolean | undefined;

/** The parts of an error that are safe to log: no message, no details, no payload. */
export function describeError(e: unknown): string {
  if (e === null || typeof e !== 'object') return typeof e;
  const o = e as { name?: unknown; code?: unknown; status?: unknown };
  const parts = [
    typeof o.name === 'string' ? o.name : 'Error',
    typeof o.code === 'string' || typeof o.code === 'number' ? `code ${o.code}` : null,
    typeof o.status === 'number' ? `status ${o.status}` : null,
  ];
  return parts.filter(Boolean).join(', ');
}

export function logError(label: string, e: unknown): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  console.warn(`${label}: ${describeError(e)}`);
}
