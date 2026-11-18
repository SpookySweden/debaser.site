// Compare the cloud database's structure with the PC's, item by item (read-only on both). Run from the site checkout.
// node diff-structure.cjs <category...>   categories: cols pols trigs grants colgrants fgrants
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const DOCKER = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
const PW = /^POSTGRES_PASSWORD=(.*)$/m.exec(readFileSync('G:/DEBASER-HOST/supabase/.env', 'utf8'))[1].trim();

const Q = {
  cols: "select table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as x from information_schema.columns where table_schema in ('public','game','ink')",
  pols: "select schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||permissive||':'||roles::text||':'||coalesce(qual,'')||':'||coalesce(with_check,'') as x from pg_policies where schemaname in ('public','game','ink','storage','realtime')",
  trigs: "select n.nspname||'.'||c.relname||'.'||t.tgname||':'||pg_get_triggerdef(t.oid) as x from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where (n.nspname in ('public','game','ink') or (n.nspname='auth' and c.relname='users')) and not t.tgisinternal",
  grants: "select grantee||':'||table_schema||'.'||table_name||':'||privilege_type as x from information_schema.role_table_grants where table_schema in ('public','game','ink') and grantee in ('anon','authenticated','service_role','game_worker','PUBLIC')",
  colgrants: "select grantee||':'||table_schema||'.'||table_name||'.'||column_name||':'||privilege_type as x from information_schema.column_privileges where table_schema in ('public','game','ink') and grantee in ('anon','authenticated','game_worker')",
  fgrants: "select r.rolname||':'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as x from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join pg_roles r where n.nspname in ('public','game','ink') and r.rolname in ('anon','authenticated','service_role') and has_function_privilege(r.oid, p.oid, 'EXECUTE') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')",
};

const wrap = (q) => `select coalesce(json_agg(x order by x), '[]'::json)::text as j from (${q}) q`;
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function cloud(q) {
  const out = execFileSync(process.execPath, ['scripts/db.cjs', '--read-only', '--json', wrap(q)], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(JSON.parse(out.slice(out.indexOf('{'))).rows[0].j).map(norm);
}
function pc(q) {
  const out = execFileSync(DOCKER, ['exec', '-e', `PGPASSWORD=${PW}`, '-e', 'PGOPTIONS=-c search_path=public,extensions', 'supabase-db', 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', wrap(q)], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out).map(norm);
}

for (const k of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  const a = new Set(cloud(Q[k]));
  const b = new Set(pc(Q[k]));
  const onlyCloud = [...a].filter((x) => !b.has(x));
  const onlyPc = [...b].filter((x) => !a.has(x));
  console.log(`== ${k}: cloud ${a.size}, PC ${b.size}, only on cloud ${onlyCloud.length}, only on PC ${onlyPc.length}`);
  for (const x of onlyCloud.slice(0, 6)) console.log('  cloud only: ' + x.slice(0, 240));
  for (const x of onlyPc.slice(0, 6)) console.log('  PC only:    ' + x.slice(0, 240));
}
if (process.argv.includes('--pols-nobrackets')) {
  const strip = (s) => s.replace(/[()]/g, '').replace(/\s+/g, ' ');
  const a = new Set(cloud(Q.pols).map(strip)), b = new Set(pc(Q.pols).map(strip));
  console.log('policies ignoring brackets: only cloud', [...a].filter((x) => !b.has(x)).length, 'only PC', [...b].filter((x) => !a.has(x)).length);
  const dq = "select coalesce(pg_get_userbyid(defaclrole),'')||':'||coalesce(defaclnamespace::regnamespace::text,'*')||':'||defaclobjtype::text||':'||defaclacl::text as x from pg_default_acl";
  const da = new Set(cloud(dq)), db = new Set(pc(dq));
  console.log('default privileges: cloud', da.size, 'PC', db.size, 'only cloud', [...da].filter((x) => !db.has(x)), 'only PC', [...db].filter((x) => !da.has(x)));
}
