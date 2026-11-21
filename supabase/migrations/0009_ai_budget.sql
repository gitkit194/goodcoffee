-- Limits for paid AI calls (scan-bag, enrich-bean) that a client cannot get around.
--
-- Before: the edge functions claimed a log row with the user's own token through claim_scan(model, limit).
-- Any signed-in client could call claim_scan and finish_scan itself, choose its own limit, rewrite its
-- token numbers, and insert rows into scan_log. And the limit was only per user: every new anonymous
-- account brought 40 more scans a day.
--
-- Now:
-- * Only the edge functions (service role) may claim and finish a call: claim_ai_call / finish_ai_call.
--   Clients can still read their own rows, but not write any.
-- * The limits live in ai_budget (only the service role / SQL editor can change them), per kind:
--     per_user_day     calls per user in 24 hours (the existing 40),
--     per_user_minute  calls per user in one minute (against bursts and scripted loops),
--     global_day       calls of all users together in 24 hours: the cost ceiling. New accounts share it,
--                      so creating more accounts does not raise what the project can spend.
-- * Every check and the insert run under locks (one per user, one global per kind), so parallel
--   requests cannot slip past any of the limits.
-- * The old functions are revoked from clients. Deploy the edge functions right after this migration;
--   until then the deployed versions get a permission error (no AI call is made).

create table public.ai_budget (
  kind text primary key check (kind in ('scan', 'enrich')),
  per_user_day integer not null check (per_user_day >= 0),
  per_user_minute integer not null check (per_user_minute >= 0),
  global_day integer not null check (global_day >= 0)
);
insert into public.ai_budget (kind, per_user_day, per_user_minute, global_day) values
  ('scan', 40, 6, 500),
  ('enrich', 40, 6, 500);
alter table public.ai_budget enable row level security;
revoke all on public.ai_budget from anon, authenticated;

alter table public.scan_log add column kind text generated always as (case when model like 'enrich:%' then 'enrich' else 'scan' end) stored;
create index scan_log_kind_day_idx on public.scan_log (kind, created_at desc);
create index scan_log_user_kind_day_idx on public.scan_log (user_id, kind, created_at desc);

-- Clients only read their own rows; writing is for the service role (the edge functions).
drop policy "scan_log insert own" on public.scan_log;
revoke insert, update, delete, truncate on public.scan_log from anon, authenticated;

/**
 * Claims one AI call for p_user. Returns the log row id, or null and the limit that was hit
 * ('day', 'minute' or 'budget'). Only the service role may call it; p_user comes from the verified token.
 */
create or replace function public.claim_ai_call(p_user uuid, p_kind text, p_model text, out id bigint, out refused text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.ai_budget;
  used_day integer;
  used_minute integer;
  used_global integer;
begin
  if p_user is null then
    raise exception 'no user';
  end if;
  select * into b from public.ai_budget where kind = p_kind;
  if not found then
    raise exception 'unknown kind %', p_kind;
  end if;
  if (p_kind = 'enrich') <> (p_model like 'enrich:%') then
    raise exception 'model % does not match kind %', p_model, p_kind;
  end if;
  -- Per user first, then the global lock, always in this order (no deadlocks).
  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_user::text || ':' || p_kind, 0));
  select count(*), count(*) filter (where s.created_at >= now() - interval '1 minute')
    into used_day, used_minute
    from public.scan_log s
    where s.user_id = p_user and s.kind = p_kind and s.created_at >= now() - interval '24 hours';
  if used_day >= b.per_user_day then
    refused := 'day';
    return;
  end if;
  if used_minute >= b.per_user_minute then
    refused := 'minute';
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai:global:' || p_kind, 0));
  select count(*) into used_global
    from public.scan_log s
    where s.kind = p_kind and s.created_at >= now() - interval '24 hours';
  if used_global >= b.global_day then
    refused := 'budget';
    return;
  end if;
  insert into public.scan_log (user_id, model, ok, error)
    values (p_user, p_model, false, 'pending')
    returning scan_log.id into id;
end;
$$;

/** Fills in the outcome of a claimed call. Only a pending row can be finished, and only once. */
create or replace function public.finish_ai_call(p_id bigint, p_ok boolean, p_ms integer, p_input_tokens integer, p_output_tokens integer, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.scan_log
    set ok = p_ok, ms = p_ms, input_tokens = p_input_tokens, output_tokens = p_output_tokens, error = p_error
    where id = p_id and error = 'pending';
$$;

revoke execute on function public.claim_ai_call(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.finish_ai_call(bigint, boolean, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.claim_ai_call(uuid, text, text) to service_role;
grant execute on function public.finish_ai_call(bigint, boolean, integer, integer, integer, text) to service_role;

-- The old pair took the limit from the caller and was open to every signed-in client.
revoke execute on function public.claim_scan(text, integer) from public, anon, authenticated;
revoke execute on function public.finish_scan(bigint, boolean, integer, integer, integer, text) from public, anon, authenticated;
