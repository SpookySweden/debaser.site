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
 * own room is never deleted), with an empty queue. Once the link migration is in it also probes the link (COPY, JOIN,
 * REFRESH, REMOVE) and leaves: A's room with a link (refreshed at the end, so no secret a run saw still works), TEST
 * ACCOUNT B marked REMOVED from A's room (one row of `watch_members`), and B's own room's link refreshed if B has a room.
 * A second run says B is already removed and skips the join steps.
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

  /* The link (20261114152339_own_room_links.sql). Skipped, and said so, until that migration is in. */
  const linked = await a.client.rpc('watch_own_link', { refresh: false });
  let addition = null;
  if (linked.error !== null) {
    console.log(`  NOTE the link functions are not in the database yet (${linked.error.message}): the link was not probed`);
  } else {
    console.log('The link: COPY, JOIN, REFRESH, REMOVE');
    const secret = linked.data;
    assert.ok(typeof secret === 'string' && /^[0-9a-f]{64}$/.test(secret), 'COPY LINK gives the owner a 64-character secret');
    assert.equal((await a.client.rpc('watch_own_link', { refresh: false })).data, secret, 'asked again, the same one');
    for (const [who, client] of outsiders) {
      const table = await client.from('watch_room_links').select('room_id, token').limit(5);
      assert.ok(table.error !== null || (table.data ?? []).length === 0, `${who} cannot read the table of secrets`);
      const wrong = await client.rpc('watch_join_link', { link: 'f'.repeat(64) });
      assert.ok(wrong.error !== null || wrong.data === null, `${who}: a wrong secret gets nothing`);
      const stillOut = await client.from('watch_rooms').select('id').eq('id', roomId);
      assert.deepEqual(stillOut.data ?? [], [], `${who}: a link existing lets nobody in by the address`);
    }
    const asVisitor = await visitor.rpc('watch_join_link', { link: secret });
    assert.ok(asVisitor.error !== null || asVisitor.data === null, 'a signed-out visitor cannot join even with the link');
    const ownerOnly = await a.client.from('watch_room_links').select('token').limit(1);
    assert.ok(ownerOnly.error !== null || (ownerOnly.data ?? []).length === 0, 'even the owner cannot read the table: only the function hands the secret over');
    pass('the secret: only its owner is handed it; nobody reads the table; a wrong one, the address alone, and a visitor with the right one all get nothing');

    const bWas = await b.client.from('watch_members').select('removed_at').eq('room_id', roomId).eq('user_id', b.id);
    if ((bWas.data ?? []).some((row) => row.removed_at !== null)) {
      console.log("  NOTE TEST ACCOUNT B was REMOVED from A's room by an earlier run, so joining, adding, REFRESH and REMOVE were not probed again");
    } else {
      const joined = await b.client.rpc('watch_join_link', { link: secret });
      assert.equal(joined.error, null);
      assert.equal(joined.data, roomId, 'B, signed in with the current link, joins');
      const bRoom = await b.client.from('watch_rooms').select('id, current_entry_id, position_seconds, is_playing').eq('id', roomId);
      assert.equal((bRoom.data ?? []).length, 1, 'B reads the room: what is on and where');
      const bQueue = await b.client.from('watch_queue').select('id').eq('room_id', roomId);
      assert.equal((bQueue.data ?? []).length, 3, "B reads the owner's queue");
      const bDoor = await b.client.rpc('watch_room_door', { room: roomId });
      assert.equal(bDoor.data?.[0]?.found, true, 'the door knows B now');
      const add = await b.client.from('watch_queue').insert({ room_id: roomId, position: 9100, in_queue: false, source_url: '/assets/audio/probe-friend.mp3', source_kind: 'audio', source_title: 'PROBE FRIEND', added_by: b.id }).select('id, in_queue').single();
      assert.equal(add.error, null, `B adds to the queue (${add.error?.message})`);
      addition = add.data.id;
      assert.equal(add.data.in_queue, false, "B's addition waits on B's own list");
      const straight = await b.client.from('watch_queue').insert({ room_id: roomId, position: 9101, in_queue: true, source_url: '/assets/audio/probe-friend-2.mp3', source_kind: 'audio', source_title: 'PROBE FRIEND 2', added_by: b.id });
      assert.ok(straight.error !== null, 'B cannot put a thing straight into the queue: that takes the crown');
      const chat = await b.client.from('watch_messages').insert({ room_id: roomId, author_id: b.id, author_label: b.displayName, body: 'hello', media_seconds: 0 });
      assert.ok(chat.error !== null, 'B cannot chat in an own room');
      const takeOver = await b.client.from('watch_rooms').update({ is_playing: false }).eq('id', roomId).select('id');
      assert.deepEqual(takeOver.data ?? [], [], "B cannot write the owner's room");
      const theirs = await b.client.rpc('watch_own_link', { refresh: true });
      assert.ok(theirs.data !== secret, "B asking for a link is handed B's own room's (or none), never A's");
      assert.equal((await a.client.rpc('watch_own_link', { refresh: false })).data, secret, "and B's asking did not change A's");
      const pulled = await a.client.from('watch_queue').update({ in_queue: true, position: 9100 }).eq('id', addition).select('id');
      assert.equal((pulled.data ?? []).length, 1, "the owner pulls B's addition into the queue");
      pass('B with the link: joins, reads the room and the queue, adds to their own list, cannot queue straight, chat or write the room; the owner pulls the addition in');

      const fresh = (await a.client.rpc('watch_own_link', { refresh: true })).data;
      assert.ok(typeof fresh === 'string' && fresh !== secret, 'REFRESH LINK makes a new secret');
      if (c !== null) {
        const late = await c.client.rpc('watch_join_link', { link: secret });
        assert.ok(late.error !== null || late.data === null, 'the old link lets nobody new in');
        assert.deepEqual((await c.client.from('watch_rooms').select('id').eq('id', roomId)).data ?? [], [], 'C is still outside');
      }
      assert.equal(((await b.client.from('watch_rooms').select('id').eq('id', roomId)).data ?? []).length, 1, 'B, already in, stays in after the refresh');
      pass('REFRESH LINK: a new secret, the old one dead for somebody new, and nobody put out');

      const removed = await a.client.rpc('watch_remove_member', { room: roomId, person: b.id });
      assert.equal(removed.error, null, `the owner REMOVEs B (${removed.error?.message})`);
      assert.deepEqual((await b.client.from('watch_rooms').select('id').eq('id', roomId)).data ?? [], [], 'B reads nothing any more');
      assert.deepEqual((await b.client.from('watch_queue').select('id').eq('room_id', roomId)).data ?? [], [], 'not the queue either');
      const after = await b.client.rpc('watch_room_door', { room: roomId });
      assert.equal(after.data?.[0]?.removed, true, 'the door tells B they were removed');
      const back = await b.client.rpc('watch_join_link', { link: fresh });
      assert.ok(back.error !== null || back.data === null, 'and the new link does not let a removed person back in');
      pass('REMOVE: B reads nothing, is told "removed", and cannot come back by the new link');
    }
    // The link is left refreshed, so no secret this run saw can still open the room.
    await a.client.rpc('watch_own_link', { refresh: true });
  }

  console.log('Clearing up: the owner takes out played rows (rule 4a)');
  if (addition !== null) await a.client.from('watch_queue').delete().eq('room_id', roomId).eq('id', addition);
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
