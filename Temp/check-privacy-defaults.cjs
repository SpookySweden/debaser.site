/*
 * New accounts start private, and the lamp switch means what it says (SPEC-privacy-phase-1.md).
 *   npx tsc app/lib/profile/visibility.ts app/lib/profile/mock-profile-repository.ts app/lib/profile/directory.ts app/components/PrivacyFirstLook.tsx --outDir Temp/privacy-defaults-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --jsx react-jsx
 *   node Temp/check-privacy-defaults.cjs
 *
 * Live: it signs in as kept test accounts A and B. Its writes: A's lamp off and back on, and A's own presence stamp.
 *
 *   1. The defaults, in the code and in the migration: everything off for a new account, nothing rewritten for an old one.
 *   2. The mock store: a new person has everything off and has not seen the window, a person with the lamp off is left out of the
 *      presence list, and both come right when switched.
 *   3. The window and the switches, drawn: a new account is offered KEEP IT PRIVATE, an account sharing something is told the truth
 *      and offered a way to turn it off, and a window already seen is not drawn.
 *   4. The real database: with A's lamp on, B reads A's stamp and hears it change; with it off, B does neither, a visitor never does,
 *      and A still reads its own.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

const OUT = path.join(__dirname, 'privacy-defaults-out');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --- 1. the defaults ------------------------------------------------------------------------------ */

const { DEFAULT_VISIBILITY } = require(path.join(OUT, 'lib', 'profile', 'visibility.js'));
for (const [key, value] of Object.entries(DEFAULT_VISIBILITY)) assert.equal(value, false, `${key} is off for a new account`);
assert.ok('showOnline' in DEFAULT_VISIBILITY, 'the lamp is one of the switches');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261105135310_privacy_tab_and_new_account_defaults.sql'), 'utf8').replace(/\r\n/g, '\n');
for (const line of [
  'alter column hide_listening set default true',
  'alter column show_profile_comments set default false',
  'alter column show_avatar_comments set default false',
  'alter column show_song_comments set default false',
  'add column if not exists show_online boolean not null default true',
  'alter column show_online set default false',
  'add column if not exists show_name_to_visitors boolean not null default true',
  'alter column show_name_to_visitors set default false',
]) {
  assert.ok(migration.includes(line), `the migration says: ${line}`);
}
const updates = migration.split('\n').filter((line) => /^\s*update\s/i.test(line));
assert.deepEqual(updates, ['update public.profiles set privacy_seen = true where is_hidden and not privacy_seen;'], 'the only rows edited are the test accounts');
console.log('  ok    the defaults, in the code and in the migration');

/* --- 2. the mock store ---------------------------------------------------------------------------- */

async function mock() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  };
  const { getMockProfileRepository, emptyProfile } = require(path.join(OUT, 'lib', 'profile', 'mock-profile-repository.js'));
  const repository = getMockProfileRepository();

  const fresh = emptyProfile('privacy-person', 'PERSON');
  assert.equal(fresh.privacySeen, false, 'a new person has not seen the window');
  assert.equal(fresh.visibility.showOnline, false);

  await repository.markSeen('privacy-person');
  await repository.saveProfile('privacy-person', { bio: 'x' });
  assert.equal((await repository.listPresence()).some((record) => record.userId === 'privacy-person'), false, 'lamp off: left out of the list');

  await repository.saveProfile('privacy-person', { visibility: { showOnline: true } });
  assert.equal((await repository.listPresence()).some((record) => record.userId === 'privacy-person'), true, 'lamp on: in the list');

  await repository.saveProfile('privacy-person', { privacySeen: true });
  assert.equal((await repository.getProfile('privacy-person')).privacySeen, true, 'the window is remembered');
  assert.equal((await repository.getProfile('privacy-person')).visibility.showOnline, true, 'and saving that moved no switch');
  console.log('  ok    the mock store');
  delete globalThis.window;
}

/* --- 3. the window, drawn ------------------------------------------------------------------------- */

function windowDrawn() {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { DEFAULT_VISIBILITY: off } = require(path.join(OUT, 'lib', 'profile', 'visibility.js'));
  let profile = { visibility: { ...off }, privacySeen: false };

  const stub = (file, exports) => {
    const resolved = require.resolve(path.join(OUT, file));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };
  stub('components/AuthProvider.js', { useAuth: () => ({ user: { id: 'person' } }) });
  stub('lib/profile/use-public-profile.js', { usePublicProfile: () => ({ profile, ready: true, read: true, repository: {}, refresh: async () => undefined }) });
  const FirstLook = require('./privacy-defaults-out/components/PrivacyFirstLook.js').default;
  const draw = () => renderToStaticMarkup(React.createElement(FirstLook));

  const fresh = draw();
  assert.match(fresh, /\[ KEEP IT PRIVATE \]/, 'a new account is offered the one key');
  assert.doesNotMatch(fresh, /TURN EVERYTHING OFF/, 'and nothing to turn off');
  assert.equal((fresh.match(/\[ OFF \]/g) ?? []).length, 6, 'six switches, all off');
  assert.match(fresh, /ONLINE LAMP/, 'the lamp is one of them');

  profile = { visibility: { ...off, showOnline: true }, privacySeen: false };
  const sharing = draw();
  assert.doesNotMatch(sharing, /KEEP IT PRIVATE/, 'an account sharing something is not told it is private');
  assert.match(sharing, /\[ KEEP THESE SETTINGS \]/, 'it keeps what it has');
  assert.match(sharing, /\[ TURN EVERYTHING OFF \]/, 'or turns it off');
  assert.equal((sharing.match(/\[ ON \]/g) ?? []).length, 1, 'and the switch that is on says so');

  profile = { visibility: { ...off }, privacySeen: true };
  assert.equal(draw(), '', 'seen once is seen');
  console.log('  ok    the window and its switches, drawn');
}

/* --- 4. the real database ------------------------------------------------------------------------- */

async function live() {
  loadEnv();
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const stamp = () => a.client.from('profile_presence').upsert({ user_id: a.id, last_seen_at: new Date().toISOString(), is_online: false }, { onConflict: 'user_id' });
  const bReads = async () => (await b.client.from('profile_presence').select('user_id').eq('user_id', a.id)).data?.length ?? 0;
  const setLamp = async (on) => {
    const { error } = await a.client.from('profiles').update({ show_online: on }).eq('id', a.id);
    assert.equal(error, null, 'A can set its own lamp');
  };

  let heard = 0;
  const ear = b.client.channel(`privacy-defaults-${Date.now()}`).on('postgres_changes', { event: '*', schema: 'public', table: 'profile_presence' }, (change) => {
    if (change.new?.user_id === a.id) heard += 1;
  });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 6000);
    ear.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      clearTimeout(timer);
      resolve();
    });
  });
  await wait(2000);

  try {
    await setLamp(true);
    await stamp();
    await wait(4000);
    assert.equal(await bReads(), 1, 'lamp on: B reads A');
    assert.ok(heard > 0, 'lamp on: B hears A');

    await setLamp(false);
    await wait(500);
    heard = 0;
    await stamp();
    await wait(4000);
    assert.equal(await bReads(), 0, 'lamp off: B cannot read A');
    assert.equal(heard, 0, 'lamp off: B does not hear A');
    assert.equal((await a.client.from('profile_presence').select('user_id').eq('user_id', a.id)).data?.length, 1, 'lamp off: A still reads its own');
    assert.equal((await visitor.from('profile_presence').select('user_id')).error?.code, '42501', 'a visitor never can');
    assert.equal((await visitor.from('profiles').select('show_online').limit(1)).error?.code, '42501', 'nor read the switch');
    console.log('  ok    the lamp switch on the real database');
  } finally {
    await setLamp(true);
    await b.client.removeChannel(ear);
  }
}

(async () => {
  await mock();
  windowDrawn();
  await live();
  console.log('privacy defaults: new accounts start private, and the lamp switch holds.');
  process.exit(0);
})().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
