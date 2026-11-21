// Links and images from the shared catalogue come from other users. The app opens or shows only https
// links to real domain names: no tel:, javascript:, intent: or other app schemes, no IP addresses.
// Same rule as isSafeLink() in supabase/functions/_shared/page.ts and public.is_safe_https_url() in the database.

const SAFE_HTTPS = /^https:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\.?(:443)?([/?#][^\s<>"'\\`]*)?$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

export function safeHttpsUrl(u: unknown): string | null {
  return typeof u === 'string' && u.length <= 2048 && !CONTROL.test(u) && SAFE_HTTPS.test(u) ? u : null;
}
