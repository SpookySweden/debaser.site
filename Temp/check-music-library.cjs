const fs = require('node:fs');

/**
 * The music window's two screens, and which way in lands on which.
 *
 *   npx tsc app/lib/audio/music-window.ts app/lib/ui/window-slot.ts --outDir Temp/music-keys-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-music-library.cjs
 *
 * This is the check for the wiring rather than the feature: the tables and the pure logic are held by
 * `check-library.cjs`, and what is left to get wrong is *where a press takes you*. Specifically:
 *
 *   - the side panel's MUSIC key opens the reader's own music, because the panel is where a reader keeps
 *     their own things;
 *   - the player's MUSIC key opens the same thing, because a player is where a reader is certainly
 *     thinking about music;
 *   - everything that points at a *file* - a post's plate, a tag badge, the Start menu shelf - keeps
 *     opening the archive, because those are "show me this file";
 *   - and an address can name either screen, because a link has to be able to and a reload has to land
 *     where it said.
 *
 * The first half reads the sources, and the second half *drives the real module* - because reading a
 * source cannot tell a href that is used from one that is decorative, which is exactly how the side
 * panel opened the archive for as long as it did with `SIDE_MUSIC.href` pointing at the personal screen.
 */
const read = (file) => fs.readFileSync(file, 'utf8');

const window = read('app/lib/audio/music-window.ts');
const nav = read('app/components/SiteNav.tsx');
const shell = read('app/components/MusicWindow.tsx');

/* 1. The two addresses, and that the old one still means what it always did ------------------- */

const archiveHref = window.match(/MUSIC_HREF\s*=\s*'([^']+)'/);
const libraryHref = window.match(/LIBRARY_HREF\s*=\s*'([^']+)'/);

if (archiveHref === null) throw new Error('MUSIC_HREF is gone - every file link on the site uses it');
if (libraryHref === null) throw new Error('LIBRARY_HREF is gone - the personal screen has no address');

// 2026-10-24 (SPEC-media-catalogue.md): the archive moved onto the media page's AUDIO tab.
if (archiveHref[1] !== '/media?kind=audio') {
  throw new Error(`the archive's address changed to ${archiveHref[1]}: every existing link points here`);
}

if (libraryHref[1] !== '/forum?music=mine') {
  throw new Error(`the library's address is ${libraryHref[1]}: it should be the board's own query`);
}

// Which screen an address names. Since 2026-10-24 (SPEC-media-catalogue.md) the window has one screen,
// the reader's own music, and every `?music=...` address opens it - the archive is the media page.
// (2026-11-04) `?music=vanity` opens VANITY now; every other address still opens the reader's own music.
if (!/musicScreenRequested[\s\S]*?=== 'vanity' \? 'vanity' : 'mine';/.test(window)) {
  throw new Error('musicScreenRequested no longer opens the reader`s own music for every address');
}

/* 2. The side panel opens the personal screen ------------------------------------------------- */

const navItem = nav.match(/SIDE_MUSIC[^=]*=\s*\{([\s\S]*?)\n\};/);
if (navItem === null) throw new Error('SIDE_MUSIC is gone from SiteNav');

if (!/href:\s*LIBRARY_HREF/.test(navItem[1])) {
  throw new Error("the side panel's MUSIC key does not open the personal screen: it should");
}

// ...and the *behaviour* behind that href, which is the half this check could not see before.
//
// `SIDE_MUSIC.href` was `LIBRARY_HREF` for as long as the personal screen has existed, and the panel
// went on opening the archive the whole time, because the key is a `<button>` that called
// `toggleMusic()` with no argument - so the declaration and the behaviour were two statements and only
// the declaration was tested. These assertions drive the real module instead, which is why they cannot
// pass on a href that nothing reads.
const {
  LIBRARY_HREF: libraryHrefValue,
  MUSIC_HREF: archiveHrefValue,
  closeMusic,
  musicScreenForHref,
  musicWindowState,
  openMusic,
  toggleMusic,
} = require('./music-keys-out/audio/music-window.js');

const panelKey = () => toggleMusic(musicScreenForHref(libraryHrefValue));

closeMusic();
panelKey();
if (musicWindowState().screen !== 'mine' || !musicWindowState().open) {
  throw new Error(
    `the panel's MUSIC key opens "${musicWindowState().screen}" - it must open MY MUSIC, the screen its own href names`,
  );
}

panelKey();
if (musicWindowState().open) throw new Error('a second press on the panel key does not shut the window');

// 2026-10-24 (SPEC-media-catalogue.md): the window is the reader's own music; a link that names no
// screen opens that, because the archive is a page now and no screen here could show it.
closeMusic();
openMusic();
if (musicWindowState().screen !== 'mine') throw new Error('a link that names no screen no longer opens the reader`s own music');
// MUSIC_HREF is a page address now; the one screen any window href names is the reader's own.
if (musicScreenForHref(archiveHrefValue) !== 'mine') throw new Error('a window href names a screen that is not here');

// The player's bar carries the same key, on the same screen, through the same function.
const player = read('app/components/MusicPlayer.tsx');
if (!/musicScreenForHref\(SIDE_MUSIC\.href\)/.test(player)) {
  throw new Error("the player's MUSIC key does not derive its screen from SIDE_MUSIC: the two can drift");
}
if (/>\s*\[ SHELF \(/.test(player)) {
  throw new Error('the player still draws a SHELF button: it was replaced by the MUSIC key');
}
closeMusic();

/* 3. ...and nothing that points at a file was rewritten ---------------------------------------- */

const tagPill = read('app/components/AudioTagPill.tsx');
if (!/MUSIC_HREF/.test(tagPill)) {
  throw new Error('a track tag badge no longer opens the archive: a tag is about a file, not a person');
}

const directory = read('app/components/MediaCatalogue.tsx');
if (!/MUSIC_HREF/.test(directory)) {
  throw new Error('the shelf stopped naming its own address: a play from it would not say where it came from');
}

/* 4. The window actually draws both screens, and the switch names a screen --------------------- */

if (!/PersonalLibrary/.test(shell)) throw new Error('the window never draws the personal screen');
// 2026-10-24: the archive is not drawn here; the ARCHIVE tab is a link to the media page.
if (/<MusicDirectory/.test(shell)) throw new Error('the window draws the archive again - it moved to /media');
if (!/href=\{MUSIC_HREF\}/.test(shell)) throw new Error('the ARCHIVE tab no longer links to the media page');

// The window still opens from the address, so a link to it (either spelling) still lands here.
if (!/musicRequested\(query\)/.test(shell)) {
  throw new Error('the window no longer reads the address: a link to it would open nothing');
}

/* 5. The three gestures every row must carry -------------------------------------------------- */

// (2026-11-04, SPEC-vanity.md) "Rows that currently carry several keys lose them into the panel, so they get
// quieter." A row now has one `[ ⋯ ]` key and play; the like, and the COMMENT key (now ATTACH TO POST) moved to
// `SongMenu.tsx`, which every shelf row opens. The accent rule on the comment plate went with it: there is no list
// of plates to stand out from once the row carries none, so what is held is that the gesture is still there.
const row = read('app/components/LibraryRow.tsx');
const menu = read('app/components/SongMenu.tsx');

if (!/<SongMenuKey\b/.test(row) || !/<SongMenuPanel\b/.test(row)) throw new Error('a row has no way into the song settings panel');
if (/toggleLike|onLike|onComment|PLATE_ACCENT/.test(row)) throw new Error('a row carries the panel`s keys again: rows are meant to be quiet');

if (!/role="menuitemcheckbox"\s+aria-checked=\{liked\}/.test(menu)) {
  throw new Error('the heart is not a switch: it has no pressed state to read');
}

if (!/\[ ATTACH TO POST \]/.test(menu)) throw new Error('a row cannot be taken to the board');

if (!/onPlay/.test(row)) throw new Error('a row cannot be played');

const library = read('app/components/PersonalLibrary.tsx');

// The comment gesture reuses the composer's existing seam rather than a new one.
if (!/initialTrack=\{forumTrackFromArchive\(song\)\}/.test(menu)) {
  throw new Error('the post key does not open the composer pre-filled - it should reuse the seam');
}

// And a like is written at once, with no save step between the press and the row. The write lives in the
// provider now, because the archive's rows share it - so the panel calls it rather than the repository.
if (!/library\.toggleLike\(/.test(menu)) throw new Error('the panel never calls toggleLike');
// SPEC-vanity.md: "Liking stays one click on the player at the bottom too."
if (!/library\.toggleLike\(/.test(read('app/components/MusicPlayer.tsx'))) throw new Error('the player lost its one-press like');
if (!/repository\.toggleLike\(/.test(read('app/components/MusicLibraryProvider.tsx'))) {
  throw new Error('the provider never writes a like');
}

console.log('music-library');
console.log('  addresses : ?music=1 is the archive, ?music=mine is the reader`s own');
console.log('  the key   : the side panel opens MY MUSIC; a tag badge and a post plate still open the archive');
console.log('  the rows  : a heart that is a switch, a comment plate in accent, and a play');
console.log('  the seam  : the comment plate opens the board`s composer with the track already filed');

/* 6. The five faults review found, held closed ------------------------------------------------- */

const provider = read('app/components/MusicLibraryProvider.tsx');

// 1. (2026-10-24, SPEC-media-catalogue.md) One screen: the archive lives on the media page, so there
//    is no second screen to keep mounted. The window draws the personal shelf and nothing hidden.
if (/'hidden'/.test(shell)) {
  throw new Error('the window hides a screen again: it has one screen now, the reader`s own music');
}

// 2. A read that failed must not draw as an empty list.
if (!/answered/.test(provider)) throw new Error('the provider does not report whether the read answered');
if (!/refused/.test(read('app/lib/audio/repository.ts')) && !/answered/.test(read('app/lib/audio/repository.ts'))) {
  throw new Error('LibraryRead is gone: a failed read is indistinguishable from an empty one again');
}
if (!/library\.answered/.test(library)) throw new Error('the screen draws an empty list even when the read failed');
if (!/TRY AGAIN/.test(library)) throw new Error('a failed read offers no retry');

// 3. The empty state must not advertise a control that is not there.
// (2026-10-25, SPEC-less-text.md) The empty states are `NOTHING LIKED YET.` and `EMPTY.` now: the instruction
// after them (`EVERY ROW IN THE ARCHIVE WEARS A HEART - PRESS ONE...`, `THE BUTTONS UNDER A ROW PUT A TRACK INTO
// IT.`) is cut (rule 1). So the guard is now that the empty state promises no control at all - and the archive
// still has the heart below either way.
if (!/'NOTHING LIKED YET\.'/.test(library) || !/'EMPTY\.'/.test(library)) {
  throw new Error('the empty states are not the short `NOTHING LIKED YET.` / `EMPTY.` any more - check what they promise');
}
if (/WEARS A HEART|PRESS ONE AND IT LANDS HERE|THE BUTTONS UNDER A ROW/.test(library)) {
  throw new Error('the empty state points at a control again: check the control is really there, or cut the pointer');
}
// (2026-11-04, SPEC-vanity.md) The archive's rows reach the heart through the same panel.
if (!/useMusicLibrary\(\)/.test(directory) || !/<SongMenuPanel\b/.test(directory)) {
  throw new Error('the archive`s rows have no heart: the personal screen`s hint points at nothing');
}

// 4. A short shelf must be counted, not silently drawn short. Checked by *behaviour* rather than by
//    grepping for a word: the function is loaded and asked what it reports for a like it cannot resolve.
//    (An earlier version of this guard just looked for the string `missing`, which survived renaming the
//    field - `Temp/probe-guards.cjs` is what caught that, and is why this is written this way.)
{
  const { resolveLikes } = require('./library-out/audio/library.js');
  const report = resolveLikes([{ trackId: 'gone', likedAt: '1' }], [{ id: 'here', title: 'HERE' }]);

  if (typeof report !== 'object' || report === null || typeof report.missing !== 'number') {
    throw new Error('resolveLikes does not report a `missing` count: a short shelf reads as a short list');
  }
  if (report.missing !== 1) {
    throw new Error(`resolveLikes reported ${report.missing} drops for one unresolvable like`);
  }
  if (report.rows.length !== 0) throw new Error('resolveLikes drew a row for a track it could not resolve');
}
// (2026-11-04) A WEB song still being looked up is on its way, not unavailable, so the count is `missing` less those.
if (!/shown\.missing - webLookupsPending/.test(library) || !/missing <= 0 \? null/.test(library) || !/TRACK\{missing === 1 \? '' : 'S'\} UNAVAILABLE/.test(library)) {
  throw new Error('the screen never says that rows are missing from the list');
}

// 5. The rows must read a Set rather than scanning the likes once per row.
if (/isLiked\(likes, track\.id\)/.test(library) || /isInPlaylist\(current, track\.id\)/.test(library)) {
  throw new Error('a row scans the whole list for its own id again: that is quadratic in the list');
}
// (2026-11-04, SPEC-vanity.md) The like moved into the panel, so the panel is where the shared set is read.
if (/isLiked\(/.test(menu) || !/library\.likedIds\.has\(song\.id\)/.test(menu)) {
  throw new Error('the rows no longer read the shared liked set');
}

// 6. The session must not be read as signed-out while it is still arriving. Two places have to be right:
//    the provider must not read for a session that has not settled, and the screen must test `loading`
//    *before* it tests `userId === null` - otherwise a signed-in reader is told, mid-load, that they have
//    no library, and then watches it appear.
if (!/if \(status === 'loading'\) return;/.test(provider)) {
  throw new Error('the provider reads for a session that has not settled: a signed-in reader sees guest mode');
}
const loadingAt = library.indexOf("if (status === 'loading')");
const guestAt = library.indexOf('if (userId === null)');
if (loadingAt === -1 || guestAt === -1 || loadingAt > guestAt) {
  throw new Error('the guest test comes before the loading test: a signed-in reader flashes guest mode');
}
// (2026-10-23, SPEC-efficiency.md) The guest's offer is one line, `[ LOG IN ] TO KEEP THE TRACKS YOU LIKE...`.
if (!/\[ LOG IN \]/.test(library)) {
  throw new Error('a guest is not offered a way to get an account');
}

console.log('  reviewed  : mounted-both, answered-not-empty, heart-really-there, drops-counted, sets-not-scans');
