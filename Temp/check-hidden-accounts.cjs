/*
 * The hidden test accounts (SPEC-test-accounts.md): TEST ACCOUNT A-D are in no list of people, for anybody,
 * and nobody visiting the site can change that.
 *   npx tsc app/lib/auth/hidden.ts app/lib/auth/supabase-auth.ts app/lib/auth/mock-auth.ts app/lib/profile/supabase-profile-repository.ts app/lib/profile/directory.ts app/lib/profile/presence.ts --outDir Temp/hidden-accounts-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-hidden-accounts.cjs
 *
 * Live: it signs in as the kept test accounts (never makes one) and drives the app's own compiled code
 * against the real project. Its writes: A's own presence (online for the run, then offline), A's bio
 * written back unchanged, and the refused attempts on the marker.
 *
 *   1. Signed in as A, with A online: the account store answers for A-D (so their names resolve for a test
 *      account) and flags all four hidden; `listedAccounts` - what the directory, every name picker and every
 *      who's-online list draw from - holds none of them; the directory built from it the way /users builds it
 *      (`buildUserDirectory`, with the live lamps) has no A-D row, so its ONLINE count cannot include A. Everybody
 *      else is still listed (the house account among them), so "empty" cannot pass for "filtered". And A-D's lamps
 *      still answer by id - a test account's own lamp, a `?challenge=<id>` link - because presence is not filtered.
 *      As a visitor with no session (updated on purpose, the privacy plan's phase 0): the store answers everybody
 *      else, with no word of A-D and no marker on anybody, and lamps are not for visitors at all.
 *   2. Signed in as A: un-hiding itself is refused (an update and an upsert), deleting its own hidden row is
 *      refused (the heartbeat would re-create it unmarked), and so is hiding the house account or un-hiding B; afterwards all four are still hidden and the house account is not. An
 *      ordinary write to A's own row still goes through (the bio, written back unchanged), so the refusal is
 *      the marker's guard and not a closed door.
 *   3. The mock store, the same rule: its seeded hidden person is answered and flagged, and left out of
 *      `listedAccounts`.
 *
 * The UI half - that the pages really draw from these lists - is `node Temp/hidden-drive.cjs [url]`, in a
 * real browser. `HIDDEN_BREAK=guard` points part 2 at a column the guard does not protect, and
 * `HIDDEN_BREAK=delete` deletes a throwaway like instead of the profile, to watch the check catch a write or a
 * delete that goes through - without moving anything real. Breaks proven by `node Temp/prove-hidden-breaks.cjs`.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

const OUT = path.join(__dirname, 'hidden-accounts-out');
const LETTERS = ['A', 'B', 'C', 'D'];
const HOUSE_NAME = 'debaser.site';
const BREAK = process.env.HIDDEN_BREAK ?? '';

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail === '' ? '' : ` :: ${detail}`}`);
}

/** The app's two Supabase repositories, freshly loaded and pointed at this client. */
function repositoriesFor(client) {
  const clientPath = require.resolve(path.join(OUT, 'supabase', 'client.js'));
  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: { getSupabaseBrowserClient: () => client, isSupabaseConfigured: true },
  };

  const auth = require.resolve(path.join(OUT, 'auth', 'supabase-auth.js'));
  const profiles = require.resolve(path.join(OUT, 'profile', 'supabase-profile-repository.js'));
  delete require.cache[auth];
  delete require.cache[profiles];

  return {
    auth: require(auth).getSupabaseAuthRepository(),
    profiles: require(profiles).getSupabaseProfileRepository(),
  };
}

const { listedAccounts } = require(path.join(OUT, 'auth', 'hidden.js'));
const { buildUserDirectory, countDirectoryStatuses } = require(path.join(OUT, 'profile', 'directory.js'));
const { presenceStatus } = require(path.join(OUT, 'profile', 'presence.js'));

/** Part 1, for one viewer. */
async function lists(viewer, client, testIds, viewerId) {
  console.log(`\n${viewer}:`);
  const { auth, profiles } = repositoriesFor(client);

  const accounts = await auth.listAccounts();

  if (viewerId === null) {
    check('the account store says nothing about A-D', accounts.every((account) => !testIds.includes(account.id)), `${accounts.length} answered`);
    check('and marks nobody hidden', accounts.every((account) => account.hidden !== true));
    check(
      'and still holds everybody else - the house account among them',
      accounts.length > 0 && accounts.some((account) => account.displayName === HOUSE_NAME),
      `${accounts.length} answered`,
    );
    const refused = await profiles.listPresence().then(
      () => false,
      () => true,
    );
    check('lamps are refused to a visitor', refused);

    return accounts;
  }

  const answered = testIds.filter((id) => accounts.some((account) => account.id === id));
  const flagged = accounts.filter((account) => testIds.includes(account.id) && account.hidden === true);
  check('the account store answers for A-D, so their names resolve', answered.length === 4, `${answered.length}/4`);
  check('and flags all four hidden', flagged.length === 4, `${flagged.length}/4`);

  const listed = listedAccounts(accounts);
  const leaked = listed.filter((account) => testIds.includes(account.id)).map((account) => account.displayName);
  check(
    'the people lists (directory, pickers) hold none of A-D',
    leaked.length === 0,
    leaked.length === 0 ? `${listed.length} listed` : `listed: ${leaked.join(', ')}`,
  );
  check(
    'and still hold everybody else - the house account among them',
    listed.length === accounts.filter((account) => account.hidden !== true).length && listed.some((account) => account.displayName === HOUSE_NAME),
    `${listed.length} of ${accounts.length}`,
  );

  // Who's online, the way /users and the arcade build it: the listed accounts, each with its live lamp.
  const presence = await profiles.listPresence();
  const records = new Map(presence.map((record) => [record.userId, record]));
  const now = Date.now();
  const rows = buildUserDirectory({
    accounts: listed,
    statusFor: (id) => presenceStatus(records.get(id), now),
    recordFor: (id) => records.get(id),
    viewerId,
  });
  const aOnline = presenceStatus(records.get(testIds[0]), now) === 'online';
  const counts = countDirectoryStatuses(rows);
  check(
    "who's online (the directory's rows and ONLINE count) holds none of A-D - A is online right now",
    aOnline && rows.every((row) => !testIds.includes(row.account.id)),
    `A ${aOnline ? 'online' : 'NOT online, so this proves nothing'} :: ${counts.online} online in the list`,
  );

  const lamps = testIds.filter((id) => records.has(id));
  check('and A-D still have lamps, for their own page and a ?challenge=<id> link', lamps.length === 4, `${lamps.length}/4`);

  return accounts;
}

/** Part 2: the marker cannot be moved by a signed-in account. */
async function guard(a, testIds, houseId) {
  console.log('\nsigned in as A, trying to move the marker:');
  const column = BREAK === 'guard' ? 'status' : 'is_hidden';
  if (BREAK === 'guard') console.log('  (HIDDEN_BREAK=guard: aiming at `status`, which the guard does not protect)');

  const mine = await a.client.from('profiles').select('bio, status').eq('id', a.id).single();
  assert.equal(mine.error, null, `A reads its own row: ${mine.error?.message ?? ''}`);
  const same = BREAK === 'guard' ? mine.data.status : false;

  const unhide = await a.client.from('profiles').update({ [column]: same }).eq('id', a.id).select('id');
  check('A un-hiding itself is refused', unhide.error !== null, unhide.error?.message ?? `${unhide.data?.length} row(s) written`);

  const upsert = await a.client.from('profiles').upsert({ id: a.id, [column]: same }, { onConflict: 'id' }).select('id');
  check('and so is the same through an upsert', upsert.error !== null, upsert.error?.message ?? `${upsert.data?.length} row(s) written`);

  const hideHouse = await a.client.from('profiles').update({ is_hidden: true }).eq('id', houseId).select('id');
  check(
    'A hiding the house account touches nothing',
    hideHouse.error !== null || (hideHouse.data ?? []).length === 0,
    hideHouse.error?.message ?? `${hideHouse.data?.length} row(s)`,
  );

  const unhideB = await a.client.from('profiles').update({ is_hidden: false }).eq('id', testIds[1]).select('id');
  check(
    'A un-hiding B touches nothing',
    unhideB.error !== null || (unhideB.data ?? []).length === 0,
    unhideB.error?.message ?? `${unhideB.data?.length} row(s)`,
  );

  // Deleting its own hidden row would let the heartbeat re-create it unmarked: refused since 20261022000033.
  let gone;
  if (BREAK === 'delete') {
    console.log('  (HIDDEN_BREAK=delete: deleting a like A has just filed instead, which nothing guards)');
    const track = `probe/hidden-break-${Date.now().toString(36)}.mp3`;
    await a.client.from('music_likes').insert({ user_id: a.id, track_id: track });
    gone = await a.client.from('music_likes').delete().eq('track_id', track).select('user_id');
  } else {
    gone = await a.client.from('profiles').delete().eq('id', a.id).select('id');
  }
  check(
    'A deleting its own hidden profile is refused',
    gone.error !== null,
    gone.error?.message ?? `${gone.data?.length} row(s) deleted`,
  );

  // The door is open for everything else: the bio, written back exactly as it was.
  const ordinary = await a.client.from('profiles').update({ bio: mine.data.bio }).eq('id', a.id).select('id');
  check(
    "an ordinary write to A's own row still goes through",
    ordinary.error === null && (ordinary.data ?? []).length === 1,
    ordinary.error?.message ?? `${ordinary.data?.length} row(s), bio unchanged`,
  );

  const after = await a.client.rpc('account_list');
  const stillHidden = (after.data ?? []).filter((row) => testIds.includes(row.id) && row.hidden).length;
  const house = (after.data ?? []).find((row) => row.id === houseId);
  check('afterwards A-D are all still hidden', stillHidden === 4, `${stillHidden}/4`);
  check('and the house account is not', house !== undefined && house.hidden === false, String(house?.hidden));

  if (stillHidden !== 4 || house?.hidden !== false) {
    console.log('');
    console.log('  !!! THE MARKER MOVED ON THE LIVE PROJECT. A test account may now be listed on /users (or the house');
    console.log('  !!! account hidden). Putting it back is a database write - re-run the marking statement at the end of');
    console.log('  !!! supabase/migrations/20261021000032_hidden_test_accounts.sql, with Luke\'s OK.');
  }
}

/** Part 3: the mock store keeps the same rule. */
async function mock() {
  console.log('\nthe mock store:');
  const { getMockAuthRepository, MOCK_HIDDEN_ACCOUNT_ID } = require(path.join(OUT, 'auth', 'mock-auth.js'));
  const { SITE_ACCOUNT_ID } = require(path.join(OUT, 'auth', 'builtin-account.js'));

  const accounts = await getMockAuthRepository().listAccounts();
  const person = accounts.find((account) => account.id === MOCK_HIDDEN_ACCOUNT_ID);
  check('its hidden test person is answered and flagged', person?.hidden === true, person?.displayName ?? 'missing');

  const listed = listedAccounts(accounts).map((account) => account.id);
  check(
    'and left out of the people lists',
    !listed.includes(MOCK_HIDDEN_ACCOUNT_ID) && listed.includes(SITE_ACCOUNT_ID),
    listed.join(', '),
  );
}

(async () => {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.ok(url && key, 'no Supabase project in .env.local');

  console.log('TEST ACCOUNT A-D against the live project and the mock store: lists, who is online, the marker');
  const signedIn = [];
  let aProfiles = null;
  try {
    for (const letter of LETTERS) signedIn.push(await testAccountClient(letter));
    const testIds = signedIn.map((account) => account.id);
    const a = signedIn[0];

    // A is online for the run, the case a who's-online list would show.
    aProfiles = repositoriesFor(a.client).profiles;
    await aProfiles.markSeen(a.id);

    const visitor = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const accounts = await lists('a visitor with no session', visitor, testIds, null);
    await lists('signed in as TEST ACCOUNT A', a.client, testIds, a.id);

    const house = accounts.find((account) => account.displayName === HOUSE_NAME);
    assert.ok(house, 'the house account is in the account store');
    await guard(a, testIds, house.id);

    await mock();
  } finally {
    if (aProfiles !== null) await aProfiles.markOffline(signedIn[0].id).catch(() => undefined);
    for (const account of signedIn) await account.client.auth.signOut({ scope: 'local' });
  }

  console.log('');
  if (failures > 0) {
    console.log(`${failures} rule(s) did not hold: the FAIL lines above say which.`);
    process.exitCode = 1;
    return;
  }
  console.log('hidden test accounts: in no list of people for a visitor or for A, names and lamps still resolve, and A cannot move the marker.');
})().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exitCode = 1;
});
