/*
 * FOR YOU's engine (SPEC-recommender.md, Luke 2026-11-13), offline:
 *   npx tsc app/lib/recommender/engine.ts app/lib/recommender/types.ts app/lib/web/recommend.ts --rootDir app/lib --outDir Temp/recommender-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *
 * - taste from history: finishing counts more than opening, older counts less, NOT FOR ME counts against
 * - a lane: about 7 familiar to 3 new, hidden and already-seen things left out, one maker can't fill it
 * - steady within a day, different on another day
 * - every pick has a why-line in words, and no why-line carries a number of its own making
 * - and, read from the files: the page draws no score, and history is written from every place the spec names
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tasteFromHistory, pickLane, exploreWords, hiddenKeys, keyOf } = require('./recommender-out/recommender/engine.js');

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-13T12:00:00Z');
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const row = (over) => ({ kind: 'media', ref: 'x', title: 'X', maker: '', words: [], action: 'opened', firstAt: at(1), lastAt: at(1), ...over });

// 1. Taste.
const taste = tasteFromHistory(
  [
    row({ ref: 'a', title: 'Nosferatu', maker: 'Murnau', words: ['horror', 'silent film'], action: 'finished', lastAt: at(0) }),
    row({ ref: 'b', title: 'Old jazz', words: ['jazz'], action: 'opened', lastAt: at(60) }),
    row({ ref: 'c', title: 'Clown show', maker: 'Bozo', words: ['clowns'], action: 'not_for_me' }),
  ],
  NOW,
);
assert.ok(taste.tags.horror > taste.tags.jazz, 'finished and recent counts more than opened and two months old');
assert.ok(Math.abs(taste.tags.jazz - 0.25) < 1e-9, 'halving every 30 days');
assert.ok(taste.tags.clowns < 0 && taste.creators.bozo < 0, 'NOT FOR ME counts against its words and maker');
assert.ok(hiddenKeys([row({ ref: 'c', action: 'not_for_me' })]).has('media:c'));

// 2. A lane.
const familiar = Array.from({ length: 14 }, (_, i) => ({ key: keyOf('media', `f${i}`), words: ['horror'], maker: i < 8 ? 'Same Maker' : `Maker ${i}`, item: `f${i}` }));
const fresh = Array.from({ length: 10 }, (_, i) => ({ key: keyOf('media', `n${i}`), words: ['expressionism'], maker: `New ${i}`, item: `n${i}` }));
const other = [
  { key: 'media:a', words: ['horror'], item: 'already seen' },
  { key: 'media:c', words: ['horror'], item: 'hidden' },
  { key: 'media:z', words: ['clowns'], maker: 'Bozo', item: 'against taste' },
];
const history = [
  row({ ref: 'a', title: 'Nosferatu', maker: 'Murnau', words: ['horror'], action: 'finished', lastAt: at(0) }),
  row({ ref: 'c', title: 'Clown show', maker: 'Bozo', words: ['clowns'], action: 'not_for_me' }),
];
const historyTaste = tasteFromHistory(history, NOW);
const explore = exploreWords(historyTaste, (word) => (word === 'horror' ? ['expressionism', 'horror', 'clowns'] : []));
assert.deepEqual([...explore.entries()], [['expressionism', 'horror']], 'one step out: a partner not already in the taste (nor against it)');
const lane = pickLane([...familiar, ...fresh, ...other], { taste: historyTaste, rows: history, explore, now: NOW, size: 10 });
assert.equal(lane.length, 10);
assert.deepEqual(lane.map((pick) => pick.fresh), [false, false, true, false, false, true, false, false, true, false], '7 familiar to 3 new, in steady places');
assert.ok(!lane.some((pick) => ['already seen', 'hidden', 'against taste'].includes(pick.item)), 'seen, hidden and disliked things are left out');
const sameMaker = lane.slice(0, 7).filter((pick) => !pick.fresh && pick.item.startsWith('f') && Number(pick.item.slice(1)) < 8).length;
assert.ok(sameMaker <= 3, `one maker can't fill the lane (${sameMaker} of the first 7)`);
assert.equal(lane[0].why, 'BECAUSE YOU FINISHED NOSFERATU', 'a familiar pick says which thing it is like');
assert.equal(lane[2].why, 'NEW TO YOU: NEAR HORROR', 'a new pick says what it is near');
for (const pick of lane) assert.doesNotMatch(pick.why.replace('NOSFERATU', ''), /\d/, 'no numbers in a why-line');

// 3. Steady per day.
const again = pickLane([...familiar, ...fresh], { taste: historyTaste, rows: history, explore, now: NOW + 3600_000, size: 10 });
const tomorrow = pickLane([...familiar, ...fresh], { taste: historyTaste, rows: history, explore, now: NOW + 3 * DAY, size: 10 });
const ids = (picks) => picks.map((pick) => pick.item).join(',');
assert.equal(ids(again), ids(pickLane([...familiar, ...fresh], { taste: historyTaste, rows: history, explore, now: NOW, size: 10 })), 'the same all day');
assert.notEqual(ids(tomorrow), ids(again), 'different another day');

// 4. An openly shared reason counts, and says itself.
const sharedLane = pickLane([{ key: 'song:s', words: [], maker: 'Someone', item: 's', shared: { why: 'PLAYED BY PEOPLE YOU MESSAGE', weight: 1 } }], { taste: tasteFromHistory([], NOW), rows: [], explore: new Map(), now: NOW, size: 6 });
assert.deepEqual(sharedLane.map((pick) => pick.why), ['PLAYED BY PEOPLE YOU MESSAGE']);

// 5. From the files.
const page = fs.readFileSync('app/components/ForYou.tsx', 'utf8');
assert.doesNotMatch(page, /\.score\b|tasteScore|plays\b.*\}/, 'the page draws no score or count');
assert.match(fs.readFileSync('app/components/ForYouParts.tsx', 'utf8'), /\[ NOT FOR ME \]/, 'every pick has NOT FOR ME (the shared foot, ForYouParts.tsx)');
for (const [file, kind] of [
  ['app/components/WebStream.tsx', "kind: 'media'"],
  ['app/components/TagStation.tsx', "kind: 'media'"],
  ['app/components/MusicPlayerProvider.tsx', "kind: 'song'"],
  ['app/components/reader/ReaderPage.tsx', "kind: 'book'"],
  ['app/components/ForumProvider.tsx', "kind: 'thread'"],
  ['app/components/WatchRoom.tsx', "kind: 'room'"],
  ['app/components/LetterWindow.tsx', "kind: 'letter'"],
  ['app/lore/[slug]/page.tsx', 'kind="lore"'],
]) {
  assert.ok(fs.readFileSync(file, 'utf8').includes(kind), `history is written from ${file}`);
}
assert.match(fs.readFileSync('app/components/reader/ReaderPage.tsx', 'utf8'), /!own && bookRef\) noteHistory/, "a reader's own file stays out of the history");
assert.match(fs.readFileSync('app/components/ForumProvider.tsx', 'utf8'), /!thread\.privateRecord/, "a private stream's record stays out");

// 6. Step 2's lanes (ForYouCommunity.tsx): only what's shared openly, people only when dealt with or openly alike.
const community = fs.readFileSync('app/components/ForYouCommunity.tsx', 'utf8');
assert.match(community, /listedAccounts\(accounts\)/, 'hidden accounts (the test accounts) are never offered');
assert.match(community, /!thread\.privateRecord/, "a private stream's record is never a pick");
assert.match(community, /room\.isPublic && room\.hostId !== me && roomIsLive\(room, now\)/, 'only public rooms live right now, not your own');
assert.match(community, /letter\.isPublic/, 'only public letters');
assert.match(community, /if \(reason === undefined && shared === undefined\) continue;/, "a person is offered only if you've dealt with them or they openly post about your words");
assert.doesNotMatch(community, /user_history|readHistory\(/, "no one else's history is read: picks come from the reader's own and what's public");
assert.doesNotMatch(community, /\{[^{}]*\.(score|plays|closeness|weight)[^{}]*\}\s*<\//, 'no score, play count, closeness or weight is drawn');

console.log('ok: FOR YOU engine: taste, 7 to 3, hidden and seen left out, steady per day, why-lines in words');
