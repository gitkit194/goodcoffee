-- Community URLs (0008_community_urls.sql): unsafe product links, foreign photo hosts and
-- unsafe roaster websites are refused when saving, through share_coffee and through direct writes.
-- Users: A = …0a, B = …0b (created in before_0006_community_catalog.sql).
create schema if not exists u;
grant usage on schema u to anon, authenticated;
create or replace function u.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', msg; end if;
end $$;
create or replace function u.fails(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on all functions in schema u to anon, authenticated;

-- The rule itself.
select u.ok(public.is_safe_https_url('https://thebarn.de/products/a?x=1#y'), 'normal shop link');
select u.ok(public.is_safe_https_url(null), 'no link is fine');
select u.ok(not public.is_safe_https_url(x), 'refused: ' || x) from unnest(array[
  'tel:+4930123', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'intent://x#Intent;end', 'mailto:a@b.de', 'sms:1',
  'data:text/html,<b>', 'file:///etc/passwd', 'whatsapp://send', 'http://thebarn.de/', ' https://thebarn.de/',
  'https://127.0.0.1/', 'https://localhost/', 'https://[::1]/', 'https://user:pw@thebarn.de/',
  'https://thebarn.de@evil.example/', 'https://thebarn.de:8443/', 'https://thebarn.de/a b', 'https://thebarn.de/"x',
  'https://thebarn.de\@evil.example/', E'https://thebarn.de/\nx', 'https://thebarn.de/' || repeat('a', 2100)]) x;
select u.ok(public.url_site('https://shop.berliner-kaffeeroesterei.de/x') = 'berliner-kaffeeroesterei.de', 'site');
select u.ok(public.url_site('https://a.b.co.uk/') = 'b.co.uk', 'site co.uk');
select u.ok(public.is_trusted_photo('https://www.fathercarpenter.com/a.png', 'https://fathercarpenter.com/p'), 'same site photo');
select u.ok(public.is_trusted_photo('https://cdn.shopify.com/s/a.png', 'https://thebarn.de/p'), 'shop CDN photo');
select u.ok(not public.is_trusted_photo('https://tracker.example/p.gif', 'https://thebarn.de/p'), 'foreign photo host');
select u.ok(not public.is_trusted_photo('https://thebarn.de/a.png', null), 'photo without a product link must be on a shop CDN');
-- Scheme in any case: the answer is false, never null (a CHECK lets null through).
select u.ok(public.is_trusted_photo('HTTPS://tracker.example/pixel', 'https://shop.example/bean') is false, 'uppercase scheme, foreign host: false');
select u.ok(public.is_trusted_photo('HtTpS://tracker.example/pixel', null) is false, 'mixed-case scheme, no product link: false');
select u.ok(public.is_trusted_photo('HTTPS://cdn.shopify.com/s/a.png', null) is true, 'uppercase scheme, shop CDN: true');
select u.ok(public.is_trusted_photo('HTTPS://shop.example/a.png', 'https://shop.example/bean') is true, 'uppercase scheme, same site: true');

-- Through the app's way of saving (share_coffee), as user A.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select u.ok(u.fails(format($$select public.share_coffee(gen_random_uuid(), null, 'URL-Test Rösterei', %L)$$,
  jsonb_build_object('name', 'Bohne ' || x, 'product_url', x))) = '23514', 'share refuses product_url ' || x)
  from unnest(array['tel:+4930123', 'javascript:alert(1)', 'intent://x#Intent;end', 'http://shop.example/a', 'https://10.0.0.1/a']) x;
select u.ok(u.fails($$select public.share_coffee(gen_random_uuid(), null, 'URL-Test Rösterei',
  '{"name": "Fremdbild", "product_url": "https://shop.example/p", "photo_path": "https://tracker.example/p.gif"}')$$) = '23514', 'share refuses a foreign photo host');
select u.ok(u.fails($$select public.share_coffee(gen_random_uuid(), null, 'URL-Test Rösterei',
  '{"name": "Gute Bohne", "product_url": "https://shop.example/p/gut", "photo_path": "https://img.shop.example/gut.png"}')$$) is null, 'a normal shop link and photo are saved');

-- Direct writes with the column privileges the app has.
select u.ok(u.fails($$insert into public.coffees (id, name, product_url, source, visibility, created_by)
  values (gen_random_uuid(), 'Direkt', 'tel:+4930', 'user', 'public', '00000000-0000-0000-0000-00000000000a')$$) = '23514', 'insert refuses tel:');
select u.ok(u.fails($$update public.coffees set product_url = 'javascript:alert(1)' where name = 'Gute Bohne'$$) = '23514', 'update refuses javascript:');
select u.ok(u.fails($$insert into public.coffees (id, name, source, created_by, visibility, product_url, photo_path)
  values (gen_random_uuid(), 'Bypass', 'user', '00000000-0000-0000-0000-00000000000a', 'public', 'https://shop.example/bean', 'HTTPS://tracker.example/pixel')$$) = '23514', 'insert refuses uppercase scheme with foreign photo host');
select u.ok(u.fails($$insert into public.coffees (id, name, source, created_by, visibility, photo_path)
  values (gen_random_uuid(), 'Bypass ohne Link', 'user', '00000000-0000-0000-0000-00000000000a', 'public', 'HtTpS://shop.example/a.png')$$) = '23514', 'insert refuses mixed-case photo without product link');
select u.ok(u.fails($$update public.coffees set photo_path = 'HTTPS://tracker.example/pixel' where name = 'Gute Bohne'$$) = '23514', 'update refuses uppercase scheme with foreign photo host');
select u.ok(u.fails($$insert into public.roasters (id, name, slug, website, source, created_by)
  values (gen_random_uuid(), 'Evil', 'evil-x', 'javascript:alert(1)', 'user', '00000000-0000-0000-0000-00000000000a')$$) = '23514', 'roaster website refused');
reset role;

-- Seed data passes (it is curated; photo hosts are exempt there).
select u.ok((select count(*) from public.coffees where not public.is_safe_https_url(product_url)) = 0, 'every product link in the catalogue is safe');

-- Rows from before the migration were cleaned up, nothing else changed.
select u.ok((select product_url is null from public.coffees where id = '60000000-0000-0000-0000-000000000001'), 'old tel: link removed');
select u.ok((select photo_path is null and product_url = 'https://shop.example/p' from public.coffees where id = '60000000-0000-0000-0000-000000000002'), 'old foreign photo removed, link kept');
select u.ok((select photo_path is null and product_url = 'https://shop.example/r' from public.coffees where id = '60000000-0000-0000-0000-000000000004'), 'old uppercase-scheme foreign photo removed, link kept');
select u.ok((select photo_path = 'https://shop.example/q.png' and product_url = 'https://shop.example/q' from public.coffees where id = '60000000-0000-0000-0000-000000000003'), 'fine bean untouched');
select u.ok((select website is null from public.roasters where id = '10000000-0000-0000-0000-000000000009'), 'old unsafe roaster website removed');
