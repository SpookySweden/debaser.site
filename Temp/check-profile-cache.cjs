/*
 * Scratch checks for the profile cache behind `usePublicProfile` (run from the root):
 *   npx tsc app/lib/profile/profile-cache.ts --outDir Temp/profile-cache-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-profile-cache.cjs
 *
 * The bug this exists for: the picture in the corner of the window said `NO PICTURE` for a
 * moment on every navigation, because each page mounts its components afresh and every one of
 * them began from an empty shell and asked the store again. The cache is what a later mount
 * draws from, so these are the four ways it can be wrong:
 *
 *   1. a second reader of the same account asks the store again (the flicker comes back, and a
 *      board page makes one request per avatar);
 *   2. a remembered row is not handed out (the picture flickers even though it is known);
 *   3. "read, and there is no row" is confused with "not read yet" (an empty shell that never
 *      settles, or a request that never stops being made);
 *   4. a failed read is remembered as an answer (a blip blanks the picture for the session) or
 *      is not marked as asked at all (whatever waits on it waits for ever).
 */
const assert = require('node:assert/strict');

const { forgetProfiles, profileRecord, readProfile, rememberProfile, subscribeToProfile } = require('./profile-cache-out/profile/profile-cache.js');

/** A row, as the store would hand it back. */
function row(userId, displayName = 'SWEDEN') {
  return { userId, displayName, bio: '', country: '', avatar: { versions: [], currentVersionId: null } };
}

/** A store that counts what it was asked, and can be told to fail or to hang. */
function store(seed = {}) {
  const calls = [];
  let fail = false;
  let hang = null;

  return {
    calls,
    seen: (userId) => calls.filter((id) => id === userId).length,
    failWith(value) {
      fail = value;
    },
    hangWith() {
      hang = new Promise(() => undefined);
      return hang;
    },
    async getProfile(userId) {
      calls.push(userId);
      if (hang !== null) await hang;
      if (fail) throw new Error('the store is offline');

      return seed[userId] ?? null;
    },
  };
}

(async () => {
  // 1 + 2. Two readers of one account: one request, and the row is there for the second.
  const first = store({ u1: row('u1') });
  const [a, b] = await Promise.all([readProfile(first, 'u1'), readProfile(first, 'u1')]);

  assert.equal(first.seen('u1'), 1, 'one account is fetched once, however many readers ask');
  assert.equal(a, b);
  assert.deepEqual(profileRecord('u1'), { profile: row('u1'), status: 'read' });

  // A component mounting after that reads the row with no request at all.
  const cached = await readProfile(first, 'u1');
  assert.equal(first.seen('u1'), 1, 'and a later mount asks nothing');
  assert.equal(cached.displayName, 'SWEDEN');

  // 3. No row is an answer: remembered as read, and not asked for again.
  const quiet = store({});
  assert.equal(await readProfile(quiet, 'u2'), null);
  assert.deepEqual(profileRecord('u2'), { profile: null, status: 'read' });
  await readProfile(quiet, 'u2');
  assert.equal(quiet.seen('u2'), 1, 'an account with no profile is not asked for twice');
  assert.equal(profileRecord('u3').status, 'unread', 'an account nobody asked about is unread');

  // 4. A failure is not an answer: marked as asked, retried later, and it never takes a known
  //    row off the screen.
  const flaky = store({ u4: row('u4', 'WARD') });
  flaky.failWith(true);
  assert.equal(await readProfile(flaky, 'u4'), null);
  assert.deepEqual(profileRecord('u4'), { profile: null, status: 'failed' }, 'a failed read is not kept as a row');

  flaky.failWith(false);
  const recovered = await readProfile(flaky, 'u4');
  assert.equal(flaky.seen('u4'), 2, 'and the next mount asks again');
  assert.equal(recovered.displayName, 'WARD');

  flaky.failWith(true);
  await readProfile(flaky, 'u4', { force: true });
  assert.equal(profileRecord('u4').profile.displayName, 'WARD', 'a failed refresh keeps the row it had');
  assert.equal(profileRecord('u4').status, 'read');

  // 5. A write reaches every reader of that account, and no other.
  let woken = 0;
  let wokenElsewhere = 0;
  const stop = subscribeToProfile('u1', () => (woken += 1));
  const stopOther = subscribeToProfile('u9', () => (wokenElsewhere += 1));

  rememberProfile(row('u1', 'AMY'));
  assert.equal(woken, 1, 'the reader of that account is woken');
  assert.equal(wokenElsewhere, 0, 'and nobody else is');
  assert.equal(profileRecord('u1').profile.displayName, 'AMY');

  stop();
  rememberProfile(row('u1', 'SWEDEN'));
  assert.equal(woken, 1, 'an unsubscribed reader is left alone');
  stopOther();

  // 6. A forced read goes back to the store, which is what the customiser needs after a save.
  const forced = store({ u5: row('u5', 'ONE') });
  await readProfile(forced, 'u5');
  forced.calls.length = 0;
  await readProfile(forced, 'u5', { force: true });
  assert.equal(forced.seen('u5'), 1, 'a forced read asks again');

  // 7. A store that throws on the way out is a refusal, not an exception through the call.
  const broken = { getProfile: () => { throw new Error('no store at all'); } };
  assert.equal(await readProfile(broken, 'u6'), null);
  assert.equal(profileRecord('u6').status, 'failed');

  // 8. Forgetting: what a purge of the local stores leaves behind.
  forgetProfiles();
  assert.equal(profileRecord('u1').status, 'unread', 'forgetting puts every account back to unread');

  console.log('profile cache checks passed');
  console.log('  readers   :', 'two at once -> ' + first.seen('u1') + ' request; a later mount -> none');
  console.log('  answers   : a row, no row, and a refusal are told apart and none of them repeats');
  console.log('  writes    : reach the readers of that account only, forced reads reach the store');
})();
