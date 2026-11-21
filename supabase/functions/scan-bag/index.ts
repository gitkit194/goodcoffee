// Reads a photo of a coffee bag and returns the bean's details as structured data.
// The OpenAI key lives only here (secret OPENAI_API_KEY), never in the app.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { claimCall, finishCall, serviceClient } from '../_shared/budget.ts';
import { LIMITS, parseScan, readJson, TIMEOUTS } from '../_shared/input.ts';

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-6.1-terra';
// Models a caller may pick for comparison runs; anything else falls back to MODEL.
const ALLOWED_MODELS = ['gpt-6.1-terra', 'gpt-6-luna', 'gpt-6.1-sol'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const str = { type: ['string', 'null'] };
const num = { type: ['number', 'null'] };
const confidence = { type: 'string', enum: ['high', 'medium', 'low'] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_coffee_bag', 'name', 'roaster', 'origin_country', 'region', 'producer', 'process', 'variety',
    'roast_level', 'roast_for', 'roast_date', 'notes', 'espresso_recipe', 'confidence', 'bag_box',
  ],
  properties: {
    is_coffee_bag: { type: 'boolean' },
    name: str,
    roaster: str,
    origin_country: str,
    region: str,
    producer: str,
    process: { type: ['string', 'null'], enum: ['Washed', 'Natural', 'Honey', 'Anaerob', null] },
    variety: str,
    roast_level: { type: ['string', 'null'], enum: ['hell', 'mittel', 'dunkel', null] },
    roast_for: { type: ['string', 'null'], enum: ['espresso', 'filter', 'omni', null] },
    roast_date: str,
    notes: { type: 'array', items: { type: 'string' } },
    espresso_recipe: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['dose_g', 'yield_g', 'time_s', 'temp_c'],
      properties: { dose_g: num, yield_g: num, time_s: num, temp_c: num },
    },
    confidence: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'roaster', 'origin_country'],
      properties: { name: confidence, roaster: confidence, origin_country: confidence },
    },
    bag_box: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['x', 'y', 'w', 'h'],
      properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
    },
  },
};

const PROMPT = `Du siehst das Foto einer Kaffeepackung (Specialty Coffee). Lies ab, was auf der Packung steht, und fülle die Felder.
Regeln:
- Übernimm nur, was auf der Packung lesbar ist. Rate nichts. Was fehlt, ist null.
- name: der Name des Kaffees, so wie die Rösterei ihn schreibt, ohne Röstereinamen und ohne Gewicht.
- roaster: Name der Rösterei.
- origin_country: Herkunftsland auf Deutsch (z. B. Äthiopien, Kolumbien, Kenia). Bei Blends mit mehreren Ländern alle mit Komma.
- process: Washed (gewaschen), Natural, Honey oder Anaerob (anaerobe Fermentation); sonst null.
- roast_level nur, wenn die Packung ihn nennt. roast_for nur, wenn die Packung es nennt: espresso, filter oder omni (für beides).
- espresso_recipe: nur wenn die Packung ein Espresso-Rezept aufdruckt (z. B. „18 g → 40 g, 28 s, 93 °C“): dose_g = Kaffee in g, yield_g = Espresso in g (ml zählen als g), time_s = Bezugszeit in s (bei einer Spanne die Mitte), temp_c = Wassertemperatur in °C. Was davon fehlt, ist null. Ohne Espresso-Rezept null; ein Filterrezept zählt nicht.
- roast_date als YYYY-MM-DD, nur wenn ein Röstdatum aufgedruckt ist (kein Mindesthaltbarkeitsdatum).
- notes: nur die Geschmacksnoten (Aromen wie Schokolade, Kirsche, Haselnuss), so wie sie aufgedruckt sind, je Note ein Eintrag. Keine Angaben zu Körper, Säure, Abgang oder Balance (z. B. nicht „rund“, „ausgewogen“, „vollmundig“, „milde Säure“).
- confidence: high, wenn klar lesbar; medium, wenn teilweise verdeckt oder interpretiert; low, wenn geraten.
- bag_box: Rechteck der Packung im Bild, Werte von 0 bis 1 relativ zur Bildbreite und -höhe (x, y = linke obere Ecke). null, wenn keine Packung zu sehen ist.
- is_coffee_bag: false, wenn das Bild keine Kaffeepackung zeigt.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) return json({ error: 'not_configured' }, 503);

  // Only signed-in app users (anonymous sign-in counts), each with a daily limit.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data } = await db.auth.getUser();
  if (!data.user) return json({ error: 'auth' }, 401);

  // Size, format and model are checked before the limit is claimed or the model is called.
  const body = await readJson(req, LIMITS.scanBodyBytes);
  if (!body.ok) return json({ error: body.error }, body.status);
  const input = parseScan(body.value, ALLOWED_MODELS);
  if (!input.ok) return json({ error: input.error }, input.status);
  const image = input.value.image;
  const model = input.value.model ?? MODEL;
  // Claims this call under the limits in ai_budget (per user per day and minute, and for all users
  // together), with the service role, so a client can neither skip nor raise them.
  const admin = serviceClient();
  if (!admin) return json({ error: 'not_configured' }, 503);
  const claim = await claimCall(admin, data.user.id, 'scan', model);
  if ('error' in claim) return json({ error: 'limit_check' }, 500);
  if (claim.id === null) return json({ error: 'limit', limit: claim.refused }, 429);
  const logId = claim.id;

  const started = Date.now();
  // One deadline for the call and for reading its answer: fetch() resolves after the headers already.
  const deadline = AbortSignal.timeout(TIMEOUTS.scan);
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
        model,
        reasoning: { effort: 'none' },
        max_output_tokens: 2000,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: PROMPT },
              { type: 'input_image', image_url: image, detail: 'high' },
            ],
          },
        ],
        text: { format: { type: 'json_schema', name: 'coffee_bag', strict: true, schema: SCHEMA } },
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
  const ms = Date.now() - started;
  const usage = out?.usage ?? {};
  const log = (ok: boolean, error?: string) =>
    finishCall(admin, logId, { ok, ms, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, error });

  if (!res.ok || !out) {
    await log(false, 'openai ' + res.status);
    // Only the status: OpenAI's error text can name the organisation or quote parts of the request.
    return json({ error: 'upstream', status: res.status }, 502);
  }
  const text = (out.output ?? [])
    .filter((o: { type: string }) => o.type === 'message')
    .flatMap((o: { content: { type: string; text?: string }[] }) => o.content)
    .find((c: { type: string }) => c.type === 'output_text')?.text;
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    await log(false, 'parse');
    return json({ error: 'parse' }, 502);
  }
  await log(true);
  return json({ result, model, ms, usage: { input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null } });
});
