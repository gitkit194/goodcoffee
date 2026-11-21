-- Roast level always filled, and the roaster's own espresso recipe per bean.
--
-- * roast_level is never empty any more. Where neither the roaster nor the user named it, a trigger
--   estimates it from roast_for (filter and omni roasts are light, espresso roasts and unknown are
--   medium) and marks it with roast_level_estimated = true, so the app can say "estimated". A level the
--   roaster or the user gives always wins; an estimated one follows roast_for when that changes.
--   Old app versions that still send no roast level keep working: the trigger fills it in.
-- * recipe_dose_g, recipe_yield_g, recipe_time_s, recipe_temp_c: the espresso recipe the roaster gives
--   for this bean (bag or shop page). Empty when the roaster gives none. The app starts a new bean's
--   first cup from it. share_coffee() takes the new fields too.
--
-- * share_coffee() updates of an existing bean keep what the payload does not mention: an old app that
--   knows no recipe keys keeps the stored recipe, and an unchanged roast level keeps its estimated mark.
--
-- Way back: drop the trigger, its function and estimate_roast_level(), run
-- `alter table public.coffees alter column roast_level drop not null` (without the trigger, an old
-- payload without a level would fail otherwise), drop the five columns, and restore share_coffee()
-- from 0011_coffee_variants.sql. The estimated levels written here stay in roast_level;
-- the way back does not empty them again.

create or replace function public.estimate_roast_level(p_roast_for text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_roast_for in ('filter', 'omni') then 'hell' else 'mittel' end;
$$;

alter table public.coffees
  add column roast_level_estimated boolean not null default false,
  add column recipe_dose_g numeric(4, 1) check (recipe_dose_g between 5 and 30),
  add column recipe_yield_g numeric(4, 1) check (recipe_yield_g between 5 and 150),
  add column recipe_time_s numeric(3, 0) check (recipe_time_s between 5 and 90),
  add column recipe_temp_c numeric(4, 1) check (recipe_temp_c between 80 and 100);

create or replace function public.fill_roast_level()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.roast_level is null
     or (new.roast_level_estimated and tg_op = 'UPDATE' and new.roast_for is distinct from old.roast_for
         and new.roast_level is not distinct from old.roast_level) then
    new.roast_level := public.estimate_roast_level(new.roast_for);
    new.roast_level_estimated := true;
  end if;
  return new;
end;
$$;

create trigger coffees_fill_roast_level
  before insert or update of roast_level, roast_for, roast_level_estimated on public.coffees
  for each row execute function public.fill_roast_level();

-- Existing beans: estimate what is empty (the seed then sets what the roasters state themselves).
update public.coffees set roast_level = public.estimate_roast_level(roast_for), roast_level_estimated = true
  where roast_level is null;
alter table public.coffees alter column roast_level set not null;

grant insert (roast_level_estimated, recipe_dose_g, recipe_yield_g, recipe_time_s, recipe_temp_c)
  on public.coffees to authenticated;
grant update (roast_level_estimated, recipe_dose_g, recipe_yield_g, recipe_time_s, recipe_temp_c)
  on public.coffees to authenticated;

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
        product_url = p_coffee->>'product_url',
        roast_level_estimated = case
          when p_coffee ? 'roast_level_estimated' then coalesce((p_coffee->>'roast_level_estimated')::boolean, p_coffee->>'roast_level' is null)
          when (p_coffee->>'roast_level') is not distinct from c.roast_level then c.roast_level_estimated
          else p_coffee->>'roast_level' is null end,
        -- A key the payload leaves out keeps the stored value (old apps send no recipe); JSON null empties it.
        recipe_dose_g = case when p_coffee ? 'recipe_dose_g' then (p_coffee->>'recipe_dose_g')::numeric else c.recipe_dose_g end,
        recipe_yield_g = case when p_coffee ? 'recipe_yield_g' then (p_coffee->>'recipe_yield_g')::numeric else c.recipe_yield_g end,
        recipe_time_s = case when p_coffee ? 'recipe_time_s' then (p_coffee->>'recipe_time_s')::numeric else c.recipe_time_s end,
        recipe_temp_c = case when p_coffee ? 'recipe_temp_c' then (p_coffee->>'recipe_temp_c')::numeric else c.recipe_temp_c end
      where c.id = p_id;
    exception when unique_violation then
      -- The new name or roast profile is already another bean of this roaster: keep name, roaster and
      -- profile, take the rest.
      update public.coffees c set
        origin_country = p_coffee->>'origin_country', region = p_coffee->>'region', producer = p_coffee->>'producer',
        process = p_coffee->>'process', variety = p_coffee->>'variety', roast_level = p_coffee->>'roast_level',
        roaster_notes = notes, photo_path = p_coffee->>'photo_path',
        product_url = p_coffee->>'product_url',
        roast_level_estimated = case
          when p_coffee ? 'roast_level_estimated' then coalesce((p_coffee->>'roast_level_estimated')::boolean, p_coffee->>'roast_level' is null)
          when (p_coffee->>'roast_level') is not distinct from c.roast_level then c.roast_level_estimated
          else p_coffee->>'roast_level' is null end,
        -- A key the payload leaves out keeps the stored value (old apps send no recipe); JSON null empties it.
        recipe_dose_g = case when p_coffee ? 'recipe_dose_g' then (p_coffee->>'recipe_dose_g')::numeric else c.recipe_dose_g end,
        recipe_yield_g = case when p_coffee ? 'recipe_yield_g' then (p_coffee->>'recipe_yield_g')::numeric else c.recipe_yield_g end,
        recipe_time_s = case when p_coffee ? 'recipe_time_s' then (p_coffee->>'recipe_time_s')::numeric else c.recipe_time_s end,
        recipe_temp_c = case when p_coffee ? 'recipe_temp_c' then (p_coffee->>'recipe_temp_c')::numeric else c.recipe_temp_c end
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
                              roast_for, roaster_notes, photo_path, product_url, source, visibility, created_by,
                              roast_level_estimated, recipe_dose_g, recipe_yield_g, recipe_time_s, recipe_temp_c)
    values (p_id, rid, cname, p_coffee->>'origin_country', p_coffee->>'region', p_coffee->>'producer',
            p_coffee->>'process', p_coffee->>'variety', p_coffee->>'roast_level', p_coffee->>'roast_for', notes,
            p_coffee->>'photo_path', p_coffee->>'product_url', 'user', 'public', uid,
            coalesce((p_coffee->>'roast_level_estimated')::boolean, p_coffee->>'roast_level' is null),
            (p_coffee->>'recipe_dose_g')::numeric, (p_coffee->>'recipe_yield_g')::numeric,
            (p_coffee->>'recipe_time_s')::numeric, (p_coffee->>'recipe_temp_c')::numeric);
  return query select p_id, rid;
end;
$$;

revoke execute on function public.share_coffee(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.share_coffee(uuid, uuid, text, jsonb) to authenticated;
