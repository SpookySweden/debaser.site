/*
 * The stream queue search's filters (Luke, 2026-11-04): SOURCE, TYPE, VIBE and SORT, as the archive search has them.
 *   npx tsc app/lib/watch/blank-screen.ts app/lib/watch/songs.ts --outDir Temp/out-queue-filters --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop
 *
 * - the SOURCE keys offer only what a room can play; a source it cannot is read as ALL
 * - the TYPE keys are the blank screen's three, and `type:audio` (the archive's word) reads as MUSIC
 * - `in:`, `from:`, `vibe:` and `sort:` read as on the archive page, and one source leaves out the site's own files
 * - a key writes its word into the bar and leaves the words alone, so reading the bar back gives what was pressed
 * - the site's songs: MUSIC with nothing typed lists them, VIBE takes any word, `from:` keeps a credit
 */
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'Temp', 'out-queue-filters');
const blank = require(path.join(OUT, 'lib', 'watch', 'blank-screen.js'));
const songs = require(path.join(OUT, 'lib', 'watch', 'songs.js'));
const web = require(path.join(OUT, 'lib', 'web', 'web-filters.js'));

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
const plan = blank.queueSearchPlan;
const press = blank.withQueueFilter;

/* ---------------------------------------------------------------- the keys on offer */
same(blank.QUEUE_SOURCES.map((option) => option.label), ['ALL', 'INTERNET ARCHIVE', 'PEERTUBE', 'YOUTUBE'], 'SOURCE: only what a room can play from');
same(blank.QUEUE_TYPES.map((option) => option.label), ['ALL', 'BOOKS', 'VIDEO', 'MUSIC'], "TYPE: the blank screen's keys in Luke's order, behind ALL");
ok(blank.QUEUE_SOURCES.every((option) => web.SOURCE_OPTIONS.some((known) => known.value === option.value)), 'every SOURCE key is one the archive page knows');

/* ---------------------------------------------------------------- reading the bar */
same([plan('alien').source, plan('alien').vibe, plan('alien').sort], ['all', false, { sort: 'best', dir: 'desc' }], 'plain words: ALL, VIBE off, BEST MATCH');
const youtube = plan('alien in:youtube');
same([youtube.words, youtube.source, youtube.site], ['alien', 'youtube', { videos: false, songs: false }], 'one source: the words, that source, none of the site\'s files');
same(plan('alien in:archive').source, 'internet_archive', "the archive page's short words work here too");
// (2026-11-05) KINO came off this list on purpose: Luke asked for the IMDB key inside the stream UI, so `in:kino` now
// reads as a lookup, tested under "the IMDB key" below. It still has no SOURCE key, and a room still cannot play it.
for (const unplayable of ['wikimedia-commons', 'openverse', 'podcast']) {
  const read = plan(`alien in:${unplayable}`);
  same([read.source, read.words, read.site], ['all', 'alien', { videos: true, songs: true }], `in:${unplayable}: a room cannot play from it, so it reads as ALL`);
}
same(plan('in:youtube').ask, null, 'one source with no words: nothing to ask');
same(plan('in:youtube').site, { videos: false, songs: false }, 'one source with no words: nothing of the site\'s either (the bar asks for words)');
same(plan('alien vibe:on').vibe, true, 'vibe:on');
same(plan('alien sort:popular').sort, { sort: 'popular', dir: 'desc' }, 'sort:popular');
same(plan('alien sort:oldest').sort, { sort: 'date', dir: 'asc' }, 'sort:oldest');
same(plan('alien sort:newest').sort, { sort: 'date', dir: 'desc' }, 'sort:newest');
same(plan('alien sort:popular').words, 'alien', 'filter words are not searched for');
same([plan('from:"rick prelinger"').authors, plan('from:"rick prelinger"').ask], [['rick prelinger'], { words: '', type: 'all', keep: 'both' }], 'from: with no words is still something to look for');
same(plan('type:video from:prelinger').ask, { words: '', type: 'video', keep: 'video' }, 'from: under VIDEO keeps the video rule');

same(plan('type:audio alien').preset, 'music', "type:audio, the archive page's word, reads as MUSIC");
same(plan('type:audio alien').words, 'alien', 'type:audio is not searched for');
same([plan('type:image alien').preset, plan('type:image alien').words], [null, 'alien'], 'type:image: a room cannot play one, so it is dropped');
same(plan('type:music in:youtube x').site, { videos: false, songs: false }, 'MUSIC on one source: none of the site\'s songs');
same(plan('type:books dracula in:youtube').ask, { words: 'dracula audiobook', type: 'all', keep: 'both' }, 'BOOKS still adds its word under a source');

/* ---------------------------------------------------------------- pressing a key */
same(press('alien', 'in', 'youtube'), 'alien in:youtube', 'SOURCE writes its word');
same(press('alien in:youtube', 'in', 'all'), 'alien', 'SOURCE ALL takes it out');
same(press('alien in:youtube', 'in', 'peertube'), 'alien in:peertube', 'a second SOURCE replaces the first');
same(press('alien', 'in', 'internet_archive'), 'alien in:internet-archive', 'a source is written the way it is typed');
same(press('alien', 'type', 'video'), 'type:video alien', 'TYPE writes its word first, where a blank screen\'s key puts it');
same(press('type:video alien', 'type', 'music'), 'type:music alien', 'a second TYPE replaces the first');
same(press('type:video alien', 'type', 'all'), 'alien', 'TYPE ALL takes it out');
same(press('type:books ', 'in', 'youtube'), 'type:books in:youtube', "a blank screen's pre-fill survives another key");
same(press('type:audio alien', 'in', 'youtube'), 'type:music alien in:youtube', 'type:audio survives another key, as MUSIC');
same(press('alien', 'vibe', 'on'), 'alien vibe:on', 'VIBE on');
same(press('alien vibe:on', 'vibe', 'off'), 'alien', 'VIBE off takes it out');
same(press('alien', 'sort', 'popular'), 'alien sort:popular', 'POPULAR');
same(press('alien sort:popular', 'sort', 'newest'), 'alien sort:newest', 'DATE replaces POPULAR');
same(press('alien sort:newest', 'sort', 'oldest'), 'alien sort:oldest', 'the flip key');
same(press('alien sort:oldest', 'sort', 'best'), 'alien', 'BEST MATCH takes it out');
same(press('alien type:image in:podcast', 'type', 'video'), 'type:video alien', 'what the queue cannot read is tidied away');
same(press('alien type:image in:podcast', 'vibe', 'on'), 'alien vibe:on', 'and by any key');
same(press('from:"rick prelinger" alien', 'in', 'youtube'), 'alien in:youtube from:"rick prelinger"', 'a creator is kept, quoted');
same(press('', 'in', 'youtube'), 'in:youtube', 'an empty bar');

// Every combination reads back as what was pressed, whatever order the keys came in.
for (const source of blank.QUEUE_SOURCES.map((option) => option.value)) {
  for (const type of blank.QUEUE_TYPES.map((option) => option.value)) {
    for (const sort of ['best', 'popular', 'newest', 'oldest']) {
      for (const vibe of ['on', 'off']) {
        const bar = press(press(press(press('blade runner', 'sort', sort), 'in', source), 'vibe', vibe), 'type', type);
        const read = plan(bar);
        const wantSort = sort === 'best' ? { sort: 'best', dir: 'desc' } : sort === 'popular' ? { sort: 'popular', dir: 'desc' } : { sort: 'date', dir: sort === 'oldest' ? 'asc' : 'desc' };
        same(
          [read.words, read.source, read.preset ?? 'all', read.vibe, read.sort],
          ['blade runner', source, type, vibe === 'on', wantSort],
          `${source} ${type} ${sort} vibe ${vibe}: the bar "${bar}" reads back`,
        );
      }
    }
  }
}

/* ---------------------------------------------------------------- the IMDB key: posters and details, nothing to add */
ok(!blank.QUEUE_SOURCES.some((option) => option.value === blank.QUEUE_LOOKUP_SOURCE), 'KINO has the IMDB key, not a SOURCE key: a room cannot play it');
const lookup = plan('alien in:kino');
same([lookup.source, lookup.words, lookup.preset, lookup.site, lookup.ask], ['kino', 'alien', null, { videos: false, songs: false }, { words: 'alien', type: 'video', keep: 'video' }], "IMDB: TMDB's films and shows for the words, none of the site's files");
same(plan('in:tmdb alien').source, 'kino', "the archive page's other word for it");
same(plan('in:kino').ask, null, 'IMDB with no words: nothing to ask, so the bar asks for words');
same(plan('in:kino from:prelinger').ask, null, 'and a creator is no help: TMDB is asked about words');
same([plan('type:music alien in:kino').preset, plan('type:music alien in:kino').ask.words, plan('type:books alien in:kino').ask.words], [null, 'alien', 'alien'], 'a typed TYPE changes nothing, and BOOKS adds no word');
same(press('alien', 'in', blank.QUEUE_LOOKUP_SOURCE), 'alien in:kino', 'pressing IMDB writes its word, the words untouched');
same(press('alien in:kino', 'in', 'all'), 'alien', 'pressing it again takes it out');
same(press('type:books alien', 'in', blank.QUEUE_LOOKUP_SOURCE), 'alien in:kino', 'it drops the TYPE, which it has no use for');
same(press('alien in:kino', 'in', 'youtube'), 'alien in:youtube', 'a SOURCE key leaves the lookup');
same(press('alien in:kino', 'type', 'video'), 'type:video alien', 'and so does a TYPE key');
same(press('alien in:kino', 'sort', 'popular'), 'alien in:kino sort:popular', 'SORT stays in the lookup');
same(press('alien in:kino', 'vibe', 'on'), 'alien in:kino vibe:on', 'and so does VIBE');
same(plan('alien').source, 'all', 'FIND TO PLAY: a title on its own in the bar is a search of what a room can play');

// The window: the key is drawn over the SOURCE row, and a looked-up title is listed with a way on, never an ADD.
const read = (file) => require('node:fs').readFileSync(path.join(__dirname, '..', 'app', 'components', file), 'utf8');
const filters = read('QueueSearchFilters.tsx');
ok(filters.indexOf('data-imdb-key') !== -1 && filters.indexOf('data-imdb-key') < filters.indexOf('aria-label="Source"'), 'the IMDB key is above the SOURCE row');
ok(/flex justify-center">\s*<button[\s\S]{0,120}pick\('in', lookingUp \? 'all' : QUEUE_LOOKUP_SOURCE\)/.test(filters), 'centred, and it turns the lookup on and off');
const queueWindow = read('StreamQueueWindow.tsx');
ok(/type\(`\$\{next\} `\);\s*searchBar\.current\?\.focus\(\);/.test(queueWindow), 'a key with nothing typed leaves a space before the caret, so the next word is not glued to the filter (in:kinoalien)');
ok(/if \(lookingUp\) return true;\s*if \(playsInBar\(item\)\) return true;/.test(queueWindow), 'looked-up titles pass the "can a room play this" test, and only those');
ok(/isKinoRow\(item\) \? \(\s*<KinoRow[\s\S]{0,400}data-imdb-find/.test(queueWindow), 'a title is drawn with its poster and details, with FIND TO PLAY');
ok(!/<KinoRow[\s\S]{0,500}AddKey/.test(queueWindow), 'and no ADD');

/* ---------------------------------------------------------------- the site's songs */
const track = (title, credit, extra = {}) => ({ src: `/assets/${title}.mp3`, title, credit, shelf: 'bucket', ...extra });
const shelf = [track('Blue Monday', 'New Order'), track('Red Rain', 'Peter Gabriel'), track('Web Song', 'Elsewhere', { shelf: 'web' })];
const titles = (found) => found.map((song) => song.title);
same(titles(songs.songMatches(shelf, '')), [], 'no words and no filter: no songs, as before');
same(titles(songs.songMatches(shelf, '', undefined, { listAll: true })), ['Blue Monday', 'Red Rain'], "MUSIC with nothing typed: the site's songs, never a web track");
same(titles(songs.songMatches(shelf, 'blue rain')), [], 'every word, as before');
same(titles(songs.songMatches(shelf, 'blue rain', undefined, { anyWord: true })), ['Blue Monday', 'Red Rain'], 'VIBE: any word');
same(titles(songs.songMatches(shelf, '', undefined, { authors: [['peter', 'gabriel']] })), ['Red Rain'], 'from: with no words');
same(titles(songs.songMatches(shelf, 'blue', undefined, { authors: [['peter', 'gabriel']] })), [], 'from: and words must both match');

console.log(`${failures === 0 ? 'PASS' : 'FAIL'}: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
