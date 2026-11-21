// Looks a scanned bean up on the roaster's own shop: product page, official photo and the details the
// bag doesn't print. The model searches the web; this function then opens the page itself and only
// calls it "verified" when the bean's name is really on it. The OpenAI key lives only here.
// The URL comes from the model, so it is untrusted: safeFetch (net.ts) decides whether it may be opened.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { resolveHost } from '../_shared/dns.ts';
import { BlockedUrl, safeFetch } from '../_shared/net.ts';
import { pinnedTransport } from '../_shared/pinned.ts';
import { judgePage } from '../_shared/page.ts';

import { claimCall, finishCall, serviceClient } from '../_shared/budget.ts';
import { LIMITS, parseEnrich, readJson, TIMEOUTS } from '../_shared/input.ts';
// Link and image rules for the shared catalogue (kept on their own line next to judgePage's import).
import { isSafeLink, trustedImage, trustedShop } from '../_shared/page.ts';

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const MODEL = Deno.env.get('OPENAI_ENRICH_MODEL') ?? 'gpt-6.1-terra';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROMPT = (bag: Record<string, unknown>) => `Auf einer Kaffeepackung wurde gelesen:
${JSON.stringify(bag)}

Finde die Produktseite genau dieses Kaffees im Online-Shop der Rösterei selbst, dem Shop für Endkunden (nicht Großhandel/Wholesale, nicht Amazon, nicht Händler, nicht Blogs).
Es muss derselbe Kaffee sein: gleicher Name, gleiche Rösterei. Gibt es ihn als Espresso und Filter, nimm die Variante, die zur Packung passt (roast_for);
ist roast_for null und gibt es beide Varianten, setze confidence höchstens auf medium.
Übernimm die Angaben so, wie sie auf der Produktseite stehen. Rate nichts; was dort fehlt, ist null.

Antworte nur mit einem JSON-Objekt, ohne Text davor oder danach:
{
  "found": boolean,                 // false, wenn du die Seite nicht sicher findest
  "product_url": string | null,     // URL der Produktseite
  "name": string | null,
  "roaster": string | null,
  "origin_country": string | null,  // auf Deutsch, z. B. Äthiopien
  "region": string | null,
  "producer": string | null,
  "process": "Washed" | "Natural" | "Honey" | "Anaerob" | null,
  "variety": string | null,
  "roast_level": "hell" | "mittel" | "dunkel" | null,
  "roast_for": "espresso" | "filter" | "omni" | null,
  "espresso_recipe": {              // nur wenn die Seite ein Espresso-Rezept nennt, sonst null; ein Filterrezept zählt nicht
    "dose_g": number | null,        // Kaffee in g
    "yield_g": number | null,       // Espresso in g (ml zählen als g)
    "time_s": number | null,        // Bezugszeit in s, bei einer Spanne die Mitte
    "temp_c": number | null         // Wassertemperatur in °C
  } | null,
  "notes": string[],                // nur Geschmacksnoten (Aromen) wie auf der Seite, nichts zu Körper, Säure oder Balance wie „rund“
  "confidence": "high" | "medium" | "low"  // high nur, wenn Name und Rösterei eindeutig übereinstimmen
}`;

const PROCESSES = ['Washed', 'Natural', 'Honey', 'Anaerob'];
const LEVELS = ['hell', 'mittel', 'dunkel'];
const ROAST_FOR = ['espresso', 'filter', 'omni'];
const CONFIDENCE = ['high', 'medium', 'low'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const oneOf = (v: unknown, allowed: string[]) => (typeof v === 'string' && allowed.includes(v) ? v : null);

const between = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** An espresso recipe only with dose and yield; the ranges are the database's (coffees checks). */
function recipe(v: unknown) {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const out = { dose_g: between(r.dose_g, 5, 30), yield_g: between(r.yield_g, 5, 150), time_s: between(r.time_s, 5, 90), temp_c: between(r.temp_c, 80, 100) };
  return out.dose_g && out.yield_g ? out : null;
}

/** Takes the model's JSON apart field by field, so a sloppy answer can't put anything odd into the app. */
function clean(raw: Record<string, unknown>) {
  // Only a link the app may store and open (https, real domain; no tel:, javascript: …).
  const url = isSafeLink(raw.product_url) ? raw.product_url : null;
  return {
    found: raw.found === true && !!url,
    product_url: url,
    name: str(raw.name),
    roaster: str(raw.roaster),
    origin_country: str(raw.origin_country),
    region: str(raw.region),
    producer: str(raw.producer),
    process: oneOf(raw.process, PROCESSES),
    variety: str(raw.variety),
    roast_level: oneOf(raw.roast_level, LEVELS),
    roast_for: oneOf(raw.roast_for, ROAST_FOR),
    espresso_recipe: recipe(raw.espresso_recipe),
    notes: Array.isArray(raw.notes) ? raw.notes.map(str).filter((n): n is string => !!n).slice(0, 8) : [],
    confidence: oneOf(raw.confidence, CONFIDENCE) ?? 'low',
  };
}

/**
 * Opens the product page and lets judgePage decide whether it really is this bean. blocked = the URL
 * (or a redirect on the way) points somewhere the function must not go, e.g. a local or private address.
 */
async function checkPage(url: string, name: string | null, roastFor: string | null) {
  const none = { verified: false, image_url: null, blocked: false };
  try {
    const page = await safeFetch(url, {
      resolve: resolveHost,
      transport: pinnedTransport(),
      headers: { 'User-Agent': 'Mozilla/5.0 (GoodCoffee bean lookup)' },
      timeoutMs: 8000,
      maxBytes: 600_000,
      maxRedirects: 3,
    });
    if (!page.ok) return none;
    // Judged under the URL the page was really served from, after redirects.
    return { ...judgePage(page.html, page.url, name, roastFor), blocked: false };
  } catch (e) {
    return { ...none, blocked: e instanceof BlockedUrl };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) return json({ error: 'not_configured' }, 503);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data } = await db.auth.getUser();
  if (!data.user) return json({ error: 'auth' }, 401);

  // Type and size of every field are checked before the limit is claimed or the model is called.
  const body = await readJson(req, LIMITS.enrichBodyBytes);
  if (!body.ok) return json({ error: body.error }, body.status);
  const input = parseEnrich(body.value);
  if (!input.ok) return json({ error: input.error }, input.status);
  const bag = input.value;
  // Claims this call under the limits in ai_budget (per user per day and minute, and for all users
  // together), with the service role, so a client can neither skip nor raise them.
  const admin = serviceClient();
  if (!admin) return json({ error: 'not_configured' }, 503);
  const claim = await claimCall(admin, data.user.id, 'enrich', 'enrich:' + MODEL);
  if ('error' in claim) return json({ error: 'limit_check' }, 500);
  if (claim.id === null) return json({ error: 'limit', limit: claim.refused }, 429);
  const logId = claim.id;

  const started = Date.now();
  // One deadline for the call and for reading its answer: fetch() resolves after the headers already.
  const deadline = AbortSignal.timeout(TIMEOUTS.enrich);
  const timedOut = async () => {
    await finishCall(admin, logId, { ok: false, ms: Date.now() - started, error: 'timeout' });
    return json({ error: 'timeout' }, 504);
  };
  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        reasoning: { effort: 'low' },
        tools: [{ type: 'web_search', search_context_size: 'low' }],
        max_output_tokens: 4000,
        input: PROMPT({ name: bag.name, roaster: bag.roaster, origin_country: bag.origin_country, process: bag.process, roast_for: bag.roast_for, notes: bag.notes }),
      }),
      signal: deadline,
    });
  } catch {
    if (deadline.aborted) return timedOut();
    await finishCall(admin, logId, { ok: false, ms: Date.now() - started, error: 'network' });
    return json({ error: 'upstream' }, 502);
  }
  const out = await res.json().catch(() => null);
  if (deadline.aborted) return timedOut();
  const usage = out?.usage ?? {};
  const searches = (out?.output ?? []).filter((o: { type: string }) => o.type === 'web_search_call').length;
  const log = (ok: boolean, error?: string) =>
    finishCall(admin, logId, { ok, ms: Date.now() - started, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, error });

  if (!res.ok || !out) {
    await log(false, 'openai ' + res.status);
    // Only the status: OpenAI's error text can name the organisation or quote parts of the request.
    return json({ error: 'upstream', status: res.status }, 502);
  }
  const text: string =
    (out.output ?? [])
      .filter((o: { type: string }) => o.type === 'message')
      .flatMap((o: { content: { type: string; text?: string }[] }) => o.content)
      .find((c: { type: string }) => c.type === 'output_text')?.text ?? '';
  let result: ReturnType<typeof clean>;
  try {
    result = clean(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)));
  } catch {
    await log(false, 'parse');
    return json({ error: 'parse' }, 502);
  }

  const page = result.found && result.product_url ? await checkPage(result.product_url, bag.name, bag.roast_for ?? null) : { verified: false, image_url: null, blocked: false };
  // A URL the function refused to open is not handed to the app either.
  if (page.blocked) {
    result.found = false;
    result.product_url = null;
  }
  await log(true);
  // Trusted source: never a marketplace, and on the roaster's known website when the catalogue has one.
  // Only seed roasters count here: their websites were checked by us, users can add roasters freely.
  let website: string | null = null;
  if (page.verified && bag.roaster) {
    const { data: known } = await db
      .from('roasters')
      .select('website')
      .eq('source', 'seed')
      .ilike('name', bag.roaster.replace(/[\\%_]/g, '\\$&'))
      .limit(1)
      .maybeSingle();
    website = known?.website ?? null;
  }
  return json({
    result,
    verified: page.verified && !!result.product_url && trustedShop(result.product_url, website),
    // The database only takes a community photo from the product link's own site (or its shop CDN).
    image_url: result.product_url ? trustedImage(page.image_url, result.product_url) : null,
    model: MODEL,
    ms: Date.now() - started,
    searches,
    usage: { input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null },
  });
});
