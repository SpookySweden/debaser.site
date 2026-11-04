/**
 * Does the live library actually behave - for two accounts, not one?
 *
 *   node Temp/check-music-library-live.cjs
 *
 * `check-music-library-schema.cjs` asks whether the tables are there and sealed to a stranger. This asks
 * the harder question the whole feature rests on: **that one account's likes are invisible to another**.
 * A policy that forgets `auth.uid() = user_id` still passes the anonymous probe, because anonymous is
 * refused by `enable row level security` alone - the row *filter* is what needs a session to test.
 *
 * So it signs in as two of the kept test accounts (A and B, hidden from every list on the site - see
 * scripts/browser.cjs), likes a track as the first, and asks the second to find it. Then the same for lists,
 * and finally proves a write is impossible on somebody else's row. It makes no account, and takes back every
 * row it wrote.
 */
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

loadEnv();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** A kept test account, signed in on a client of its own, so each account is a different browser. */
async function signIn(letter) {
  const { client, id } = await testAccountClient(letter);
  return { supabase: client, id };
}

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

(async () => {
  if (URL === undefined || KEY === undefined) {
    console.log('no Supabase project in .env.local - the site runs on the mock stores, so there is nothing to check.');
    return;
  }

  const suffix = Date.now().toString(36);
  const TRACK = `probe/track-${suffix}.mp3`;

  console.log('two accounts, one track, and whether either can see the other`s taste:\n');

  const alice = await signIn('A');
  const bob = await signIn('B');

  /* 1. Alice likes a track. ---------------------------------------------------------------------- */

  const liked = await alice.supabase.from('music_likes').insert({ user_id: alice.id, track_id: TRACK });

  if (liked.error !== null) {
    console.log(`  FAILED   alice could not like a track: ${liked.error.message}`);
    console.log('           (if this says "does not exist", paste the migration)');
    process.exitCode = 1;
    return;
  }

  const aliceSees = await alice.supabase.from('music_likes').select('track_id');
  check(
    (aliceSees.data ?? []).some((row) => row.track_id === TRACK),
    'alice cannot see the like she just wrote',
  );
  console.log('  ok       alice sees her own like');

  /* 2. ...and Bob cannot. ------------------------------------------------------------------------ */

  const bobSees = await bob.supabase.from('music_likes').select('track_id').eq('track_id', TRACK);
  const bobSaw = (bobSees.data ?? []).length > 0;

  check(!bobSaw, "bob can read alice's like - the select policy is not filtering rows");
  console.log(
    bobSaw
      ? "  OPEN     bob CAN see alice's like - the select policy is missing its auth.uid() test"
      : '  ok       bob cannot see it (the row filter is doing its work)',
  );

  /* 3. Bob cannot write into Alice's rows either. ------------------------------------------------ */

  const forged = await bob.supabase.from('music_likes').insert({ user_id: alice.id, track_id: `${TRACK}-forged` });

  check(forged.error !== null, "bob could insert a like as alice - the insert policy is not checking auth.uid()");

  if (forged.error !== null) {
    console.log('  ok       bob cannot file a like in alice`s name');
  } else {
    console.log('  OPEN     bob filed a like as alice - check the insert policy');
    await bob.supabase.from('music_likes').delete().eq('track_id', `${TRACK}-forged`);
  }

  /* 4. Lists, the same two ways. ----------------------------------------------------------------- */

  const listId = `${alice.id}:PROBE-${suffix.toUpperCase()}`;
  const made = await alice.supabase
    .from('music_playlists')
    .insert({ id: listId, owner_id: alice.id, name: `PROBE ${suffix.toUpperCase()}`, items: [] });

  check(made.error === null, `alice could not make a list: ${made.error?.message}`);
  console.log(made.error === null ? '  ok       alice can make a list' : `  FAILED   ${made.error?.message}`);

  const bobLists = await bob.supabase.from('music_playlists').select('id').eq('id', listId);
  const bobSawList = (bobLists.data ?? []).length > 0;

  check(!bobSawList, "bob can read alice's list");
  console.log(bobSawList ? "  OPEN     bob CAN see alice's list" : '  ok       bob cannot see it');

  /* 5. Bob cannot delete somebody else's list either. -------------------------------------------- */

  const stolen = await bob.supabase.from('music_playlists').delete().eq('id', listId).select('id');
  const deleted = (stolen.data ?? []).length > 0;

  check(!deleted, "bob could delete alice's list - the delete policy is not checking auth.uid()");
  console.log(deleted ? "  OPEN     bob deleted alice's list" : '  ok       bob cannot delete it');

  /* 6. Tidy up: every row this run wrote goes; the accounts are the kept ones and stay. ----------- */
  if (!deleted) await alice.supabase.from('music_playlists').delete().eq('id', listId);
  await alice.supabase.from('music_likes').delete().eq('track_id', TRACK);
  for (const who of [alice, bob]) await who.supabase.auth.signOut({ scope: 'local' });
  console.log('  tidy     alice took her like and her list back out');

  console.log('');

  if (failures.length > 0) {
    console.log(`${failures.length} problem(s):`);
    for (const failure of failures) console.log(`  - ${failure}`);
    console.log('');
    console.log('Run this and expect 3 rows for music_likes and 4 for music_playlists, each scoped to auth.uid():');
    console.log('  select tablename, policyname, cmd from pg_policies');
    console.log("   where tablename in ('music_likes', 'music_playlists') order by tablename, cmd;");
    process.exitCode = 1;
    return;
  }

  console.log('two accounts, one track: a like is private to the account that made it, cannot be forged in');
  console.log('somebody else`s name, and a list can be neither read nor deleted by anyone else. The policy');
  console.log('holds, and the feature is safe to point at this project.');
})().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
