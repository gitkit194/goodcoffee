// Loads an edge function's index.ts in Node with a fake Deno (env, serve), fake supabase-js and a fake
// global fetch, and returns its request handler. Records rpc calls and outgoing fetches per test.
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);

type Call = { name: string; args: unknown };
type State = { user: { id: string } | null; rpc: Call[]; fetches: string[]; claim?: unknown; answer: (url: string, init?: RequestInit) => Promise<Response> };
const state: State = { user: { id: 'u1' }, rpc: [], fetches: [], answer: async () => new Response('{}') };
(globalThis as Record<string, unknown>).__edge = state;

export const ENV: Record<string, string> = { OPENAI_API_KEY: 'test', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
let handler: ((req: Request) => Promise<Response>) | null = null;
(globalThis as Record<string, unknown>).Deno = {
  env: { get: (k: string) => ENV[k] },
  serve: (h: (req: Request) => Promise<Response>) => {
    handler = h;
  },
};
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  state.fetches.push(url);
  return state.answer(url, init);
}) as typeof fetch;

const loaded = new Map<string, (req: Request) => Promise<Response>>();
export async function loadFunction(name: 'scan-bag' | 'enrich-bean') {
  if (!loaded.has(name)) {
    handler = null;
    await import(`../../supabase/functions/${name}/index.ts`);
    loaded.set(name, handler!);
  }
  return loaded.get(name)!;
}

export function reset(answer?: State['answer']) {
  state.rpc = [];
  state.fetches = [];
  state.user = { id: 'u1' };
  state.claim = undefined;
  state.answer = answer ?? (async () => new Response('{}'));
  return state;
}

export const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://fn.example/', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
