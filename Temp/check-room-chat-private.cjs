/*
 * ROOMCHAT (Luke 2026-11-17): "previous things said in own room are non private by default and appear as comments on the
 * specified media and timestamped, in a public steam room its the same but in a private one its anonymised to anyone but who
 * was in the room". The parts that need no browser: the database function decides the names (never the browser), both stores
 * keep the same rule, and the line says PRIVATE ROOM. The browser's side is scripts/drive-room-chat-discuss.cjs (mock server);
 * the live rule as two test accounts is scripts/live-room-chat-private.cjs (through heavy-step --live).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
let passed = 0;
const ok = (name, fn) => {
  fn();
  passed += 1;
};

const migration = read('supabase/migrations/20261117023807_room_chat_private_anonymous.sql');
const fn = migration.slice(migration.indexOf('create function public.discuss_room_chat'), migration.indexOf('revoke all on function public.discuss_room_chat'));

ok('the database decides: a private line reaches an outsider with no name and no id, its number in the room instead', () => {
  assert.match(migration, /drop function if exists public\.discuss_room_chat\(uuid, text, text\[\]\);/, 're-runnable (the answer gains two columns)');
  assert.match(fn, /security definer/);
  assert.match(fn, /returns table \(id uuid, said_at timestamptz, author_id uuid, author_label text, body text, media_seconds numeric, guest boolean, private_room boolean, anonymous boolean\)/, 'no room, queue or member columns');
  assert.match(fn, /m\.privacy_at_write <> 'open' as private_line/, "the line's own stamp, from when it was said");
  assert.match(fn, /m\.author_id = auth\.uid\(\)\s+or r\.host_id = auth\.uid\(\)\s+or r\.original_host_id = auth\.uid\(\)\s+or exists \(select 1 from public\.watch_members v where v\.room_id = r\.id and v\.user_id = auth\.uid\(\) and v\.removed_at is null\)/, 'who was in the room (not the REMOVED)');
  assert.match(fn, /auth\.uid\(\) is not null and \(/, 'a signed-out visitor is never in a room');
  assert.match(fn, /said\.private_line and not said\.insider as hide_name/);
  assert.match(fn, /when s\.hide_name then null\s+when auth\.uid\(\) is null and not s\.name_to_visitors then null\s+else s\.author_id/, 'no id to an outsider');
  assert.match(fn, /when s\.hide_name then coalesce\('ANON-' \|\| s\.anon_number::text, 'ANON'\)/, 'their number in the room, not their name');
  assert.match(fn, /case when s\.hide_name then false else s\.author_label like '% \[GUEST\]' end/, 'not even GUEST');
});

ok('unchanged: both switches, only lines over something, hidden accounts out for outsiders, at most 500, visitors may ask', () => {
  assert.match(fn, /where r\.chat_on_discuss\s+and coalesce\(p\.room_chat_on_discuss, true\)/, "the room's and the person's switches still win");
  assert.match(fn, /join public\.watch_queue q on q\.id = m\.queue_entry_id/);
  assert.match(fn, /where not said\.hidden or said\.insider/);
  assert.match(fn, /when auth\.uid\(\) is null and not s\.name_to_visitors then 'ANON'/, "the board's ANON rule for visitors");
  assert.match(fn, /order by s\.created_at\s+limit 500/);
  assert.match(migration, /grant execute on function public\.discuss_room_chat\(uuid, text, text\[\]\) to anon, authenticated;/);
  assert.doesNotMatch(migration, /^\s*(insert|update|delete|alter table)\b/im, 'no rows or tables changed');
});

ok('both stores: the live one only passes the answer on; the mock keeps the same rule', () => {
  const live = read('app/lib/watch/supabase-watch-repository.ts');
  assert.ok(live.includes("privateRoom: row.private_room === true,") && live.includes("anonymous: row.anonymous === true,"));
  const discuss = live.slice(live.indexOf('async discussChat'), live.indexOf('async saveRoomSettings'));
  assert.doesNotMatch(discuss, /ANON|authorLabel: row\.(?!author_label)/, 'the browser never rewrites a name');
  const mock = read('app/lib/watch/mock-watch-repository.ts');
  assert.ok(mock.includes("me !== null && (authorId === me || room.hostId === me || room.originalHostId === me || tables.members.some((row) => row.roomId === room.id && row.userId === me && row.removedAt === null))"));
  assert.ok(mock.includes('if (room !== undefined && privateRoom && !insider(room, message.authorId)) {'));
  assert.ok(mock.includes('authorId: null, authorLabel: anonTag(room.id, message.authorId),'));
});

ok('the line: an outsider sees ANON-n and PRIVATE ROOM; a member sees the name and that others do not', () => {
  const lines = read('app/components/RoomChatLines.tsx');
  assert.ok(lines.includes("const privateTag = line.anonymous ? 'PRIVATE ROOM' : line.privateRoom ? 'PRIVATE ROOM · NAME SHOWN TO ITS MEMBERS' : null;"));
  assert.ok(lines.includes("data-room-chat-anonymous={line.anonymous ? '' : undefined}"));
  assert.doesNotMatch(lines, /href=|<img|Avatar/, 'no profile link and no picture on a chat line');
  assert.ok(lines.includes("{`IN ROOM · ${videoClock(line.mediaSeconds)}`}"), 'still timestamped to the moment in the video');
});

console.log(`room chat, private rooms anonymised: ${passed} groups held`);
