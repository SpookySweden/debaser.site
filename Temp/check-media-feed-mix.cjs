/*
 * MEDIA's default feed, the shared pieces (SPEC-media-feed.md; app/lib/web/feed-mix.ts, passed-over.ts, brief/mock-brief.ts):
 *   npx tsc app/lib/web/feed-mix.ts app/lib/web/passed-over.ts app/lib/web/brief/mock-brief.ts app/lib/web/brief/addresses.ts --outDir Temp/out-media-feed-mix --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --strictNullChecks
 *
 * Updated on purpose 2026-11-17 (SPEC-media-feed-v2.md, Luke: "All A"): the fixed 12-place pattern is gone, replaced by the
 * ranker, which `Temp/check-media-feed-rank.cjs` holds (screens, limits, late sources, the page). What stays here:
 * - reading's turns: kinds by the reader's history (even for a visitor); one outlet never twice running within a kind and
 *   never more than twice in 8 reading places; Hacker News's own order; better-fitting rows first within an outlet
 * - what the history says about reading (opens by kind) and what stays out (opened lately)
 * - the passed-over rule (3 days, a week's rest, 500 rows, 14 days); the mock reading passes the page's address check
 */
const { join } = require('node:path');

const OUT = join(__dirname, 'out-media-feed-mix', 'lib', 'web');
const mix = require(join(OUT, 'feed-mix.js'));
const passed = require(join(OUT, 'passed-over.js'));
const { mockBrief } = require(join(OUT, 'brief', 'mock-brief.js'));
const { readingRowAddresses } = require(join(OUT, 'brief', 'addresses.js'));

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
let n = 0;
const item = (platform, extra = {}) => {
  n += 1;
  return { id: `${platform}:x${n}`, platform, externalId: `x${n}`, kind: 'video', url: '', canonicalUrl: '', title: `Row number ${n} of ${platform}`, creator: `maker ${n}`, publishedAt: new Date(NOW - n * 60_000).toISOString(), fetchedAt: new Date(NOW).toISOString(), ...extra };
};
const reading = mockBrief(NOW).map(({ kind, item: row }) => ({ kind, item: row }));
const ids = (rows) => rows.map((row) => row.item.id);
const noFit = () => 0;

/** The first `count_` reading rows the chooser gives, nothing else placed in between. */
function choose(rows, context, count_) {
  const next = mix.readingChooser(rows, { visitor: false, readingOpens: {}, fit: noFit, now: NOW, ...context });
  const shown = new Set();
  const out = [];
  for (let i = 0; i < count_; i += 1) {
    const row = next((one) => !shown.has(one.id));
    if (row === null) break;
    shown.add(row.item.id);
    out.push(row);
  }
  return out;
}

/* ------------------------------------------------------------------ reading's turns */
const kindsOf = (rows) => rows.map((row) => row.kind);
const BIG_READING = ['paper', 'news', 'longread', 'tech'].flatMap((kind) =>
  Array.from({ length: 30 }, (_, i) => ({ kind, item: item(kind, { outlet: `${kind.toUpperCase()} OUTLET ${i % 3}`, creator: undefined }) })),
);
const even = kindsOf(choose(BIG_READING, {}, 24));
for (const kind of ['paper', 'news', 'longread', 'tech']) ok(even.filter((one) => one === kind).length === 6, `no history: ${kind} gets an even turn (${even.filter((one) => one === kind).length} of 24)`);
const paperReader = kindsOf(choose(BIG_READING, { readingOpens: { paper: 9 } }, 24));
ok(paperReader.filter((one) => one === 'paper').length === 12, `9 papers opened: papers take every other reading place (${paperReader.filter((one) => one === 'paper').length} of 24)`);
ok(paperReader.filter((one) => one === 'news').length >= 3, 'the kinds never opened still come round');
ok(mix.kindShare(0) === 1 && mix.kindShare(3) === 2 && mix.kindShare(6) === 3 && mix.kindShare(60) === 3, 'a kind gains a share per 3 opens, at most two');
const visitorKinds = kindsOf(choose(BIG_READING, { readingOpens: { paper: 9 }, visitor: true }, 24));
ok(visitorKinds.filter((one) => one === 'paper').length === 6, 'a visitor gets the even turn whatever is handed in');
const readingRows = choose(BIG_READING, {}, 120);
for (const kind of ['paper', 'news']) {
  const outlets = readingRows.filter((row) => row.kind === kind).map((row) => row.item.outlet);
  ok(outlets.every((outlet, i) => i === 0 || outlet !== outlets[i - 1]), `${kind}: one outlet never twice running`);
}
for (let i = 0; i + 8 <= readingRows.length; i += 1) {
  const window = readingRows.slice(i, i + 8).map((row) => row.item.outlet);
  ok(window.every((outlet) => window.filter((one) => one === outlet).length <= 2), `reading places ${i + 1}-${i + 8}: no outlet more than twice`);
}
const hn = Array.from({ length: 6 }, (_, i) => ({ kind: 'tech', item: item('tech', { outlet: 'HACKER NEWS', publishedAt: new Date(NOW - (6 - i) * 3_600_000).toISOString() }) }));
same(ids(choose(hn, {}, 6)), hn.map((row) => row.item.id), 'Hacker News keeps its own front-page order, not newest first');
const tasty = [
  { kind: 'paper', item: item('paper', { outlet: 'ARXIV', tags: ['economics'] }) },
  { kind: 'paper', item: item('paper', { outlet: 'ARXIV', tags: ['neuroscience'] }) },
];
const leaning = choose(tasty, { fit: (row) => ((row.tags ?? []).includes('neuroscience') ? 3 : 0) }, 2);
ok(leaning[0].item.id === tasty[1].item.id, 'within a kind, the row that fits the reader better comes first');
const tomorrow = kindsOf(choose(BIG_READING, { now: NOW + 86_400_000 }, 4));
ok(JSON.stringify(tomorrow) !== JSON.stringify(kindsOf(choose(BIG_READING, {}, 4))), 'a different day leads with a different kind');
same(ids(choose(BIG_READING, {}, 24)), ids(choose(BIG_READING, {}, 24)), 'the same visit gives the same turns');

/* ------------------------------------------------------------------ what the history says */
const history = [
  { kind: 'media', ref: 'paper:arxiv-1', action: 'opened', lastAt: new Date(NOW - 86_400_000).toISOString() },
  { kind: 'media', ref: 'paper:arxiv-2', action: 'finished', lastAt: new Date(NOW - 2 * 86_400_000).toISOString() },
  { kind: 'media', ref: 'news:bbc-1', action: 'opened', lastAt: new Date(NOW - 40 * 86_400_000).toISOString() },
  { kind: 'media', ref: 'tech:hn-1', action: 'not_for_me', lastAt: new Date(NOW).toISOString() },
  { kind: 'song', ref: 'paper:x', action: 'played', lastAt: new Date(NOW).toISOString() },
];
same(mix.readingOpens(history, NOW), { paper: 2 }, 'reading opens count the last 30 days of MEDIA rows, by kind');
same([...mix.openedLately(history, NOW)].sort(), ['paper:arxiv-1', 'paper:arxiv-2'], 'opened lately: the last 30 days only, presses excluded');

/* ------------------------------------------------------------------ passed over */
const DAY = 86_400_000;
let store = {};
store = passed.withFirstBlock(store, ['a', 'b'], NOW);
store = passed.withFirstBlock(store, ['a', 'b'], NOW + 1000);
ok(passed.restingIds(store, NOW).size === 0, 'twice on one day is one day');
store = passed.withFirstBlock(store, ['a', 'b'], NOW + DAY);
store = passed.withOpenedRow(store, 'b');
store = passed.withFirstBlock(store, ['a', 'b'], NOW + 2 * DAY);
same([...passed.restingIds(store, NOW + 2 * DAY)], ['a'], 'shown on 3 days without being opened rests; opened (b) starts again');
ok(passed.restingIds(store, NOW + 9 * DAY).size === 0 && passed.restingIds(store, NOW + 8 * DAY).size === 1, 'the rest lasts a week from the third day');
const old = passed.withFirstBlock({ z: { days: [Math.floor(NOW / DAY) - 20] } }, ['a'], NOW);
ok(!('z' in old), 'a row not shown for 14 days is forgotten');
const big = passed.withFirstBlock({}, Array.from({ length: 700 }, (_, i) => `id${i}`), NOW);
ok(Object.keys(big).length === passed.PASSED_MAX, 'at most 500 rows are kept');

/* ------------------------------------------------------------------ mock reading */
for (const row of reading) ok(readingRowAddresses(row.item).link === row.item.url, `mock reading: ${row.item.id} passes the page's address check`);
ok(new Set(reading.map((row) => row.kind)).size === 4, 'mock reading has all four kinds');

console.log(`check-media-feed-mix: ${count} passed`);
process.exitCode = 0;
