#!/usr/bin/env bash
# Runs all migrations and the seed on a throwaway local Postgres, then the SQL tests in supabase/tests.
# Needs the Postgres server binaries (initdb, pg_ctl) and psql; nothing touches the real project.
set -euo pipefail
cd "$(dirname "$0")/.."

BIN=${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
[ -x "$BIN/initdb" ] || { echo "Postgres server binaries not found; set PG_BIN" >&2; exit 1; }

DIR=$(mktemp -d)
trap '"$BIN/pg_ctl" -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
OWNER=$(id -un)
if [ "$(id -u)" = 0 ]; then
  OWNER=postgres
  chown postgres "$DIR"
  RUN=(runuser -u postgres --)
else
  RUN=()
fi

"${RUN[@]}" "$BIN/initdb" -D "$DIR/data" -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null
"${RUN[@]}" "$BIN/pg_ctl" -D "$DIR/data" -o "-k $DIR -c listen_addresses=''" -l "$DIR/log" start -w >/dev/null

PSQL=(psql -h "$DIR" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  # Optional data a test needs to exist before a migration runs (e.g. rows that migration converts).
  before="supabase/tests/before_$(basename "$f")"
  [ -f "$before" ] && "${PSQL[@]}" -f "$before"
  "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -f supabase/seed.sql >/dev/null
for f in supabase/tests/*.test.sql; do
  echo "# $f"
  "${PSQL[@]}" -o /dev/null -f "$f"
done
# Parallel requests against the AI limits: real concurrent sessions, not one after the other.
claim() { "${PSQL[@]}" -A -t -c "set role service_role; select coalesce(id::text, 'refused:' || refused) from public.claim_ai_call('$1', 'scan', 'gpt')"; }
"${PSQL[@]}" -c "delete from public.scan_log; update public.ai_budget set per_user_day = 5, per_user_minute = 100, global_day = 1000 where kind = 'scan'"
for i in $(seq 1 20); do claim 00000000-0000-0000-0000-00000000000a > "$DIR/p_$i" & done; wait
granted=$(cat "$DIR"/p_* | grep -vc refused || true)
echo "# parallel: one user, limit 5, 20 requests at once -> $granted granted"
[ "$granted" = 5 ] || { echo "FAILED: per-user limit under parallel requests" >&2; exit 1; }
rm -f "$DIR"/p_*
"${PSQL[@]}" -c "delete from public.scan_log; update public.ai_budget set per_user_day = 100, per_user_minute = 100, global_day = 10 where kind = 'scan'"
"${PSQL[@]}" -c "insert into auth.users (id) select ('00000000-0000-0000-0000-2' || lpad(g::text, 11, '0'))::uuid from generate_series(1, 30) g on conflict do nothing"
for i in $(seq 1 30); do claim "00000000-0000-0000-0000-2$(printf %011d "$i")" > "$DIR/p_$i" & done; wait
granted=$(cat "$DIR"/p_* | grep -vc refused || true)
echo "# parallel: 30 new accounts at once, global budget 10 -> $granted granted"
[ "$granted" = 10 ] || { echo "FAILED: global budget under parallel requests" >&2; exit 1; }
"${PSQL[@]}" -c "delete from public.scan_log; update public.ai_budget set per_user_day = 40, per_user_minute = 6, global_day = 500"
# Two phones add the same bean at the same moment, in espresso and filter: real concurrent sessions.
# The same version must end up as one bean, the two versions as two.
share() { "${PSQL[@]}" -A -t -c "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false); select coffee_id from public.share_coffee(gen_random_uuid(), null, 'Parallelrösterei', '{\"name\": \"Gleichzeitig\", \"roast_for\": \"$2\"}')" | tail -1; }
for i in $(seq 1 10); do
  u="00000000-0000-0000-0000-2$(printf %011d "$i")"
  share "$u" espresso > "$DIR/s_e_$i" &
  share "$u" filter > "$DIR/s_f_$i" &
done; wait
esp=$(sort -u "$DIR"/s_e_* | grep -c . || true)
fil=$(sort -u "$DIR"/s_f_* | grep -c . || true)
both=$(cat "$DIR"/s_e_* "$DIR"/s_f_* | sort -u | grep -c . || true)
echo "# parallel: 10 users share espresso and filter of one bean at once -> $esp espresso id(s), $fil filter id(s), $both in total"
[ "$esp" = 1 ] && [ "$fil" = 1 ] && [ "$both" = 2 ] || { echo "FAILED: concurrent sharing of bean versions" >&2; exit 1; }
# Merging duplicates while the user writes: two real connections, interleaved on purpose.
E=00000000-0000-0000-0000-00000000000e
as_user() { printf "set role authenticated; select set_config('request.jwt.claim.sub', '%s', false);\n%s\n" "$E" "$1" | "${PSQL[@]}" -o /dev/null -f -; }
"${PSQL[@]}" -o /dev/null <<SQL
insert into auth.users (id) values ('$E');
insert into public.roasters (id, name, slug, source) values ('10000000-0000-0000-0000-00000000000e', 'Race Rösterei', 'race-roesterei', 'seed');
insert into public.coffees (id, roaster_id, name, source, visibility, created_by) values
  ('8000000a-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000e', 'Race eins', 'seed', 'public', null),
  ('8000000b-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000e', 'Race eins b', 'user', 'private', '$E'),
  ('8000000a-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000e', 'Race zwei', 'seed', 'public', null),
  ('8000000b-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000e', 'Race zwei b', 'user', 'private', '$E');
insert into public.user_coffees (user_id, coffee_id, rating, comment, updated_at) values
  ('$E', '8000000b-0000-0000-0000-000000000001', 3, 'alt', now() - interval '2 days'),
  ('$E', '8000000a-0000-0000-0000-000000000002', null, 'behalten', now() - interval '3 days'),
  ('$E', '8000000b-0000-0000-0000-000000000002', 2, null, now() - interval '2 days');
SQL
# 1. The user changes the note and commits while the merge runs: the change must survive.
as_user "begin; update public.user_coffees set comment = 'neu', updated_at = now() where coffee_id = '8000000b-0000-0000-0000-000000000001'; select pg_sleep(2); commit;" &
sleep 0.7
"${PSQL[@]}" -o /dev/null -c "update public.coffees set merged_into = '8000000a-0000-0000-0000-000000000001' where id = '8000000b-0000-0000-0000-000000000001'" -c "select public.apply_coffee_merges()"
wait
got=$("${PSQL[@]}" -A -t -c "select coalesce(comment, '-') || '/' || coalesce(rating::text, '-') from public.user_coffees where user_id = '$E' and coffee_id = '8000000a-0000-0000-0000-000000000001'")
echo "# race: note changed during the merge -> $got"
[ "$got" = "neu/3" ] || { echo "FAILED: a change made during the merge was lost" >&2; exit 1; }
# 2. The phone still writes to the old bean id (list entry and a cup) while the merge is not yet committed.
"${PSQL[@]}" -o /dev/null -c "begin" -c "update public.coffees set merged_into = '8000000a-0000-0000-0000-000000000002' where id = '8000000b-0000-0000-0000-000000000002'" \
  -c "select public.apply_coffee_merges()" -c "select pg_sleep(2)" -c "commit" &
sleep 0.7
as_user "insert into public.user_coffees (user_id, coffee_id, rating, comment, roast_date, updated_at)
           values (auth.uid(), '8000000b-0000-0000-0000-000000000002', 4, null, '2026-10-30', now())
         on conflict (user_id, coffee_id) do update set rating = excluded.rating, comment = excluded.comment, roast_date = excluded.roast_date, updated_at = excluded.updated_at;
         insert into public.cups (id, coffee_id, grind) values ('9000000e-0000-0000-0000-000000000001', '8000000b-0000-0000-0000-000000000002', 9);"
wait
got=$("${PSQL[@]}" -A -t -c "select coalesce(comment, '-') || '/' || coalesce(rating::text, '-') || '/' || coalesce(roast_date::text, '-') from public.user_coffees where user_id = '$E' and coffee_id = '8000000a-0000-0000-0000-000000000002'")
left=$("${PSQL[@]}" -A -t -c "select (select count(*) from public.user_coffees where coffee_id = '8000000b-0000-0000-0000-000000000002') || '/' || (select coffee_id from public.cups where id = '9000000e-0000-0000-0000-000000000001')")
echo "# race: late write to the old bean during the merge -> $got, left behind/cup: $left"
[ "$got" = "behalten/4/2026-10-30" ] || { echo "FAILED: late write not merged into the kept entry" >&2; exit 1; }
[ "$left" = "0/8000000a-0000-0000-0000-000000000002" ] || { echo "FAILED: late write left behind on the merged bean" >&2; exit 1; }
# The app's matchKey() must give the same key as the database for every catalogue name.
"${PSQL[@]}" -A -t -F $'\t' -c "select x, public.match_key(x) from (select name from public.coffees union all select name from public.roasters union all select unnest(array['Röststätte', 'ROESTSTAETTE', 'Corazón de Jesús', 'Großvater', 'Ñandú Øresund Łódź', 'Café  Crème', 'ÄÖÜ äöü', 'Kırşehir İzmir', 'Żółć Ěřů'])) t(x)" > "$DIR/keys.tsv"
node --experimental-strip-types scripts/check-match-keys.ts "$DIR/keys.tsv"
echo "ok"
