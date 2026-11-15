/*
 * The live proof for pictures in a queue (SPEC-rooms-queues.md, phase 5), as a few short requests and no browser:
 * the database takes a picture row (one of the site's own paths, or https), refuses an address that only looks
 * like the site's, and lets only the host or a crown take a showing picture off (`watch_picture_next`). It WRITES,
 * so it is named outside `check-*` and never runs in `npm run checks`. Run it by hand, once, after the phase is live:
 *
 *   node scripts/probe-pictures.cjs
 *
 * Signs in as the kept test accounts A and B (and C if it exists). Never signs anybody up. A starts one PRIVATE
 * stream room as the site does, B joins it, A queues pictures and puts one on; C (outside) and B (inside, no crown)
 * cannot take it off; A crowns B and B can. Then A takes B's crown back and ends the room.
 * What it leaves, printed at the end: that one ended room with its played rows and B's member row.
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

    const row = (position, url, title, kind = 'picture') => ({ room_id: roomId, position, in_queue: true, source_url: url, source_kind: kind, source_title: title, added_by: a.id });
    const sitePicture = await a.client.from('watch_queue').insert(row(0, '/assets/files/probe-picture.png', 'PROBE PICTURE (SITE PATH)')).select('id').single();
    assert.equal(sitePicture.error, null, `a picture at one of the site's own paths is taken (${sitePicture.error?.message})`);
    const webPicture = await a.client.from('watch_queue').insert(row(1, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Probe.jpg/640px-Probe.jpg', 'PROBE PICTURE (HTTPS)')).select('id').single();
    assert.equal(webPicture.error, null, `an https picture is taken (${webPicture.error?.message})`);
    pass("the database takes a picture row: one of the site's own paths, and https");

    for (const [url, why] of [
      ['//evil.example/x.png', 'two slashes is another host'],
      ['http://evil.example/x.png', 'plain http'],
      ['javascript:alert(1)', 'not an address at all'],
    ]) {
      const bad = await a.client.from('watch_queue').insert(row(9, url, 'PROBE BAD')).select('id');
      assert.ok(bad.error !== null, `refused: ${why}`);
    }
    const siteVideo = await a.client.from('watch_queue').insert(row(9, '/assets/files/probe.mp4', 'PROBE BAD', 'file')).select('id');
    assert.ok(siteVideo.error !== null, 'a site path is only for a song or a picture, never a video link');
    pass('it refuses //host, http and a non-address for a picture, and a site path for a video link');

    // A song on: NEXT-off-a-picture does nothing to it.
    const song = await a.client.from('watch_queue').insert({ ...row(2, '/assets/audio/probe-song.mp3', 'PROBE SONG', 'audio'), played_at: new Date().toISOString(), play_index: 0 }).select('id').single();
    assert.equal(song.error, null);
    await a.client.from('watch_rooms').update({ current_entry_id: song.data.id, position_seconds: 0, is_playing: true }).eq('id', roomId);
    const offSong = await a.client.rpc('watch_picture_next', { room: roomId });
    assert.equal(offSong.error, null, `the function answers (${offSong.error?.message})`);
    assert.equal(offSong.data, false, 'with a song on it does nothing, even for the host');
    assert.equal((await a.client.from('watch_rooms').select('current_entry_id').eq('id', roomId).single()).data.current_entry_id, song.data.id, 'the song is still on');
    pass('watch_picture_next leaves a song alone');

    // The picture's turn.
    const pictureId = sitePicture.data.id;
    await a.client.from('watch_queue').update({ played_at: new Date().toISOString(), play_index: 1 }).eq('id', pictureId).eq('room_id', roomId);
    await a.client.from('watch_rooms').update({ current_entry_id: pictureId, position_seconds: 0, is_playing: true }).eq('id', roomId);
    const on = async () => (await a.client.from('watch_rooms').select('current_entry_id').eq('id', roomId).single()).data.current_entry_id;
    assert.equal(await on(), pictureId, 'the picture is on');

    if (c !== null) {
      const outsider = await c.client.rpc('watch_picture_next', { room: roomId });
      assert.ok(outsider.error !== null || outsider.data === false, 'C, outside the room, cannot take it off');
      assert.equal(await on(), pictureId);
    }
    const noCrown = await b.client.rpc('watch_picture_next', { room: roomId });
    assert.ok(noCrown.error !== null || noCrown.data === false, 'B, in the room with no crown, cannot take it off');
    assert.equal(await on(), pictureId, 'it is still on');
    pass(`somebody with no crown${c === null ? '' : ', and somebody outside the room,'} cannot take the picture off`);

    const crowned = await a.client.from('watch_crowns').insert({ room_id: roomId, user_id: b.id, given_by: a.id });
    assert.equal(crowned.error, null, `A crowns B (${crowned.error?.message})`);
    const byCrown = await b.client.rpc('watch_picture_next', { room: roomId });
    assert.equal(byCrown.data, true, `B, crowned, takes it off (${byCrown.error?.message})`);
    assert.equal(await on(), null, "the room's pointer is cleared, for the host's tab to start what is next");
    pass('a crown takes the picture off: the pointer is cleared');

    await a.client.from('watch_rooms').update({ current_entry_id: pictureId, position_seconds: 0, is_playing: true }).eq('id', roomId);
    const byHost = await a.client.rpc('watch_picture_next', { room: roomId });
    assert.equal(byHost.data, true, 'the host takes it off too');
    pass('so does the host');

    console.log('Clearing up');
    await a.client.from('watch_crowns').delete().eq('room_id', roomId).eq('user_id', b.id);
    const out = await a.client.from('watch_queue').delete().eq('room_id', roomId).eq('id', webPicture.data.id).select('id');
    if ((out.data ?? []).length === 1) pass('the picture that never showed is out again, and B is uncrowned');
  } finally {
    const ended = await a.client.from('watch_rooms').update({ is_playing: false, ended_at: new Date().toISOString() }).eq('id', roomId).select('id');
    if (ended.error === null && (ended.data ?? []).length === 1) pass('END STREAM: the room is ended');
    else console.log(`  NOTE the room could not be ended (${ended.error?.message ?? 'no row changed'}): it closes itself once its host has been quiet`);
  }

  for (const account of [a, b, c]) if (account !== null) await account.client.auth.signOut({ scope: 'local' });
  console.log(`\n${passed} passed. Left behind: the ended stream room ${roomId} (TEST ACCOUNT A's, private) with its two played rows and TEST ACCOUNT B's member row.`);
})().catch((failure) => {
  console.error(`\nFAILED after ${passed} passed: ${failure.message}`);
  process.exit(1);
});
