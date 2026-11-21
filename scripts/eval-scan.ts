// Small eval for "Packung scannen": runs catalogue product photos through the scan-bag function
// and compares the answers with the catalogue data we already know.
//
//   node --experimental-strip-types scripts/eval-scan.ts [anzahl=30] [modell]
//   node --experimental-strip-types scripts/eval-scan.ts eval/scan-….json   (re-score a saved run, no network)
//
// Needs EVAL_SUPABASE_URL / EVAL_SUPABASE_KEY of your own project, network access and anonymous sign-ins enabled. Each run uses a fresh anonymous
// user, so it stays below the daily scan limit of the function (40).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

import { matchCatalog, words } from '../src/lib/match.ts';

// No default project: a run creates anonymous users and pays for AI calls, so it must be pointed at
// your own Supabase project on purpose.
const SUPABASE_URL = process.env.EVAL_SUPABASE_URL ?? '';
const KEY = process.env.EVAL_SUPABASE_KEY ?? '';
function requireProject() {
  if (!SUPABASE_URL || !KEY) throw new Error('Set EVAL_SUPABASE_URL and EVAL_SUPABASE_KEY (publishable key) to your own Supabase project.');
}
const replay = process.argv[2]?.endsWith('.json') ? process.argv[2] : null;
const count = replay ? 0 : Number(process.argv[2] ?? 30);
const model = replay ? undefined : process.argv[3];

type Coffee = {
  id: string;
  roaster_id: string | null;
  name: string;
  origin_country?: string | null;
  process?: string | null;
  roaster_notes: string[];
  photo_path?: string | null;
  roast_for?: string | null;
};
const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog-seed.json', import.meta.url), 'utf8')) as {
  roasters: { id: string; name: string }[];
  coffees: Coffee[];
};
const roasterName = (id: string | null) => catalog.roasters.find((r) => r.id === id)?.name ?? '';

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Spread the sample across roasters instead of taking the first N of one roaster.
function sample(): Coffee[] {
  const byRoaster = new Map<string, Coffee[]>();
  for (const c of catalog.coffees.filter((c) => c.photo_path?.startsWith('https://'))) {
    const list = byRoaster.get(c.roaster_id ?? '') ?? [];
    list.push(c);
    byRoaster.set(c.roaster_id ?? '', list);
  }
  const out: Coffee[] = [];
  for (let i = 0; out.length < count; i++) {
    let added = false;
    for (const list of byRoaster.values()) {
      if (list[i] && out.length < count) {
        out.push(list[i]);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

async function signIn(): Promise<string> {
  requireProject();
  const res = await fetch(SUPABASE_URL + '/auth/v1/signup', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' });
  const body = await res.json();
  if (!body.access_token) throw new Error('Anonyme Anmeldung fehlgeschlagen: ' + JSON.stringify(body));
  return body.access_token;
}

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) + ' %' : '–');

type Got = { name: string | null; roaster: string | null; origin_country: string | null; process: string | null; notes: string[]; roast_for: string | null };
type Row = { id: string; name: string; error?: string; got?: Got; ms?: number; tokens?: { input_tokens: number | null; output_tokens: number | null } };

// Each scanned field is checked against the catalogue loosely: the bag may print less than the catalogue
// stores ("Aponte" vs. "Aponte Espresso"), so a field counts as right when what was read is contained in it.
function score(c: Coffee, r: Got) {
  const truthNotes = c.roaster_notes.map(fold);
  const foundNotes = r.notes.map(fold);
  const match = matchCatalog(r, catalog.coffees, roasterName);
  const scanName = words(r.name ?? '');
  const catName = words(c.name);
  const roaster = fold(roasterName(c.roaster_id));
  return {
    name_ok: scanName.length > 0 && scanName.every((w) => catName.includes(w)),
    roaster_ok: !!r.roaster && (roaster.includes(fold(r.roaster)) || fold(r.roaster).includes(roaster)),
    origin_ok: c.origin_country ? !!r.origin_country && fold(r.origin_country).includes(fold(c.origin_country)) : null,
    process_ok: c.process ? !!r.process && fold(c.process).includes(fold(r.process)) : null,
    notes_found: truthNotes.filter((n) => foundNotes.some((f) => f.includes(n) || n.includes(f))).length,
    notes_total: truthNotes.length,
    match_ok: match?.id === c.id,
    match_wrong: !!match && match.id !== c.id,
  };
}

const rows: (Row & Partial<ReturnType<typeof score>>)[] = [];
if (replay) {
  for (const row of (JSON.parse(readFileSync(replay, 'utf8')) as { rows: Row[] }).rows) {
    const c = catalog.coffees.find((x) => x.id === row.id);
    rows.push(row.got && c ? { ...row, ...score(c, row.got) } : row);
  }
} else {
  const token = await signIn();
  for (const c of sample()) {
    const res = await fetch(SUPABASE_URL + '/functions/v1/scan-bag', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: c.photo_path, model }),
    });
    const body = await res.json();
    if (!res.ok) {
      rows.push({ id: c.id, name: c.name, error: body.error + (body.status ? ' ' + body.status : '') });
      console.log('✗', c.name, body.error);
      continue;
    }
    const r = body.result as Got;
    const s = score(c, r);
    rows.push({ id: c.id, name: c.name, got: r, ms: body.ms, tokens: body.usage, ...s });
    console.log(s.match_ok ? '✓' : '·', c.name, '→', r.name, '/', r.roaster, body.ms + ' ms');
  }
}

const ok = rows.filter((r) => !r.error && r.got) as (Row & ReturnType<typeof score>)[];
const known = <K extends 'origin_ok' | 'process_ok'>(k: K) => ok.filter((r) => r[k] !== null);
const ms = ok.map((r) => r.ms ?? 0).sort((a, b) => a - b);
const tokensIn = ok.reduce((s, r) => s + (r.tokens?.input_tokens ?? 0), 0);
const tokensOut = ok.reduce((s, r) => s + (r.tokens?.output_tokens ?? 0), 0);

const table = [
  `${replay ? 'Neu bewertet: ' + replay + ' · ' : ''}Modell: ${model ?? 'Standard der Function'} · ${rows.length} Packungen · ${new Date().toISOString().slice(0, 10)}`,
  '',
  '| Kennzahl | Ergebnis |',
  '|---|---|',
  `| Name richtig gelesen | ${pct(ok.filter((r) => r.name_ok).length, ok.length)} |`,
  `| Rösterei richtig | ${pct(ok.filter((r) => r.roaster_ok).length, ok.length)} |`,
  `| Herkunftsland richtig | ${pct(known('origin_ok').filter((r) => r.origin_ok).length, known('origin_ok').length)} |`,
  `| Aufbereitung richtig | ${pct(known('process_ok').filter((r) => r.process_ok).length, known('process_ok').length)} |`,
  `| Noten gefunden | ${pct(ok.reduce((s, r) => s + r.notes_found, 0), ok.reduce((s, r) => s + r.notes_total, 0))} |`,
  `| Im Katalog richtig erkannt | ${pct(ok.filter((r) => r.match_ok).length, ok.length)} |`,
  `| Falsche Katalog-Bohne | ${ok.filter((r) => r.match_wrong).length} |`,
  `| Fehler | ${rows.length - ok.length} |`,
  `| Dauer (Median) | ${ms.length ? (ms[Math.floor(ms.length / 2)] / 1000).toFixed(1) + ' s' : '–'} |`,
  `| Tokens pro Scan (ein / aus) | ${ok.length ? Math.round(tokensIn / ok.length) + ' / ' + Math.round(tokensOut / ok.length) : '–'} |`,
].join('\n');

console.log('\n' + table);
if (!replay) {
  mkdirSync(new URL('../eval', import.meta.url), { recursive: true });
  const file = new URL(`../eval/scan-${model ?? 'default'}-${Date.now()}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify({ table, rows }, null, 2));
  console.log('\nDetails: ' + file.pathname);
}
