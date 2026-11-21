// Compares matchKey() in the app with public.match_key() in the database. Used by scripts/test-db.sh.
import { readFileSync } from 'node:fs';

import { matchKey } from '../src/lib/community.ts';

const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
const bad = rows.filter(([name, key]) => matchKey(name) !== key);
if (bad.length) {
  for (const [name, key] of bad) console.error(`"${name}": app "${matchKey(name)}", db "${key}"`);
  process.exit(1);
}
console.log(`match keys agree for ${rows.length} names`);
