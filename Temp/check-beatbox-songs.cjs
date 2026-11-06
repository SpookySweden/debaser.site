/*
 * Saved beat box songs against the live project (--env-file=.env.local, so the suite leaves it out; run it by hand).
 *   npx tsc app/lib/beatbox/supabase-song-repository.ts app/lib/beatbox/mock-song-repository.ts --rootDir app --outDir Temp/beatbox-songs-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 *   node --env-file=.env.local Temp/check-beatbox-songs.cjs
 *
 * Signs in as the kept TEST ACCOUNT A and B through the app's own code. Its writes: A's own test songs, all deleted again.
 *   1. A saves a song, changes it, and reads it back.
 *   2. B, and a visitor with no session, can't read, change or delete A's song, and can't save one as A.
 *   3. The table holds the title and song limits, and at most 100 songs a person.
 *   4. The mock store does the same for each person, by the same names.
 */
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { testAccountClient } = require('../scripts/browser.cjs');
const { createSupabaseSongRepository } = require('./beatbox-songs-out/lib/beatbox/supabase-song-repository.js');
const { createMockSongRepository } = require('./beatbox-songs-out/lib/beatbox/mock-song-repository.js');

const SONG = '9n31s0k0l00e03t2ma7g0fj07r1i0o432';

async function refused(promise, words) {
  const { data, error } = await promise;
  assert.ok(error !== null || (data ?? []).length === 0, words);
}

(async () => {
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const songs = createSupabaseSongRepository(a.client);
  const others = createSupabaseSongRepository(b.client);

  // Anything left by an earlier run that stopped part way.
  await a.client.from('beatbox_songs').delete().eq('owner', a.id);

  try {
    // 1. The owner's own.
    const saved = await songs.add(a.id, 'CHECK SONG', SONG);
    assert.equal(saved.title, 'CHECK SONG');
    const changed = await songs.update(a.id, saved.id, `${SONG}x`);
    assert.equal(changed.song, `${SONG}x`);
    assert.ok(changed.updatedAt >= saved.updatedAt, 'last changed moves on');
    assert.deepEqual((await songs.list(a.id)).map((row) => row.id), [saved.id]);

    // 2. Nobody else's.
    assert.deepEqual(await others.list(a.id), [], "B can't read A's songs");
    for (const [who, client] of [['B', b.client], ['a visitor', visitor]]) {
      const read = await client.from('beatbox_songs').select('id').eq('id', saved.id);
      await refused(Promise.resolve(read), `${who} reads A's song`);
      await refused(client.from('beatbox_songs').update({ title: 'TAKEN' }).eq('id', saved.id).select('id'), `${who} changes A's song`);
      await refused(client.from('beatbox_songs').delete().eq('id', saved.id).select('id'), `${who} deletes A's song`);
      const asA = await client.from('beatbox_songs').insert({ owner: a.id, title: 'FORGED', song: SONG }).select('id');
      assert.ok(asA.error !== null, `${who} saves a song as A`);
    }
    const handOver = await a.client.from('beatbox_songs').update({ owner: b.id }).eq('id', saved.id).select('id');
    assert.ok(handOver.error !== null, "A can't hand a song to B");
    assert.equal((await songs.list(a.id))[0].song, `${SONG}x`, 'and it is untouched');

    // 3. The limits.
    await assert.rejects(songs.add(a.id, '', SONG), 'an empty title is refused');
    await assert.rejects(songs.add(a.id, 'x'.repeat(61), SONG), 'a long title is refused');
    await assert.rejects(songs.add(a.id, 'LONG', 'x'.repeat(100001)), 'a long song is refused');
    for (let start = 1; start < 100; start += 33) {
      const rows = Array.from({ length: Math.min(33, 100 - start) }, (_, index) => ({ title: `CHECK ${start + index}`, song: SONG }));
      const { error } = await a.client.from('beatbox_songs').insert(rows);
      assert.equal(error, null);
    }
    assert.equal((await songs.list(a.id)).length, 100);
    await assert.rejects(songs.add(a.id, 'ONE TOO MANY', SONG), /100 saved songs/);
    // Trying to save as A says the same whether A is full or not, so it gives nothing away.
    const asFull = await b.client.from('beatbox_songs').insert({ owner: a.id, title: 'FORGED', song: SONG });
    assert.equal(asFull.error?.code, '42501', "saving as someone full is the plain refusal, not the limit's message");
    assert.deepEqual(await others.list(b.id), [], "A's limit is not B's list");
  } finally {
    await a.client.from('beatbox_songs').delete().eq('owner', a.id);
  }
  assert.deepEqual(await songs.list(a.id), [], 'the run leaves nothing behind');

  // 4. The mock store.
  const mock = createMockSongRepository();
  const first = await mock.add('a', 'ONE', SONG);
  assert.deepEqual(await mock.list('b'), [], 'the mock keeps people apart');
  await assert.rejects(mock.update('b', first.id, 'x'), 'and refuses someone else');
  await mock.remove('b', first.id);
  assert.equal((await mock.list('a')).length, 1);
  assert.equal((await mock.update('a', first.id, 'x')).song, 'x');
  assert.equal((await mock.list('a'))[0].song, 'x');
  await assert.rejects(mock.add('a', '', SONG), 'the mock refuses an empty title');
  await assert.rejects(mock.add('a', 'x'.repeat(61), SONG), 'and a long one');
  await assert.rejects(mock.add('a', 'LONG', 'x'.repeat(100001)), 'and a long song');
  await assert.rejects(mock.update('a', first.id, 'x'.repeat(100001)), 'and saving over with one');
  await mock.remove('a', first.id);
  for (let index = 0; index < 100; index += 1) await mock.add('a', `S${index}`, SONG);
  await assert.rejects(mock.add('a', 'ONE TOO MANY', SONG), /100 saved songs/);

  console.log("saved songs: the owner's own, nobody else's, the limits, and the mock's the same: OK");
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
