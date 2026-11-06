/*
 * Guests in streams (SPEC-guests.md): what the database lets a guest near, and that the site's code keeps its side of it.
 *   node Temp/check-guests.cjs
 *
 * Makes no guest and leaves nothing: it asks the live database as a pretend guest, inside a block that always ends in an error, so everything it does is rolled back.
 * `GUESTS_CHECK_AS=account` asks the same questions without the guest's mark, which is how this check is shown catching an open gate: the gate lets accounts through.
 */
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

function ask(sql) {
  const out = execFileSync(process.execPath, ['scripts/db.cjs', sql], { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 ** 24 });
  return JSON.parse(out.slice(out.indexOf('{'))).rows;
}

/* --- the code's side -------------------------------------------------------------------------------------------------- */
for (const file of ['app/lib/web/web-session.ts', 'app/api/media/upload/route.ts', 'app/api/profile/avatar/route.ts', 'app/api/web/youtube/mine/route.ts']) {
  assert.match(read(file), /is_anonymous/, `${file} takes a session token, so it has to refuse a guest's`);
}
console.log('  ok    the server routes that take a session token refuse a guest');

const repository = read('app/lib/watch/supabase-watch-repository.ts');
const beforeStore = repository.slice(0, repository.indexOf('/* --- the store ---'));
const store = repository.slice(repository.indexOf('/* --- the store ---'));
assert.doesNotMatch(store, /getSupabaseBrowserClient/, 'the room store goes by the room connection, or a guest in a private room hears nothing');
assert.match(beforeStore, /function joinWatchingChannel/, "the site-wide watching channel stays the account's");
assert.doesNotMatch(read('app/lib/watch/supabase-canvas-repository.ts'), /getSupabaseBrowserClient/, 'so does the canvas store');
console.log("  ok    only the room stores use a guest's connection");

/* --- the live gate is in place ---------------------------------------------------------------------------------------- */
const [role] = ask("select rolconfig::text as settings from pg_roles where rolname = 'authenticator'");
assert.match(role.settings, /pgrst\.db_pre_request=public\.guest_request_gate/, 'the gate is what runs before every request');
console.log('  ok    the gate runs before every request');

/* --- every table is shut to a guest unless it is the room's own --------------------------------------------------------- */
const ROOM_TABLES = ['room_canvas_inputs', 'room_canvas_snapshots', 'room_canvases', 'watch_crowns', 'watch_members', 'watch_messages', 'watch_queue', 'watch_rooms'];
const open = ask(`
  select c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'guests stay out' and not p.polpermissive and p.polcmd = 'r')
  order by 1
`).map((row) => row.name);
assert.deepEqual(open, ROOM_TABLES, `a table a guest can read that isn't the room's own needs a "guests stay out" rule in a migration: ${open.filter((name) => !ROOM_TABLES.includes(name)).join(', ')}`);
console.log(`  ok    every table but the ${ROOM_TABLES.length} of the room is shut to a guest`);

/* --- a pretend guest, rolled back --------------------------------------------------------------------------------------- */
const mark = process.env.GUESTS_CHECK_AS === 'account' ? 'false' : 'true';
const REFUSED = ['GET /profiles', 'GET /forum_threads', 'GET /comms_messages', 'POST /forum_threads', 'POST /watch_rooms', 'POST /watch_queue', 'PATCH /watch_messages', 'DELETE /watch_messages', 'PATCH /room_canvases', 'POST /room_canvas_snapshots', 'POST /rpc/account_list', 'POST /rpc/room_canvas_save', 'POST /rpc/room_canvas_close', 'POST /rpc/watch_remove_member', 'POST /rpc/watch_room_guests_talk'];
const ALLOWED = ['GET /watch_rooms', 'GET /watch_messages', 'POST /watch_messages', 'POST /room_canvas_inputs', 'POST /room_canvases', 'POST /rpc/watch_join', 'POST /rpc/watch_room_door', 'POST /rpc/guest_set_name'];
const setting = (name, value) => `perform set_config('${name}', '${value}', true);`;
const claims = (flag) => setting('request.jwt.claims', JSON.stringify({ sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', is_anonymous: flag === 'true' }));
const request = (entry) => {
  const [method, place] = entry.split(' ');
  return `${setting('request.method', method)} ${setting('request.path', place)}`;
};
const block = `do $check$
declare
  n integer;
begin
  ${claims(mark)}
  ${REFUSED.map((entry) => `begin ${request(entry)} perform public.guest_request_gate(); raise exception 'GATE-OPEN ${entry}'; exception when insufficient_privilege then null; end;`).join('\n  ')}
  ${ALLOWED.map((entry) => `begin ${request(entry)} perform public.guest_request_gate(); exception when insufficient_privilege then raise exception 'GATE-SHUT ${entry}'; end;`).join('\n  ')}

  -- Somebody without the guest's mark passes, whatever they ask for.
  ${claims('false')}
  ${request('POST /forum_threads')}
  perform public.guest_request_gate();
  ${claims(mark)}

  set local role authenticated;
  select count(*) into n from public.profiles;
  if n <> 0 then raise exception 'READS profiles'; end if;
  select count(*) into n from public.forum_threads;
  if n <> 0 then raise exception 'READS forum_threads'; end if;
  if public.guest_self() is not null then raise exception 'GUEST-SELF answered for nobody'; end if;
  reset role;

  if public.guest_name_key('Adm1n') <> public.guest_name_key('ADMIN') then raise exception 'LOOKALIKES differ'; end if;
  if public.guest_name_key('T3st-Acc0unt') <> public.guest_name_key('test account') then raise exception 'LOOKALIKES differ'; end if;

  raise exception 'ALL-HELD';
end
$check$;`;
const answer = spawnSync(process.execPath, ['scripts/db.cjs', '--write', block], { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 ** 24 });
const words = `${answer.stdout}\n${answer.stderr}`;
const failed = /(GATE-OPEN [^"\n\\]*|GATE-SHUT [^"\n\\]*|READS \w+|GUEST-SELF[^"\n\\]*|LOOKALIKES[^"\n\\]*)/.exec(words.replace(/raise exception '[^']*'/g, ''));
assert.equal(failed?.[1] ?? null, null, `a pretend guest found: ${failed?.[1]}`);
assert.match(words.replace(/raise exception 'ALL-HELD'/g, ''), /ALL-HELD/, `the block did not finish: ${words.slice(-400)}`);
console.log(`  ok    a pretend guest is refused ${REFUSED.length} things and allowed ${ALLOWED.length}, and reads no account's table`);

console.log('guests: the gate holds, every other table is shut, and the code keeps its side.');
