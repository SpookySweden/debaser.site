/*
 * Scratch check for the projects structure (run from the project root):
 *   npx tsc app/lib/projects/debaser.ts app/lib/projects/tracks.ts app/lib/projects/notes.ts app/lib/projects/links.ts --outDir Temp/projects-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   npx tsc app/components/ProjectSectionNav.tsx app/components/SiteNav.tsx app/components/PresenceProvider.tsx --outDir Temp/projects-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-projects.cjs
 *
 * Proves the shape the request asked for:
 *   1. the debaser project is listed, and its shelves are concepts / lore / music /
 *      notes / links, each pointing at a page that really exists on disk;
 *   2. CONCEPTS is off the taskbar, and the project's own strip marks the shelf the
 *      page belongs to instead of linking to it;
 *   3. the music manifest describes files that can be played: a path in the archive's
 *      own folder, a running time, and the audio tags the /music directory filters on -
 *      what the directory draws from it is checked alongside the page's other controls
 *      (Temp/check-media-catalogue.cjs compiles MediaCatalogue.tsx, the shelf's home since 2026-10-24).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { ARCHIVE_PROJECTS, DEBASER_PROJECT, PROJECT_SECTIONS, projectSection } = require('./projects-out/debaser.js');
const { TRACKS, TRACK_FOLDER, archiveDisplayName, releaseTracks } = require('./projects-out/tracks.js');
const { PROJECT_NOTES } = require('./projects-out/notes.js');
const { ARCHIVE_LINKS, OUTBOUND_LINKS } = require('./projects-out/links.js');

const ProjectSectionNav = require('./projects-render/components/ProjectSectionNav.js').default;
const SiteNav = require('./projects-render/components/SiteNav.js').default;
const AuthProvider = require('./projects-render/components/AuthProvider.js').default;
const PresenceProvider = require('./projects-render/components/PresenceProvider.js').default;
const CommsProvider = require('./projects-render/components/CommsProvider.js').default;

const element = React.createElement;
/** The taskbar nav renders the unread badge, so it needs the whole provider stack. */
const withProviders = (child) =>
  renderToStaticMarkup(
    element(AuthProvider, null, element(PresenceProvider, null, element(CommsProvider, null, child))),
  );

/**
 * A manifest href is only honest if what it names is really there.
 *
 * Most shelves name a page, so the page has to be on disk. MUSIC names a window instead - the board's
 * address carrying the archive's own query (`/forum?music=1`, see app/lib/audio/music-window.ts) - so
 * the query is cut off before the look-up. What is being asked either way is whether a reader who
 * presses the shelf ends up somewhere that exists; the query only decides *how* the board shows it.
 */
const routeExists = (href) =>
  fs.existsSync(path.join(process.cwd(), 'app', href.replace(/^\//, '').split('?')[0], 'page.tsx'));

// 1. The project, its shelves, and that every shelf is a page.
assert.equal(DEBASER_PROJECT.href, '/projects/debaser');
assert.deepEqual(ARCHIVE_PROJECTS.map((project) => project.id), ['debaser'], 'one project listed today');
assert.deepEqual(PROJECT_SECTIONS.map((section) => section.id), ['concepts', 'lore', 'music', 'notes', 'links']);
assert.deepEqual(
  PROJECT_SECTIONS.map((section) => section.href),
  // 2026-10-24 (SPEC-media-catalogue.md): the music shelf is the media page's AUDIO tab now.
  ['/concepts', '/lore', '/files?kind=audio', '/notes', '/links'],
  'MUSIC is the shelf that is a window rather than a page: its href is the board carrying the query',
);
assert.equal(projectSection('music').label, 'MUSIC');
assert.equal(projectSection('nothing'), undefined);
assert.equal(routeExists(DEBASER_PROJECT.href), true, 'the project page exists');

for (const section of PROJECT_SECTIONS) {
  assert.equal(routeExists(section.href), true, `${section.href} has a page`);
}

for (const link of ARCHIVE_LINKS) {
  assert.equal(routeExists(link.href), true, `${link.href} has a page`);
}

for (const note of PROJECT_NOTES) {
  if (note.href !== undefined) assert.equal(routeExists(note.href), true, `${note.href} has a page`);
}

// 2. The manifests stay honest about the assets folder, and read as prose.
const ids = [
  ...TRACKS.map((track) => track.id),
  ...PROJECT_NOTES.map((note) => note.id),
  ...ARCHIVE_LINKS.map((link) => link.id),
  ...OUTBOUND_LINKS.map((link) => link.id),
];
assert.equal(new Set(ids).size, ids.length, 'every manifest id is unique');
assert.equal(TRACK_FOLDER, 'assets/audio');
assert.deepEqual(
  ARCHIVE_LINKS.slice(0, 6).map((link) => link.id),
  ['home', 'project', 'concepts', 'lore', 'music', 'notes'],
  'the shelf lists the archive in reading order',
);

for (const track of TRACKS) {
  assert.match(track.src, /^\/assets\/audio\/.+\.(mp3|m4a|ogg|wav|flac)$/, `${track.id} points into the audio folder`);
}

for (const note of PROJECT_NOTES) {
  assert.ok(note.body.length > 0, `${note.id} has a body`);
  assert.ok(
    note.body.every((paragraph) => paragraph.length > 40),
    `${note.id} is written out rather than stubbed`,
  );
  assert.ok(note.kinds.length > 0, `${note.id} sits on a shelf`);
}

// 3. The strip: the shelf the page is on is marked, the others are links.
const strip = renderToStaticMarkup(element(ProjectSectionNav, { current: 'concepts' }));
assert.match(strip, /CONCEPTS/);
assert.doesNotMatch(strip, /href="\/concepts"/, 'the current shelf does not link to itself');
assert.match(strip, /href="\/media\?kind=audio"/); // 2026-10-24: the shelf is the media page's AUDIO tab
assert.match(strip, /href="\/notes"/);
assert.match(strip, /href="\/links"/);
assert.match(strip, /href="\/projects\/debaser"/);
// (2026-10-23, SPEC-efficiency.md) The strip's `[ HOME ]` went to `/` while the header's HOME goes to
// `/projects`: two homes was one too many, so the strip has none; the project key above is its way back.
assert.doesNotMatch(strip, /href="\/"/, 'and no second way home');

// 4. The window's keys: five of them - neither window is one, both are the side panel's own keys
//    (see `SIDE_ARCADE` and `SIDE_MUSIC` in ./SiteNav.tsx) - and concepts is not one either.
const nav = withProviders(element(SiteNav, { active: 'forum' }));
// 2026-10-24 (SPEC-media-catalogue.md): MEDIA joined the band, so five became six.
// (2026-11-04) The header is four word keys now (HEADER_ITEMS: PROJECTS, FORUM, ARCHIVE, CYTUBE); NAV_ITEMS still feeds the menus.
assert.equal((nav.match(/<a\b/g) ?? []).length, 4, 'four keys, each one a link');
assert.doesNotMatch(nav, /CONCEPTS/, 'concepts is not a key: it is a shelf of the project');
assert.doesNotMatch(nav, /href="\/concepts"/);

// 5. The music catalogue's naming rules, held against a release this check builds itself.
//
// The shipped catalogue is now empty - the sixty invented tracks it held pointed at files that do not
// exist - so asserting "ten artists, twenty releases" was asserting a fact about fake data. The rules
// themselves are worth holding and are held below, against `releaseTracks`, the same machinery the app
// uses. That is a stronger test than a count: it holds the convention, not a snapshot of it.
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
assert.equal(new Set(fixture.map((track) => track.id)).size, 2, 'and every track its own id');

for (const track of fixture) {
  assert.equal(
    archiveDisplayName(track),
    `${track.title} - ${track.album} - ${track.artist}`,
    `${track.id} is named [TITLE] - [ALBUM] - [ARTIST]`,
  );
  assert.equal(track.src.startsWith(`/${TRACK_FOLDER}/`), true, `${track.id} lives in ${TRACK_FOLDER}`);
  assert.match(track.length, /^\d+:\d\d$/, `${track.id} states a running time`);
  assert.equal(track.tags.length > 0, true, `${track.id} says how it sounds`);
  assert.equal(track.trackNumber >= 1, true, `${track.id} knows its place on the release`);
}

// And the shipped catalogue is empty, asserted rather than assumed: an empty list that quietly refilled
// itself would be the invented data coming back.
assert.equal(TRACKS.length, 0, 'the shipped catalogue holds no invented tracks');

console.log('project checks passed');
console.log('  project :', DEBASER_PROJECT.title, '->', DEBASER_PROJECT.href);
console.log('  shelves :', PROJECT_SECTIONS.map((section) => `${section.label} ${section.href}`).join(' | '));
console.log('  tracks  :', TRACKS.length, '::', TRACKS.map((track) => track.src).join(' '));
console.log('  notes   :', PROJECT_NOTES.length, '::', PROJECT_NOTES.map((note) => note.title).join(' | '));
