-- Merging duplicates while users keep writing (second review, "Merge gleichzeitig mit Nutzeränderung").
--
-- Before: apply_coffee_merges() read a user's entries, computed the result and then overwrote and deleted
-- them without locking. A change the user committed in between was lost (the delete waited for the
-- user's transaction and then removed the new value). Writes from a phone that still used the old bean id
-- after the merge landed on the merged bean and were left behind there.
--
-- Now:
-- * apply_coffee_merges() locks every entry of a group (FOR UPDATE, in a fixed order) before reading it,
--   so a concurrent change is either already in what it reads or waits until the merge is done. It only
--   deletes the entries it locked and merged.
-- * Late writes to a merged bean are moved to the kept bean (triggers on user_coffees and cups). A late
--   list entry is merged into the kept entry field by field by the same rule (empty never wins; the value
--   set later wins, using the kept entry's per-field times) and logged as kind 'late_write' with the
--   resulting field times, which later merges and late writes use again. The triggers wait for an uncommitted merge of the bean
--   (FOR SHARE on the bean), so they never miss one.
--
-- Way back: drop the two triggers and the three functions below, restore apply_coffee_merges() from
-- 0007_merge_without_loss.sql and the kind check of coffee_merge_log.

alter table public.coffee_merge_log drop constraint coffee_merge_log_kind_check;
alter table public.coffee_merge_log add constraint coffee_merge_log_kind_check
  check (kind in ('user_coffee', 'cups', 'late_write'));

-- The bean a (possibly merged) bean ends on. Waits for an uncommitted merge of that bean.
-- Internal: only the triggers below call it.
create or replace function public.coffee_merge_target(p uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cur uuid;
  nxt uuid;
begin
  select c.merged_into into nxt from public.coffees c where c.id = p for share;
  cur := p;
  for i in 1..20 loop
    exit when nxt is null or nxt = cur;
    cur := nxt;
    select c.merged_into into nxt from public.coffees c where c.id = cur;
  end loop;
  return cur;
end;
$$;
revoke execute on function public.coffee_merge_target(uuid) from public, anon, authenticated;

create or replace function public.redirect_merged_user_coffee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  orig uuid := new.coffee_id;
  tgt uuid;
  k public.user_coffees;
  res public.user_coffees;
  ft jsonb;
  kc text;
  nc text := nullif(btrim(new.comment), '');
  t_rating timestamptz;
  t_comment timestamptz;
  t_roast timestamptz;
  v_rating smallint;
  v_comment text;
  v_roast date;
  times jsonb := '{}'::jsonb;
begin
  tgt := public.coffee_merge_target(new.coffee_id);
  if tgt is null or tgt = new.coffee_id then
    return new;
  end if;
  -- Runs with the owner's rights: only ever act on the caller's own entries. Anything else goes on
  -- unchanged and the row-level policies refuse it. (No uid: the service role, which may.)
  if auth.uid() is not null and auth.uid() is distinct from new.user_id then
    return new;
  end if;

  new.coffee_id := tgt;
  select * into k from public.user_coffees d where d.user_id = new.user_id and d.coffee_id = tgt for update;
  if not found then
    return new;
  end if;

  -- An entry for the kept bean exists: combine field by field, by the same rule as the merge.
  -- Each field of the kept entry counts as of when it was set (field_times of the merge or late write
  -- that produced it, while the entry is unchanged since), else as of the entry's updated_at.
  select l.field_times into ft from public.coffee_merge_log l
   where l.kind in ('user_coffee', 'late_write') and l.user_id = k.user_id and l.into_coffee_id = k.coffee_id
     and (l.result->>'updated_at')::timestamptz = k.updated_at
   order by l.id desc limit 1;
  kc := nullif(btrim(k.comment), '');
  t_rating := coalesce((ft->>'rating')::timestamptz, k.updated_at);
  t_comment := coalesce((ft->>'comment')::timestamptz, k.updated_at);
  t_roast := coalesce((ft->>'roast_date')::timestamptz, k.updated_at);

  -- Empty never wins; otherwise the later value wins, on a tie the kept entry's.
  if new.rating is not null and (k.rating is null or new.updated_at > t_rating) then
    v_rating := new.rating; t_rating := new.updated_at;
  else
    v_rating := k.rating;
  end if;
  if nc is not null and (kc is null or new.updated_at > t_comment) then
    v_comment := nc; t_comment := new.updated_at;
  else
    v_comment := kc;
  end if;
  if new.roast_date is not null and (k.roast_date is null or new.updated_at > t_roast) then
    v_roast := new.roast_date; t_roast := new.updated_at;
  else
    v_roast := k.roast_date;
  end if;
  if v_rating is not null then times := times || jsonb_build_object('rating', t_rating); end if;
  if v_comment is not null then times := times || jsonb_build_object('comment', t_comment); end if;
  if v_roast is not null then times := times || jsonb_build_object('roast_date', t_roast); end if;

  update public.user_coffees d set
    rating = v_rating, comment = v_comment, roast_date = v_roast,
    created_at = least(k.created_at, new.created_at),
    updated_at = greatest(k.updated_at, new.updated_at)
  where d.user_id = k.user_id and d.coffee_id = k.coffee_id
  returning * into res;

  insert into public.coffee_merge_log (kind, user_id, into_coffee_id, from_coffee_ids, before, sources, result, field_times)
  values ('late_write', new.user_id, tgt, array[orig], to_jsonb(k),
          jsonb_build_array(to_jsonb(new) || jsonb_build_object('coffee_id', orig)), to_jsonb(res), times);
  return null;
end;
$$;
revoke execute on function public.redirect_merged_user_coffee() from public, anon, authenticated;

create trigger user_coffees_redirect_merged
  before insert on public.user_coffees
  for each row execute function public.redirect_merged_user_coffee();

create or replace function public.redirect_merged_cup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.coffee_id := coalesce(public.coffee_merge_target(new.coffee_id), new.coffee_id);
  return new;
end;
$$;
revoke execute on function public.redirect_merged_cup() from public, anon, authenticated;

create trigger cups_redirect_merged
  before insert or update of coffee_id on public.cups
  for each row execute function public.redirect_merged_cup();

-- The merge itself, now locking what it reads.
create or replace function public.apply_coffee_merges()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
  v_keys uuid[];
  v_before jsonb;
  v_sources jsonb;
  v_from uuid[];
  v_rating smallint;
  v_comment text;
  v_roast date;
  v_created timestamptz;
  v_updated timestamptz;
  v_conflicts jsonb;
  v_times jsonb;
begin
  -- Follow chains (a → b → c) so everything ends on a bean that is not merged itself.
  for i in 1..20 loop
    update public.coffees c set merged_into = t.merged_into
      from public.coffees t
     where c.merged_into = t.id and t.merged_into is not null and t.merged_into <> c.id;
    exit when not found;
  end loop;

  -- List entries: one merge per user and kept bean, over all entries involved.
  for g in
    select distinct d.user_id, c.merged_into as target
      from public.user_coffees d
      join public.coffees c on c.id = d.coffee_id
     where c.merged_into is not null
     order by 1, 2
  loop
    -- Lock the group first (fixed order), then read: a concurrent change is either in or waits.
    select array_agg(x.coffee_id order by x.coffee_id) into v_keys
      from (select d.coffee_id
              from public.user_coffees d
              left join public.coffees c on c.id = d.coffee_id
             where d.user_id = g.user_id and (d.coffee_id = g.target or c.merged_into = g.target)
             order by d.coffee_id
               for update of d) x;
    continue when v_keys is null or not exists (select 1 from unnest(v_keys) k where k <> g.target);

    select to_jsonb(d) into v_before
      from public.user_coffees d where d.user_id = g.user_id and d.coffee_id = g.target;
    select jsonb_agg(to_jsonb(d) order by d.updated_at, d.coffee_id), array_agg(d.coffee_id order by d.updated_at, d.coffee_id)
      into v_sources, v_from
      from public.user_coffees d
     where d.user_id = g.user_id and d.coffee_id = any(v_keys) and d.coffee_id <> g.target;

    with o as (
      select d.coffee_id, d.rating, nullif(btrim(d.comment), '') as comment, d.roast_date, d.created_at, d.updated_at,
             d.coffee_id = g.target as is_target,
             -- Unchanged result of an earlier merge: its per-field times.
             (select l.field_times from public.coffee_merge_log l
               where l.kind in ('user_coffee', 'late_write') and l.user_id = d.user_id and l.into_coffee_id = d.coffee_id
                 and (l.result->>'updated_at')::timestamptz = d.updated_at
               order by l.id desc limit 1) as ft
        from public.user_coffees d
       where d.user_id = g.user_id and d.coffee_id = any(v_keys)
    ), e as (
      select o.*,
             coalesce((o.ft->>'rating')::timestamptz, o.updated_at) as rating_t,
             coalesce((o.ft->>'comment')::timestamptz, o.updated_at) as comment_t,
             coalesce((o.ft->>'roast_date')::timestamptz, o.updated_at) as roast_t
        from o
    ), r as (select * from e where rating is not null order by rating_t desc, is_target desc, coffee_id limit 1),
       k as (select * from e where comment is not null order by comment_t desc, is_target desc, coffee_id limit 1),
       t as (select * from e where roast_date is not null order by roast_t desc, is_target desc, coffee_id limit 1)
    select
      (select r.rating from r), (select k.comment from k), (select t.roast_date from t),
      (select min(e.created_at) from e),
      (select max(e.updated_at) from e),
      jsonb_strip_nulls(jsonb_build_object(
        'rating', (select case when count(distinct e.rating) > 1 then jsonb_agg(jsonb_build_object(
                     'coffee_id', e.coffee_id, 'value', e.rating, 'set_at', e.rating_t) order by e.rating_t) end
                     from e where e.rating is not null),
        'comment', (select case when count(distinct e.comment) > 1 then jsonb_agg(jsonb_build_object(
                     'coffee_id', e.coffee_id, 'value', e.comment, 'set_at', e.comment_t) order by e.comment_t) end
                     from e where e.comment is not null),
        'roast_date', (select case when count(distinct e.roast_date) > 1 then jsonb_agg(jsonb_build_object(
                     'coffee_id', e.coffee_id, 'value', e.roast_date, 'set_at', e.roast_t) order by e.roast_t) end
                     from e where e.roast_date is not null))),
      jsonb_strip_nulls(jsonb_build_object(
        'rating', (select r.rating_t from r), 'comment', (select k.comment_t from k), 'roast_date', (select t.roast_t from t)))
      into v_rating, v_comment, v_roast, v_created, v_updated, v_conflicts, v_times;

    insert into public.user_coffees as k (user_id, coffee_id, roast_date, rating, comment, created_at, updated_at)
      values (g.user_id, g.target, v_roast, v_rating, v_comment, v_created, v_updated)
    on conflict (user_id, coffee_id) do update set
      roast_date = excluded.roast_date,
      rating = excluded.rating,
      comment = excluded.comment,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at;

    insert into public.coffee_merge_log (kind, user_id, into_coffee_id, from_coffee_ids, before, sources, result, conflicts, field_times)
    select 'user_coffee', g.user_id, g.target, v_from, v_before, v_sources, to_jsonb(d), nullif(v_conflicts, '{}'::jsonb), v_times
      from public.user_coffees d where d.user_id = g.user_id and d.coffee_id = g.target;

    -- Only what was locked and merged above.
    delete from public.user_coffees d
     where d.user_id = g.user_id and d.coffee_id = any(v_keys) and d.coffee_id <> g.target;
  end loop;

  -- Cups keep all their data; only the bean changes. Lock them, log which cup came from which bean, move.
  perform 1 from public.cups u join public.coffees c on c.id = u.coffee_id
   where c.merged_into is not null order by u.id for update of u;
  insert into public.coffee_merge_log (kind, user_id, into_coffee_id, from_coffee_ids, sources)
  select 'cups', u.user_id, c.merged_into, array_agg(distinct u.coffee_id),
         jsonb_agg(jsonb_build_object('id', u.id, 'coffee_id', u.coffee_id) order by u.brewed_at, u.id)
    from public.cups u join public.coffees c on c.id = u.coffee_id
   where c.merged_into is not null
   group by u.user_id, c.merged_into;
  update public.cups u set coffee_id = c.merged_into from public.coffees c where c.id = u.coffee_id and c.merged_into is not null;
end;
$$;

revoke execute on function public.apply_coffee_merges() from public, anon, authenticated;
grant execute on function public.apply_coffee_merges() to service_role;
