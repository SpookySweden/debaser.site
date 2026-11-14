/*
 * MEDIA, Luke's list of 2026-11-14 (M1-M14), held:
 *   npx tsc app/lib/web/shorts.ts app/lib/ui/themes.ts --rootDir app/lib --outDir Temp/media-list-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
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

// M5: the title in the one heavier weight, a family of its own (a second Google load of the face would join the site's family
// and turn every font-bold heavy), and who made it and the facts in the caption ink.
const fonts = read('app/theme/fonts.ts');
assert.match(fonts, /const strong = localFont\(\{\n  src: '\.\/faces\/ibm-plex-mono-600-latin\.woff2',\n  variable: '--face-strong',\n  weight: '600',/, 'the heavier weight is a local file, so it is its own family');
assert.equal((fonts.match(/PixelFace\(\{/g) ?? []).length, 1, 'the site face is loaded once, at 400 only');
assert.match(fonts, /weight: '400',/);
assert.ok(fs.statSync('app/theme/faces/ibm-plex-mono-600-latin.woff2').size > 5000 && fs.readFileSync('app/theme/faces/ibm-plex-mono-600-latin.woff2').subarray(0, 4).toString() === 'wOF2', 'the font file is there, and a woff2');
assert.match(read('app/theme/tokens.css'), /--font-strong: var\(--face-strong\), var\(--face-pixel\), 'Courier New', monospace;/, 'font-strong falls back to the site face');
assert.match(stream, /className=\{`\$\{TITLE_CLASS\[view\]\} font-strong text-ink wrap-anywhere/, 'a row title wears the heavier weight');
assert.match(stream, /text-label text-ink-quiet wrap-anywhere hover:underline/, 'who made it is in the caption ink');
assert.match(stream, /<p className="flex flex-wrap items-center gap-x-1\.5 text-label text-ink-quiet" data-row-facts>/, 'the facts too');
const mediaRow = read('app/components/WebMediaRow.tsx');
assert.equal((mediaRow.match(/text-title font-strong text-ink wrap-anywhere/g) ?? []).length, 2, 'KINO and media-server titles wear it too');

// M6, M9, M10: one shared key of two halves; each half its own fill under the pointer, Black words, readable in every theme.
const split = read('app/components/SplitKey.tsx');
assert.match(split, /<span role="group" aria-label=\{label\}/, 'the two halves are one group with a name');
assert.match(split, /`\[ \$\{first\.words\}`/, '... one pair of brackets round both');
assert.match(split, /`\$\{second\.words\} \]`/);
assert.match(split, /if \(second === null\) \{/, 'with no second half it is an ordinary key');
const css = read('app/globals.css');
assert.match(css, /\.key\.split-first:not\(\.key-fill\):hover:not\(:disabled\) \{\n    background-color: var\(--color-acid\);\n    color: var\(--color-ink-plate\);/, 'first half: the green fill');
assert.match(css, /\.key\.split-second:not\(\.key-fill\):hover:not\(:disabled\) \{\n    background-color: var\(--color-bubble\);\n    color: var\(--color-ink-plate\);/, 'second half: the pink fill');
assert.ok(css.indexOf('.key.split-first') > css.indexOf('.key:not(.key-fill):hover:not(:disabled)') && css.indexOf('.key.split-first') < css.indexOf('.key.module-key'), 'beside the key rules, not at the end');
assert.doesNotMatch(css.slice(css.indexOf('.key.split-first'), css.indexOf('.key.module-key')), /transition|animation/, 'instant: no easing');
const { THEMES } = require('./media-list-out/ui/themes.js');
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
for (const theme of THEMES) {
  for (const fill of ['acid', 'bubble']) {
    const r = ratio(theme.tokens['ink-plate'], theme.tokens[fill]);
    assert.ok(r >= 4.5, `${theme.id}: Black on the ${fill} half reads ${r.toFixed(2)}:1`);
  }
  assert.notEqual(theme.tokens.acid, theme.tokens.bubble, `${theme.id}: the two halves differ`);
}
const queue = read('app/components/QueueHalf.tsx');
assert.ok(queue.indexOf("roomKey.mode === 'add'") < queue.indexOf('if (bar !== null)') && queue.indexOf('if (bar !== null)') < queue.indexOf('if (roomKey !== null) {'), 'in a room: its queue; then the bar; then WATCH IN ROOM');
assert.match(queue, /for \(const track of tracks\) player\.enqueue\(track, 'end'\);/, "+ QUEUE puts the bar's audio on UP NEXT");
assert.match(stream, /<SplitKey label=\{`Play or queue "\$\{item\.title\}"`\} first=\{playHalf\} second=\{queueHalf\} \/>/, 'the row draws PLAY / + QUEUE');
assert.match(read('app/components/WebBridgeKeys.tsx'), /short \? `\[ ✎\$\{count > 0 \? ` \$\{count\}` : ''\} \]`/, 'DISCUSS is the short pen on a row');
const rowKeys = read('app/components/WebRowKeys.tsx');
assert.match(rowKeys, /second=\{second === null \? null : \{ words: 'PLAYLIST', draw: \(className, text\) => <AddToPlaylistKey thing=\{second\}/, '+ LETTER / PLAYLIST, through the shared playlist key');
assert.match(stream, /trackId: webTrackId\(barItem\.platform, barItem\.externalId, 0\)/, 'PLAYLIST only for what the bar plays, by its first file');
assert.ok(!/AddToLetterKey/.test(stream) && !/<AddToLetterKey/.test(mediaRow), 'no row draws a lone + LETTER any more');

// M7: the sources come before PLAY: ALSO ON on a row, WATCH on a KINO or server card with the other keys after it.
assert.ok(stream.indexOf('[ ALSO ON ') < stream.indexOf('<SplitKey label={`Play or queue'), 'ALSO ON stands before PLAY');
assert.match(stream, /aria-expanded=\{alsoOpen\} aria-controls=\{alsoId\}/, '... and says whether it is open');
assert.match(read('app/components/KinoSources.tsx'), /\[ WATCH · \$\{total\} \$\{open \? '▴' : '▾'\} \]`\}\n        <\/button>\n        \{beside\}/, 'a card\'s other keys come after WATCH');

// M8: OPEN is a small key in the picture's top right corner, with a name and a thumb's room on a narrow screen.
assert.match(rowKeys, /className="group absolute right-0 top-0 [^"]*max-sm:min-h-tap max-sm:min-w-tap"/, 'the corner, with tap room');
assert.match(rowKeys, /aria-label=\{label\}/);
assert.match(stream, /\{link \? <ThumbOpen href=\{link\} label=\{`Open "\$\{item\.title\}" on \$\{source\} \(new tab\)`\} \/> : null\}/, 'every row with a link has it');
assert.ok(!stream.includes('[ OPEN ↗ ]'), 'no OPEN key among the keys');
assert.match(mediaRow, /<ThumbOpen href=\{addresses\.link\}/, 'a KINO card too (its TMDB page)');

// M11: the facts and the keys share a line; COMPACT is one line.
assert.match(stream, /full \? 'mt-1 flex flex-wrap items-center gap-x-3 gap-y-1' : 'contents'/, 'facts and keys on one line');
assert.match(stream, /full \? 'min-w-0 flex-1' : 'flex min-w-0 flex-1 items-center gap-2'/, 'COMPACT: the title and its keys on one line');

console.log('ok: MEDIA list items held (M1 Shorts, M2 KINO and YOUR YOUTUBE, M3 one-press filters, M4 VIEW key, M5-M11 the rows)');
