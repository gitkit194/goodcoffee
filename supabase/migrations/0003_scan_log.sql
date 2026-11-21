-- One row per bag scan: daily limit per user, and speed/cost numbers for the eval.
create table public.scan_log (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  model text not null,
  ok boolean not null,
  ms integer,
  input_tokens integer,
  output_tokens integer,
  error text
);

create index scan_log_user_day_idx on public.scan_log (user_id, created_at desc);

alter table public.scan_log enable row level security;

create policy "scan_log select own" on public.scan_log
  for select to authenticated using (user_id = (select auth.uid()));

create policy "scan_log insert own" on public.scan_log
  for insert to authenticated with check (user_id = (select auth.uid()));
