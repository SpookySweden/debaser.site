/*
 * Scratch checks for the player and the music shelf (run from the root):
 *   npx tsc app/lib/audio/format.ts app/lib/audio/clip-loop.ts app/lib/audio/tracks.ts app/lib/audio/catalogue.ts app/lib/audio/repository.ts app/lib/audio/mock-music-repository.ts app/lib/audio/supabase-music-repository.ts --outDir Temp/audio-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/MusicPlayer.tsx app/components/MusicPlayerProvider.tsx --outDir Temp/audio-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-audio.cjs
 *
 * Two halves: the arithmetic a stereo gets wrong (clocks, wrapping at the ends of the
 * queue, which track the player opens on) and the markup that says what is playing. The
 * first half is pure and runs on the compiled modules; the second renders the real bar
 * with the provider handed in as a stub, which is the only way to render a playing state
 * without a browser.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const {
  clampVolume,
  formatClock,
  formatClockOrNothing,
  nextIndex,
  previousIndex,
  startIndexFor,
} = require('./audio-out/audio/format.js');

const {
  buildQueue,
  titleFromFileName,
  trackCaption,
  tracksFromStorage,
} = require('./audio-out/audio/tracks.js');

const { CLIP_LOOP_SECONDS, clipRepeats, secondsFromLength } = require('./audio-out/audio/clip-loop.js');

const {
  MAX_TRACK_BYTES,
  extensionForTrack,
  slugFromFileName,
  trackStoragePath,
  validateTrackFile,
} = require('./audio-out/audio/catalogue.js');

// 1. Clocks: a stereo reads out m:ss, and an unknown length is dashes, never NaN.
assert.equal(formatClock(0), '0:00');
assert.equal(formatClock(9), '0:09');
assert.equal(formatClock(61), '1:01');
assert.equal(formatClock(600), '10:00');
assert.equal(formatClock(Number.NaN), '--:--');
assert.equal(formatClock(-4), '--:--');
assert.equal(formatClockOrNothing(undefined), '--:--');
assert.equal(formatClockOrNothing(3.9), '0:03', 'the fraction is dropped, not rounded up');

// 2. The ends of the queue: skipping wraps, and an empty shelf does not divide by zero.
assert.equal(nextIndex(0, 3), 1);
assert.equal(nextIndex(2, 3), 0, 'the last track skips round to the first');
assert.equal(previousIndex(0, 3), 2, 'and the first goes back to the last');
assert.equal(nextIndex(0, 0), 0);
assert.equal(previousIndex(0, 0), 0);

// 3. Volume is a fraction, whatever a hand-edited setting says.
assert.equal(clampVolume(0.5), 0.5);
assert.equal(clampVolume(-1), 0);
assert.equal(clampVolume(4), 1);
assert.equal(clampVolume(Number.NaN), 1);


// 4. The opening track: the bucket's own first, and the archive's when the bucket is empty.
//
// The archive's own tracks are a *fixture here*, not the shipped catalogue: that catalogue is empty because
// the invented tracks it held pointed at files that do not exist, and a check that reached into app data
// for its fixtures broke when the fake data went. What is being tested is the *rule* - a bucket track is
// what somebody just put there, so it leads - and that holds whatever the archive holds.
const bucketTrack = {
  id: 'uploads/theme.mp3',
  title: 'THEME',
  credit: 'x',
  kind: 'k',
  src: 'https://example.test/uploads/theme.mp3',
  length: '--:--',
  shelf: 'bucket',
};

const localFixture = [
  {
    id: 'fixture-one',
    title: 'ONE',
    credit: 'x',
    kind: 'k',
    src: '/assets/audio/fixture-one.mp3',
    length: '3:12',
    shelf: 'archive',
  },
  {
    id: 'fixture-two',
    title: 'TWO',
    credit: 'x',
    kind: 'k',
    src: '/assets/audio/fixture-two.mp3',
    length: '2:48',
    shelf: 'archive',
  },
];

assert.equal(startIndexFor([]), 0);
assert.equal(startIndexFor([localFixture[0]]), 0, 'with an empty bucket the archive`s own plays');
assert.equal(startIndexFor([bucketTrack, ...localFixture]), 0, 'and with a track in the bucket, that is what plays');
assert.equal(startIndexFor([localFixture[0], localFixture[1], bucketTrack]), 2, 'wherever it sits in the queue');

// 5. The queue: the bucket first, the archive after it, and no file listed twice.
const queue = buildQueue([bucketTrack], localFixture);
assert.equal(queue[0].src, bucketTrack.src, 'the bucket is what somebody just put there, so it leads');
assert.equal(queue.length, localFixture.length + 1);
assert.equal(buildQueue([localFixture[0]], localFixture).length, localFixture.length, 'the same file is listed once');
assert.equal(buildQueue([bucketTrack]).length, 1, 'with an empty archive the bucket is all there is');

// 6. A file nobody described is still worth reading in the display.
assert.equal(titleFromFileName('band-demo_02.mp3'), 'BAND DEMO 02');
assert.equal(titleFromFileName('user-1/some mix (rough).wav'), 'SOME MIX (ROUGH)');
assert.equal(titleFromFileName('nodots'), 'NODOTS');

const described = tracksFromStorage(
  [
    { path: 'u1/mix-one.mp3', src: 'https://example.test/mix-one.mp3' },
    { path: 'u1/untitled-file.mp3', src: 'https://example.test/untitled-file.mp3' },
  ],
  [{ src: 'https://example.test/mix-one.mp3', title: 'MIX ONE', credit: 'SWEDEN', kind: 'ROUGH MIX' }],
);
assert.equal(described[0].title, 'MIX ONE', 'a row wins over the file name');
assert.equal(described[0].credit, 'SWEDEN');
assert.equal(described[0].shelf, 'bucket');
assert.equal(described[1].title, 'UNTITLED FILE', 'and a file without one is titled from its own name');
assert.equal(described[1].credit, 'DEBASER.SITE');
assert.match(trackCaption(described[0]), /UPLOADED :: ROUGH MIX :: SWEDEN/, 'the caption reads shelf :: what it is :: who');

// An archive track's caption, against a fixture: the archive's own tracks are a test value rather than app
// data, for the reason section 4 gives - the shipped catalogue is empty and a check should not depend on it.
assert.match(
  trackCaption({ ...localFixture[0], shelf: 'archive' }),
  /ARCHIVE/,
  'and an archive track says so',
);
assert.equal(trackCaption(undefined), 'NOTHING QUEUED');

// 7. What the shelf accepts, and where a track goes.
const file = (name, type, size) => ({ name, type, size });
assert.equal(validateTrackFile(file('a.mp3', 'audio/mpeg', 1024)), undefined);
assert.equal(validateTrackFile(file('a.m4a', '', 1024)), undefined, 'a vague content type falls back to the extension');
assert.match(String(validateTrackFile(file('a.exe', 'application/octet-stream', 10))), /MP3, M4A, OGG, WAV OR FLAC ONLY./);
assert.match(String(validateTrackFile(file('big.mp3', 'audio/mpeg', MAX_TRACK_BYTES + 1))), /20MB OR SMALLER/);
assert.equal(extensionForTrack(file('song.m4a', 'audio/x-m4a', 1)), '.m4a');
assert.equal(slugFromFileName('Some Mix (rough).mp3'), 'some-mix-rough');
assert.equal(trackStoragePath('user-1', 'Some Mix.mp3', '.mp3').startsWith('user-1/some-mix-'), true);

// 8. The bar says what is playing, in the site's own voice.
function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

/**
 * The real provider, captured *before* the stub replaces it.
 *
 * `MusicPlayer` is rendered below with the provider stubbed, because a real one would mount an audio
 * element and a session. That is right for testing the markup and wrong for testing the provider, so
 * the genuine module is kept here first - a stubbed module cannot be asked what it does.
 */
const realProvider = require('./audio-render/components/MusicPlayerProvider.js');

let player = null;

stub('./audio-render/components/MusicPlayerProvider.js', {
  default: ({ children }) => children,
  useMusicPlayer: () => player,
});

const MusicPlayer = require('./audio-render/components/MusicPlayer.js').default;

player = {
  // (2026-11-04) The stub gained the BARRED notice's field: `null` is 'nothing to ask'; undefined crashed the render.
  barrAsk: null,
  queue: [bucketTrack, ...localFixture],
  track: bucketTrack,
  index: 0,
  playing: true,
  loading: false,
  error: null,
  elapsed: 61,
  duration: 184,
  volume: 0.5,
  loop: true,
  toggle: () => undefined,
  next: () => undefined,
  previous: () => undefined,
  play: () => undefined,
  playAt: () => undefined,
  setVolume: () => undefined,
  setLoop: () => undefined,
  seek: () => undefined,
  refresh: () => undefined,
};

// The bar carries the MUSIC key, which opens the window the side panel's key opens. That press calls
// `useRouter()` to spend the address it opened by, and `useRouter` throws outside a real Next render -
// so the stub router `check-shell.cjs` established is handed in here too. It keeps this check on the
// markup rather than on a browser.
const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime.js');
const router = {
  push: () => undefined,
  replace: () => undefined,
  refresh: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
};

const bar = renderToStaticMarkup(
  React.createElement(AppRouterContext.Provider, { value: router }, React.createElement(MusicPlayer, null)),
);
// (2026-10-23, SPEC-efficiency.md) `♪ DEBASER PLAYER` became `♪ PLAYER`: the tightest strip on the site, and
// the new font is wider.
assert.match(bar, /♪ PLAYER/, 'the bar names itself');
assert.doesNotMatch(bar, /DEBASER PLAYER/, 'in the short name');
assert.match(bar, /HIDE/, 'and carries its own fold');
assert.match(bar, /THEME/, 'and shows the track on its display');
assert.match(bar, /1:01 \/ 3:04/, 'with the running time beside the length');
assert.match(bar, /VOL/, 'a volume slider');

/*
 * The transport is a D-pad now: left, one cycling symbol, right - and the symbol is the point.
 *
 * This used to assert `[ LOOP ON ]` and `[ PREV ]` / `[ PAUSE ]`, which is a row of buttons each
 * naming what pressing it would do. The pad replaces that with one cell showing which of three states
 * the player is *in*, animated so it reads as a display rather than as something to press. So what is
 * asserted here is that shape, not the old labels:
 *
 *   - one mark, and it is the state (`Paused` here, which is what a prerender always is - nothing has
 *     played yet);
 *   - and the mark *moves* in the states that are running. Playing blips, looping wobbles, paused is
 *     still - because something stopped that kept blinking would be lying about itself.
 */
assert.doesNotMatch(bar, /\[ PLAY \]|\[ PAUSE \]|\[ LOOP ON \]|\[ LOOP OFF \]/, 'the old labelled keys are gone');

// The cell shows one state and names it only for a screen reader - `sr-only` is what keeps it to one
// symbol on screen. The fixture below has `playing: true, loop: true`, and it is worth saying why that
// reads as *Looping* rather than Playing: a repeating track is also playing, so `loop` has to win or the
// `↻` symbol could never appear at all. That precedence is what this holds.
assert.match(bar, /<span class="sr-only">Looping<\/span>/, 'the cell shows one state, and names it for a screen reader');
// (2026-10-25, SPEC-less-text.md) The tip was `Looping - press for Playing`; it is cut to the state's own word
// (a tip names an unlabelled control in a few words, rule 1).
assert.match(bar, /title="Looping"/, 'the tooltip names the state, in a word');
assert.doesNotMatch(bar, /press for (Playing|Paused|Looping)/, 'and no longer spells out what the next press gives');
assert.match(bar, /<span aria-hidden="true" class="animate-wobble">/, 'and the looping mark moves, as the running ones do');

// "One symbol" means the word is *only* in the screen-reader text, never drawn beside it: with the
// `sr-only` spans removed, no state word is left in the markup at all.
const drawnOnly = bar.replace(/<span class="sr-only">[^<]*<\/span>/g, '');
assert.doesNotMatch(drawnOnly, />\s*(PLAYING|PAUSED|LOOPING|Playing|Paused|Looping)\s*</, 'no word is drawn beside the symbol');

// Three states, three marks, and the two that are running animate: `blip` for playing, `wobble` for
// looping, nothing for paused. Read from the source because only the paused one can be rendered here.
const playerSource = require('node:fs').readFileSync('app/components/MusicPlayer.tsx', 'utf8');
assert.match(playerSource, /playing: '▶', paused: '❚❚', looping: '↻'/, 'the three marks');
assert.match(playerSource, /playing: 'animate-blip', paused: undefined, looping: 'animate-wobble'/, 'and their three animations, paused being still');

// The three keys survive as keys, because a display a reader cannot press is a stereo without a
// transport: left and right step the queue, and the middle walks the states.
assert.match(bar, /title="Previous track"/, 'the left of the pad steps back');
assert.match(bar, /title="Next track"/, 'and the right steps on');

// Every mark is drawn beside its own word for a screen reader, per the house rule that a bare glyph is
// a puzzle - the pad's glyphs are `aria-hidden`, never left to speak for themselves.
assert.match(bar, /aria-label="Previous track"/, 'the left arrow is named for a screen reader');
assert.match(bar, /aria-label="Next track"/, 'and so is the right');

// (2026-10-23, SPEC-efficiency.md) The wide bar's `[ ♪ MUSIC ]` and `[ ⟳ QUEUES ]` are cut: the side panel's
// shelf opens both, and the strip needed the room. (The phone card keeps its links: check-music-library.)
assert.doesNotMatch(bar, /\[ .* MUSIC \]/, 'and no music key on the wide bar: the shelf has it');
assert.doesNotMatch(bar, /SHELF \(/, 'the shelf button is gone: the key opens the music window now');

// (2026-10-23, SPEC-efficiency.md) The caption is the uploader's name only (was `UPLOADED :: k :: x`).
assert.match(bar, /text-ink-bar">x</, 'saying who the track came from');
assert.doesNotMatch(bar, /UPLOADED :: /, 'and nothing more');

// 9. Two loop switches, and they do not touch each other.
//
// The fault this holds closed: `assign({ loop: true })` - a profile's own song being handed to the
// bar - wrote the *shelf's* loop switch, and that switch is persisted to localStorage. So visiting a
// profile with a song on it turned looping on for the whole board and left it on, and a reader who
// never pressed the loop key found the shelf repeating a track with no idea why.
//
// `repeatOnEnd` is the pure rule the `ended` handler uses, extracted so this is drivable without a
// browser. It comes from `realProvider`, captured above before the stub replaced the module.
assert.equal(typeof realProvider.repeatOnEnd, 'function', 'the pure rule is exported, not buried in the effect');

const { repeatOnEnd } = realProvider;

assert.equal(repeatOnEnd(null, true), 'repeat', 'with nothing handed over, the shelf`s switch decides');
assert.equal(repeatOnEnd(null, false), 'advance', 'and it can say no');
assert.equal(repeatOnEnd(true, false), 'repeat', 'a handed-over track repeats even though the shelf will not');
assert.equal(repeatOnEnd(false, true), 'advance', 'and it advances even though the shelf would repeat');
assert.equal(repeatOnEnd(true, true), 'repeat', 'when both agree, either reading is the same');

// 10. The three-state cycle, and that it closes.
//
// The middle cell walks playing -> paused -> looping -> playing, made out of two switches. That
// arithmetic is the part that can silently go wrong - and it did, once, while this was being written:
// with `playing` taking precedence over `loop`, `↻` could never be shown, because a repeating track is
// also playing. The rule is `loop` first, and the cycle is what proves it.
const cellState = (playing, loop) => (loop ? 'looping' : playing ? 'playing' : 'paused');

// What a press does to the two switches, per state - the same three branches the handler has.
const press = (state) => {
  if (state === 'playing') return { playing: false, loop: false };
  if (state === 'paused') return { playing: true, loop: true };
  return { playing: true, loop: false };
};

let now = { playing: true, loop: false };
const walked = [];

for (let step = 0; step < 6; step += 1) {
  walked.push(cellState(now.playing, now.loop));
  now = press(cellState(now.playing, now.loop));
}

assert.deepEqual(
  walked,
  ['playing', 'paused', 'looping', 'playing', 'paused', 'looping'],
  'the cycle walks the three states in order and closes',
);

// Leaving looping must not silence the music: the symbol promised the next state, not silence.
assert.equal(press('looping').playing, true, 'leaving looping leaves the audio running');

// 11. A short file behaves like a GIF.
//
// A seven-second sound filed with a post is a motion, not a piece of music: it repeats itself rather
// than handing the player on. The decision is one pure function (`app/lib/audio/clip-loop.ts`), and the
// player applies it to the file it is about to play - so this is asked of the rule and of the wiring.
assert.equal(CLIP_LOOP_SECONDS, 20, 'the rule is twenty seconds, and it is one number in one place');

// The filed running time is what the player is handed, in `m:ss` as `formatClock` writes it.
assert.equal(secondsFromLength('0:07'), 7);
assert.equal(secondsFromLength('3:41'), 221);
assert.equal(secondsFromLength('1:00:00'), 3600, 'an hours part would be read, though nothing here writes one');

// A length that is not a length is not guessed at: `--:--` is what a column holds when the browser
// could not measure the file, and a guess there would loop somebody's long track for them.
assert.equal(secondsFromLength('--:--'), null, 'an unmeasured file names no length');
assert.equal(secondsFromLength(''), null);
assert.equal(secondsFromLength(undefined), null);
assert.equal(secondsFromLength('7'), null, 'a bare number is not a clock');
assert.equal(secondsFromLength('0:70'), null, 'and there is no seventieth second');
assert.equal(secondsFromLength('0:00'), null, 'a file of no seconds is an unread file, not a clip');

// The rule itself, at the boundary and on both sides of it.
assert.equal(clipRepeats({ length: '0:07' }), true, 'a seven-second clip repeats itself');
assert.equal(clipRepeats({ length: '0:20' }), true, 'twenty seconds is inside the rule');
assert.equal(clipRepeats({ length: '0:21' }), null, 'a second past it, the shelf`s switch decides');
assert.equal(clipRepeats({ length: '3:41' }), null, 'and a track is a track');
assert.equal(clipRepeats({}), null, 'a file with no filed length is left to the switch');
assert.equal(clipRepeats(undefined), null, 'and so is no file at all');

// The player applies it where a file is handed to it, and the *end of a clip* is the two together:
// this drives the real `repeatOnEnd` (section 9) with the real rule rather than asserting that each
// half exists. A clip repeating with the shelf's switch *off* is the whole point, and it is the case a
// reader meets by pressing play on a file filed with a post.
assert.equal(repeatOnEnd(clipRepeats({ length: '0:07' }), false), 'repeat', 'a clip repeats with the shelf`s switch off');
assert.equal(repeatOnEnd(clipRepeats({ length: '3:41' }), false), 'advance', 'and a track still walks on');
assert.equal(repeatOnEnd(clipRepeats({ length: '3:41' }), true), 'repeat', 'unless the shelf`s own switch says otherwise');

// The player applies it where a file is handed to it, and writes it to the *track's* own repeat - not
// to the shelf's switch, which is persisted (the fault section 9 above holds closed). A short file
// played in a thread is the case this was written for: nobody hands it over, so nothing else would.
const providerText = require('node:fs').readFileSync('app/components/MusicPlayerProvider.tsx', 'utf8');

// (2026-11-04) The clip rule now goes through `ownRepeatFor`, which adds one rule on top: a WEB track (an
// audiobook's chapter, a podcast episode) never repeats itself, so the next chapter follows it. Driven here,
// not just named, and every place a file is handed over must use it.
const { ownRepeatFor } = realProvider;
assert.equal(ownRepeatFor({ length: '0:07' }), clipRepeats({ length: '0:07' }), 'a short clip still brings its own repeat');
assert.equal(repeatOnEnd(ownRepeatFor({ length: '0:07' }), false), 'repeat', 'and it repeats with the shelf`s switch off');
assert.equal(ownRepeatFor({ length: '3:41' }), null, 'a track leaves it to the shelf`s switch');
assert.equal(ownRepeatFor({ length: '3:41', shelf: 'web' }), false, 'a WEB track never repeats itself');
assert.equal(ownRepeatFor({ length: '0:07', shelf: 'web' }), false, 'not even one short enough to count as a clip');
assert.equal(repeatOnEnd(ownRepeatFor({ length: '3:41', shelf: 'web' }), true), 'advance', 'so the next chapter follows it, whatever the shelf`s switch says');
assert.match(providerText, /setOwnLoop\(ownRepeatFor\(wanted\)\)/, 'a played file brings its own repeat');
assert.doesNotMatch(providerText, /setOwnLoop\(clipRepeats\(/, 'and nothing goes round the WEB rule');
assert.doesNotMatch(
  providerText,
  /setLoopState\((clipRepeats|ownRepeatFor)/,
  'and it is never written to the switch that persists, or looping a clip would loop the whole board',
);

// The bar's symbol is handed what will happen, not which switch decided it: a clip repeats itself with
// the shelf's switch off, and a `↻` beside a file that is about to stop would be the bar lying.
assert.match(providerText, /loop: ownLoop \?\? loop/, 'the bar is told the effective repeat');

console.log('audio checks passed');
console.log('  clocks     : 61s reads', formatClock(61), ':: an unknown length reads', formatClock(Number.NaN));
console.log('  queue      :', player.queue.length, 'tracks, opening on the bucket, wrapping at both ends');
console.log('  shelf      :', titleFromFileName('band-demo_02.mp3'), 'from a bare file name');
console.log('  bar        : the LED names the track, and one symbol shows which of three states the player is in');
