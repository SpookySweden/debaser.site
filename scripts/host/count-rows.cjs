// Exact row counts per table: cloud (read-only), the export files, and (with --pc) the PC's database.
// node count-rows.cjs [--pc]   (run from the site checkout)
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const TABLES = "select table_schema as s, table_name as t from information_schema.tables where table_type='BASE TABLE' and (table_schema in ('public','game','ink') or (table_schema='auth' and table_name in ('users','identities')) or (table_schema='storage' and table_name='objects'))";
const COUNT = `select coalesce(json_object_agg(s||'.'||t, n), '{}'::json)::text as j from (select s, t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', s, t), false, true, '')))[1]::text::bigint as n from (${TABLES}) q) z`;

function cloud() {
  const out = execFileSync(process.execPath, ['scripts/db.cjs', '--read-only', '--json', COUNT], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(JSON.parse(out.slice(out.search(/^\{\s*$/m))).rows[0].j); // the answer starts on a line of its own
}
function pc() {
  const pw = /^POSTGRES_PASSWORD=(.*)$/m.exec(readFileSync('G:/DEBASER-HOST/supabase/.env', 'utf8'))[1].trim();
  const out = execFileSync('C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe', ['exec', '-e', `PGPASSWORD=${pw}`, 'supabase-db', 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', COUNT], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}
function dumped() {
  const counts = {};
  for (const f of ['data-site.sql', 'data-accounts.sql']) {
    const lines = readFileSync(`G:/DEBASER-HOST/supabase/from-cloud/${f}`, 'utf8').split('\n');
    let cur = null;
    for (const l of lines) {
      if (cur) { if (l === '\\.' || l === '\\.\r') { cur = null; } else counts[cur]++; continue; }
      const m = /^COPY "([^"]+)"\."([^"]+)"/.exec(l);
      if (m) { cur = `${m[1]}.${m[2]}`; counts[cur] = 0; }
    }
  }
  return counts;
}

const c = cloud(), d = dumped(), p = process.argv.includes('--pc') ? pc() : null;
let bad = 0, rows = 0;
for (const k of Object.keys(c).sort()) {
  const ok = (d[k] ?? 0) === c[k] && (!p || (p[k] ?? 0) === c[k]);
  rows += c[k];
  if (!ok) { bad++; console.log(`MISMATCH ${k}: cloud ${c[k]}, export ${d[k] ?? 0}${p ? `, PC ${p[k] ?? 0}` : ''}`); }
}
const pick = ['auth.users', 'auth.identities', 'public.profiles', 'public.forum_threads', 'public.forum_comments', 'public.music_tracks', 'public.letters', 'public.docs', 'storage.objects', 'public.web_word_stats'];
for (const k of pick) console.log(`  ${k}: cloud ${c[k]}, export ${d[k]}${p ? `, PC ${p[k]}` : ''}`);
console.log(`${Object.keys(c).length} tables, ${rows} rows on the cloud; ${bad === 0 ? 'every table matches' : bad + ' tables differ'}`);
