-- Hardening before launch: the API roles keep only the table rights the app really uses.
--
-- Supabase gives anon and authenticated every right on new tables by default; row level security then
-- decides which rows they see. That is one safety net. This migration adds the second: rights a client
-- never needs are taken away, so a missing or wrong policy can't open them up.
--
-- * TRUNCATE, TRIGGER and REFERENCES: no client needs them. TRUNCATE in particular ignores RLS.
--   Also for tables created later (default privileges of the migration role).
-- * anon is a request without a session. The app signs in anonymously before it writes anything, so
--   anon only reads the public catalogue (coffees, roasters) and the rating numbers of a bean.
-- * profiles: nobody deletes their profile through the API (it goes with the account), so no DELETE.
-- * scan_log and the scan functions are handled in their own migration (AI limits) and left alone here.
--
-- Every SECURITY DEFINER function in public already has a fixed, empty search_path;
-- supabase/tests/hardening.test.sql checks that this stays so.

do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- anon: read the catalogue, nothing else.
revoke insert, update, delete on public.coffees, public.roasters from anon;
revoke all on public.cups, public.profiles, public.user_coffees from anon;

-- authenticated: profiles have no delete policy and need no delete right.
revoke delete on public.profiles from authenticated;
