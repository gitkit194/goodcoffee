-- Tables for the logging app: comment on the bean, user profile, cups (one brew each).

alter table public.user_coffees add column if not exists comment text;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  grinder text,
  default_visibility text not null default 'private' check (default_visibility in ('private', 'friends', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Eigenes Profil lesen" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "Eigenes Profil anlegen" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "Eigenes Profil ändern" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create table public.cups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  coffee_id uuid not null references public.coffees (id),
  brewed_at timestamptz not null default now(),
  grind numeric(5, 1),
  dose_g numeric(5, 1) check (dose_g > 0),
  yield_g numeric(6, 1) check (yield_g > 0),
  time_s smallint check (time_s >= 0),
  extraction smallint check (extraction between 0 and 10),
  sweetness smallint check (sweetness between 0 and 10),
  acidity smallint check (acidity between 0 and 10),
  body smallint check (body between 0 and 10),
  aromas text[] not null default '{}',
  visibility text not null default 'private' check (visibility in ('private', 'friends', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cups_user_brewed_idx on public.cups (user_id, brewed_at desc);
create index cups_coffee_idx on public.cups (coffee_id);
alter table public.cups enable row level security;
create policy "Eigene Tassen lesen" on public.cups for select to authenticated using (user_id = (select auth.uid()));
create policy "Eigene Tassen anlegen" on public.cups for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Eigene Tassen ändern" on public.cups for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Eigene Tassen löschen" on public.cups for delete to authenticated using (user_id = (select auth.uid()));
