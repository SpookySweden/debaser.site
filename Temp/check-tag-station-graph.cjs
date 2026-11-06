/*
 * TAG STATION's data (SPEC-tag-station.md): one spelling per word, honest closeness, a map that never changes for the same
 * data, and the mock and Supabase repositories reading the same shape with no writes.
 *   npx tsc app/lib/tag-station/graph.ts app/lib/tag-station/graph-cache.ts app/lib/tag-station/mock-tag-repository.ts app/lib/tag-station/supabase-tag-repository.ts --rootDir app/lib --outDir Temp/tag-station-graph-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildStationGraph, MAX_PARTNERS } = require('./tag-station-graph-out/tag-station/graph.js');
const { MIN_SHARED, npmi, strength } = require('./tag-station-graph-out/tag-station/closeness.js');
const { layoutTags } = require('./tag-station-graph-out/tag-station/layout.js');
const { cleanWord, editDistance, eraOf, wordKey } = require('./tag-station-graph-out/tag-station/words.js');
const { stationGraph } = require('./tag-station-graph-out/tag-station/graph-cache.js');
const { MOCK_STATION_ROWS } = require('./tag-station-graph-out/tag-station/mock-tag-repository.js');
const { createSupabaseTagRepository } = require('./tag-station-graph-out/tag-station/supabase-tag-repository.js');

const item = (id, over = {}) => ({ id, platform: 'peertube', externalId: id, kind: 'video', url: '', canonicalUrl: '', title: id, publishedAt: '2026-01-01T00:00:00.000Z', fetchedAt: '2026-01-01T00:00:00.000Z', ...over });
const row = (id, words, over) => ({ item: item(id, over), claudeWords: words });

(async () => {
  // 1. One word, whatever the spelling.
  assert.equal(wordKey('Hip-Hop'), wordKey('hip hop'));
  assert.equal(wordKey('hiphop'), wordKey('HIP  HOP'));
  assert.equal(wordKey('lo-fi'), wordKey('lofi'));
  assert.equal(wordKey('sci-fi'), wordKey('science fiction'), 'the hand-written table joins what squeezing cannot');
  assert.notEqual(wordKey('dub'), wordKey('dubstep'));
  assert.equal(cleanWord('  Field   Recordings '), 'field recordings');
  assert.equal(cleanWord('https://example.org/x'), null, 'an address is not a word');
  assert.equal(cleanWord('---'), null, 'nor punctuation');
  assert.equal(cleanWord('x'.repeat(41)), null, 'nor a sentence');
  assert.equal(cleanWord(7), null);
  assert.equal(eraOf('1920s'), '1920s');
  assert.equal(eraOf('19th century'), '19th century');
  assert.equal(eraOf('jazz'), null);
  assert.equal(eraOf('2000 words'), null);
  assert.equal(editDistance('ambeint', 'ambient', 2), 2);
  assert.equal(editDistance('dub', 'ambient', 2), 3, 'gives up past the limit');

  const merged = buildStationGraph([row('a', ['hip hop', 'jazz']), row('b', ['hip-hop']), row('c', ['hiphop']), row('d', ['hip hop'])]);
  const hipHop = merged.tags.filter((tag) => wordKey(tag.name) === 'hiphop');
  assert.equal(hipHop.length, 1, 'three spellings are one word on the map');
  assert.equal(hipHop[0].name, 'hip hop', 'shown in its commonest spelling');
  assert.equal(hipHop[0].count, 4);

  // 2. NPMI: 1 for words that always meet, near 0 for chance, -1 for never.
  assert.equal(npmi(10, 10, 10, 10), 1);
  assert.ok(Math.abs(npmi(25, 50, 50, 100)) < 1e-9, 'independent words score zero');
  assert.equal(npmi(0, 5, 5, 100), -1);
  assert.ok(npmi(5, 5, 5, 100) > npmi(5, 50, 50, 100), 'big words meeting is less of a surprise than rare ones');

  // 3. Closeness is honest: one shared item is never "close", and it is marked well below a pair several items back.
  assert.equal(MIN_SHARED, 3);
  const thin = buildStationGraph([row('a', ['rare one', 'rare two']), ...Array.from({ length: 4 }, (_, i) => row(`b${i}`, ['dub', 'bass'])), row('z', ['other'])]);
  const rareOne = thin.tags.find((tag) => tag.name === 'rare one');
  const dub = thin.tags.find((tag) => tag.name === 'dub');
  assert.equal(rareOne.partners[0].close, false, 'one shared item does not count as close');
  assert.equal(dub.partners[0].close, true);
  assert.ok(strength(rareOne.partners[0]) < strength(dub.partners[0]), 'and scores below a pair with evidence');

  // 4. Claude's words and the platform's own are kept apart, once each.
  const sources = buildStationGraph([row('a', ['jazz', 'trains'], { tags: ['Jazz', 'brass'] })]);
  assert.deepEqual(sources.items[0].words, [
    { word: 'brass', claude: false, platform: true },
    { word: 'jazz', claude: true, platform: true },
    { word: 'trains', claude: true, platform: false },
  ]);
  assert.equal(sources.tags.find((tag) => tag.name === 'jazz').claude, 1);
  assert.equal(sources.tags.find((tag) => tag.name === 'brass').claude, 0);

  // 5. The map: the same data draws the same map, on every run, with nothing random.
  const realRandom = Math.random;
  Math.random = () => {
    throw new Error('the map must not use Math.random');
  };
  const first = buildStationGraph(MOCK_STATION_ROWS);
  const second = buildStationGraph([...MOCK_STATION_ROWS].reverse());
  Math.random = realRandom;
  assert.deepEqual(first, second, 'same rows in any order, same answer');
  for (const tag of first.tags) {
    assert.ok(tag.x >= 0 && tag.x <= 1 && tag.y >= 0 && tag.y <= 1, `${tag.name} is on the map`);
    assert.ok(tag.partners.length <= MAX_PARTNERS);
  }
  const place = (name) => first.tags.find((tag) => tag.name === name);
  const distance = (a, b) => Math.hypot(place(a).x - place(b).x, place(a).y - place(b).y);
  assert.ok(distance('typography', 'graphic design') < distance('typography', 'linux'), 'words that meet sit nearer than words that never do');
  assert.ok(distance('linux', 'open source') < distance('linux', 'piano'), 'on the mock as well as in principle');

  // 6. Any amount of data, including none.
  for (const size of [0, 1, 2, 3, 4, 5, 13]) {
    const words = Array.from({ length: size }, (_, i) => `word ${i}`);
    const graph = buildStationGraph(size === 0 ? [] : [row('only', words)]);
    assert.equal(graph.tags.length, size, `${size} words`);
    for (const tag of graph.tags) assert.ok(Number.isFinite(tag.x) && Number.isFinite(tag.y), `${size} words: finite`);
  }
  assert.deepEqual(buildStationGraph([row('no words', [])]).tags, [], 'an item with no words yet adds no word');
  assert.equal(buildStationGraph([row('no words', [])]).items.length, 1, 'but still counts as an item');

  // 7. Words past the layout's cut are still placed, beside a partner.
  const cutInput = Array.from({ length: 6 }, (_, i) => ({ name: `w${i}`, count: 6 - i, partners: i === 5 ? [{ name: 'w0', shared: 3, npmi: 0.9, close: true }] : [] }));
  const cutPlaces = layoutTags(cutInput, 4);
  assert.equal(cutPlaces.size, 6);
  assert.ok(Math.abs(cutPlaces.get('w5').x - cutPlaces.get('w0').x) <= 0.03, 'beside its partner');

  // 8. Metadata only: no engagement field reaches the answer, and what the page does not use is gone.
  const hostile = buildStationGraph([row('a', ['jazz'], { description: 'x'.repeat(5000), likes: 9 })]);
  assert.ok(hostile.items[0].description.length <= 400, 'a description is cut');
  const types = fs.readFileSync(path.join(__dirname, '..', 'app/lib/tag-station/types.ts'), 'utf8');
  for (const banned of ['likes', 'views', 'rating', 'downloads', 'followers', 'comments']) {
    assert.ok(!new RegExp(`\\b${banned}\\s*\\??:`).test(types), `no ${banned} field`);
  }

  // 9. The Supabase repository: one read, the words joined on, no write of any kind, and a failure is a plain error.
  const asked = [];
  const answer = (result) => {
    const query = {
      from: (table) => (asked.push(['from', table]), query),
      select: (columns) => (asked.push(['select', columns]), query),
      order: () => query,
      neq: () => query,
      limit: (limit) => (asked.push(['limit', limit]), Promise.resolve(result)),
    };
    return query;
  };
  const dbRow = {
    id: 'peertube:x', platform: 'peertube', external_id: 'x', kind: 'video', url: 'u', canonical_url: 'u', title: 't', creator: null, description: null, thumbnail_url: null, embed_url: null, license_url: null, duration_seconds: null, tags: null, published_at: '2026-01-01T00:00:00+00:00', fetched_at: '2026-01-01T00:00:00+00:00', language: null,
  };
  const rows = await createSupabaseTagRepository(answer({ data: [{ ...dbRow, web_item_tags: { words: ['jazz'] } }, { ...dbRow, id: 'peertube:y', web_item_tags: null }, { ...dbRow, id: 'peertube:z', web_item_tags: [{ words: ['dub'] }] }], error: null })).rows();
  assert.deepEqual(rows.map((one) => one.claudeWords), [['jazz'], [], ['dub']]);
  assert.equal(rows[0].item.externalId, 'x');
  assert.equal(asked[0][1], 'web_items');
  assert.ok(asked[1][1].includes('web_item_tags(words)'));
  assert.ok(asked[2][1] <= 1000, 'a list has a limit');
  await assert.rejects(createSupabaseTagRepository(answer({ data: null, error: { message: 'secret detail' } })).rows(), /could not be read/);
  assert.ok(!/client|supabase|\.rpc\(/i.test(fs.readFileSync(path.join(__dirname, '..', 'app/lib/tag-station/graph.ts'), 'utf8')), 'the graph builder reaches no database');
  for (const file of ['repository.ts', 'supabase-tag-repository.ts', 'mock-tag-repository.ts', 'graph-cache.ts']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app/lib/tag-station', file), 'utf8');
    assert.ok(!/\.(insert|update|upsert|delete|upload|remove)\(/.test(source), `${file} writes nothing`);
    assert.deepEqual([...source.matchAll(/\.rpc\('(\w+)'/g)].map((match) => match[1]).filter((name) => !['web_tag_limit_reached', 'web_pool_shards_for'].includes(name)), [], `${file} only asks whether the limit is reached, and which files hold a word`);
  }
  assert.ok(MOCK_STATION_ROWS.length >= 30, 'the mock has enough to draw');

  // 10. The cache: three hours, shared by readers at once, and a failed read is not kept.
  let reads = 0;
  const read = async () => {
    reads += 1;
    return [row('a', ['jazz'])];
  };
  await assert.rejects(stationGraph(async () => {
    throw new Error('down');
  }, 0));
  const [one, two] = await Promise.all([stationGraph(read, 1000), stationGraph(read, 1000)]);
  assert.equal(reads, 1, 'two readers share one build, and the failure above was not kept');
  assert.equal(one, two);
  await stationGraph(read, 1000 + 179 * 60 * 1000);
  assert.equal(reads, 1, 'kept for three hours, as the words change no faster');
  await stationGraph(read, 1000 + 181 * 60 * 1000);
  assert.equal(reads, 2, 'read again after it');
  // Packed for every server to share: small enough for the cache's 2 MB an item, and back exactly as it went in.
  const zlib = require('node:zlib');
  const bigMap = buildStationGraph(Array.from({ length: 1800 }, (_, i) => row(`shared-${i}`, [`theme ${i % 400}`, `mood ${i % 60}`, `era ${i % 30}`, 'jazz'])));
  const bigJson = JSON.stringify({ graph: bigMap, facts: [] });
  const bigPacked = zlib.brotliCompressSync(Buffer.from(bigJson)).toString('base64');
  assert.ok(bigPacked.length < 1_900_000, `a big map packs to ${bigPacked.length} letters`);
  const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'app/lib/tag-station/graph-shared.ts'), 'utf8');
  assert.ok(/stationIncomplete\(\)/.test(sharedSource) && /throw new Error\('MAP_NOT_SHARED'\)/.test(sharedSource), 'a map missing part of the pool is never shared');
  for (const route of ['graph', 'more']) {
    const routeSource = fs.readFileSync(path.join(__dirname, '..', `app/api/tag-station/${route}/route.ts`), 'utf8');
    assert.ok(routeSource.indexOf('webSignedIn(request)') > 0 && routeSource.indexOf('webSignedIn(request)') < routeSource.indexOf('sharedStationMap(') , `${route}: the session is checked before the shared map is asked for`);
  }
  // A map built while part of the pool couldn't be read is only kept 5 minutes: live, one bad read blanked the lists for 3 hours.
  let poolReads = 0;
  const shortPool = async () => {
    poolReads += 1;
    return { rows: [], swept: { counted: 0, words: [] }, incomplete: true };
  };
  const later = 1e12;
  await stationGraph(read, later, async () => false, async () => [], shortPool);
  await stationGraph(read, later + 4 * 60 * 1000, async () => false, async () => [], shortPool);
  assert.equal(poolReads, 1, 'kept for a few minutes');
  await stationGraph(read, later + 6 * 60 * 1000, async () => false, async () => [], shortPool);
  assert.equal(poolReads, 2, 'then read again');

  // 11. Browser code never brings in the UMAP library or the server's build.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  for (const file of walk(path.join(__dirname, '..', 'app')).filter((name) => /\.tsx?$/.test(name))) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.startsWith("'use client'")) continue;
    assert.ok(!/lib\/tag-station\/(graph|layout|repository|graph-cache|supabase-tag-repository|mock-tag-repository)'/.test(source), `${file} must not import the server's build`);
    assert.ok(!source.includes("'umap-js'"), `${file} must not import UMAP`);
  }

  console.log('check-tag-station-graph: all passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
