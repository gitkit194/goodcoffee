-- Roast level is never empty (estimated when nobody names it) and the roaster's recipe travels with a bean.
-- User A = …0a (created in before_0006_community_catalog.sql).
create schema rl;
grant usage on schema rl to anon, authenticated;
create function rl.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', msg; end if;
end $$;
grant execute on function rl.ok(boolean, text) to anon, authenticated;

-- Seed: every bean has a level; the ones the roasters state are not marked as estimated.
select rl.ok((select count(*) from public.coffees where roast_level is null) = 0, 'no bean without roast level');
select rl.ok((select count(*) from public.coffees where source = 'seed' and not roast_level_estimated) = 30, 'roast levels stated by roasters');
select rl.ok((select count(*) from public.coffees where source = 'seed' and recipe_dose_g is not null) = 19, 'roaster recipes in the seed');
select rl.ok((select roast_level from public.coffees where source = 'seed' and name = 'Dark Roast') = 'dunkel', 'Bonanza Dark Roast is dark');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- An old app sends no level: the database estimates it from the roast profile.
select public.share_coffee('7c000000-0000-0000-0000-000000000001', null, 'Röstgradrösterei', '{"name": "Ohne Grad", "roast_for": "filter"}');
select rl.ok((select roast_level = 'hell' and roast_level_estimated from public.coffees where id = '7c000000-0000-0000-0000-000000000001'), 'filter without level: estimated light');

-- The roast profile changes: an estimated level follows.
select public.share_coffee('7c000000-0000-0000-0000-000000000001', null, 'Röstgradrösterei', '{"name": "Ohne Grad", "roast_for": "espresso"}');
select rl.ok((select roast_level = 'mittel' and roast_level_estimated from public.coffees where id = '7c000000-0000-0000-0000-000000000001'), 'estimate follows roast_for');

-- A level and recipe from the bag win and are kept.
select public.share_coffee('7c000000-0000-0000-0000-000000000002', null, 'Röstgradrösterei',
  '{"name": "Mit Rezept", "roast_for": "espresso", "roast_level": "dunkel", "roast_level_estimated": false,
    "recipe_dose_g": 18.5, "recipe_yield_g": 40, "recipe_time_s": 28, "recipe_temp_c": 93.5}');
select rl.ok((select roast_level = 'dunkel' and not roast_level_estimated and recipe_dose_g = 18.5 and recipe_yield_g = 40
                     and recipe_time_s = 28 and recipe_temp_c = 93.5
              from public.coffees where id = '7c000000-0000-0000-0000-000000000002'), 'stated level and recipe stored');
select public.share_coffee('7c000000-0000-0000-0000-000000000002', null, 'Röstgradrösterei',
  '{"name": "Mit Rezept", "roast_for": "filter", "roast_level": "dunkel", "roast_level_estimated": false}');
select rl.ok((select roast_level = 'dunkel' and not roast_level_estimated from public.coffees where id = '7c000000-0000-0000-0000-000000000002'), 'stated level does not follow roast_for');

-- The upper bounds the app allows are stored: 100 °C, 30 g, 150 g, 90 s.
select public.share_coffee('7c000000-0000-0000-0000-000000000003', null, 'Röstgradrösterei',
  '{"name": "Grenzwerte", "roast_for": "espresso", "recipe_dose_g": 30, "recipe_yield_g": 150, "recipe_time_s": 90, "recipe_temp_c": 100}');
select rl.ok((select recipe_temp_c = 100 and recipe_dose_g = 30 and recipe_yield_g = 150 and recipe_time_s = 90
              from public.coffees where id = '7c000000-0000-0000-0000-000000000003'), 'upper bounds stored');

-- An old app updates its own bean without the new keys: recipe and estimated mark stay.
select public.share_coffee('7c000000-0000-0000-0000-000000000004', null, 'Röstgradrösterei',
  '{"name": "Alte App", "roast_for": "espresso", "roast_level": "mittel", "roast_level_estimated": true,
    "recipe_dose_g": 18, "recipe_yield_g": 40, "recipe_time_s": 28, "recipe_temp_c": 93.5}');
select public.share_coffee('7c000000-0000-0000-0000-000000000004', null, 'Röstgradrösterei',
  '{"name": "Alte App", "roast_for": "espresso", "roast_level": "mittel", "region": "changed by old app"}');
select rl.ok((select region = 'changed by old app' and roast_level_estimated and recipe_dose_g = 18 and recipe_yield_g = 40
                     and recipe_time_s = 28 and recipe_temp_c = 93.5
              from public.coffees where id = '7c000000-0000-0000-0000-000000000004'), 'old payload keeps recipe and estimated mark');

-- Same, through the branch that keeps name and profile (the new name is another bean of this roaster).
select public.share_coffee('7c000000-0000-0000-0000-000000000004', null, 'Röstgradrösterei',
  '{"name": "Mit Rezept", "roast_for": "filter", "roast_level": "mittel", "region": "fallback"}');
select rl.ok((select name = 'Alte App' and region = 'fallback' and roast_level_estimated and recipe_dose_g = 18 and recipe_temp_c = 93.5
              from public.coffees where id = '7c000000-0000-0000-0000-000000000004'), 'fallback branch keeps recipe and estimated mark');

-- JSON null empties a recipe on purpose; a changed level is no longer estimated.
select public.share_coffee('7c000000-0000-0000-0000-000000000004', null, 'Röstgradrösterei',
  '{"name": "Alte App", "roast_for": "espresso", "roast_level": "dunkel", "recipe_dose_g": null}');
select rl.ok((select recipe_dose_g is null and recipe_yield_g = 40 and roast_level = 'dunkel' and not roast_level_estimated
              from public.coffees where id = '7c000000-0000-0000-0000-000000000004'), 'explicit null empties, changed level is stated');
reset role;

-- The documented way back lets an old payload without a level through again (tried, then undone).
begin;
drop trigger coffees_fill_roast_level on public.coffees;
alter table public.coffees alter column roast_level drop not null;
insert into public.coffees (name, source, visibility) values ('Rückweg ohne Grad', 'user', 'private');
select rl.ok((select roast_level is null from public.coffees where name = 'Rückweg ohne Grad'), 'way back: no level accepted');
rollback;

-- Values the database refuses.
do $$ begin
  update public.coffees set recipe_dose_g = 50 where id = '7c000000-0000-0000-0000-000000000002';
  raise exception 'FAILED: dose 50 g accepted';
exception when check_violation then null;
end $$;
