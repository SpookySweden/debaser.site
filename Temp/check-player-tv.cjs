/*
 * The little TV in the player bar (SPEC-player-tv.md): its rules, without a browser.
 *   npx tsc app/lib/player-tv/source.ts --outDir Temp/player-tv-check --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-player-tv.cjs
 *
 * What it holds:
 *   - which video gets what: a file of the page's own the moving picture, YouTube its stills, any other site's player a
 *     dark screen; a song, a held picture, an ended video and a file with no picture get no TV;
 *   - one TV: the video that is playing, else the floating player's;
 *   - the stills change at the thirds of the video, and turn about when its length is not known.
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, 'player-tv-check');
const { tvShows, stillIndex, frameYoutubeId, STILL_SECONDS } = require(path.join(OUT, 'player-tv', 'source.js'));

const ID = 'dQw4w9WgXcQ';
const file = { ready: true, width: 640 };
const room = (over) => ({ playing: true, ended: false, youtubeId: null, file, ...over });
const float = (over) => ({ playing: true, kind: 'file', shape: 'video', src: '/clip.webm', ended: false, file, ...over });
const frame = (src) => float({ kind: 'frame', src, file: null });
const picture = (shows) => (shows === null ? null : shows.picture);

// A file of the page's own moves on the screen.
assert.equal(picture(tvShows(room(), null)), 'video');
assert.equal(picture(tvShows(null, float())), 'video');

// YouTube: its stills, from either player.
assert.deepEqual(tvShows(room({ youtubeId: ID, file: null }), null), { from: 'room', picture: 'stills', youtubeId: ID });
assert.deepEqual(tvShows(null, frame(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1`)), { from: 'float', picture: 'stills', youtubeId: ID });
assert.equal(frameYoutubeId('https://www.youtube.com/embed/videoseries?list=PL123'), null);

// Any other site's player: dark.
assert.equal(picture(tvShows(room({ file: null }), null)), 'dark');
assert.equal(picture(tvShows(null, frame('https://player.vimeo.com/video/76979871'))), 'dark');
assert.equal(picture(tvShows(null, frame('not an address'))), 'dark');

// Not a video: no TV.
assert.equal(tvShows(null, null), null);
assert.equal(tvShows(null, float({ shape: 'audio' })), null);
assert.equal(tvShows(null, float({ kind: 'picture', shape: 'picture', file: null })), null);
assert.equal(tvShows(room({ ended: true }), null), null);
assert.equal(tvShows(room({ ended: true, youtubeId: ID, file: null }), null), null);
assert.equal(tvShows(null, float({ ended: true })), null);
assert.equal(tvShows(room({ file: { ready: true, width: 0 } }), null), null, 'sound only in a <video>');
assert.equal(tvShows(room({ file: { ready: false, width: 0 } }), null), null, 'nothing known yet');
assert.equal(tvShows(null, float({ file: null })), null);

// One TV: the one playing; both or neither, the float (as the bar names it); either alone.
assert.equal(tvShows(room(), float()).from, 'float');
assert.equal(tvShows(room(), float({ playing: false })).from, 'room');
assert.equal(tvShows(room({ playing: false }), float({ playing: false })).from, 'float');
assert.equal(tvShows(room(), float({ shape: 'audio' })).from, 'room');
assert.equal(tvShows(room({ ended: true }), float({ playing: false })).from, 'float');

// The stills: thirds of the video, else turn about.
assert.deepEqual([0, 99, 100, 199, 200, 300].map((s) => stillIndex(s, 300, 0)), [0, 0, 1, 1, 2, 2]);
assert.deepEqual(
  [0, STILL_SECONDS - 1, STILL_SECONDS, STILL_SECONDS * 2, STILL_SECONDS * 3].map((s) => stillIndex(0, Number.NaN, s)),
  [0, 0, 1, 2, 0],
);

console.log('check-player-tv: all passed');
