/*
 * MEDIA, Luke's list of 2026-11-14 (M1-M14), held:
 *   npx tsc app/lib/web/shorts.ts app/lib/ui/themes.ts app/lib/web/web-filters.ts app/lib/web/search/providers/books.ts app/lib/web/search/providers/peertube.ts app/lib/web/media-keep.ts --rootDir app/lib --outDir Temp/media-list-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
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
// Updated on purpose 2026-11-14 (YOUTUBE session: the read now hands back uploads and likes apart, so the helper answers null): same rule.
assert.match(mine, /if \(taggedShort\(snippet\.title, snippet\.description\)\) return null;/, '... and drops a tagged Short among the likes');
const stream = read('app/components/WebStream.tsx');
assert.match(stream, /page\.items\.filter\(\(item\) => !isShort\(item\) && matchesFilters/, 'the page leaves out Shorts arriving from any source, older saved rows included');
assert.match(read('app/components/ForYou.tsx'), /!item\.seenOnly && !isShort\(item\)/, "FOR YOU's MEDIA lane too");

// M2: going into YOUR YOUTUBE takes KINO out of the box; coming back searches only if the box changed.
assert.match(stream, /const box = next && boxFilters\.source === 'kino' \? withFilter\(draft, 'in', 'all'\) : draft;/, 'KINO never stays on behind YOUR YOUTUBE');
assert.match(stream, /if \(!next && JSON\.stringify\(requestFor\(box\)\) !== JSON\.stringify\(shown\)\) \{\n\s*restart\(box\);/, '... and the list under it is the one the box says');

// M3: the open FILTERS panel shows every filter at once, one labelled row each; no folds inside it.
// Updated on purpose 2026-11-14: ORDER is its own key now (Luke: "a separate expandable button to the right of view and filters").
for (const row of ['PICKS', 'WHERE FROM', 'WHAT KIND', 'MOOD SEARCH']) assert.ok(stream.includes(`<FilterRow label="${row}">`), `the ${row} row shows in the open panel`);
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
// (2026-11-14, SPEC-rooms-queues.md phase 1) The third case was WATCH IN ROOM, because a video outside a room had no queue.
// Everybody has a room of their own now, so it is + QUEUE too, through the one function that says what that means.
assert.ok(queue.indexOf("roomKey.mode === 'add'") < queue.indexOf('if (bar !== null)') && queue.indexOf('if (bar !== null)') < queue.indexOf('if (room !== undefined) {'), 'in a room: its queue; then the bar; then your own room');
// Updated on purpose 2026-11-16 (SPEC-room-chat-discuss.md): the link carries which result it is (`webRef`), for its DISCUSS page.
assert.ok(queue.includes('await addToMyQueue(room.link !== undefined ? { title, link: room.link, ...(room.webRef === undefined ? {} : { webRef: room.webRef }) } : { title, mediaItemId: room.mediaItemId }, userId)'), "a video outside a room goes onto your own room's queue");
assert.doesNotMatch(queue, /data: 'room-start'/, 'and the half never opens the GO LIVE menu any more');
assert.match(queue, /for \(const track of tracks\) player\.enqueue\(track, 'end'\);/, "+ QUEUE puts the bar's audio on UP NEXT");
assert.match(stream, /<SplitKey label=\{`Play or queue "\$\{item\.title\}"`\} first=\{playHalf\} second=\{queueHalf\} \/>/, 'the row draws PLAY / + QUEUE');
assert.match(read('app/components/WebBridgeKeys.tsx'), /short \? `\[ ✎\$\{count > 0 \? ` \$\{count\}` : ''\} \]`/, 'DISCUSS is the short pen on a row');
const rowKeys = read('app/components/WebRowKeys.tsx');
assert.match(rowKeys, /second=\{second === null \? null : \{ words: 'PLAYLIST', draw: \(className, text\) => <AddToPlaylistKey thing=\{second\}/, '+ LETTER / PLAYLIST, through the shared playlist key');
assert.match(stream, /trackId: webTrackId\(barItem\.platform, barItem\.externalId, 0\)/, 'PLAYLIST for what the bar plays, by its first file');
// Added on purpose 2026-11-15 (SPEC-rooms-queues.md phase 4: "ADD TO PLAYLIST takes a video"): a row the bar cannot play
// hands the playlist key the same link a room would queue, so a video is kept whole.
assert.match(stream, /: roomLink !== null\s*\? \{ title: item\.title, link: roomLink \}\s*: null;/, 'and for a video, by the link a room would queue');
assert.ok(!/AddToLetterKey/.test(stream) && !/<AddToLetterKey/.test(mediaRow), 'no row draws a lone + LETTER any more');

// M7: the sources: ALSO ON on a row, WATCH on a KINO or server card with the other keys after it.
// Updated on purpose 2026-11-16 (Luke: "only play and queue, with an arrow on the same row beside them that reveals the rest of
// the options"): ALSO ON stood before PLAY; now it waits behind the arrow after PLAY, with the rest.
const moreAt = stream.indexOf('<MoreKeys title={item.title}');
assert.ok(stream.indexOf('<SplitKey label={`Play or queue') < moreAt && moreAt < stream.indexOf('[ ALSO ON ') && stream.indexOf('[ ALSO ON ') < stream.indexOf('</MoreKeys>'), 'ALSO ON waits behind the arrow after PLAY');
for (const key of ["<LetterPlaylistKey letter={{ kind: 'web'", '<WebDiscussKey item={item}', "<FeedbackKey item={{ kind: 'media', ref: item.id", '[ EDITIONS ]']) {
  const at = stream.indexOf(key);
  assert.ok(at > moreAt && at < stream.indexOf('</MoreKeys>'), key + ' waits behind the arrow');
}
assert.equal(mediaRow.split('<MoreKeys title={item.title}>').length - 1, 2, 'KINO and server cards have the arrow too');
assert.match(rowKeys, /\{open && unfold === 'left' \? children : null\}\s*\{arrow\}\s*\{open && unfold === 'right' \? children : null\}/, 'the arrow stays put: the rest unfolds on its far side');
assert.ok(rowKeys.includes('const [open, setOpen] = useState(false);'), 'each row starts folded');
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

// M12: a book shows its language, from the languages Open Library lists for its editions.
const books = require('./media-list-out/web/search/providers/books.js');
assert.ok(books.BOOKS_FIELDS.split(',').includes('language'), 'Open Library is asked for the languages');
const doc = (language) => ({ key: '/works/OL1W', title: 'Dracula', first_publish_year: 1897, language });
const NOW = '2026-11-14T00:00:00.000Z';
assert.equal(books.toBookItem(doc(['fre']), NOW).language, 'fr', 'one language: that one');
assert.equal(books.toBookItem(doc(['eng', 'fre', 'ger']), NOW).language, 'en', 'several, none plain from the title: English when listed (no flag)');
assert.equal(books.toBookItem(doc(['eng', 'fre', 'ger']), NOW, 'de').language, 'de', '... the one a LANGUAGE filter asked for, when the work has it');
assert.equal(books.toBookItem(doc(['spa', 'ita']), NOW).language, 'es', 'no English: the first listed');
assert.equal(books.toBookItem(doc(undefined), NOW).language, undefined, 'none listed: none said');
assert.match(books.booksSearchUrl('dracula', 1, '', 'relevance', 'fr'), /q=dracula\+language%3Afre&/, 'BOOKS asks Open Library for that language');
assert.match(books.libraryScanQuery('dracula', '', 'fr'), / AND language:\(fre OR fr OR french\) AND collection:/, '... and the Archive scans');
assert.match(require('./media-list-out/web/search/providers/peertube.js').sepiaSearchUrl('dracula', 0, 'relevance', 'fr'), /languageOneOf=fr/, 'PeerTube is asked too');

// M13: LANGUAGE among the filters, typed `lang:` or pressed, with the others, in the address.
const filters = require('./media-list-out/web/web-filters.js');
const typed = filters.parseWebSearch('dracula lang:french in:youtube');
assert.equal(typed.lang, 'fr', 'a name, a code or a library code');
assert.equal(filters.parseWebSearch('x lang:fre').lang, 'fr');
assert.equal(filters.formatWebSearch(typed), 'dracula in:youtube lang:fr', 'written back as a code');
assert.equal(filters.parseWebSearch('x lang:fr lang:any').lang, undefined, 'any clears it');
assert.equal(filters.parseWebSearch('x lang:nonsense').lang, undefined, 'an unknown word is no filter');
assert.equal(filters.withFilter('dracula', 'lang', 'de'), 'dracula lang:de', 'a LANGUAGE key writes it into the box');
assert.equal(filters.withFilter('dracula lang:de', 'lang', 'all'), 'dracula', '... and ANY takes it out');
assert.equal(filters.searchAddress(typed), '/media?q=dracula&in=youtube&lang=fr', 'the address carries it');
assert.equal(filters.boxFromAddress(new URLSearchParams('q=dracula&lang=fr')), 'dracula lang:fr', '... and is read back');
assert.equal(filters.withoutFilters('dracula lang:fr'), 'dracula', 'RESET FILTERS clears it');
assert.ok(filters.hasFilters(typed));
assert.equal(filters.withAuthor('x lang:fr', 'Somebody'), 'from:Somebody lang:fr', 'a creator keeps the language');
const row = (extra) => ({ platform: 'internet_archive', kind: 'video', title: 'A film', ...extra });
const under = (lang, item) => filters.matchesFilters(item, { source: 'all', type: 'all', lang }, false);
assert.ok(under('fr', row({ language: 'fre' })) && !under('de', row({ language: 'fre' })), 'a row its platform says is French');
assert.ok(under('ja', row({ title: 'となりのトトロ' })), 'a row whose words are plainly Japanese');
assert.ok(!under('fr', row({})) && under('en', row({})), 'a row that says nothing: not French, but English (no flag means the site language)');
assert.ok(filters.suggestFilterValues('lang', 'fr').some((option) => option.word === 'fr'), 'typing lang: offers the languages');
assert.match(stream, /<FilterRow label="LANGUAGE">/, 'the LANGUAGE row in FILTERS');
assert.match(stream, /onClick=\{\(\) => pickFilter\('lang', option\.value\)\}/, '... its keys set it like the others');
assert.match(stream, /OTHER SITES SHOW A ROW ONLY WHEN ITS LANGUAGE IS KNOWN/, '... and say plainly which sites can be asked');
assert.match(stream, /\.\.\.\(what\.filters\.lang !== undefined \? \{ lang: what\.filters\.lang \} : \{\}\),/, 'the language goes to the sources');
assert.match(stream, /<WebPickedList key=\{boxFilters\.lang \?\? 'any'\}/, 'PICKS follows it');
assert.match(read('app/api/web/search/route.ts'), /const lang = filterLanguage\(params\.get\('lang'\) \?\? undefined\) \?\? undefined;/, 'the route reads only a real language');

// ORDER (Luke, 2026-11-14: "make the order settings be a separate expandable button to the right of view and filters").
assert.ok(stream.indexOf('data-filters-key') < stream.indexOf('data-view-toggle') && stream.indexOf('data-view-toggle') < stream.indexOf('data-order-toggle'), 'FILTERS, VIEW, then ORDER');
assert.match(stream, /aria-expanded=\{folds\.has\('media-order'\)\} aria-controls="media-order-panel" className=\{FOLD_KEY\} data-order-toggle>\n\s*\{`\[ ORDER: \$\{orderLabel\(boxSort\)\} \]`\}/, 'it says the order and whether it is open');
assert.match(stream, /className="flex flex-col items-start gap-1 py-1" data-order-panel>/, 'its choices one to a line');
assert.ok(!stream.includes('<FilterRow label="ORDER">'), 'not in FILTERS any more');
assert.match(stream, /const FOLD_IDS = \['media-filters', 'media-view', 'media-order',/, 'this browser remembers it open or shut');
assert.match(stream, /orderLabel\(sortOf\(search\)\),/, 'the SHOWING line still says the order');

// The feedback key (the YOUR YOUTUBE session's FeedbackKey, 2026-11-14), last on a row's key line, and on KINO and server cards.
assert.ok(stream.indexOf('<WebDiscussKey item={item} onOpen={opened} short />') < stream.indexOf('<FeedbackKey item={{ kind: \'media\', ref: item.id'), 'a row: after + LETTER / PLAYLIST and the pen');
assert.match(stream, /\{full \? <FeedbackKey item=\{\{ kind: 'media', ref: item\.id, title: item\.title, maker: item\.creator \?\? '', words:/, '... not in COMPACT, which keeps only the main keys');
assert.equal((mediaRow.match(/<FeedbackKey item=\{\{ kind: 'media', ref: item\.id/g) ?? []).length, 2, 'KINO and server cards, after + LETTER');

// M14: MEDIA keeps its place while the reader is in another module, for an hour, in this page's memory only.
const keep = require('./media-list-out/web/media-keep.js');
const T = 1_000_000;
keep.keepMedia({ address: 'q=dracula', at: T, scroll: 900, state: { rows: 3 } });
assert.deepEqual(keep.keptFor('q=dracula', T + 1000)?.state, { rows: 3 }, 'the same address: as it was');
assert.equal(keep.keptFor('', T + 1000)?.address, 'q=dracula', 'plain /media (the MEDIA key): as it was, with its address');
assert.equal(keep.keptFor('q=other', T + 1000), null, 'another address is a new search');
assert.ok(keep.keptFor('q=dracula', T + 1000) !== null, 'taking it leaves it (a page drawn twice finds it both times)');
assert.equal(keep.keptFor('q=dracula', T + keep.KEEP_MS + 1), null, 'older than an hour: searched again');
assert.equal(keep.keptFor('q=dracula', T + 1000), null, '... and forgotten');
assert.doesNotMatch(read('app/lib/web/media-keep.ts'), /localStorage|sessionStorage|indexedDB|fetch\(|supabase/, 'memory only: a reload starts fresh');
assert.match(stream, /const \[restored\] = useState\(\(\) => \(typeof window === 'undefined' \? null : keptFor<KeptMedia>\(params\.toString\(\)\)\)\);/, 'read once, in the browser');
assert.match(stream, /const \[asking, setAsking\] = useState<Source\[\]>\(\(\) => \(back !== undefined \? \[\] :/, 'back as it was: nothing is waited on');
assert.match(stream, /if \(restored !== null\) \{\n[\s\S]{0,900}?return;\n    \}\n    for \(const source of sourcesFor\(shown\)\) ask\(/, '... and none of the sources is asked');
assert.match(stream, /if \(restored\.state\.related === null\) askRelated\(generation\.current, restored\.state\.shown\);/, '... but RELATED is, when it had not answered before the page went (review, 2026-11-14)');
assert.match(stream, /if \(last !== null && last\.asking === 0\) keepMedia<KeptMedia>/, 'kept when the page goes, unless a source was still being asked');
assert.match(stream, /document\.addEventListener\('scroll', note, \{ capture: true, passive: true \}\);/, 'every scroll is heard, whichever box scrolls (the list is empty when the page opens; review, 2026-11-14)');
assert.match(stream, /latest\.current\.scroll = scrollBox\(root\.current\)\.scrollTop;/, '... read from the box that scrolls now');

console.log('ok: MEDIA list items held (M1 Shorts, M2 KINO and YOUR YOUTUBE, M3 one-press filters, M4 VIEW key, M5-M11 the rows, M12 book languages, M13 LANGUAGE filter, M14 MEDIA keeps its place)');
