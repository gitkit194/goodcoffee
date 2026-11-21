// Claims and finishes paid AI calls through the database (claim_ai_call / finish_ai_call), with the
// service role: clients cannot call these functions, so they cannot raise their limits or fake numbers.
// The limits themselves are in public.ai_budget.
import { createClient } from 'npm:@supabase/supabase-js@2';

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

function serviceKey(): string | null {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? null;
  } catch {
    return null;
  }
}

/** Database client with the service role, or null when the key is missing (the function then answers 503). */
export function serviceClient(): Rpc | null {
  const key = serviceKey();
  if (!key) return null;
  return createClient(Deno.env.get('SUPABASE_URL')!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type Claim = { id: number } | { id: null; refused: 'day' | 'minute' | 'budget' } | { error: true };

export async function claimCall(db: Rpc, user: string, kind: 'scan' | 'enrich', model: string): Promise<Claim> {
  const { data, error } = await db.rpc('claim_ai_call', { p_user: user, p_kind: kind, p_model: model });
  if (error) return { error: true };
  const row = (Array.isArray(data) ? data[0] : data) as { id: number | null; refused: string | null } | undefined;
  if (!row) return { error: true };
  if (row.id !== null && row.id !== undefined) return { id: row.id };
  return { id: null, refused: (row.refused ?? 'day') as 'day' | 'minute' | 'budget' };
}

export function finishCall(db: Rpc, id: number, r: { ok: boolean; ms: number; input_tokens?: number | null; output_tokens?: number | null; error?: string | null }) {
  return db.rpc('finish_ai_call', {
    p_id: id,
    p_ok: r.ok,
    p_ms: r.ms,
    p_input_tokens: r.input_tokens ?? null,
    p_output_tokens: r.output_tokens ?? null,
    p_error: r.error ?? null,
  });
}
