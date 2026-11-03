/*
 * WEB search filters (SOURCE and TYPE), offline (SPEC-web-search.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/web-filters.ts --outDir Temp/out-web-filters --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the SOURCE choices come from the platform registries (every stream or search platform; not Vimeo, not SAVED)
 * - typed filters (`in:youtube`, `type:audio`, aliases, quotes) are read out of the box; unknown values are dropped
 * - the keys write into the box, so keys and typed words never disagree; words are untouched
 * - the address carries the same search (`?q=&in=&type=`) and reads back to the same box
 * - the filters decide which sources are asked: YouTube only when YouTube and video are allowed
 * - rows are kept only when they match
 * - the page: keys with names and pressed states, the suggestion list drawn over the page, the address updated
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { makeAsserts } = require('./web-search-check-kit.cjs');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-filters', 'lib', 'web');
const f = require(join(OUT, 'web-filters.js'));
const asserts = makeAsserts('WEB search filters');
const { ok, same } = asserts;

/* ---------------------------------------------------------------- the choices */
same(
  f.SOURCE_OPTIONS.map((option) => option.label),
  // Updated on purpose 2026-11-02 (Luke): KINO (TMDB alone) after ALL, and no media server is a choice any more
  // ("remove the 'server 1 server 2' search parameters"). 2026-11-03 (Luke): SAVED is no choice any more.
  ['ALL', 'KINO', 'INTERNET ARCHIVE', 'PEERTUBE', 'OPENVERSE', 'PODCAST', 'YOUTUBE', 'WIKIMEDIA COMMONS'],
  'SOURCE: ALL, KINO, every platform the stream reads or a search asks (Vimeo, link-only, is not one); no media server, no SAVED',
);
same(f.TYPE_OPTIONS.map((option) => option.label), ['ALL', 'VIDEO', 'AUDIO', 'IMAGE', 'TEXT'], 'TYPE choices');

/* ---------------------------------------------------------------- reading the box */
same(f.parseWebSearch('night of the living dead in:youtube type:video'), { text: 'night of the living dead', source: 'youtube', type: 'video' }, 'filters taken out of the words');
same(f.parseWebSearch('type:AUDIO piano IN:Internet-Archive'), { text: 'piano', source: 'internet_archive', type: 'audio' }, 'any case, any order, hyphenated names');
same(f.parseWebSearch('in:archive x in:commons'), { text: 'x', source: 'wikimedia_commons', type: 'all' }, 'aliases; the last of a filter wins');
same(f.parseWebSearch('in:"kino" y'), { text: 'y', source: 'kino', type: 'all' }, 'a quoted value');
same(f.parseWebSearch('in:saved y in:stream'), { text: 'y', source: 'all', type: 'all' }, 'SAVED is no SOURCE any more (in:saved, in:stream dropped like any unknown value)');
same(f.parseWebSearch('star wars in:server1'), { text: 'star wars', source: 'all', type: 'all' }, 'a media server is no SOURCE any more (dropped like any unknown value)');
same(f.parseWebSearch('in:kino alien'), { text: 'alien', source: 'kino', type: 'all' }, 'in:kino');
same(f.parseWebSearch('in:tmdb alien'), { text: 'alien', source: 'kino', type: 'all' }, 'in:tmdb is KINO');
same(f.parseWebSearch('cosy rain vibe:on'), { text: 'cosy rain', source: 'all', type: 'all', vibe: true }, 'vibe:on');
same(f.parseWebSearch('cosy vibe:on vibe:off'), { text: 'cosy', source: 'all', type: 'all' }, 'the last vibe: wins; off is no vibe');
same(f.parseWebSearch('cosy vibe:maybe'), { text: 'cosy', source: 'all', type: 'all' }, 'an unknown vibe value is dropped');
same(f.withFilter('cosy', 'vibe', 'on'), 'cosy vibe:on', 'the VIBE key writes vibe:on');
same(f.withFilter('cosy vibe:on in:kino', 'vibe', 'off'), 'cosy in:kino', 'and takes it out');
same(f.searchAddress(f.parseWebSearch('cosy vibe:on')), '/archive?q=cosy&vibe=on', 'the address carries vibe');
same(f.boxFromAddress(new URLSearchParams('q=cosy&vibe=on')), 'cosy vibe:on', 'and reads it back');
same(f.sourcesToAsk({ source: 'kino', type: 'all' }), { stream: true, live: ['kino'] }, 'KINO asks TMDB alone (and the stream, for titles a server holds)');
ok(!f.sourcesToAsk({ source: 'all', type: 'all' }).live.includes('kino'), 'an ALL search never asks KINO');
same(f.sourcesToAsk({ source: 'kino', type: 'audio' }).live, [], 'KINO is never asked for audio');
ok(f.matchesFilters({ platform: 'kino', kind: 'video' }, { source: 'kino', type: 'all' }, false), 'KINO keeps its own rows');
ok(f.matchesFilters({ platform: 'server_1', kind: 'video', media: { type: 'movie', copies: [{ server: 'server_1' }] } }, { source: 'kino', type: 'all' }, true), 'and a media server title from the stream');
ok(!f.matchesFilters({ platform: 'youtube', kind: 'video' }, { source: 'kino', type: 'all' }, true), 'and nothing else from the stream');
same(f.parseWebSearch('in:vidsrc type:movie z'), { text: 'z', source: 'all', type: 'all' }, 'unknown values are dropped, never passed on');
same(f.parseWebSearch('in:__proto__ in:constructor q'), { text: 'q', source: 'all', type: 'all' }, 'object-key tricks are unknown values');
same(f.parseWebSearch('within:youtube tin:x'), { text: 'within:youtube tin:x', source: 'all', type: 'all' }, 'only whole in: / type: words are filters');
same(f.parseWebSearch('https://youtu.be/aqz-KE-bpKQ').text, 'https://youtu.be/aqz-KE-bpKQ', 'a pasted link is left alone');

/* ---------------------------------------------------------------- keys write the box */
same(f.withFilter('night dead', 'in', 'youtube'), 'night dead in:youtube', 'a key adds its filter');
same(f.withFilter('night in:youtube type:audio', 'in', 'peertube'), 'night in:peertube type:audio', 'a key replaces its filter');
same(f.withFilter('night in:youtube type:audio', 'in', 'all'), 'night type:audio', 'ALL takes it out');
same(f.withFilter('in:youtube', 'type', 'video'), 'in:youtube type:video', 'with no words');
for (const option of f.SOURCE_OPTIONS) {
  same(f.parseWebSearch(f.withFilter('w', 'in', option.value)).source, option.value, `the ${option.label} key and the typed word agree`);
}
for (const option of f.TYPE_OPTIONS) {
  same(f.parseWebSearch(f.withFilter('w', 'type', option.value)).type, option.value, `the ${option.label} type key and the typed word agree`);
}

/* ---------------------------------------------------------------- the address */
same(f.searchAddress({ text: 'night dead', source: 'internet_archive', type: 'audio' }), '/archive?q=night+dead&in=internet-archive&type=audio', 'the address');
same(f.searchAddress({ text: '', source: 'all', type: 'all' }), '/archive', 'nothing set: just /archive (the page was /web)');
same(f.boxFromAddress(new URLSearchParams('q=night+dead&in=internet-archive&type=audio')), 'night dead in:internet-archive type:audio', 'the address reads back to the box');
same(f.boxFromAddress(new URLSearchParams('q=x&in=evil.example&type=<b>')), 'x', 'unknown address values are dropped');

/* ---------------------------------------------------------------- who is asked */
const asked = (search) => f.sourcesToAsk(search);
same(asked({ source: 'all', type: 'all' }), { stream: true, live: ['youtube', 'internet_archive', 'wikimedia_commons', 'peertube', 'openverse'] }, 'no filter: everyone');
same(asked({ source: 'all', type: 'audio' }).live, ['internet_archive', 'wikimedia_commons'], 'type:audio never asks YouTube, PeerTube or Openverse');
same(asked({ source: 'all', type: 'image' }).live, ['internet_archive', 'wikimedia_commons', 'openverse'], 'type:image');
ok(!asked({ source: 'all', type: 'text' }).live.includes('youtube'), 'type:text never asks YouTube');
same(asked({ source: 'youtube', type: 'all' }), { stream: true, live: ['youtube'] }, 'in:youtube asks YouTube (and the stream, which holds YouTube channels)');
same(asked({ source: 'youtube', type: 'audio' }).live, [], 'in:youtube type:audio asks no live source');
same(asked({ source: 'wikimedia_commons', type: 'all' }), { stream: false, live: ['wikimedia_commons'] }, 'in:wikimedia-commons does not read the stream (it holds none)');
same(asked({ source: 'podcast', type: 'all' }), { stream: true, live: [] }, 'in:podcast: the stream only');

/* ---------------------------------------------------------------- which rows stay */
const yt = { platform: 'youtube', kind: 'video' };
ok(f.matchesFilters(yt, { source: 'all', type: 'all' }, false), 'no filter keeps everything');
ok(!f.matchesFilters(yt, { source: 'all', type: 'audio' }, true), 'a video is not audio');
ok(!f.matchesFilters(yt, { source: 'peertube', type: 'all' }, true), 'a YouTube row is not PeerTube');

/* ---------------------------------------------------------------- suggestions */
same(f.suggestFilterValues('in', 'you').map((s) => s.word), ['youtube'], 'in:you suggests youtube');
same(f.suggestFilterValues('type', '').map((s) => s.word), ['video', 'audio', 'image', 'text'], 'type: suggests every kind');
same(f.activeFilter('night in:you', 12), { key: 'in', partial: 'you', start: 9, end: 12 }, 'the caret in a filter value');
same(f.activeFilter('night in:you', 3), null, 'the caret in a word');

/* ---------------------------------------------------------------- sort: (SPEC-web-sort.md, 2026-11-02, on purpose) */
same(f.parseWebSearch('night sort:popular in:youtube').sort, 'popular', 'sort: is a fourth filter word');
same(f.formatWebSearch(f.parseWebSearch('sort:oldest night')), 'night sort:oldest', '... written after the others');
same(f.suggestFilterValues('sort', 'o').map((s) => s.word), ['oldest'], 'sort:o suggests oldest');
same(f.activeFilter('night sort:pop', 14), { key: 'sort', partial: 'pop', start: 11, end: 14 }, 'the caret in a sort value');
same(f.withAuthor('night sort:popular', 'Rick'), 'from:Rick sort:popular', 'a creator search keeps the sort');

/* ---------------------------------------------------------------- the page */
const page = readFileSync(join(ROOT, 'app/components/WebStream.tsx'), 'utf8');
ok(/SOURCE_OPTIONS\.map/.test(page) && /TYPE_OPTIONS\.map/.test(page), 'the keys are drawn from the choices');
ok((page.match(/aria-pressed=\{boxFilters\.(source|type) === option\.value\}/g) ?? []).length === 2, 'each key says whether it is on');
ok(/aria-label=\{`Source: \$\{option\.label\}`\}/.test(page) && /aria-label=\{`Type: \$\{option\.label\}`\}/.test(page), 'each key has a name');
ok(/className=\{boxFilters\.source === option\.value \? PLATE_PRESSED : PLATE\}/.test(page), 'keys are the shared plates (44px tap height on a phone)');
ok(/onClick=\{\(\) => pickFilter\('in', option\.value\)\}/.test(page) && /const next = withFilter\(draft, key, value\);/.test(page), 'a key writes its filter into the box');
ok(/className="absolute top-full right-0 left-0 z-menu/.test(page), 'the suggestion list is drawn over the page, so typing never moves the rows');
ok(/max-sm:min-h-tap/.test(page.slice(page.indexOf('role="option"'))), 'a suggestion row is 44px tall on a phone');
ok(/choose\(suggestions\[[^\]]*\]\.word, event\.key === 'Enter'\)/.test(page) && /if \(search\) restart\(next\);/.test(page), 'Enter on a suggestion fills it in and searches (one Enter always searches)');
// The type is followed by VIBE and a related keyword since 2026-11-02, so `type,` as well as `type)`.
ok(/authorsOf\(what\.filters\)\[0\] \?\? null, what\.filters\.type[,)]/.test(page), 'each live source is told the type, so it can search for that kind itself');
const client = readFileSync(join(ROOT, 'app/lib/web/everywhere-client.ts'), 'utf8');
ok(/if \(type !== 'all'\) params\.set\('type', type\);/.test(client), '... and the request carries it');
const route = readFileSync(join(ROOT, 'app/api/web/search/route.ts'), 'utf8');
ok(/SEARCH_KINDS\.find\(\(value\) => value === type\)/.test(route) && /author, kind\);/.test(route), '... and the route hands only a known type on');
ok(/window\.history\.replaceState\(/.test(page) && /searchAddress\(/.test(page), 'the search is put in the address');
ok(/useState\(\(\) => boxFromAddress\(params\)\)/.test(page), 'the page opens on the address search');
ok(/matchesFilters\(item, what\.filters, source === 'stream'\)/.test(page), 'arriving rows are kept only when they match');
ok(!/transition|animate-/.test(page.slice(page.indexOf('role="group" aria-label="Source"'), page.indexOf('emptyLine !== null'))), 'no transitions on the filter keys');
ok(/role="group" aria-label="Sort"/.test(page) && /SORT_OPTIONS\.map/.test(page) && /aria-pressed=\{boxSort\.sort === option\.value\}/.test(page), 'the SORT keys are drawn from the choices and say which is on');
ok(/disabled=\{boxSort\.sort !== 'date'\}/.test(page), 'the flip key works on DATE only, and is disabled (with its reason in its name) otherwise');

asserts.done();
