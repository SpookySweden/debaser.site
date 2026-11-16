/*
 * WHERE FROM's READING group (SPEC-media-feed.md, list 3; app/lib/web/brief/reading-search.ts and its wiring in WebStream.tsx):
 *   npx tsc app/lib/web/brief/reading-search.ts app/lib/web/brief/mock-brief.ts app/lib/web/web-sort.ts --outDir Temp/out-media-reading-filter --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --strictNullChecks
 *
 * - one kind of the brief: its own rows only, the news videos and lectures served under it included
 * - words: every word (title, creator, description, tags, outlet); VIBE's any word; `from:` the creator
 * - BEST MATCH keeps the brief's order; NEWEST and OLDEST by date
 * - pages: `limit` from the offset, the next offset while rows are left, a bad cursor is the start
 * - the page: a READING kind reads the brief alone (sourcesFor), never searches elsewhere for a word when it is empty,
 *   takes its SORT with no words, and lets the brief's own videos through as the kind
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join(__dirname, 'out-media-reading-filter', 'lib', 'web');
const { readingPage } = require(join(OUT, 'brief', 'reading-search.js'));
const { mockBrief } = require(join(OUT, 'brief', 'mock-brief.js'));

process.exitCode = 1;
let count = 0;
const fail = (message) => {
  console.log(`FAIL ${message}`);
  process.exit(1);
};
const ok = (condition, message) => {
  if (!condition) fail(message);
  count += 1;
};
const same = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message}\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-11-16T16:00:00Z');
const row = (kind, id, extra = {}) => ({
  kind,
  item: { id, platform: kind, externalId: id, kind: 'text', url: '', canonicalUrl: '', title: `A story ${id}`, publishedAt: new Date(NOW).toISOString(), fetchedAt: new Date(NOW).toISOString(), ...extra },
});
const at = (hours) => new Date(NOW - hours * 3_600_000).toISOString();
const rows = [
  row('news', 'news:a', { title: 'Rain floods the valley', outlet: 'BBC NEWS', publishedAt: at(5) }),
  row('tech', 'tech:b', { title: 'Rain sensors on a budget', publishedAt: at(1) }),
  row('news', 'youtube:c', { platform: 'youtube', kind: 'video', title: 'Valley rain, a report', creator: 'DW News', publishedAt: at(2) }),
  row('news', 'news:d', { title: 'Elections tomorrow', outlet: 'NPR NEWS', publishedAt: at(9) }),
  row('news', 'news:e', { title: 'Heat in the city', description: 'Rain is not expected', outlet: 'DW', publishedAt: at(3) }),
];
const ids = (page) => page.items.map((item) => item.id);
const ask = (extra) => ({ query: '', cursor: null, limit: 10, ...extra });

/* ---------------------------------------------------------------- one kind */
same(ids(readingPage(rows, 'news', ask({}))), ['news:a', 'youtube:c', 'news:d', 'news:e'], 'NEWS: its own rows, in the brief`s order, its news video included');
same(ids(readingPage(rows, 'tech', ask({}))), ['tech:b'], 'TECH: only its own');
same(ids(readingPage(rows, 'paper', ask({}))), [], 'a kind with nothing is empty');

/* ---------------------------------------------------------------- words, vibe, creator */
same(ids(readingPage(rows, 'news', ask({ query: 'rain' }))), ['news:a', 'youtube:c', 'news:e'], 'words: title or description');
same(ids(readingPage(rows, 'news', ask({ query: 'rain valley' }))), ['news:a', 'youtube:c'], 'every word, as the stream searches');
same(ids(readingPage(rows, 'news', ask({ query: 'elections heat', anyWord: true }))), ['news:d', 'news:e'], 'VIBE: any word');
same(ids(readingPage(rows, 'news', ask({ query: 'npr' }))), ['news:d'], 'the outlet counts as a word');
same(ids(readingPage(rows, 'news', ask({ from: ['dw news'] }))), ['youtube:c'], 'from: the creator');
same(ids(readingPage(rows, 'news', ask({ query: '!!! ...' }))), ['news:a', 'youtube:c', 'news:d', 'news:e'], 'a box with no real word is the whole kind');

/* ---------------------------------------------------------------- order */
same(ids(readingPage(rows, 'news', ask({ order: 'newest' }))), ['youtube:c', 'news:e', 'news:a', 'news:d'], 'NEWEST by date');
same(ids(readingPage(rows, 'news', ask({ order: 'oldest' }))), ['news:d', 'news:a', 'news:e', 'youtube:c'], 'OLDEST by date');

/* ---------------------------------------------------------------- pages */
const first = readingPage(rows, 'news', ask({ limit: 3 }));
same([ids(first), first.nextCursor], [['news:a', 'youtube:c', 'news:d'], '3'], 'a page of 3 and where the next starts');
const second = readingPage(rows, 'news', ask({ limit: 3, cursor: first.nextCursor }));
same([ids(second), second.nextCursor], [['news:e'], null], 'the last page says there is no more');
same(ids(readingPage(rows, 'news', ask({ limit: 3, cursor: '../1' }))), ids(first), 'a cursor that is not an offset is the start');

/* ---------------------------------------------------------------- the mock brief (what the local drive shows) */
const mock = mockBrief(NOW);
for (const kind of ['paper', 'news', 'longread', 'tech']) {
  const page = readingPage(mock, kind, ask({ limit: 50 }));
  ok(page.items.length > 0, `the mock brief has ${kind} rows for a local drive`);
  ok(page.items.every((item) => mock.find((r) => r.item.id === item.id).kind === kind), `and ${kind} gives only its own`);
}

/* ---------------------------------------------------------------- the page's wiring */
const page = readFileSync(join(__dirname, '..', 'app', 'components', 'WebStream.tsx'), 'utf8');
ok(/if \(isReadingSource\(shown\.filters\.source\)\) return canSort\(shown\.filters\.source, sortOf\(shown\.filters\)\) \? \[shown\.filters\.source\] : \[\];/.test(page), 'a READING kind reads the brief alone, words or none, and not under POPULAR');
ok(/isReadingSource\(source\) && what\.kind !== 'link'\) \{[\s\S]{0,200}askBrief\(\)\.then[\s\S]{0,400}readingPage\(rows, source,/.test(page), 'its rows come from the brief the page already holds');
ok(/!isReadingSource\(browsed\.source\)\s*\n?\s*\? pickSeed\(/.test(page), 'an empty READING kind never searches elsewhere with a picked word');
ok(/function readingAware[\s\S]{0,200}isReadingSource\(source\) \? \{ \.\.\.filters, source: 'all' \} : filters/.test(page) && (page.match(/readingAware\(source, /g) ?? []).length === 2, 'the brief`s own videos count as the kind (main list and related sections)');
ok(/const ownLane = \(item: WebItem\) => source === 'stream' \|\| item\.platform === source \|\| isReadingSource\(source\)/.test(page), 'and sit in the kind`s own lane, not the servers` lane');

console.log(`check-media-reading-filter: ${count} passed`);
process.exitCode = 0;
