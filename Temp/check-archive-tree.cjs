/*
 * Scratch checks for the archive browser: the catalogue, paths, the tree, the search and the
 * folder store (run from the root):
 *   npx tsc app/lib/audio/archive-tree.ts app/lib/audio/tags.ts app/lib/audio/forum-tracks.ts app/lib/audio/tracks.ts app/lib/audio/format.ts app/lib/audio/catalogue.ts app/lib/audio/repository.ts app/lib/audio/mock-music-repository.ts app/lib/audio/supabase-music-repository.ts app/lib/projects/tracks.ts --outDir Temp/archive-tree-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-archive-tree.cjs
 *
 * What the browser can get wrong, and one check each:
 *
 *   1. the catalogue - ten artists, twenty releases, sixty tracks, and a name read off where each
 *      file is filed;
 *   2. paths - spelling, nesting, parents, ancestors, and the `[TRACK TITLE] - [ALBUM NAME] -
 *      [ARTIST NAME]` convention that comes out of them;
 *   3. the rows - the player's queue in its own order, a posted track keeping its poster and its
 *      folder, a linked MP3 at the root;
 *   4. the tree - folders A to Z, files in running order, an empty folder that shows, a folder
 *      that only a file mentions, and the counts kept up the way out;
 *   5. the search and the tags;
 *   6. the folder store - making a folder, asking twice, and reading them back in order.
 */
const assert = require('node:assert/strict');

const {
  ROOT_FOLDER_NAME,
  archiveDisplayName,
  buildArchiveRows,
  buildArchiveTree,
  childFolderPath,
  fileLabel,
  filterArchiveRows,
  folderAncestors,
  folderLabel,
  folderName,
  isFiltering,
  matchesQuery,
  normaliseArchiveName,
  normaliseFolderPath,
  parentFolderPath,
  releaseFolderPath,
  sortByDisplayName,
} = require('./archive-tree-out/audio/archive-tree.js');
const { LOCAL_TRACKS } = require('./archive-tree-out/audio/tracks.js');

/**
 * The shelf this check's later sections are built on.
 *
 * **A fixture, not app data.** It used to be `LOCAL_TRACKS` - the archive's own catalogue - and that is why
 * this file broke the moment the invented catalogue was removed: the sections below test the *tree, the
 * rows, the search and the sorting*, and none of those care which tracks are filed. They care that folder
 * paths nest, that names sort, and that a query matches words. So the shelf is written here, at the shapes
 * those sections need, and the app's own catalogue is asserted empty separately - which is the honest split:
 * a check supplies its own fixtures rather than borrowing the thing it is testing.
 */
const SHELF = [
  ['shelf-one', 'ONE', 'SLEEP STATIC', 'TAPE DECK SUMMER', 'SLEEP STATIC/TAPE DECK SUMMER', '1996', 1],
  ['shelf-two', 'TWO', 'SLEEP STATIC', 'TAPE DECK SUMMER', 'SLEEP STATIC/TAPE DECK SUMMER', '1996', 2],
  ['shelf-three', 'THREE', 'SLEEP STATIC', 'TAPE DECK SUMMER', 'SLEEP STATIC/TAPE DECK SUMMER', '1996', 3],
  ['shelf-four', 'FOUR', 'DJ NULLSET', 'CARGO CULT BEATS', 'DJ NULLSET/CARGO CULT BEATS', '1999', 1],
  ['shelf-five', 'FIVE', 'DJ NULLSET', 'CARGO CULT BEATS', 'DJ NULLSET/CARGO CULT BEATS', '1999', 2],
  ['shelf-six', 'SIX', 'DJ NULLSET', 'CARGO CULT BEATS', 'DJ NULLSET/CARGO CULT BEATS', '1999', 3],
  ['shelf-seven', 'SEVEN', 'LOWLIGHT CHOIR', 'VESPERS', 'LOWLIGHT CHOIR/VESPERS', '2001', 1],
].map(([id, title, artist, album, folderPath, year, trackNumber]) => ({
  id,
  title: `${title} - ${album} - ${artist}`,
  credit: artist,
  kind: `${album} :: ${year}`,
  src: `/assets/audio/${id}.mp3`,
  length: '3:12',
  tags: ['LO FI'],
  folderPath,
  shelf: 'archive',
  trackNumber,
}));
const { getMockMusicRepository } = require('./archive-tree-out/audio/mock-music-repository.js');
const { TRACKS, releaseTracks } = require('./archive-tree-out/projects/tracks.js');

// 1. The catalogue's *shape*, held against a release built by the app's own machinery.
//
// The shipped catalogue holds nothing - the archive's hand-filed list is empty, because the sixty invented
// tracks that used to be here pointed at files that do not exist. A check that asserted "sixty tracks" was
// therefore asserting a fact about *fake data* rather than about the rule, and it broke the moment the fake
// data went - correctly, and for the wrong reason.
//
// So the rules are held against a release the check builds itself, through the same `releaseTracks` the app
// uses. That is the stronger test anyway: it holds the *machinery* - unique ids, the naming convention, a
// path derived from the release and not the title - instead of holding a snapshot of six strings.
const fixture = releaseTracks({
  artist: 'FIXTURE ARTIST',
  album: 'FIXTURE ALBUM',
  year: '1996',
  tags: ['LO FI'],
  tracks: [
    { title: 'ONE', length: '3:12' },
    { title: 'TWO', length: '2:48' },
  ],
});

assert.equal(fixture.length, 2, 'a release builds one track per entry');
assert.equal(new Set(fixture.map((track) => track.id)).size, 2, 'with an id each');

for (const track of fixture) {
  const folder = releaseFolderPath(track.artist, track.album);

  assert.equal(folder, `${normaliseArchiveName(track.artist)}/${normaliseArchiveName(track.album)}`);
  assert.equal(
    archiveDisplayName(track.title, folder),
    `${track.title} - ${track.album} - ${track.artist}`,
    `${track.id} reads [TITLE] - [ALBUM] - [ARTIST]`,
  );
  assert.equal(track.src, `/assets/audio/${track.id}.mp3`, `${track.id} points at its own file`);
  assert.match(track.length, /^\d+:\d\d$/, `${track.id} states a running time`);
  assert.equal(track.tags.length > 0, true, `${track.id} says how it sounds`);
  assert.equal(track.trackNumber >= 1, true, `${track.id} knows its place on the release`);
}

// The id is derived from the release and the position, never from the title - so retitling a track does
// not move the file it plays, which is the one property of this naming that a reader would notice break.
const retitled = releaseTracks({
  artist: 'FIXTURE ARTIST',
  album: 'FIXTURE ALBUM',
  year: '1996',
  tags: ['LO FI'],
  tracks: [
    { title: 'A DIFFERENT NAME', length: '3:12' },
    { title: 'ALSO DIFFERENT', length: '2:48' },
  ],
});

assert.deepEqual(
  retitled.map((track) => track.id),
  fixture.map((track) => track.id),
  'retitling a track does not move the file it plays',
);

// The shipped catalogue and the shelf built from it are both empty, and that is asserted rather than
// assumed: an empty list that quietly refilled itself would be the fake data coming back.
assert.equal(TRACKS.length, 0, 'the shipped catalogue is empty, which is the honest state');
assert.equal(LOCAL_TRACKS.length, 0, 'and so is the shelf the player reads from it');

// The shelf the player reads, held against the catalogue's own builder rather than against shipped data.
// `LOCAL_TRACKS` is `TRACKS` with the folder each file is filed in added, so the mapping is what is
// asserted - and it still holds with nothing in the list, which is asserted too.
assert.equal(LOCAL_TRACKS.length, TRACKS.length, 'the shelf is the catalogue, track for track');
assert.equal(LOCAL_TRACKS.length, 0, 'and both are empty while no release has been filed');

// 2. Paths: one spelling, one shape, and the naming convention read off them.
assert.equal(normaliseArchiveName('  my artist  '), 'MY ARTIST');
assert.equal(normaliseArchiveName('a/b\\c'), 'A B C', 'a name is one segment, never a path');
assert.equal(normaliseArchiveName('x'.repeat(200)).length, 64, 'and it is capped');
assert.equal(childFolderPath(null, 'hexham'), 'HEXHAM');
assert.equal(childFolderPath('HEXHAM', 'gridlock'), 'HEXHAM/GRIDLOCK');
assert.equal(childFolderPath('HEXHAM', '  '), 'HEXHAM', 'nothing typed is no change');
assert.equal(parentFolderPath('HEXHAM/GRIDLOCK'), 'HEXHAM');
assert.equal(parentFolderPath('HEXHAM'), null);
assert.equal(parentFolderPath(null), null);
assert.equal(folderName('HEXHAM/GRIDLOCK'), 'GRIDLOCK');
assert.equal(folderName('HEXHAM'), 'HEXHAM');
assert.deepEqual(folderAncestors('A/B/C'), ['A', 'A/B', 'A/B/C']);
assert.deepEqual(folderAncestors('A'), ['A']);
assert.deepEqual(folderAncestors(''), []);
assert.equal(normaliseFolderPath(' my artist / my release '), 'MY ARTIST/MY RELEASE');
assert.equal(normaliseFolderPath('  '), null, 'an empty path is not a folder');
assert.equal(folderLabel(null), ROOT_FOLDER_NAME);
assert.equal(folderLabel('HEXHAM/GRIDLOCK'), 'MUSIC / HEXHAM / GRIDLOCK');
assert.equal(archiveDisplayName('A TRACK', null), 'A TRACK', 'a file at the root is just its name');
assert.equal(archiveDisplayName('A TRACK', 'HEXHAM'), 'A TRACK - HEXHAM');
assert.equal(archiveDisplayName('A TRACK', 'HEXHAM/GRIDLOCK'), 'A TRACK - GRIDLOCK - HEXHAM');
assert.equal(fileLabel('https://x/y/My%20Track.mp3?dl=1'), 'My Track.mp3');

// 3. The rows the browser lists. The queue never holds the same file twice (`buildQueue`
//    dedupes), so the merge only ever decides between a shelf file and the post referencing it.
const shelfRow = (track) => ({
  track,
  poster: track.credit,
  tags: track.tags,
  source: track.shelf === 'bucket' ? 'SHELF' : 'ARCHIVE',
  folderPath: track.folderPath ?? null,
});

const thread = {
  id: 'thread-1',
  title: 'A POST',
  body: 'body',
  author: { id: null, displayName: 'WARD' },
  createdAt: '2026-09-23T10:00:00.000Z',
  anchor: { kind: 'board', id: 'board', label: 'BOARD' },
  tags: [],
  origin: 'user',
  // A catalogue track attached to a post, the way "[ FROM THE ARCHIVE ]" files one - built from the
  // check's own fixture rather than from shipped data, which is empty.
  track: {
    src: SHELF[0].src,
    title: SHELF[0].title,
    credit: SHELF[0].credit,
    tags: SHELF[0].tags,
    length: SHELF[0].length,
  },
  comments: [
    {
      id: 'comment-1',
      threadId: 'thread-1',
      body: 'reply',
      author: { id: 'u1', displayName: 'AMY' },
      createdAt: '2026-09-23T11:00:00.000Z',
      tags: [],
      // A file the shelf does not hold: linked from somewhere else, so it has no folder.
      track: { src: 'https://cdn.example.com/night-drive.mp3', title: 'NIGHT DRIVE', credit: '', tags: [] },
    },
  ],
};

const rows = buildArchiveRows([SHELF[0], SHELF[1], SHELF[3], SHELF[6]], [thread]);
assert.equal(rows.length, 5, 'four shelf files and one linked from a reply');
assert.equal(rows[0].track.src, SHELF[0].src, 'the queue order stands');
assert.equal(rows[0].source, 'BOARD', 'the posted copy is the one that is listed');
assert.equal(rows[0].poster, 'WARD', 'and it keeps the poster, which is what a listing prints');
assert.equal(rows[0].folderPath, 'SLEEP STATIC/TAPE DECK SUMMER', "but the file's own folder wins");
assert.equal(rows[0].track.title, SHELF[0].title, 'and it is still named the archive way');
assert.equal(rows[0].href.startsWith('/forum#'), true, 'with a way back to the post');
assert.equal(rows[1].source, 'ARCHIVE');
assert.equal(rows[2].folderPath, 'DJ NULLSET/CARGO CULT BEATS', 'the other artist`s release is its own folder');
assert.equal(rows[4].track.src, 'https://cdn.example.com/night-drive.mp3', 'a linked MP3 is listed');
assert.equal(rows[4].folderPath, null, 'at the root, because a post has no folders');
assert.equal(rows[4].poster, 'AMY', 'credited to whoever filed it');

// The tree: folders A to Z, files in running order, and the counts up the way out.
const tree = buildArchiveTree(rows);
assert.deepEqual(tree.paths, [
  'DJ NULLSET',
  'DJ NULLSET/CARGO CULT BEATS',
  'LOWLIGHT CHOIR',
  'LOWLIGHT CHOIR/VESPERS',
  'SLEEP STATIC',
  'SLEEP STATIC/TAPE DECK SUMMER',
]);
assert.deepEqual(tree.root.folders.map((folder) => folder.name), ['DJ NULLSET', 'LOWLIGHT CHOIR', 'SLEEP STATIC'], 'folders read A to Z');
assert.equal(tree.root.files.length, 1, 'the linked file is at the root');
assert.equal(tree.root.fileCount, 5, 'and the root counts everything under it');
assert.deepEqual(
  tree.root.folders[2].folders.map((folder) => folder.name),
  ['TAPE DECK SUMMER'],
  'an artist folders its releases underneath it',
);
assert.deepEqual(
  tree.root.folders[2].folders[0].files.map((row) => row.track.trackNumber),
  [1, 2],
  'and a release keeps its files in running order',
);
assert.equal(tree.root.folders[2].folders[0].fileCount, 2);

// The whole fixture as a tree: three artists, three releases, nothing loose.
const shelf = SHELF.map(shelfRow);
const whole = buildArchiveTree(shelf);
assert.equal(whole.paths.length, 6, 'three artists and three releases');
assert.equal(whole.root.folders.length, 3);
assert.equal(whole.root.files.length, 0, 'the fixture has nothing at the root');
assert.equal(whole.root.folders.map((folder) => folder.name)[0], 'DJ NULLSET', 'artists read A to Z');
assert.equal(whole.root.folders[0].fileCount, 3, 'every file counted under its artist');
assert.deepEqual(whole.root.folders[0].folders.map((folder) => folder.name), ['CARGO CULT BEATS']);

// A folder that is empty, and one that only a file mentions - an empty folder shows, and a path
// is real as soon as something is filed into it.
const made = buildArchiveTree(
  [{ ...rows[3], folderPath: 'MIRA VOLKOV/STATIC BLOOM' }],
  [{ path: 'MIRA VOLKOV/STATIC BLOOM' }, { path: 'EMPTY LABEL' }],
);
assert.deepEqual(made.paths, ['EMPTY LABEL', 'MIRA VOLKOV', 'MIRA VOLKOV/STATIC BLOOM']);
assert.equal(made.root.folders[0].name, 'EMPTY LABEL');
assert.equal(made.root.folders[0].fileCount, 0, 'an empty folder is listed with nothing in it');
assert.equal(made.root.folders[1].folders[0].files.length, 1, 'and a folder a file mentions exists');

// A path three deep nests three deep: a folder is only a path.
const deep = buildArchiveTree([{ ...rows[0], folderPath: 'A/B/C' }]);
assert.equal(deep.root.folders[0].folders[0].folders[0].name, 'C');
assert.equal(deep.root.fileCount, 1);

// 5. The search, and the tag filter over the same listing.
const all = SHELF.map(shelfRow);
const filter = (over) => ({ query: '', tagKeys: [], matchAll: false, ...over });

assert.equal(isFiltering(filter({})), false);
assert.equal(isFiltering(filter({ query: 'idm' })), true);
assert.equal(isFiltering(filter({ tagKeys: ['noise'] })), true);
assert.equal(isFiltering(filter({ query: '   ' })), false);
assert.equal(filterArchiveRows(all, filter({})).length, all.length, 'nothing asked for lists everything');

// The counts below are the fixture's own, and the *rules* they exercise are what matters: case and spacing
// do not matter, every word has to be found, and ANY/ALL differ. The numbers were written against the old
// sixty-track catalogue and are now the fixture's.
assert.equal(filterArchiveRows(all, filter({ query: 'vespers' })).length, 1, 'a release name finds its files');
assert.equal(filterArchiveRows(all, filter({ query: 'dj nullset' })).length, 3, 'an artist name finds their folder');
assert.equal(filterArchiveRows(all, filter({ query: 'TAPE DECK SUMMER' })).length, 3, 'a folder name finds its files');
assert.equal(filterArchiveRows(all, filter({ query: 'summer' })).length, 3, 'a word in a title finds its file');

const narrowed = filterArchiveRows(all, filter({ query: 'dj nullset cargo' }));
assert.equal(narrowed.length, 3, 'two words narrow to one folder');
assert.equal(narrowed.every((row) => row.folderPath === 'DJ NULLSET/CARGO CULT BEATS'), true);
assert.equal(matchesQuery(shelfRow(SHELF[0]), '  ONE   tape '), true, 'spacing and case do not matter');
assert.equal(matchesQuery(shelfRow(SHELF[0]), 'one vespers'), false, 'every word has to be found');

// Every fixture track wears LO FI, so the tag cases are exact without depending on invented tag spreads.
// The keys are the normalised form (`lo-fi`), which is what a filter carries.
assert.equal(filterArchiveRows(all, filter({ tagKeys: ['lo-fi'] })).length, all.length, 'every fixture file is LO FI');
assert.equal(filterArchiveRows(all, filter({ tagKeys: ['lo-fi', 'noise'] })).length, all.length, 'ANY is either tag');
assert.equal(filterArchiveRows(all, filter({ tagKeys: ['lo-fi', 'noise'], matchAll: true })).length, 0, 'ALL is both, and none are');
assert.equal(filterArchiveRows(all, filter({ tagKeys: [] })).length, all.length, 'an empty choice takes everything');
assert.equal(
  filterArchiveRows(all, filter({ query: 'dj nullset', tagKeys: ['lo-fi'] })).length,
  3,
  'the search and the tags narrow together',
);

// A flat run reads by display name, so the first is whatever the fixture's titles sort to first.
const alphabetical = [...all].sort((a, b) => a.track.title.localeCompare(b.track.title));
assert.equal(sortByDisplayName(all)[0].track.title, alphabetical[0].track.title, 'a flat run reads by name');

// 6. The folder store: made once, spelled the archive's way, listed in order.
(async () => {
  const music = getMockMusicRepository();

  assert.deepEqual(await music.listFolders(), [], 'nothing is filed in a fresh browser');

  const made = await music.createFolder({ path: ' hexham / gridlock ', creatorId: 'u-sweden', creatorName: 'sweden' });

  assert.equal(made.path, 'HEXHAM/GRIDLOCK', 'the path is normalised');
  assert.equal(made.createdByLabel, 'SWEDEN');

  const again = await music.createFolder({ path: 'HEXHAM/GRIDLOCK', creatorId: 'u-amy', creatorName: 'amy' });

  assert.equal(again.createdBy, 'u-sweden', 'asking twice is the same folder, not an error');
  assert.deepEqual((await music.listFolders()).map((folder) => folder.path), ['HEXHAM/GRIDLOCK']);

  await music.createFolder({ path: 'BLIND TERMINAL', creatorId: 'u-amy', creatorName: 'amy' });
  assert.deepEqual(
    (await music.listFolders()).map((folder) => folder.path),
    ['BLIND TERMINAL', 'HEXHAM/GRIDLOCK'],
    'folders are listed in order',
  );

  await assert.rejects(() => music.createFolder({ path: '   ', creatorId: 'u-amy', creatorName: 'amy' }), /NEEDS A NAME/);

  console.log('archive listing checks passed');
  console.log('  catalogue :', TRACKS.length, 'filed releases (none invented), fixture', SHELF.length, 'tracks');
  console.log('  paths     :', whole.paths.length, 'folders from the fixture ::', folderLabel('HEXHAM/GRIDLOCK'));
  console.log('  rows      :', rows.length, 'listed from four shelf files and one thread');
  console.log('  search    : dj nullset ->', filterArchiveRows(all, filter({ query: 'dj nullset' })).length, ':: narrowed ->', narrowed.length);
  console.log('  folders   : made twice, listed once, at', (await music.listFolders()).length, 'paths');
})();
