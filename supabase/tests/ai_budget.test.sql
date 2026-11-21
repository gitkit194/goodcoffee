-- AI call limits (0009_ai_budget.sql): only the service role claims and finishes calls,
-- clients cannot write scan_log or read the budget, and every limit holds.
-- Users: A = …0a, B = …0b (created in before_0006_community_catalog.sql).
create schema if not exists b;
grant usage on schema b to anon, authenticated, service_role;
create or replace function b.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', msg; end if;
end $$;
create or replace function b.fails(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on all functions in schema b to anon, authenticated, service_role;

-- 1. A signed-in client can do none of it.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select b.ok(b.fails($$select public.claim_ai_call('00000000-0000-0000-0000-00000000000a', 'scan', 'm')$$) = '42501', 'client cannot claim');
select b.ok(b.fails($$select public.finish_ai_call(1, true, 1, 1, 1, null)$$) = '42501', 'client cannot finish');
select b.ok(b.fails($$select public.claim_scan('m', 1000000)$$) = '42501', 'old claim_scan closed');
select b.ok(b.fails($$select public.finish_scan(1, true, 1, 1, 1, null)$$) = '42501', 'old finish_scan closed');
select b.ok(b.fails($$insert into public.scan_log (user_id, model, ok) values ('00000000-0000-0000-0000-00000000000a', 'm', true)$$) = '42501', 'client cannot insert log rows');
select b.ok(b.fails($$update public.scan_log set input_tokens = 0$$) = '42501', 'client cannot change log rows');
select b.ok(b.fails($$delete from public.scan_log$$) = '42501', 'client cannot delete log rows');
select b.ok(b.fails($$select * from public.ai_budget$$) = '42501', 'client cannot read or change the budget');
select b.ok(b.fails($$update public.ai_budget set global_day = 1000000$$) = '42501', 'client cannot raise the budget');
reset role;

-- 2. The service role: per-user day limit.
update public.ai_budget set per_user_day = 3, per_user_minute = 100, global_day = 1000 where kind = 'scan';
set role service_role;
select b.ok((select count(*) from generate_series(1, 5) g, public.claim_ai_call('00000000-0000-0000-0000-00000000000a', 'scan', 'gpt' || repeat('', g)) c where c.id is not null) = 3, 'three of five per day');
select b.ok((select refused from public.claim_ai_call('00000000-0000-0000-0000-00000000000a', 'scan', 'gpt')) = 'day', 'refused: day');
-- The kinds count separately: enrich is still free for A.
select b.ok((select id is not null from public.claim_ai_call('00000000-0000-0000-0000-00000000000a', 'enrich', 'enrich:gpt')), 'enrich counts on its own');
select b.ok(b.fails($$select public.claim_ai_call('00000000-0000-0000-0000-00000000000a', 'enrich', 'gpt')$$) is not null, 'model must match the kind');
select b.ok(b.fails($$select public.claim_ai_call(null, 'scan', 'gpt')$$) is not null, 'no user, no claim');
reset role;
-- Calls older than 24 hours no longer count.
update public.scan_log set created_at = now() - interval '25 hours' where user_id = '00000000-0000-0000-0000-00000000000a' and kind = 'scan';
set role service_role;
select b.ok((select id is not null from public.claim_ai_call('00000000-0000-0000-0000-00000000000a', 'scan', 'gpt')), 'a new day');
reset role;

-- 3. Per-user minute limit.
delete from public.scan_log;
update public.ai_budget set per_user_day = 100, per_user_minute = 2, global_day = 1000 where kind = 'scan';
set role service_role;
select b.ok((select count(*) from generate_series(1, 4) g, public.claim_ai_call('00000000-0000-0000-0000-00000000000b', 'scan', 'gpt' || repeat('', g)) c where c.id is not null) = 2, 'two per minute');
select b.ok((select refused from public.claim_ai_call('00000000-0000-0000-0000-00000000000b', 'scan', 'gpt')) = 'minute', 'refused: minute');
reset role;
update public.scan_log set created_at = now() - interval '2 minutes';
set role service_role;
select b.ok((select id is not null from public.claim_ai_call('00000000-0000-0000-0000-00000000000b', 'scan', 'gpt')), 'after a minute again');
reset role;

-- 4. Global budget: new accounts share it.
delete from public.scan_log;
update public.ai_budget set per_user_day = 100, per_user_minute = 100, global_day = 5 where kind = 'scan';
insert into auth.users (id) select ('00000000-0000-0000-0000-1' || lpad(g::text, 11, '0'))::uuid from generate_series(1, 10) g on conflict do nothing;
set role service_role;
select b.ok((select count(*) from generate_series(1, 10) g,
  public.claim_ai_call(('00000000-0000-0000-0000-1' || lpad(g::text, 11, '0'))::uuid, 'scan', 'gpt') c where c.id is not null) = 5,
  'ten new accounts get five calls together');
select b.ok((select refused from public.claim_ai_call('00000000-0000-0000-0000-00000000000a', 'scan', 'gpt')) = 'budget', 'refused: budget');
reset role;

-- 5. finish_ai_call fills a pending row once; a finished row cannot be rewritten.
set role service_role;
select public.finish_ai_call(min(id), true, 120, 1000, 50, null) from public.scan_log;
select public.finish_ai_call(min(id), true, 1, 0, 0, null) from public.scan_log;
select b.ok((select input_tokens = 1000 and output_tokens = 50 and ok from public.scan_log where id = (select min(id) from public.scan_log)), 'numbers written once, not rewritten');
reset role;

-- A client sees only its own rows.
insert into public.scan_log (user_id, model, ok) values ('00000000-0000-0000-0000-00000000000b', 'gpt', true);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select b.ok((select count(*) from public.scan_log) = 1 and (select bool_and(user_id = '00000000-0000-0000-0000-00000000000b') from public.scan_log), 'own rows only');
reset role;

-- Leave a clean state with the real limits for the parallel test.
delete from public.scan_log;
update public.ai_budget set per_user_day = 40, per_user_minute = 6, global_day = 500;
