-- Community URLs: what users put into the shared catalogue must be safe to open and to show.
--
-- * product_url (all beans) and website (roasters users add): https to a real domain name only. tel:,
--   javascript:, intent:, mailto:, data:, IP addresses, localhost, user:password@ and odd characters are
--   refused when saving. Same rule as isSafeLink() (edge functions) and safeHttpsUrl() (app).
-- * photo_path of community beans: the same, and the photo must come from the shop the product link
--   points to (same site) or from that shop system's image CDN. A photo from any other host is refused:
--   showing it would tell that host who looks at the catalogue. Seed data is curated and stays exempt.
-- * Rows that break the rule are cleaned up first (link or photo removed, the bean stays).

create or replace function public.is_safe_https_url(p text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is null or (
    length(p) <= 2048
    and p !~ '[[:cntrl:]]'
    and p ~* '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\.?(:443)?([/?#][^[:space:]<>"''\\`]*)?$'
  );
$$;

-- The registrable part of a URL's host, roughly: "shop.thebarn.de" → "thebarn.de", "a.b.co.uk" → "b.co.uk".
-- Mirrors site() in supabase/functions/_shared/page.ts.
create or replace function public.url_site(p text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  host text := rtrim(lower(substring(p from '^[a-zA-Z]+://([^/:?#]+)')), '.');
  labels text[];
  n int;
  keep int := 2;
begin
  if host is null or host = '' then
    return null;
  end if;
  labels := string_to_array(host, '.');
  n := cardinality(labels);
  if n >= 3 and length(labels[n]) = 2 and labels[n - 1] in ('co', 'com', 'org', 'net', 'ac', 'or', 'gv', 'gov', 'edu') then
    keep := 3;
  end if;
  return array_to_string(labels[greatest(1, n - keep + 1):n], '.');
end;
$$;

-- Rule for foreign image hosts (see trustedImage() in page.ts). Always true or false, never null: a CHECK
-- lets null through, and the scheme may be written in any case (HTTPS://…), so the host is taken case-blind.
create or replace function public.is_trusted_photo(photo text, product text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select photo is null or coalesce(
    public.is_safe_https_url(photo)
    and (
      (product is not null and public.is_safe_https_url(product) and public.url_site(photo) = public.url_site(product))
      or rtrim(lower(substring(photo from '^[hH][tT][tT][pP][sS]://([^/:?#]+)')), '.') in ('cdn.shopify.com', 'images.squarespace-cdn.com', 'static.wixstatic.com')
    ),
    false
  );
$$;

-- Clean up what is already there (test data so far), so the checks below hold for every row.
update public.coffees set product_url = null where public.is_safe_https_url(product_url) is not true;
update public.coffees set photo_path = null where source <> 'seed' and public.is_trusted_photo(photo_path, product_url) is not true;
update public.roasters set website = null where source <> 'seed' and public.is_safe_https_url(website) is not true;

alter table public.coffees add constraint coffees_product_url_safe check (public.is_safe_https_url(product_url) is true);
alter table public.coffees drop constraint coffees_photo_path_https;
alter table public.coffees add constraint coffees_photo_path_trusted
  check (source = 'seed' or public.is_trusted_photo(photo_path, product_url) is true);
alter table public.roasters add constraint roasters_website_safe
  check (source = 'seed' or public.is_safe_https_url(website) is true);
