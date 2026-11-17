/*
 * HISTORY (SPEC-history.md, Luke 2026-11-17): the log's arithmetic, the browser's copy, PAUSE, and the wiring, locally.
 *   npx tsc app/lib/history/sessions.ts app/lib/history/browser-plays.ts app/lib/history/plays.ts --rootDir app/lib --outDir Temp/history-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --jsx react-jsx
 *   node Temp/check-history.cjs
 *
 * - the same play pressed again within 60 s is one line; 61 s is two; the same room queue row stays one play for hours
 * - plays in a row in one room, under 30 minutes apart, fold into one session; a gap, another room or midnight splits it
 * - day headings read as log stamps: TODAY, YESTERDAY, the weekday, the year when it is another year
 * - the how line reads right for every way a play reaches you, and ADDED BY YOU / SOMEONE for yourself and a gone account
 * - the filters pick what they say
 * - the browser's copy (a visitor's, and the mock site's): one line per play, [ X ] removes one, ERASE removes all, the
 *   oldest go past its cap, where it stopped is kept
 * - PAUSE: with history paused, a play writes nothing
 * - from the files: no counts, likes, views or ratings in the table or the window; owner-only rules, no visitor grant, no
 *   clean-up job (kept forever, answer 4B); the shelf key sits under QUEUE; the window and the keeper are drawn once;
 *   PRIVACY's ERASE clears the log too; letters and posts say where a play came from
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

// A browser's storage, for the browser's copy and PAUSE.
const store = new Map();
global.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
};

const { samePlay, foldLog, logStamp, howLine, passes, placeOf } = require('./history-out/history/sessions.js');
const { createBrowserPlays } = require('./history-out/history/browser-plays.js');

const at = (text) => new Date(text).toISOString();
let n = 0;
const play = (fields) => ({
  id: `p${(n += 1)}`,
  kind: 'song',
  ref: '/assets/audio/a.mp3',
  title: 'A SONG',
  maker: '',
  picture: null,
  how: 'yourself',
  whereLabel: '',
  whereHref: null,
  addedBy: null,
  addedByName: '',
  roomId: null,
  queueEntryId: null,
  letterId: null,
  sourceRef: null,
  playedAt: at('2026-11-17T14:00:00'),
  stoppedAt: null,
  leftAtSeconds: null,
  lengthSeconds: null,
  ...fields,
});

(async () => {
  /* --- the same play ------------------------------------------------------------------------------- */
  const first = play({ playedAt: at('2026-11-17T14:00:00') });
  const t = Date.parse(first.playedAt);
  assert.equal(samePlay(first, { kind: 'song', ref: first.ref, how: 'yourself', roomId: null }, t + 59_000), true, 'pressed again within 60 s: one line');
  assert.equal(samePlay(first, { kind: 'song', ref: first.ref, how: 'yourself', roomId: null }, t + 61_000), false, 'after 60 s: a new line');
  assert.equal(samePlay(first, { kind: 'song', ref: first.ref, how: 'own_queue', roomId: null }, t + 1_000), false, 'reached another way: a new line');
  const roomPlay = play({ queueEntryId: 'row1', roomId: 'r1', how: 'room' });
  assert.equal(samePlay(roomPlay, { kind: 'song', ref: roomPlay.ref, how: 'room', roomId: 'r1', queueEntryId: 'row1' }, t + 2 * 3600_000), true, 'the same queue row after a reload: the same play');

  /* --- sessions and days -------------------------------------------------------------------------- */
  const now = new Date('2026-11-17T20:00:00');
  const log = [
    play({ roomId: 'r1', how: 'room', playedAt: at('2026-11-17T15:30:00') }),
    play({ roomId: 'r1', how: 'room', playedAt: at('2026-11-17T15:10:00') }),
    play({ roomId: 'r1', how: 'room', playedAt: at('2026-11-17T14:50:00') }),
    play({ roomId: 'r1', how: 'room', playedAt: at('2026-11-17T13:00:00') }), // over 30 minutes before: its own line
    play({ roomId: 'r2', how: 'room', playedAt: at('2026-11-17T12:50:00') }), // another room
    play({ playedAt: at('2026-11-17T12:40:00') }),
    play({ roomId: 'r3', how: 'room', playedAt: at('2026-11-17T00:10:00') }),
    play({ roomId: 'r3', how: 'room', playedAt: at('2026-11-16T23:55:00') }), // midnight splits it
    play({ playedAt: at('2026-11-14T10:00:00') }),
    play({ playedAt: at('2025-10-03T10:00:00') }),
  ];
  const days = foldLog(log, now);
  assert.deepEqual(days.map((day) => day.stamp), ['LOG 17.11 · TODAY', 'LOG 16.11 · YESTERDAY', 'LOG 14.11 · SAT', 'LOG 03.10.25'], 'log-stamp day headings');
  const today = days[0].entries;
  assert.deepEqual(today.map((entry) => (entry.kind === 'session' ? `session:${entry.plays.length}` : `play:${entry.play.roomId ?? '-'}`)), ['session:3', 'play:r1', 'play:r2', 'play:-', 'play:r3'], 'three in a row fold; a 30-minute gap, another room and a lone play stay lines');
  assert.equal(days[1].entries.length, 1, 'a session never crosses midnight');
  // Code review, 2026-11-17: every play the keeper notes has a room, so only a play the room put on may join a session.
  const mixed = foldLog(
    [
      play({ roomId: 'own', how: 'own_queue', playedAt: at('2026-11-17T16:10:00') }),
      play({ roomId: 'own', how: 'letter', letterId: 'l1', playedAt: at('2026-11-17T16:05:00') }),
      play({ roomId: 'own', how: 'yourself', whereLabel: 'MEDIA', playedAt: at('2026-11-17T16:00:00') }),
    ],
    now,
  );
  assert.deepEqual(mixed[0].entries.map((entry) => entry.kind), ['play', 'play', 'play'], 'a letter or MEDIA play in your room keeps its own line');
  assert.equal(logStamp(new Date('2026-11-17T09:00:00'), now), 'LOG 17.11 · TODAY');

  /* --- the how line -------------------------------------------------------------------------------- */
  const how = (fields) => howLine(play(fields), 'me');
  assert.equal(how({ how: 'yourself', whereLabel: 'MEDIA' }), 'YOU PLAYED IT · FROM MEDIA');
  assert.equal(how({ how: 'own_queue' }), 'YOUR QUEUE · ADDED BY YOU');
  assert.equal(how({ how: 'room', whereLabel: "MIA'S ROOM", addedBy: 'jo', addedByName: 'Jo' }), "IN MIA'S ROOM · ADDED BY JO");
  assert.equal(how({ how: 'room', whereLabel: 'YOUR ROOM', addedBy: 'me' }), 'IN YOUR ROOM · ADDED BY YOU');
  assert.equal(how({ how: 'room', whereLabel: "MIA'S ROOM", addedBy: null, addedByName: '' }), "IN MIA'S ROOM · ADDED BY SOMEONE", 'a gone account reads SOMEONE');
  assert.equal(how({ how: 'letter', addedByName: 'Mia' }), 'FROM A LETTER BY MIA');
  assert.equal(how({ how: 'comment', addedByName: 'Jo' }), 'FROM A COMMENT BY JO');
  assert.equal(how({ how: 'post', addedByName: 'Jo' }), 'FROM A POST BY JO');
  assert.equal(how({ how: 'profile', addedByName: 'Mia' }), "ON MIA'S PROFILE");
  assert.equal(how({ how: 'playlist', addedByName: 'Mia' }), "FROM MIA'S PLAYLIST");
  assert.equal(how({ how: 'reader' }), 'READ IN THE READER');
  assert.equal(how({ how: 'not_recorded' }), 'HOW: NOT RECORDED');
  assert.equal(placeOf(187), '3:07');
  assert.equal(placeOf(0), null);

  /* --- the filters --------------------------------------------------------------------------------- */
  assert.equal(passes(play({ kind: 'video' }), 'video'), true);
  assert.equal(passes(play({ kind: 'song' }), 'video'), false);
  assert.equal(passes(play({ kind: 'book', how: 'reader' }), 'books'), true);
  assert.equal(passes(play({ roomId: 'r1', how: 'room' }), 'rooms'), true);
  assert.equal(passes(play({ how: 'letter' }), 'letters'), true);
  assert.equal(passes(play({ how: 'yourself' }), 'letters'), false);

  /* --- the browser's copy -------------------------------------------------------------------------- */
  const browser = createBrowserPlays('check.plays', 3);
  const note = { kind: 'song', ref: '/assets/audio/b.mp3', title: 'B', maker: 'X', how: 'yourself', whereLabel: 'MEDIA' };
  const id = await browser.note(note);
  assert.equal(await browser.note(note), id, 'pressed again at once: the same line');
  assert.equal((await browser.list(10)).length, 1);
  await browser.stop(id, 42.4, 200);
  const stopped = (await browser.list(10))[0];
  assert.equal(stopped.leftAtSeconds, 42, 'where it stopped is kept');
  assert.equal(stopped.lengthSeconds, 200);
  for (const ref of ['c', 'd', 'e']) await browser.note({ ...note, ref: `/assets/audio/${ref}.mp3` });
  assert.equal((await browser.list(10)).length, 3, 'the oldest go past the cap');
  assert.ok(!(await browser.list(10)).some((line) => line.id === id), 'the oldest went first');
  const [newest] = await browser.list(10);
  await browser.remove(newest.id);
  assert.equal((await browser.list(10)).length, 2, '[ X ] removes one line');
  await browser.erase();
  assert.equal((await browser.list(10)).length, 0, 'ERASE removes them all');

  /* --- PAUSE --------------------------------------------------------------------------------------- */
  // The mock site: no Supabase, so the log is this browser's and PAUSE is FOR YOU's mock switch.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const plays = require('./history-out/history/plays.js');
  await plays.setPlaysPaused(true);
  plays.notePlay({ ...note, ref: '/assets/audio/paused.mp3' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await plays.readPlays(10)).length, 0, 'paused: nothing written');
  await plays.setPlaysPaused(false);
  plays.notePlay({ ...note, ref: '/assets/audio/resumed.mp3' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await plays.readPlays(10)).length, 1, 'resumed: written again');

  /* --- the files ----------------------------------------------------------------------------------- */
  const read = (file) => fs.readFileSync(file, 'utf8');
  const migration = read('supabase/migrations/20261117022630_user_plays.sql');
  const columns = /create table if not exists public\.user_plays \(([\s\S]*?)\n\);/.exec(migration)[1];
  assert.doesNotMatch(columns, /count|views|likes|rating|popular/i, 'no counts, likes, views or ratings in the table');
  assert.match(migration, /references auth\.users \(id\) on delete cascade/, 'deleted with the account');
  assert.match(migration, /for select to authenticated using \(person = auth\.uid\(\)\)/, 'only the owner reads');
  assert.match(migration, /grant select, insert, update, delete on public\.user_plays to authenticated;/, 'accounts only');
  assert.doesNotMatch(migration, /grant [^;]*on public\.user_plays to anon/, 'no visitor grant');
  assert.match(migration, /not \(select public\.history_paused\(\)\)/, 'the database refuses a paused history');
  assert.match(migration, /not \(select public\.is_guest\(\)\)/, 'and a guest');
  assert.doesNotMatch(migration, /delete from public\.user_plays where/, 'kept forever: no clean-up job');
  const windowFile = read('app/components/HistoryWindow.tsx');
  assert.doesNotMatch(windowFile, /\blikes\b|\bviews\b|\brating/i, 'the window shows no likes, views or ratings');
  const sidebar = read('app/components/DesktopSidebar.tsx');
  assert.match(sidebar, /<ShelfKey item=\{SIDE_QUEUES\}[^\n]*\n\s*<ShelfKey item=\{SIDE_HISTORY\}/, 'HISTORY sits right under QUEUE on the shelf');
  const layout = read('app/layout.tsx');
  assert.match(layout, /<HistoryWindow \/>/, 'the window is drawn once in the layout');
  assert.match(layout, /<PlayHistoryKeeper \/>/, 'and the keeper');
  assert.match(read('app/components/HistoryPanel.tsx'), /erasePlays\(\)/, "PRIVACY's ERASE clears the log too");
  assert.match(read('app/components/LetterWindow.tsx'), /armPlayContext\(\{ how: 'letter'/, 'a letter says where its play came from');
  assert.match(read('app/components/InlineTrackPlayer.tsx'), /armPlayContext\(\{ how: 'post'/, 'and a post');
  assert.match(read('app/components/reader/ReaderPage.tsx'), /notePlay\(\{ kind: 'book'/, 'a book opened in the reader is a play');

  console.log('check-history: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
