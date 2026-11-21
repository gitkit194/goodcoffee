-- Community beans saved before the URL rules: an app-scheme link, a foreign photo host, a fine one.
insert into public.coffees (id, name, product_url, photo_path, source, visibility, created_by) values
  ('60000000-0000-0000-0000-000000000001', 'Alt tel', 'tel:+4930123', null, 'user', 'public', '00000000-0000-0000-0000-00000000000a'),
  ('60000000-0000-0000-0000-000000000002', 'Alt Fremdbild', 'https://shop.example/p', 'https://tracker.example/p.gif', 'user', 'public', '00000000-0000-0000-0000-00000000000a'),
  ('60000000-0000-0000-0000-000000000003', 'Alt gut', 'https://shop.example/q', 'https://shop.example/q.png', 'user', 'public', '00000000-0000-0000-0000-00000000000b');
insert into public.roasters (id, name, slug, website, source, created_by)
  values ('10000000-0000-0000-0000-000000000009', 'Alt Evil', 'alt-evil', 'javascript:alert(1)', 'user', '00000000-0000-0000-0000-00000000000a');
-- A row from before the photo check existed at all (that check was added "not valid"), with the scheme
-- in upper case and a foreign host: the cleanup must not skip it.
alter table public.coffees drop constraint coffees_photo_path_https;
insert into public.coffees (id, name, product_url, photo_path, source, visibility, created_by) values
  ('60000000-0000-0000-0000-000000000004', 'Alt HTTPS Fremdbild', 'https://shop.example/r', 'HTTPS://tracker.example/pixel', 'user', 'public', '00000000-0000-0000-0000-00000000000a');
alter table public.coffees add constraint coffees_photo_path_https
  check (source = 'seed' or photo_path is null or photo_path like 'https://%') not valid;
