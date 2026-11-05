/*
 * The beat box on the site (app/features/beatbox/README.txt). Its full tests live with the package; this holds what the
 * site's own copy must keep doing: passes fold into the loop, one undo a pass, Replace clears only what it crossed, a forum
 * post is only a song if it's nothing but a song link, and the page's source keeps to its rules.
 *   npx tsc app/features/beatbox/recorder/merge.ts app/features/beatbox/recorder/history.ts app/features/beatbox/recorder/clock.ts app/features/beatbox/recorder/loopRecorder.ts app/lib/forum/song-link.ts --rootDir app --outDir Temp/beatbox-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { commitTake } = require('./beatbox-out/features/beatbox/recorder/merge.js');
const { createHistory, pushHistory, undoHistory } = require('./beatbox-out/features/beatbox/recorder/history.js');
const { foldIntoLoop } = require('./beatbox-out/features/beatbox/recorder/clock.js');
const { createLoopRecorder } = require('./beatbox-out/features/beatbox/recorder/loopRecorder.js');
const { bodyWords, songHrefIn, SONG_POST_WORDS } = require('./beatbox-out/lib/forum/song-link.js');

const ROOT = path.join(__dirname, '..');
const BAR = 192;
const LOOP = BAR * 2;
const OFF = { gridParts: null, strength: 1, chordWindowParts: 0 };

const song = () => ({
  key: 0,
  tempo: 120,
  beatsPerBar: 8,
  stepsPerBeat: 4,
  barCount: 4,
  loopStart: 0,
  loopLength: 2,
  channels: [
    {
      isDrum: false,
      octave: 4,
      bars: [1, 2, 0, 0],
      patterns: [
        { notes: [], instruments: [0] },
        { notes: [], instruments: [0] },
      ],
    },
  ],
});

const notes = (data, bar) => {
  const channel = data.channels[0];
  const number = channel.bars[bar];
  return number === 0 ? [] : channel.patterns[number - 1].notes.map((note) => [note.pitches[0], note.start, note.end]);
};

// Passes land where they were played: a position past the end folds back to the loop.
assert.equal(foldIntoLoop(LOOP + 24, LOOP), 24);

function record(mode, passes) {
  const recorder = createLoopRecorder({ loopParts: LOOP, fromPart: 0 });
  let history = createHistory(song());
  const keep = (takes) => {
    for (const take of takes) history = pushHistory(history, commitTake(history.present, 0, take, mode, OFF));
  };
  passes.forEach(([pitch, from, to]) => {
    keep(recorder.advance(from));
    recorder.noteOn(pitch, 127, from);
    recorder.noteOff(pitch, to);
  });
  keep(recorder.advance(LOOP * (passes.length + 1) + 8));
  return history;
}

// Overdub: three passes layer, each where it was played, and one undo takes only the last.
{
  let history = record('overdub', [
    [48, 0, 12],
    [52, LOOP + 48, LOOP + 60],
    [55, LOOP * 2 + BAR, LOOP * 2 + BAR + 12],
  ]);
  assert.deepEqual(notes(history.present, 0), [
    [48, 0, 12],
    [52, 48, 60],
  ]);
  assert.deepEqual(notes(history.present, 1), [[55, 0, 12]]);
  history = undoHistory(history);
  assert.deepEqual(notes(history.present, 1), [], 'one undo takes the last pass');
  assert.equal(notes(history.present, 0).length, 2, 'and only the last pass');
}

// Replace: only the last pass stays in the span it crossed, and one undo brings the old one back.
{
  let history = record('replace', [
    [48, 0, 12],
    [55, LOOP + 24, LOOP + 36],
  ]);
  assert.deepEqual(notes(history.present, 0), [[55, 24, 36]]);
  history = undoHistory(history);
  assert.deepEqual(notes(history.present, 0), [[48, 0, 12]]);
}

// A note held over the loop end carries on from the loop start.
{
  const recorder = createLoopRecorder({ loopParts: LOOP, fromPart: 0 });
  recorder.noteOn(48, 127, LOOP - 24);
  const [first] = recorder.advance(LOOP + 8);
  assert.deepEqual([first.notes[0].start, first.notes[0].end, first.notes[0].heldOver], [LOOP - 24, LOOP, true]);
  recorder.noteOff(48, LOOP + 24);
  const [second] = recorder.finish(LOOP + 40);
  assert.deepEqual([second.notes[0].start, second.notes[0].end, second.notes[0].continued], [0, 24, true]);
}

// A post is a song only if it's nothing but a song link, and its key stays on this site.
assert.equal(songHrefIn('https://debaser.site/beatbox#9n31abc-_'), '/beatbox#9n31abc-_');
assert.equal(songHrefIn('  https://elsewhere.example/beatbox#9n31\n'), '/beatbox#9n31');
assert.equal(songHrefIn('listen to this https://debaser.site/beatbox#9n31'), null);
assert.equal(songHrefIn('https://debaser.site/forum#9n31'), null);
assert.equal(songHrefIn('https://debaser.site/beatbox#<script>'), null);
assert.equal(songHrefIn('https://debaser.site/beatbox'), null);
assert.equal(bodyWords('https://debaser.site/beatbox#9n31'), SONG_POST_WORDS, 'a list shows words, not the long link');
assert.equal(bodyWords('an ordinary post'), 'an ordinary post');

// The source keeps to the beat box's own rules.
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const walk = (dir) =>
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(file) : [file];
  });
const source = walk('app/features/beatbox').filter((file) => /\.tsx?$/.test(file));
assert.ok(source.length > 20, 'the package is here');
for (const file of source) {
  const text = read(file);
  if (!file.includes('/engine/')) assert.doesNotMatch(text, /from ['"]beepbox/, `${file}: only the engine imports beepbox`);
  assert.doesNotMatch(text, /\b(localStorage|sessionStorage|indexedDB)\b/, `${file}: saving goes through its props`);
  assert.doesNotMatch(text, /\b(transition|animate-|duration-\d)/, `${file}: no smooth movement`);
}
assert.match(read('package.json'), /"beepbox": "4\.2\.0"/, 'beepbox stays pinned to the version the engine was checked against');
assert.match(read('app/components/BeatBoxLoader.tsx'), /ssr: false/, 'the synth loads in the browser only');

console.log('beat box: passes, undo, replace, held notes, song links and source rules OK');
