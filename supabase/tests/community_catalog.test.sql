-- Community catalogue: sharing, duplicates, who may edit what, what stays private.
-- Users: A = …0a, B = …0b (created in before_0006_community_catalog.sql).
create schema t;
grant usage on schema t to anon, authenticated;
create function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', msg; end if;
end $$;
grant execute on function t.ok(boolean, text) to anon, authenticated;
-- Runs a statement and returns the SQLSTATE it failed with, or null.
create function t.fails(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on function t.fails(text) to anon, authenticated;
create table t.ids (k text primary key, v uuid);
grant all on t.ids to anon, authenticated;

-- 1. The match key ignores case, umlauts and spaces.
select t.ok(public.match_key('Röststätte') = public.match_key('ROESTSTAETTE'), 'ö = oe, ä = ae');
select t.ok(public.match_key('Röststätte') = public.match_key('Rost Statte'), 'umlaut = plain vowel, spaces');
select t.ok(public.match_key('Kaffee Kirsche') = public.match_key('kaffeekirsche'), 'spaces');
select t.ok(public.match_key('Corazón de Jesús') = public.match_key('corazon de jesus'), 'accents');
select t.ok(public.match_key('Großvater') = public.match_key('grossvater'), 'ß');
select t.ok(public.match_key('Aponte Espresso') <> public.match_key('Aponte Filter'), 'different beans stay different');

-- 2. Old private beans became public; the later duplicate points to the first.
select t.ok((select visibility from public.coffees where id = '20000000-0000-0000-0000-000000000001') = 'public', 'old bean published');
select t.ok((select merged_into from public.coffees where id = '20000000-0000-0000-0000-000000000002') = '20000000-0000-0000-0000-000000000001', 'old duplicate merged');
select t.ok((select merged_into is null and visibility = 'public' from public.coffees where id = '20000000-0000-0000-0000-000000000003'), 'old unique bean public');
-- Ratings and cups moved to the kept bean.
select t.ok((select count(*) from public.user_coffees where coffee_id = '20000000-0000-0000-0000-000000000002') = 0, 'no entries left on the merged bean');
select t.ok((select rating = 3 and comment = 'von A' from public.user_coffees
              where user_id = '00000000-0000-0000-0000-00000000000a' and coffee_id = '20000000-0000-0000-0000-000000000001'), 'A''s two entries merged');
select t.ok((select rating = 4 and comment = 'von B' from public.user_coffees
              where user_id = '00000000-0000-0000-0000-00000000000b' and coffee_id = '20000000-0000-0000-0000-000000000001'), 'B''s entry moved');
select t.ok((select coffee_id from public.cups where id = '50000000-0000-0000-0000-000000000001') = '20000000-0000-0000-0000-000000000001', 'cup moved');
-- The owner of the merged copy gets the kept bean when the phone shares it again.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select t.ok((select coffee_id from public.share_coffee('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', null, '{"name": "KENIA  nyeri"}'))
            = '20000000-0000-0000-0000-000000000001', 'share of a merged bean returns the kept one');
-- The phone can see which of its beans were merged.
select t.ok((select merged_into from public.coffees where id = '20000000-0000-0000-0000-000000000002') = '20000000-0000-0000-0000-000000000001', 'merge readable by owner');
select t.ok(t.fails('select public.apply_coffee_merges()') = '42501', 'app cannot run merges');
reset role;

-- 3. A shares a new bean with a new roaster.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into t.ids select 'a', coffee_id from public.share_coffee(
  '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Röststätte Neukölln',
  '{"name": "Äthiopien Guji Natural", "origin_country": "Äthiopien", "process": "Natural", "variety": "Heirloom",
    "roaster_notes": ["Blaubeere", "Jasmin"], "photo_path": "https://shop.example/guji.png", "product_url": "https://shop.example/products/guji"}');
select t.ok((select v from t.ids where k = 'a') = '30000000-0000-0000-0000-000000000001', 'new bean keeps its id');

-- 4. B finds it, marked as community (source user, not reviewed).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select t.ok((select count(*) from public.coffees where id = '30000000-0000-0000-0000-000000000001'
              and source = 'user' and not reviewed and visibility = 'public') = 1, 'B sees A''s community bean');
select t.ok((select count(*) from public.roasters where name = 'Röststätte Neukölln') = 1, 'B sees the new roaster');

-- 5. B scans the same bag, spelled differently: gets A's bean and roaster, no duplicate.
insert into t.ids select 'b', coffee_id from public.share_coffee(
  '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'ROESTSTAETTE neukölln',
  '{"name": "aethiopien  GUJI natural", "roaster_notes": []}');
select t.ok((select v from t.ids where k = 'b') = '30000000-0000-0000-0000-000000000001', 'B gets A''s bean');
reset role;
select t.ok((select count(*) from public.coffees where match_key = public.match_key('Äthiopien Guji Natural')) = 1, 'no duplicate bean');
select t.ok((select count(*) from public.roasters where match_key = public.match_key('Röststätte Neukölln')) = 1, 'no duplicate roaster');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
-- B's sharing of a seed bean returns the seed bean.
select t.ok((select coffee_id from public.share_coffee(gen_random_uuid(), null, 'kaffeekirsche', '{"name": "APONTE espresso"}'))
            = (select c.id from public.coffees c join public.roasters r on r.id = c.roaster_id
                where r.slug = 'kaffeekirsche' and c.name = 'Aponte Espresso'), 'seed bean reused');

-- 6. Only the creator edits master data. B's update changes nothing, through the table or the function.
update public.coffees set name = 'Hijacked' where id = '30000000-0000-0000-0000-000000000001';
select t.ok(t.fails($$select public.share_coffee('30000000-0000-0000-0000-000000000001', null, 'Röststätte Neukölln', '{"name": "Hijacked"}')$$) = '42501', 'B cannot edit through the function');
reset role;
select t.ok((select name from public.coffees where id = '30000000-0000-0000-0000-000000000001') = 'Äthiopien Guji Natural', 'B cannot edit A''s bean');
set role authenticated;
-- Nobody but the service role sets the review mark or merges.
select t.ok(t.fails($$update public.coffees set reviewed_at = now() where id = '30000000-0000-0000-0000-000000000001'$$) = '42501', 'B cannot review');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select t.ok(t.fails($$update public.coffees set reviewed_at = now() where id = '30000000-0000-0000-0000-000000000001'$$) = '42501', 'A cannot review');
select t.ok(t.fails($$insert into public.coffees (name, source, created_by, reviewed_at) values ('X', 'user', auth.uid(), now())$$) = '42501', 'no reviewed insert');
select t.ok(t.fails($$delete from public.coffees where id = '30000000-0000-0000-0000-000000000001'$$) = '42501', 'no deletes');

-- A can edit, through the function too.
select public.share_coffee('30000000-0000-0000-0000-000000000001', null, 'Röststätte Neukölln',
  '{"name": "Äthiopien Guji Natural", "origin_country": "Äthiopien", "process": "Natural", "variety": "74110"}');
select t.ok((select variety from public.coffees where id = '30000000-0000-0000-0000-000000000001') = '74110', 'A edits own bean');

-- After review even the creator can no longer change it.
reset role;
update public.coffees set reviewed_at = now() where id = '30000000-0000-0000-0000-000000000001';
set role authenticated;
update public.coffees set variety = 'Changed' where id = '30000000-0000-0000-0000-000000000001';
reset role;
select t.ok((select variety from public.coffees where id = '30000000-0000-0000-0000-000000000001') = '74110', 'reviewed bean is locked');
set role authenticated;

-- 7. Private stays private: roast date and rating live in user_coffees, readable only by their owner.
insert into public.user_coffees (user_id, coffee_id, roast_date, rating)
  values (auth.uid(), '30000000-0000-0000-0000-000000000001', '2026-10-20', 4);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select t.ok((select count(*) from public.user_coffees where user_id <> auth.uid()) = 0, 'B cannot see A''s roast date or rating');
-- B can use and rate A's bean.
insert into public.user_coffees (user_id, coffee_id, rating) values (auth.uid(), '30000000-0000-0000-0000-000000000001', 5);
insert into public.cups (coffee_id, grind) values ('30000000-0000-0000-0000-000000000001', 12);
select t.ok((select count(*) from public.user_coffees where coffee_id = '30000000-0000-0000-0000-000000000001') = 1, 'B rates A''s bean');
-- An own photo (a local or storage path) is refused as bean photo.
select t.ok(t.fails($$select public.share_coffee(gen_random_uuid(), null, null, '{"name": "Lokal", "photo_path": "file:///var/mobile/photo.jpg"}')$$) = '23514', 'no local photo');
-- A second public bean with the same key, inserted directly, is refused.
select t.ok(t.fails($$insert into public.coffees (roaster_id, name, source, visibility, created_by)
  select roaster_id, 'ÄTHIOPIEN GUJI NATURAL', 'user', 'public', auth.uid() from public.coffees where id = '30000000-0000-0000-0000-000000000001'$$) = '23505', 'unique per roaster and key');

-- 8. Signed-out visitors can read the catalogue but not share.
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select t.ok((select count(*) from public.coffees where id = '30000000-0000-0000-0000-000000000001') = 1, 'anon reads catalogue');
select t.ok(t.fails($$select public.share_coffee(gen_random_uuid(), null, null, '{"name": "X"}')$$) = '42501', 'anon cannot share');
reset role;
