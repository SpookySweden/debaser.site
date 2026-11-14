/*
 * MEDIA, Luke's list of 2026-11-14 (M1-M14), held:
 *   npx tsc app/lib/web/shorts.ts --rootDir app/lib --outDir Temp/media-list-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *
 * M1 no YouTube Shorts: known by a /shorts/ address, the Shorts player in YouTube's search, a channel's long-form list,
 *    or a #shorts tag; left out of search, the hourly stream, YOUR YOUTUBE, FOR YOU and older saved rows.
 * M2 KINO never stays on behind YOUR YOUTUBE.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isShort, isShortsAddress, taggedShort } = require('./media-list-out/web/shorts.js');

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// M1: the rule itself.
assert.ok(isShortsAddress('https://www.youtube.com/shorts/YsKxkP_kGbE'));
assert.ok(isShortsAddress('/shorts/YsKxkP_kGbE'), "YouTube's own search links a Short by its path");
assert.ok(!isShortsAddress('https://www.youtube.com/watch?v=YsKxkP_kGbE'));
assert.ok(!isShortsAddress('https://evil.example/shorts/YsKxkP_kGbE'), 'only on YouTube');
assert.ok(taggedShort('Cat jumps #shorts') && taggedShort('x', 'Follow for more #Short'));
assert.ok(!taggedShort('Shorts season: summer clothes') && !taggedShort('#shortstory'), 'the word alone, or another tag, is not a Short');
assert.ok(isShort({ platform: 'youtube', url: 'https://youtu.be/x', title: 'clip #shorts' }));
assert.ok(!isShort({ platform: 'internet_archive', title: 'clip #shorts' }), 'only YouTube has Shorts');

// M1: every way a YouTube row reaches MEDIA asks it.
assert.match(read('app/lib/web/adapters/youtube.ts'), /children\(entry, 'link'\)\.some\(\(link\) => isShortsAddress\(link\.attrs\.href\)\)\) return null;/, 'the hourly stream skips a Short in the channel feed');
const innertube = read('app/lib/web/search/providers/youtube-innertube.ts');
assert.match(innertube, /if \(opens\?\.reelWatchEndpoint !== undefined\) return null;/, "YouTube's search: the Shorts player");
assert.match(innertube, /isShortsAddress\(opensAt\)\) return null;/, "... or a /shorts/ page");
assert.match(read('app/lib/web/search/providers/youtube.ts'), /if \(taggedShort\(str\(snippet\.title\), str\(snippet\.description\)\)\) return null;/, 'the Data API fallback: the tag');
const mine = read('app/lib/web/youtube-mine.ts');
assert.match(mine, /playlistId: `UULF\$\{id\.slice\(2\)\}`/, "YOUR YOUTUBE reads each channel's uploads without Shorts");
assert.match(mine, /if \(taggedShort\(snippet\.title, snippet\.description\)\) return;/, '... and drops a tagged Short among the likes');
const stream = read('app/components/WebStream.tsx');
assert.match(stream, /page\.items\.filter\(\(item\) => !isShort\(item\) && matchesFilters/, 'the page leaves out Shorts arriving from any source, older saved rows included');
assert.match(read('app/components/ForYou.tsx'), /!item\.seenOnly && !isShort\(item\)/, "FOR YOU's MEDIA lane too");

// M2: going into YOUR YOUTUBE takes KINO out of the box; coming back searches only if the box changed.
assert.match(stream, /const box = next && boxFilters\.source === 'kino' \? withFilter\(draft, 'in', 'all'\) : draft;/, 'KINO never stays on behind YOUR YOUTUBE');
assert.match(stream, /if \(!next && JSON\.stringify\(requestFor\(box\)\) !== JSON\.stringify\(shown\)\) \{\n\s*restart\(box\);/, '... and the list under it is the one the box says');

// M3: the open FILTERS panel shows every filter at once, one labelled row each; no folds inside it.
for (const row of ['PICKS', 'WHERE FROM', 'WHAT KIND', 'ORDER', 'MOOD SEARCH']) assert.ok(stream.includes(`<FilterRow label="${row}">`), `the ${row} row shows in the open panel`);
assert.ok(!/WebFilterFold id=/.test(stream), 'no fold inside the panel');
// M4: VIEW is its own key beside FILTERS, saying the view; its choices fold open under the row, outside FILTERS.
assert.ok(stream.indexOf('data-filters-key') < stream.indexOf('data-view-toggle'), 'VIEW beside FILTERS');
assert.match(stream, /\{`\[ VIEW: \$\{viewLabel\(view\)\} \]`\}/, 'the VIEW key says the view');
assert.ok(stream.indexOf('id="media-view-panel"') < stream.indexOf('id="media-filters-panel"'), 'its choices are not inside FILTERS');

console.log('ok: MEDIA list items held (M1 Shorts, M2 KINO and YOUR YOUTUBE, M3 one-press filters, M4 VIEW key)');
