/*
 * MEDIA's picks (recommend.ts): the list a reader sees before searching, and that it is never empty.
 *   npx tsc app/lib/web/recommend.ts --rootDir app/lib --outDir Temp/recommend-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { NO_TASTE, dayJitter, pickSeed, recommendOrder, scoreItem, trimCounts, withOpened } = require('./recommend-out/web/recommend.js');

const NOW = Date.parse('2026-11-04T12:00:00Z');
const item = (id, over = {}) => ({ id, platform: 'peertube', title: id, publishedAt: '2026-11-01T00:00:00Z', ...over });
const none = () => [];

// 1. Every row comes back exactly once, whatever the taste: the order can never lose a row or empty a list.
const rows = Array.from({ length: 40 }, (_, i) => item(`r${i}`, { platform: ['peertube', 'youtube', 'podcast'][i % 3], creator: `c${i % 5}` }));
const ordered = recommendOrder(rows, NO_TASTE, none, NOW);
assert.equal(ordered.length, rows.length, 'nothing is lost');
assert.deepEqual([...new Set(ordered.map((row) => row.id))].sort(), rows.map((row) => row.id).sort(), 'and nothing is doubled');
assert.deepEqual(recommendOrder([], NO_TASTE, none, NOW), [], 'an empty page stays empty without an error');

// 2. What the reader has opened comes first: a tag, a creator, and Claude's words as well as the platform's.
const taste = withOpened(withOpened(NO_TASTE, item('seen', { tags: ['Trains'], creator: 'Ada' })), item('seen2', { platform: 'youtube' }), ['jazz']);
assert.equal(taste.tags.trains, 1, 'words are counted lower-cased');
assert.equal(taste.creators.ada, 1, 'and creators');
assert.equal(taste.tags.jazz, 1, "and Claude's words");
const stranger = item('stranger');
assert.ok(scoreItem(item('t', { tags: ['trains'] }), taste, [], NOW) > scoreItem(stranger, NO_TASTE, [], NOW), 'a shared tag scores above a stranger');
assert.ok(scoreItem(item('w'), taste, ['jazz'], NOW) > scoreItem(item('w'), taste, [], NOW), "Claude's words count");
assert.ok(scoreItem(item('a', { creator: 'ADA' }), taste, [], NOW) > scoreItem(item('a', { creator: 'Bob' }), taste, [], NOW), 'a creator they opened, in any case');
const liked = item('liked', { tags: ['trains'], publishedAt: '2020-01-01T00:00:00Z' });
const fresh = Array.from({ length: 8 }, (_, i) => item(`f${i}`, { platform: 'podcast', creator: `p${i}` }));
assert.equal(recommendOrder([...fresh, liked], taste, none, NOW)[0].id, 'liked', 'a match beats newness, even when it is old');

// 3. Fresh beats stale between strangers, on any day's jitter.
for (const at of [NOW, NOW + 86400000, NOW + 2 * 86400000]) {
  const newer = scoreItem(item('n', { publishedAt: new Date(at).toISOString() }), NO_TASTE, [], at) - dayJitter('n', Math.floor(at / 86400000));
  const older = scoreItem(item('o', { publishedAt: '2024-01-01T00:00:00Z' }), NO_TASTE, [], at) - dayJitter('o', Math.floor(at / 86400000));
  assert.ok(newer > older, 'newer scores higher once the jitter is set aside');
}

// 4. Variety: one site cannot fill the top of the list.
const flood = [...Array.from({ length: 12 }, (_, i) => item(`p${i}`, { platform: 'peertube' })), item('y1', { platform: 'youtube' }), item('o1', { platform: 'openverse' })];
const top = recommendOrder(flood, NO_TASTE, none, NOW).slice(0, 6).map((row) => row.platform);
assert.ok(top.includes('youtube') && top.includes('openverse'), `the other sites reach the first six: ${top.join(',')}`);

// 5. Steady all day, different another day: the page holds still, and is not the same every visit for ever.
assert.deepEqual(recommendOrder(rows, NO_TASTE, none, NOW), recommendOrder(rows, NO_TASTE, none, NOW + 3600000), 'the same order within a day');
assert.notDeepEqual(recommendOrder(rows, NO_TASTE, none, NOW).map((r) => r.id), recommendOrder(rows, NO_TASTE, none, NOW + 86400000 * 3).map((r) => r.id), 'another day differs');

// 6. Seeds: never repeats, runs out honestly, the reader's word first, and KINO only ever asks in genres.
const tried = new Set();
let seed;
let guard = 0;
while ((seed = pickSeed({ kino: false, kind: 'audio' }, NO_TASTE, tried, NOW)) !== null) {
  assert.ok(!tried.has(seed), 'no word twice');
  tried.add(seed);
  assert.ok(++guard < 50, 'it stops');
}
assert.ok(tried.size > 0, 'audio has words to try');
assert.equal(pickSeed({ kino: false, kind: 'all' }, { ...NO_TASTE, tags: { trains: 5, jazz: 9 } }, new Set(), NOW), 'jazz', "the reader's strongest word first");
assert.equal(pickSeed({ kino: false, kind: 'all' }, { ...NO_TASTE, tags: { jazz: 9 } }, new Set(['jazz']), NOW) === 'jazz', false, 'not once tried');
const kinoSeed = pickSeed({ kino: true, kind: 'all' }, { ...NO_TASTE, tags: { trains: 9 } }, new Set(), NOW);
assert.notEqual(kinoSeed, 'trains', "KINO's words are genres, not a reader's free tags");
assert.ok(typeof kinoSeed === 'string' && kinoSeed.length > 0, 'and it has some');

// (review 2026-11-04) One empty filter cannot run hundreds of searches: a reader's words are tried only for the top few.
{
  const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`word${i}`, 200 - i]));
  const seen = new Set();
  let word;
  while ((word = pickSeed({ kino: false, kind: 'all' }, { ...NO_TASTE, tags: many }, seen, NOW)) !== null) seen.add(word);
  assert.ok(seen.size <= 10, `${seen.size} words at most for one filter`);
}

// 7. A browser's saved taste cannot grow for ever.
assert.deepEqual(Object.keys(trimCounts({ a: 1, b: 3, c: 2 }, 2)), ['b', 'c'], 'the strongest are kept');

// 8. The page: it orders the stream, asks a word when there is nothing, and says so only at the end. The box is untouched.
const page = fs.readFileSync('app/components/WebStream.tsx', 'utf8');
assert.match(page, /recommendOrder\(page, taste,/, 'the page orders its rows with this');
assert.match(page, /drawn\.map\(renderRow\)/, 'and draws that order');
assert.match(page, /pickPage: after \?\? ''/, 'each row remembers the page it came in');
assert.match(page, /item\.pickPage \?\? ''/, 'and only reorders within it, so LOAD MORE moves nothing: a filter can leave a page with any number of rows');
assert.doesNotMatch(page, /at \+= MAX_PAGE_SIZE/, 'not by counting rows');
assert.match(page, /sortOf\(shown\.filters\)\.sort === 'best'/, 'only under BEST MATCH: DATE and POPULAR keep their own order');
assert.match(page, /noteOpened\(item, item\.pickWords \?\? \[\]\)/, 'opening a row teaches the taste');
assert.match(page, /picked: true \}, null\)/, 'a picked search writes nothing to the address');
assert.doesNotMatch(page, /'NOTHING YET\.'/, 'the old empty line has gone from the picks');
assert.match(page, /what\.query === '' \|\| what\.picked/, 'a picked word asks for no DID YOU MEAN');
assert.match(page, /!empty && shown\.kind !== 'stream' && !browsing \?/, 'and is never called RESULTS FOR: the reader searched for nothing');
const tasteStore = fs.readFileSync('app/lib/web/taste-store.ts', 'utf8');
assert.doesNotMatch(tasteStore, /fetch\(|getClient|supabase/, 'a reader\'s taste stays in their browser');

console.log('ok: MEDIA picks: order, taste, variety, seeds and the page');
