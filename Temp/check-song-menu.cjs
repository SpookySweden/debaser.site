/*
 * The song menu (the `[ ⋯ ]` key on the player bar and on a song's row), as Luke asked on 2026-11-14: "THE LIST OF
 * OPTIONS at the end of the player needs to be a vertical list. add to needs to go like 'add to: (playlist) (letter)'".
 * Drawn here, not read as text: one option to a line, the adding line first, and what "add to a playlist" does.
 * Run from the root:
 *   npx tsc app/components/SongMenu.tsx app/components/AddToPlaylistKey.tsx app/lib/audio/playlist-adding.ts --rootDir app --outDir Temp/song-menu-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-song-menu.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const el = React.createElement;
const OUT = path.join(__dirname, 'song-menu-out');
function stub(file, exports) {
  const resolved = require.resolve(path.join(OUT, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

let viewer = null;
let library = null;
const SONG = { id: 'u1/gravel-pit.mp3', src: '/assets/audio/gravel-pit.mp3', title: 'GRAVEL PIT', credit: 'WU TANG', kind: 'x', length: '3:21', tags: [], shelf: 'bucket', folderPath: 'WU TANG' };
const said = [];
function freshLibrary(over = {}) {
  return {
    canWrite: true,
    playlists: [
      { id: 'p1', ownerId: 'u1', name: 'LATE NIGHT', createdAt: '', items: [{ trackId: SONG.id, addedAt: '' }] },
      { id: 'p2', ownerId: 'u1', name: 'ROAD', createdAt: '', items: [] },
    ],
    likedIds: new Set(),
    barredSrcs: new Set(),
    togglePlaylistTrack: async (playlistId, trackId) => void said.push(['toggle', playlistId, trackId]),
    savePlaylist: async (name) => {
      said.push(['save', name]);
      return { id: 'p3', ownerId: 'u1', name: name.trim().toUpperCase(), createdAt: '', items: [] };
    },
    toggleLike: async () => ({ liked: true }),
    toggleBarr: async () => ({ barred: true }),
    ...over,
  };
}

stub('components/AuthProvider.js', { default: ({ children }) => children, useAuth: () => ({ user: viewer, status: viewer === null ? 'signed-out' : 'signed-in' }) });
stub('components/MusicLibraryProvider.js', { useMusicLibrary: () => library });
stub('components/MusicPlayerProvider.js', { useMusicPlayer: () => ({ queue: [SONG], shelfSize: 1, enqueue: () => undefined }) });
stub('components/NewPostForm.js', { default: () => null });
// Over the player the list is drawn through a portal placed after a measurement; here it is drawn where it stands.
stub('components/AboveAnchor.js', { default: ({ children }) => children });
stub('components/SongCoverCard.js', { SongCardEditor: () => null });
stub('components/PopoutWindow.js', { default: ({ title, children }) => el('section', { 'data-window': title }, children) });
stub('components/LetterStamp.js', { default: () => null });
stub('lib/letters/store.js', { addThing: async () => 'added', createLetter: async () => ({ id: 'l', name: 'L' }), useLettersOf: () => ({ value: [], loading: false, error: null }) });

const { SongMenuPanel } = require('./song-menu-out/components/SongMenu.js');
const adding = require('./song-menu-out/lib/audio/playlist-adding.js');

/** The words a reader sees, tags gone. */
const visible = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const draw = (props = {}) => renderToStaticMarkup(el(SongMenuPanel, { track: SONG, fromShelf: true, onClose: () => undefined, ...props }));
let failed = 0;
async function test(name, run) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

(async () => {
  /* 1. The list, drawn ---------------------------------------------------------------------------- */
  await test('signed in: the adding line reads ADD TO: [ PLAYLIST ] then the letter key, on one line of its own', () => {
    viewer = { id: 'u1' };
    library = freshLibrary();
    const html = draw();
    const line = /<div role="group" aria-label="Add to"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    assert.ok(line, 'the adding line is a named group');
    const words = visible(line[1]);
    assert.equal(words, 'ADD TO: [ PLAYLIST ] [ LETTER ]', "Luke's own words for the line");
    assert.doesNotMatch(visible(html), /ADD TO PLAYLIST:/, 'the old line of every playlist is gone from the menu');
    assert.doesNotMatch(html, /LATE NIGHT|\[ \+ NEW \]|\[ MAKE \]/, 'the playlists wait in their own window, as the letters do');
  });

  await test('one option to a line: every other key is a row as wide as the list, in a column', () => {
    viewer = { id: 'u1' };
    library = freshLibrary();
    const html = draw();
    assert.match(html, /<div role="menu"[^>]*class="[^"]*\bflex flex-col\b/, 'the list is a column');
    const rows = [...html.matchAll(/<(?:button|a)\b([^>]*role="menuitem(?:checkbox)?"[^>]*)>([\s\S]*?)<\/(?:button|a)>/g)].map((match) => ({ attrs: match[1], label: visible(match[2]) }));
    assert.deepEqual(
      rows.map((row) => row.label),
      ['[ ♡ LIKE ]', '[ PLAY NEXT ]', '[ ADD TO QUEUE ]', '[ ATTACH TO POST ]', '[ COPY LINK ]', '[ GO TO WU TANG ]', '[ BARR ]'],
      'the order Luke reads down',
    );
    for (const row of rows) assert.match(row.attrs, /class="[^"]*\bblock w-full\b[^"]*\btext-left\b/, `${row.label} has the line to itself`);
  });

  await test('a visitor: told what an account buys, and no adding line; the queue keys still there', () => {
    viewer = null;
    library = freshLibrary({ canWrite: false, playlists: [] });
    const html = draw();
    assert.match(html, /\[ LOG IN \]<\/a> TO LIKE AND KEEP LISTS/);
    assert.doesNotMatch(html, /aria-label="Add to"|\[ PLAYLIST \]|LETTER \]|♡|\[ BARR \]/);
    assert.match(visible(html), /\[ PLAY NEXT \] \[ ADD TO QUEUE \]/);
  });

  await test('a song the archive does not hold: PLAYLIST stays in its place, switched off, and says why', () => {
    viewer = { id: 'u1' };
    library = freshLibrary();
    const html = draw({ fromShelf: false, track: { ...SONG, id: 'elsewhere', src: 'https://example.org/x.mp3' } });
    assert.match(html, /<button[^>]*disabled=""[^>]*data-add-to-playlist[^>]*>\[ PLAYLIST \]/);
    assert.match(visible(html), /NOT IN THE ARCHIVE :: NO LIKES OR LISTS/);
  });

  await test('over the player the answer line keeps its height while empty, so an answer never lifts the pressed key', () => {
    viewer = { id: 'u1' };
    library = freshLibrary();
    // Drawn in a row, the answer is below everything and may come and go.
    assert.doesNotMatch(draw(), /role="status"/);
    const over = draw({ placement: 'above', anchor: { current: null } });
    const line = /<p role="status"[^>]*>([^<]*)<\/p>/.exec(over);
    assert.ok(line, 'above the bar the line is always drawn');
    assert.ok(line[1] === String.fromCharCode(160) || line[1] === '&nbsp;', `a blank line that still has its height: ${JSON.stringify(line[1])}`);
  });

  /* 2. What adding to a playlist does (app/lib/audio/playlist-adding.ts) ----------------------------- */
  const thing = { title: 'GRAVEL PIT', link: { url: SONG.src, kind: 'audio', title: 'GRAVEL PIT' }, trackId: SONG.id };

  await test('the choices: every list, each saying whether it holds the song', () => {
    library = freshLibrary();
    assert.deepEqual(adding.playlistChoices(library, thing), [
      { id: 'p1', name: 'LATE NIGHT', holds: true },
      { id: 'p2', name: 'ROAD', holds: false },
    ]);
  });

  await test('a press puts it in, or takes it out, and says which', async () => {
    library = freshLibrary();
    said.length = 0;
    const [late, road] = adding.playlistChoices(library, thing);
    assert.equal(await adding.toggleInPlaylist(library, thing, road), 'added');
    assert.equal(await adding.toggleInPlaylist(library, thing, late), 'removed');
    assert.deepEqual(said, [['toggle', 'p2', SONG.id], ['toggle', 'p1', SONG.id]]);
  });

  await test('a new list is made with the song inside, once', async () => {
    library = freshLibrary();
    said.length = 0;
    assert.equal(await adding.addToNewPlaylist(library, thing, 'drive'), 'DRIVE');
    assert.deepEqual(said, [['save', 'drive'], ['toggle', 'p3', SONG.id]]);
    // A name already in use comes back as that list: a song it holds is not toggled out again.
    library = freshLibrary({ savePlaylist: async () => ({ id: 'p1', ownerId: 'u1', name: 'LATE NIGHT', createdAt: '', items: [{ trackId: SONG.id, addedAt: '' }] }) });
    said.length = 0;
    await adding.addToNewPlaylist(library, thing, 'late night');
    assert.deepEqual(said, []);
  });

  await test('a thing with no site song behind it (a video, a picture) is refused for now, not half-saved', async () => {
    library = freshLibrary();
    said.length = 0;
    const video = { title: 'A FILM', link: { url: 'https://archive.org/x.mp4', kind: 'file', title: 'A FILM' } };
    assert.equal(adding.holdable(video), false);
    assert.ok(adding.playlistChoices(library, video).every((choice) => choice.holds === false));
    await assert.rejects(adding.toggleInPlaylist(library, video, { id: 'p2', name: 'ROAD', holds: false }), /SITE SONGS ONLY/);
    await assert.rejects(adding.addToNewPlaylist(library, video, 'x'), /SITE SONGS ONLY/);
    assert.deepEqual(said, [], 'nothing was written, and no empty list was made');
  });

  if (failed > 0) {
    console.error(`\ncheck-song-menu: ${failed} FAILED`);
    process.exit(1);
  }
  console.log('\ncheck-song-menu: all passed');
})();
