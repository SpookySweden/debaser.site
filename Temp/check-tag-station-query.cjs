/*
 * TAG STATION's questions (SPEC-tag-station.md): the recipe and its address, what it finds, the neighbourhood and its reasons,
 * the near-miss hints, the search box's forgiving suggestions, and the map's label rules.
 *   npx tsc app/lib/tag-station/query.ts app/lib/tag-station/recipe.ts app/lib/tag-station/map-layout.ts app/lib/tag-station/graph.ts app/lib/tag-station/mock-tag-repository.ts --rootDir app/lib --outDir Temp/tag-station-query-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const { buildStationGraph } = require('./tag-station-query-out/tag-station/graph.js');
const { MOCK_STATION_ROWS } = require('./tag-station-query-out/tag-station/mock-tag-repository.js');
const q = require('./tag-station-query-out/tag-station/query.js');
const { EMPTY_RECIPE, hasFilters, listOf, parseRecipe, recipeQuery, withWordIn } = require('./tag-station-query-out/tag-station/recipe.js');
const m = require('./tag-station-query-out/tag-station/map-layout.js');

const item = (id, over = {}) => ({ id, platform: 'peertube', externalId: id, kind: 'video', url: '', canonicalUrl: '', title: `Item ${id}`, publishedAt: '2026-01-01T00:00:00.000Z', fetchedAt: '2026-01-01T00:00:00.000Z', ...over });
const row = (id, words, over) => ({ item: item(id, over), claudeWords: words });
const R = (over = {}) => ({ ...EMPTY_RECIPE, ...over });
const ids = (list) => list.map((one) => one.id).sort();

const rows = [
  row('a', ['dub', 'field recordings', 'bristol'], { kind: 'audio', platform: 'internet_archive', publishedAt: '1994-05-01T00:00:00.000Z' }),
  row('b', ['dub', 'field recordings', 'vocals'], { kind: 'audio', platform: 'internet_archive', publishedAt: '1996-05-01T00:00:00.000Z' }),
  row('c', ['dub', 'bristol', '1990s'], { kind: 'video', publishedAt: '1999-05-01T00:00:00.000Z' }),
  row('d', ['dub', 'field recordings', 'bristol', '1990s'], { kind: 'audio', publishedAt: '2003-05-01T00:00:00.000Z' }),
  row('e', ['jazz', 'vocals'], { kind: 'text', publishedAt: '2010-05-01T00:00:00.000Z' }),
  row('f', ['jazz', 'piano', 'lonely word'], { kind: 'image', tags: ['Piano', 'platform only'], publishedAt: '2020-05-01T00:00:00.000Z' }),
];
const index = q.buildIndex(buildStationGraph(rows));

// 1. The address: everything round-trips, defaults stay out, and junk is dropped rather than obeyed.
const full = R({ tag: 'dub', must: ['bristol', 'field recordings'], any: ['jazz'], not: ['vocals'], strict: 'most', niche: 'rare', near: 'far', src: 'claude', era: '1990s', kind: 'audio', site: 'internet_archive', from: 1990, to: 1999, sort: 'new', view: 'list' });
const params = new URLSearchParams(recipeQuery(full));
assert.deepEqual(parseRecipe(params), full, 'a whole recipe survives its address');
assert.equal(recipeQuery(EMPTY_RECIPE), '', 'nothing chosen makes no query');
assert.equal(recipeQuery(R({ tag: 'dub' })), 'tag=dub', 'defaults stay out of the link');
const junk = parseRecipe(new URLSearchParams('tag=https://evil.example&item=' + 'x'.repeat(400) + '&link=javascript:alert(1)&must=<b>&must=dub&must=dub&strict=always&site=constructor&kind=virus&from=99&to=20000&era=jazz&view=3d'));
assert.equal(junk.tag, null, 'an address is not a word');
assert.equal(junk.item, null, 'an overlong id is dropped');
assert.equal(junk.link, null, 'a non-web link is dropped');
assert.deepEqual(junk.must, ['<b>', 'dub'], 'once each; shown only ever as text');
assert.equal(junk.strict, 'all');
assert.equal(junk.site, null, 'a name on every object is not a platform');
assert.equal(junk.kind, null);
assert.equal(junk.from, null);
assert.equal(junk.to, null);
assert.equal(junk.era, null, 'an era must be an era');
assert.equal(junk.view, 'map');
assert.equal(parseRecipe(new URLSearchParams(Array.from({ length: 40 }, (_, i) => `must=w${i}`).join('&'))).must.length, 12, 'lists are capped');
assert.equal(hasFilters(EMPTY_RECIPE), false);
assert.equal(hasFilters(R({ tag: 'dub', view: 'list', sort: 'new' })), false, 'choosing and showing are not filters');
assert.equal(hasFilters(R({ not: ['x'] })), true);
const moved = withWordIn(R({ must: ['dub'] }), 'dub', 'not');
assert.deepEqual([moved.must, moved.not], [[], ['dub']], 'a word sits in one list at a time');
assert.equal(listOf(moved, 'dub'), 'not');
assert.equal(listOf(withWordIn(moved, 'dub', null), 'dub'), null);

// 2. Must, any, exclude and strictness.
const find = (recipe) => ids(q.matchItems(index, recipe, q.focusOf(index, recipe)));
assert.deepEqual(find(R({ must: ['dub', 'bristol'] })), ['a', 'c', 'd'], 'must: all of them');
assert.equal(q.mustNeeded('most', 3), 2, 'most lets 2 of 3 through');
assert.equal(q.mustNeeded('most', 2), 2);
assert.equal(q.mustNeeded('most', 4), 3);
assert.equal(q.mustNeeded('any', 3), 1);
assert.equal(q.mustNeeded('all', 3), 3);
assert.equal(q.mustNeeded('most', 0), 0);
assert.deepEqual(find(R({ must: ['bristol', 'vocals', '1990s'], strict: 'most', near: 'far' })), ['c', 'd'], 'most: two of three');
assert.deepEqual(find(R({ any: ['piano', 'bristol'] })), ['a', 'c', 'd', 'f'], 'any: at least one');
assert.deepEqual(find(R({ must: ['dub'], not: ['vocals'] })), ['a', 'c', 'd'], 'exclude: none of them');
assert.deepEqual(find(R({ must: ['hipp'] })), [], 'a must-have the map has never heard of finds nothing, not everything');
assert.deepEqual(find(R({ any: ['hipp'] })), [], 'nor does an any-of list of only such words');

// 3. Type, source, era, years, word source.
assert.deepEqual(find(R({ kind: 'audio' })), ['a', 'b', 'd']);
assert.deepEqual(find(R({ site: 'internet_archive' })), ['a', 'b']);
assert.deepEqual(find(R({ era: '1990s' })), ['c', 'd']);
assert.deepEqual(find(R({ from: 1995, to: 1999 })), ['b', 'c'], 'years are inclusive');
assert.deepEqual(find(R({ src: 'platform' })).length, 6, 'the source filter alone still lists items');
const platformOnly = R({ must: ['platform only'], src: 'platform' });
assert.deepEqual(find(platformOnly), ['f']);
assert.deepEqual(find(R({ must: ['platform only'], src: 'claude' })), [], "Claude's words alone don't see a platform's word");

// 4. The niche dial follows how many items carry a word.
assert.equal(q.nicheOfCount(100, 161), 'main');
assert.equal(q.nicheOfCount(9, 161), 'main');
assert.equal(q.nicheOfCount(5, 161), 'mid');
assert.equal(q.nicheOfCount(2, 161), 'rare');
assert.equal(q.nicheOfCount(1, 1000), 'rare');
assert.deepEqual(find(R({ niche: 'rare' })), ['e', 'f'], 'obscure: the items whose words are rare');
assert.equal(q.relatedTags(index, R({ niche: 'rare' }), { kind: 'none', words: [] }, 100).every((one) => one.tag.count <= 2), true, 'and only rare words');

// 5. How far out: near needs two shared words, wider one, far reaches partners of partners.
const fromItem = R({ item: 'a', near: 'near' });
assert.deepEqual(find(fromItem), ['b', 'c', 'd'], 'near: at least two shared words, and never the chosen item itself');
assert.deepEqual(find(R({ tag: 'bristol' })), ['a', 'c', 'd'], 'wider: at least one shared word');
assert.ok(find(R({ tag: 'bristol', near: 'far' })).includes('b'), 'far: reaches items through its partners');
assert.ok(!find(R({ tag: 'bristol' })).includes('b'));

// 6. The order is fixed and says what it says.
const sorted = (recipe) => q.sortItems(index, q.matchItems(index, recipe, q.focusOf(index, recipe)), recipe, q.focusOf(index, recipe)).map((one) => one.id);
assert.deepEqual(sorted(R({ sort: 'new' })), ['f', 'e', 'd', 'c', 'b', 'a'], 'newest first');
assert.equal(sorted(R({ sort: 'tagged' }))[0], 'f', 'most words first');
assert.equal(sorted(R({ sort: 'rare' }))[0], 'f', 'rarest first');
assert.equal(sorted(R({ item: 'c' }))[0], 'd', 'closest: most shared, rare words counting most');
assert.deepEqual(sorted(R({ item: 'c' })), sorted(R({ item: 'c' })), 'the same every time');

// 7. Related words carry a reason that is true of the data.
const related = q.relatedTags(index, R({ tag: 'dub' }), q.focusOf(index, R({ tag: 'dub' })));
const bristol = related.find((one) => one.tag.name === 'bristol');
assert.equal(bristol.reason, 'WITH dub ON 3 ITEMS');
assert.equal(bristol.close, true);
assert.ok(!related.some((one) => one.tag.name === 'dub'), 'never itself');
const thinPair = q.relatedTags(index, R({ tag: 'piano' }), q.focusOf(index, R({ tag: 'piano' }))).find((one) => one.tag.name === 'jazz');
assert.equal(thinPair.close, false, 'one shared item is not called close');
assert.equal(thinPair.reason, 'WITH piano ON 1 ITEM');
assert.deepEqual(q.relatedTags(index, R({ tag: 'piano', near: 'near' }), q.focusOf(index, R({ tag: 'piano' }))), [], 'near keeps only pairs with evidence');
const noFocus = q.relatedTags(index, R(), q.focusOf(index, R()));
assert.equal(noFocus[0].tag.name, 'dub', 'no focus: the commonest words');
assert.ok(!q.relatedTags(index, R({ tag: 'dub', not: ['bristol'] }), q.focusOf(index, R({ tag: 'dub' }))).some((one) => one.tag.name === 'bristol'), 'an excluded word is not offered');
assert.equal(q.focusOf(index, R({ must: ['dub', 'nothing like it'] })).words.length, 1, 'must-haves stand in as the focus');
assert.equal(q.focusOf(index, R({ tag: 'Hip Hop nope' })).words.length, 0, 'an unknown word is no focus');
assert.equal(q.focusOf(index, R({ link: 'https://x.example/', tag: null }), ['DUB', 'nope']).words[0], 'dub', "a link's words match through the same rules");

// 8. Same mix, edge picks.
const focusA = q.focusOf(index, R({ item: 'a' }));
const others = q.matchItems(index, R({ item: 'a' }), focusA);
const mix = q.sameMix(index, others, R({ item: 'a' }), focusA, new Set());
assert.ok(mix.length > 0);
assert.ok(mix.every((one) => one.item.id !== 'a'));
assert.ok(mix.some((one) => /INSTEAD OF|ADDS|WITHOUT/.test(one.note)), 'says what differs');
assert.deepEqual(q.sameMix(index, others, R({ tag: 'dub' }), q.focusOf(index, R({ tag: 'dub' })), new Set()), [], 'one word is not a mix');
const edge = q.edgePicks(index, others, focusA, new Set());
assert.ok(edge.length > 0);
assert.deepEqual(q.edgePicks(index, others, { kind: 'none', words: [] }, new Set()), [], 'no focus, no edge');
assert.deepEqual(q.edgePicks(index, others, focusA, new Set(others.map((one) => one.id))), [], 'what is already shown is not repeated');

// 9. Near misses: tried for real, biggest gain first, nothing that gains nothing.
const tight = R({ must: ['dub', 'piano'], not: ['vocals'] });
const tightFocus = q.focusOf(index, tight);
const hints = q.loosenings(index, tight, tightFocus, q.matchItems(index, tight, tightFocus).length);
assert.ok(hints.length > 0 && hints.length <= 3);
assert.ok(hints.every((one) => one.more > 0));
for (const hint of hints) {
  assert.equal(q.matchItems(index, hint.recipe, q.focusOf(index, hint.recipe)).length, hint.more, `${hint.label}: the number is what it finds`);
}
assert.deepEqual([...hints].sort((a, b) => b.more - a.more).map((one) => one.more), hints.map((one) => one.more));
assert.ok(q.loosenings(index, R({ must: ['dub'], not: ['vocals'] }), q.focusOf(index, R({ must: ['dub'] })), 3).some((one) => one.label === 'DROP THE vocals EXCLUSION'), 'names the word');
assert.deepEqual(q.loosenings(index, R(), q.focusOf(index, R()), 6), [], 'nothing set, nothing to loosen');

// 10. The search box forgives.
assert.equal(q.suggest(index, 'dub').tags[0].name, 'dub', 'exact first');
assert.equal(q.suggest(index, 'DUB ').tags[0].name, 'dub', 'any case');
assert.equal(q.suggest(index, 'brist').tags[0].name, 'bristol', 'starts-with');
assert.equal(q.suggest(index, 'recordings').tags[0].name, 'field recordings', 'a later word');
assert.equal(q.suggest(index, 'bristoll').tags[0].name, 'bristol', 'a typo');
assert.equal(q.suggest(index, 'feild recordings').tags[0].name, 'field recordings', 'swapped letters');
assert.deepEqual(q.suggest(index, '').tags, []);
assert.deepEqual(q.suggest(index, '%%%').tags, []);
assert.equal(q.suggest(index, 'lonely wrd').tags.length, 1, 'phrases too');
const titled = q.buildIndex(buildStationGraph([row('x', ['dub'], { title: 'Songs of the Sea', creator: 'Ada' })]));
assert.equal(q.suggest(titled, 'sea ada').items[0].id, 'x', 'items by title and creator');
assert.equal(q.findTag(q.buildIndex(buildStationGraph([row('a', ['hip hop'])])), 'Hip-Hop').name, 'hip hop', 'any spelling finds the word');

// 11. The map's labels: never overlap, never shrink, fewer when there is less room, the chosen word always there.
const mockIndex = q.buildIndex(buildStationGraph(MOCK_STATION_ROWS));
const SIZE = { width: 700, height: 560 };
const overlapping = (labels) => labels.some((a, i) => labels.slice(i + 1).some((b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height));
const placed = m.placeLabels(mockIndex.graph.tags, m.HOME_VIEW, SIZE, 16, []);
assert.ok(placed.length > 5, 'some words show');
assert.ok(!overlapping(placed), 'no two labels overlap');
assert.ok(placed.every((one) => one.height >= 44), 'every label is a 44px target');
assert.ok(placed.every((one) => one.left >= 0 && one.top >= 0 && one.left + one.width <= SIZE.width && one.top + one.height <= SIZE.height), 'all inside the map');
const bigText = m.placeLabels(mockIndex.graph.tags, m.HOME_VIEW, SIZE, 24, []);
assert.ok(bigText.length <= placed.length, 'bigger text shows fewer labels, at the size asked for');
assert.ok(bigText.every((one) => one.width >= m.labelBox(one.tag.name, 24).width || one.width === SIZE.width), 'and never squeezes them');
const rare = [...mockIndex.graph.tags].sort((a, b) => a.count - b.count)[0];
const forcedLabels = m.placeLabels(mockIndex.graph.tags, m.HOME_VIEW, SIZE, 16, [rare.name]);
assert.ok(forcedLabels.some((one) => one.tag.name === rare.name && one.forced), 'the chosen word is always drawn, however rare');
assert.ok(!overlapping(forcedLabels), 'and pushes others out rather than sitting on them');
assert.equal(Math.max(...mockIndex.graph.tags.map((tag) => tag.count)), Math.max(...placed.map((one) => one.tag.count)), 'the commonest word is among those shown');
const zoomedIn = m.placeLabels(mockIndex.graph.tags, m.clampView({ cx: 0.5, cy: 0.5, scale: 1.5 }), SIZE, 16, []);
assert.ok(zoomedIn.length > 0, 'zooming in still shows words');
assert.deepEqual(m.placeLabels(mockIndex.graph.tags, m.HOME_VIEW, { width: 0, height: 0 }, 16, []), [], 'no size yet, no labels');
assert.equal(m.zoomed(1, 1), 1.5);
assert.equal(m.zoomed(1, -1), 1, 'cannot zoom out past the whole map');
assert.equal(m.zoomed(8, 1), 8, 'nor in past the last step');
assert.deepEqual(m.clampView({ cx: 0, cy: 1, scale: 1 }), { cx: 0.5, cy: 0.5, scale: 1 }, 'the whole map stays centred');
assert.deepEqual(m.clampView({ cx: 0, cy: 1, scale: 2 }), { cx: 0.25, cy: 0.75, scale: 2 }, 'a zoomed view stays on the map');

// 12. Arrow keys go to the nearest word that way, and only that way.
const at = (name, left, top) => ({ tag: { name }, left, top, width: 40, height: 44, forced: false });
const grid = [at('centre', 200, 200), at('right', 400, 205), at('farright', 600, 200), at('up', 205, 50), at('diagonal', 300, 300)];
assert.equal(m.nearestInDirection(grid, 'centre', 'right').tag.name, 'right');
assert.equal(m.nearestInDirection(grid, 'centre', 'up').tag.name, 'up');
assert.equal(m.nearestInDirection(grid, 'centre', 'down').tag.name, 'diagonal', 'within 60 degrees');
assert.equal(m.nearestInDirection(grid, 'centre', 'left'), null, 'nothing that way, nothing chosen');
assert.equal(m.nearestInDirection(grid, 'gone', 'left').tag.name, 'centre', 'starts somewhere when the word left the map');
assert.equal(m.nearestInDirection([], 'x', 'left'), null);

// How a word's count reads beside what the page holds (Luke, 2026-11-06: not a bare "ON 19194 ITEMS").
const lineIndex = q.buildIndex({ ...buildStationGraph([]), tags: [{ name: 'jazz', count: 19194, claude: 19194, platform: 0, era: null, facet: null, first: null, latest: null, x: 0, y: 0, partners: [] }, { name: 'rare', count: 2, claude: 2, platform: 0, era: null, facet: null, first: null, latest: null, x: 0, y: 0, partners: [] }, { name: 'one', count: 1, claude: 1, platform: 0, era: null, facet: null, first: null, latest: null, x: 0, y: 0, partners: [] }], items: ['a', 'b'].map((id) => ({ id, platform: 'internet_archive', externalId: id, kind: 'video', url: '', canonicalUrl: '', title: id, publishedAt: '', fetchedAt: '', words: ['jazz', 'rare', 'one'].slice(0, id === 'a' ? 3 : 2).map((word) => ({ word, claude: true, platform: false })) })) });
assert.equal(q.wordItemsLine(lineIndex, 'jazz'), 'ON 19194 ITEMS · 2 FOUND SO FAR', 'the catalogue and what is held');
assert.equal(q.wordItemsLine(lineIndex, 'jazz', true), 'ON 19194 ITEMS · 2 FOUND, ALL FILES READ', 'said plainly when the files ran out short');
assert.equal(q.wordItemsLine(lineIndex, 'rare'), 'ON 2 ITEMS · ALL FOUND');
assert.equal(q.wordItemsLine(lineIndex, 'one'), 'ON 1 ITEM');

// A word to look up: what's typed, unless it's too short or already offered in any spelling.
assert.equal(q.wordToLookUp('  Legal Case ', ['legal']), 'legal case');
assert.equal(q.wordToLookUp('legal-case', ['legal case']), null, 'already offered, whatever the spelling');
assert.equal(q.wordToLookUp('ab', []), null, 'too short to be asked for');
assert.equal(q.wordToLookUp('   ', []), null);

console.log('check-tag-station-query: all passed');
