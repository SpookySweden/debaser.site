/*
 * The live proof for GO LIVE's carry (SPEC-rooms-queues.md, phase 3), as a few short requests and no browser: the
 * database lets a host file what was on and write their queue into tonight's room in one go, and a private room so
 * filled is still read by nobody outside it. It WRITES, so it is named outside `check-*` and never runs in
 * `npm run checks`. Run it by hand, once, after the phase is live:
 *
 *   node scripts/probe-go-live.cjs
 *
 * Signs in as the kept test accounts A and B (and C if it exists), and asks as a signed-out visitor too. Never signs
 * anybody up. A starts one PRIVATE stream room exactly as the site does, files a song as playing at 42.5 seconds,
 * writes two queued rows under ids made here (the carry), takes those two out again as a crown may, and ends the room.
 * What it leaves, printed at the end: that one ended room (a stream's record is kept) with its one played row.
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

  console.log('START: a new private room, as GO LIVE files it');
  const roomId = randomUUID();
  const made = await a.client
    .from('watch_rooms')
    .insert({ id: roomId, original_host_id: a.id, original_host_label: a.displayName, host_id: a.id, position_seconds: 0, is_playing: false, privacy: 'private' })
    .select('id, origin, privacy, is_public')
    .single();
  assert.equal(made.error, null, `the room starts (${made.error?.message})`);
  assert.equal(made.data.origin, 'stream', 'going live makes a stream room, never an own room');
  assert.equal(made.data.privacy, 'private');
  pass('A starts a private room');

  try {
    // What was on: filed as already playing, then pointed at where the bar had got to (`playNow`, `writePlayback`).
    const first = await a.client
      .from('watch_queue')
      .insert({ room_id: roomId, position: 0, in_queue: true, source_url: '/assets/audio/probe-carried.mp3', source_kind: 'audio', source_title: 'PROBE CARRIED', added_by: a.id, played_at: new Date().toISOString(), play_index: 0 })
      .select('id')
      .single();
    assert.equal(first.error, null, `the song that was on is filed as playing (${first.error?.message})`);
    const point = await a.client.from('watch_rooms').update({ current_entry_id: first.data.id, position_seconds: 42.5, is_playing: true }).eq('id', roomId).select('current_entry_id, position_seconds, is_playing');
    assert.equal(point.error, null, `the room is pointed at it (${point.error?.message})`);
    assert.equal(Number(point.data?.[0]?.position_seconds), 42.5, 'from the same spot');
    pass('what was on is the first play, at 42.5 seconds');

    // The queue, in one write, under ids the browser made (`addOwnEntries`).
    const ids = [randomUUID(), randomUUID()];
    const rows = ids.map((id, index) => ({
      id,
      room_id: roomId,
      position: index + 1,
      in_queue: true,
      media_item_id: null,
      source_url: index === 0 ? '/assets/audio/probe-next.mp3' : 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      source_kind: index === 0 ? 'audio' : 'youtube',
      source_title: `PROBE QUEUED ${index}`,
      added_by: a.id,
      played_at: null,
      play_index: null,
    }));
    const carried = await a.client.from('watch_queue').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    assert.equal(carried.error, null, `the queue goes in, in one write (${carried.error?.message})`);
    const again = await a.client.from('watch_queue').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    assert.equal(again.error, null, `sent twice (an answer lost), it does not fail (${again.error?.message})`);
    const held = await a.client.from('watch_queue').select('id, position, in_queue, played_at').eq('room_id', roomId).order('position');
    assert.equal((held.data ?? []).length, 3, 'the room holds the play and the two queued rows, each once');
    assert.deepEqual((held.data ?? []).slice(1).map((row) => row.id), ids, 'in order behind what is on');
    pass('the queue is written behind it in one go, under the browser\'s own ids, and a repeat does no harm');

    console.log('Nobody outside reads it');
    for (const [who, client] of [['TEST ACCOUNT B', b.client], ...(c === null ? [] : [['TEST ACCOUNT C', c.client]]), ['a signed-out visitor', visitor]]) {
      assert.deepEqual((await client.from('watch_rooms').select('id').eq('id', roomId)).data ?? [], [], `${who}: reads no room`);
      assert.deepEqual((await client.from('watch_queue').select('id').eq('room_id', roomId)).data ?? [], [], `${who}: reads none of the carried queue`);
      const sneak = await client.from('watch_queue').upsert([{ ...rows[0], id: randomUUID(), added_by: a.id }], { onConflict: 'id', ignoreDuplicates: true }).select('id');
      assert.ok(sneak.error !== null || (sneak.data ?? []).length === 0, `${who}: cannot write rows into it`);
      pass(`${who}: no room, no queue, no writing`);
    }
    assert.equal(((await a.client.from('watch_queue').select('id').eq('room_id', roomId)).data ?? []).length, 3, 'and nothing was added by them');

    console.log('Clearing up');
    const out = await a.client.from('watch_queue').delete().eq('room_id', roomId).in('id', ids).select('id');
    assert.equal(out.error, null);
    assert.equal((out.data ?? []).length, 2, 'the host, with a crown, takes the two queued rows out again');
    pass('the two queued rows are out again');
  } finally {
    const ended = await a.client.from('watch_rooms').update({ is_playing: false, ended_at: new Date().toISOString() }).eq('id', roomId).select('id, ended_at');
    if (ended.error === null && (ended.data ?? []).length === 1) pass('END STREAM: the room is ended');
    else console.log(`  NOTE the room could not be ended (${ended.error?.message ?? 'no row changed'}): it closes itself once its host has been quiet`);
  }

  for (const account of [a, b, c]) if (account !== null) await account.client.auth.signOut({ scope: 'local' });
  console.log(`\n${passed} passed. Left behind: the ended stream room ${roomId} (TEST ACCOUNT A's, private) with its one played row.`);
})().catch((failure) => {
  console.error(`\nFAILED after ${passed} passed: ${failure.message}`);
  process.exit(1);
});
