-- Beans users added before the community catalogue: private, two of them the same bean.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');
insert into public.roasters (id, name, slug, source, created_by)
  values ('10000000-0000-0000-0000-000000000001', 'Alt Rösterei', 'alt-roesterei', 'user', '00000000-0000-0000-0000-00000000000a');
insert into public.coffees (id, roaster_id, name, source, visibility, created_by, created_at) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Kenia Nyeri', 'user', 'private', '00000000-0000-0000-0000-00000000000a', now() - interval '2 days'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'KENIA  nyeri', 'user', 'private', '00000000-0000-0000-0000-00000000000b', now() - interval '1 day'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Brasil Cerrado', 'user', 'private', '00000000-0000-0000-0000-00000000000b', now());
-- Ratings and cups on both copies: A has both (gaps fill from the merged one), B only the later copy.
insert into public.user_coffees (user_id, coffee_id, rating, comment) values
  ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', null, 'von A'),
  ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000002', 3, null),
  ('00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000002', 4, 'von B');
insert into public.cups (id, user_id, coffee_id, grind) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000002', 10);
