/*
 * Digging through the tagged catalogue (SPEC-discover.md, Luke 2026-11-06): [ MORE ] reads the next files with none read twice, a MEDIA search finds its words, junk titles sink and aren't lost,
 * the DISCOVER filter leads with old and obscure catalogue finds and differs from RECOMMENDED, and what's on the screen stays put.
 *   npx tsc app/lib/tag-station/picks.ts app/lib/tag-station/graph.ts app/lib/tag-station/pool-more.ts app/lib/tag-station/title-quality.ts app/lib/tag-station/supabase-tag-repository.ts app/lib/tag-station/mock-tag-repository.ts app/lib/web/pool-files.ts --rootDir app/lib --outDir Temp/tag-station-dig-out --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const quality = require('./tag-station-dig-out/tag-station/title-quality.js');
const more = require('./tag-station-dig-out/tag-station/pool-more.js');
const cache = require('./tag-station-dig-out/tag-station/pool-file-cache.js');
const picks = require('./tag-station-dig-out/tag-station/picks.js');
const { buildStationGraph } = require('./tag-station-dig-out/tag-station/graph.js');
const { buildIndex, sortItems, edgePicks, focusOf } = require('./tag-station-dig-out/tag-station/query.js');
const { EMPTY_RECIPE } = require('./tag-station-dig-out/tag-station/recipe.js');
const { NO_TASTE } = require('./tag-station-dig-out/web/recommend.js');
const { createSupabaseTagRepository } = require('./tag-station-dig-out/tag-station/supabase-tag-repository.js');
const { getMockTagRepository } = require('./tag-station-dig-out/tag-station/mock-tag-repository.js');
const poolFiles = require('./tag-station-dig-out/web/pool-files.js');

const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-11-06T12:00:00Z');

(async () => {
  // 1. Junk titles, from real ones in the pool. A real short title is left alone.
  for (const junk of ['7', '15', '86_', '2__', '200 000', 'IMG_4198', 'DSC0012', 'Untitled 8', 'untitled', 'video', 'Video 3', 'New file', 'a8f3k2j1x9', 'SAXBc6eK7txaRxpJY', 'dQw4w9WgXcQ', 'S01E03-2', 'S02.2', 'S-F-10.rmvb.mp4', 'qwrtplkjh', '', ' ']) {
    assert.equal(quality.poorTitle(junk), true, `junk: "${junk}"`);
  }
  for (const real of ['1984', '1917', 'Up', 'Se7en', 'Jaws', 'Immigration', 'Vietnam', 'Анна', 'S.W.A.T.', 'Redes_sociales_abiertas_para_todos', 'SB-1.18.15_by_HG_Urmila_Devi', 'Odyssey Book 21', 'MBC Newsdesk 2002-08-15', 'Scrappy\'s Trip To Mars (1938)', 'R2D2']) {
    assert.equal(quality.poorTitle(real), false, `real: "${real}"`);
  }
  assert.equal(quality.poorTitle('Abc123', 'Abc123'), true, 'a title that is just the id, and the id looks like one');
  assert.equal(quality.poorTitle('Inception', 'Inception'), false, 'a title that happens to be the id');

  // 2. Sinking keeps every row and the order inside each part.
  const row = (id, title, over = {}) => ({ id, title, externalId: id, ...over });
  const mixed = [row('x', '7'), row('a', 'First'), row('film', 'No Player', { seenOnly: true }), row('b', 'Second'), row('y', 'IMG_1')];
  assert.deepEqual(quality.sinkPoor(mixed).map((one) => one.id), ['a', 'b', 'film', 'x', 'y'], 'playable, then no player, then junk');
  assert.equal(quality.sinkPoor(mixed).length, mixed.length, 'nothing is deleted');

  // 3. What's on the screen stays where it is. New rows come after it, whatever their score.
  const rowsNow = ['n1', 'a', 'n2', 'b', 'c'].map((id) => ({ id }));
  assert.deepEqual(quality.keepShownFirst(['a', 'b'], rowsNow).map((one) => one.id), ['a', 'b', 'n1', 'n2', 'c']);
  assert.deepEqual(quality.keepShownFirst([], rowsNow).map((one) => one.id), ['n1', 'a', 'n2', 'b', 'c']);
  assert.deepEqual(quality.keepShownFirst(['gone', 'a'], [{ id: 'a' }]).map((one) => one.id), ['a'], 'a row that has left is not invented');

  // 4. A reader's order of files: steady for a seed, different for another, rare part first, none twice.
  const parts = [['r1', 'r2', 'r3'], ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']];
  const one = cache.seededOrder(parts, 'seed-a');
  assert.deepEqual(one, cache.seededOrder(parts, 'seed-a'), 'steady');
  assert.notDeepEqual(one, cache.seededOrder(parts, 'seed-b'), 'differs next time');
  assert.deepEqual(one.slice(0, 3).sort(), ['r1', 'r2', 'r3'], 'the rarest word\'s files first');
  assert.equal(new Set(one).size, 11, 'every file once');

  // 5. How a search reads: the longest word it can be, and what's left has to be in the title.
  const known = new Set(['film noir', 'film', 'jazz', 'trains', 'war', 'legal case']);
  assert.deepEqual(more.searchTerms('Film Noir', known), { terms: ['film noir'], inTitle: [] });
  assert.deepEqual(more.searchTerms('jazz trains', known), { terms: ['jazz', 'trains'], inTitle: [] });
  assert.deepEqual(more.searchTerms('the war of 1812 gallipoli', known), { terms: ['war'], inTitle: ['gallipoli'] }, 'small words and bare numbers are not asked of a title');
  assert.deepEqual(more.searchTerms('nothing here', known).terms, [], 'no word, no rows: titles alone are the outside sites\' job');
  assert.ok(more.searchCandidates('Film Noir classics').includes('film noir'));
  assert.ok(more.searchCandidates('Film Noir classics').includes('film noir classics'));
  assert.ok(!more.searchCandidates('the jazz').includes('the'), 'a small word on its own is not looked up');

  // 6. An asked word stays on the items found by it, even when the map doesn't show it.
  const fileRow = (id, words, title = `Title ${id}`) => ({ platform: 'internet_archive', externalId: id, host: null, kind: 'audio', title, creator: null, publishedAt: null, tmdbRef: null, words });
  const asRow = (id, words) => ({ item: { id: `internet_archive:${id}`, platform: 'internet_archive', externalId: id, kind: 'audio', url: 'https://archive.org/details/x', canonicalUrl: 'https://archive.org/details/x', title: id, publishedAt: '', fetchedAt: '' }, claudeWords: words });
  const shownGraph = { tags: [{ name: 'jazz' }] };
  assert.deepEqual(more.moreItems([asRow('a', ['legal case', 'jazz', 'other'])], shownGraph, ['legal case'])[0].words.map((word) => word.word), ['jazz', 'legal case']);
  assert.deepEqual(more.moreItems([asRow('a', ['legal case'])], shownGraph), [], 'not asked for and not on the map: still left out');
  assert.equal(more.moreItems([asRow('a', ['jazz'])], shownGraph)[0].catalogue, true, 'marked as the catalogue\'s');

  // 7. Digging, against a stand-in for the database and the files: every file reached, none twice, a common word costs fewer files than a rare one.
  const FILES = 20;
  const files = new Map();
  for (let f = 0; f < FILES; f += 1) {
    const rows = [];
    for (let i = 0; i < 20; i += 1) rows.push(fileRow(`f${f}-${i}`, ['jazz', ...(i === 0 ? ['rare one'] : [])], i === 1 ? '7' : `Title ${f}-${i}`));
    files.set(`s/${f}.br`, Buffer.from(poolFiles.encodePoolFile(rows)));
  }
  const log = { reads: [], lists: 0, fail: false };
  const client = {
    from: (table) => {
      const query = {
        select: () => query,
        overlaps: () => query,
        order: () => query,
        in: async (_column, words) => ({ data: words.flatMap((word) => (word === 'jazz' ? [{ id: 1, word, items: 400 }] : word === 'rare one' ? [{ id: 2, word, items: FILES }] : [])), error: null }),
        range: async () => {
          log.lists += 1;
          if (log.fail) return { data: null, error: { code: '57014' } };
          return { data: [...files.keys()].map((one) => ({ path: one })), error: null };
        },
      };
      assert.ok(['web_pool_shards', 'web_word_stats'].includes(table), table);
      return query;
    },
    storage: {
      from: () => ({
        download: async (where) => {
          log.reads.push(where);
          return { data: new Blob([files.get(where)]), error: null };
        },
      }),
    },
  };
  const repository = createSupabaseTagRepository(client);
  const walk = async (ask) => {
    const seen = new Set();
    let from = 0;
    let steps = 0;
    while (from !== null) {
      const step = await repository.poolFiles({ ...ask, from });
      for (const { item } of step.rows) seen.add(item.id);
      from = step.next;
      steps += 1;
      assert.ok(steps < 100, 'digging ends');
    }
    return { seen, steps };
  };
  const common = await repository.poolFiles({ words: ['jazz'], seed: 'a', from: 0 });
  assert.equal(common.files, FILES);
  assert.equal(common.next, 2, 'a common word has enough after two files');
  assert.equal(common.rows.length, 40);
  const rare = await repository.poolFiles({ words: ['rare one'], seed: 'a', from: 0 });
  assert.equal(rare.next, 4, 'the first step, which happens by itself, reads four files at most');
  assert.equal(rare.rows.length, 4);
  assert.equal((await repository.poolFiles({ words: ['rare one'], seed: 'a', from: 4 })).next, 10, 'a press reads six');
  assert.deepEqual(rare.counted, [{ word: 'rare one', items: FILES }]);
  const wholeRare = await walk({ words: ['rare one'], seed: 'a' });
  assert.equal(wholeRare.seen.size, FILES, 'digging reaches every item of a rare word');
  const wholeCommon = await walk({ words: ['jazz'], seed: 'b' });
  assert.equal(wholeCommon.seen.size, FILES * 20, 'and of a common one: a word no longer stops at the first few files');
  const listsBefore = log.lists;
  await repository.poolFiles({ words: ['jazz'], seed: 'c', from: 2 });
  assert.equal(log.lists, listsBefore, 'the list of files is held, not read again for each press');

  // A failed step says so, so the same press can try again, and a place past the end is simply the end.
  const standInFor = (paths, download) => ({
    from: () => {
      const query = { select: () => query, overlaps: () => query, order: () => query, in: async (_column, words) => ({ data: words.map((word) => ({ id: 9, word, items: 1 })), error: null }), range: async () => ({ data: paths.map((where) => ({ path: where })), error: null }) };
      return query;
    },
    storage: { from: () => ({ download }) },
  });
  const failing = createSupabaseTagRepository(standInFor(['s/never-read.br'], async () => ({ data: null, error: { statusCode: '500' } })));
  await assert.rejects(failing.poolFiles({ words: ['failing word'], seed: 'a', from: 0 }), /POOL_FILE/);
  const gone = createSupabaseTagRepository(standInFor(['s/gone.br'], async () => ({ data: null, error: { statusCode: '404' } })));
  assert.equal((await gone.poolFiles({ words: ['gone word'], seed: 'a', from: 0 })).next, null, 'a file that has gone is passed over, not asked for for ever');
  assert.equal((await repository.poolFiles({ words: ['jazz'], seed: 'a', from: 999 })).next, null);

  // A search needs every word; browsing skips junk and takes a spread, within what one answer may carry.
  const every = await repository.poolFiles({ every: [['jazz'], ['rare one']], seed: 'a', from: 0 });
  assert.ok(every.rows.length > 0 && every.rows.every(({ claudeWords }) => claudeWords.includes('rare one') && claudeWords.includes('jazz')));
  const browsed = await repository.poolFiles({ seed: 'a', from: 0 });
  assert.equal(browsed.next, 4, 'browsing reads all a step may, for a spread across files');
  assert.ok(new Set(browsed.rows.map(({ item }) => item.externalId.split('-')[0])).size === 4, 'and takes rows from each of them');
  assert.ok(browsed.rows.length > 0 && browsed.rows.length <= 300);
  assert.ok(browsed.rows.every(({ item }) => item.title !== '7'), 'browsing leaves junk out');
  assert.ok((await repository.poolFiles({ words: ['jazz'], seed: 'a', from: 0 })).rows.some(({ item }) => item.title === '7'), 'but a word still reaches it: nothing is deleted');

  // The mock answers the same way.
  const mock = getMockTagRepository();
  const mockStep = await mock.poolFiles({ seed: '', from: 0 });
  assert.equal(mockStep.next, null);
  assert.ok(Array.isArray(mockStep.rows) && Array.isArray(await mock.poolWords(['jazz'])));

  // 8. The DISCOVER filter leads with old and obscure catalogue finds. For a reader with no history it isn't RECOMMENDED's list.
  const rowOf = (id, words, publishedAt, over = {}) => ({ item: { id, platform: 'internet_archive', externalId: id, kind: 'audio', url: `https://archive.org/details/${id}`, canonicalUrl: `https://archive.org/details/${id}`, title: `Title of ${id}`, publishedAt, fetchedAt: publishedAt, tags: [], ...over }, claudeWords: words, listOnly: id.startsWith('cat') });
  const feed = Array.from({ length: 15 }, (_, i) => rowOf(`feed${i}`, ['news', 'common'], '2026-11-01T00:00:00.000Z'));
  const catalogue = Array.from({ length: 15 }, (_, i) => rowOf(`cat${i}`, ['oddity', `odd${i}`], '2006-01-01T00:00:00.000Z', { creator: `Maker ${i}` }));
  const junk = [rowOf('cat-junk', ['oddity'], '2005-01-01T00:00:00.000Z', { title: '7' })];
  const noPlayer = [{ ...rowOf('film', ['oddity'], '2006-01-01T00:00:00.000Z'), seenOnly: true }];
  const index = buildIndex(buildStationGraph([...feed, ...catalogue, ...junk, ...noPlayer], [], { counted: 20000, words: [] }));
  const discover = picks.discoverList(index, EMPTY_RECIPE, NO_TASTE, 'best', NOW);
  const recommended = picks.recommendedList(index, [], NO_TASTE, 'best', NOW).map((one) => one.item);
  assert.ok(discover.slice(0, 15).every((item) => item.id.startsWith('cat')), `DISCOVER leads with the catalogue: ${discover.slice(0, 15).map((item) => item.id)}`);
  const firstTwelve = (list) => list.slice(0, 12).map((item) => item.id);
  assert.notDeepEqual(firstTwelve(discover), firstTwelve(recommended), 'not the same list');
  assert.equal(firstTwelve(discover).filter((id) => firstTwelve(recommended).includes(id)).length, 0, `no history: no row shared in the first twelve (${firstTwelve(recommended)})`);
  assert.equal(discover[discover.length - 1].title, '7', 'a junk title comes last on DISCOVER');
  assert.equal(recommended[recommended.length - 1].title, '7', 'and on RECOMMENDED');
  assert.equal(discover[discover.length - 2].id, 'film', 'with what has no player just before it');
  assert.equal(picks.discoverList(index, EMPTY_RECIPE, NO_TASTE, 'newest', NOW).at(-1).title, '7', 'whichever SORT is chosen');
  for (const sort of ['best', 'newest', 'oldest', 'popular']) {
    const leads = picks.discoverList(index, EMPTY_RECIPE, NO_TASTE, sort, NOW).slice(0, 12);
    assert.ok(leads.every((item) => item.catalogue), `SORT ${sort}: DISCOVER leads with the catalogue`);
    assert.notDeepEqual(leads.map((item) => item.id), picks.recommendedList(index, [], NO_TASTE, sort, NOW).slice(0, 12).map((one) => one.item.id), `SORT ${sort}: not RECOMMENDED's list`);
  }
  assert.equal(discover.length, 32, 'every row is still there');
  const lovesThis = { ...NO_TASTE, tags: { odd3: 4 } };
  assert.equal(picks.discoverList(index, EMPTY_RECIPE, lovesThis, 'best', NOW)[0].id, 'cat3', 'what the reader has shown they like comes first among the finds');
  const sameMaker = buildIndex(buildStationGraph(Array.from({ length: 8 }, (_, i) => rowOf(`cat${i}`, ['oddity'], '2006-01-01T00:00:00.000Z', { creator: i < 6 ? 'Same Band' : `Other ${i}` })), [], { counted: 20000, words: [] }));
  assert.ok(picks.discoverList(sameMaker, EMPTY_RECIPE, NO_TASTE, 'best', NOW).slice(0, 3).some((item) => item.creator !== 'Same Band'), 'one maker can\'t fill the top');

  // 9. The DISCOVER page: a row titled "7" doesn't come first for a word, and isn't an odd find.
  const jazzRows = [rowOf('cat-7', ['jazz'], '2006-01-01T00:00:00.000Z', { title: '7' }), rowOf('cat-real', ['jazz'], '2006-01-01T00:00:00.000Z')];
  const jazzIndex = buildIndex(buildStationGraph(jazzRows, [], { counted: 20000, words: [] }));
  const recipe = { ...EMPTY_RECIPE, tag: 'jazz' };
  const focus = focusOf(jazzIndex, recipe);
  for (const sort of ['close', 'rare', 'new', 'tagged']) assert.equal(sortItems(jazzIndex, jazzIndex.graph.items, { ...recipe, sort }, focus)[0].title, 'Title of cat-real', `SORT ${sort}`);
  assert.deepEqual(edgePicks(jazzIndex, jazzIndex.graph.items, focus, new Set()).map((item) => item.id), ['cat-real']);

  // 10. A MEDIA search's rows: below the results, with one fixed line above them, its own request, and nothing kept on the way.
  const finds = fs.readFileSync(path.join(ROOT, 'app/components/WebCatalogueFinds.tsx'), 'utf8');
  const stream = fs.readFileSync(path.join(ROOT, 'app/components/WebStream.tsx'), 'utf8');
  assert.ok(finds.includes('min-h-tap'), 'the line above the results keeps one height, whatever it says');
  assert.ok(stream.indexOf('<CatalogueLine') < stream.indexOf('{drawn.map(renderRow)}'), 'the line is above the results');
  assert.ok(stream.indexOf('<WebCatalogueFinds') > stream.indexOf('{drawn.map(renderRow)}'), 'the rows are below them, so arriving moves nothing');
  assert.ok(finds.includes('onScreen.has(item.id) || '), 'a row on the screen is not taken away when an outside site finds it late');
  assert.ok(finds.includes('[...rows.slice(0, shown), ...next]'), 'a press pins the rows it brings into view, or digging moves them');
  for (const file of ['components/WebPickedList.tsx', 'components/TagStation.tsx']) {
    assert.ok(/shown(Count)? \+ (ITEMS_)?STEP\)\.map/.test(fs.readFileSync(path.join(ROOT, 'app', file), 'utf8')), `${file} pins the rows a press brings into view, or digging moves them`);
  }
  const route = fs.readFileSync(path.join(ROOT, 'app/api/tag-station/more/route.ts'), 'utf8');
  // Open to visitors since 2026-11-09: the reader's token is checked first; a refused one reads with the public key.
  assert.ok(route.indexOf('readerToken(request)') > 0 && route.indexOf('readerToken(request)') < route.indexOf('getTagRepository(token)'), "the reader's token is checked before anything is read");
  assert.ok(route.includes('MAX_SEARCH_LENGTH'), 'a search is cut to a length');
  for (const file of ['supabase-tag-repository.ts']) assert.ok(!/\.(insert|update|upsert|delete|upload)\(/.test(fs.readFileSync(path.join(ROOT, 'app/lib/tag-station', file), 'utf8')), `${file} writes nothing`);

  console.log('check-tag-station-dig: all passed');
})().catch((problem) => {
  console.error(problem);
  process.exit(1);
});
