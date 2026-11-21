-- Rights of the API roles after 0010_harden_grants.sql.
create schema th;
create function th.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', msg; end if;
end $$;
grant usage on schema th to anon, authenticated;
grant execute on function th.ok(boolean, text) to anon, authenticated;
create function th.fails(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on function th.fails(text) to anon, authenticated;

-- 1. No client can truncate, add triggers or reference any table in public.
select th.ok(not exists (
  select 1 from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
     and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
), 'no TRUNCATE/TRIGGER/REFERENCES for anon or authenticated');

-- 2. The same holds for a table created later.
create table public.th_new (id int);
select th.ok(not has_table_privilege('authenticated', 'public.th_new', 'TRUNCATE')
         and not has_table_privilege('anon', 'public.th_new', 'TRUNCATE'), 'new tables: no TRUNCATE');
select th.ok(has_table_privilege('authenticated', 'public.th_new', 'SELECT'), 'new tables keep the normal rights');
drop table public.th_new;

-- 3. anon reads the catalogue and nothing private, and writes nothing.
select th.ok(has_column_privilege('anon', 'public.coffees', 'name', 'SELECT') and has_column_privilege('anon', 'public.roasters', 'name', 'SELECT'), 'anon reads the catalogue');
select th.ok(not has_table_privilege('anon', 'public.' || t, p), format('anon has no %s on %s', p, t))
  from unnest(array['cups', 'profiles', 'user_coffees']) t, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p;
select th.ok(not has_table_privilege('anon', 'public.' || t, p), format('anon has no %s on %s', p, t))
  from unnest(array['coffees', 'roasters']) t, unnest(array['INSERT', 'UPDATE', 'DELETE']) p;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select th.ok(th.fails($$insert into public.roasters (name, slug) values ('X', 'x-anon')$$) = '42501', 'anon cannot add a roaster');
select th.ok(th.fails($$select count(*) from public.cups$$) = '42501', 'anon cannot read cups');
select th.ok(th.fails($$select * from public.coffee_rating_stats('30000000-0000-0000-0000-000000000001')$$) is null, 'anon still gets rating numbers');
reset role;

-- 4. authenticated keeps what the app uses, but cannot delete profiles.
select th.ok(has_table_privilege('authenticated', 'public.' || t, p), format('authenticated has %s on %s', p, t))
  from unnest(array['cups', 'user_coffees']) t, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p;
select th.ok(has_table_privilege('authenticated', 'public.profiles', p), 'authenticated has ' || p || ' on profiles')
  from unnest(array['SELECT', 'INSERT', 'UPDATE']) p;
select th.ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'), 'no DELETE on profiles');
select th.ok(has_table_privilege('authenticated', 'public.roasters', 'INSERT'), 'share_coffee can still add roasters');

-- 4b. Who added a catalogue entry and when stays on the server (0014): only product fields are readable.
select th.ok(not has_column_privilege(r, 'public.' || t, c, 'SELECT'), format('%s cannot read %s.%s', r, t, c))
  from unnest(array['anon', 'authenticated']) r,
       (values ('coffees', 'created_by'), ('coffees', 'created_at'), ('coffees', 'reviewed_at'), ('coffees', 'match_key'),
               ('coffees', 'name_key'), ('roasters', 'created_by'), ('roasters', 'created_at'), ('roasters', 'match_key')) x(t, c);
set role anon;
select th.ok(th.fails($$select created_at from public.coffees limit 1$$) = '42501', 'anon cannot select created_at');
select th.ok(th.fails($$select * from public.roasters limit 1$$) = '42501', 'anon cannot select every roaster column');
select th.ok(th.fails($$select id, name, reviewed from public.coffees limit 1$$) is null, 'anon reads the product fields');
reset role;

-- 5. Every table in public has RLS on.
select th.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
), 'RLS on every table in public');

-- 6. Every SECURITY DEFINER function in public has a fixed search_path.
select th.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
), 'SECURITY DEFINER functions have a fixed search_path');

-- 7. No SECURITY DEFINER function is open to PUBLIC (every role); each grant is deliberate.
select th.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('public', p.oid, 'EXECUTE')
), 'no SECURITY DEFINER function executable by PUBLIC');

set client_min_messages = warning;
drop schema th cascade;
