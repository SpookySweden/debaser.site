/**
 * A video's true shape, and the fullscreen box it is fitted in (SPEC-rooms-your-room.md, part 3; Luke, 2026-11-16: "when
 * fullscreening a video that has black bars i want the black bars replaced by the backround of the website that is selected").
 *
 * Held here, with no browser: the shape worked out of a width and a height (oEmbed's rounded sizes land on the real shape;
 * nonsense is no shape); the largest box of a shape that fits a screen, in its middle; where a video's shape is asked (its
 * site's oEmbed, YouTube and Vimeo only); the asking (once a video, never throwing, a failure asked again); and that the
 * players use it: the room's YouTube player fits its frame by the shape it is told, the site's one player fullscreens its own
 * box and never the bare frame or video, and the stylesheet fits a picture by `--stage-ratio` over the background.
 *
 * What only a browser can show (the frame's real size on the screen, the background drawn round it, nothing reloaded) is in
 * `scripts/drive-rooms-your-room.cjs`.
 *
 * Compiled fresh on every run:
 *   npx tsc app/lib/watch/video-shape.ts --rootDir app --outDir Temp/video-shape-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const S = require(path.join(__dirname, 'video-shape-out', 'lib', 'watch', 'video-shape.js'));
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const close = (a, b, slack = 1e-9) => Math.abs(a - b) <= slack;

(async () => {
  /* --- the shape of a width and a height --------------------------------------------------------------------------- */
  assert.ok(close(S.shapeFrom(200, 113), 16 / 9), "YouTube's 200x113 is 16:9 exactly, not 1.7699");
  assert.ok(close(S.shapeFrom(200, 150), 4 / 3), '200x150 is 4:3');
  assert.ok(close(S.shapeFrom(113, 200), 9 / 16), 'a tall video is tall');
  assert.ok(close(S.shapeFrom(1920, 1080), 16 / 9), 'true sizes too');
  assert.ok(close(S.shapeFrom(1920, 800), 2.39), 'a film near 2.39 is 2.39');
  assert.ok(close(S.shapeFrom(1000, 700), 1000 / 700), 'a shape near none of the usual ones is itself');
  assert.ok(Math.abs(S.shapeFrom(1000, 700) - 4 / 3) > 0.05, 'and is not pulled to 4:3');
  for (const [w, h] of [['200', 113], [200, '113'], [Number.NaN, 100], [100, Number.POSITIVE_INFINITY], [0, 100], [100, 0], [-16, 9], [undefined, undefined], [null, 9]]) {
    assert.equal(S.shapeFrom(w, h), null, `${String(w)} by ${String(h)} is no shape`);
  }
  assert.equal(S.shapeFrom(10000, 100), 3, 'nothing wider than 3 to 1');
  assert.equal(S.shapeFrom(100, 10000), 0.4, 'nothing narrower than 0.4 to 1');
  assert.ok(close(S.WIDE, 16 / 9), 'a video nobody knows the shape of is 16:9');

  /* --- the largest box of a shape that fits, in the middle ---------------------------------------------------------- */
  assert.deepEqual(S.fitShape(1440, 900, 16 / 9), { left: 0, top: 45, w: 1440, h: 810 }, '16:9 on a 16:10 screen: full width, strips above and below');
  assert.deepEqual(S.fitShape(1440, 900, 4 / 3), { left: 120, top: 0, w: 1200, h: 900 }, '4:3 on it: full height, strips either side');
  assert.deepEqual(S.fitShape(1920, 1080, 16 / 9), { left: 0, top: 0, w: 1920, h: 1080 }, '16:9 on a 16:9 screen: all of it');
  for (const [w, h] of [[1440, 900], [1920, 1080], [390, 844], [2560, 1080], [800, 800]]) {
    for (const shape of [16 / 9, 4 / 3, 21 / 9, 9 / 16, 1, 2.39]) {
      const box = S.fitShape(w, h, shape);
      assert.ok(box.w <= w + 1e-6 && box.h <= h + 1e-6, `a ${shape.toFixed(2)} box never hangs over a ${w}x${h} space`);
      assert.ok(close(box.w, w, 1e-6) || close(box.h, h, 1e-6), 'and touches two of its sides');
      assert.ok(close(box.w / box.h, shape, 1e-9), 'and is the shape asked for');
      assert.ok(close(box.left * 2 + box.w, w, 1e-6) && close(box.top * 2 + box.h, h, 1e-6), 'in the middle');
    }
  }
  assert.deepEqual(S.stageStyle(4 / 3), { '--stage-ratio': '1.3333' }, 'the stylesheet is told the shape as a plain number');

  /* --- where the shape is asked ------------------------------------------------------------------------------------- */
  const tube = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  for (const address of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1', 'https://www.youtube.com/shorts/dQw4w9WgXcQ']) {
    assert.equal(S.shapeAddress(address), tube, `${address} asks YouTube's oEmbed about the video's watch page`);
  }
  assert.equal(S.shapeAddress('https://player.vimeo.com/video/76979871?h=8272103f6e'), 'https://vimeo.com/api/oembed.json?url=' + encodeURIComponent('https://vimeo.com/76979871/8272103f6e'), "a Vimeo player's address asks Vimeo's oEmbed, the unlisted key kept");
  assert.equal(S.shapeAddress('https://vimeo.com/76979871'), 'https://vimeo.com/api/oembed.json?url=' + encodeURIComponent('https://vimeo.com/76979871'));
  assert.equal(S.shapeAddress('https://www.youtube.com/embed/videoseries?list=PL1234567890'), null, "a playlist's player is no one video, though its name is as long as a video's");
  for (const address of ['https://player.twitch.tv/?channel=x', 'https://archive.org/embed/night_of_the_living_dead', 'https://example.com/watch?v=dQw4w9WgXcQ', 'not an address', '']) {
    assert.equal(S.shapeAddress(address), null, `"${address}" is not asked anywhere`);
  }

  /* --- the asking --------------------------------------------------------------------------------------------------- */
  const realFetch = globalThis.fetch;
  let calls = [];
  let answer = () => ({ ok: true, json: async () => ({ width: 200, height: 150 }) });
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return answer();
  };
  try {
    assert.equal(await S.videoShape('https://example.com/video.mp4'), null, 'a video of no site that says has no shape');
    assert.equal(calls.length, 0, 'and nothing is asked for it');

    const one = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
    assert.ok(close(await S.videoShape(one), 4 / 3), 'the shape is what the site answers');
    assert.ok(close(await S.videoShape('https://www.youtube-nocookie.com/embed/aaaaaaaaaaa'), 4 / 3), "the same video by its player's address");
    assert.equal(calls.length, 1, 'asked once a video for the visit');
    assert.ok(calls[0].startsWith('https://www.youtube.com/oembed?'), 'and only of its own site');

    // An answer that did not come is not remembered as "no shape".
    // (Its body has sizes in it, as an error page's might: a refusal is not read.)
    answer = () => ({ ok: false, status: 503, json: async () => ({ width: 200, height: 150 }) });
    const two = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';
    assert.equal(await S.videoShape(two), null, 'a site that does not answer: no shape');
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer = () => ({ ok: true, json: async () => ({ width: 200, height: 113 }) });
    assert.ok(close(await S.videoShape(two), 16 / 9), 'and it is asked again the next time');

    answer = () => {
      throw new Error('offline');
    };
    assert.equal(await S.videoShape('https://vimeo.com/123456'), null, 'a fetch that throws is no shape, not an error');
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer = () => ({ ok: true, json: async () => ({ title: 'no sizes in this one' }) });
    assert.equal(await S.videoShape('https://vimeo.com/123456'), null, 'an answer with no sizes is no shape');
  } finally {
    globalThis.fetch = realFetch;
  }

  /* --- the players use it ------------------------------------------------------------------------------------------- */
  const tubePlayer = read('app/lib/watch/youtube-player.ts');
  // Since part 4 the frame is fitted with its bars trimmed (`fitTrimmed`, held in check-video-bars.cjs); with none it is `fitShape`.
  assert.match(tubePlayer, /const \{ box, frame: whole \} = fitTrimmed\(width, height, this\.shape, this\.trim\);/, "the room's YouTube frame is fitted by the shape it was told");
  {
    const plain = S.fitTrimmed(1440, 900, 4 / 3, { x: 0, y: 0 });
    assert.deepEqual(plain.box, S.fitShape(1440, 900, 4 / 3), 'with no bars to trim, that is the largest box of the shape');
    assert.deepEqual(plain.frame, { left: -0, top: -0, w: 1200, h: 900 }, 'and the frame is the box');
  }
  assert.match(tubePlayer, /const shownWidth = shownHeight \* this\.shape;/, "and YouTube's own player is made that shape, so it has no bars to draw");
  assert.doesNotMatch(tubePlayer, /\(height \* 16\) \/ 9|\(shownHeight \* 16\) \/ 9/, 'no 16:9 left written into its layout');

  const floating = read('app/components/FloatingPlayer.tsx');
  assert.match(floating, /notePlayerElement\(stageBox\.current\);/, "FULL fullscreens the player's own box");
  assert.doesNotMatch(floating, /notePlayerElement\(frame\.current/, 'never the bare frame');
  assert.match(floating, /controlsList="nofullscreen"/, "our own file has no fullscreen of the browser's own (it shows black bars)");
  // Since part 4: only while it is fullscreen AND `[ BKG ]` is on (`dressed`), and still after the player.
  assert.match(floating, /<\/video>\s*\)\}\s*\{\/\*[^*]*\*\/\}\s*\{dressed \? <StageBackdrop \/> : null\}/, 'the background is drawn in the box only while it is fullscreen, after the player (which is never moved)');

  const room = read('app/components/WatchRoom.tsx');
  assert.match(room, /setStaged\(full !== null && \(full === stageRef\.current \|\| full === pictureBox\.current\)\);/, 'the live room: the stage or the floating picture in fullscreen');
  assert.match(room, /if \(alive && found !== null\) setShape\(found\);/, "and its embedded player's shape is asked of its site");
  assert.match(room, /const base = shaped && trims && bars !== null \? bars\.base : shape;/, 'which the player is told, unless its bars are being trimmed (check-video-bars.cjs)');

  const css = read('app/globals.css');
  assert.match(css, /\.stage-fit \{[^}]*--stage-wide: min\(100cqw, calc\(100cqh \* var\(--stage-ratio\)\)\);[^}]*width: calc\(var\(--stage-wide\) \* var\(--stage-grow-x, 1\)\);[^}]*height: calc\(var\(--stage-wide\) \/ var\(--stage-ratio\) \* var\(--stage-grow-y, 1\)\);/, 'a fullscreen picture is its own shape, as large as fits its surround');
  assert.match(css, /\.stage-surround \{[^}]*container-type: size;[^}]*isolation: isolate;/, 'the surround measures itself and keeps its own layers');
  assert.match(css, /\.stage-surround > \.backdrop-stage,\s*\.stage-surround > \.backdrop-stage-tile \{\s*z-index: var\(--z-index-backdrop\);/, 'and the background is under everything in it');

  console.log('video shape: worked out, fitted, asked once of its own site, and used by the room, the floating player and the stylesheet: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
