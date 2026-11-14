/*
 * Room settings (SPEC-room-settings.md, Luke 2026-11-05): the cog's rules, the mock store, the database's rules, and the page.
 *   npx tsc app/lib/watch/mock-watch-repository.ts --outDir Temp/out-room-settings --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const rules = require('./out-room-settings/lib/watch/rules.js');
const { getMockWatchRepository } = require('./out-room-settings/lib/watch/mock-watch-repository.js');

const { ROOM_NAME_MAX, ROOM_TOPIC_MAX, cleanRoomWords, mayEditRoom, queueRights, roomShownName } = rules;
const crowns = [{ roomId: 'r', userId: 'crown', givenBy: 'host', givenAt: 'x' }];
const room = { hostId: 'host', endedAt: null, addMode: 'anyone' };

(async () => {
  // 1. Who gets the cog: the host and a crown, in a live room, and nobody else.
  assert.equal(mayEditRoom(room, crowns, 'host', true), true, 'the host');
  assert.equal(mayEditRoom(room, crowns, 'crown', true), true, 'a crown');
  assert.equal(mayEditRoom(room, crowns, 'viewer', true), false, 'not a viewer');
  assert.equal(mayEditRoom(room, crowns, null, true), false, 'not somebody signed out');
  assert.equal(mayEditRoom(room, crowns, 'host', false), false, 'not once the room has gone quiet');
  assert.equal(mayEditRoom({ ...room, endedAt: 'x' }, crowns, 'host', true), false, 'not once it has ended');

  // 2. The words: one line, within the limit, nothing as null.
  assert.equal(cleanRoomWords('  late   night\nfilms ', ROOM_NAME_MAX), 'late night films', 'one line');
  assert.equal(cleanRoomWords('   ', ROOM_NAME_MAX), null, 'blank is no name');
  assert.equal(cleanRoomWords('x'.repeat(200), ROOM_NAME_MAX).length, 60, 'the name limit');
  assert.equal(cleanRoomWords('x'.repeat(200), ROOM_TOPIC_MAX).length, 120, 'the topic limit');
  assert.equal(roomShownName({ name: 'FILM CLUB' }, 'ADA'), 'FILM CLUB', 'its own name');
  assert.equal(roomShownName({ name: null }, 'ADA'), 'ADA', 'else its host, as every room read before this');

  // 3. WHO CAN ADD: today's rooms are unchanged, and CROWNS ONLY stops only those without a crown.
  assert.equal(queueRights(room, crowns, 'viewer', true).add, true, 'ANYONE adds');
  assert.equal(queueRights({ hostId: 'host', endedAt: null }, crowns, 'viewer', true).add, true, 'a room with no setting behaves as it did');
  const shut = { ...room, addMode: 'crowns' };
  assert.equal(queueRights(shut, crowns, 'viewer', true).add, false, 'CROWNS ONLY stops a viewer');
  assert.equal(queueRights(shut, crowns, 'crown', true).add, true, 'not a crown');
  assert.equal(queueRights(shut, [], 'host', true).add, true, 'nor the host');
  assert.equal(queueRights(shut, crowns, 'viewer', true).sees, 'mine', 'a viewer still sees what they added before');

  // 3b. Who can be crowned (Luke, 2026-11-05: a crown only showed on his own name): a queue window opened outside the room has
  // no room presence, so the site-wide channel says who is there. Each person once, and nobody counted twice.
  {
    const read = { room: { hostId: 'host' }, queue: [], crowns: [] };
    const ids = (list) => list.map((person) => person.userId);
    assert.deepEqual(ids(rules.additionsPeople(read, [])), ['host'], 'with nobody known, only the host, which was the bug');
    const seen = rules.additionsPeople(read, [], ['ada', 'host', 'bob']);
    assert.deepEqual(ids(seen), ['host', 'ada', 'bob'], 'everybody the site-wide channel has in the room');
    assert.ok(seen.every((person) => person.present), 'and they count as here');
    const member = { key: 'k', userId: 'ada', name: 'ADA', joinedAt: 1 };
    assert.deepEqual(rules.additionsPeople(read, [member], ['ada']).map((person) => [person.userId, person.name]), [['host', ''], ['ada', 'ADA']], "the room's own presence keeps the name, once");
    const queueFile = fs.readFileSync('app/components/StreamQueueWindow.tsx', 'utf8');
    assert.match(queueFile, /additionsPeople\(read, members, watchingHere\)/, 'the window asks both');
    assert.match(queueFile, /<Crown held=\{person\.crowned\}[^\n]*\n\s*<ProfileAvatarLink author=\{author\}/, "each person's picture sits by their crown");
    assert.match(queueFile, /data-person-status/, 'with their status line');
    assert.doesNotMatch(queueFile, /<ProfileName author=\{author\} lamp=\{false\}/, 'and the lamp that says they are around');
    const watching = fs.readFileSync('app/lib/watch/use-watching.ts', 'utf8');
    assert.match(watching, /export function useWatchingIn/, 'the hook');
    assert.doesNotMatch(queueFile, /joinRoom\(/, 'a look from outside never joins the room');
  }

  // 4. The mock store does what the database does.
  const repo = getMockWatchRepository();
  const opened = await repo.openRoom({ id: 'room-settings-1', host: { id: 'host', label: 'HOST' }, mediaItemId: null });
  assert.deepEqual([opened.room.name, opened.room.topic, opened.room.addMode], [null, null, 'anyone'], 'a new room is unnamed and open');
  const save = (by, over = {}) => repo.saveRoomSettings({ roomId: 'room-settings-1', by, name: '  film   club ', topic: ' tonight ', addMode: 'crowns', ...over });
  await assert.rejects(save('viewer'), /./, 'a viewer cannot save');
  await save('host');
  let read = await repo.readRoom('room-settings-1');
  assert.deepEqual([read.room.name, read.room.topic, read.room.addMode], ['film club', 'tonight', 'crowns'], 'saved, cleaned');
  await assert.rejects(repo.addToQueue({ roomId: 'room-settings-1', mediaItemId: 'm', addedBy: 'viewer', position: 0, inQueue: false }), /./, 'CROWNS ONLY refuses a viewer');
  await repo.setCrown('room-settings-1', 'crown', true, 'host');
  await repo.addToQueue({ roomId: 'room-settings-1', mediaItemId: 'm', addedBy: 'crown', position: 0, inQueue: true });
  await save('crown', { name: '', topic: '', addMode: 'anyone' });
  read = await repo.readRoom('room-settings-1');
  assert.deepEqual([read.room.name, read.room.topic, read.room.addMode], [null, null, 'anyone'], 'a crown can save, and blank clears');
  await repo.addToQueue({ roomId: 'room-settings-1', mediaItemId: 'm', addedBy: 'viewer', position: 1, inQueue: false });
  // A save stamps the room, and the stamp is when the position was true: playing, the position must walk forward with it.
  await repo.writePlayback('room-settings-1', { currentEntryId: null, positionSeconds: 100, isPlaying: true });
  const before = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 120));
  await save('crown');
  read = await repo.readRoom('room-settings-1');
  assert.ok(read.room.positionSeconds >= 100.1 && read.room.positionSeconds < 100 + (Date.now() - before) / 1000 + 0.5, `the picture does not jump back: ${read.room.positionSeconds}`);

  // 5. The database: the one function, its checks, and the add rule.
  const sql = fs.readFileSync('supabase/migrations/20261105094541_room_settings.sql', 'utf8');
  assert.match(sql, /add column if not exists add_mode text not null default 'anyone'/, 'every room starts open');
  assert.match(sql, /security definer\s+set search_path = ''/, 'the function is locked to its own names');
  assert.match(sql, /grant execute on function public\.watch_room_settings\(uuid, text, text, text\) to authenticated/, 'signed in only');
  assert.match(sql, /revoke all on function public\.watch_room_settings\(uuid, text, text, text\) from public, anon, authenticated/, 'and nobody else');
  assert.match(sql, /r\.host_id = auth\.uid\(\)\s+or exists \(select 1 from public\.watch_crowns c where c\.room_id = r\.id and c\.user_id = auth\.uid\(\)\)/, 'the host or a crown');
  assert.match(sql, /position_seconds = case\s+when r\.is_playing then r\.position_seconds \+ greatest\(extract\(epoch from now\(\) - r\.updated_at\), 0\)/, 'the position walks forward');
  const writes = /update public\.watch_rooms r\s+set ([\s\S]*?)\s+where r\.id = room/.exec(sql)[1];
  assert.deepEqual([...writes.matchAll(/(?:^|,\s*)(\w+) =/g)].map((found) => found[1]), ['name', 'topic', 'add_mode', 'position_seconds'], 'it writes these and nothing else of the room');
  assert.match(sql, /r\.add_mode = 'anyone'\s+or r\.host_id = auth\.uid\(\)\s+or exists \(select 1 from public\.watch_crowns c where c\.room_id = watch_queue\.room_id/, 'the add rule');
  const supa = fs.readFileSync('app/lib/watch/supabase-watch-repository.ts', 'utf8');
  assert.match(supa, /rpc\('watch_room_settings', \{ room: input\.roomId, new_name: input\.name, new_topic: input\.topic, new_add_mode: input\.addMode \}\)/, 'the Supabase store calls it');
  assert.match(supa, /is_public, cleared_at, name, topic, add_mode, privacy, guests_can_talk'/, 'and reads the columns');

  // 6. The page.
  const page = fs.readFileSync('app/components/CytubePage.tsx', 'utf8');
  // (2026-11-14) It read ROOM; Luke's list makes it the first tab and calls it "rooms", so it reads ROOMS. The key is unchanged.
  assert.match(page, /\{ key: 'live', label: 'ROOMS' \}/, 'the tab reads ROOMS, and old ?tab=live links still open it');
  assert.match(page, /\[ GO LIVE \]/, 'GO LIVE stays, as Luke chose');
  const roomPage = fs.readFileSync('app/components/WatchRoom.tsx', 'utf8');
  assert.match(roomPage, /mayEditRoom\(room, read\.crowns, user\.id, live\) \? \(\s*<button[\s\S]{0,300}data-room-settings-key/,'the cog is only for those who may use it');
  assert.match(roomPage, /aria-label="Room settings"/, 'and is named for a screen reader');
  const windowFile = fs.readFileSync('app/components/RoomSettingsWindow.tsx', 'utf8');
  assert.match(windowFile, /unsaved \? setState\(\{ kind: 'asking' \}\) : onClose\(\)/, 'unsaved words ask before the window closes');
  assert.match(windowFile, /dismissOnBackdrop=\{false\}/, 'and a stray press outside cannot lose them');
  assert.match(fs.readFileSync('app/components/WatchWindow.tsx', 'utf8'), /roomShownName\(read\.room, hostName\)/, 'the title bar shows the name');
  assert.match(fs.readFileSync('app/components/StreamQueueWindow.tsx', 'utf8'), /ONLY CROWNS CAN ADD TO THIS ROOM\./, 'and a viewer is told why they cannot add');

  console.log('ok: room settings: who, what is saved, the database rules and the page');
  // The mock store keeps a channel open between tabs, which would hold the process open.
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
