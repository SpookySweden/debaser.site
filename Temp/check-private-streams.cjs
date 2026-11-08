/*
 * Private streams (SPEC-privacy-phase-2.md): who can read and write a room, in both stores.
 *   npx tsc app/lib/watch/mock-watch-repository.ts app/components/GoLiveWindow.tsx app/components/RoomDoor.tsx app/components/RoomSettingsWindow.tsx --outDir Temp/private-streams-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --jsx react-jsx
 *   node Temp/check-private-streams.cjs
 *
 * Live: it signs in as kept test accounts A, B and C and makes one room, ended and then deleted by the same run (2026-11-08: before,
 * the ended room stayed behind every run).
 * It prints counts and refused/allowed only.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

const OUT = path.join(__dirname, 'private-streams-out');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const REFUSED = '42501';

/* --- the mock store ------------------------------------------------------------------------------- */

async function mock() {
  let viewer = null;
  const store = new Map();
  globalThis.window = {
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    setInterval,
    clearInterval,
  };
  const authFile = require.resolve(path.join(OUT, 'lib', 'auth', 'mock-auth.js'));
  require.cache[authFile] = { id: authFile, filename: authFile, loaded: true, exports: { getMockAuthRepository: () => ({ getCurrentUser: async () => viewer }) } };
  const { getMockWatchRepository } = require(path.join(OUT, 'lib', 'watch', 'mock-watch-repository.js'));
  const store2 = getMockWatchRepository();
  const a = { id: 'a', displayName: 'A' };
  const b = { id: 'b', displayName: 'B' };
  const c = { id: 'c', displayName: 'C' };

  viewer = a;
  await store2.openRoom({ id: 'r1', host: { id: 'a', label: 'A' }, mediaItemId: null, privacy: 'password', password: 'secret' });
  assert.equal((await store2.readRoom('r1')).room.privacy, 'password', 'the host reads their room');

  viewer = c;
  assert.equal(await store2.readRoom('r1'), null, 'an outsider reads nothing');
  assert.equal((await store2.readDoor('r1')).title, 'THIS ROOM', 'and the door gives no host name');
  for (let i = 0; i < 4; i += 1) assert.equal(await store2.enterRoom('r1', 'nope'), 'wrong');
  assert.equal(await store2.enterRoom('r1', 'nope'), 'locked', 'the fifth wrong try locks');
  assert.equal(await store2.enterRoom('r1', 'secret'), 'locked', 'and then even the right one waits');
  assert.notEqual((await store2.readDoor('r1')).lockedUntil, null, 'the door says so');

  viewer = null;
  assert.equal((await store2.readDoor('r1')).title, null, 'a visitor with no session gets no name');
  assert.equal(await store2.enterRoom('r1', 'secret'), 'refused');

  viewer = b;
  assert.equal(await store2.enterRoom('r1', 'secret'), 'joined', 'the password lets B in');
  assert.ok(await store2.readRoom('r1'), 'and B reads the room');
  const said = await store2.sendMessage({ roomId: 'r1', queueEntryId: null, mediaItemId: null, author: { id: 'b', label: 'B' }, body: 'hello', mediaSeconds: 0 });

  viewer = c;
  await assert.rejects(store2.sendMessage({ roomId: 'r1', queueEntryId: null, mediaItemId: null, author: { id: 'c', label: 'C' }, body: 'no', mediaSeconds: 0 }), 'an outsider cannot talk');

  viewer = b;
  await assert.rejects(store2.setRoomPrivacy('r1', 'open', null), 'only the host changes the setting');
  await assert.rejects(store2.removeFromRoom('r1', 'a'), 'nobody removes the host');

  viewer = a;
  await store2.setRoomPrivacy('r1', 'open', null);
  await store2.sendMessage({ roomId: 'r1', queueEntryId: null, mediaItemId: null, author: { id: 'a', label: 'A' }, body: 'open now', mediaSeconds: 0 });
  viewer = c;
  const opened = await store2.readRoom('r1');
  assert.deepEqual(opened.messages.map((m) => m.body), ['open now'], 'opening a room never opens its past');
  assert.ok(!opened.messages.some((m) => m.id === said.id));

  viewer = a;
  await store2.removeFromRoom('r1', 'b');
  viewer = b;
  assert.equal(await store2.enterRoom('r1', null), 'removed', 'removed means out, and no way back');
  assert.equal((await store2.readDoor('r1')).removed, true);
  await assert.rejects(store2.sendMessage({ roomId: 'r1', queueEntryId: null, mediaItemId: null, author: { id: 'b', label: 'B' }, body: 'still?', mediaSeconds: 0 }));
  delete globalThis.window;
  console.log('  ok    the mock store');
}

/* --- the go-live and door windows, drawn ------------------------------------------------------------ */

function drawn() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'GoLiveWindow.tsx'), 'utf8');
  assert.match(source, /useState<RoomPrivacy>\('private'\)/, 'PRIVATE is already picked');
  const GoLiveWindow = require('./private-streams-out/components/GoLiveWindow.js');
  const RoomDoor = require('./private-streams-out/components/RoomDoor.js');
  const RoomSettingsWindow = require('./private-streams-out/components/RoomSettingsWindow.js');
  for (const component of [GoLiveWindow, RoomDoor, RoomSettingsWindow]) assert.equal(typeof component.default, 'function');
}

/* --- the real database ------------------------------------------------------------------------------ */

async function live() {
  loadEnv();
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const c = await testAccountClient('C');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const room = randomUUID();
  const password = randomUUID();
  let threadId = null;
  let roomGone = false;
  const rowsOf = async (client, table, column = 'room_id') => {
    const { data, error } = await client.from(table).select(column).eq(column, room);
    assert.equal(error, null, `${table} answers`);
    return data.length;
  };
  const say = (who, body) => who.client.from('watch_messages').insert({ room_id: room, author_id: who.id, author_label: who.displayName, body, media_seconds: 0 }).select('id').single();
  const canJoinWire = async (client, topic) => {
    const channel = client.channel(topic, { config: { private: true } });
    channel.on('presence', { event: 'sync' }, () => undefined);
    const status = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('NO ANSWER'), 8000);
      channel.subscribe((answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
    });
    await client.removeChannel(channel);
    return status === 'SUBSCRIBED';
  };

  const made = await a.client.from('watch_rooms').insert({ id: room, original_host_id: a.id, original_host_label: a.displayName, host_id: a.id, position_seconds: 0, is_playing: false, privacy: 'password' });
  assert.equal(made.error, null, 'A opens a room');
  try {
    const { error: setError } = await a.client.rpc('watch_room_set_privacy', { room, new_privacy: 'password', new_password: password });
    assert.equal(setError, null, 'A sets its password');

    // A stranger, signed in or not.
    for (const [name, client] of [['C', c.client], ['a visitor', visitor]]) {
      assert.equal(await rowsOf(client, 'watch_rooms', 'id'), 0, `${name} cannot see the room`);
      assert.equal(await rowsOf(client, 'watch_messages'), 0, `${name} cannot read the chat`);
      assert.equal(await rowsOf(client, 'watch_queue'), 0, `${name} cannot read the queue`);
      assert.equal(await rowsOf(client, 'watch_crowns'), 0, `${name} cannot read the crowns`);
      assert.equal(await canJoinWire(client, `watch:${room}`), false, `${name} cannot hear who is there`);
    }
    assert.equal(await canJoinWire(c.client, `canvas:${room}`), false, 'C cannot see strokes');
    assert.equal((await visitor.rpc('watch_join', { room, password })).error?.code, REFUSED, 'a visitor cannot try the password');
    for (const table of ['watch_room_passwords', 'watch_join_attempts']) {
      assert.equal((await a.client.from(table).select('room_id').eq('room_id', room)).error?.code, REFUSED, `${table} can't be read, by the host either`);
    }
    assert.equal((await c.client.from('watch_members').insert({ room_id: room, user_id: c.id, label: 'C' })).error?.code, REFUSED, 'nobody writes themselves in');
    assert.ok((await say(c, 'let me in')).error !== null, 'C cannot talk in it');

    // The door.
    const door = (await c.client.rpc('watch_room_door', { room })).data[0];
    assert.equal(door.found, true);
    assert.equal(door.title, 'THIS ROOM', "the door doesn't give the host's name");
    assert.equal(door.privacy, 'password');

    // The lock.
    const answers = [];
    for (let i = 0; i < 5; i += 1) answers.push((await c.client.rpc('watch_join', { room, password: 'wrong' })).data);
    assert.deepEqual(answers, ['wrong', 'wrong', 'wrong', 'wrong', 'locked'], 'the fifth wrong try locks');
    assert.equal((await c.client.rpc('watch_join', { room, password })).data, 'locked', 'and then even the right password waits');
    assert.notEqual((await c.client.rpc('watch_room_door', { room })).data[0].locked_until, null, 'the door says how long');
    assert.equal(await rowsOf(c.client, 'watch_rooms', 'id'), 0);

    // In.
    assert.equal((await b.client.rpc('watch_join', { room, password })).data, 'joined', 'B joins with the password');
    assert.equal(await rowsOf(b.client, 'watch_rooms', 'id'), 1, 'B reads the room');
    const first = await say(b, 'said while private');
    assert.equal(first.error, null, 'B talks');
    assert.equal(await rowsOf(a.client, 'watch_messages'), 1, 'A reads it');
    const before = await rowsOf(a.client, 'watch_messages');
    assert.equal(before, 1);
    assert.equal(await canJoinWire(b.client, `watch:${room}`), true, 'B hears who is there');
    assert.equal(await canJoinWire(b.client, `canvas:${room}`), true, 'B sees strokes');

    // The setting moves only through the function.
    await a.client.from('watch_rooms').update({ privacy: 'open' }).eq('id', room);
    assert.equal((await a.client.from('watch_rooms').select('privacy').eq('id', room).single()).data.privacy, 'password', 'writing to the room directly changes nothing');
    assert.equal((await b.client.rpc('watch_room_set_privacy', { room, new_privacy: 'open' })).error?.code, REFUSED, 'only the host can change it');
    assert.equal((await b.client.rpc('watch_remove_member', { room, person: a.id })).error?.code, REFUSED, 'B has no crown to remove anyone with');
    const forged = await c.client.from('watch_messages').insert({ room_id: room, author_id: c.id, author_label: 'C', body: 'x', media_seconds: 0, privacy_at_write: 'open' });
    assert.equal(forged.error?.code, REFUSED, 'nor can a message claim to be open');

    // Removed.
    assert.equal((await a.client.rpc('watch_remove_member', { room, person: a.id })).error?.code, REFUSED, 'the host cannot be removed');
    assert.equal((await a.client.rpc('watch_remove_member', { room, person: b.id })).error, null, 'A removes B');
    assert.equal(await rowsOf(b.client, 'watch_rooms', 'id'), 0, 'B reads nothing any more');
    assert.equal(await rowsOf(b.client, 'watch_messages'), 0);
    assert.ok((await say(b, 'still here')).error !== null, 'B cannot talk');
    assert.equal((await b.client.rpc('watch_join', { room, password })).data, 'removed', 'B cannot rejoin');
    assert.equal(await canJoinWire(b.client, `watch:${room}`), false, 'B cannot rejoin the wire');

    // What outsiders get: tags, times, sizes and counts. C is outside, and B was removed.
    const secret = 'zebra-marmalade-outline';
    const words = await say(a, secret);
    assert.equal(words.error, null);
    await a.client.from('watch_queue').insert({ room_id: room, position: 0, source_url: 'https://example.com/queue-title-secret.mp4', source_kind: 'file', source_title: 'queue-title-secret', added_by: a.id, in_queue: false });
    const thread = randomUUID();
    const filed = await a.client.from('forum_threads').insert({ id: thread, title: 'host-title-secret', body: '', author_id: a.id, author_label: a.displayName, anchor_kind: 'board', anchor_id: `watch:${room}`, anchor_label: 'STREAM' });
    assert.equal(filed.error, null, 'the host files the record');
    threadId = thread;
    for (const [name, client] of [['C', c.client], ['a visitor', visitor]]) {
      const outline = (await client.rpc('watch_room_outline', { room })).data;
      const told = JSON.stringify(outline);
      assert.ok(!told.includes(secret) && !told.includes('said while private') && !told.includes(a.displayName) && !told.includes('queue-title-secret') && !told.includes(a.id), `${name}: the outline holds no words, names or titles`);
      assert.match(outline.people[0], /^ANON-\d+$/, `${name} is told ANON tags`);
      assert.equal(outline.messages.length, 2, `${name} is told how many lines`);
      assert.deepEqual(Object.keys(outline.messages[0]).sort(), ['seconds', 'size', 'tag'], `${name} gets a tag, a time and a size, and nothing else`);
      assert.ok(['short', 'medium', 'long'].includes(outline.messages[0].size), 'in three sizes');
      assert.equal((await client.from('forum_threads').select('id').eq('id', thread)).data.length, 0, `${name} cannot read the record`);
      const listed = (await client.rpc('stream_record_outlines')).data.find((row) => row.thread_id === thread);
      assert.ok(listed !== undefined, `${name} is told it exists`);
      assert.deepEqual(Object.keys(listed).sort(), ['messages', 'on_day', 'thread_id'], 'and only that');
      const bars = JSON.stringify((await client.rpc('stream_record_outline', { thread })).data);
      assert.ok(!bars.includes(secret) && bars.includes('ANON-'), `${name}: the record comes in bars`);
      const rooms = (await client.rpc('watch_private_rooms')).data;
      assert.ok(rooms.length > 0 && rooms.every((row) => row.id === undefined && Object.keys(row).sort().join() === 'joined,messages,strokes'), `${name}: the ROOM tab gets counts, and no link`);
    }
    assert.equal((await a.client.from('forum_threads').select('title').eq('id', thread)).data[0]?.title, 'host-title-secret', 'the host reads the record');
    assert.equal((await a.client.rpc('stream_record_outlines')).data.some((row) => row.thread_id === thread), false, 'and is not told about their own as a stranger');

    // Nobody outside replies, or is told.
    const reply = (who) => who.client.from('forum_comments').insert({ thread_id: thread, body: 'reply-secret', author_id: who.id, author_label: who.displayName });
    assert.equal((await reply(c)).error?.code, REFUSED, 'C cannot reply under it');
    assert.equal((await reply(b)).error?.code, REFUSED, 'nor can B, removed');
    assert.equal((await reply(a)).error, null, 'the host can');
    assert.equal((await c.client.from('forum_comments').select('id').eq('thread_id', thread)).data.length, 0, 'C cannot read the reply');
    assert.equal((await visitor.from('forum_comments').select('id').eq('thread_id', thread)).data.length, 0, 'nor can a visitor');
    const told = await a.client.from('forum_notifications').insert({ user_id: c.id, actor_id: a.id, actor_name: a.displayName, kind: 'reply', thread_id: thread, thread_title: 'host-title-secret', body: 'reply-secret' });
    assert.equal(told.error?.code, REFUSED, 'and nobody outside can be sent a notification about it');

    // A record can't be claimed by somebody else, or moved by its author.
    const fake = randomUUID();
    await c.client.from('forum_threads').insert({ id: fake, title: 'fake record', body: '', author_id: c.id, author_label: c.displayName, anchor_kind: 'board', anchor_id: `watch:${room}`, anchor_label: 'STREAM' });
    const claimed = (await c.client.from('forum_threads').select('watch_room_id, privacy_at_write').eq('id', fake).single()).data;
    assert.equal(claimed.watch_room_id, null, "C's thread is not tied to A's room");
    await c.client.from('forum_threads').delete().eq('id', fake);
    await a.client.from('forum_threads').update({ privacy_at_write: 'open', watch_room_id: null }).eq('id', thread);
    assert.equal((await a.client.from('forum_threads').select('privacy_at_write').eq('id', thread).single()).data.privacy_at_write, 'private', 'a record stays private, even for its author');

    // A drawing: nobody out of the room can save one, and a saved picture's file follows its own row.
    const canvas = randomUUID();
    const opened = await a.client.from('room_canvases').insert({ id: canvas, room_id: room, host_id: a.id, host_label: a.displayName, title: 'CHECK', opened_by: a.id });
    assert.equal(opened.error, null, 'A opens a canvas');
    assert.equal((await b.client.rpc('room_canvas_save', { canvas })).data, false, 'B, removed, cannot save it');
    assert.equal((await c.client.rpc('room_canvas_save', { canvas })).data, false, 'nor can C, who was never in');
    assert.equal((await c.client.from('room_canvases').select('id').eq('id', canvas)).data.length, 0, 'C cannot see it');
    assert.equal((await b.client.from('room_canvases').select('id').eq('id', canvas)).data.length, 0, 'nor B');
    assert.equal((await a.client.rpc('room_canvas_close', { canvas })).error, null);

    // Going open never opens the past.
    assert.equal((await a.client.rpc('watch_room_set_privacy', { room, new_privacy: 'open' })).error, null, 'A opens the room');
    const second = await say(a, 'said while open');
    assert.equal(second.error, null);
    const seen = (await visitor.from('watch_messages').select('id').eq('room_id', room)).data.map((row) => row.id);
    assert.deepEqual(seen, [second.data.id], 'a visitor reads what came after, and nothing before');
    assert.equal((await visitor.from('forum_threads').select('id').eq('id', threadId)).data.length, 0, 'and the record that started private stays private');
    assert.equal(await rowsOf(visitor, 'watch_rooms', 'id'), 1, 'and sees the room');
    assert.equal((await visitor.from('watch_messages').select('body').eq('id', first.data.id)).data.length, 0);
    assert.ok((await say(b, 'and now?')).error !== null, 'removed still means removed in an open room');

    // Its own room goes at the end (migration 20261108174247): never while running, and only by its test-account host.
    // Its record goes first: a room's delete blanks the record's link to it, which the record's own guard refuses.
    assert.equal((await a.client.from('forum_threads').delete().eq('id', threadId)).error, null, 'the host deletes the test record');
    threadId = null;
    const gone = async (client) => {
      const { data, error } = await client.from('watch_rooms').delete().eq('id', room).select('id');
      if (error) return `error ${error.code}: ${error.message}`;
      return data.length;
    };
    assert.equal(await gone(a.client), 0, 'a room still running cannot be deleted, by its host either');
    await a.client.from('watch_rooms').update({ is_playing: false, ended_at: new Date().toISOString() }).eq('id', room);
    assert.equal(await gone(c.client), 0, 'a finished room cannot be deleted by anyone but its host');
    assert.equal(await gone(visitor), 0, 'nor by a visitor');
    assert.equal(await gone(a.client), 1, 'its test-account host deletes it');
    assert.equal(await rowsOf(a.client, 'watch_rooms', 'id'), 0, 'and it is gone');
    roomGone = true;

    console.log('  ok    the real database');
  } finally {
    if (threadId !== null) await a.client.from('forum_threads').delete().eq('id', threadId);
    if (!roomGone) {
      await a.client.from('watch_rooms').update({ is_playing: false, ended_at: new Date().toISOString() }).eq('id', room);
      await a.client.from('watch_rooms').delete().eq('id', room);
    }
  }
}

(async () => {
  await mock();
  drawn();
  await live();
  console.log('private streams: outsiders read nothing, the lock holds, removed stays removed, and opening never opens the past.');
  process.exit(0);
})().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
