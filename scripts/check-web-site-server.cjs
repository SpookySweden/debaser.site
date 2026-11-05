/*
 * WEB became ARCHIVE, then MEDIA (2026-11-04), and the catalogue (now FILES) is one of its servers, offline (Luke,
 * 2026-11-03; SPEC-web.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/site-server.ts --outDir Temp/out-web-site-server --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   npx tsc next.config.ts --outDir Temp/out-web-site-server-config --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * DEBASER.SITE (app/lib/web/site-server.ts `siteFileMatches`), the site's own files in an archive search:
 * - whole words, as the rest of the archive search: every word, or any one with VIBE on; found in the title,
 *   credit, filer, folder, category names and tags
 * - only for SOURCE ALL; TYPE keeps its kind; `from:` matches the credit or the filer
 * - no words and no creator: nothing (the plain stream lists none of the site's files)
 * - newest first, oldest first under SORT: DATE flipped
 * - each file links to its first category on the catalogue page (`/files?cat=`)
 * The rename:
 * - /web and /archive redirect to /media for good, and the catalogue's old /media?kind=, ?cat= and ?tag= to /files (next.config.ts); the page files moved
 * - the header has one MEDIA key, to /media, and none to /files; the menus' WEB key is MEDIA, and the catalogue's is FILES
 * - the music window's tab to the catalogue's music says FILES, the page's name
 * - none of the old words is left on the screens that showed them
 */
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { makeAsserts } = require('./web-search-check-kit.cjs');

const ROOT = join(__dirname, '..');
const site = require(join(ROOT, 'Temp', 'out-web-site-server', 'lib', 'web', 'site-server.js'));
const config = require(join(ROOT, 'Temp', 'out-web-site-server-config', 'next.config.js')).default;
const asserts = makeAsserts('ARCHIVE + DEBASER.SITE');
const { ok, same } = asserts;

/* ---------------------------------------------------------------- the site's files */
const item = (id, fields) => ({
  id,
  kind: 'audio',
  bucket: 'mp3',
  path: `${id}.mp3`,
  src: `https://example.supabase.co/storage/v1/object/public/mp3/${id}.mp3`,
  sha256: id,
  bytes: 1000,
  mime: 'audio/mpeg',
  length: '',
  title: id,
  credit: '',
  tags: [],
  folderPath: null,
  source: 'upload',
  uploadedBy: 'user-1',
  uploadedByLabel: 'SWEDEN',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...fields,
});
const use = (mediaId, useKind) => ({ id: `${mediaId}-${useKind}`, mediaId, useKind, useId: 'x', href: '/forum', label: 'A PLACE', addedBy: null, usedAt: '2026-10-01T00:00:00.000Z' });

const A = { item: item('francis', { title: 'FRANCIS SAMPLE REMINSCING', tags: ['lo-fi'], length: '2:31', createdAt: '2026-10-24T00:00:00.000Z' }), uses: [] };
const B = { item: item('drive', { title: 'NIGHT DRIVE', credit: 'HEXHAM', folderPath: 'HEXHAM/GRIDLOCK', createdAt: '2026-10-25T00:00:00.000Z' }), uses: [] };
const C = {
  item: item('sheet:01', { kind: 'image', bucket: '', title: 'SHEET 01 // FIGURE STUDY', credit: 'debaser.site', uploadedByLabel: 'debaser.site', tags: ['CONCEPT SHEET'], source: 'sheet', createdAt: '2026-09-21T00:00:00.000Z' }),
  uses: [],
};
const D = { item: item('face', { kind: 'image', title: 'MY FACE', uploadedByLabel: 'TEST ACCOUNT A', createdAt: '2026-10-26T00:00:00.000Z' }), uses: [use('face', 'profile_picture')] };
const E = { item: item('reel', { kind: 'video', title: 'NOSFERATU REEL', credit: 'MURNAU', createdAt: '2026-10-27T00:00:00.000Z' }), uses: [] };
const ALL = [A, B, C, D, E];

const filters = (more = {}) => ({ source: 'all', type: 'all', ...more });
const ids = (query, more) => site.siteFileMatches(ALL, { query, filters: filters(more) }).map((entry) => entry.item.id);

same(site.SITE_SERVER_LABEL, 'DEBASER.SITE', 'the server is called DEBASER.SITE (Luke\'s choice)');
same(ids('francis'), ['francis'], 'a word of the title finds the file');
same(ids('FRANCIS'), ['francis'], 'in any case');
same(ids('franc'), [], 'whole words only, as the rest of the archive search (not a part of one)');
same(ids('night drive'), ['drive'], 'every word');
same(ids('night francis'), [], 'every word must be there');
same(ids('night francis', { vibe: true }), ['drive', 'francis'], 'with VIBE on, any one');
same(ids('hexham'), ['drive'], 'the credit');
same(ids('sweden'), ['reel', 'drive', 'francis'], 'who filed it (newest first)');
same(ids('gridlock'), ['drive'], 'the folder it is filed in');
same(ids('profile pictures'), ['face'], 'a category\'s name (PROFILE PICTURES)');
same(ids('videos'), ['reel'], 'a category\'s name (VIDEOS)');
same(ids('fi'), ['francis'], 'a tag\'s words');
same(ids('concept sheet'), ['sheet:01'], 'a concept sheet, by its tag and category');

same(ids('sheet', { type: 'image' }), ['sheet:01'], 'TYPE: IMAGE keeps the picture');
same(ids('sheet', { type: 'audio' }), [], 'TYPE: AUDIO leaves it out');
same(ids('nosferatu', { type: 'video' }), ['reel'], 'TYPE: VIDEO');
same(ids('nosferatu', { type: 'text' }), [], 'TYPE: TEXT: the site holds none');

same(ids('francis', { source: 'youtube' }), [], 'SOURCE: one platform leaves them out');
same(ids('nosferatu', { source: 'kino' }), [], 'SOURCE: KINO leaves them out');

same(ids('', { authors: ['murnau'] }), ['reel'], 'from: alone finds a creator\'s files (the credit)');
same(ids('', { authors: ['test account a'] }), ['face'], 'from: matches who filed it too');
same(ids('francis', { authors: ['murnau'] }), [], 'from: and words together');
same(ids('', { authors: ['test'] }), ['face'], 'from: a whole word of the name');
same(ids('', { authors: ['acc'] }), [], 'from: never a part of a word');

same(ids(''), [], 'no words and no creator: none (the plain stream lists none of the site\'s files)');
same(ids('   !!  '), [], 'nothing but signs: none');

same(ids('francis night nosferatu', { vibe: true }), ['reel', 'drive', 'francis'], 'newest first');
same(ids('francis night nosferatu', { vibe: true, sort: 'oldest' }), ['francis', 'drive', 'reel'], 'oldest first under SORT: DATE flipped');
same(ids('francis night nosferatu', { vibe: true, sort: 'best' }), ['reel', 'drive', 'francis'], 'BEST MATCH keeps them newest first');

same(site.siteFileHref(A), '/files?cat=music-unfiled', 'an unfiled track: UNFILED MUSIC on the catalogue page');
same(site.siteFileHref(B), '/files?cat=music-folder%3AHEXHAM', 'a filed track: its folder\'s category');
same(site.siteFileHref(D), '/files?cat=pictures-profile', 'a profile picture: PROFILE PICTURES');
same(site.siteFileHref(E), '/files?cat=videos', 'a video: VIDEOS');
ok(site.SITE_FILES_SHOWN >= 4 && site.SITE_FILES_SHOWN <= 20, 'a handful shown before ALL n FILES');

/* ---------------------------------------------------------------- the address */
async function addresses() {
  same(
    await config.redirects(),
    [
      { source: '/web', destination: '/media', permanent: true },
      { source: '/archive', destination: '/media', permanent: true },
      // Updated on purpose 2026-11-05: TAG STATION became DISCOVER at /discover (Luke, SPEC-discover.md).
      { source: '/tag-station', destination: '/discover', permanent: true },
      // Updated on purpose 2026-11-04: CYTUBE became STREAM at /stream (Luke).
      { source: '/cytube', destination: '/stream', permanent: true },
      ...['kind', 'cat', 'tag'].map((key) => ({ source: '/media', has: [{ type: 'query', key }], destination: '/files', permanent: true })),
    ],
    "/web and /archive redirect to /media for good, and the catalogue's old addresses to /files",
  );
  ok(existsSync(join(ROOT, 'app', 'media', 'page.tsx')) && /<WebStream \/>/.test(readFileSync(join(ROOT, 'app', 'media', 'page.tsx'), 'utf8')), 'the search page is at /media');
  ok(existsSync(join(ROOT, 'app', 'files', 'page.tsx')) && /<MediaCatalogue \/>/.test(readFileSync(join(ROOT, 'app', 'files', 'page.tsx'), 'utf8')), 'the catalogue is at /files');
  ok(!existsSync(join(ROOT, 'app', 'archive', 'page.tsx')), 'and nothing is left at /archive for the redirect to lose to');
  ok(!existsSync(join(ROOT, 'app', 'web', 'page.tsx')), 'and nothing is left at /web for the redirect to lose to');
}

/* ---------------------------------------------------------------- the keys */
const nav = readFileSync(join(ROOT, 'app', 'components', 'SiteNav.tsx'), 'utf8');
const block = (name) => new RegExp(`const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\];`).exec(nav)?.[1] ?? '';
const header = [...block('HEADER_ITEMS').matchAll(/\{\s*key:\s*'([^']+)',\s*label:\s*'([^']+)',\s*href:\s*'([^']+)'\s*\}/g)].map(([, key, label, href]) => ({ key, label, href }));
const menu = [...block('NAV_ITEMS').matchAll(/\{\s*key:\s*'([^']+)',\s*label:\s*'([^']+)',\s*mark:\s*\w+,\s*href:\s*'([^']+)'\s*\}/g)].map(([, key, label, href]) => ({ key, label, href }));
ok(header.length >= 3 && menu.length >= 5, `the two key lists were read (${header.length}, ${menu.length})`);
same(header.filter((key) => key.label === 'MEDIA'), [{ key: 'web', label: 'MEDIA', href: '/media' }], 'the header: one MEDIA key, to /media');
ok(!header.some((key) => key.href === '/files'), 'the header: no key to the catalogue (it is one of the search page\'s servers now)');
ok(![...header, ...menu].some((key) => key.label === 'WEB' || key.label === 'ARCHIVE'), 'no key says WEB or ARCHIVE');
same(menu.find((key) => key.key === 'web'), { key: 'web', label: 'MEDIA', href: '/media' }, 'the Start menu and phone menu: MEDIA, to /media');
same(menu.find((key) => key.key === 'media'), { key: 'media', label: 'FILES', href: '/files' }, 'the catalogue is FILES in the menus');
// The music window's link to the catalogue's music says the page's name (Luke, 2026-11-04).
const musicWindow = readFileSync(join(ROOT, 'app', 'components', 'MusicWindow.tsx'), 'utf8');
const catalogueTab = /<Link href=\{MUSIC_HREF\}[^>]*>\s*([^<]*?)\s*<\/Link>/.exec(musicWindow)?.[1];
same(catalogueTab, '[ FILES ]', 'the music window\'s tab to the catalogue\'s music says FILES');

/* ---------------------------------------------------------------- the old words */
const SCREENS = [
  'app/media/page.tsx',
  'app/files/page.tsx',
  'app/components/MediaCatalogue.tsx',
  'app/components/WebSignInGate.tsx',
  'app/components/WebStream.tsx',
  'app/components/WebSiteFiles.tsx',
  'app/components/StreamQueueWindow.tsx',
  'app/components/ThreadSubjectRow.tsx',
  'app/components/ForumBoard.tsx',
  'app/components/AnchorLink.tsx',
  'app/lib/forum/board-search.ts',
  'app/lib/web/bridges.ts',
  'app/lib/web/web-session.ts',
  'app/lib/web/supabase-web-repository.ts',
  'app/lib/audio/tracks.ts',
];
const OLD_WORDS = [
  '[WEB]',
  '// WEB<',
  'SIGN IN TO USE WEB',
  "WEB CAN'T PLAY",
  'READING THE WEB',
  'SEARCH WEB',
  'Search WEB',
  'WEB THREADS',
  'WEB ITEM //',
  'NO LONGER ON WEB',
  "'Sign in to use WEB",
  "'The WEB stream",
  "'WEB' :",
  ">WEB<",
  'OUR VIDEO<',
  "where: 'WEB'",
  "'/web'",
  // ARCHIVE's words, gone with it (Luke, 2026-11-04). The site's older sense, "the archive" as all it holds, stays.
  '[ARCHIVE]',
  '// ARCHIVE<',
  'SIGN IN TO USE THE ARCHIVE',
  "THE ARCHIVE CAN'T PLAY",
  'READING THE ARCHIVE',
  'SEARCH THE ARCHIVE',
  'Search the archive',
  'ARCHIVE THREADS',
  'ARCHIVE ITEM //',
  'NO LONGER IN THE ARCHIVE',
  "'Sign in to use the archive",
  "'The archive could not",
  '>ARCHIVE<',
  "where: 'ARCHIVE'",
  "'/archive'",
  // The catalogue's old name.
  'MEDIA CATALOGUE',
  'THE MEDIA PAGE',
];
for (const file of SCREENS) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const left = OLD_WORDS.filter((word) => text.includes(word));
  same(left, [], `${file}: none of the old WEB words is left`);
}

addresses()
  .then(() => asserts.done())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
