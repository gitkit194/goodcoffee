-- New beans land in the shared catalogue.
--
-- * A bean a user adds is public right away and marked as coming from the community until it is
--   reviewed (reviewed_at stays empty until then; only the service role can set it).
-- * Only the creator may change the master data of a community bean, and only while it is unreviewed.
--   Everyone else can only use it (cups, own list) and rate it (user_coffees, private per user).
-- * Public is only master data: name, roaster, origin, process, variety, the roaster's notes and the
--   roaster's own shop link and product image. Own photos never leave the phone, the roast date of
--   the bag lives in user_coffees, which only its owner can read.
-- * Duplicates: one bean per roaster and match key. The key ignores case, accents/umlauts (ä = ae = a)
--   and spaces, so "Röststätte", "ROESTSTAETTE" and "Rost Statte" are the same. share_coffee()
--   returns the existing bean instead of creating a second one.

-- Mirrors matchKey() in src/lib/community.ts. Upper- and lower-case accents are listed so the result
-- does not depend on the database collation.
create or replace function public.match_key(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      replace(
        lower(translate(coalesce(p, ''),
          'ÁÀÂÃÄÅĀáàâãäåāÉÈÊËĒéèêëēÍÌÎÏíìîïÓÒÔÕÖØóòôõöøÚÙÛÜúùûüÑñÇçŠšŽžČčĆćŁłÝýŹźŻżŚśŃńŐőŰűĚěŘřŇňŤťĎďŮůĘęĄąĞğŞşİı',
          'AAAAAAAaaaaaaaEEEEEeeeeeIIIIiiiiOOOOOOooooooUUUUuuuuNnCcSsZzCcCcLlYyZzZzSsNnOoUuEeRrNnTtDdUuEeAaGgSsIi')),
        'ß', 'ss'),
      '[^a-z0-9]+', '', 'g'),
    '([aou])e', '\1', 'g');
$$;

alter table public.coffees add column match_key text generated always as (public.match_key(name)) stored;
alter table public.roasters add column match_key text generated always as (public.match_key(name)) stored;
alter table public.coffees add column reviewed_at timestamptz;
create index roasters_match_key_idx on public.roasters (match_key);

-- Shop images are https links; a local or storage path (an own photo) must never end up here.
alter table public.coffees add constraint coffees_photo_path_https
  check (source = 'seed' or photo_path is null or photo_path like 'https://%') not valid;

-- Beans users added so far were private. They become part of the catalogue; where two of them (or one
-- and a seed bean) are the same, the later one points to the first and drops out of the catalogue.
with ranked as (
  select id,
         first_value(id) over w as keep,
         row_number() over w as rn
    from public.coffees
    where merged_into is null and roaster_id is not null
    window w as (partition by roaster_id, match_key order by (source = 'seed') desc, created_at, id)
)
update public.coffees c
   set merged_into = r.keep
  from ranked r
 where c.id = r.id and r.rn > 1 and c.source = 'user';

update public.coffees set visibility = 'public' where source = 'user' and visibility = 'private';

-- Moves list entries and cups from merged beans to the bean they were merged into, so ratings and cups
-- count for the bean everyone sees. A user who has both keeps the kept bean's entry, gaps filled from
-- the newest merged one. Also for merges the service role does later; not callable from the app.
create or replace function public.apply_coffee_merges()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Follow chains (a → b → c) so everything ends on a bean that is not merged itself.
  for i in 1..20 loop
    update public.coffees c set merged_into = t.merged_into
      from public.coffees t
     where c.merged_into = t.id and t.merged_into is not null and t.merged_into <> c.id;
    exit when not found;
  end loop;

  insert into public.user_coffees as k (user_id, coffee_id, roast_date, rating, comment, created_at, updated_at)
  select distinct on (d.user_id, c.merged_into)
         d.user_id, c.merged_into, d.roast_date, d.rating, d.comment, d.created_at, now()
    from public.user_coffees d
    join public.coffees c on c.id = d.coffee_id
   where c.merged_into is not null
   order by d.user_id, c.merged_into, d.updated_at desc
  on conflict (user_id, coffee_id) do update set
    roast_date = coalesce(k.roast_date, excluded.roast_date),
    rating = coalesce(k.rating, excluded.rating),
    comment = coalesce(k.comment, excluded.comment),
    created_at = least(k.created_at, excluded.created_at),
    updated_at = now();

  delete from public.user_coffees d using public.coffees c where c.id = d.coffee_id and c.merged_into is not null;
  update public.cups u set coffee_id = c.merged_into from public.coffees c where c.id = u.coffee_id and c.merged_into is not null;
end;
$$;

revoke execute on function public.apply_coffee_merges() from public, anon, authenticated;
grant execute on function public.apply_coffee_merges() to service_role;
do $$ begin perform public.apply_coffee_merges(); end $$;

drop index public.coffees_public_roaster_name_uq;
create unique index coffees_public_roaster_key_uq
  on public.coffees (roaster_id, match_key)
  where merged_into is null and (visibility = 'public' or source = 'seed');

-- Column privileges: clients may write master data, never the review mark or a merge.
revoke insert, update, delete on public.coffees from anon, authenticated;
grant insert (id, roaster_id, name, origin_country, region, producer, process, variety, roast_level, roast_for,
              roaster_notes, photo_path, product_url, source, visibility, created_by)
  on public.coffees to authenticated;
grant update (roaster_id, name, origin_country, region, producer, process, variety, roast_level, roast_for,
              roaster_notes, photo_path, product_url)
  on public.coffees to authenticated;
revoke update, delete on public.roasters from anon, authenticated;

drop policy "Angemeldete legen Bohnen an" on public.coffees;
create policy "Angemeldete legen Bohnen an"
  on public.coffees for insert to authenticated
  with check (created_by = (select auth.uid()) and source = 'user' and reviewed_at is null and merged_into is null);

drop policy "Eigene Bohnen bearbeiten" on public.coffees;
create policy "Nur der Ersteller bearbeitet ungeprüfte Bohnen"
  on public.coffees for update to authenticated
  using (created_by = (select auth.uid()) and source = 'user' and reviewed_at is null)
  with check (created_by = (select auth.uid()) and source = 'user' and reviewed_at is null);

-- Shares one of the caller's beans with the catalogue, or finds the bean that is already there.
-- Runs with the caller's rights, so the policies above apply. Returns the bean and roaster ids the
-- app should use from now on; they differ from the ones sent when the bean already existed.
create or replace function public.share_coffee(p_id uuid, p_roaster_id uuid, p_roaster_name text, p_coffee jsonb)
returns table (coffee_id uuid, roaster_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  rname text := nullif(btrim(coalesce(p_roaster_name, '')), '');
  rkey text := public.match_key(p_roaster_name);
  cname text := btrim(coalesce(p_coffee->>'name', ''));
  ckey text := public.match_key(p_coffee->>'name');
  notes text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_coffee->'roaster_notes', '[]'::jsonb)) x), '{}');
  rid uuid;
  cid uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if ckey = '' then
    raise exception 'a coffee needs a name';
  end if;

  -- Roaster: the one sent if the server knows it, else one with the same key, else a new one.
  if p_roaster_id is not null then
    select r.id into rid from public.roasters r where r.id = p_roaster_id;
  end if;
  if rid is null and rname is not null and rkey <> '' then
    perform pg_advisory_xact_lock(hashtextextended('roaster:' || rkey, 0));
    select r.id into rid from public.roasters r where r.match_key = rkey order by (r.source = 'seed') desc, r.created_at, r.id limit 1;
    if rid is null then
      rid := coalesce(p_roaster_id, gen_random_uuid());
      insert into public.roasters (id, name, slug, source, created_by)
        values (rid, rname, rkey || '-' || left(rid::text, 6), 'user', uid);
    end if;
  end if;

  -- Already shared by this user, but merged into another bean since: the app should use that one.
  select c.merged_into into cid from public.coffees c where c.id = p_id and c.created_by = uid and c.merged_into is not null;
  if cid is not null then
    return query select c.id, c.roaster_id from public.coffees c where c.id = cid;
    return;
  end if;

  -- Already shared by this user: update its master data. RLS skips the row once it is reviewed.
  if exists (select 1 from public.coffees c where c.id = p_id and c.created_by = uid) then
    begin
      update public.coffees c set
        roaster_id = rid, name = cname,
        origin_country = p_coffee->>'origin_country', region = p_coffee->>'region', producer = p_coffee->>'producer',
        process = p_coffee->>'process', variety = p_coffee->>'variety', roast_level = p_coffee->>'roast_level',
        roast_for = p_coffee->>'roast_for', roaster_notes = notes, photo_path = p_coffee->>'photo_path',
        product_url = p_coffee->>'product_url'
      where c.id = p_id;
    exception when unique_violation then
      -- The new name is already another bean of this roaster: keep name and roaster, take the rest.
      update public.coffees c set
        origin_country = p_coffee->>'origin_country', region = p_coffee->>'region', producer = p_coffee->>'producer',
        process = p_coffee->>'process', variety = p_coffee->>'variety', roast_level = p_coffee->>'roast_level',
        roast_for = p_coffee->>'roast_for', roaster_notes = notes, photo_path = p_coffee->>'photo_path',
        product_url = p_coffee->>'product_url'
      where c.id = p_id;
    end;
    return query select c.id, c.roaster_id from public.coffees c where c.id = p_id;
    return;
  end if;
  -- Someone else's bean: only its creator may change it.
  if exists (select 1 from public.coffees c where c.id = p_id) then
    raise exception 'only the creator can change this coffee' using errcode = '42501';
  end if;

  -- Same roaster and same key already in the catalogue: use that bean, no duplicate.
  if rid is not null then
    perform pg_advisory_xact_lock(hashtextextended('coffee:' || rid::text || ':' || ckey, 0));
    select c.id into cid
      from public.coffees c
      where c.roaster_id = rid and c.match_key = ckey and c.merged_into is null
        and (c.visibility = 'public' or c.source = 'seed')
      order by (c.source = 'seed') desc, c.created_at, c.id
      limit 1;
    if cid is not null then
      return query select cid, rid;
      return;
    end if;
  end if;

  insert into public.coffees (id, roaster_id, name, origin_country, region, producer, process, variety, roast_level,
                              roast_for, roaster_notes, photo_path, product_url, source, visibility, created_by)
    values (p_id, rid, cname, p_coffee->>'origin_country', p_coffee->>'region', p_coffee->>'producer',
            p_coffee->>'process', p_coffee->>'variety', p_coffee->>'roast_level', p_coffee->>'roast_for', notes,
            p_coffee->>'photo_path', p_coffee->>'product_url', 'user', 'public', uid);
  return query select p_id, rid;
end;
$$;

revoke execute on function public.share_coffee(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.share_coffee(uuid, uuid, text, jsonb) to authenticated;
