-- Espresso and filter versions of a bean are two products.
--
-- Until now roaster + name key alone decided whether two beans are the same, so "House" for espresso
-- and "House" for filter by the same roaster became one bean, for every user. Now the roast profile
-- (roast_for) is part of the identity:
-- * same roaster, same key and same profile (or both without one): the same bean, as before;
-- * a bean without a profile joins another only if that is the only bean of that roaster and key;
-- * a bean with a profile never joins one with a different profile, or one without a profile.
--   A duplicate that has to be merged by hand later is better than two products wrongly made one.
-- The unique index follows: one bean per roaster, key and profile. Existing rows already satisfy it
-- (it is finer than the old one). Mirrors findSameCoffee() in src/lib/community.ts.
--
-- share_coffee() also refuses a name without letters or digits with a data error (22023) instead of
-- P0001, so the app can tell a refused bean from a server problem. The app checks the same before saving.

create or replace function public.find_same_coffee(p_roaster_id uuid, p_key text, p_roast_for text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select c.id from public.coffees c
      where c.roaster_id = p_roaster_id and c.match_key = p_key and c.merged_into is null
        and (c.visibility = 'public' or c.source = 'seed')
        and coalesce(c.roast_for, '') = coalesce(p_roast_for, '')
      order by (c.source = 'seed') desc, c.created_at, c.id
      limit 1),
    (select min(c.id::text)::uuid from public.coffees c
      where coalesce(p_roast_for, '') = ''
        and c.roaster_id = p_roaster_id and c.match_key = p_key and c.merged_into is null
        and (c.visibility = 'public' or c.source = 'seed')
     having count(*) = 1)
  );
$$;

revoke execute on function public.find_same_coffee(uuid, text, text) from public, anon;
grant execute on function public.find_same_coffee(uuid, text, text) to authenticated, service_role;

drop index if exists public.coffees_public_roaster_key_uq;
create unique index coffees_public_roaster_key_variant_uq
  on public.coffees (roaster_id, match_key, coalesce(roast_for, ''))
  where merged_into is null and (visibility = 'public' or source = 'seed');

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
  rfor text := nullif(p_coffee->>'roast_for', '');
  notes text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_coffee->'roaster_notes', '[]'::jsonb)) x), '{}');
  rid uuid;
  cid uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if ckey = '' then
    raise exception 'a coffee needs a name' using errcode = '22023';
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
      -- The new name or roast profile is already another bean of this roaster: keep name, roaster and
      -- profile, take the rest.
      update public.coffees c set
        origin_country = p_coffee->>'origin_country', region = p_coffee->>'region', producer = p_coffee->>'producer',
        process = p_coffee->>'process', variety = p_coffee->>'variety', roast_level = p_coffee->>'roast_level',
        roaster_notes = notes, photo_path = p_coffee->>'photo_path',
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

  -- Same roaster, same key and no contradicting roast profile already in the catalogue: use that bean,
  -- no duplicate. Espresso and filter of the same name stay two beans (see find_same_coffee).
  if rid is not null then
    perform pg_advisory_xact_lock(hashtextextended('coffee:' || rid::text || ':' || ckey, 0));
    cid := public.find_same_coffee(rid, ckey, rfor);
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
