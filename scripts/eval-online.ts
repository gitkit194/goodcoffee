// Eval for the online lookup after a scan: takes a saved scan run (eval/scan-….json), looks every
// bean up online with what was read from the bag, and compares with the catalogue, which knows each
// bean's real product page.
//
//   node --experimental-strip-types scripts/eval-online.ts eval/scan-….json
//   node --experimental-strip-types scripts/eval-online.ts eval/online-….json   (re-score a saved run, no network)
//
// Needs EVAL_SUPABASE_URL / EVAL_SUPABASE_KEY of your own project and network access. Takes about 10–20 s per bean.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { isSure } from '../src/lib/match.ts';

// No default project: a run creates anonymous users and pays for AI calls, so it must be pointed at
// your own Supabase project on purpose.
const SUPABASE_URL = process.env.EVAL_SUPABASE_URL ?? '';
const KEY = process.env.EVAL_SUPABASE_KEY ?? '';
function requireProject() {
  if (!SUPABASE_URL || !KEY) throw new Error('Set EVAL_SUPABASE_URL and EVAL_SUPABASE_KEY (publishable key) to your own Supabase project.');
}
const runFile = process.argv[2];
if (!runFile) throw new Error('Bitte einen Scan-Lauf angeben: npm run eval:online -- eval/scan-….json');

type Coffee = { id: string; name: string; origin_country?: string | null; process?: string | null; roaster_notes: string[]; product_url?: string | null };
type Got = { name: string | null; roaster: string | null; origin_country: string | null; process: string | null; notes: string[] };
const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog-seed.json', import.meta.url), 'utf8')) as { coffees: Coffee[] };
const scans = (JSON.parse(readFileSync(runFile, 'utf8')) as { rows: { id: string; got?: Got }[] }).rows.filter((r) => r.got?.name);

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Host and last path segment: /de/products/x and /collections/y/products/x are the same page. */
function pageKey(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + '/' + (u.pathname.replace(/\/+$/, '').split('/').pop() ?? '');
  } catch {
    return url;
  }
}
const host = (url: string) => pageKey(url).split('/')[0];
/** The same bean in another bag size (…-1020242 vs …-1020245) or on the roaster's second shop domain. */
const slugCore = (url: string) => (pageKey(url).split('/')[1] ?? '').replace(/-\d{4,}(\.\d+)?$/, '');

async function signIn(): Promise<string> {
  requireProject();
  const res = await fetch(SUPABASE_URL + '/auth/v1/signup', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' });
  const body = await res.json();
  if (!body.access_token) throw new Error('Anonyme Anmeldung fehlgeschlagen: ' + JSON.stringify(body));
  return body.access_token;
}

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) + ' %' : '–');

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Looked = Parameters<typeof isSure>[0]['result'];
type Bag = Parameters<typeof isSure>[1];

function score(c: Coffee, r: Row, extra: Row, bag: Row): Row {
  // Same rule as the app (lookUpOnline).
  const sure = isSure({ verified: !!extra.verified, result: r as Looked }, bag as Bag);
  // Only shop pages count; the catalogue's own link is sometimes a delivery platform, not the roaster.
  const truthUrl = c.product_url && !/wolt\.com|lieferando|ubereats/.test(c.product_url) ? c.product_url : null;
  const samePage = !!r.product_url && !!truthUrl && pageKey(r.product_url) === pageKey(truthUrl);
  const sameBean = samePage || (!!r.product_url && !!truthUrl && slugCore(r.product_url) === slugCore(truthUrl));
  const truthNotes = c.roaster_notes.map(fold);
  const foundNotes = (r.notes as string[]).map(fold);
  return {
    id: c.id,
    name: c.name,
    bag,
    got: r,
    image_url: extra.image_url,
    verified: extra.verified,
    sure,
    truth_url: truthUrl,
    same_page: samePage,
    same_bean: sameBean,
    same_shop: !!r.product_url && !!truthUrl && host(r.product_url) === host(truthUrl),
    // A sure answer for another bean (or the other roast of it) is the error that matters.
    sure_wrong: sure && !!truthUrl && !sameBean,
    origin_ok: c.origin_country ? !!r.origin_country && fold(r.origin_country).includes(fold(c.origin_country)) : null,
    process_ok: c.process ? !!r.process && fold(c.process).includes(fold(r.process)) : null,
    notes_found: truthNotes.filter((n) => foundNotes.some((f) => f.includes(n) || n.includes(f))).length,
    notes_total: truthNotes.length,
    ms: extra.ms,
    searches: extra.searches,
    tokens: extra.tokens,
  };
}

const saved = JSON.parse(readFileSync(runFile, 'utf8')) as { rows: Row[] };
const replay = saved.rows.some((r) => 'truth_url' in r);
const rows: Row[] = [];
if (replay) {
  for (const old of saved.rows) {
    const c = catalog.coffees.find((x) => x.id === old.id);
    rows.push(old.error || !c ? old : score(c, old.got, old, old.bag ?? {}));
  }
} else {
  const token = await signIn();
  for (const scan of scans) {
    const c = catalog.coffees.find((x) => x.id === scan.id);
    if (!c || !scan.got) continue;
    const res = await fetch(SUPABASE_URL + '/functions/v1/enrich-bean', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(scan.got),
    });
    const body = await res.json();
    if (!res.ok) {
      rows.push({ id: c.id, name: c.name, error: body.error + (body.status ? ' ' + body.status : '') });
      console.log('✗', c.name, body.error);
      continue;
    }
    const row = score(c, body.result, { ...body, tokens: body.usage }, scan.got);
    rows.push(row);
    console.log(row.sure ? (row.same_bean ? '✓' : '✗ sicher, aber falsch') : row.got.found ? '?' : '·', c.name, '→', row.got.product_url ?? '–', body.ms + ' ms');
  }
}

const ok = rows.filter((r) => !r.error);
const withTruth = ok.filter((r) => r.truth_url);
const sure = ok.filter((r) => r.sure);
const known = <K extends 'origin_ok' | 'process_ok'>(k: K) => ok.filter((r) => r[k] !== null);
const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
const avg = (f: (r: (typeof ok)[number]) => number) => (ok.length ? ok.reduce((s, r) => s + f(r), 0) / ok.length : 0);

const table = [
  `${replay ? 'Neu bewertet · ' : ''}Online-Abgleich · ${ok.length} Bohnen aus ${runFile} · ${new Date().toISOString().slice(0, 10)}`,
  '',
  '| Kennzahl | Ergebnis |',
  '|---|---|',
  `| Produktseite gefunden | ${pct(ok.filter((r) => r.got.found).length, ok.length)} |`,
  `| … davon die richtige Seite | ${pct(withTruth.filter((r) => r.same_page).length, withTruth.filter((r) => r.got.found).length)} |`,
  `| … davon dieselbe Bohne (auch andere Größe/Shop) | ${pct(withTruth.filter((r) => r.same_bean).length, withTruth.filter((r) => r.got.found).length)} |`,
  `| Sicher (geprüft, nicht low), ergänzt ohne Nachfrage | ${pct(sure.length, ok.length)} |`,
  `| Sicher, aber falsche Bohne | ${sure.filter((r) => r.sure_wrong).length} |`,
  `| Offizielles Bild gefunden | ${pct(ok.filter((r) => r.image_url).length, ok.length)} |`,
  `| Herkunftsland richtig | ${pct(known('origin_ok').filter((r) => r.origin_ok).length, known('origin_ok').length)} |`,
  `| Aufbereitung richtig | ${pct(known('process_ok').filter((r) => r.process_ok).length, known('process_ok').length)} |`,
  `| Noten gefunden | ${pct(ok.reduce((s, r) => s + r.notes_found, 0), ok.reduce((s, r) => s + r.notes_total, 0))} |`,
  `| Fehler | ${rows.length - ok.length} |`,
  `| Dauer (Median) | ${ms.length ? (ms[Math.floor(ms.length / 2)] / 1000).toFixed(1) + ' s' : '–'} |`,
  `| Suchen pro Bohne | ${avg((r) => r.searches ?? 0).toFixed(1)} |`,
  `| Tokens pro Bohne (ein / aus) | ${Math.round(avg((r) => r.tokens?.input_tokens ?? 0))} / ${Math.round(avg((r) => r.tokens?.output_tokens ?? 0))} |`,
].join('\n');

console.log('\n' + table);
if (replay) process.exit(0);
mkdirSync(new URL('../eval', import.meta.url), { recursive: true });
const file = new URL(`../eval/online-${Date.now()}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ table, rows }, null, 2));
console.log('\nDetails: ' + file.pathname);
