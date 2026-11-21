-- GoodCoffee: Bohnen-Katalog (Röstereien, Bohnen, Meine Bohnen)
-- Idee: Der Katalog wächst durch die Nutzer (wie Vivino/Untappd).
-- Start mit Berliner Röstereien als Seed. Bewertung gehört zur Bohne (je Nutzer), nicht zur Tasse.

create extension if not exists pg_trgm with schema extensions;

-- Röstereien
create table public.roasters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  city        text,
  district    text,
  website     text,
  source      text not null default 'user' check (source in ('seed', 'user', 'roaster')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Bohnen (Katalog). Pflicht ist nur der Name.
create table public.coffees (
  id             uuid primary key default gen_random_uuid(),
  roaster_id     uuid references public.roasters (id) on delete set null,
  name           text not null check (length(btrim(name)) > 0),
  name_key       text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  origin_country text,
  region         text,
  producer       text,
  process        text,            -- wie angegeben, z. B. Washed, Natural, Honey, Anaerob
  variety        text,
  roast_level    text check (roast_level in ('hell', 'mittel', 'dunkel')),
  roast_for      text check (roast_for in ('espresso', 'filter', 'omni')),
  roaster_notes  text[] not null default '{}',   -- „Die Rösterei schreibt“
  photo_path     text,
  product_url    text,
  source         text not null default 'user' check (source in ('seed', 'user', 'roaster')),
  visibility     text not null default 'private' check (visibility in ('private', 'public')),
  merged_into    uuid references public.coffees (id) on delete set null,  -- Duplikat zusammengeführt
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Duplikat-Schlüssel: Rösterei + Name, für alles, was alle sehen
create unique index coffees_public_roaster_name_uq
  on public.coffees (roaster_id, name_key)
  where merged_into is null and (visibility = 'public' or source = 'seed');

create index coffees_roaster_idx on public.coffees (roaster_id);
create index coffees_name_trgm on public.coffees using gin (name extensions.gin_trgm_ops);
create index roasters_name_trgm on public.roasters using gin (name extensions.gin_trgm_ops);
create index coffees_created_by_idx on public.coffees (created_by);
create index coffees_merged_into_idx on public.coffees (merged_into);
create index roasters_created_by_idx on public.roasters (created_by);

-- Meine Bohnen: Verbindung Nutzer und Bohne, mit Röstdatum der aktuellen Packung und Bewertung der Bohne
create table public.user_coffees (
  user_id     uuid not null references auth.users (id) on delete cascade,
  coffee_id   uuid not null references public.coffees (id) on delete cascade,
  roast_date  date,
  rating      smallint check (rating between 1 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, coffee_id)
);
create index user_coffees_coffee_idx on public.user_coffees (coffee_id);

-- Zugriff (RLS). Im MVP ohne Anmelde-Screen: anonyme Supabase-Anmeldung liefert trotzdem eine Nutzer-ID.
alter table public.roasters enable row level security;
alter table public.coffees enable row level security;
alter table public.user_coffees enable row level security;

create policy "Röstereien sind für alle lesbar"
  on public.roasters for select using (true);
create policy "Angemeldete legen Röstereien an"
  on public.roasters for insert to authenticated
  with check (created_by = (select auth.uid()) and source = 'user');

create policy "Seed, öffentliche und eigene Bohnen sind lesbar"
  on public.coffees for select
  using (source = 'seed' or visibility = 'public' or created_by = (select auth.uid()));
create policy "Angemeldete legen Bohnen an"
  on public.coffees for insert to authenticated
  with check (created_by = (select auth.uid()) and source = 'user');
create policy "Eigene Bohnen bearbeiten"
  on public.coffees for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()) and source = 'user');

create policy "Eigene Bohnenliste lesen"
  on public.user_coffees for select to authenticated using (user_id = (select auth.uid()));
create policy "Eigene Bohnenliste anlegen"
  on public.user_coffees for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Eigene Bohnenliste ändern"
  on public.user_coffees for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Eigene Bohnenliste löschen"
  on public.user_coffees for delete to authenticated using (user_id = (select auth.uid()));
