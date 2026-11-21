-- Community rating per coffee. user_coffees stays readable only by its owner (RLS); this function hands
-- out nothing but the sum and the number of other users' ratings. The caller's own rating is left out,
-- because the app adds its local (possibly not yet synced) rating itself, so the number is right at once.

create or replace function public.coffee_rating_stats(p_coffee_id uuid)
returns table (rating_sum bigint, rating_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(uc.rating), 0)::bigint, count(uc.rating)::bigint
    from public.user_coffees uc
    where uc.coffee_id = p_coffee_id
      and uc.rating is not null
      and uc.user_id is distinct from auth.uid()
      -- Only for coffees the caller may see anyway (same rule as the coffees select policy).
      and exists (
        select 1 from public.coffees c
          where c.id = p_coffee_id
            and (c.source = 'seed' or c.visibility = 'public' or c.created_by = auth.uid())
      );
$$;

revoke execute on function public.coffee_rating_stats(uuid) from public;
grant execute on function public.coffee_rating_stats(uuid) to anon, authenticated;
