/**
 * The database tool's refusals (scripts/db.cjs, since the accounts were lost on 2026-11-06). Runs nothing against any database.
 *   node Temp/check-db-guard.cjs
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { writeProblem } = require(path.join(__dirname, '..', 'scripts', 'db.cjs'));

const file = { fromFile: true, viaNpm: true, destructive: false };
const refused = (sql, how = file) => assert.notEqual(writeProblem(sql, how), null, sql);
const allowed = (sql, how = file) => assert.equal(writeProblem(sql, how), null, sql);

// The statement that did it, as the database received it.
refused('delete from auth.users u');
refused('delete from auth.users u', { fromFile: false, viaNpm: true, destructive: true });
// Any write on npm's command line, because the tool can't tell it was cut short.
refused("update public.profiles set bio = 'x' where id = '1'", { fromFile: false, viaNpm: true, destructive: false });
allowed("update public.profiles set bio = 'x' where id = '1'", { fromFile: false, viaNpm: false, destructive: false });
// No where, in any shape, and a where hiding in a comment or a string doesn't count.
refused('update public.profiles set bio = null');
refused('delete from public.forum_threads -- where id = 1');
refused("delete from public.forum_threads; select 'where'");
refused('with gone as (delete from public.forum_threads returning id) select count(*) from gone');
// Accounts and whole tables need the second flag; with it, a where is still needed for a delete.
refused("delete from auth.users where email = 'a'");
allowed("delete from auth.users where email = 'a'", { ...file, destructive: true });
refused('delete from auth.users', { ...file, destructive: true });
refused('truncate public.forum_threads');
refused('drop table public.forum_threads');
allowed('drop table public.forum_threads', { ...file, destructive: true });
// A clean-up with its filter on later lines, from a file, runs.
allowed("delete from public.watch_rooms r\nwhere r.id = 'x';");
// Migrations' ordinary business isn't caught.
allowed('alter table public.profiles add column if not exists a text; create index if not exists b on public.profiles (a);');
allowed('create or replace function public.f() returns void language plpgsql as $$ begin delete from public.t; end; $$;');
allowed('do $$ begin update public.t set a = 1; end $$;');
// Giving or taking the right to update or delete changes no row (the game's game_worker role, 2026-11-09)...
allowed('grant select, insert, update on game.worlds to game_worker;');
allowed('revoke update, delete on game.worlds from game_worker;');
// ...but a real update riding after one still needs its where.
refused('grant update on game.worlds to game_worker; update game.worlds set tick = 0');
console.log('  ok    writeProblem');

// The tool itself: through npm's name, a command-line write stops before any credential or database is asked for.
const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'db.cjs'), '--write', 'delete from auth.users u'], {
  encoding: 'utf8',
  env: { ...process.env, npm_lifecycle_event: 'db', SUPABASE_ACCESS_TOKEN: 'not-a-token', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' },
  cwd: path.join(__dirname, '..'),
});
assert.equal(run.status, 1);
assert.match(run.stderr, /refused, and nothing was run/);
console.log('  ok    the delete that lost the accounts is refused before anything is asked');
console.log('db guard checks passed');
