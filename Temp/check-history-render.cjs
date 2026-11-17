/*
 * HISTORY on screen (SPEC-history.md, Luke 2026-11-17): the window as it first draws, and the keeper's rule for how a play
 * reached you. (The log's arithmetic is check-history.cjs; who may read the table is check-history-live.cjs.) From the root:
 *   npx tsc app/components/HistoryWindow.tsx app/components/PlayHistoryKeeper.tsx --rootDir app --outDir Temp/history-render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-history-render.cjs
 *
 * - shut, the window draws nothing; its inside has PAUSE, the six filters and ERASE, and reads the log first
 * - the keeper draws nothing
 * - a row in your own room you added as it started: YOU PLAYED IT, with where you pressed it; added earlier: YOUR QUEUE
 * - a row someone else added in your room: IN YOUR ROOM; a row in someone's room: IN <THEIR> ROOM, or the room's name
 * - a play a letter armed: FROM A LETTER, with the letter; a profile song: ON <NAME>'S PROFILE; a picture is not a play
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const el = React.createElement;
const OUT = path.join(__dirname, 'history-render-out');

function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

stub(path.join(OUT, 'components/AuthProvider.js'), { useAuth: () => ({ status: 'anonymous', user: null }) });
stub(path.join(OUT, 'components/DockWindow.js'), { default: ({ title, status, children }) => el('section', { 'data-window': title, 'data-status': status }, children) });
const player = { track: undefined, heardFrom: null, queue: [], room: null, playing: false, audioElement: () => null, play: () => undefined };
stub(path.join(OUT, 'components/MusicPlayerProvider.js'), { useMusicPlayer: () => player });
stub(path.join(OUT, 'lib/watch/use-watch-room.js'), { useWatchRoom: () => ({ read: undefined, error: null }) });
stub('next/navigation', { useSearchParams: () => new URLSearchParams(''), usePathname: () => '/forum', useRouter: () => ({ replace: () => undefined, push: () => undefined }) });

const { default: HistoryWindow, HistoryLog } = require('./history-render-out/components/HistoryWindow.js');
const keeper = require('./history-render-out/components/PlayHistoryKeeper.js');
const { closeHistory } = require('./history-render-out/lib/history/history-window.js');
const { armPlayContext } = require('./history-render-out/lib/history/plays.js');

/* --- the window ------------------------------------------------------------------------------------ */
closeHistory();
assert.equal(renderToStaticMarkup(el(HistoryWindow)), '', 'shut, it draws nothing');
// Server rendering always sees the window shut (its server state), so its inside is drawn on its own.
const html = renderToStaticMarkup(el(HistoryLog));
assert.match(html, /aria-label="Your history"/, 'the log');
assert.match(html, /\[ PAUSE \]/, 'PAUSE');
for (const word of ['ALL', 'MUSIC', 'VIDEO', 'BOOKS', 'ROOMS', 'LETTERS']) assert.match(html, new RegExp(`\\[ ${word} \\]`), `the ${word} filter`);
assert.match(html, /\[ ERASE \]/, 'ERASE');
assert.match(html, /READING YOUR LOG/, 'it reads the log first');
assert.match(html, /aria-pressed="true"[^>]*data-history-filter="all"/, 'ALL is on to start');
closeHistory();
assert.equal(renderToStaticMarkup(el(keeper.default)), '', 'the keeper draws nothing');
console.log('  ok    the window and the keeper draw');

/* --- how a play reached you ------------------------------------------------------------------------ */
const NOW = Date.parse('2026-11-17T14:00:00Z');
const room = (fields) => ({ id: 'own', originalHostId: 'me', originalHostLabel: 'Luke', hostId: 'me', name: null, isPlaying: true, positionSeconds: 0, updatedAt: new Date(NOW).toISOString(), ...fields });
const row = (fields) => ({ id: 'q1', roomId: 'own', link: { url: 'https://example.com/a.mp3', kind: 'audio', title: 'A SONG' }, mediaItemId: null, addedBy: 'me', addedAt: new Date(NOW - 2000).toISOString(), playedAt: new Date(NOW).toISOString(), ...fields });
const note = (entry, inRoom, onBar = {}) => keeper.noteForRow(entry, inRoom, { track: undefined, heardFrom: null, ...onBar }, 'own', 'me', NOW);

const bar = { track: { src: 'https://example.com/a.mp3', title: 'A SONG', credit: 'X', length: '3:00' }, heardFrom: { origin: 'shelf', where: 'MEDIA', href: '/media' } };
const pressed = note(row({}), room({}), bar);
assert.equal(pressed.how, 'yourself', 'added as it started: you played it');
assert.equal(pressed.whereLabel, 'MEDIA', 'with where you pressed it');
assert.equal(pressed.kind, 'song');
assert.equal(pressed.maker, 'X', 'the credit the bar shows');
assert.equal(pressed.queueEntryId, 'q1');
assert.equal(note(row({ addedAt: new Date(NOW - 600_000).toISOString() }), room({})).how, 'own_queue', 'added earlier: your queue');
const theirs = note(row({ addedBy: 'jo' }), room({}));
assert.equal(theirs.how, 'room');
assert.equal(theirs.whereLabel, 'YOUR ROOM', 'someone who joined added it: in your room');
assert.equal(note(row({ addedBy: 'jo' }), room({ id: 'mia', originalHostLabel: 'Mia' })).whereLabel, "MIA'S ROOM", "in someone's room");
assert.equal(note(row({ addedBy: 'jo' }), room({ id: 'mia', name: 'Night drives' })).whereLabel, 'NIGHT DRIVES', 'or by its name');
armPlayContext({ how: 'letter', letterId: 'l1', addedBy: 'mia', addedByName: 'Mia', whereLabel: 'SUMMER' });
const fromLetter = note(row({}), room({}), bar);
assert.equal(fromLetter.how, 'letter', 'a play the letter armed is from the letter');
assert.equal(fromLetter.letterId, 'l1');
assert.equal(note(row({}), room({}), bar).how, 'yourself', 'and only the one play');
const profile = note(row({}), room({}), { ...bar, heardFrom: { origin: 'profile', where: 'THE PROFILE OF MIA', href: '/profile/mia' } });
assert.equal(profile.how, 'profile');
assert.equal(profile.addedByName, 'MIA', "ON MIA'S PROFILE");
assert.equal(note(row({ link: { url: 'https://example.com/p.png', kind: 'picture', title: 'P' } }), room({})), null, 'a picture is not a play');
const video = note(row({ link: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', kind: 'youtube', title: 'V' } }), room({}));
assert.equal(video.kind, 'video');
assert.equal(video.picture, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg', "a YouTube video's own thumbnail, hotlinked");
console.log('  ok    how a play reached you');
console.log('check-history-render: ok');
