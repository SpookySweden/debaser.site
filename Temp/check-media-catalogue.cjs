/*
 * Scratch check for the media catalogue (SPEC-media-catalogue.md, 2026-10-24):
 *   npx tsc app/lib/media/fingerprint.ts app/lib/media/rules.ts app/lib/media/uses.ts app/lib/media/catalogue.ts --outDir Temp/media-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 *   npx tsc app/components/MediaCatalogue.tsx app/components/MediaUploadWindow.tsx --outDir Temp/media-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-media-catalogue.cjs
 *
 * Four things a screenshot cannot answer:
 *   1. the fingerprints: the looks-alike hash is deterministic, reads 0 for the same picture and
 *      64 for its negative, and the file rules refuse the wrong type and the oversized file;
 *   2. the uses: one post carrying the same catalogued picture by id and by address records it once,
 *      a sheet still read off the manifest records nothing, and a guest records nothing;
 *   3. the page, drawn: the categories with their counts (2026-11-04, was tabs), the storage line, the sheet's row, and the
 *      sign-in note for a guest / the upload key for an account; the AUDIO tab as the shelf in the
 *      same shape - a title line per folder, the unfiled files last, and PLAY on each row;
 *   4. the upload window, drawn for a guest and for an account.
 */
const assert = require('node:assert/strict');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const element = React.createElement;
const render = (node) => renderToStaticMarkup(node);

function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

/* 1. Fingerprints and rules ------------------------------------------------------------------ */

const { hashFromGrey, hashDistance, LOOKS_ALIKE_DISTANCE } = require('./media-out/media/fingerprint.js');
const { validateMediaFile, mediaStoragePath, mediaKindOf, formatBytes, MEDIA_LIMITS } = require('./media-out/media/rules.js');

const gradient = Array.from({ length: 72 }, (_, index) => index % 9);
const hash = hashFromGrey(gradient);
assert.equal(hash.length, 16, 'a looks-alike hash is 64 bits as 16 hex characters');
assert.equal(hash, hashFromGrey(gradient), 'and the same picture hashes the same twice');
assert.equal(hashDistance(hash, hash), 0, 'the same picture is 0 bits away from itself');
assert.equal(hashDistance(hash, hashFromGrey(gradient.map((value) => 8 - value))), 64, 'and its negative is every bit away');
assert.ok(LOOKS_ALIKE_DISTANCE >= 6 && LOOKS_ALIKE_DISTANCE <= 16, 'the looks-alike threshold is a nudge, not a gate');

if (typeof File === 'undefined') {
  console.log('  (File is not a global in this Node: the file rules are not driven here)');
} else {
  const png = new File([new Uint8Array(10)], 'drawing.png', { type: 'image/png' });
  const text = new File([new Uint8Array(10)], 'notes.txt', { type: 'text/plain' });
  const huge = new File([new Uint8Array(MEDIA_LIMITS.image + 1)], 'big.png', { type: 'image/png' });
  assert.equal(validateMediaFile('image', png), undefined, 'a small PNG is accepted');
  assert.match(validateMediaFile('image', text), /PNG, JPG, WEBP OR GIF ONLY./, 'a text file is refused with the picture sentence');
  assert.match(validateMediaFile('image', huge), /OR SMALLER/, 'an oversized picture is refused by size');
  assert.match(validateMediaFile('video', png), /MP4 OR WEBM ONLY./, 'a picture is not a video');
  assert.equal(mediaKindOf(png), 'image', 'a file knows its kind from its type');
  assert.equal(mediaKindOf(new File([], 'clip.webm', { type: 'video/webm' })), 'video');
}

assert.match(mediaStoragePath('image', 'user-1', 'My Drawing.png', '.png'), /^user-1\/image-my-drawing-\d{14}\.png$/, 'a stored file sits in its uploader`s own folder');
assert.equal(formatBytes(2 * 1024 * 1024), '2.0MB');

/* 2. Uses ---------------------------------------------------------------------------------------- */

const recorded = [];
stub('./media-out/media/repository.js', {
  getMediaRepository: () => ({ addUse: async (use) => { recorded.push(use); return null; } }),
  MEDIA_DATA_SOURCE: 'mock',
});

const { pictureTiles, previewFor, recordUses, postUse, replyUse } = require('./media-out/media/uses.js');
const { sheetItems } = require('./media-out/media/catalogue.js');

const UPLOAD = {
  id: 'media-1', kind: 'image', bucket: '', path: '/assets/media/image/u1-x.png', src: '/assets/media/image/u1-x.png',
  sha256: 'abc', bytes: 1000, mime: 'image/png', width: 100, height: 100, length: '', title: 'A DRAWING', credit: 'amy', tags: [],
  folderPath: null, source: 'upload', uploadedBy: 'u1', uploadedByLabel: 'amy', createdAt: '2026-10-24T00:00:00.000Z',
};
const sheets = sheetItems([]);
assert.ok(sheets.length >= 1, 'the manifest`s sheets are items before the migration');
assert.equal(sheets[0].source, 'sheet');
assert.equal(sheetItems([{ ...UPLOAD, src: sheets[0].src }]).length, sheets.length - 1, 'a sheet the migration filed is left to its row');

const TRACK = {
  id: 'media-2', kind: 'audio', bucket: 'mp3', path: 'u1/gravel-pit.mp3', src: '/assets/audio/gravel-pit.mp3',
  sha256: 'def', bytes: 3000000, mime: 'audio/mpeg', length: '3:21', title: 'GRAVEL PIT', credit: 'WU TANG', tags: ['HIP HOP'],
  folderPath: 'WU TANG', source: 'migrated', uploadedBy: 'u1', uploadedByLabel: 'amy', createdAt: '2026-10-23T00:00:00.000Z',
};
const LOOSE = { ...TRACK, id: 'media-3', path: 'u1/loose-one.mp3', src: '/assets/audio/loose-one.mp3', sha256: 'ghi', title: 'LOOSE ONE', folderPath: null, tags: [], createdAt: '2026-10-22T00:00:00.000Z' };
const items = [UPLOAD, TRACK, LOOSE, ...sheets];
const tiles = pictureTiles(items);
assert.equal(tiles[0].id, sheets[0].id, 'the picker leads with the sheets');
assert.deepEqual(previewFor(items, 'media-1'), { src: UPLOAD.src, alt: 'A DRAWING', width: 100, height: 100 });
assert.equal(previewFor(items, 'nothing'), undefined);

recordUses(items, postUse({ id: 't1', title: 'A POST' }, 'u1'), { mediaId: 'media-1', preview: previewFor(items, 'media-1') });
recordUses(items, postUse({ id: 't2', title: 'A SHEET POST' }, 'u1'), { mediaId: sheets[0].id, preview: previewFor(items, sheets[0].id) });
recordUses(items, replyUse({ id: 'c1' }, { id: 't1', title: 'A POST' }, null), { mediaId: 'media-1' });
assert.equal(recorded.length, 1, 'one post carrying one picture by id and by address records one use; a manifest sheet and a guest record none');
assert.deepEqual(recorded[0], { mediaId: 'media-1', useKind: 'post', useId: 't1', href: '/forum#thread-t1', label: 'A POST', addedBy: 'u1' });

/* 3. The page, drawn ----------------------------------------------------------------------------- */

let viewer = null;
const READ = {
  entries: items.map((item) => ({ item, uses: item.id === 'media-1' ? [{ id: 'use-1', mediaId: 'media-1', useKind: 'post', useId: 't1', href: '/forum#thread-t1', label: 'A POST', addedBy: 'u1', usedAt: '2026-10-24T00:00:00.000Z' }] : [] })),
  items,
  answered: true,
  loading: false,
  bytesUsed: 1000,
  reload: () => undefined,
};

const realCatalogue = require('./media-render/lib/media/catalogue.js');
stub('./media-render/lib/media/catalogue.js', { ...realCatalogue, useCatalogue: () => READ });
stub('./media-render/components/AuthProvider.js', { default: ({ children }) => children, useAuth: () => ({ user: viewer, status: 'ready' }) });
stub('./media-render/components/MusicPlayerProvider.js', {
  useMusicPlayer: () => ({
    queue: [{ id: 'u1/gravel-pit.mp3', src: '/assets/audio/gravel-pit.mp3', title: 'GRAVEL PIT', credit: 'WU TANG', kind: 'x', length: '3:21', tags: ['HIP HOP'], shelf: 'bucket' }],
    play: () => undefined,
    refresh: () => undefined,
  }),
});
stub('./media-render/components/MusicLibraryProvider.js', {
  // (2026-11-04) `barredSrcs` is new on the library (a file barred from the shelf): an empty one here.
  useMusicLibrary: () => ({ barredSrcs: new Set(), answered: true, loading: false, likedIds: new Set(['u1/gravel-pit.mp3']), likes: [], playlists: [], canWrite: viewer !== null, toggleLike: async () => ({ liked: true }), togglePlaylistTrack: async () => undefined, savePlaylist: async () => undefined, removePlaylist: async () => undefined, reload: () => undefined }),
});
stub('./media-render/components/ForumProvider.js', {
  useForum: () => ({ author: viewer === null ? { id: null, displayName: '' } : { id: viewer.id, displayName: viewer.displayName } }),
});
stub('./media-render/lib/audio/use-archive-folders.js', {
  useArchiveFolders: () => ({
    folders: [
      { path: 'WU TANG', createdBy: null, createdByLabel: 'x', createdAt: '' },
      { path: 'EMPTY SHELF', createdBy: null, createdByLabel: 'x', createdAt: '' },
      // A path with a shelf under it and nothing of its own: not a shelf, so not a line.
      { path: 'HEXHAM', createdBy: null, createdByLabel: 'x', createdAt: '' },
      { path: 'HEXHAM/GRIDLOCK', createdBy: null, createdByLabel: 'x', createdAt: '' },
    ],
    ready: true,
    create: async () => { throw new Error('not here'); },
    refresh: () => undefined,
  }),
});
stub('./media-render/components/NewPostForm.js', { default: () => null });
stub('./media-render/components/NewArchiveFileWindow.js', { default: () => null });
stub('./media-render/components/NewArchiveFolderWindow.js', { default: () => null });
stub('./media-render/components/PopoutWindow.js', {
  default: ({ title, status, actions, children }) => element('div', { 'data-window': title, 'data-status': status }, element('div', { 'data-actions': 'true' }, actions), children),
});
stub('./media-render/components/PresenceProvider.js', {
  default: ({ children }) => children,
  usePresence: () => ({ ready: true, status: 'offline', record: undefined }),
  usePresenceDirectory: () => ({ ready: true, statusFor: () => 'offline', recordFor: () => undefined }),
});

const originalLoad = Module._load;
let search = new URLSearchParams('');
Module._load = function load(request, parent, isMain) {
  if (request === 'next/navigation') {
    return { useSearchParams: () => search, usePathname: () => '/media', useRouter: () => ({ replace: () => undefined, push: () => undefined }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const MediaCatalogue = require('./media-render/components/MediaCatalogue.js').default;
const MediaUploadWindow = require('./media-render/components/MediaUploadWindow.js').default;

// (2026-11-04, Luke 2026-10-31 "the first thing you see should be a set of categories", lib/media/categories.ts)
// The tabs and the one long list became a front page of categories under PICTURES / MUSIC / VIDEO. Each section's
// `[ ALL n ]` counts its files, each category key counts its own, and no file is listed until one is pressed.
const guestPage = render(element(MediaCatalogue));
const sectionNames = [...guestPage.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => match[1]);
assert.deepEqual(sectionNames, ['PICTURES', 'MUSIC', 'TAGS'], 'the sections in order; VIDEO holds nothing here, so it is not drawn');
assert.equal((guestPage.match(/\[ ALL 2 \]/g) ?? []).length, 2, 'ALL counts the files in each section: the upload and the sheet, the two tracks');
assert.match(guestPage, /\[ POST PICTURES \(1\) \]/, 'the upload wears a post, so that is its category');
assert.match(guestPage, /\[ CONCEPT SHEETS \(1\) \]/, 'and the sheet has its own');
assert.match(guestPage, /\[ WU TANG \(1\) \]/, 'a music folder is a category');
assert.match(guestPage, /\[ EMPTY SHELF \(0\) \]/, 'one nobody has filled still shows, so it can be filed into');
assert.match(guestPage, /\[ UNFILED MUSIC \(1\) \]/, 'and a track in no folder has a place too');
assert.doesNotMatch(guestPage, /\[ (IMAGES|AUDIO|VIDEO) \d+ \]/, 'the old tabs are gone');
assert.match(guestPage, /CATALOGUE: 1000B OF 1\.00GB/, 'the storage line says how full it is');
// (2026-10-25, SPEC-less-text.md) The guest note `SIGN IN TO FILE A PICTURE OR A VIDEO` (and the AUDIO tab's
// `... A TRACK OR A FOLDER`) became the site's one locked-action line, `[ LOG IN ] TO FILE` (rule 3).
assert.match(guestPage, /\[ LOG IN \]<\/a> TO FILE/, 'a guest is told why there is no upload key, with the key to fix it');
assert.doesNotMatch(guestPage, /SIGN IN TO FILE/, 'not with the old sentence');
assert.doesNotMatch(guestPage, /\+ UPLOAD/, 'and gets none');
// (2026-11-04, Luke 2026-10-31) Nothing is listed on the front page; a category lists its files.
assert.doesNotMatch(guestPage, /A DRAWING|SHEET 01|GRAVEL PIT|LOOSE ONE/, 'the front page lists no file');
const pageAt = (address) => {
  search = new URLSearchParams(address);
  const page = render(element(MediaCatalogue));
  search = new URLSearchParams('');
  return page;
};
const postPictures = pageAt('cat=pictures-posts');
assert.match(postPictures, /A DRAWING/, 'the upload is a row in its category');
assert.match(postPictures, /IN 1 PLACE/, 'that says where it is used');
assert.match(postPictures, /\[ ← ALL CATEGORIES \]/, 'with the way back to the front page');
const sheetPage = pageAt('cat=pictures-sheets');
assert.match(sheetPage, /SHEET 01/, 'and the sheet is a row in its own');
assert.match(sheetPage, /NOT USED YET/, 'with nothing recorded against it yet');
assert.doesNotMatch(sheetPage, /A DRAWING/, 'and a category lists only its own');
assert.match(pageAt('cat=nothing-here'), /NOTHING FILED HERE\./, 'an address for no category says so');

// (2026-10-24, Luke) The AUDIO tab is the shelf in the catalogue's shape: a title line per folder, A
// to Z, a folder somebody made but has not filled yet included, the unfiled files last, and the
// shelf's keys on every row. A guest can play but not file, like or make a folder.
// (2026-11-04, Luke 2026-10-31 "everything needs to be collapsed") `?kind=audio` is the same order of title lines, now
// folded shut and named by top-level folder, each opening onto its files. The folder-level rules move to each
// folder's own page, which is what a press on a category key lands on.
search = new URLSearchParams('kind=audio');
const audioPage = render(element(MediaCatalogue));
assert.doesNotMatch(audioPage, /A DRAWING/, 'the audio tab lists no picture rows');
const shelves = [...audioPage.matchAll(/aria-label="([^"]+)" class="mt-1"/g)].map((match) => match[1]);
assert.deepEqual(shelves, ['EMPTY SHELF', 'HEXHAM', 'WU TANG', 'UNFILED MUSIC'], 'one title line per top folder A to Z, then the unfiled files');
assert.equal((audioPage.match(/aria-expanded="false"/g) ?? []).length, 4, 'and every one starts shut');
assert.doesNotMatch(audioPage, /GRAVEL PIT|LOOSE ONE/, 'so no file is listed yet');
assert.match(pageAt('cat=music-folder%3AEMPTY%20SHELF'), /EMPTY\.<\/p>/, 'an empty folder says so rather than vanishing');
const hexham = pageAt('cat=music-folder%3AHEXHAM');
assert.match(hexham, /\[\+\] GRIDLOCK/, 'a folder inside a folder is a fold of its own');
const wuTang = pageAt('cat=music-folder%3AWU%20TANG');
assert.match(wuTang, /GRAVEL PIT/, 'the filed track is on its shelf');
const unfiled = pageAt('cat=music-unfiled');
assert.match(unfiled, /LOOSE ONE/, 'and the loose one under UNFILED');
assert.doesNotMatch(unfiled, /GRAVEL PIT/, 'and only the loose one');
assert.equal((wuTang.match(/\[ ▶ PLAY \]/g) ?? []).length, 1, 'one play key per track');
assert.equal((unfiled.match(/\[ ▶ PLAY \]/g) ?? []).length, 1, 'one play key per track');
// (2026-10-25, Luke) INJECT is gone from the shelf; a track is picked in the composer instead.
assert.doesNotMatch(wuTang, /INJECT/, 'and no INJECT key on any row');
assert.equal((wuTang.match(/<audio/g) ?? []).length, 0, 'through the site`s one player, not an audio element each');
assert.match(audioPage, /\[ LOG IN \]<\/a> TO FILE/, 'a guest is told what an account buys');
assert.doesNotMatch(audioPage, /SIGN IN TO FILE A TRACK OR A FOLDER/, 'in the one locked-action line');
assert.doesNotMatch(audioPage, /NEW FILE|NEW FOLDER|\[ \+ FILE \]/, 'and gets none of the keys that need one');
assert.doesNotMatch(wuTang, /NEW FILE|NEW FOLDER|\[ \+ FILE \]/, 'on a folder`s page either');
// (2026-11-04, SPEC-vanity.md) The heart moved off the row into the song settings panel (`[ ⋯ ]`), so rows read as
// titles. Luke's table keeps one-press liking on the player bar only. The panel is drawn directly: a guest is told
// the way in rather than shown a dead heart, and an account's like is a switch that reads its state.
assert.match(wuTang, /aria-label="Song options for GRAVEL PIT"[^>]*>\[ ⋯ \]/, 'the row carries the settings key');
assert.doesNotMatch(wuTang, /♥|♡/, 'and no heart of its own');
const { SongMenuPanel } = require('./media-render/components/SongMenu.js');
const gravelPit = { id: 'u1/gravel-pit.mp3', src: '/assets/audio/gravel-pit.mp3', title: 'GRAVEL PIT', credit: 'WU TANG', kind: 'x', length: '3:21', tags: ['HIP HOP'], shelf: 'bucket', folderPath: 'WU TANG' };
const guestMenu = render(element(SongMenuPanel, { track: gravelPit, fromShelf: true, onClose: () => undefined }));
assert.match(guestMenu, /\[ LOG IN \]<\/a> TO LIKE AND KEEP LISTS/, 'a guest`s panel says what an account buys');
assert.doesNotMatch(guestMenu, /♥|♡|\[ BARR \]/, 'and offers no key that needs one');
viewer = { id: 'u1', displayName: 'amy' };
const accountMenu = render(element(SongMenuPanel, { track: gravelPit, fromShelf: true, onClose: () => undefined }));
viewer = null;
assert.match(accountMenu, /role="menuitemcheckbox" aria-checked="true"[^>]*>\[ ♥ UNLIKE \]/, 'an account`s panel shows the like as a switch, already on');
search = new URLSearchParams('kind=audio');

viewer = { id: 'u1', displayName: 'amy' };
const audioAccount = render(element(MediaCatalogue));
assert.match(audioAccount, /\+ NEW FILE/, 'an account is offered a new file');
assert.match(audioAccount, /\[ \+ NEW FOLDER \]/, 'and a new folder');
assert.equal((audioAccount.match(/\[ \+ FILE \]/g) ?? []).length, 3, 'and a file into each named shelf');
assert.doesNotMatch(audioAccount, /SIGN IN TO FILE|\[ LOG IN \]<\/a> TO FILE/, 'with nothing said about signing in');
viewer = null;

// A tag on the address filters the list flat, and says how to drop it.
search = new URLSearchParams('kind=audio&tag=hip-hop');
const tagged = render(element(MediaCatalogue));
assert.match(tagged, /TAGGED HIP-HOP:/, 'the tag is named');
assert.match(tagged, /GRAVEL PIT/, 'the track wearing it is listed');
assert.doesNotMatch(tagged, /LOOSE ONE/, 'the one without it is not');
assert.doesNotMatch(tagged, /UNFILED/, 'and the list is flat while filtering');
assert.match(tagged, /\[ CLEAR \]/, 'with the way to drop the tag');
search = new URLSearchParams('');

viewer = { id: 'u1', displayName: 'amy' };
const accountPage = render(element(MediaCatalogue));
assert.match(accountPage, /\+ UPLOAD/, 'an account gets the upload key');
assert.doesNotMatch(accountPage, /SIGN IN TO FILE|\[ LOG IN \]<\/a> TO FILE/, 'and not the note');

/* 4. The upload window --------------------------------------------------------------------------- */

const guestWindow = render(element(MediaUploadWindow, { uploader: null, items, bytesUsed: 0, onClose: () => undefined, onFiled: () => undefined }));
assert.match(guestWindow, /\[ IMAGE \]/, 'the kinds are offered');
assert.match(guestWindow, /\[ VIDEO \]/);
assert.match(guestWindow, /\[ FILE IT \]/, 'with the one key that files');
// (2026-10-25, SPEC-less-text.md) The foot keeps the two size limits and drops `THE SAME FILE TWICE IS THE SAME
// FILE`: the window shows the match itself (`ALREADY FILED AS ...`) when a file is chosen.
assert.match(guestWindow, /PICTURES [^:]+ :: VIDEO [^"<]+/, 'and the size limits in the window`s foot');
assert.doesNotMatch(guestWindow, /THE SAME FILE TWICE IS THE SAME FILE/, 'without the rule sentence');

const fullWindow = render(element(MediaUploadWindow, { uploader: viewer, items, bytesUsed: 0.9 * 1024 * 1024 * 1024, initialKind: 'video', onClose: () => undefined, onFiled: () => undefined }));
// (2026-10-25, SPEC-less-text.md) `THE CATALOGUE IS 90% FULL. VIDEO IS REFUSED FIRST.` -> `CATALOGUE 90% FULL - NO VIDEO.`
assert.match(fullWindow, /CATALOGUE 90% FULL - NO VIDEO\./, 'past the ceiling`s share, video says so before anything is chosen');

Module._load = originalLoad;

console.log('media catalogue checks passed');
console.log(`  hash ${hash} :: ${recorded.length} use recorded :: front page sections ${sectionNames.join(" / ")} :: music folds ${shelves.join(" > ")}`);
