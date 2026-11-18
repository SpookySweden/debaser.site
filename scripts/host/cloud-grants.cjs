// Permissions on the PC become an exact copy of the cloud's (SPEC-self-hosting.md, Stage 2). Read-only on the cloud.
// A restore adds the target's default privileges on top of the dump's grants, so first every grant to the API roles is
// revoked on every table, view, sequence, function and schema in public/game/ink, then the cloud's ACLs are re-applied.
// node make-grants.cjs <out.sql>   (run from the site checkout)
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');

function rows(sql) {
  const out = execFileSync(process.execPath, ['scripts/db.cjs', '--read-only', '--json', `select coalesce(json_agg(q), '[]'::json)::text as j from (${sql}) q`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(JSON.parse(out.slice(out.indexOf('{'))).rows[0].j);
}
const ROLES = ['anon', 'authenticated', 'service_role', 'game_worker'];
const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const LETTERS = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE', x: 'REFERENCES', t: 'TRIGGER', X: 'EXECUTE', U: 'USAGE', C: 'CREATE', m: 'MAINTAIN' };

// "grantee=privs/grantor" -> [{grantee, privs:[...]}] for the roles we manage (grantee '' is PUBLIC).
function parseAcl(acl) {
  const out = [];
  for (const item of acl || []) {
    const m = /^(.*)=([a-zA-Z*]*)\/(.*)$/.exec(item.replace(/^"|"$/g, ''));
    if (!m) continue;
    const grantee = m[1] === '' ? 'PUBLIC' : m[1].replace(/^"|"$/g, '');
    if (grantee !== 'PUBLIC' && !ROLES.includes(grantee)) continue;
    const privs = [];
    for (let i = 0; i < m[2].length; i++) {
      const c = m[2][i];
      if (c === '*') continue;
      if (LETTERS[c]) privs.push(LETTERS[c] + (m[2][i + 1] === '*' ? ' WITH GRANT OPTION' : ''));
    }
    if (privs.length) out.push({ grantee, privs });
  }
  return out;
}
const who = (g) => (g === 'PUBLIC' ? 'PUBLIC' : ident(g));
const targets = 'PUBLIC, ' + ROLES.map(ident).join(', ');

const out = ['-- Generated from the cloud project, read-only: exact permissions for the API roles. SPEC-self-hosting.md, Stage 2.', ''];

// Relations (tables, views, matviews, sequences) and their columns.
const rels = rows("select n.nspname as s, c.relname as t, c.relkind as k, c.relacl::text[] as acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','game','ink') and c.relkind in ('r','p','v','m','S','f') order by 1,2");
for (const r of rels) {
  const obj = `${ident(r.s)}.${ident(r.t)}`;
  const kw = r.k === 'S' ? 'SEQUENCE' : 'TABLE';
  out.push(`revoke all on ${kw} ${obj} from ${targets};`);
  for (const g of parseAcl(r.acl)) {
    const plain = g.privs.filter((p) => !p.includes('GRANT OPTION'));
    const withOpt = g.privs.filter((p) => p.includes('GRANT OPTION')).map((p) => p.replace(' WITH GRANT OPTION', ''));
    if (plain.length) out.push(`grant ${plain.join(', ')} on ${kw} ${obj} to ${who(g.grantee)};`);
    if (withOpt.length) out.push(`grant ${withOpt.join(', ')} on ${kw} ${obj} to ${who(g.grantee)} with grant option;`);
  }
}
const cols = rows("select n.nspname as s, c.relname as t, a.attname as col, a.attacl::text[] as acl from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','game','ink') and c.relkind in ('r','p','v','m','f') and a.attnum > 0 and not a.attisdropped order by 1,2,3");
// Column grants: revoke per column (table-level revoke above doesn't remove column-level ones), then re-grant.
for (const c of cols) {
  const obj = `${ident(c.s)}.${ident(c.t)}`;
  out.push(`revoke all (${ident(c.col)}) on ${obj} from ${targets};`);
  for (const g of parseAcl(c.acl)) {
    const privs = g.privs.map((p) => p.replace(' WITH GRANT OPTION', ''));
    // Each privilege carries its own column list: `grant INSERT, UPDATE (c)` would be table-wide INSERT.
    out.push(`grant ${privs.map((p) => `${p} (${ident(c.col)})`).join(', ')} on ${obj} to ${who(g.grantee)};`);
  }
}

// Functions (not ones belonging to extensions).
const fns = rows("select n.nspname as s, p.proname as f, pg_get_function_identity_arguments(p.oid) as args, p.prokind as k, p.proacl::text[] as acl, p.proacl is null as dflt from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','game','ink') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1,2,3");
for (const f of fns) {
  const kw = f.k === 'p' ? 'PROCEDURE' : 'FUNCTION';
  const obj = `${ident(f.s)}.${ident(f.f)}(${f.args})`;
  out.push(`revoke all on ${kw} ${obj} from ${targets};`);
  if (f.dflt) out.push(`grant execute on ${kw} ${obj} to PUBLIC;`); // a null ACL means the default: PUBLIC may execute
  for (const g of parseAcl(f.acl)) out.push(`grant execute on ${kw} ${obj} to ${who(g.grantee)};`);
}

// Schemas.
for (const s of rows("select nspname as s, nspacl::text[] as acl from pg_namespace where nspname in ('public','game','ink') order by 1")) {
  out.push(`revoke all on schema ${ident(s.s)} from ${targets};`);
  for (const g of parseAcl(s.acl)) out.push(`grant ${g.privs.map((p) => p.replace(' WITH GRANT OPTION', '')).join(', ')} on schema ${ident(s.s)} to ${who(g.grantee)};`);
}

writeFileSync(process.argv[2], out.join('\n') + '\n');
console.log(`wrote ${process.argv[2]}: ${rels.length} relations, ${cols.length} columns, ${fns.length} functions`);
