/*
 * SPEC-forum-v3.md part 2, step 5 (F1B, F2A): settings that follow the account, through `user_settings`.
 *   npx tsc app/lib/settings/account-settings.ts app/lib/settings/settings-rules.ts app/lib/settings/settings-bus.ts --rootDir app --outDir Temp/account-settings-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-account-settings.cjs
 *
 * The rules (who wins on sign-in, what is saved, the size cap) and the sync itself run here against the mock store, with a
 * fake browser storage. The pages taking the account's choices are driven in a browser: scripts/drive-forum-v3-part2.cjs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'account-settings-out');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    keys: () => [...map.keys()],
  };
}
function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}
/** A fresh copy of the sync, as a second machine or a reload would have: module state starts again. */
function loadSync() {
  for (const key of Object.keys(require.cache)) if (key.startsWith(OUT) && !key.includes('auth-repository') && !key.includes('supabase')) delete require.cache[key];
  stub(path.join(OUT, 'lib/auth/auth-repository.js'), { USING_MOCK_AUTH: true });
  stub(path.join(OUT, 'lib/supabase/client.js'), { getSupabaseBrowserClient: () => null });
  return {
    sync: require(path.join(OUT, 'lib/settings/account-settings.js')),
    bus: require(path.join(OUT, 'lib/settings/settings-bus.js')),
    rules: require(path.join(OUT, 'lib/settings/settings-rules.js')),
  };
}

(async () => {
  global.window = { localStorage: fakeStorage() };
  let { sync, bus, rules } = loadSync();
  const { SYNCED_KEYS } = bus;

  /* The rules ------------------------------------------------------------------------------------------------------ */
  const parsed = rules.parseAccountSettings({ keys: { theme: 'dark', cursor: 7, nonsense: 'x', backdrop: 'y'.repeat(5000) }, made: { tracks: false, files: 'no' } });
  assert.deepEqual(parsed.keys, { theme: 'dark' }, 'only known settings, as text, under the length cap');
  assert.equal(parsed.made.tracks, false, 'a switch turned off stays off');
  assert.equal(parsed.made.files, true, 'anything but false is on (M1A: on by default)');
  assert.deepEqual(rules.parseAccountSettings(null).made, rules.DEFAULT_MADE, 'no row: every switch on');

  const ordered = rules.settingsForSaving({ keys: { cursor: 'cat', theme: 'dark' }, made: rules.DEFAULT_MADE });
  assert.deepEqual(Object.keys(ordered.keys), ['theme', 'cursor'], 'saved in a fixed order, so the same choices are the same text');
  const huge = Object.fromEntries(Object.keys(SYNCED_KEYS).map((name) => [name, 'z'.repeat(1400)]));
  const capped = rules.settingsForSaving({ keys: huge, made: rules.DEFAULT_MADE });
  assert.ok(JSON.stringify(capped).length <= rules.MAX_SETTINGS_LENGTH, 'the row stays under the table size check');
  assert.ok(capped.keys.theme !== undefined, 'the first settings survive the cap');

  const after = rules.valuesAfterSignIn({ theme: 'sherbet-pink', cursor: 'cat' }, { theme: 'dark', cursor: 'white', backdrop: 'tile' }, new Set(['cursor']));
  assert.equal(after.theme, 'sherbet-pink', "signed in, the account's choice wins (F2A)");
  assert.equal(after.cursor, 'white', 'except a setting pressed while the account was being read');
  assert.equal(after.backdrop, 'tile', 'a setting the account never saved keeps the browser\'s');

  /* The sync, on the mock store ---------------------------------------------------------------------------------- */
  const storage = global.window.localStorage;
  const rowOf = (person) => JSON.parse(storage.getItem(sync.MOCK_SETTINGS_KEY) ?? '{}')[person];
  storage.setItem(SYNCED_KEYS.theme, 'sherbet-pink');
  storage.setItem(SYNCED_KEYS.cursor, 'cat');
  await sync.setSettingsAccount('p1');
  assert.equal(rowOf('p1')?.settings?.keys?.theme, 'sherbet-pink', "an account with no row starts from the browser's choices, saved at once");
  assert.equal(sync.accountSettingsLoaded(), true);

  storage.setItem(SYNCED_KEYS.wirePaused, '1');
  bus.noteSettingChanged('wirePaused');
  storage.setItem(SYNCED_KEYS.backdrop, 'tile');
  bus.noteSettingChanged('backdrop');
  assert.equal(rowOf('p1').settings.keys.wirePaused, undefined, 'a change is gathered, not saved on the press');
  await sleep(1200);
  assert.equal(rowOf('p1').settings.keys.wirePaused, '1', 'and saved a second later');
  assert.equal(rowOf('p1').settings.keys.backdrop, 'tile', 'both presses in the one save');

  sync.setMadeSwitch('tracks', false);
  await sleep(1200);
  assert.equal(rowOf('p1').settings.made.tracks, false, 'a MADE switch saves with the rest');

  // A second machine: its own looks, the same "database".
  const database = storage.getItem(sync.MOCK_SETTINGS_KEY);
  storage.clear();
  storage.setItem(sync.MOCK_SETTINGS_KEY, database);
  storage.setItem(SYNCED_KEYS.theme, 'dark');
  storage.setItem(SYNCED_KEYS.mediaView, 'grid');
  ({ sync, bus } = loadSync());
  let heard = 0;
  bus.subscribeToAccountSettings(() => {
    heard += 1;
  });
  const signingIn = sync.setSettingsAccount('p1');
  // Pressed while the account is still on its way: the press is newer and wins.
  storage.setItem(SYNCED_KEYS.cursor, 'white');
  bus.noteSettingChanged('cursor');
  await signingIn;
  assert.equal(heard, 1, 'every setting is told to read its key again');
  assert.equal(storage.getItem(SYNCED_KEYS.theme), 'sherbet-pink', "the account's theme is written over this browser's");
  assert.equal(storage.getItem(SYNCED_KEYS.wirePaused), '1', 'and the newswire stop');
  assert.equal(storage.getItem(SYNCED_KEYS.cursor), 'white', 'but not over a press made meanwhile');
  assert.equal(sync.madeSwitches().tracks, false, 'the MADE switches come with the account');
  await sleep(1200);
  assert.equal(rowOf('p1').settings.keys.cursor, 'white', 'the press made meanwhile goes up');
  assert.equal(rowOf('p1').settings.keys.mediaView, 'grid', "and a setting the account had never saved is added, not lost");

  // Signed out: the browser keeps its own, nothing is saved.
  await sync.setSettingsAccount(null);
  const before = storage.getItem(sync.MOCK_SETTINGS_KEY);
  storage.setItem(SYNCED_KEYS.theme, 'default');
  bus.noteSettingChanged('theme');
  await sleep(1200);
  assert.equal(storage.getItem(sync.MOCK_SETTINGS_KEY), before, 'signed out, a change stays in this browser');
  sync.setMadeSwitch('files', false);
  assert.equal(sync.madeSwitches().files, true, 'and a MADE switch cannot be saved without an account');

  /* Each synced setting is wired: its key is the one its code keeps, it says when it changed, and it reads again ---- */
  const owners = {
    theme: 'app/lib/ui/theme-slot.ts',
    cursor: 'app/lib/ui/cursor-slot.ts',
    backdrop: 'app/lib/ui/backdrop-slot.ts',
    forumPlace: 'app/lib/forum/board-address.ts',
    forumSort: 'app/lib/forum/board-sort.ts',
    wirePaused: 'app/components/NewsTicker.tsx',
    mediaFolds: 'app/components/WebStream.tsx',
    mediaView: 'app/lib/web/media-view.ts',
    playerBar: 'app/components/MusicPlayer.tsx',
  };
  const usedBy = { forumPlace: 'app/components/ForumBoard.tsx', forumSort: 'app/components/ForumBoard.tsx' };
  assert.deepEqual(Object.keys(owners).sort(), Object.keys(SYNCED_KEYS).sort(), 'every synced setting has an owner here');
  for (const [name, file] of Object.entries(owners)) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(source.includes(`'${SYNCED_KEYS[name]}'`), `${name}: ${file} keeps the key the sync reads (${SYNCED_KEYS[name]})`);
    const code = fs.readFileSync(path.join(ROOT, usedBy[name] ?? file), 'utf8');
    assert.ok(code.includes(`noteSettingChanged('${name}')`), `${name}: a change is told to the account`);
    assert.ok(code.includes('subscribeToAccountSettings('), `${name}: it reads its key again when the account's arrives`);
  }
  const layout = fs.readFileSync(path.join(ROOT, 'app/layout.tsx'), 'utf8');
  assert.ok(layout.includes('<AccountSettingsKeeper />'), 'the keeper is drawn once in the layout');
  const bus_ = fs.readFileSync(path.join(ROOT, 'app/lib/settings/settings-bus.ts'), 'utf8');
  assert.ok(!/^import /m.test(bus_), 'the bus imports nothing (the theme slot loads it while the layout is drawn on the server)');

  console.log('check-account-settings: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
