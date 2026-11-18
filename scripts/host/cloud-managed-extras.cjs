// One-off (SPEC-self-hosting.md, Stage 2): the parts of the cloud database that `supabase db dump` leaves out because they
// sit in Supabase's managed schemas: the site's two triggers on auth.users, its policies on storage.objects and
// realtime.messages, the bucket definitions, and the migration history. Read-only on the cloud (scripts/db.cjs --read-only).
// Run from the site's checkout: node make-extras.cjs <out.sql>
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');

function rows(sql) {
  const out = execFileSync(process.execPath, ['scripts/db.cjs', '--read-only', '--json', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('{'))).rows;
}
const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const lit = (s) => (s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'");

const out = ['-- Generated from the cloud project, read-only. See SPEC-self-hosting.md, Stage 2.', ''];

out.push('-- The site\'s own triggers on auth.users (their functions are in public, from the main dump).');
for (const t of rows("select pg_get_triggerdef(t.oid) as def, t.tgname as name from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relname='users' and not t.tgisinternal order by 2")) {
  out.push(`drop trigger if exists ${ident(t.name)} on auth.users;`);
  out.push(t.def.replace(/EXECUTE FUNCTION (?!public\.)/, 'EXECUTE FUNCTION public.') + ';');
}
out.push('');

out.push('-- Policies in the managed schemas (storage.objects, realtime.messages).');
for (const p of rows("select schemaname, tablename, policyname, permissive, roles::text as roles, cmd, qual, with_check from pg_policies where schemaname in ('storage','realtime','auth') order by 1,2,3")) {
  const roles = p.roles.replace(/^\{|\}$/g, '').split(',').map((r) => (r === 'public' ? 'public' : ident(r))).join(', ');
  let s = `create policy ${ident(p.policyname)} on ${ident(p.schemaname)}.${ident(p.tablename)} as ${p.permissive} for ${p.cmd} to ${roles}`;
  if (p.qual) s += ` using (${p.qual})`;
  if (p.with_check) s += ` with check (${p.with_check})`;
  out.push(`drop policy if exists ${ident(p.policyname)} on ${ident(p.schemaname)}.${ident(p.tablename)};`);
  out.push(s + ';');
}
out.push('');

out.push('-- The buckets (definitions only; the files come across in Stage 6).');
for (const b of rows('select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id')) {
  const mimes = b.allowed_mime_types ? 'array[' + b.allowed_mime_types.map(lit).join(',') + ']::text[]' : 'null';
  out.push(`insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (${lit(b.id)}, ${lit(b.name)}, ${b.public}, ${b.file_size_limit ?? 'null'}, ${mimes}) on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;`);
}
out.push('');

out.push('-- The migration history, so `supabase db push` against this database applies only what is new.');
out.push('create schema if not exists supabase_migrations;');
out.push('create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);');
const migs = rows('select version, name from supabase_migrations.schema_migrations order by version');
for (const m of migs) out.push(`insert into supabase_migrations.schema_migrations (version, name) values (${lit(m.version)}, ${lit(m.name)}) on conflict (version) do nothing;`);

writeFileSync(process.argv[2], out.join('\n') + '\n');
console.log(`wrote ${process.argv[2]}: ${migs.length} migrations recorded`);
