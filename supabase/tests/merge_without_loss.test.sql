-- Merging duplicates keeps every value (security review finding). Rule: empty never wins, on a real
-- conflict the most recently changed value wins, everything is logged in coffee_merge_log.
create schema tm;
create function tm.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', msg; end if;
end $$;
grant usage on schema tm to authenticated;
grant execute on function tm.ok(boolean, text) to authenticated;

-- User D, one roaster, beans K* (kept) and M* (duplicates merged into them).
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000d');
insert into public.roasters (id, name, slug, source)
  values ('10000000-0000-0000-0000-00000000000d', 'Merge Rösterei', 'merge-roesterei', 'seed');
insert into public.coffees (id, roaster_id, name, source, visibility) values
  ('6000000a-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000d', 'Fall eins', 'seed', 'public'),
  ('6000000b-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000d', 'Fall eins a', 'user', 'private'),
  ('6000000b-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000d', 'Fall eins b', 'user', 'private'),
  ('6000000a-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000d', 'Fall zwei', 'seed', 'public'),
  ('6000000b-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000d', 'Fall zwei a', 'user', 'private'),
  ('6000000a-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000d', 'Fall drei', 'seed', 'public'),
  ('6000000b-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000d', 'Fall drei a', 'user', 'private'),
  ('6000000a-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000d', 'Kette mitte', 'user', 'private'),
  ('6000000a-0000-0000-0000-000000000005', '10000000-0000-0000-0000-00000000000d', 'Kette ende', 'seed', 'public'),
  ('6000000b-0000-0000-0000-000000000005', '10000000-0000-0000-0000-00000000000d', 'Kette anfang', 'user', 'private');

insert into public.user_coffees (user_id, coffee_id, rating, comment, roast_date, created_at, updated_at) values
  -- 1. The reviewer's case: older complete entry, newer empty duplicate, no entry on the kept bean.
  ('00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000001', 5, 'alt und vollständig', '2026-10-01', now() - interval '5 days', now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000002', null, '  ', null, now() - interval '1 day', now() - interval '1 day'),
  -- 2. Existing entry on the kept bean: older rating there, newer rating on the duplicate, blank comment there.
  ('00000000-0000-0000-0000-00000000000d', '6000000a-0000-0000-0000-000000000002', 2, 'vom Ziel', '2026-09-01', now() - interval '9 days', now() - interval '3 days'),
  ('00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000003', 4, '', null, now() - interval '4 days', now() - interval '1 day'),
  -- 3. Existing entry on the kept bean is the newer one: it keeps its rating.
  ('00000000-0000-0000-0000-00000000000d', '6000000a-0000-0000-0000-000000000003', 3, null, null, now() - interval '2 days', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000004', 5, 'älter', '2026-08-01', now() - interval '6 days', now() - interval '6 days'),
  -- 4. Chain, first step: complete entry on the bean that is merged first.
  ('00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000005', 4, 'Kette', '2026-10-10', now() - interval '7 days', now() - interval '7 days');
insert into public.cups (id, user_id, coffee_id, grind) values
  ('7000000d-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000001', 10),
  ('7000000d-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000002', 11),
  ('7000000d-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000d', '6000000a-0000-0000-0000-000000000001', 12),
  ('7000000d-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000005', 13);

-- The service role merges; chain step one: anfang → mitte.
update public.coffees set merged_into = '6000000a-0000-0000-0000-000000000001' where id in ('6000000b-0000-0000-0000-000000000001', '6000000b-0000-0000-0000-000000000002');
update public.coffees set merged_into = '6000000a-0000-0000-0000-000000000002' where id = '6000000b-0000-0000-0000-000000000003';
update public.coffees set merged_into = '6000000a-0000-0000-0000-000000000003' where id = '6000000b-0000-0000-0000-000000000004';
update public.coffees set merged_into = '6000000a-0000-0000-0000-000000000004' where id = '6000000b-0000-0000-0000-000000000005';
select public.apply_coffee_merges();

-- 1. Nothing of the older complete entry is lost to the newer empty one.
select tm.ok((select rating = 5 and comment = 'alt und vollständig' and roast_date = '2026-10-01'
               from public.user_coffees where user_id = '00000000-0000-0000-0000-00000000000d' and coffee_id = '6000000a-0000-0000-0000-000000000001'),
             'older complete entry survives a newer empty duplicate');
select tm.ok((select created_at < now() - interval '4 days' from public.user_coffees
               where user_id = '00000000-0000-0000-0000-00000000000d' and coffee_id = '6000000a-0000-0000-0000-000000000001'), 'earliest added date kept');
select tm.ok((select count(*) from public.cups where coffee_id = '6000000a-0000-0000-0000-000000000001') = 3, 'all cups on the kept bean');

-- 2. Existing target entry: the newer rating wins, the old one is in the log; blank never replaces text.
select tm.ok((select rating = 4 and comment = 'vom Ziel' and roast_date = '2026-09-01'
               from public.user_coffees where user_id = '00000000-0000-0000-0000-00000000000d' and coffee_id = '6000000a-0000-0000-0000-000000000002'),
             'newer rating wins, empty fields do not overwrite the kept entry');
select tm.ok((select before->>'rating' = '2' and conflicts->'rating'->0->>'value' = '2' and conflicts->'rating'->1->>'value' = '4'
                     and sources->0->>'coffee_id' = '6000000b-0000-0000-0000-000000000003' and result->>'rating' = '4'
               from public.coffee_merge_log where kind = 'user_coffee' and into_coffee_id = '6000000a-0000-0000-0000-000000000002'),
             'old value, merged entry and conflict are logged');

-- 3. The kept bean's own newer value wins; the duplicate's older values fill the gaps.
select tm.ok((select rating = 3 and comment = 'älter' and roast_date = '2026-08-01'
               from public.user_coffees where user_id = '00000000-0000-0000-0000-00000000000d' and coffee_id = '6000000a-0000-0000-0000-000000000003'),
             'newer target value wins, gaps filled from the older duplicate');

-- 4. Second merge on top of the first (mitte → ende), where ende already has a newer empty entry.
insert into public.user_coffees (user_id, coffee_id, created_at, updated_at)
  values ('00000000-0000-0000-0000-00000000000d', '6000000a-0000-0000-0000-000000000005', now(), now());
update public.coffees set merged_into = '6000000a-0000-0000-0000-000000000005' where id = '6000000a-0000-0000-0000-000000000004';
select public.apply_coffee_merges();
select tm.ok((select merged_into from public.coffees where id = '6000000b-0000-0000-0000-000000000005') = '6000000a-0000-0000-0000-000000000005', 'chain followed');
select tm.ok((select rating = 4 and comment = 'Kette' and roast_date = '2026-10-10'
               from public.user_coffees where user_id = '00000000-0000-0000-0000-00000000000d' and coffee_id = '6000000a-0000-0000-0000-000000000005'),
             'values survive two merges and an empty existing entry');
select tm.ok((select coffee_id from public.cups where id = '7000000d-0000-0000-0000-000000000004') = '6000000a-0000-0000-0000-000000000005', 'cup follows both merges');
select tm.ok((select count(*) from public.coffee_merge_log where kind = 'user_coffee' and into_coffee_id in
               ('6000000a-0000-0000-0000-000000000004', '6000000a-0000-0000-0000-000000000005')) = 2, 'both merges logged');
select tm.ok((select count(*) from public.user_coffees u join public.coffees c on c.id = u.coffee_id where c.merged_into is not null) = 0, 'no entries left on merged beans');

-- Cups are fully accounted for and logged with their origin.
select tm.ok((select count(*) from public.cups where user_id = '00000000-0000-0000-0000-00000000000d') = 4, 'no cup lost');
select tm.ok((select sources @> '[{"id": "7000000d-0000-0000-0000-000000000001", "coffee_id": "6000000b-0000-0000-0000-000000000001"}]'
               from public.coffee_merge_log where kind = 'cups' and into_coffee_id = '6000000a-0000-0000-0000-000000000001'), 'cup origin logged');

-- 5. The reviewer's three-entry case: target 1 (01.10.), duplicate A 2 (02.10.), duplicate B 5 (03.10.) → 5.
--    Same data as the app test; both must agree.
insert into public.coffees (id, roaster_id, name, source, visibility) values
  ('6000000a-0000-0000-0000-000000000006', '10000000-0000-0000-0000-00000000000d', 'Drei Ziel', 'seed', 'public'),
  ('6000000b-0000-0000-0000-000000000006', '10000000-0000-0000-0000-00000000000d', 'Drei a', 'user', 'private'),
  ('6000000b-0000-0000-0000-000000000007', '10000000-0000-0000-0000-00000000000d', 'Drei b', 'user', 'private');
insert into public.user_coffees (user_id, coffee_id, rating, comment, roast_date, updated_at) values
  ('00000000-0000-0000-0000-00000000000d', '6000000a-0000-0000-0000-000000000006', 1, 'Ziel', null, '2026-10-01 10:00Z'),
  ('00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000006', 2, '', '2026-09-20', '2026-10-02 10:00Z'),
  ('00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000007', 5, null, null, '2026-10-03 10:00Z');
update public.coffees set merged_into = '6000000a-0000-0000-0000-000000000006'
 where id in ('6000000b-0000-0000-0000-000000000006', '6000000b-0000-0000-0000-000000000007');
select public.apply_coffee_merges();
select tm.ok((select rating = 5 and comment = 'Ziel' and roast_date = '2026-09-20' and updated_at = '2026-10-03 10:00Z'
               from public.user_coffees where user_id = '00000000-0000-0000-0000-00000000000d' and coffee_id = '6000000a-0000-0000-0000-000000000006'),
             'three entries: every field decided over all originals; the merge keeps the newest original time');

-- 6. A later merge decides by when each value was set: rating 4 from 01.10. and comment from 05.10.
--    were merged first; then rating 3 from 03.10. joins and wins over the older 4.
insert into public.coffees (id, roaster_id, name, source, visibility) values
  ('6000000a-0000-0000-0000-000000000007', '10000000-0000-0000-0000-00000000000d', 'Zeit Ziel', 'seed', 'public'),
  ('6000000b-0000-0000-0000-000000000008', '10000000-0000-0000-0000-00000000000d', 'Zeit a', 'user', 'private'),
  ('6000000b-0000-0000-0000-000000000009', '10000000-0000-0000-0000-00000000000d', 'Zeit z', 'user', 'private');
insert into public.user_coffees (user_id, coffee_id, rating, comment, updated_at) values
  ('00000000-0000-0000-0000-00000000000d', '6000000a-0000-0000-0000-000000000007', 4, null, '2026-10-01 10:00Z'),
  ('00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000008', null, 'neu', '2026-10-05 10:00Z'),
  ('00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000009', 3, null, '2026-10-03 10:00Z');
update public.coffees set merged_into = '6000000a-0000-0000-0000-000000000007' where id = '6000000b-0000-0000-0000-000000000008';
select public.apply_coffee_merges();
select tm.ok((select rating = 4 and comment = 'neu' from public.user_coffees
               where user_id = '00000000-0000-0000-0000-00000000000d' and coffee_id = '6000000a-0000-0000-0000-000000000007'), 'first merge');
update public.coffees set merged_into = '6000000a-0000-0000-0000-000000000007' where id = '6000000b-0000-0000-0000-000000000009';
select public.apply_coffee_merges();
select tm.ok((select rating = 3 and comment = 'neu' from public.user_coffees
               where user_id = '00000000-0000-0000-0000-00000000000d' and coffee_id = '6000000a-0000-0000-0000-000000000007'),
             'later merge: the rating set on 03.10. beats the one from 01.10., despite the merged entry''s newer time');
select tm.ok((select conflicts->'rating'->0->>'value' = '4' and conflicts->'rating'->1->>'value' = '3'
               from public.coffee_merge_log where kind = 'user_coffee' and into_coffee_id = '6000000a-0000-0000-0000-000000000007'
               order by id desc limit 1), 'conflict logged with the time each value was set');

-- Running it again changes nothing.
create temp table snap as select * from public.user_coffees where user_id = '00000000-0000-0000-0000-00000000000d';
create temp table logcount as select count(*) n from public.coffee_merge_log;
select public.apply_coffee_merges();
select tm.ok((select count(*) from public.coffee_merge_log) = (select n from logcount), 're-run logs nothing');
select tm.ok(not exists ((select * from public.user_coffees where user_id = '00000000-0000-0000-0000-00000000000d') except (select * from snap)), 're-run changes nothing');

-- The log holds private ratings of several users: the app can neither read nor write it.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $$ begin
  perform 1 from public.coffee_merge_log;
  raise exception 'FAILED: app can read the merge log';
exception when insufficient_privilege then null;
end $$;
reset role;

-- Late writes to a merged bean (phone still on the old id) land on the kept bean by the same rule.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
-- Older than the kept entry: fills nothing that is there, changes nothing.
insert into public.user_coffees (user_id, coffee_id, rating, comment, updated_at)
  values (auth.uid(), '6000000b-0000-0000-0000-000000000002', 1, 'veraltet', now() - interval '10 days');
-- Newer: its rating wins, its empty comment does not.
insert into public.user_coffees (user_id, coffee_id, rating, comment, updated_at)
  values (auth.uid(), '6000000b-0000-0000-0000-000000000002', 2, null, now());
select tm.ok((select rating = 2 and comment = 'alt und vollständig' and roast_date = '2026-10-01'
               from public.user_coffees where coffee_id = '6000000a-0000-0000-0000-000000000001'), 'late writes merged by the rule');
select tm.ok((select count(*) from public.user_coffees where coffee_id = '6000000b-0000-0000-0000-000000000002') = 0, 'nothing left on the merged bean');
-- Someone else cannot use the redirect to change D's entry.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  insert into public.user_coffees (user_id, coffee_id, rating, updated_at)
    values ('00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000002', 1, now() + interval '1 day');
  raise exception 'FAILED: B wrote to D''s entry';
exception when insufficient_privilege then null;
end $$;
reset role;
select tm.ok((select rating = 2 from public.user_coffees
               where user_id = '00000000-0000-0000-0000-00000000000d' and coffee_id = '6000000a-0000-0000-0000-000000000001'), 'D''s entry unchanged by B');
select tm.ok((select count(*) from public.coffee_merge_log where kind = 'late_write' and into_coffee_id = '6000000a-0000-0000-0000-000000000001') = 2, 'late writes logged');

-- Late writes decide field by field: rating 2 from 01.10. and a note from 03.10. were
-- merged; a late upload with rating 5 from 02.10. must win over the older rating, not lose to the note.
insert into public.coffees (id, roaster_id, name, source, visibility) values
  ('6000000a-0000-0000-0000-000000000009', '10000000-0000-0000-0000-00000000000d', 'Feld Ziel', 'seed', 'public'),
  ('6000000b-0000-0000-0000-000000000010', '10000000-0000-0000-0000-00000000000d', 'Feld b', 'user', 'private'),
  ('6000000b-0000-0000-0000-000000000011', '10000000-0000-0000-0000-00000000000d', 'Feld c', 'user', 'private');
insert into public.user_coffees (user_id, coffee_id, rating, comment, updated_at) values
  ('00000000-0000-0000-0000-00000000000d', '6000000a-0000-0000-0000-000000000009', 2, null, '2026-10-01 10:00Z'),
  ('00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000010', null, 'newer note', '2026-10-03 10:00Z'),
  ('00000000-0000-0000-0000-00000000000d', '6000000b-0000-0000-0000-000000000011', 4, null, '2026-10-02 12:00Z');
update public.coffees set merged_into = '6000000a-0000-0000-0000-000000000009' where id = '6000000b-0000-0000-0000-000000000010';
select public.apply_coffee_merges();
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
insert into public.user_coffees (user_id, coffee_id, rating, comment, updated_at)
  values (auth.uid(), '6000000b-0000-0000-0000-000000000010', 5, null, '2026-10-02 10:00Z')
  on conflict (user_id, coffee_id) do update set rating = excluded.rating, comment = excluded.comment, updated_at = excluded.updated_at;
select tm.ok((select rating = 5 and comment = 'newer note' and updated_at = '2026-10-03 10:00Z'
               from public.user_coffees where coffee_id = '6000000a-0000-0000-0000-000000000009'),
             'late rating from 02.10. beats the rating from 01.10. despite the note from 03.10.');
-- An even later upload that is still older than that rating changes nothing.
insert into public.user_coffees (user_id, coffee_id, rating, updated_at)
  values (auth.uid(), '6000000b-0000-0000-0000-000000000010', 3, '2026-10-01 12:00Z');
select tm.ok((select rating = 5 from public.user_coffees where coffee_id = '6000000a-0000-0000-0000-000000000009'),
             'field times of the late write are used again');
reset role;
select tm.ok((select field_times->>'rating' = to_jsonb('2026-10-02 10:00Z'::timestamptz)->>0
                     and field_times->>'comment' = to_jsonb('2026-10-03 10:00Z'::timestamptz)->>0
               from public.coffee_merge_log where kind = 'late_write' and into_coffee_id = '6000000a-0000-0000-0000-000000000009'
               order by id desc limit 1), 'late write logs its field times');
-- A later merge uses them too: rating 4 from 02.10. 12:00 is newer than 5 from 02.10. 10:00.
update public.coffees set merged_into = '6000000a-0000-0000-0000-000000000009' where id = '6000000b-0000-0000-0000-000000000011';
select public.apply_coffee_merges();
select tm.ok((select rating = 4 and comment = 'newer note' from public.user_coffees
               where user_id = '00000000-0000-0000-0000-00000000000d' and coffee_id = '6000000a-0000-0000-0000-000000000009'),
             'a later merge decides by the late write''s field times');
