-- The daily scan limit was checked by counting rows and logging only after the model answered, so
-- parallel requests all saw the same count and got through. Now a request claims its row first, under
-- a per-user lock, and fills in the numbers afterwards.

create or replace function public.claim_scan(p_model text, p_limit integer)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  enrich boolean := p_model like 'enrich:%';
  used integer;
  claimed bigint;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  -- Serialises the requests of one user (per kind) until this transaction ends.
  perform pg_advisory_xact_lock(hashtextextended(uid::text || (case when enrich then ':enrich' else ':scan' end), 0));
  select count(*) into used
    from public.scan_log
    where user_id = uid
      and created_at >= now() - interval '24 hours'
      and (model like 'enrich:%') = enrich;
  if used >= p_limit then
    return null;
  end if;
  insert into public.scan_log (user_id, model, ok, error)
    values (uid, p_model, false, 'pending')
    returning id into claimed;
  return claimed;
end;
$$;

create or replace function public.finish_scan(p_id bigint, p_ok boolean, p_ms integer, p_input_tokens integer, p_output_tokens integer, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.scan_log
    set ok = p_ok, ms = p_ms, input_tokens = p_input_tokens, output_tokens = p_output_tokens, error = p_error
    where id = p_id and user_id = auth.uid();
$$;

revoke execute on function public.claim_scan(text, integer) from public, anon;
revoke execute on function public.finish_scan(bigint, boolean, integer, integer, integer, text) from public, anon;
grant execute on function public.claim_scan(text, integer) to authenticated;
grant execute on function public.finish_scan(bigint, boolean, integer, integer, integer, text) to authenticated;
