/*
 * Room chat on the DISCUSS page (SPEC-room-chat-discuss.md, Luke 2026-11-16), the parts that need no browser: what the database
 * lets out and to whom, both stores' rules, the switches, the queue label, the lines among the comments, and the thread a
 * first line files. The browser's side is scripts/drive-room-chat-discuss.cjs, against a local mock dev server.
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

const migration = read('supabase/migrations/20261116060106_room_chat_on_discuss.sql');
const fn = migration.slice(migration.indexOf('create or replace function public.discuss_room_chat'), migration.indexOf('revoke all on function public.discuss_room_chat'));

ok('the database: both switches on by default, the queue label, and one narrow function', () => {
  assert.match(migration, /alter table public\.watch_rooms add column if not exists chat_on_discuss boolean not null default true;/);
  assert.match(migration, /alter table public\.profiles add column if not exists room_chat_on_discuss boolean not null default true;/);
  assert.match(migration, /alter table public\.watch_queue add column if not exists web_ref text;/);
  assert.match(migration, /grant select \(room_chat_on_discuss\) on public\.profiles to authenticated;/, 'a person reads their own switch back');
  assert.doesNotMatch(migration, /^\s*(delete|update public\.(?!watch_rooms r set chat_on_discuss))/im, 'no rows changed or deleted (the switch function aside)');
});

ok('the function lets out only the allowed lines, and only what DISCUSS shows', () => {
  assert.match(fn, /security definer/);
  assert.match(fn, /returns table \(id uuid, said_at timestamptz, author_id uuid, author_label text, body text, media_seconds numeric, guest boolean\)/, 'no room, queue or member columns');
  assert.match(fn, /where r\.chat_on_discuss/, "a room's switch");
  assert.match(fn, /and coalesce\(p\.room_chat_on_discuss, true\)/, "a person's switch");
  assert.match(fn, /and coalesce\(p\.is_hidden, false\) = false/, 'hidden test accounts left out');
  assert.match(fn, /join public\.watch_queue q on q\.id = m\.queue_entry_id/, 'only lines said while something played');
  assert.match(fn, /when auth\.uid\(\) is null and coalesce\(p\.show_name_to_visitors, true\) = false then 'ANON'/, 'ANON to a signed-out visitor, as the board');
  assert.match(fn, /limit 500/);
  assert.match(migration, /grant execute on function public\.discuss_room_chat\(uuid, text, text\[\]\) to anon, authenticated;/);
  const room = migration.slice(migration.indexOf('create or replace function public.watch_room_chat_on_discuss'));
  assert.match(room, /where r\.id = room and \(r\.host_id = auth\.uid\(\) or r\.original_host_id = auth\.uid\(\)\)/, "the room switch is the host's");
  assert.match(room, /revoke all on function public\.watch_room_chat_on_discuss\(uuid, boolean\) from public, anon;/);
});

ok('both stores: the live one asks the function, the mock keeps the same rules', () => {
  const live = read('app/lib/watch/supabase-watch-repository.ts');
  assert.ok(live.includes("rpc('discuss_room_chat', { p_media_item_id: query.mediaItemId, p_web_ref: query.webRef, p_urls: urls.length === 0 ? null : urls })"));
  assert.ok(live.includes("rpc('watch_room_chat_on_discuss', { room: roomId, chat_on: on })"));
  assert.ok(live.includes("web_ref: input.link !== undefined && typeof input.webRef === 'string' ? input.webRef.slice(0, 300) : null,"), 'the queue label is written');
  assert.ok(live.includes('chatOnDiscuss: row.chat_on_discuss !== false,'));
  const mock = read('app/lib/watch/mock-watch-repository.ts');
  assert.ok(mock.includes("if (entry === undefined || room === undefined || room.chatOnDiscuss === false) return false;"), "the mock: lines said over something, in rooms with the switch on");
  assert.ok(mock.includes('if (profile !== null && profile.visibility.roomChatOnDiscuss === false) continue;'), "and people with theirs on");
  assert.ok(mock.includes("if (me === null || (room.hostId !== me && room.originalHostId !== me)) throw new Error(NOT_ALLOWED);"), "the host's switch");
});

ok('the switches: the host in ROOM SETTINGS, the person in PRIVACY, both on by default', () => {
  const settings = read('app/components/RoomSettingsWindow.tsx');
  assert.ok(settings.includes("own || !isHost ? 'hidden'"), 'only the host sees it, and not in an own room (no chat there)');
  assert.ok(settings.includes('await getWatchRepository().setChatOnDiscuss(room.id, on);'));
  assert.ok(read('app/components/PrivacySwitches.tsx').includes("{ key: 'roomChatOnDiscuss', label: 'MY ROOM CHAT ON DISCUSSION PAGES'"));
  assert.match(read('app/lib/profile/visibility.ts'), /roomChatOnDiscuss: true,/);
  const profiles = read('app/lib/profile/supabase-profile-repository.ts');
  assert.ok(profiles.includes('roomChatOnDiscuss: row.room_chat_on_discuss !== false,') && profiles.includes('update.room_chat_on_discuss = visibility.roomChatOnDiscuss;'));
});

ok('rows label what they queue; DISCUSS asks by that label and by the address', () => {
  assert.ok(read('app/components/WebStream.tsx').includes('const roomSource = roomLink === null ? undefined : { link: roomLink, webRef: item.id };'));
  const card = read('app/components/WebMediaRow.tsx');
  assert.equal(card.split('webRef: item.id').length - 1, 2, 'a KINO or server card, one video or a whole series');
  assert.equal(card.split('<WebDiscussKey item={item} short />').length - 1, 2, 'and KINO and server cards have the pen');
  assert.ok(read('app/lib/watch/my-queue.ts').includes('{ link: thing.link, ...(thing.webRef === undefined ? {} : { webRef: thing.webRef }) }'));
  const bridges = read('app/components/WebBridgeKeys.tsx');
  assert.ok(bridges.includes("return { webRef: item.id, mediaItemId: null, urls: link === null ? [] : [link.url] };"));
  assert.ok(bridges.includes('<CommentWindow anchor={anchor} onClose={close} roomChat={discussQuery(item)} />'));
});

ok('the lines sit among the comments in time order, as plain text, with where in the video', () => {
  const list = read('app/components/CommentThreadList.tsx');
  assert.ok(list.includes('items.sort((a, b) => a.at - b.at);'));
  const window = read('app/components/CommentWindow.tsx');
  assert.ok(window.includes('extras={chatItems}') && window.includes('thread === undefined && chatItems.length > 0'), 'with or without a thread yet');
  const lines = read('app/components/RoomChatLines.tsx');
  assert.ok(lines.includes("{`IN ROOM · ${videoClock(line.mediaSeconds)}`}"));
  assert.ok(lines.includes('<p className="mt-0.5 text-prose wrap-anywhere">{line.body}</p>'), 'the words as text, never markup');
  assert.doesNotMatch(lines, /dangerouslySetInnerHTML/);
  // videoClock, run from its own source.
  const ts = require('typescript');
  const body = lines.slice(lines.indexOf('export function videoClock'), lines.indexOf('/** The lines for one thing'));
  const js = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const made = { exports: {} };
  new Function('module', 'exports', js)(made, made.exports);
  assert.equal(made.exports.videoClock(134), '02:14');
  assert.equal(made.exports.videoClock(3734.9), '1:02:14');
  assert.equal(made.exports.videoClock(-3), '00:00');
});

ok("a first line over a result files its thread: an account's, in a room with the switch on, only when there is none", () => {
  const room = read('app/components/WatchRoom.tsx');
  const fileIt = room.slice(room.indexOf('function fileDiscussThread'), room.indexOf('async function send('));
  assert.ok(fileIt.includes("if (identity?.kind !== 'account' || identity.id !== speakerId || read.room.chatOnDiscuss === false) return;"));
  assert.ok(fileIt.includes('if (forum.threadForAnchor(anchor) !== undefined) return;'));
  assert.ok(fileIt.includes('forum.createThread({ title: autoThreadTitle(anchor), body: AUTO_FILED_BODY, anchor })'), 'an item thread, credited to the site');
  assert.ok(room.includes('      fileDiscussThread(speaker.id);'), 'after the line is sent');
});

console.log(`room chat on DISCUSS: ${passed} groups held`);
