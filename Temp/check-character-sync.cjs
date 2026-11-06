/**
 * Saved characters on the account as well as in the browser (app/lib/character/library.ts, library-sync.ts, Luke 2026-11-06).
 *   npx tsc app/lib/character/library.ts app/lib/character/rig.ts --outDir Temp/out-character-sync --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-character-sync.cjs
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const store = new Map();
global.window = { localStorage: { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value) } };
const lib = require(path.join(__dirname, 'out-character-sync', 'lib', 'character', 'library.js'));
const { buildDefaultFigure } = require(path.join(__dirname, 'out-character-sync', 'lib', 'character', 'rig.js'));

const figure = buildDefaultFigure('base');
const made = (id, savedAt, extra = {}) => ({ id, name: id, presetId: 'base', figure, savedAt, ...extra });
const row = (id, savedAt, deletedAt = null) => ({ id, name: id, presetId: 'base', figure, savedAt, deletedAt });
const ids = (list) => list.map((character) => character.id);

// Coming back: everything this browser holds goes up.
let merged = lib.mergeShelf([made('a', '2026-10-01'), made('b', '2026-10-02')], []);
assert.deepEqual(ids(merged.upload), ['a', 'b'], 'a browser full of figures, an empty account: all of them go up');
assert.deepEqual(ids(merged.shelf), ['b', 'a'], 'newest first');
// Another machine: the account's come down.
merged = lib.mergeShelf([], [row('a', '2026-10-01')]);
assert.deepEqual(ids(merged.shelf), ['a'], 'an empty browser takes the account\'s');
assert.deepEqual(merged.upload, []);
// The later save wins, either way round.
merged = lib.mergeShelf([made('a', '2026-10-05')], [row('a', '2026-10-01')]);
assert.deepEqual(ids(merged.upload), ['a'], 'a newer copy here goes up');
merged = lib.mergeShelf([made('a', '2026-10-01')], [row('a', '2026-10-05')]);
assert.deepEqual(merged.upload, [], 'a newer copy there stays');
assert.equal(merged.shelf[0].savedAt, '2026-10-05');
// A removal elsewhere isn't undone by a stale copy here.
merged = lib.mergeShelf([made('a', '2026-10-01')], [row('a', '2026-10-01', '2026-10-03')]);
assert.deepEqual(ids(merged.shelf), [], 'removed on the account: gone here too');
assert.deepEqual(merged.upload, []);
merged = lib.mergeShelf([], [row('a', '2026-10-01', '2026-10-03')]);
assert.deepEqual(ids(merged.shelf), [], 'and a removed one never comes down');
console.log('  ok    merging');

// Two people on one browser.
const KEY = 'debaser.character.library.v3';
store.set(KEY, JSON.stringify([made('nobody', '2026-10-01')]));
lib.setLibraryViewer('person-a');
assert.deepEqual(ids(lib.readLibrary()), ['nobody'], 'one with no owner joins whoever signs in');
lib.persistLibrary(lib.readLibrary());
assert.equal(JSON.parse(store.get(KEY))[0].owner, 'person-a', 'and is theirs once kept');
lib.setLibraryViewer('person-b');
assert.deepEqual(lib.readLibrary(), [], 'somebody else on this browser doesn\'t see it');
lib.persistLibrary([made('b-one', '2026-10-02')]);
assert.equal(JSON.parse(store.get(KEY)).length, 2, 'and saving theirs leaves it alone');
lib.setLibraryViewer(null);
assert.deepEqual(lib.readLibrary(), [], 'signed out, nobody\'s are drawn');
lib.setLibraryViewer('person-a');
assert.deepEqual(ids(lib.readLibrary()), ['nobody'], 'back again');
console.log('  ok    two people on one browser');

const migration = readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261107000000_user_characters.sql'), 'utf8');
assert.doesNotMatch(migration, /references auth\.users/, 'losing an account can\'t take the characters with it');
assert.doesNotMatch(migration, /^grant[^;]*\bdelete\b/m, 'nobody can delete one, only mark it');
assert.match(migration, /^grant select, insert, update on public\.user_characters to authenticated;/m, 'the grant is what this says it is');
console.log('character sync checks passed');
