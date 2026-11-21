-- Espresso and filter versions of a bean stay two beans; the same version still finds itself.
-- Two users, A = …0a and B = …0b (created in before_0006_community_catalog.sql).
create schema v;
grant usage on schema v to anon, authenticated;
create function v.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', msg; end if;
end $$;
grant execute on function v.ok(boolean, text) to anon, authenticated;
create function v.fails(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on function v.fails(text) to anon, authenticated;
create table v.ids (k text primary key, v uuid);
grant all on v.ids to anon, authenticated;

set role authenticated;

-- A shares "House" for espresso with a new roaster.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into v.ids select 'esp', coffee_id from public.share_coffee(
  '7a000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000001', 'Variantenrösterei',
  '{"name": "House", "roast_for": "espresso"}');
select v.ok((select v from v.ids where k = 'esp') = '7a000000-0000-0000-0000-000000000001', 'espresso bean created');

-- A adds "House" for filter of the same roaster: a second bean, not the espresso one.
insert into v.ids select 'fil', coffee_id from public.share_coffee(
  '7a000000-0000-0000-0000-000000000002', '7b000000-0000-0000-0000-000000000001', 'Variantenrösterei',
  '{"name": "House", "roast_for": "filter"}');
select v.ok((select v from v.ids where k = 'fil') = '7a000000-0000-0000-0000-000000000002', 'filter bean is its own bean');

-- B, on another phone, adds the same two products spelled differently: each finds its own version.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select v.ok((select coffee_id from public.share_coffee(gen_random_uuid(), null, 'VARIANTENROESTEREI', '{"name": "house", "roast_for": "filter"}'))
            = '7a000000-0000-0000-0000-000000000002', 'B''s filter joins the filter bean');
select v.ok((select coffee_id from public.share_coffee(gen_random_uuid(), null, 'variantenrösterei', '{"name": "HOUSE", "roast_for": "espresso"}'))
            = '7a000000-0000-0000-0000-000000000001', 'B''s espresso joins the espresso bean');

-- Without a profile and two versions to choose from, nothing is guessed: a bean of its own.
insert into v.ids select 'none', coffee_id from public.share_coffee(
  '7a000000-0000-0000-0000-000000000003', null, 'Variantenrösterei', '{"name": "House"}');
select v.ok((select v from v.ids where k = 'none') = '7a000000-0000-0000-0000-000000000003', 'no profile, two versions: no guess');
-- … and the next one without a profile finds that one.
select v.ok((select coffee_id from public.share_coffee(gen_random_uuid(), null, 'Variantenrösterei', '{"name": "house "}'))
            = '7a000000-0000-0000-0000-000000000003', 'no profile joins the bean without profile');

-- Without a profile and only one version, it is that one (as before).
insert into v.ids select 'solo', coffee_id from public.share_coffee(
  '7a000000-0000-0000-0000-000000000004', '7b000000-0000-0000-0000-000000000002', 'Einzelrösterei',
  '{"name": "Blend", "roast_for": "espresso"}');
select v.ok((select coffee_id from public.share_coffee(gen_random_uuid(), null, 'Einzelrösterei', '{"name": "BLEND"}'))
            = '7a000000-0000-0000-0000-000000000004', 'no profile, one version: joins it');
-- A profile never joins a different one, even if it is the only one.
select v.ok((select coffee_id from public.share_coffee(gen_random_uuid(), null, 'Einzelrösterei', '{"name": "Blend", "roast_for": "filter"}'))
            <> '7a000000-0000-0000-0000-000000000004', 'filter never joins espresso');

reset role;
select v.ok((select count(*) from public.coffees where roaster_id = '7b000000-0000-0000-0000-000000000001' and merged_into is null) = 3,
            'three House beans: espresso, filter, without profile');
-- The index allows the versions side by side but still no second bean of the same version.
select v.ok(v.fails($$insert into public.coffees (roaster_id, name, roast_for, source, visibility)
                      values ('7b000000-0000-0000-0000-000000000001', 'HOUSE', 'filter', 'user', 'public')$$) = '23505',
            'one bean per roaster, key and profile');

-- A name the match key turns into nothing is refused as bad data (the app checks this before saving).
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select v.ok(v.fails($$select public.share_coffee(gen_random_uuid(), null, 'Variantenrösterei', '{"name": "☕"}')$$) = '22023', 'emoji-only name refused as data error');
reset role;
