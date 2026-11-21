-- Merging duplicate beans keeps every value (security review, finding "Datenverlust beim Zusammenführen").
--
-- Before: apply_coffee_merges() took only the newest entry among a user's merged copies and then only
-- filled gaps in the kept bean's entry. An older complete entry next to a newer empty one lost its
-- rating, comment and roast date; on a real conflict the kept bean's value won even if it was older.
--
-- Now, per user and kept bean, all entries (the kept bean's own one and those of every bean merged
-- into it) are considered together:
-- * Empty never wins: a missing rating, comment (also blank text) or roast date never replaces a value.
-- * Real conflict: the value set most recently wins (on a tie the kept bean's entry, then the lowest id).
--   An entry's values count as of its updated_at; an entry that is itself the unchanged result of an
--   earlier merge counts per field as of when that value was set (field_times in the log), so a merge
--   never makes old values look new. The result keeps the newest original updated_at.
-- * Everything is logged in coffee_merge_log: the kept entry before, every merged entry as it was, the
--   result, and the conflicting values. Moved cups are logged with the bean they came from.
--   That is enough to undo a merge (see the rollback in the pull request).
--
-- Way back: re-run the previous definition of apply_coffee_merges() from
-- 0006_community_catalog.sql and drop table public.coffee_merge_log.

create table public.coffee_merge_log (
  id bigint generated always as identity primary key,
  merged_at timestamptz not null default now(),
  kind text not null check (kind in ('user_coffee', 'cups')),
  user_id uuid not null,               -- no foreign key: the log outlives a deleted account until reviewed
  into_coffee_id uuid not null,
  from_coffee_ids uuid[] not null,
  before jsonb,                        -- the kept bean's entry before the merge, null if there was none
  sources jsonb not null,              -- merged entries (or cups: id and old bean) exactly as they were
  result jsonb,                        -- the kept bean's entry after the merge
  conflicts jsonb,                     -- field → all differing non-empty values, oldest first
  field_times jsonb                    -- field → when the value in result was set (for later merges)
);
create index coffee_merge_log_into_idx on public.coffee_merge_log (into_coffee_id);
create index coffee_merge_log_user_idx on public.coffee_merge_log (user_id);

-- Only the service role reads it: it holds private ratings and comments of several users.
alter table public.coffee_merge_log enable row level security;
revoke all on public.coffee_merge_log from public, anon, authenticated;
grant select, insert on public.coffee_merge_log to service_role;

create or replace function public.apply_coffee_merges()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
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
  loop
    select to_jsonb(d) into v_before
      from public.user_coffees d where d.user_id = g.user_id and d.coffee_id = g.target;
    select jsonb_agg(to_jsonb(d) order by d.updated_at, d.coffee_id), array_agg(d.coffee_id order by d.updated_at, d.coffee_id)
      into v_sources, v_from
      from public.user_coffees d join public.coffees c on c.id = d.coffee_id
     where d.user_id = g.user_id and c.merged_into = g.target;

    with o as (
      select d.coffee_id, d.rating, nullif(btrim(d.comment), '') as comment, d.roast_date, d.created_at, d.updated_at,
             d.coffee_id = g.target as is_target,
             -- Unchanged result of an earlier merge: its per-field times.
             (select l.field_times from public.coffee_merge_log l
               where l.kind = 'user_coffee' and l.user_id = d.user_id and l.into_coffee_id = d.coffee_id
                 and (l.result->>'updated_at')::timestamptz = d.updated_at
               order by l.id desc limit 1) as ft
        from public.user_coffees d
        left join public.coffees c on c.id = d.coffee_id
       where d.user_id = g.user_id and (d.coffee_id = g.target or c.merged_into = g.target)
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

    delete from public.user_coffees d using public.coffees c
     where c.id = d.coffee_id and d.user_id = g.user_id and c.merged_into = g.target;
  end loop;

  -- Cups keep all their data; only the bean changes. Log which cup came from which bean.
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
do $$ begin perform public.apply_coffee_merges(); end $$;
