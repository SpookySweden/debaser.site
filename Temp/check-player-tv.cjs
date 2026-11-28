/*
 * The little TV in the player bar (SPEC-player-tv.md): its rules, without a browser.
 *   npx tsc app/lib/player-tv/source.ts app/lib/character/motion.ts app/lib/character/rig.ts --outDir Temp/player-tv-check --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-player-tv.cjs
 *
 * What it holds:
 *   - which video gets what: a file of the page's own the moving picture, YouTube its stills, any other site's player a
 *     dark screen; a song, a held picture, an ended video and a file with no picture get no TV;
 *   - one TV: the video that is playing, else the floating player's;
 *   - the stills change at the thirds of the video, and turn about when its length is not known;
 *   - the crawl down to the TV is only turns of the owner's own joints, stays inside the picture box the other motions
 *     already need, and every motion there was before it comes out exactly as it did.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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

// --- the crawl -------------------------------------------------------------------------------------------------------
const motion = require(path.join(OUT, 'character', 'motion.js'));
const { buildDefaultFigure, RIG_PRESET_IDS } = require(path.join(OUT, 'character', 'rig.js'));
const { rotateVec } = require(path.join(OUT, 'character', 'turns.js'));

const BEFORE = ['stand', 'idle', 'walk', 'dance1', 'dance2', 'dance3', 'wave', 'hop', 'turn', 'sit', 'sleep', 'stretch', 'dance4', 'dance5', 'run', 'cheer', 'slump', 'dangle', 'land', 'curl', 'watch', 'read', 'flick', 'type', 'climb', 'lifted', 'catch', 'flung', 'splat', 'dizzy'];
// Fingerprints of those motions and of every posed frame the bake draws from them, taken before the crawl was written.
const AS_BEFORE = { base: 'fe7387c190823df9', goblin: 'dca383991564a0c6', robot: '640fc8642f1a2d31', guy: '7d6675b717cb6e8b' };
const round = (value) => JSON.stringify(value, (key, x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x));

/** The box round one drawn frame, as the bake measures it. */
function box(drawn, into) {
  for (const { shape, placement } of drawn) {
    const h = { x: shape.size.x / 2, y: shape.size.y / 2, z: shape.size.z / 2 };
    const turned = [{ x: h.x, y: 0, z: 0 }, { x: 0, y: h.y, z: 0 }, { x: 0, y: 0, z: h.z }].map((v) => rotateVec(placement.rotation, v));
    for (const axis of ['x', 'y']) {
      const half = turned.reduce((sum, v) => sum + Math.abs(v[axis]), 0);
      into[axis][0] = Math.min(into[axis][0], placement.position[axis] - half);
      into[axis][1] = Math.max(into[axis][1], placement.position[axis] + half);
    }
  }
  return into;
}
const empty = () => ({ x: [Infinity, -Infinity], y: [Infinity, -Infinity] });

assert.ok(motion.MOTION_IDS.includes('crawl'), 'there is a crawl');
assert.ok(motion.CORE_MOTION_IDS.includes(motion.MOTION_FALLBACK.crawl), 'an older strip plays one of the first set instead');

for (const preset of RIG_PRESET_IDS) {
  const figure = buildDefaultFigure(preset);
  const motions = motion.motionsFor(preset);
  const posed = (id) => motions[id].frames.map((frame) => motion.posedPlacements(figure, frame, motion.frameYaw(motions[id], frame)));

  const hash = crypto.createHash('sha256');
  const rest = empty();
  for (const id of BEFORE) {
    hash.update(id + round(motions[id]));
    for (const drawn of posed(id)) {
      hash.update(round(drawn));
      box(drawn, rest);
    }
  }
  assert.equal(hash.digest('hex').slice(0, 16), AS_BEFORE[preset], `${preset}: the motions from before are as they were`);

  const joints = new Set(Object.keys(figure.skeleton.joints));
  const crawl = motions.crawl;
  assert.ok(crawl.loop && crawl.frames.length >= 4, `${preset}: the crawl loops over a few frames`);
  for (const frame of crawl.frames) {
    assert.deepEqual(Object.keys(frame).filter((key) => !['joints', 'root', 'yaw', 'hold'].includes(key)), []);
    for (const joint of Object.keys(frame.joints ?? {})) assert.ok(joints.has(joint), `${preset}: crawl turns ${joint}, which it has`);
  }
  assert.ok(new Set(crawl.frames.map(round)).size >= 3, `${preset}: the crawl moves`);
  if (preset === 'guy') assert.ok(crawl.frames.every((frame) => frame.joints['arm.left'] && frame.joints['arm.right']), 'GUY crawls with its arms');

  const own = empty();
  for (const drawn of posed('crawl')) box(drawn, own);
  assert.ok(own.x[0] >= rest.x[0] - 1e-6 && own.x[1] <= rest.x[1] + 1e-6, `${preset}: no wider than the others need (${own.x} in ${rest.x})`);
  assert.ok(own.y[0] >= rest.y[0] - 1e-6 && own.y[1] <= rest.y[1] + 1e-6, `${preset}: no taller than the others need (${own.y} in ${rest.y})`);
}

console.log('check-player-tv: all passed');
