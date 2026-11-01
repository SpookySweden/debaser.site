/*
 * WEB search filters (SOURCE and TYPE), offline (SPEC-web-search.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/web-filters.ts --outDir Temp/out-web-filters --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the SOURCE choices come from the platform registries (SAVED, every stream or search platform; not Vimeo)
 * - typed filters (`in:youtube`, `type:audio`, aliases, quotes) are read out of the box; unknown values are dropped
 * - the keys write into the box, so keys and typed words never disagree; words are untouched
 * - the address carries the same search (`?q=&in=&type=`) and reads back to the same box
 * - the filters decide which sources are asked: YouTube only when YouTube and video are allowed
 * - rows are kept only when they match; SAVED means from the stream
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
  // Updated on purpose 2026-11-01 (SPEC-media-servers.md): each media server in media-servers.ts is a choice too,
  // whichever servers the Debaser Servers program has listed.
  ['ALL', 'SAVED', 'INTERNET ARCHIVE', 'PEERTUBE', 'OPENVERSE', 'PODCAST', 'YOUTUBE', 'WIKIMEDIA COMMONS', ...require(join(OUT, 'media-servers.js')).MEDIA_SERVERS.map((server) => server.label)],
  'SOURCE: ALL, SAVED, every platform the stream reads or a search asks (Vimeo, link-only, is not one), every media server',
);
same(f.TYPE_OPTIONS.map((option) => option.label), ['ALL', 'VIDEO', 'AUDIO', 'IMAGE', 'TEXT'], 'TYPE choices');

/* ---------------------------------------------------------------- reading the box */
same(f.parseWebSearch('night of the living dead in:youtube type:video'), { text: 'night of the living dead', source: 'youtube', type: 'video' }, 'filters taken out of the words');
same(f.parseWebSearch('type:AUDIO piano IN:Internet-Archive'), { text: 'piano', source: 'internet_archive', type: 'audio' }, 'any case, any order, hyphenated names');
same(f.parseWebSearch('in:archive x in:commons'), { text: 'x', source: 'wikimedia_commons', type: 'all' }, 'aliases; the last of a filter wins');
same(f.parseWebSearch('in:"saved" y'), { text: 'y', source: 'saved', type: 'all' }, 'a quoted value');
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
same(f.searchAddress({ text: 'night dead', source: 'internet_archive', type: 'audio' }), '/web?q=night+dead&in=internet-archive&type=audio', 'the address');
same(f.searchAddress({ text: '', source: 'all', type: 'all' }), '/web', 'nothing set: just /web');
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
same(asked({ source: 'saved', type: 'all' }), { stream: true, live: [] }, 'in:saved asks the stream only');
same(asked({ source: 'wikimedia_commons', type: 'all' }), { stream: false, live: ['wikimedia_commons'] }, 'in:wikimedia-commons does not read the stream (it holds none)');
same(asked({ source: 'podcast', type: 'all' }), { stream: true, live: [] }, 'in:podcast: the stream only');

/* ---------------------------------------------------------------- which rows stay */
const yt = { platform: 'youtube', kind: 'video' };
ok(f.matchesFilters(yt, { source: 'all', type: 'all' }, false), 'no filter keeps everything');
ok(!f.matchesFilters(yt, { source: 'all', type: 'audio' }, true), 'a video is not audio');
ok(!f.matchesFilters(yt, { source: 'peertube', type: 'all' }, true), 'a YouTube row is not PeerTube');
ok(f.matchesFilters(yt, { source: 'saved', type: 'video' }, true) && !f.matchesFilters(yt, { source: 'saved', type: 'video' }, false), 'SAVED: from the stream only');

/* ---------------------------------------------------------------- suggestions */
same(f.suggestFilterValues('in', 'you').map((s) => s.word), ['youtube'], 'in:you suggests youtube');
same(f.suggestFilterValues('type', '').map((s) => s.word), ['video', 'audio', 'image', 'text'], 'type: suggests every kind');
same(f.activeFilter('night in:you', 12), { key: 'in', partial: 'you', start: 9, end: 12 }, 'the caret in a filter value');
same(f.activeFilter('night in:you', 3), null, 'the caret in a word');

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
ok(/authorsOf\(what\.filters\)\[0\] \?\? null, what\.filters\.type\)/.test(page), 'each live source is told the type, so it can search for that kind itself');
const client = readFileSync(join(ROOT, 'app/lib/web/everywhere-client.ts'), 'utf8');
ok(/if \(type !== 'all'\) params\.set\('type', type\);/.test(client), '... and the request carries it');
const route = readFileSync(join(ROOT, 'app/api/web/search/route.ts'), 'utf8');
ok(/SEARCH_KINDS\.find\(\(value\) => value === type\)/.test(route) && /author, kind\);/.test(route), '... and the route hands only a known type on');
ok(/window\.history\.replaceState\(/.test(page) && /searchAddress\(/.test(page), 'the search is put in the address');
ok(/useState\(\(\) => boxFromAddress\(params\)\)/.test(page), 'the page opens on the address search');
ok(/matchesFilters\(item, what\.filters, source === 'stream'\)/.test(page), 'arriving rows are kept only when they match');
ok(!/transition|animate-/.test(page.slice(page.indexOf('role="group" aria-label="Source"'), page.indexOf('emptyLine !== null'))), 'no transitions on the filter keys');

asserts.done();
