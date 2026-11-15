/*
 * The live proof for taking a queued picture out before it shows (SPEC-rooms-queues.md, phase 6; the database's
 * delete rule, change 4b), as a few short requests and no browser: besides a crown, whoever added the picture and the
 * room's host may take it out, and nobody else. It WRITES, so it is named outside `check-*` and never runs in
 * `npm run checks`. Run it by hand, once, after the phase is live:
 *
 *   node scripts/probe-picture-removal.cjs
 *
 * Signs in as the kept test accounts A and B (and C if it exists). Never signs anybody up. A starts one PRIVATE
 * stream room, B joins and adds two outside pictures (they wait on B's own list), A pulls both into the queue. C
 * cannot take one out; B (no crown) takes out the one B added; A gives up their own crown and, as host alone, takes
 * out the other. A song B added the same way stays where it is: this way out is only for a picture.
 * What it leaves, printed at the end: that one ended room with the song row and B's member row.
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
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const c = await testAccountClient('C').catch(() => null);

  const roomId = randomUUID();
  const made = await a.client
    .from('watch_rooms')
    .insert({ id: roomId, original_host_id: a.id, original_host_label: a.displayName, host_id: a.id, position_seconds: 0, is_playing: false, privacy: 'private' })
    .select('id')
    .single();
  assert.equal(made.error, null, `the room starts (${made.error?.message})`);
  console.log('A private room, with B in it');

  try {
    const joined = await b.client.rpc('watch_join', { room: roomId, password: null });
    assert.equal(joined.data, 'joined', `B joins (${joined.error?.message ?? joined.data})`);

    const add = async (position, url, kind, title) => {
      const row = await b.client.from('watch_queue').insert({ room_id: roomId, position, in_queue: false, source_url: url, source_kind: kind, source_title: title, added_by: b.id }).select('id').single();
      assert.equal(row.error, null, `B adds ${title} (${row.error?.message})`);
      const pulled = await a.client.from('watch_queue').update({ in_queue: true }).eq('id', row.data.id).select('id');
      assert.equal((pulled.data ?? []).length, 1, `A pulls ${title} into the queue (${pulled.error?.message})`);
      return row.data.id;
    };
    const first = await add(1, 'https://pictures.example.net/probe-one.jpg', 'picture', 'PROBE OUTSIDE ONE');
    const second = await add(2, 'https://pictures.example.net/probe-two.jpg', 'picture', 'PROBE OUTSIDE TWO');
    const song = await add(3, '/assets/audio/probe-song.mp3', 'audio', 'PROBE SONG');
    pass('B, with no crown, adds two outside pictures and a song; A pulls them into the queue');

    const left = async () => ((await a.client.from('watch_queue').select('id').eq('room_id', roomId)).data ?? []).map((row) => row.id);
    if (c !== null) {
      const outsider = await c.client.from('watch_queue').delete().eq('id', first).select('id');
      assert.deepEqual(outsider.data ?? [], [], 'C, outside the room, takes nothing out');
      pass('somebody outside the room cannot take a picture out');
    }

    const notTheirSong = await b.client.from('watch_queue').delete().eq('id', song).select('id');
    assert.deepEqual(notTheirSong.data ?? [], [], 'a song B added, once pulled in, is not B\'s to take out without a crown');
    const byAdder = await b.client.from('watch_queue').delete().eq('id', first).select('id');
    assert.equal((byAdder.data ?? []).length, 1, `B takes out the picture B added, with no crown (${byAdder.error?.message})`);
    assert.ok(!(await left()).includes(first));
    pass('whoever added a picture takes it out, even after it was pulled into the queue; a song stays');

    const uncrowned = await a.client.from('watch_crowns').delete().eq('room_id', roomId).eq('user_id', a.id).select('user_id');
    if ((uncrowned.data ?? []).length === 1) {
      const byHost = await a.client.from('watch_queue').delete().eq('id', second).select('id');
      assert.equal((byHost.data ?? []).length, 1, `the host, with no crown, takes the other picture out (${byHost.error?.message})`);
      const hostSong = await a.client.from('watch_queue').delete().eq('id', song).select('id');
      assert.deepEqual(hostSong.data ?? [], [], 'but not a song: that still takes a crown');
      pass("the room's host takes a picture out with no crown; a song still takes a crown");
    } else {
      console.log("  NOTE the host's own crown could not be given up here, so the host-alone case was not asked; the picture is taken out with the crown");
      await a.client.from('watch_queue').delete().eq('id', second);
    }
    assert.deepEqual(await left(), [song], 'only the song is left');
  } finally {
    const ended = await a.client.from('watch_rooms').update({ is_playing: false, ended_at: new Date().toISOString() }).eq('id', roomId).select('id');
    if (ended.error === null && (ended.data ?? []).length === 1) pass('END STREAM: the room is ended');
    else console.log(`  NOTE the room could not be ended (${ended.error?.message ?? 'no row changed'}): it closes itself once its host has been quiet`);
  }

  for (const account of [a, b, c]) if (account !== null) await account.client.auth.signOut({ scope: 'local' });
  console.log(`\n${passed} passed. Left behind: the ended stream room ${roomId} (TEST ACCOUNT A's, private) with one unplayed song row and TEST ACCOUNT B's member row.`);
})().catch((failure) => {
  console.error(`\nFAILED after ${passed} passed: ${failure.message}`);
  process.exit(1);
});
