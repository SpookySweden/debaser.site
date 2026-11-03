/*
 * CYTUBE (SPEC-cytube.md): the blank screen's keys and searches, back to black, and the five broadcaster looks.
 *   npx tsc app/lib/watch/blank-screen.ts app/lib/cytube/looks.ts --outDir Temp/out-cytube --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - each key pre-fills its own search, and the queue window reads it back: VIDEO asks for videos, MUSIC for audio
 *   and videos (a song uploaded as a video), BOOKS for audiobooks as audio and as video
 * - the queue running out puts the screen back to black (never a loop), and the next thing queued starts from black;
 *   an addition on somebody's list does not
 * - a viewer sees the host's look unless they keep their own; a host always wears their own; none is the site theme
 * - the five looks in app/theme/tokens.css hold the spec's floors (4.5:1 words, 3:1 lines), and the three keys read
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'Temp', 'out-cytube');
const blank = require(path.join(OUT, 'lib', 'watch', 'blank-screen.js'));
const looks = require(path.join(OUT, 'lib', 'cytube', 'looks.js'));

let failures = 0;
let passes = 0;
function ok(condition, message) {
  if (condition) passes += 1;
  else {
    failures += 1;
    console.log(`FAIL ${message}`);
  }
}
const same = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message}\n     got ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`);

/* ---------------------------------------------------------------- the three keys' searches */
same(blank.BLANK_KEYS.map((key) => key.label), ['VIDEO', 'MUSIC', 'BOOKS'], 'three keys, in order');
for (const { key } of blank.BLANK_KEYS) {
  same(blank.queueSearchPlan(blank.blankPrefill(key)).preset, key, `${key}: the pre-fill reads back as its own search`);
}
const video = blank.queueSearchPlan('type:video  alien ');
same([video.words, video.site, video.ask], ['alien', { videos: true, songs: false }, { words: 'alien', type: 'video', keep: 'video' }], 'VIDEO: the site\'s videos, the archive asked for videos');
same(blank.queueSearchPlan(blank.blankPrefill('video')).ask, null, 'VIDEO with no words: only the site\'s videos');
const music = blank.queueSearchPlan('type:music radiohead');
same([music.site, music.ask], [{ videos: false, songs: true }, { words: 'radiohead', type: 'all', keep: 'both' }], 'MUSIC: the site\'s songs, the archive\'s audio and videos');
ok(blank.keepsKind(music.ask.keep, 'video') && blank.keepsKind(music.ask.keep, 'audio'), 'MUSIC keeps a song uploaded as a video, and audio');
ok(!blank.keepsKind(music.ask.keep, 'text') && !blank.keepsKind(music.ask.keep, 'image'), 'MUSIC keeps no texts or pictures');
const books = blank.queueSearchPlan(blank.blankPrefill('books'));
same([books.site, books.ask], [{ videos: false, songs: false }, { words: 'audiobook', type: 'all', keep: 'both' }], 'BOOKS with no words: audiobooks at large');
same(blank.queueSearchPlan('dracula type:books').ask, { words: 'dracula audiobook', type: 'all', keep: 'both' }, 'BOOKS: the words plus "audiobook", audio and video');
ok(blank.keepsKind(books.ask.keep, 'video'), 'BOOKS keeps an audiobook uploaded as a video');
same(blank.queueSearchPlan('alien').ask, { words: 'alien', type: 'all', keep: 'both' }, 'no filter word: as before');
same(blank.queueSearchPlan('').ask, null, 'an empty bar: the site\'s own files only');
ok(!blank.keepsKind('video', 'audio'), 'a video search drops audio');

/* ---------------------------------------------------------------- back to black */
const row = (id, extra) => ({ id, roomId: 'r', position: 0, inQueue: true, mediaItemId: 'm', link: null, series: null, addedBy: 'a', addedAt: '2026-11-03T10:00:00Z', playedAt: null, playIndex: null, ...extra });
const played = row('p', { playedAt: '2026-11-03T10:01:00Z', playIndex: 0 });
const queued = row('q', { position: 1 });
const listed = row('l', { position: 2, inQueue: false });
same(blank.afterFile([played]), { kind: 'black' }, 'the queue ran out: back to black, not a loop');
same(blank.afterFile([played, listed]), { kind: 'black' }, 'an addition waiting on a list does not keep it going');
same(blank.afterFile([played, queued]).kind, 'next', 'something queued plays next');
ok(blank.screenIsBlank({ currentEntryId: null }, [played]), 'nothing on: black');
ok(!blank.screenIsBlank({ currentEntryId: 'p' }, [played]), 'a play on: not black');
ok(blank.screenIsBlank({ currentEntryId: 'gone' }, [played]), 'a play the queue no longer has: black');
same(blank.blankStart({ currentEntryId: null }, [played, queued])?.id, 'q', 'black, and something queued: it starts');
same(blank.blankStart({ currentEntryId: null }, [played, listed]), null, 'black, and only somebody\'s addition: still black');
same(blank.blankStart({ currentEntryId: 'p' }, [played, queued]), null, 'a play on: nothing starts over it');

/* ---------------------------------------------------------------- whose look */
const mine = { look: 'jungle', showHostLook: true };
same(looks.lookForRoom('blood', mine, false), 'blood', 'a viewer sees the host\'s look by default');
same(looks.lookForRoom('blood', { ...mine, showHostLook: false }, false), 'jungle', 'KEEP MY OWN LOOK');
same(looks.lookForRoom('blood', { ...mine, showHostLook: false, look: null }, false), null, 'keeping your own when you have none: the site theme');
same(looks.lookForRoom(null, mine, false), null, 'a host with no look: the site theme');
same(looks.lookForRoom('blood', mine, true), 'jungle', 'a host wears their own look');
same(looks.readLook('royal'), 'royal', 'a stored look reads back');
same(looks.readLook('magenta'), null, 'an unknown word is no look');
same(looks.NO_CHOICE, { look: null, showHostLook: true }, 'nobody chose: no look, the host\'s look shown');

/* ---------------------------------------------------------------- the looks' colours */
function loadThemes() {
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(ROOT, 'app/lib/ui/themes.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', outputText)(module, module.exports, require);
  return module.exports;
}
const { DYES } = loadThemes();
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const byVar = Object.fromEntries(Object.entries(DYES).map(([name, hex]) => [`--dye-${kebab(name)}`, hex]));
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const css = fs.readFileSync(path.join(ROOT, 'app/theme/tokens.css'), 'utf8').replace(/\r\n/g, '\n');
const TOKENS = ['bar', 'words', 'keys', 'lines', 'readout', 'title'];
function lookBlock(id) {
  const match = new RegExp(`\\.look-${id} \\{([^}]*)\\}`).exec(css);
  if (match === null) return null;
  const values = {};
  for (const token of TOKENS) {
    const value = new RegExp(`--room-${token}: var\\((--dye-[a-z-]+)\\);`).exec(match[1]);
    values[token] = value === null ? undefined : byVar[value[1]];
  }
  return values;
}
const black = DYES.black;
same([...looks.LOOK_IDS], ['nigrosine', 'royal', 'blood', 'jungle', 'orchid'], 'the five looks, by name');
for (const id of looks.LOOK_IDS) {
  const look = lookBlock(id);
  ok(look !== null, `${id}: a .look-${id} block in tokens.css`);
  if (look === null) continue;
  ok(TOKENS.every((token) => typeof look[token] === 'string'), `${id}: all six room tokens are dyes`);
  if (!TOKENS.every((token) => typeof look[token] === 'string')) continue;
  const floor = (value, min, what) => ok(value >= min, `${id}: ${what} ${value.toFixed(2)}:1 (floor ${min})`);
  floor(ratio(look.words, look.bar), 4.5, 'words on the bar');
  floor(ratio(look.keys, look.bar), 4.5, 'keys on the bar');
  floor(ratio(look.bar, look.keys), 4.5, 'a filled key\'s words');
  floor(ratio(look.keys, black), 4.5, 'keys in the black recess');
  floor(ratio(look.title, black), 4.5, 'the queue title on Black');
  floor(ratio(look.readout, black), 4.5, 'the readout on Black');
  floor(ratio(look.lines, look.bar), 3, 'lines against the bar');
  floor(ratio(look.lines, black), 3, 'lines against Black');
}
const migration = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).find((name) => name.endsWith('_cytube.sql'));
ok(migration !== undefined, 'the cytube migration is in the repository');
if (migration !== undefined) {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations', migration), 'utf8');
  same(/look in \(([^)]*)\)/.exec(sql)?.[1].replace(/'|\s/g, '').split(','), [...looks.LOOK_IDS], 'the database allows exactly the five looks');
}
ok(ratio(DYES.daffodil, black) >= 4.5, 'the three keys at rest: Daffodil on Black');
for (const lit of ['lightRed', 'brilliantPink', 'emerald']) ok(ratio(black, DYES[lit]) >= 4.5, `a lit key: Black words on ${lit}`);
for (const [token, dye] of [['video', 'light-red'], ['music', 'brilliant-pink'], ['books', 'emerald'], ['rest', 'daffodil']]) {
  ok(css.includes(`--color-blank-${token}: var(--dye-${dye});`), `the ${token} key's colour is ${dye}`);
}

console.log(`cytube: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exitCode = 1;
