/**
 * Finding a video's black bars, and trimming them (SPEC-rooms-your-room.md, part 4; Luke, 2026-11-16: "i want you to find a
 * way to auto detect the bars for every video", and the `[ BKG ]` toggle).
 *
 * Held here, with no browser, on made-up pictures:
 *   1. one picture: bars above and below, either side, all round, speckled by compression; none on a plain picture;
 *      "cannot tell" for a dark scene and for darkness inside bars; and black edges with no line where picture begins
 *      (a title on a black card, a lit subject on a dark stage) read as soft, not as bars;
 *   2. several pictures: enough must show the same hard edge, and none may show anything inside it (subtitles sitting in a
 *      bar, one picture that fills the frame); an edge counts only with its opposite; slivers are left; a limit;
 *   2b. a file watched as it plays: nothing trimmed until enough looks agree, a trim held through dark scenes, let go for
 *      good when something shows in a bar, and the watching stopped when the browser will not hand pixels over;
 *   3. the arithmetic of trimming: the shape of what is left, a frame hung so its bars fall outside its box, and the styles
 *      the stylesheet and a `<video>` are given;
 *   4. where YouTube's stills are, and that the players, the toggle and the stylesheet use all this.
 *
 * What only a browser can show (stills read, a real file read, the picture's real place on the screen, the key) is in
 * `scripts/drive-rooms-your-room.cjs`.
 *
 * Compiled fresh on every run:
 *   npx tsc app/lib/watch/video-bars.ts app/lib/watch/video-shape.ts app/lib/watch/bar-watch.ts app/lib/ui/stage-bkg.ts --rootDir app --outDir Temp/video-bars-out --module commonjs --target es2020 --lib es2020,dom,dom.iterable --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'video-bars-out', 'lib');
const B = require(path.join(OUT, 'watch', 'video-bars.js'));
const S = require(path.join(OUT, 'watch', 'video-shape.js'));
const W = require(path.join(OUT, 'watch', 'bar-watch.js'));
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const close = (a, b, slack = 1e-6) => Math.abs(a - b) <= slack;

const seeded = (seed) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

/**
 * A made-up still, `w` by `h`: black bars `bars` pixels deep on each edge, and inside them a picture whose brightness is
 * `inside(x, y)`. `speckle` puts the compression's noise in the bars: dim everywhere, and a bright dot now and then.
 * `over(x, y)` draws on top of everything, bars too (subtitles), where it answers a number.
 */
function picture(w, h, bars, inside = () => 150, speckle = 0, over = () => null) {
  const random = seeded(7);
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const bar = y < bars.top || y >= h - bars.bottom || x < bars.left || x >= w - bars.right;
      let value = bar ? Math.floor(random() * 14) : inside(x, y);
      if (bar && speckle > 0 && random() < speckle) value = 90;
      const drawn = over(x, y);
      if (drawn !== null) value = drawn;
      const at = (y * w + x) * 4;
      pixels[at] = value;
      pixels[at + 1] = value;
      pixels[at + 2] = value;
      pixels[at + 3] = 255;
    }
  }
  return pixels;
}
const edges = (top = 0, right = 0, bottom = 0, left = 0) => ({ top, right, bottom, left });
const [Wd, Ht] = [320, 180];
const none = { depth: 0, firm: false };
const depths = (bars) => [bars.top.depth, bars.right.depth, bars.bottom.depth, bars.left.depth];
const firms = (bars) => [bars.top.firm, bars.right.firm, bars.bottom.firm, bars.left.firm];

/* --- 1. one picture -------------------------------------------------------------------------------------------------- */
assert.deepEqual(B.readBars(picture(Wd, Ht, edges()), Wd, Ht), { top: none, right: none, bottom: none, left: none }, 'a picture with no bars has none');

const wide = B.readBars(picture(Wd, Ht, edges(23, 0, 23, 0)), Wd, Ht);
assert.ok(close(wide.top.depth, 24 / Ht) && close(wide.bottom.depth, 24 / Ht) && wide.left.depth === 0 && wide.right.depth === 0, 'a wide film in a 16:9 file: bars above and below, one line more than counted (the smeared one)');
assert.ok(wide.top.firm && wide.bottom.firm, 'and picture starts hard against them');

const old = B.readBars(picture(Wd, Ht, edges(0, 40, 0, 40)), Wd, Ht);
assert.ok(close(old.left.depth, 41 / Wd) && close(old.right.depth, 41 / Wd) && old.top.depth === 0 && old.bottom.depth === 0 && old.left.firm && old.right.firm, 'a 4:3 video in a 16:9 player: bars either side');

const boxed = B.readBars(picture(Wd, Ht, edges(20, 36, 20, 36)), Wd, Ht);
assert.deepEqual(depths(boxed).map((depth) => depth.toFixed(4)), [21 / Ht, 37 / Wd, 21 / Ht, 37 / Wd].map((depth) => depth.toFixed(4)), 'bars all round');
assert.deepEqual(firms(boxed), [true, true, true, true], 'all four with picture hard against them (measured within the picture, not across the bars beside it)');

const noisy = B.readBars(picture(Wd, Ht, edges(23, 0, 23, 0), () => 150, 0.008), Wd, Ht);
assert.ok(close(noisy.top.depth, 24 / Ht) && close(noisy.bottom.depth, 24 / Ht), "the compression's speckle in a bar does not hide it");

assert.equal(B.readBars(picture(Wd, Ht, edges(), () => 6), Wd, Ht), null, 'a dark scene cannot be judged');
assert.equal(B.readBars(picture(Wd, Ht, edges(23, 0, 23, 0), () => 8), Wd, Ht), null, 'nor darkness inside bars');
assert.equal(B.readBars(picture(Wd, Ht, edges(23, 0, 23, 0), (x) => (x % 7 === 0 ? 120 : 10)), Wd, Ht), null, 'nor a picture that is nearly all shadow');
assert.equal(B.readBars(new Uint8ClampedArray(16), 2, 2), null, 'nor a picture too small to be one');
assert.equal(B.readBars(new Uint8ClampedArray(10), Wd, Ht), null, 'nor pixels that are not all there');

const sky = B.readBars(picture(Wd, Ht, edges(40, 0, 0, 0)), Wd, Ht);
assert.ok(sky.top.depth > 0.2 && sky.bottom.depth === 0, 'black along one edge only is read as it is (and is no pair: below)');

// Black edges that are not bars: nothing starts hard against them.
const titleCard = B.readBars(picture(Wd, Ht, edges(), (x, y) => (x >= 100 && x < 220 && y >= 70 && y < 110 && (x + y) % 3 === 0 ? 230 : 4)), Wd, Ht);
assert.ok(titleCard !== null && depths(titleCard).every((depth) => depth > 0.2), 'a title on a black card has black on every edge');
assert.deepEqual(firms(titleCard), [false, false, false, false], 'and no edge where picture begins: its letters do not make a line');
const onStage = B.readBars(picture(Wd, Ht, edges(), (x, y) => (((x - 160) / 70) ** 2 + ((y - 90) / 55) ** 2 <= 1 ? 170 : 3)), Wd, Ht);
assert.ok(onStage !== null && depths(onStage).every((depth) => depth > 0.1), 'a lit subject on a dark stage has black on every edge');
assert.deepEqual(firms(onStage), [false, false, false, false], 'and none of them is a line either: the subject is round');
const cover = B.readBars(picture(Wd, Ht, edges(0, 70, 0, 70)), Wd, Ht);
assert.ok(cover.left.firm && cover.right.firm && close(cover.left.depth, 71 / Wd), 'a square picture in a wide frame has hard edges: those are bars');

/* --- 2. several pictures ---------------------------------------------------------------------------------------------- */
/** A read by its depths: every edge that has black is firm unless `firm` is false. */
const bar = (top, bottom = top, left = 0, right = left, firm = true) => {
  const edge = (depth) => ({ depth, firm: depth > 0 && firm });
  return { top: edge(top), right: edge(right), bottom: edge(bottom), left: edge(left) };
};
const soft = (top, bottom = top, left = 0, right = left) => bar(top, bottom, left, right, false);
const UNSPOILT = { x: false, y: false };

assert.deepEqual(B.agreeBars([bar(0.13), bar(0.13), bar(0.13)], 2), { x: 0, y: 0.13 }, 'three stills that agree');
assert.deepEqual(B.agreeBars([bar(0.13), null, bar(0.13)], 2), { x: 0, y: 0.13 }, 'a still too dark to tell is not counted');
assert.deepEqual(B.agreeBars([bar(0.13), null, null], 2), B.NO_TRIM, 'and with too few left, nothing is trimmed');
assert.deepEqual(B.agreeBars([null, null, null], 1), B.NO_TRIM, 'nor with none');
assert.deepEqual(B.agreeBars([], 1), B.NO_TRIM);
assert.deepEqual(B.agreeBars([bar(0.13)], 1), { x: 0, y: 0.13 }, 'one picture is enough where one is all there is (Vimeo)');

// Black edges with nothing hard against them are never bars, however many pictures show them.
assert.deepEqual(B.judgeBars([titleCard, titleCard, titleCard], 2), { trim: B.NO_TRIM, spoilt: UNSPOILT }, 'three stills of a title card trim nothing');
assert.deepEqual(B.judgeBars([onStage, onStage, onStage], 1), { trim: B.NO_TRIM, spoilt: UNSPOILT }, 'nor three of a subject on a dark stage');
assert.deepEqual(B.agreeBars([soft(0.3), soft(0.3), soft(0.3)], 1), B.NO_TRIM, 'soft edges alone are nothing');
assert.deepEqual(B.agreeBars([bar(0.13), bar(0.13), soft(0.22)], 2), { x: 0, y: 0.13 }, 'a dark scene among real bars (black running deeper, no hard edge) does not spoil them');
assert.deepEqual(B.agreeBars([bar(0.13), soft(0.22), soft(0.22)], 2), B.NO_TRIM, 'but one hard edge among dark scenes is not enough');
assert.deepEqual(B.judgeBars([bar(0.13), bar(0.21)], 2), { trim: B.NO_TRIM, spoilt: UNSPOILT }, 'hard edges at different depths are not one bar');
assert.deepEqual(B.judgeBars([cover, cover, cover], 2).trim, { x: 71 / Wd, y: 0 }, 'a square picture in a wide frame is trimmed to the square');

// Anything inside a bar spoils it: trimming would trim that too.
assert.deepEqual(B.judgeBars([bar(0.13), bar(0.13), soft(0.13, 0.04)], 2), { trim: B.NO_TRIM, spoilt: { x: false, y: true } }, 'subtitles sitting in the lower bar of one still: nothing is trimmed above or below, and it is known why');
assert.deepEqual(B.judgeBars([bar(0.12), bar(0.12), bar(0)], 2), { trim: B.NO_TRIM, spoilt: { x: false, y: true } }, 'one still that fills the frame: there is no bar');
assert.deepEqual(B.agreeBars([bar(0.12), bar(0)], 1), B.NO_TRIM, 'two stills, one with a bar and one without, do not meet in the middle');
assert.deepEqual(B.judgeBars([bar(0.1, 0.1, 0.12), bar(0.1, 0.1, 0.12), bar(0.1, 0.1, 0)], 2), { trim: { x: 0, y: 0.1 }, spoilt: { x: true, y: false } }, 'a pair of edges is spoilt by itself: the other pair is still trimmed');

assert.deepEqual(B.agreeBars([sky, sky, sky], 2), B.NO_TRIM, 'black along one edge only is not a bar: a bar has its opposite');
assert.deepEqual(B.agreeBars([bar(0.2, 0.08), bar(0.2, 0.08)], 2), B.NO_TRIM, 'nor two edges of very different depth');
assert.deepEqual(B.agreeBars([bar(0.13, 0.12), bar(0.13, 0.12)], 2), { x: 0, y: 0.12 }, 'a pair a little uneven takes the smaller from both: never more than is bar');
assert.deepEqual(B.agreeBars([bar(0.02), bar(0.02)], 2), B.NO_TRIM, 'a sliver is left alone');
assert.deepEqual(B.agreeBars([bar(0, 0, 0.125), bar(0, 0, 0.125)], 2), { x: 0.125, y: 0 }, 'bars either side');
assert.deepEqual(B.agreeBars([bar(0.1, 0.1, 0.12), bar(0.1, 0.1, 0.12)], 2), { x: 0.12, y: 0.1 }, 'and all round');
assert.ok(B.agreeBars([bar(0, 0, 0.48), bar(0, 0, 0.48)], 2).x <= 0.42, 'never more than the limit from one edge');
{
  // From pixels to a trim: three made-up stills of a wide film.
  const film = (moment, over) => B.readBars(picture(Wd, Ht, edges(23, 0, 23, 0), (x, y) => 110 + ((x * 3 + y * 5 + moment * 40) % 90), 0.004, over), Wd, Ht);
  const clean = B.judgeBars([film(0), film(1), film(2)], 2);
  assert.ok(close(clean.trim.y, 24 / Ht) && clean.trim.x === 0 && !clean.spoilt.y, 'three stills of a wide film: its bars, and nothing else');
  assert.ok(Math.abs(B.trimmedShape(16 / 9, clean.trim) - 2.42) < 0.03, 'and what is left is the film');
  // The same film with a line of subtitles written in its lower bar in one still.
  const written = film(1, (x, y) => (y >= 165 && y < 172 && x >= 100 && x < 220 && (x + y) % 2 === 0 ? 235 : null));
  assert.deepEqual(B.judgeBars([film(0), written, film(2)], 2), { trim: B.NO_TRIM, spoilt: { x: false, y: true } }, 'with subtitles in its lower bar in one of them, the bars are left on');
}
assert.ok(B.hasTrim({ x: 0, y: 0.1 }) && B.hasTrim({ x: 0.1, y: 0 }) && !B.hasTrim(B.NO_TRIM));
assert.ok(B.sameTrim({ x: 0.1, y: 0.1 }, { x: 0.102, y: 0.1 }) && !B.sameTrim({ x: 0.1, y: 0.1 }, { x: 0.12, y: 0.1 }), 'a hair of difference is the same trim; more is not');

/* --- 2b. a file watched as it plays ------------------------------------------------------------------------------------- */
{
  // The least of a browser the watcher needs: a canvas that hands back whatever the "video" is showing, and timers run by hand.
  const [w, h] = [160, 90];
  const scenes = {
    film: picture(w, h, edges(12, 0, 12, 0), (x, y) => 120 + ((x + y) % 60)),
    dark: picture(w, h, edges(12, 0, 12, 0), () => 5),
    written: picture(w, h, edges(12, 0, 12, 0), (x, y) => 120 + ((x + y) % 60), 0, (x, y) => (y >= 82 && y < 86 && x >= 50 && x < 110 && (x + y) % 2 === 0 ? 235 : null)),
  };
  let showing = scenes.film;
  let tainted = false;
  let ticking = null;
  let stopped = 0;
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => { if (tainted) throw new Error('SecurityError'); return { data: showing }; } }) }),
  };
  globalThis.window = { setTimeout: () => 1, setInterval: (run) => ((ticking = run), 2), clearInterval: () => (stopped += 1), clearTimeout: () => undefined };
  const video = { readyState: 4, videoWidth: 320, videoHeight: 180, currentTime: 0 };
  const said = [];
  const look = (scene, seconds) => {
    showing = scenes[scene];
    video.currentTime = seconds;
    ticking();
  };
  const stop = W.watchVideoBars(video, (trim) => said.push(trim));

  look('film', 1);
  look('film', 3.5);
  assert.equal(said.length, 0, 'two looks are not enough to trim a playing file');
  look('film', 3.6);
  assert.equal(said.length, 0, 'nor a third of the same moment (a paused video is one look, however long it sits)');
  look('film', 6);
  assert.ok(said.length === 1 && said[0].x === 0 && close(said[0].y, 13 / h), 'three looks that agree, each a second of video apart: its bars are trimmed');
  for (let n = 0; n < 9; n += 1) look('dark', 8 + n * 2.5);
  assert.equal(said.length, 1, 'through a long dark scene the trim is held: the picture does not grow and shrink with the lighting');
  look('film', 40);
  assert.equal(said.length, 1, 'and it is the same trim when the light comes back');
  look('written', 42.5);
  assert.deepEqual(said[said.length - 1], { x: 0, y: 0 }, 'subtitles in a bar: the trim is let go');
  for (let n = 0; n < 9; n += 1) look('film', 45 + n * 2.5);
  assert.deepEqual(said[said.length - 1], { x: 0, y: 0 }, 'and stays let go for the rest of the play, though the subtitles have passed');
  assert.equal(said.length, 2, 'said once each way: no flicker');

  // A file whose pixels the browser will not hand over: the watching stops, nothing is said.
  const quiet = [];
  stopped = 0;
  tainted = true;
  W.watchVideoBars({ ...video, currentTime: 0 }, (trim) => quiet.push(trim));
  ticking();
  assert.ok(stopped === 1 && quiet.length === 0, "a file that may not be read is given up on at the first look");
  stop();
  delete globalThis.document;
  delete globalThis.window;
}

/* --- 3. the arithmetic of trimming ------------------------------------------------------------------------------------ */
assert.ok(close(B.trimmedShape(16 / 9, { x: 0.125, y: 0 }), 4 / 3), 'a 16:9 frame less an eighth from each side is 4:3');
assert.ok(close(B.trimmedShape(16 / 9, B.NO_TRIM), 16 / 9));
for (const [w, h] of [[1440, 900], [1920, 1080], [2560, 1080], [800, 800]]) {
  for (const trim of [{ x: 0, y: 0.13 }, { x: 0.125, y: 0 }, { x: 0.12, y: 0.1 }, B.NO_TRIM]) {
    for (const base of [16 / 9, 4 / 3]) {
      const { box, frame } = S.fitTrimmed(w, h, base, trim);
      assert.ok(box.w <= w + 1e-6 && box.h <= h + 1e-6 && (close(box.w, w) || close(box.h, h)), 'what shows fits the space and touches two of its sides');
      assert.ok(close(box.w / box.h, B.trimmedShape(base, trim), 1e-9), 'and is the shape of what is left');
      assert.ok(close(frame.w / frame.h, base, 1e-9), 'the frame keeps its own shape, so its site draws the picture as it always does');
      // The part of the frame inside its trim is exactly the box.
      assert.ok(close(frame.left + trim.x * frame.w, 0) && close(frame.top + trim.y * frame.h, 0), 'the picture starts at the corner of the box');
      assert.ok(close(frame.w * (1 - 2 * trim.x), box.w) && close(frame.h * (1 - 2 * trim.y), box.h), 'and ends at its far corner: the bars are all outside');
    }
  }
}
assert.deepEqual(S.stageStyle(16 / 9), { '--stage-ratio': '1.7778' }, 'nothing to trim: the element is the box');
{
  const style = S.stageStyle(16 / 9, { x: 0.125, y: 0.1 });
  const [ratio, growX, growY] = [Number(style['--stage-ratio']), Number(style['--stage-grow-x']), Number(style['--stage-grow-y'])];
  assert.ok(Math.abs(ratio - B.trimmedShape(16 / 9, { x: 0.125, y: 0.1 })) < 1e-3, 'bars to trim: the box is the shape of what is left');
  assert.ok(Math.abs((ratio * growX) / growY - 16 / 9) < 2e-3, "the element, grown by the bars, is the frame's own shape again");
  assert.ok(style['--stage-trim-x'] === '12.50%' && style['--stage-trim-y'] === '10.00%', 'and is cut back by the share of itself each bar is');
}
assert.deepEqual(S.pictureStyle(4 / 3), { '--stage-ratio': '1.3333' }, 'our own file, nothing to trim');
{
  const style = S.pictureStyle(16 / 9, { x: 0, y: 0.13 });
  assert.ok(Math.abs(Number(style['--stage-ratio']) - B.trimmedShape(16 / 9, { x: 0, y: 0.13 })) < 1e-3, 'our own file trimmed: the element is the shape of what is left');
  assert.equal(style.objectViewBox, 'inset(13.00% 0.00%)', 'and shows only that part of its picture');
  assert.equal(style.objectFit, 'cover', 'which every browser does for bars on one pair of edges');
  assert.equal(style['--stage-grow-y'], undefined, "it is not grown and cut: its own controls stay whole");
}

/* --- 4. where the stills are, and who uses all this ---------------------------------------------------------------------- */
const stills = [1, 2, 3].map((n) => `https://i.ytimg.com/vi/dQw4w9WgXcQ/mq${n}.jpg`);
for (const address of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1', 'https://youtu.be/dQw4w9WgXcQ']) {
  assert.deepEqual(W.youtubeStills(address), stills, `${address}: YouTube's three stills of the video`);
}
for (const address of ['https://vimeo.com/76979871', 'https://www.youtube.com/embed/videoseries?list=PL123', 'https://archive.org/embed/x', 'nonsense']) {
  assert.deepEqual(W.youtubeStills(address), [], `"${address}" has none there`);
}

{
  // The toggle: on for everybody, kept in the browser, heard by whoever draws.
  const kept = new Map();
  globalThis.window = { localStorage: { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value) } };
  delete require.cache[require.resolve(path.join(OUT, 'ui', 'stage-bkg.js'))];
  const K = require(path.join(OUT, 'ui', 'stage-bkg.js'));
  assert.equal(K.stageBkgOn(), true, '[ BKG ] starts on');
  assert.equal(K.stageBkgOnServer(), true);
  let heard = 0;
  const stop = K.subscribeToStageBkg(() => (heard += 1));
  K.toggleStageBkg();
  assert.ok(K.stageBkgOn() === false && heard === 1 && kept.get('debaser.site.stage-bkg.v1') === 'off', 'a press turns it off, says so, and is remembered');
  K.setStageBkg(false);
  assert.equal(heard, 1, 'setting it to what it is says nothing');
  K.toggleStageBkg();
  assert.ok(K.stageBkgOn() === true && heard === 2 && kept.get('debaser.site.stage-bkg.v1') === 'on', 'and on again');
  stop();
  K.toggleStageBkg();
  assert.equal(heard, 2, 'nobody hears it after they stop listening');
  // A browser that remembers "off" starts off.
  delete require.cache[require.resolve(path.join(OUT, 'ui', 'stage-bkg.js'))];
  assert.equal(require(path.join(OUT, 'ui', 'stage-bkg.js')).stageBkgOn(), false, 'what was chosen is how the next visit starts');
  delete globalThis.window;
}

const floating = read('app/components/FloatingPlayer.tsx');
assert.match(floating, /const dressed = staged && bkg;/, 'the floating player is dressed only with [ BKG ] on');
assert.match(floating, /\{dressed \? <StageBackdrop \/> : null\}/, 'the background is drawn only then');
assert.match(floating, /\{staged \? <StageKey \/> : null\}/, 'and the key is there whenever its box is fullscreen, on or off');
assert.match(floating, /stageStyle\(frameBars\?\.base \?\? knownShape, frameBars\?\.trim\)/, "another site's frame is grown and cut by its bars");
assert.match(floating, /pictureStyle\(knownShape, found !== null && found\.base === null \? found\.trim : NO_TRIM\)/, 'our own file shows only the part inside its bars');
assert.match(floating, /const keys = dressed && player\.kind === 'frame' && takesOrders\(entry\);/, "the site's own keys are along the foot where the frame takes orders: its own are cut off with the bars");

const room = read('app/components/WatchRoom.tsx');
assert.match(room, /const dressed = staged && bkg;/, 'the live room is dressed only with [ BKG ] on');
assert.match(room, /\{staged \? <StageKey \/> : null\}/, 'and has the key whenever it is fullscreen');
assert.match(room, /made\.current\?\.setFit\?\.\(\{ base, x: trimX, y: trimY \}\);/, "its YouTube player is told its frame's shape and bars");
assert.match(room, /pictureStyle\(ownShape, ownTrim\)/, 'its own video shows only the part inside its bars');

const tube = read('app/lib/watch/youtube-player.ts');
assert.match(tube, /const \{ box, frame: whole \} = fitTrimmed\(width, height, this\.shape, this\.trim\);/, "the room's YouTube frame is hung so its bars fall outside the picture's box");
assert.match(tube, /left: `\$\{whole\.left\}px`,\s*top: `\$\{whole\.top - bleed \* scale\}px`,/, "and YouTube's own player inside it is moved by the same");

const css = read('app/globals.css');
assert.match(css, /\.stage-fit \{[^}]*width: calc\(var\(--stage-wide\) \* var\(--stage-grow-x, 1\)\);[^}]*height: calc\(var\(--stage-wide\) \/ var\(--stage-ratio\) \* var\(--stage-grow-y, 1\)\);[^}]*clip-path: inset\(var\(--stage-trim-y, 0%\) var\(--stage-trim-x, 0%\)\);/, 'the stylesheet grows a frame by its bars and cuts it back to its box');
assert.match(css, /\.stage-surround \{[^}]*overflow: clip;\s*\}/, 'and nothing of a grown frame hangs out of the surround, which cannot be scrolled to it either (found in the drive: `hidden` could)');

const solids = read('app/components/backdrops/CanvasBackdrop.tsx');
assert.match(solids, /add\(rect\.left \+ dx, rect\.top \+ dy, rect\.right - dx, rect\.bottom - dy\);/, 'the background treats only the part of a trimmed frame that shows as solid');

console.log('video bars: found in made-up pictures, agreed across stills, trimmed by arithmetic, and used by the players, [ BKG ] and the stylesheet: OK');
