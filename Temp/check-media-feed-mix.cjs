/*
 * MEDIA's default feed mix (SPEC-media-feed.md; app/lib/web/feed-mix.ts, passed-over.ts, brief/mock-brief.ts):
 *   npx tsc app/lib/web/feed-mix.ts app/lib/web/passed-over.ts app/lib/web/brief/mock-brief.ts app/lib/web/brief/addresses.ts --outDir Temp/out-media-feed-mix --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --strictNullChecks
 *
 * - the 12-place pattern; reading never more than 2 in 12, even with everything else empty; one LIVE place (SPEC-live-streams.md,
 *   Luke 2026-11-17: "lives mixed in"), FOR YOU's when there are no lives
 * - the fill order (FOR YOU, NEW TO YOU, PEOPLE'S PICKS); no YOUR YOUTUBE for a visitor
 * - the kinds' turns follow the reader's history; one outlet never twice running within a kind; Hacker News's order
 * - repeats, the same work twice, opened, NOT FOR ME and resting rows stay out
 * - the same list every time for the same visit; LOAD MORE and a late source never move a row already drawn
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
const NO_TASTE = { tags: {}, creators: {}, platforms: {} };
let n = 0;
const item = (platform, extra = {}) => {
  n += 1;
  return { id: `${platform}:x${n}`, platform, externalId: `x${n}`, kind: 'video', url: '', canonicalUrl: '', title: `Row number ${n} of ${platform}`, creator: `maker ${n}`, publishedAt: new Date(NOW - n * 60_000).toISOString(), fetchedAt: new Date(NOW).toISOString(), ...extra };
};
const many = (platform, count_, extra) => Array.from({ length: count_ }, () => item(platform, extra));
const lane = (rows, fromBlock = 0) => ({ rows, fromBlock });
const reading = mockBrief(NOW).map(({ kind, item: row }) => ({ kind, item: row }));

function input(over = {}) {
  return {
    forYou: FOR_YOU,
    forYouEnded: false,
    youtube: lane(YT),
    reading: lane(reading),
    discover: lane(NEW),
    people: lane(PEOPLE),
    live: lane(LIVE),
    visitor: false,
    readingOpens: {},
    taste: NO_TASTE,
    dropped: () => false,
    now: NOW,
    ...over,
  };
}
const FOR_YOU = many('internet_archive', 60);
const YT = many('youtube', 30);
const NEW = many('openverse', 30);
const PEOPLE = many('peertube', 30);
const LIVE = many('twitch', 30, { live: true });
const lanes = (rows) => rows.map((row) => row.lane);
const ids = (rows) => rows.map((row) => row.item.id);

/* ------------------------------------------------------------------ the pattern */
const full = mix.mixFeed(input());
same(lanes(full.slice(0, 24)), [...mix.BLOCK_PATTERN, ...mix.BLOCK_PATTERN], 'with every source full, each block follows the 12-place pattern');
// Updated on purpose (SPEC-live-streams.md, 2026-11-17): one of FOR YOU's five places became the LIVE place.
ok(mix.BLOCK_PATTERN.filter((place) => place === 'you').length === 4 && mix.BLOCK_PATTERN.filter((place) => place === 'live').length === 1 && mix.BLOCK_PATTERN.filter((place) => place === 'reading').length === 2, '4 FOR YOU, 1 LIVE and 2 READING places in 12');
same(lanes(mix.mixFeed(input({ live: null })).slice(0, 12)), mix.BLOCK_PATTERN.map((place) => (place === 'live' ? 'you' : place)), 'with no lives, the LIVE place is FOR YOU\'s');
for (let start = 0; start + 12 <= full.length; start += 12) ok(full.slice(start, start + 12).filter((row) => row.lane === 'reading').length <= 2, `block ${start / 12 + 1}: reading at most 2 of 12`);
// Updated on purpose (SPEC-live-streams.md): with four FOR YOU places a block the mock reading (27 rows) runs out first and its
// places borrow FOR YOU rows, so the end is no longer on a block's edge; what holds is that every FOR YOU row is used, and no more.
ok(full.filter((row) => row.lane === 'you').length === FOR_YOU.length && full.length < 12 * 16, `the mix runs until FOR YOU runs out (${full.length})`);
ok(new Set(ids(full)).size === full.length, 'no row twice');

/* ------------------------------------------------------------------ fill order and visitors */
const visitor = mix.mixFeed(input({ visitor: true }));
ok(!visitor.some((row) => row.lane === 'youtube'), "a visitor gets no YOUR YOUTUBE rows, even if some were handed in");
same(lanes(visitor.slice(0, 12)), ['you', 'you', 'you', 'reading', 'live', 'new', 'people', 'you', 'you', 'reading', 'you', 'new'], "a visitor's YouTube places go to FOR YOU");
const noNew = mix.mixFeed(input({ discover: null, people: null, youtube: null }));
same(lanes(noNew.slice(0, 12)), ['you', 'you', 'you', 'reading', 'live', 'you', 'you', 'you', 'you', 'reading', 'you', 'you'], 'empty sources give their places to FOR YOU');
const ended = mix.mixFeed(input({ forYou: FOR_YOU.slice(0, 3), forYouEnded: true, youtube: null }));
same(lanes(ended.slice(0, 12)), ['you', 'you', 'you', 'reading', 'live', 'new', 'people', 'new', 'new', 'reading', 'new', 'new'], 'once the stream has ended, FOR YOU runs out and NEW TO YOU fills, then PEOPLE');
// No lives here either (SPEC-live-streams.md): the LIVE place is never a stand-in, so it would hold one of the twelve.
const endedNoNew = mix.mixFeed(input({ forYou: [], forYouEnded: true, youtube: null, discover: null, live: null }));
ok(endedNoNew.slice(0, 12).filter((row) => row.lane === 'people').length === 10, "with FOR YOU and NEW TO YOU empty, PEOPLE'S PICKS fill");
const onlyReading = mix.mixFeed(input({ forYou: [], forYouEnded: true, youtube: null, discover: null, people: null }));
ok(onlyReading.length === 0, `reading alone, or reading and lives, never becomes the list (${onlyReading.length} rows)`);
const waiting = mix.mixFeed(input({ forYou: [], forYouEnded: false }));
ok(waiting.length === 0, 'while the stream has more to load and nothing yet, nothing is drawn (it waits rather than fill FOR YOU places)');

/* ------------------------------------------------------------------ reading's turns */
const kindsOf = (rows) => rows.filter((row) => row.lane === 'reading').map((row) => row.kind);
const BIG_READING = ['paper', 'news', 'longread', 'tech'].flatMap((kind) =>
  Array.from({ length: 30 }, (_, i) => ({ kind, item: item(kind, { outlet: `${kind.toUpperCase()} OUTLET ${i % 3}`, creator: undefined }) })),
);
const even = kindsOf(mix.mixFeed(input({ reading: lane(BIG_READING), forYou: many('internet_archive', 200) }))).slice(0, 24);
for (const kind of ['paper', 'news', 'longread', 'tech']) ok(even.filter((one) => one === kind).length === 6, `no history: ${kind} gets an even turn (${even.filter((one) => one === kind).length} of 24)`);
const paperReader = kindsOf(mix.mixFeed(input({ reading: lane(BIG_READING), forYou: many('internet_archive', 200), readingOpens: { paper: 9 } }))).slice(0, 24);
ok(paperReader.filter((one) => one === 'paper').length === 12, `9 papers opened: papers take every other reading place (${paperReader.filter((one) => one === 'paper').length} of 24)`);
ok(paperReader.filter((one) => one === 'news').length >= 3, 'the kinds never opened still come round');
ok(mix.kindShare(0) === 1 && mix.kindShare(3) === 2 && mix.kindShare(6) === 3 && mix.kindShare(60) === 3, 'a kind gains a share per 3 opens, at most two');
const visitorKinds = kindsOf(mix.mixFeed(input({ reading: lane(BIG_READING), forYou: many('internet_archive', 200), readingOpens: { paper: 9 }, visitor: true }))).slice(0, 24);
ok(visitorKinds.filter((one) => one === 'paper').length === 6, 'a visitor gets the even turn whatever is handed in');
const readingRows = mix.mixFeed(input({ reading: lane(BIG_READING), forYou: many('internet_archive', 400) })).filter((row) => row.lane === 'reading');
for (const kind of ['paper', 'news']) {
  const outlets = readingRows.filter((row) => row.kind === kind).map((row) => row.item.outlet);
  ok(outlets.every((outlet, i) => i === 0 || outlet !== outlets[i - 1]), `${kind}: one outlet never twice running`);
}
for (let i = 0; i + 8 <= readingRows.length; i += 1) {
  const window = readingRows.slice(i, i + 8).map((row) => row.item.outlet);
  ok(window.every((outlet) => window.filter((one) => one === outlet).length <= 2), `reading places ${i + 1}-${i + 8} (48 rows): no outlet more than twice`);
}
const hn = Array.from({ length: 6 }, (_, i) => ({ kind: 'tech', item: item('tech', { outlet: 'HACKER NEWS', publishedAt: new Date(NOW - (6 - i) * 3_600_000).toISOString() }) }));
const hnRows = mix.mixFeed(input({ reading: lane(hn), forYou: many('internet_archive', 400) })).filter((row) => row.lane === 'reading');
same(ids(hnRows), hn.map((row) => row.item.id), "Hacker News keeps its own front-page order, not newest first");
const tasty = [
  { kind: 'paper', item: item('paper', { outlet: 'ARXIV', tags: ['economics'] }) },
  { kind: 'paper', item: item('paper', { outlet: 'ARXIV', tags: ['neuroscience'] }) },
];
const leaning = mix.mixFeed(input({ reading: lane(tasty), taste: { tags: { neuroscience: 3 }, creators: {}, platforms: {} } })).filter((row) => row.lane === 'reading');
ok(leaning[0].item.id === tasty[1].item.id, "within a kind, the row whose words match the reader's taste comes first");

/* ------------------------------------------------------------------ what stays out */
const dup = FOR_YOU[0];
const twice = mix.mixFeed(input({ youtube: lane([dup, ...YT]) }));
ok(twice.filter((row) => row.item.id === dup.id).length === 1, 'a row in two sources shows once');
const work = { ...YT[0], id: 'youtube:other', title: FOR_YOU[1].title, creator: FOR_YOU[1].creator };
const sameWork = mix.mixFeed(input({ youtube: lane([work, ...YT.slice(1)]) }));
ok(sameWork.filter((row) => row.item.title === FOR_YOU[1].title).length === 1, 'the same work from two platforms shows once');
const gone = new Set([FOR_YOU[0].id, YT[0].id, reading[0].item.id, NEW[0].id]);
const dropping = mix.mixFeed(input({ dropped: (row) => gone.has(row.id) }));
ok(!dropping.some((row) => gone.has(row.item.id)), 'opened, NOT FOR ME and resting rows stay out, from every source');
const history = [
  { kind: 'media', ref: 'paper:arxiv-1', action: 'opened', lastAt: new Date(NOW - 86_400_000).toISOString() },
  { kind: 'media', ref: 'paper:arxiv-2', action: 'finished', lastAt: new Date(NOW - 2 * 86_400_000).toISOString() },
  { kind: 'media', ref: 'news:bbc-1', action: 'opened', lastAt: new Date(NOW - 40 * 86_400_000).toISOString() },
  { kind: 'media', ref: 'tech:hn-1', action: 'not_for_me', lastAt: new Date(NOW).toISOString() },
  { kind: 'song', ref: 'paper:x', action: 'played', lastAt: new Date(NOW).toISOString() },
];
same(mix.readingOpens(history, NOW), { paper: 2 }, 'reading opens count the last 30 days of MEDIA rows, by kind');
same([...mix.openedLately(history, NOW)].sort(), ['paper:arxiv-1', 'paper:arxiv-2'], 'opened lately: the last 30 days only, presses excluded');

/* ------------------------------------------------------------------ the list holds still */
same(ids(mix.mixFeed(input())), ids(full), 'the same visit gives the same list');
const first = mix.mixFeed(input({ forYou: FOR_YOU.slice(0, 7) }));
const more = mix.mixFeed(input({ forYou: FOR_YOU.slice(0, 30) }));
same(ids(more.slice(0, first.length)), ids(first), 'LOAD MORE adds below: every row already drawn stays where it was');
ok(first.length > 0 && first.length < 24 && more.length > first.length, `the first page stops where FOR YOU ran out (${first.length}), the next adds (${more.length})`);
const before = mix.mixFeed(input({ discover: null, forYou: FOR_YOU.slice(0, 15) }));
const fromBlock = Math.ceil(before.length / mix.BLOCK_SIZE);
const after = mix.mixFeed(input({ discover: lane(NEW, fromBlock), forYou: FOR_YOU.slice(0, 15) }));
same(ids(after.slice(0, before.length)), ids(before), 'a source arriving late changes nothing already drawn');
const afterMore = mix.mixFeed(input({ discover: lane(NEW, fromBlock), forYou: FOR_YOU.slice(0, 40) }));
same(ids(afterMore.slice(0, before.length)), ids(before), '...nor after LOAD MORE');
ok(afterMore.slice(fromBlock * 12).some((row) => row.lane === 'new') && !afterMore.slice(0, fromBlock * 12).some((row) => row.lane === 'new'), 'the late source joins from the next block not yet drawn');
const tomorrow = mix.mixFeed(input({ reading: lane(BIG_READING), now: NOW + 86_400_000 }));
const today = mix.mixFeed(input({ reading: lane(BIG_READING) }));
ok(JSON.stringify(kindsOf(tomorrow).slice(0, 4)) !== JSON.stringify(kindsOf(today).slice(0, 4)), 'a different day leads with a different kind');

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

/* ------------------------------------------------------------------ the page drops a confirmed Short before mixing (list 3) */
// Found in the list-3 mock drive: a row YouTube confirmed as a Short drew nothing (WebRow), so every later place moved up one
// (reading in places 3 and 9). The mix must drop it itself, and mix again when YouTube's answer arrives.
{
  const page = require('node:fs').readFileSync(join(__dirname, '..', 'app', 'components', 'WebStream.tsx'), 'utf8');
  const call = page.match(/mixFeed<WebStreamItem>\(\{[\s\S]*?\r?\n {4}\}\);[\s\S]{0,400}?\r?\n {2}\}, \[([^\]]*)\]\);/);
  ok(call && /dropped: \(item\) => [^\n]*\|\| hiddenShortNow\(item\)/.test(call[0]), 'the mix drops a Short YouTube has confirmed (hiddenShortNow)');
  ok(call && /\bshortsSeen\b/.test(call[1]) && /const shortsSeen = useSyncExternalStore\(subscribeShorts, shortsVersion/.test(page), 'and mixes again when YouTube answers (shortsSeen)');
  const hole = FOR_YOU[4];
  const mixed = mix.mixFeed(input({ youtube: null, discover: null, people: null, visitor: true, forYouEnded: true, dropped: (row) => row.id === hole.id }));
  ok(!mixed.some((row) => row.item.id === hole.id) && mixed[3].lane === 'reading' && mixed[9].lane === 'reading' && mixed[15].lane === 'reading', 'a dropped row`s place is filled: reading stays in places 4 and 10');
}

console.log(`check-media-feed-mix: ${count} passed`);
process.exitCode = 0;
