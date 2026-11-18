/*
 * SPEC-forum-v3.md part 2, step 7 (M1A to M4A): MADE rows on the board, the switches, HIDE MADE and DRAWINGS in the search.
 *   npx tsc app/lib/forum/made.ts app/lib/forum/board-query.ts app/lib/forum/site-author.ts --rootDir app --outDir Temp/made-posts-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-made-posts.cjs
 *
 * The rules here; filing on a make, the row growing and HIDE MADE are driven in a browser: scripts/drive-forum-v3-part2.cjs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'made-posts-out');
const ROOT = path.join(__dirname, '..');
const made = require(path.join(OUT, 'lib/forum/made.js'));
const { selectBoardThreads } = require(path.join(OUT, 'lib/forum/board-query.js'));
const { displayTitle, postCredit } = require(path.join(OUT, 'lib/forum/site-author.js'));

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const PERSON = '3f2a9c10-aaaa-4bbb-8ccc-0123456789ab';
const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const today = made.madeDay();
const thread = (id, anchor, minutes, extra = {}) => ({
  id, title: id, body: '', author: { id: PERSON, displayName: 'Sweden' }, createdAt: at(minutes), anchor, tags: [], comments: [], origin: 'user', ...extra,
});
const board = (id, minutes) => ({ ...thread(id, { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' }, minutes), body: 'words' });

/* The anchor --------------------------------------------------------------------------------------------------- */
const anchor = made.madeAnchor(PERSON, today);
assert.equal(anchor.kind, 'board', 'a board anchor, so the one-thread-per-item rule never applies and no table changes');
assert.deepEqual(made.madeOf(anchor), { person: PERSON, day: today }, 'made:<person>:<day> reads back');
assert.equal(made.madeOf({ kind: 'board', id: 'watch:room-1', label: 'STREAM' }), null, 'a stream record is not a MADE row');
assert.equal(made.madeOf({ kind: 'board', id: 'made:nobody', label: 'MADE' }), null, 'an id with no day is not one');
assert.equal(made.madeOf({ kind: 'asset', id: `made:${PERSON}:${today}`, label: 'X' }), null, 'only a board anchor');
assert.equal(made.madeDay('2026-11-17T23:59:00Z'), '2026-11-17', 'the day is the UTC date, as stream records name theirs');

/* The heading (M4A) --------------------------------------------------------------------------------------------- */
assert.equal(made.madeHeading('Sweden', 3, today, today), 'SWEDEN MADE 3 THINGS TODAY');
assert.equal(made.madeHeading('Sweden', 1, today, today), 'SWEDEN MADE 1 THING TODAY');
assert.equal(made.madeHeading('Sweden', null, today, today), 'SWEDEN MADE THINGS TODAY', 'while the things are read');
assert.equal(made.madeHeading('Sweden', 2, '2026-11-17', '2026-11-18'), 'SWEDEN MADE 2 THINGS ON 2026-11-17', 'an earlier day says which');

/* The row on the board -------------------------------------------------------------------------------------------- */
const row = thread('made-1', anchor, 30, { title: made.madeThreadTitle('Sweden', today) });
assert.equal(displayTitle(row), 'SWEDEN MADE THINGS TODAY', 'the row is called by whose day it is');
assert.equal(postCredit(row).id, PERSON, 'and credited to its maker, not the site (its body is empty, like a stream record)');

const racer = thread('made-2', anchor, 20);
const answered = thread('made-3', anchor, 10, { comments: [{ id: 'c1', threadId: 'made-3', body: 'nice', author: { id: 'x', displayName: 'X' }, createdAt: at(5), tags: [] }] });
const kept = made.dropDuplicateMade([racer, row, board('post', 40)]);
assert.deepEqual(kept.map((one) => one.id).sort(), ['made-1', 'post'], 'two tabs raced: the first row filed stands, the board shows one');
assert.ok(made.dropDuplicateMade([row, answered]).some((one) => one.id === 'made-3'), 'a duplicate somebody replied to stays');

const query = { query: '', sourceFilter: 'all', tagKeys: [], tagMatchMode: 'any', sortMode: 'new' };
assert.deepEqual(selectBoardThreads([row, racer, board('post', 40)], query).map((one) => one.id), ['made-1', 'post'], 'on FEED as one row (M3A)');
assert.deepEqual(selectBoardThreads([row, board('post', 40)], { ...query, hideMade: true }).map((one) => one.id), ['post'], 'HIDE MADE leaves it out');

/* Filing (M1A) ---------------------------------------------------------------------------------------------------- */
assert.equal(made.shouldFileMade({ person: PERSON, switchOn: true, day: today, threads: [] }), true, 'the first thing of the day files a row');
assert.equal(made.shouldFileMade({ person: PERSON, switchOn: true, day: today, threads: [row] }), false, 'a second thing the same day files nothing: the row grows');
assert.equal(made.shouldFileMade({ person: PERSON, switchOn: false, day: today, threads: [] }), false, 'that kind\'s switch off files nothing');
assert.equal(made.shouldFileMade({ person: null, switchOn: true, day: today, threads: [] }), false, 'signed out files nothing');
assert.equal(made.shouldFileMade({ person: PERSON, switchOn: true, day: '2026-11-19', threads: [row] }), true, 'a new day is a new row');

const things = [
  { kind: 'files', id: 'f', title: 'F', at: new Date().toISOString(), href: '/files' },
  { kind: 'drawings', id: 'd', title: 'D', at: '2020-01-01T10:00:00Z', href: '/media?art=1' },
];
assert.deepEqual(made.thingsOfDay(things, today).map((one) => one.id), ['f'], "a row lists only its day's things");

/* Which kinds a row lists (M1A: a switch off posts nothing of that kind; only the maker can read their switches) ---- */
const allOn = { drawings: true, characters: true, files: true, tracks: true, letters: true };
assert.equal(made.madeBody(allOn), 'LISTS: drawings characters files tracks letters', 'the row says the kinds switched on');
assert.equal(made.madeBody({ ...allOn, tracks: false }), 'LISTS: drawings characters files letters', 'a kind switched off is left out');
const mixed = [{ kind: 'drawings', id: 'd1', title: 'D', at: new Date().toISOString(), href: '/' }, { kind: 'tracks', id: 't1', title: 'T', at: new Date().toISOString(), href: '/' }];
assert.deepEqual(made.thingsShown(mixed, made.madeBody({ ...allOn, tracks: false })).map((one) => one.id), ['d1'], 'TRACKS off: a track made that day is not listed on the row filed for a drawing');
assert.deepEqual(made.thingsShown(mixed, ''), [], 'a row with no kinds written lists nothing');
assert.deepEqual(made.thingsShown(mixed, 'LISTS: tracks drawings sneaky'), mixed, 'unknown words are ignored');
assert.equal(postCredit({ ...row, body: made.madeBody(allOn) }).id, PERSON, 'with its kinds in the body it is still credited to its maker');
assert.ok(read('app/lib/forum/made-filing.ts').includes('subscribeToMadeSwitches('), "a switch pressed rewrites today's row");

/* Wired where it should be ------------------------------------------------------------------------------------------- */
const privacy = read('app/components/PrivacySwitches.tsx');
assert.ok(privacy.includes('POST WHAT I MAKE TO THE BOARD') && privacy.includes('MADE_KINDS.map'), 'PRIVACY has the five switches under POST WHAT I MAKE TO THE BOARD');
const rules = read('app/lib/settings/settings-rules.ts');
for (const label of ['DRAWINGS', 'CHARACTERS', 'FILES', 'TRACKS', 'PUBLIC LETTERS']) assert.ok(rules.includes(`label: '${label}'`), `the ${label} switch`);
assert.ok(read('app/components/ForumBoard.tsx').includes('[ HIDE MADE ]'), 'HIDE MADE is in FILTER');
assert.ok(read('app/components/ForumThreadCard.tsx').includes('<MadeMarker />'), 'the row wears [ MADE ]');
assert.ok(read('app/components/SearchWindow.tsx').includes('title="DRAWINGS"'), 'SEARCH has a DRAWINGS group');
const filed = [
  ['app/lib/watch/use-room-canvas.ts', "fileMade('drawings')"],
  ['app/lib/character/show-on-profile.ts', "fileMade('characters')"],
  ['app/components/MediaCatalogue.tsx', "fileMade(item.kind === 'audio' ? 'tracks' : 'files')"],
  ['app/components/MediaCatalogue.tsx', "fileMade('tracks')"],
  ['app/components/LetterWindow.tsx', "fileMade('letters')"],
];
for (const [file, call] of filed) assert.ok(read(file).includes(call), `${file} files its kind: ${call}`);
// The row stores its anchor and which kinds it lists, never the things themselves (they are read live).
assert.ok(read('app/lib/forum/made-filing.ts').includes('body: madeBody(madeSwitches())'), 'the row is filed with the kinds switched on as its body, and nothing else');

console.log('check-made-posts: ok');
