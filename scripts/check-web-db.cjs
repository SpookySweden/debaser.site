/*
 * WEB's database rules, read from source (SPEC-web.md, Phase 2; run by `npm run checks:web`, part of
 * `npm run verify`). Compiles nothing.
 *
 * - the web_items migration turns Row Level Security on for both tables, has select policies only, revokes
 *   everything from anon/authenticated and grants back select alone; no security definer function
 * - its CHECK constraints: https-only addresses, the five kinds (the same as WebItemKind), unique
 *   (platform, external_id), the stream index, collation "C" on id; no engagement column; it leaves
 *   media_items, forum_threads and watch_queue alone
 * - the pg_cron schedule migration (after the lock) takes its secret from Vault, never a literal
 * - the repository selects only the column lists in rows.ts, which name no engagement field and exist in
 *   the migration; every query it builds has a limit; the ingest's kind list matches WebItemKind
 * - the ingest lock (*_web_ingest_lock.sql): the lock is made inside the database from random bytes (no
 *   literal), the three ingest functions are SECURITY DEFINER with an empty search_path and check the lock
 *   before anything else, the comparison itself is callable by no API role, the save never writes
 *   `enabled`, and batch and limit are capped
 * - the ingest route is POST only and holds no secret: nothing in app/ reads WEB_INGEST_SECRET or
 *   SUPABASE_SERVICE_ROLE_KEY, and the ingest store touches no table, only the three lock functions
 */
const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const ROOT = join(__dirname, '..');
let passed = 0;
const fail = (message) => {
  console.log(`FAIL ${message}`);
  process.exit(1);
};
const ok = (condition, message) => {
  if (!condition) fail(message);
  passed += 1;
};
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const sqlCode = (text) => text.replace(/--.*$/gm, '').toLowerCase();
const tsCode = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const ENGAGEMENT =
  /\b(likes?|like_count|views?|view_count|downloads?|download_count|ratings?|avg_rating|stars?|followers?|follower_count|following|comments?|comment_count|plays?|play_count|favou?rites?|favou?rite_count|subscribers?|subscriber_count|reviews?|score|popularity|engagement)\b/;

/* ------------------------------------------------------------------ the migration */
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const found = readdirSync(MIGRATIONS).filter((name) => /^\d{14}_web_items\.sql$/.test(name));
ok(found.length === 1, `exactly one *_web_items.sql migration (found ${found.length})`);
const migration = sqlCode(readFileSync(join(MIGRATIONS, found[0]), 'utf8'));

const TABLES = ['web_sources', 'web_items'];
for (const table of TABLES) {
  ok(new RegExp(`create table if not exists public\\.${table}\\s*\\(`).test(migration), `${table} is created (if not exists)`);
  ok(new RegExp(`alter table public\\.${table} enable row level security`).test(migration), `${table} has Row Level Security on`);
  ok(new RegExp(`revoke all on public\\.${table} from anon, authenticated`).test(migration), `${table}: everything is revoked from anon and authenticated`);
  ok(new RegExp(`grant select on public\\.${table} to anon, authenticated`).test(migration), `${table}: select is granted back`);
  const policies = [...migration.matchAll(new RegExp(`create policy "[^"]+" on public\\.${table}\\s+for (\\w+)`, 'g'))].map((m) => m[1]);
  ok(policies.length >= 1, `${table} has a read policy`);
  ok(policies.every((kind) => kind === 'select'), `${table} has a policy that is not select-only: ${policies.join(', ')}`);
  for (const m of migration.matchAll(new RegExp(`create policy "([^"]+)" on public\\.${table}`, 'g'))) {
    ok(migration.includes(`drop policy if exists "${m[1]}" on public.${table}`), `policy "${m[1]}" is dropped before it is recreated`);
  }
}
// Any grant at all, other than select, to anyone: refused. Writes go through the service role, which needs none.
for (const m of migration.matchAll(/grant\s+([\s\S]*?)\s+on\s/g)) {
  ok(/^select$/.test(m[1].trim()), `a grant other than select: grant ${m[1].trim()}`);
}
ok(!/security definer/.test(migration), 'no security definer function (it would step around RLS)');
ok(!/\b(media_items|forum_threads|watch_queue)\b/.test(migration), 'media_items, forum_threads and watch_queue are not touched');

const tableBody = (table) => {
  const m = migration.match(new RegExp(`create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`));
  ok(m, `${table}'s column list is found`);
  return m[1];
};
const itemsBody = tableBody('web_items');
const sourcesBody = tableBody('web_sources');
ok(/\btitle text not null/.test(itemsBody), 'the web_items body was actually read (it has title)');
for (const [table, body] of [['web_items', itemsBody], ['web_sources', sourcesBody]]) {
  const columns = body.split('\n').map((line) => line.trim().split(/\s+/)[0]).filter((word) => /^[a-z_]+$/.test(word) && word !== 'constraint');
  for (const column of columns) ok(!ENGAGEMENT.test(column), `${table} has an engagement column: ${column}`);
}
ok(/\bid text collate "c" primary key/.test(itemsBody), 'web_items.id has collation "C" (ties order like the JS cursor)');
ok(/unique \(platform, external_id\)/.test(itemsBody), 'web_items is unique on (platform, external_id)');
ok(/unique \(platform, ref\)/.test(sourcesBody), 'web_sources is unique on (platform, ref)');
ok(/create index if not exists \w+ on public\.web_items \(published_at desc, id desc\)/.test(migration), 'the stream index is (published_at desc, id desc)');

for (const column of ['url', 'canonical_url', 'thumbnail_url', 'embed_url', 'license_url']) {
  ok(new RegExp(`\\b${column} ~ '\\^https://'`).test(migration), `${column} is checked to be https`);
  ok(new RegExp(`char_length\\(${column}\\) <= 2048`).test(migration), `${column} has a length cap`);
}
for (const column of ['title', 'creator', 'description']) {
  ok(new RegExp(`char_length\\(${column}\\)`).test(migration), `${column} has a length cap`);
}
const kindsInTypes = read('app/lib/web/types.ts').match(/export type WebItemKind = ([^;]+);/)[1].match(/'[a-z]+'/g).sort();
const kindCheck = migration.match(/check \(kind in \(([^)]*)\)\)/);
ok(kindCheck, 'kind has a CHECK constraint');
ok(JSON.stringify(kindCheck[1].match(/'[a-z]+'/g).sort()) === JSON.stringify(kindsInTypes), `the kind CHECK lists exactly WebItemKind (${kindsInTypes.join(' ')})`);
const ingestKinds = read('app/lib/web/ingest.ts').match(/const KINDS = \[([^\]]*)\]/);
ok(ingestKinds && JSON.stringify(ingestKinds[1].match(/'[a-z]+'/g).sort()) === JSON.stringify(kindsInTypes), "the ingest's kind list (fitsTable) is WebItemKind too");

/* ------------------------------------------------------------------ the schedule */
ok(!existsSync(join(ROOT, 'supabase/held/web_ingest_cron.sql')), 'the held copy is gone now the schedule is a migration (one source of truth)');
const CRON_FILES = readdirSync(MIGRATIONS).filter((name) => /^\d{14}_web_ingest_cron\.sql$/.test(name));
ok(CRON_FILES.length === 1, `exactly one *_web_ingest_cron.sql migration (found ${CRON_FILES.length})`);
ok(readdirSync(MIGRATIONS).find((name) => /_web_ingest_lock.sql$/.test(name)) < CRON_FILES[0], 'the schedule is pushed after the lock it reads');
const held = sqlCode(read(`supabase/migrations/${CRON_FILES[0]}`));
ok(/'x-web-ingest-secret', \(select decrypted_secret from vault\.decrypted_secrets where name = 'web_ingest_secret'/.test(held), 'the header secret is read from Vault at call time');
ok(!/vault\.create_secret\s*\(/.test(held), 'the schedule never creates or sees the lock');
ok(!/x-web-ingest-secret',\s*'/.test(held), 'no literal secret in the header');
ok(/url := 'https:\/\/debaser-site\.vercel\.app\/api\/web\/ingest'/.test(held), 'the job calls the production ingest route over https');
ok(/cron\.unschedule\('web-ingest'\)/.test(held) && /cron\.schedule\(\s*'web-ingest'/.test(held), 'the job is unscheduled by name before it is scheduled (re-runnable)');

/* ------------------------------------------------------------------ the repository's selects */
const rows = tsCode(read('app/lib/web/rows.ts'));
const columnList = (name) => {
  const m = rows.match(new RegExp(`export const ${name} =\\s*'([^']+)'`));
  ok(m, `${name} is a literal column list`);
  return m[1].split(',').map((c) => c.trim());
};
const itemColumns = columnList('WEB_ITEM_COLUMNS');
const sourceColumns = columnList('WEB_SOURCE_COLUMNS');
for (const column of [...itemColumns, ...sourceColumns]) {
  ok(!ENGAGEMENT.test(column), `the repository selects an engagement field: ${column}`);
  ok(column !== '*', 'the repository never selects *');
}
for (const column of itemColumns) ok(new RegExp(`^\\s*${column} `, 'm').test(itemsBody), `web_items has the selected column ${column}`);
for (const column of sourceColumns) ok(new RegExp(`^\\s*${column} `, 'm').test(sourcesBody), `web_sources has the selected column ${column}`);

for (const path of ['app/lib/web/supabase-web-repository.ts']) {
  const code = tsCode(read(path));
  const selects = [...code.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1].trim());
  ok(selects.length >= 1, `${path} has its selects`);
  // Updated on purpose 2026-11-01 (SPEC-media-servers.md): the media titles' own list, held by check-web-media-db.cjs.
  for (const arg of selects) ok(/^WEB_(ITEM|SOURCE|MEDIA)_COLUMNS$/.test(arg), `${path} selects something other than the column lists: .select(${arg})`);
  const froms = (code.match(/\.from\(/g) || []).length;
  const reads = (code.match(/\.select\(/g) || []).length;
  const limits = (code.match(/\.limit\(/g) || []).length;
  ok(limits >= reads, `${path}: every select has a limit (${reads} selects, ${limits} limits)`);
  ok(froms >= reads, `${path}: selects are on tables`);
}

/* ------------------------------------------------------------------ the ingest lock */
const LOCK_FILE = readdirSync(MIGRATIONS).find((name) => /^\d{14}_web_ingest_lock\.sql$/.test(name));
ok(LOCK_FILE, 'the ingest lock migration is in supabase/migrations/');
const lockSql = sqlCode(read(`supabase/migrations/${LOCK_FILE}`));
ok(/vault\.create_secret\(encode\(extensions\.gen_random_bytes\(32\), 'hex'\), 'web_ingest_secret'/.test(lockSql), 'the lock is made in the database from 32 random bytes');
ok(/if not exists \(select 1 from vault\.secrets where name = 'web_ingest_secret'\)/.test(lockSql), 'an existing lock is never replaced (re-runnable)');
ok(!/create_secret\(\s*'/.test(lockSql), 'no literal lock in the file');
const fnBody = (name) => {
  const at = lockSql.indexOf(`create or replace function public.${name}(`);
  ok(at !== -1, `${name} is defined`);
  const close = lockSql.indexOf('\n$$;', at);
  ok(close !== -1, `${name} has a body`);
  return lockSql.slice(at, close);
};
for (const name of ['web_ingest_lock_ok', 'web_ingest_sources', 'web_ingest_save', 'web_ingest_record']) {
  const body = fnBody(name);
  ok(/security definer/.test(body) && /set search_path = ''/.test(body), `${name} is SECURITY DEFINER with an empty search_path`);
  if (name !== 'web_ingest_lock_ok') {
    ok(/\bbegin\s+if not public\.web_ingest_lock_ok\(p_secret\) then\s+raise exception 'not allowed' using errcode = '28000';/.test(body), `${name} checks the lock before anything else`);
  }
}
ok(/extensions\.digest\(s\.decrypted_secret, 'sha256'\) = extensions\.digest\(p_secret, 'sha256'\)/.test(fnBody('web_ingest_lock_ok')), 'the lock is compared as equal-length digests');
ok(/revoke all on function public\.web_ingest_lock_ok\(text\) from public, anon, authenticated;/.test(lockSql), 'the comparison is revoked from every API role');
ok(!/grant[^;]*web_ingest_lock_ok/.test(lockSql), 'the comparison is granted to nobody');
for (const [name, args] of [['web_ingest_sources', 'text, integer'], ['web_ingest_save', 'text, jsonb'], ['web_ingest_record', 'text, uuid, timestamptz, text']]) {
  const sig = `public.${name}(${args})`;
  ok(lockSql.includes(`revoke all on function ${sig} from public, anon, authenticated;`), `${name} is revoked from every API role first`);
  const grants = lockSql.split(';').filter((stmt) => stmt.includes('grant') && stmt.includes(`${name}(`)).map((stmt) => stmt.trim());
  ok(grants.length === 1 && grants[0] === `grant execute on function ${sig} to anon`, `${name} is granted to anon only (got ${grants.join(' | ')})`);
}
const save = fnBody('web_ingest_save');
const insertCols = save.match(/insert into public\.web_items as w \(([^)]*)\)/);
ok(insertCols && !/\benabled\b/.test(insertCols[1]), 'the save never inserts enabled');
ok(save.includes('on conflict') && !/\benabled\s*=/.test(save.split('on conflict')[1]), 'the save never updates enabled (a takedown stays down)');
ok(/jsonb_array_length\(p_rows\) > 100/.test(save), 'a batch is capped at 100 rows');
ok(/limit least\(greatest\(coalesce\(p_limit, 0\), 0\), 5\)/.test(fnBody('web_ingest_sources')), 'the sources read is capped at 5');
ok(!/grant\s+(insert|update|delete|all)\b/.test(lockSql), 'the lock migration grants no table writes');
ok(/revoke execute on all functions in schema net from anon, authenticated;/.test(lockSql) && /revoke usage on schema net from anon, authenticated;/.test(lockSql), "pg_net's HTTP functions are revoked from the API roles (a no-op on hosted Supabase; net is not API-exposed)");

/* ------------------------------------------------------------------ the route holds no secret */
const ROUTE = 'app/api/web/ingest/route.ts';
const route = tsCode(read(ROUTE));
const exported = [...route.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
ok(JSON.stringify(exported) === '["POST"]', `the ingest route exports POST only (got ${exported.join(', ')})`);
const envs = [...new Set([...route.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1]))].sort();
// Search everywhere (SPEC-web-search.md) added two, on purpose: the switch for saving opened items, and the
// YouTube key Luke adds on Vercel (a platform key, server-only, for videos.list). Still no database key.
// Updated on purpose 2026-11-01 (SPEC-media-servers.md): TMDB's read token, server-only, for the media titles' details.
ok(
  JSON.stringify(envs) === '["NEXT_PUBLIC_SUPABASE_ANON_KEY","NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_WEB_SAVE_OPENED","TMDB_READ_TOKEN","YOUTUBE_API_KEY"]',
  `the route reads only the public Supabase values, the save switch, the YouTube key and TMDB's token (got ${envs.join(', ')})`,
);
ok(/makeIngestStore\(db, lock\)/.test(route), 'the route hands the lock it was sent to the store');
const ingestCode = tsCode(read('app/lib/web/ingest.ts'));
ok(!/\.from\(/.test(ingestCode), 'the ingest store touches no table directly');
const rpcs = [...ingestCode.matchAll(/\.rpc\('(\w+)'/g)].map((m) => m[1]).sort();
ok(JSON.stringify(rpcs) === '["web_ingest_record","web_ingest_request_done","web_ingest_requests","web_ingest_save","web_ingest_sources"]', `the ingest store calls only the lock functions (got ${rpcs.join(', ')})`);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|cjs|mjs)$/.test(name)) out.push(full);
  }
  return out;
}
for (const file of walk(join(ROOT, 'app'))) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  ok(!/NEXT_PUBLIC_(WEB_INGEST_SECRET|SUPABASE_SERVICE_ROLE_KEY)/.test(text), `${rel} names a secret as NEXT_PUBLIC`);
  ok(!/process\.env\.(WEB_INGEST_SECRET|SUPABASE_SERVICE_ROLE_KEY)/.test(tsCode(text)), `${rel} reads a server key (WEB holds none)`);
}

console.log(`ok: ${passed} assertions (WEB migration RLS and grants, held schedule, repository selects, ingest lock, keyless route)`);
