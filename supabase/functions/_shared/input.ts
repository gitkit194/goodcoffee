// Checks what the app sends to scan-bag and enrich-bean before anything costs money: size of the
// request, type and length of every field. Plain TypeScript without Deno APIs, so tests can run it in Node.
// Each parse function returns either the cleaned value or an error code for a 400 answer.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status });

/**
 * Reads the request body as JSON, at most maxBytes. A bigger body is refused while it is being read
 * (413), whatever Content-Length claims; a body that is no JSON object gives 400.
 */
export async function readJson(req: Request, maxBytes: number): Promise<Parsed<Record<string, unknown>>> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    await req.body?.cancel().catch(() => {});
    return fail('too_large', 413);
  }
  if (!req.body) return fail('body');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return fail('too_large', 413);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
  } catch {
    return fail('body');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('body');
  return { ok: true, value: raw as Record<string, unknown> };
}

// Control characters other than tab/newline have no business in a coffee name and can confuse prompts or logs.
// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** An optional text field: missing/null → null; otherwise a string of at most max characters. */
function text(raw: Record<string, unknown>, key: string, max: number, required = false): Parsed<string | null> {
  const v = raw[key];
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return required ? fail(key) : { ok: true, value: null };
  if (typeof v !== 'string' || v.length > max || CONTROL.test(v)) return fail(key);
  return { ok: true, value: v.trim() };
}

function oneOf<T extends string>(raw: Record<string, unknown>, key: string, allowed: readonly T[]): Parsed<T | null> {
  const v = raw[key];
  if (v === undefined || v === null) return { ok: true, value: null };
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? { ok: true, value: v as T } : fail(key);
}

export const LIMITS = {
  enrichBodyBytes: 16 * 1024,
  scanBodyBytes: 4 * 1024 * 1024,
  // base64 of a JPEG of about 2.9 MB; the app sends 1280 px at quality 0.7, usually 150–500 kB.
  imageBase64Chars: 3_900_000,
  name: 120,
  field: 120,
  note: 60,
  notes: 20,
  url: 2048,
};

export const ROAST_FOR = ['espresso', 'filter', 'omni'] as const;

export type EnrichInput = {
  name: string;
  roaster: string | null;
  origin_country: string | null;
  process: string | null;
  roast_for: (typeof ROAST_FOR)[number] | null;
  notes: string[];
};

/** What enrich-bean accepts: the fields of a scan, each checked for type and length. Other keys are dropped. */
export function parseEnrich(raw: Record<string, unknown>): Parsed<EnrichInput> {
  const name = text(raw, 'name', LIMITS.name, true);
  if (!name.ok) return name;
  const roaster = text(raw, 'roaster', LIMITS.field);
  if (!roaster.ok) return roaster;
  const origin = text(raw, 'origin_country', LIMITS.field);
  if (!origin.ok) return origin;
  const process = text(raw, 'process', LIMITS.field);
  if (!process.ok) return process;
  const roastFor = oneOf(raw, 'roast_for', ROAST_FOR);
  if (!roastFor.ok) return roastFor;
  let notes: string[] = [];
  if (raw.notes !== undefined && raw.notes !== null) {
    if (!Array.isArray(raw.notes) || raw.notes.length > LIMITS.notes) return fail('notes');
    for (const n of raw.notes) {
      if (typeof n !== 'string' || n.length > LIMITS.note || CONTROL.test(n)) return fail('notes');
    }
    notes = raw.notes.map((n: string) => n.trim()).filter(Boolean);
  }
  return {
    ok: true,
    value: { name: name.value!, roaster: roaster.value, origin_country: origin.value, process: process.value, roast_for: roastFor.value, notes },
  };
}

export type ScanInput = { image: string; model: string | null };

/**
 * What scan-bag accepts: either `image` (base64 JPEG, as the app sends it) or `image_url` (https, used
 * by the eval script), never both, plus an optional `model` from the allowed list.
 * Returns the image as the data: URL or https URL the model gets.
 */
export function parseScan(raw: Record<string, unknown>, allowedModels: readonly string[]): Parsed<ScanInput> {
  const hasImage = raw.image !== undefined && raw.image !== null;
  const hasUrl = raw.image_url !== undefined && raw.image_url !== null;
  if (hasImage === hasUrl) return fail('image');
  let image: string;
  if (hasImage) {
    const b64 = raw.image;
    if (typeof b64 !== 'string' || b64.length > LIMITS.imageBase64Chars) return fail('image');
    // Base64 alphabet only, and the JPEG start marker (FF D8 FF → "/9j/").
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0 || !b64.startsWith('/9j/')) return fail('image');
    image = 'data:image/jpeg;base64,' + b64;
  } else {
    const url = raw.image_url;
    if (typeof url !== 'string' || url.length > LIMITS.url) return fail('image_url');
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.username || u.password) return fail('image_url');
    } catch {
      return fail('image_url');
    }
    image = url;
  }
  let model: string | null = null;
  if (raw.model !== undefined && raw.model !== null) {
    if (typeof raw.model !== 'string' || !allowedModels.includes(raw.model)) return fail('model');
    model = raw.model;
  }
  return { ok: true, value: { image, model } };
}

/** Upstream deadlines in ms. A scan has no web search; the lookup may search several times. */
export const TIMEOUTS = { scan: 45_000, enrich: 90_000 };
