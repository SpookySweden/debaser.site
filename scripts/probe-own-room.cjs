/*
 * The live proof that an own room is locked by the database's own rules (SPEC-rooms-queues.md, phase 1), as a few
 * short requests and no browser. It WRITES (three queue rows in TEST ACCOUNT A's own room, which it then takes out
 * again through the rule that lets an owner clear played rows), so it is named outside `check-*` and never runs in
 * `npm run checks`. Run it by hand, once, after the migration is in:
 *
 *   node scripts/probe-own-room.cjs
 *
 * Signs in as the kept test accounts A and B (and C if it exists), and asks as a signed-out visitor too. Never signs
 * anybody up. What it leaves: TEST ACCOUNT A's own room itself (one row of `watch_rooms`, kept on purpose: a person's
 * own room is never deleted), with an empty queue.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { loadEnv, testAccountClient } = require('./browser.cjs');

let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

(async () => {
  loadEnv();
  const { createClient } = require('@supabase/supabase-js');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const c = await testAccountClient('C').catch(() => null);

  console.log("A's own room");
  let room = (await a.client.from('watch_rooms').select('id, is_public, privacy, origin').eq('original_host_id', a.id).eq('origin', 'music').maybeSingle()).data;
  if (room === null) {
    const made = await a.client
      .from('watch_rooms')
      .insert({ id: randomUUID(), original_host_id: a.id, original_host_label: a.displayName, host_id: a.id, origin: 'music', is_public: false, privacy: 'private', position_seconds: 0, is_playing: false })
      .select('id, is_public, privacy, origin')
      .single();
    assert.equal(made.error, null, `A makes their own room (${made.error?.message})`);
    room = made.data;
    pass('A made their own room (the first play ever)');
  } else {
    pass('A already has their own room: found, not made twice');
  }
  assert.equal(room.is_public, false);
  assert.equal(room.privacy, 'private');
  const roomId = room.id;

  const again = await a.client.from('watch_rooms').insert({ id: randomUUID(), original_host_id: a.id, original_host_label: a.displayName, host_id: a.id, origin: 'music', is_public: false, privacy: 'private' });
  assert.ok(again.error !== null, 'a second own room for the same person is refused');
  pass('one own room per person: a second is refused');

  const open = await a.client.from('watch_rooms').update({ is_public: true }).eq('id', roomId).select('id, is_public');
  if (open.error === null && (open.data ?? []).some((row) => row.is_public)) {
    await a.client.from('watch_rooms').update({ is_public: false }).eq('id', roomId);
    throw new Error("A's own room could be switched public: rule 1 is NOT in the database (switched back off)");
  }
  pass('the owner cannot switch their own room public: the database refuses (rule 1)');

  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const before = (await a.client.from('watch_queue').select('id', { count: 'exact', head: true }).eq('room_id', roomId)).count ?? 0;
  for (const [index, id] of ids.entries()) {
    const at = new Date().toISOString();
    const row = await a.client.from('watch_queue').upsert(
      [{ id, room_id: roomId, position: 9000 + index, in_queue: true, source_url: `/assets/audio/probe-${index}.mp3`, source_kind: 'audio', source_title: `PROBE ${index}`, added_by: a.id, played_at: at, play_index: 9000 + index }],
      { onConflict: 'id', ignoreDuplicates: true },
    );
    assert.equal(row.error, null, `a play is filed (${row.error?.message})`);
    const point = await a.client.from('watch_rooms').update({ current_entry_id: id, position_seconds: 0, is_playing: true }).eq('id', roomId);
    assert.equal(point.error, null, `the room is pointed at it (${point.error?.message})`);
  }
  const after = (await a.client.from('watch_queue').select('id', { count: 'exact', head: true }).eq('room_id', roomId)).count ?? 0;
  assert.equal(after - before, 3, 'three songs: three rows (and three room writes), as the site writes them');
  pass('three plays: 3 queue rows written and 3 room writes, each accepted');

  console.log('Everybody else, holding the room address');
  const outsiders = [
    ['TEST ACCOUNT B', b.client],
    ...(c === null ? [] : [['TEST ACCOUNT C', c.client]]),
    ['a signed-out visitor', visitor],
  ];
  for (const [who, client] of outsiders) {
    const rooms = await client.from('watch_rooms').select('id').eq('id', roomId);
    assert.deepEqual(rooms.data ?? [], [], `${who} reads no room`);
    const queue = await client.from('watch_queue').select('id').eq('room_id', roomId);
    assert.deepEqual(queue.data ?? [], [], `${who} reads no queue row`);
    const crowns = await client.from('watch_crowns').select('user_id').eq('room_id', roomId);
    assert.deepEqual(crowns.data ?? [], [], `${who} reads no crown`);
    const members = await client.from('watch_members').select('user_id').eq('room_id', roomId);
    assert.deepEqual(members.data ?? [], [], `${who} reads no member`);
    const listed = await client.from('watch_rooms').select('id').is('ended_at', null).limit(200);
    assert.ok(!(listed.data ?? []).some((row) => row.id === roomId), `${who} does not find it on the list of rooms`);
    const mine = await client.from('watch_rooms').select('id').eq('original_host_id', a.id).eq('origin', 'music');
    assert.deepEqual(mine.data ?? [], [], `${who} cannot look it up by its owner`);
    const door = await client.rpc('watch_room_door', { room: roomId });
    assert.equal(door.error, null);
    assert.equal(door.data?.[0]?.found, false, `${who}: the door says there is no such room`);
    const outline = await client.rpc('watch_room_outline', { room: roomId });
    assert.equal(outline.data ?? null, null, `${who}: no outline`);
    const join = await client.rpc('watch_join', { room: roomId, password: null });
    assert.ok(join.error !== null || join.data !== 'joined', `${who}: joining is refused (${join.data ?? join.error?.message})`);
    const add = await client.from('watch_queue').insert({ room_id: roomId, position: 1, in_queue: false, source_url: 'https://example.com/x.mp4', source_kind: 'file', source_title: 'X', added_by: client === visitor ? null : undefined });
    assert.ok(add.error !== null, `${who} cannot add to it`);
    const say = await client.from('watch_messages').insert({ room_id: roomId, body: 'hello', media_seconds: 0, author_label: 'X' });
    assert.ok(say.error !== null, `${who} cannot speak in it`);
    pass(`${who}: no room, queue, crown or member read; not listed; door "no such room"; no outline; join refused; cannot add or speak`);
  }
  const stillOnlyA = await a.client.from('watch_members').select('user_id').eq('room_id', roomId);
  assert.deepEqual((stillOnlyA.data ?? []).map((row) => row.user_id), [a.id], 'after all that, A is still the only member');
  pass("A is still the room's only member");

  console.log('Clearing up: the owner takes out played rows (rule 4a)');
  const cleared = await a.client.from('watch_queue').delete().eq('room_id', roomId).in('id', ids).select('id');
  assert.equal(cleared.error, null);
  assert.equal((cleared.data ?? []).length, 3, 'the owner deletes rows that have played, so they never pile up');
  await a.client.from('watch_rooms').update({ current_entry_id: null, position_seconds: 0, is_playing: false }).eq('id', roomId);
  pass('the three probe rows are out again: nothing left but the room itself');

  for (const account of [a, b, c]) if (account !== null) await account.client.auth.signOut({ scope: 'local' });
  console.log(`\n${passed} passed. Left behind: TEST ACCOUNT A's own room ${roomId} (kept on purpose, empty queue).`);
})().catch((failure) => {
  console.error(`\nFAILED after ${passed} passed: ${failure.message}`);
  process.exit(1);
});
