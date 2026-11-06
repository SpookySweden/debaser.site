/*
 * The catalogue sweep (SPEC-discover.md), offline with fakes: what each source is asked and how it's read, the $50 stop, that nothing is paid for or counted twice, and that the pool stays bounded. The migration only adds.
 *   npx tsc app/lib/tag-station/pool-more.ts app/lib/web/sweep.ts app/lib/web/seen-items.ts app/lib/tag-station/graph.ts app/lib/tag-station/query.ts app/lib/tag-station/supabase-tag-repository.ts app/lib/tag-station/mock-tag-repository.ts --rootDir app/lib --outDir Temp/tag-station-sweep-out --module commonjs --target es2022 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sweep = require('./tag-station-sweep-out/web/sweep.js');
const seen = require('./tag-station-sweep-out/web/seen-items.js');
const poolFiles = require('./tag-station-sweep-out/web/pool-files.js');
const { batchCost, customIdFor, requestFor, worstCaseCost } = require('./tag-station-sweep-out/web/tagging.js');
const { buildStationGraph, MAX_TAGS } = require('./tag-station-sweep-out/tag-station/graph.js');
const q = require('./tag-station-sweep-out/tag-station/query.js');
const { createSupabaseTagRepository } = require('./tag-station-sweep-out/tag-station/supabase-tag-repository.js');
const { getMockTagRepository } = require('./tag-station-sweep-out/tag-station/mock-tag-repository.js');

const ROOT = path.join(__dirname, '..');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function network(routes) {
  const asked = [];
  const fetchImpl = async (input, init) => {
    asked.push({ url: String(input), agent: init?.headers?.['User-Agent'] });
    const url = new URL(String(input));
    for (const [pattern, answer] of routes) {
      if (pattern.test(`${url.hostname}${url.pathname}`)) {
        return answer(url);
      }
    }
    return new Response('nope', { status: 404 });
  };
  return { asked, fetchImpl };
}
const later = () => Date.now() + 60_000;
const deps = (net) => ({ fetch: net.fetchImpl, sleep: async () => undefined, peertubeHosts: new Set(['video.blender.org']) });

let finished = false;
(async () => {
  // 1. Internet Archive: named collections first, its own cursor, and restricted items never.
  const archive = network([[/^archive\.org\/services\/search\/v1\/scrape$/, () => json({ items: [
    { identifier: 'one', title: 'One', creator: 'Ada', description: 'About trains', mediatype: 'audio', subject: ['Trains', 'Jazz'], publicdate: '2020-01-01T00:00:00Z' },
    { identifier: 'two', title: 'Two', mediatype: 'movies', subject: 'a; b', publicdate: '2020-01-01T00:00:00Z' },
    { identifier: 'hidden', title: 'Hidden', mediatype: 'audio', 'access-restricted-item': 'true', publicdate: '2020-01-01T00:00:00Z' },
    { identifier: '../bad', title: 'Bad', mediatype: 'audio', publicdate: '2020-01-01T00:00:00Z' },
  ], cursor: 'next' })]]);
  const fromArchive = await sweep.readArchive({}, later(), deps(archive));
  assert.equal(archive.asked.length, 4, 'four big calls a run, one at a time');
  const first = new URL(archive.asked[0].url);
  assert.ok(first.searchParams.get('q').startsWith('collection:(librivoxaudio OR '), 'named collections, never everything');
  assert.equal(new URL(archive.asked[1].url).searchParams.get('cursor'), 'next', 'follows its cursor');
  assert.deepEqual(fromArchive.items.slice(0, 2).map((one) => one.id), ['internet_archive:one', 'internet_archive:two']);
  assert.equal(fromArchive.items.filter((one) => one.externalId === 'hidden' || one.externalId === '../bad').length, 0, 'restricted and bad ids are dropped');
  assert.deepEqual(fromArchive.items[0].tags, ['Trains', 'Jazz']);
  assert.deepEqual(fromArchive.items[1].tags, ['a', ' b']);
  assert.deepEqual(fromArchive.state, { cursor: 'next', rows: 5000 });
  const stopped = network([[/^archive\.org/, () => json({}, 429)]]);
  assert.deepEqual((await sweep.readArchive({ cursor: 'kept' }, later(), deps(stopped))).state, { cursor: 'kept', rows: 5000 }, 'a 429 stops it and keeps its place');
  const heavy = network([[/^archive\.org/, () => json({}, 500)]]);
  assert.deepEqual((await sweep.readArchive({ cursor: 'kept' }, later(), deps(heavy))).state, { cursor: 'kept', rows: 2500 }, 'a page too heavy to read asks for less next run');
  const lastPage = network([[/^archive\.org/, () => json({ items: [] })]]);
  const allLetters = Object.fromEntries([...'abcdefghijklmnopqrstuvwxyz0123456789'].map((one) => [one, false]));
  assert.deepEqual((await sweep.readArchive({ wider: true, places: allLetters }, later(), deps(lastPage))).state, { done: true }, 'every letter finished: finished, not going round');
  assert.equal(stopped.asked.length, 1, 'with no second try');

  // 2. A fixed agent naming the project, on every source. Never a person.
  for (const one of archive.asked) assert.equal(one.agent, 'DebaserSiteSweep/1.0 (+https://github.com/SpookySweden/debaser.site)');

  // 3. PeerTube: safe for work, instances from the index only. Openverse: few pages, and a 429 stops it.
  const peertube = network([[/^sepiasearch\.org/, () => json({ data: [] })]]);
  await sweep.readPeertube({ start: 300 }, later(), deps(peertube));
  const sepia = new URL(peertube.asked[0].url);
  assert.equal(sepia.searchParams.get('nsfw'), 'false');
  assert.equal(sepia.searchParams.get('start'), '300');
  assert.deepEqual((await sweep.readPeertube({ start: 300 }, later(), deps(peertube))).state, { done: true }, 'nothing more: finished');
  const refused = network([[/^sepiasearch\.org/, () => json({}, 400)]]);
  assert.deepEqual((await sweep.readPeertube({ start: 900000 }, later(), deps(refused))).state, { done: true }, 'a refused deep page: finished, not stuck');
  // Sepia refuses a start of 9,000 or more, so it goes on from the oldest date it reached.
  const page100 = (date) => json({ data: Array.from({ length: 100 }, () => ({ publishedAt: date })) });
  const deep = network([[/^sepiasearch\.org/, () => page100('2024-05-05T00:00:00.000Z')]]);
  const rolled = await sweep.readPeertube({ start: 8900 }, later(), deps(deep));
  assert.ok(new URL(deep.asked[1].url).searchParams.get('endDate') === '2024-05-05T00:00:00.000Z', 'the next call goes back from that date');
  assert.equal(new URL(deep.asked[1].url).searchParams.get('start'), '0');
  assert.ok(deep.asked.every((one) => Number(new URL(one.url).searchParams.get('start')) < 9000), 'and never asks past what it allows');
  assert.equal(rolled.state.before, '2024-05-05T00:00:00.000Z');
  // What sat at exactly that date isn't read twice.
  const video = (id, date) => ({ uuid: id, name: `V ${id}`, url: `https://video.blender.org/videos/watch/${id}`, publishedAt: date, createdAt: date, privacy: { id: 1 }, nsfw: false, account: { name: 'a', host: 'video.blender.org' }, channel: { name: 'c', host: 'video.blender.org' } });
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const edgeNet = network([[/^sepiasearch\.org/, (url) => json({ data: url.searchParams.get('endDate') ? [video(uuid(1), '2024-05-05T00:00:00.000Z'), video(uuid(2), '2024-05-04T00:00:00.000Z')] : Array.from({ length: 100 }, (_, i) => video(uuid(i < 99 ? i + 100 : 1), i < 99 ? '2024-06-01T00:00:00.000Z' : '2024-05-05T00:00:00.000Z')) })]]);
  const edgeRead = await sweep.readPeertube({ start: 8900 }, later(), deps(edgeNet));
  const edgeIds = edgeRead.items.map((one) => one.externalId);
  assert.equal(edgeIds.filter((one) => one === uuid(1)).length, 1, 'the item at the edge is read once');
  assert.ok(edgeIds.includes(uuid(2)), 'and what comes after it is read');
  const sameDate = network([[/^sepiasearch\.org/, () => page100('2024-05-05T00:00:00.000Z')]]);
  assert.deepEqual((await sweep.readPeertube({ start: 8900, before: '2024-05-05T00:00:00.000Z' }, later(), deps(sameDate))).state, { done: true }, 'stuck on one date: finished, not going round');
  const openverse = network([[/^api\.openverse\.org/, () => json({ results: [{}] })]]);
  const fromOpenverse = await sweep.readOpenverse({}, later(), deps(openverse));
  assert.equal(openverse.asked.length, 3, 'three calls a run: its stated allowance is 200 a day, shared with MEDIA');
  assert.equal(fromOpenverse.state.page, 4);
  assert.equal(fromOpenverse.state.calls, 3, 'and they are counted');
  const usedUp = network([[/^api\.openverse\.org/, () => json({ results: [{}] })]]);
  const today = new Date().toISOString().slice(0, 10);
  const spentDay = await sweep.readOpenverse({ page: 9, media: 'audio', day: today, calls: 60 }, later(), deps(usedUp));
  assert.equal(usedUp.asked.length, 0, 'sixty a day at most, leaving the rest of its 200 for MEDIA');
  assert.equal(spentDay.state.page, 9);
  await sweep.readOpenverse({ page: 9, media: 'audio', day: '2020-01-01', calls: 60 }, later(), deps(usedUp));
  assert.equal(usedUp.asked.length, 3, 'and a new day starts again');
  const limited = network([[/^api\.openverse\.org/, () => json({}, 429)]]);
  assert.equal((await sweep.readOpenverse({ page: 7, media: 'audio' }, later(), deps(limited))).state.page, 7, 'a 429 keeps its place');

  // 4. Films from Wikidata: facts and a number, with a plot only for Claude. Films first, then shows, then round.
  const row = { item: { value: 'http://www.wikidata.org/entity/Q10' }, tmdb: { value: '603' } };
  const facts = { item: { value: 'http://www.wikidata.org/entity/Q10' }, label: { value: 'The Film' }, date: { value: '1999-03-31T00:00:00Z' }, article: { value: 'https://en.wikipedia.org/wiki/The_Film' }, genres: { value: 'action|science fiction' }, directors: { value: 'A Director' }, cast: { value: 'Someone|Someone Else' }, music: { value: '' } };
  const wikidata = network([
    [/^query\.wikidata\.org\/sparql$/, (url) => json({ results: { bindings: url.searchParams.get('query').includes('VALUES') ? [facts] : [row] } })],
    [/^en\.wikipedia\.org\/w\/api\.php$/, () => json({ query: { pages: { 1: { title: 'The Film', extract: 'A plot about a machine.' } } } })],
  ]);
  const fromWikidata = await sweep.readWikidata({}, later(), deps(wikidata));
  assert.equal(fromWikidata.items.length, 1);
  const film = fromWikidata.items[0];
  assert.equal(film.id, 'wikidata:Q10');
  assert.equal(film.tmdbRef, 'movie:603', "Wikidata's number, kept");
  assert.equal(film.title, 'The Film');
  assert.equal(film.creator, 'A Director');
  assert.match(film.description, /^Film, 1999\. Genres: action, science fiction\. Directed by A Director\. Starring Someone, Someone Else\. A plot about a machine\.$/);
  assert.deepEqual(fromWikidata.state, { property: 'P4947', offset: 100 });
  const hosts = new Set(wikidata.asked.map((one) => new URL(one.url).hostname));
  assert.deepEqual([...hosts].sort(), ['en.wikipedia.org', 'query.wikidata.org']);
  const end = network([[/^query\.wikidata\.org/, () => json({ results: { bindings: [] } })]]);
  assert.deepEqual((await sweep.readWikidata({ property: 'P4947', offset: 9000 }, later(), deps(end))).state, { property: 'P4983', offset: 0 }, 'films done, on to shows');
  assert.deepEqual((await sweep.readWikidata({ property: 'P4983', offset: 9000 }, later(), deps(end))).state, { done: true }, 'shows done, finished');
  const noPlot = network([[/^query\.wikidata\.org/, (url) => json({ results: { bindings: url.searchParams.get('query').includes('VALUES') ? [{ ...facts, article: undefined }] : [row] } })]]);
  assert.ok(!(await sweep.readWikidata({}, later(), deps(noPlot))).items[0].description.includes('plot'), 'no plot is fine');
  const wdDown = network([[/^query\.wikidata\.org/, () => json({}, 429)]]);
  assert.deepEqual((await sweep.readWikidata({ offset: 200 }, later(), deps(wdDown))), { items: [], state: { property: 'P4947', offset: 200 } }, 'stops on a 429 and keeps its place');

  // 5. Shows from TVmaze; a page past the end goes round.
  const tvmaze = network([[/^api\.tvmaze\.com\/shows$/, () => json([{ id: 5, name: 'The Show', summary: '<p>About trains.</p>', genres: ['Drama'], premiered: '2001-02-03', type: 'Scripted', language: 'English', network: { name: 'A Network' } }])]]);
  const fromTvmaze = await sweep.readTvmaze({ page: 3 }, later(), deps(tvmaze));
  assert.equal(fromTvmaze.items[0].id, 'tvmaze:5');
  assert.equal(fromTvmaze.items[0].description, 'Show (Scripted). Genres: Drama. In English. About trains.', 'plain text');
  assert.equal(tvmaze.asked.length, 20, 'one a second for twenty seconds, half of the 20 per 10 seconds it allows');
  assert.deepEqual(fromTvmaze.state, { page: 23 });
  assert.deepEqual((await sweep.readTvmaze({ page: 99 }, later(), deps(network([])))).state, { done: true }, 'past the end, finished: a second lap would pay again');
  const notAsked = network([[/.*/, () => json({})]]);
  for (const reader of [sweep.readArchive, sweep.readPeertube, sweep.readOpenverse, sweep.readWikidata, sweep.readTvmaze]) {
    assert.deepEqual((await reader({ done: true }, later(), deps(notAsked))).items, [], 'a finished source stays finished');
  }
  assert.deepEqual(notAsked.asked, [], 'and is not asked');

  // 6. The sources. The "nothing from TMDB" guard was here until Luke removed that rule (2026-11-06): his decision, in SPEC-discover.md.
  assert.deepEqual([...sweep.SWEEP_SOURCES].sort(), ['internet_archive', 'openverse', 'peertube', 'tvmaze', 'wikidata']);
  // Wider than the named collections, and still never adult, restricted or dark.
  for (const needed of ['NOT collection:(no-preview OR adult OR ', 'NOT access-restricted-item:true', 'NOT noindex:true', 'NOT nsfw:true']) assert.ok(sweep.ARCHIVE_WIDER.includes(needed), `the wider list keeps ${needed}`);
  for (const named of sweep.ARCHIVE_COLLECTIONS) assert.ok(sweep.ARCHIVE_WIDER.includes(` OR ${named}`), `and leaves out ${named}, already read and paid for`);
  const lastNamed = network([[/^archive\.org\/services\/search\/v1\/scrape$/, () => json({ items: [] })]]);
  const movedOn = await sweep.readArchive({ cursor: 'x' }, later(), deps(lastNamed));
  assert.deepEqual(movedOn.state, { wider: true, rows: 5000, turn: 0, places: {} }, 'the end of the named collections: on to the wider list');
  assert.equal(lastNamed.asked.length, 1);
  // Takes turns through first letters, each with its own place, so what gets tagged is a spread and not only names starting with a digit.
  const letterNet = network([[/^archive\.org\/services\/search\/v1\/scrape$/, (url) => {
    const q = url.searchParams.get('q');
    const letter = q.slice(-2, -1);
    return json(letter === 'b' ? { items: [] } : { items: [{ identifier: `${letter}-item`, title: 'T', mediatype: 'movies', publicdate: '2020-01-01T00:00:00Z' }], cursor: `${letter}-next` });
  }]]);
  const letters = await sweep.readArchive({ wider: true, rows: 5000, turn: 0, places: { a: 'a-was' } }, later(), deps(letterNet));
  const askedLetters = letterNet.asked.map((one) => new URL(one.url).searchParams);
  assert.deepEqual(askedLetters.map((one) => one.get('q').slice(-2, -1)), ['a', 'b', 'c', 'd'], 'a different letter each call');
  assert.ok(askedLetters.every((one) => one.get('q').startsWith(sweep.ARCHIVE_WIDER)), 'all on the wider list');
  assert.equal(askedLetters[0].get('cursor'), 'a-was', "each from that letter's own place");
  assert.equal(askedLetters[1].get('cursor'), null);
  assert.equal(letters.state.places.a, 'a-next');
  assert.equal(letters.state.places.b, false, "a letter's end stops that letter");
  assert.equal(letters.state.turn, 4, 'and the next run carries on from the next letter');
  const skipping = network([[/^archive\.org\/services\/search\/v1\/scrape$/, () => json({ items: [], cursor: 'z' })]]);
  await sweep.readArchive({ wider: true, turn: 1, places: { b: false } }, later(), deps(skipping));
  assert.equal(new URL(skipping.asked[0].url).searchParams.get('q').slice(-2, -1), 'c', 'a finished letter is passed over');
  const stoppedLetter = network([[/^archive\.org/, () => json({}, 429)]]);
  const held = await sweep.readArchive({ wider: true, turn: 3, places: { d: 'd-was' } }, later(), deps(stoppedLetter));
  assert.equal(held.state.places.d, 'd-was', 'a 429 keeps its place');
  assert.equal(held.state.turn, 3);
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations', fs.readdirSync(path.join(ROOT, 'supabase/migrations')).find((name) => name.endsWith('_web_pool.sql'))), 'utf8');
  const code = sql.replace(/--.*$/gm, '');
  assert.ok(/platform in \('internet_archive', 'peertube', 'openverse', 'wikidata', 'tvmaze'\)/.test(code), 'and the table takes no other source');
  // Search results: the same line. A KINO row or a server's title can't be named, in the code or in the database.
  const kinoRow = { id: 'kino:movie-1', platform: 'kino', externalId: 'movie-1', kind: 'video', url: '', canonicalUrl: '', title: 'T', publishedAt: '2020-01-01T00:00:00.000Z', fetchedAt: '' };
  assert.equal(seen.namesToNote([kinoRow, { ...kinoRow, id: 'x:y', platform: 'youtube', externalId: 'y', media: {} }, { ...kinoRow, id: 'j:1', platform: 'jellyfin', externalId: '1' }]).size, 0, 'neither a KINO row, a server title nor a row carrying TMDB details');
  const seenSql = fs.readFileSync(path.join(ROOT, 'supabase/migrations', fs.readdirSync(path.join(ROOT, 'supabase/migrations')).find((name) => name.endsWith('_web_seen_items.sql'))), 'utf8').replace(/--.*$/gm, '');
  assert.ok(!seenSql.includes("'kino'"));

  // 7. Counting.
  const counts = sweep.countWords([{ id: 'a', words: ['jazz', 'trains'] }, { id: 'b', words: ['jazz'] }]);
  const jazz = counts.find((one) => one.word === 'jazz');
  assert.equal(jazz.items, 2);
  assert.deepEqual(jazz.partners, { trains: 1 });
  assert.deepEqual(counts.find((one) => one.word === sweep.TOTAL_ROW), { word: '#total', items: 2, partners: {} });
  assert.deepEqual(sweep.countWords([]), []);
  const wide = sweep.countWords([{ id: 'w', words: Array.from({ length: 150 }, (_, i) => `w${i}`) }]);
  assert.ok(Object.keys(wide[0].partners).length <= 30, 'the map uses 30 at most');
  const bigCount = sweep.countWords([...Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, words: ['jazz', 'piano'] })), { id: 'once', words: ['jazz', 'rare'] }]);
  assert.deepEqual(Object.keys(bigCount.find((one) => one.word === 'jazz').partners), ['piano'], 'in a big batch, a pair seen once is not written');
  assert.equal(bigCount.find((one) => one.word === 'rare').items, 1, 'though the word is still counted');
  // Parts by weight: a word with many closest words takes more of a part, so no part runs past the database's few seconds.
  const weighted = [{ word: 'a', items: 1, partners: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, 2])) }];
  const manyParts = sweep.statsParts(Array.from({ length: 100 }, (_, i) => ({ ...weighted[0], word: `w${i}` })));
  assert.ok(manyParts.length >= 5, 'heavy words make more parts');
  assert.ok(manyParts.every((part) => part.reduce((sum, one) => sum + 1 + Object.keys(one.partners).length, 0) <= 600));
  assert.equal(manyParts.flat().length, 100, 'and none is lost');

  // 8. The job.
  const candidate = (id, over = {}) => ({ id, platform: 'internet_archive', externalId: id, host: null, kind: 'audio', title: 'T', creator: null, description: 'About trains', tags: null, publishedAt: null, tmdbRef: null, ...over });
  const fake = (over = {}) => {
    const log = { files: new Map(), registered: [], hot: [], filed: [], unfiledLeft: over.unfiled ? [...over.unfiled] : [], created: [], states: [], collected: [], released: [], spend: [], cancelled: [], reserved: [], unreserved: [], named: [], stats: [], claims: 0, unclaims: 0, createOptions: [] };
    let place = over.statsPlace ?? 0;
    const store = {
      spent: async () => over.spent ?? 0,
      claim: async () => ((log.claims += 1), over.claim ?? true),
      unclaim: async () => { log.unclaims += 1; },
      reserve: async (items, worst, limit) => {
        if ((over.spent ?? 0) + worst > limit || over.reserveNull) return null;
        log.reserved.push({ items, worst, limit });
        return 7;
      },
      reserved: async (id, batchId) => log.named.push([id, batchId]),
      unreserve: async (id) => log.unreserved.push(id),
      statsPlace: async () => place,
      addStats: async (batchId, part, stats) => {
        assert.equal(part, place, 'parts in order');
        log.stats.push({ batchId, part, stats });
        place += 1;
      },
      recordSpend: async (...args) => log.spend.push(args),
      room: async () => over.room ?? true,
      state: async () => over.state ?? {},
      saveState: async (name, state) => log.states.push([name, state]),
      unknown: async (ids) => ids.filter((id) => !(over.known ?? []).includes(id)),
      putFile: async (where, file) => {
        if (over.putFails && where.startsWith('out/')) throw new Error('TAGGING_DATABASE');
        log.files.set(where, file);
      },
      getFile: async (where) => log.files.get(where) ?? null,
      removeFile: async (where) => log.files.delete(where),
      fileAdd: async (where, items, words) => log.registered.push({ where, items, words }),
      hotAdd: async (rows) => log.hot.push(...rows),
      unfiled: async () => (log.unfiledLeft ?? []).splice(0, 1000),
      filed: async (ids) => log.filed.push(...ids),
      pending: async () => over.pending ?? [],
      outIn: async () => over.out ?? [],
      collect: async (batchId, rows) => log.collected.push({ batchId, rows }),
      release: async (batchId) => log.released.push(batchId),
    };
    const client = { messages: { batches: {
      create: async ({ requests }, options) => {
        if (over.createFails) throw over.createFails;
        log.created.push(requests);
        log.createOptions.push(options);
        return { id: 'batch-new' };
      },
      retrieve: async () => ({ processing_status: over.status ?? 'ended' }),
      cancel: async (id) => log.cancelled.push(id),
      results: async () => (async function* () { for (const result of over.results ?? []) yield result; })(),
    } } };
    let reads = 0;
    const read = async () => ((reads += 1), { items: over.items ?? [], state: { internet_archive: { cursor: 'x' } } });
    return { store, client, log, read, reads: () => reads };
  };
  const running = fake({ items: [candidate('a'), candidate('a'), candidate('known'), candidate('b', { platform: 'wikidata' })], known: ['known'] });
  const result = await sweep.runSweep(running.client, running.store, running.read);
  assert.equal(result.sent, 2, 'once each, and nothing the site already holds');
  assert.deepEqual(result.read, { internet_archive: 1, wikidata: 1 });
  assert.equal(running.log.created[0][0].custom_id, customIdFor('a'));
  assert.ok(JSON.parse(running.log.created[0][0].params.messages[0].content).description === 'About trains', 'the description goes to Claude');
  assert.deepEqual(poolFiles.decodePoolFile(running.log.files.get('out/batch-new.br')).map((row) => `${row.platform}:${row.externalId}`), ['internet_archive:a', 'wikidata:b'], 'what went out is kept as one file, not a row each');
  assert.ok(!Buffer.from(require('node:zlib').brotliDecompressSync(running.log.files.get('out/batch-new.br'))).toString().includes('About trains'), 'and the description is not in it');
  assert.deepEqual(running.log.states, [['internet_archive', { cursor: 'x' }]], 'its place is only saved once the batch is marked');
  assert.deepEqual(running.log.named, [[7, 'batch-new']], 'the reservation is tied to the batch');
  assert.equal(running.log.reserved[0].items, 2);
  assert.ok(Math.abs(running.log.reserved[0].worst - 2 * worstCaseCost(candidate('a'))) < 1e-12, 'its worst case is taken before it goes out');
  assert.ok(running.log.reserved[0].limit <= 59.4, 'and the other two jobs keep what they may need, so the $60 holds');
  assert.equal(running.log.createOptions[0].maxRetries, 0, 'a create is never repeated by itself: that could pay twice');
  assert.deepEqual([running.log.claims, running.log.unclaims], [1, 1], 'one run at a time, and it lets go');

  // A run still going: this one does nothing at all.
  const busy = fake({ claim: false, items: [candidate('a')], pending: ['b1'] });
  assert.deepEqual(await sweep.runSweep(busy.client, busy.store, busy.read), { collected: 0, sent: 0, waiting: 0, inputTokens: 0, outputTokens: 0, busy: true });
  assert.equal(busy.reads(), 0);
  assert.equal(busy.log.unclaims, 0, "and it doesn't let go of the other run's claim");
  const reserveNo = fake({ reserveNull: true, items: [candidate('a')] });
  assert.equal((await sweep.runSweep(reserveNo.client, reserveNo.store, reserveNo.read)).stopped, 'spending limit', 'the database refusing the reservation stops it');
  assert.deepEqual(reserveNo.log.created, [], 'with nothing sent');
  assert.deepEqual(reserveNo.log.states, [], 'and the place not moved');
  const refusedCreate = fake({ createFails: Object.assign(new Error('x'), { status: 429 }), items: [candidate('a')] });
  await assert.rejects(sweep.runSweep(refusedCreate.client, refusedCreate.store, refusedCreate.read));
  assert.deepEqual(refusedCreate.log.unreserved, [7], "Claude's API refusing outright gives the reservation back");
  assert.deepEqual(refusedCreate.log.states, []);
  assert.equal(refusedCreate.log.unclaims, 1, 'and a failed run still lets go');
  const lostAnswer = fake({ createFails: new Error('connection lost'), items: [candidate('a')] });
  await assert.rejects(sweep.runSweep(lostAnswer.client, lostAnswer.store, lostAnswer.read));
  assert.deepEqual(lostAnswer.log.unreserved, [], 'no answer at all: the batch may exist, so its worst case stays counted');

  const everything = fake({ items: Array.from({ length: 21060 }, (_, i) => candidate(`z${i}`)) });
  assert.equal((await sweep.runSweep(everything.client, everything.store, everything.read)).sent, 21060, 'a full run is sent whole, so no read item is skipped');
  let tick = 0;
  const slowCollect = fake({ pending: ['b1'], out: ['a'], results: [] });
  assert.deepEqual(await sweep.runSweep(slowCollect.client, slowCollect.store, slowCollect.read, () => (tick += 101000)), { collected: 0, sent: 0, waiting: 1, inputTokens: 0, outputTokens: 0 }, 'a long collect means no reading this run');
  assert.equal(slowCollect.reads(), 0);
  let deadlineGiven = 0;
  const timed = fake({});
  await sweep.runSweep(timed.client, timed.store, async (state, deadline) => ((deadlineGiven = deadline), { items: [], state: {} }), () => 1000);
  assert.equal(deadlineGiven, 61000, 'reading stops after 60 seconds');
  const heldBackRun = fake({ spent: 59.4 - worstCaseCost(candidate('a')) * 1.5, items: [candidate('a'), candidate('b')] });
  await sweep.runSweep(heldBackRun.client, heldBackRun.store, heldBackRun.read);
  assert.equal(heldBackRun.log.created[0].length, 1, 'the limit lets one through');
  assert.deepEqual(heldBackRun.log.states, [['internet_archive', { cursor: 'x' }]], 'and the place moves on, or the next run would send that one again');
  const allHeld = fake({ spent: 59.4 - worstCaseCost(candidate('a')) * 0.5, items: [candidate('a')] });
  await sweep.runSweep(allHeld.client, allHeld.store, allHeld.read);
  assert.deepEqual(allHeld.log.states, [], 'with nothing sent, the place stays');

  const stuck = fake({ pending: ['b1'], status: 'in_progress', items: [candidate('a')] });
  const stuckRun = await sweep.runSweep(stuck.client, stuck.store, stuck.read);
  assert.equal(stuckRun.waiting, 2, 'a batch still out, and the new one');
  assert.equal(stuck.reads(), 1, 'several can be out at once: one still working stops nothing');
  assert.equal(stuckRun.sent, 1);
  const manyOut = fake({ pending: Array.from({ length: sweep.MAX_OUT }, (_, i) => `b${i}`), status: 'in_progress', items: [candidate('a')] });
  assert.equal((await sweep.runSweep(manyOut.client, manyOut.store, manyOut.read)).waiting, sweep.MAX_OUT);
  assert.equal(manyOut.reads(), 0, 'but only so many');
  const lost = fake({ items: [candidate('a')], putFails: true });
  await assert.rejects(sweep.runSweep(lost.client, lost.store, lost.read));
  assert.deepEqual(lost.log.cancelled, ['batch-new'], 'a batch nothing remembers is cancelled');
  assert.deepEqual(lost.log.states, [], 'and the place is not moved');
  assert.deepEqual(lost.log.unreserved, [7], 'and its worst case stops counting if it never got a row');

  // 9. Collecting: paid for first, chunks with their counts, only what's still out.
  const answer = (id, words) => ({ custom_id: customIdFor(id), result: { type: 'succeeded', message: { stop_reason: 'end_turn', usage: { input_tokens: 500, output_tokens: 30 }, content: [{ type: 'text', text: JSON.stringify({ words }) }] } } });
  const many = Array.from({ length: 900 }, (_, i) => `i${i}`);
  const collecting = fake({ pending: ['b1'], out: many, results: [...many.map((id) => answer(id, ['jazz'])), answer('already-collected', ['not counted'])] });
  const collected = await sweep.runSweep(collecting.client, collecting.store, collecting.read);
  assert.equal(collected.collected, 900, 'what was already collected is not counted again');
  assert.equal(collecting.log.collected.length, 2, 'in chunks, inside the API statement time');
  assert.equal(collecting.log.collected[0].rows.length, 500);
  assert.deepEqual(collecting.log.stats.map((one) => one.part), [0], "the batch's counts once, not a chunk at a time");
  assert.equal(collecting.log.stats[0].stats.find((one) => one.word === 'jazz').items, 900, 'every answer is counted');
  assert.equal(collecting.log.stats[0].stats.find((one) => one.word === sweep.TOTAL_ROW).items, 901);
  // Cut short after the first part: the next run works out the same parts and carries on from the second.
  const manyWords = Array.from({ length: 1300 }, (_, i) => `x${i}`);
  const bigBatch = () => [...manyWords.map((id, i) => answer(id, [`word${i}`]))];
  const resumed = fake({ pending: ['b1'], out: [], results: bigBatch(), statsPlace: 1 });
  await sweep.runSweep(resumed.client, resumed.store, resumed.read);
  assert.deepEqual(resumed.log.stats.map((one) => one.part), [1, 2], 'a run cut short carries on from the next part');
  const whole = fake({ pending: ['b1'], out: [], results: bigBatch() });
  await sweep.runSweep(whole.client, whole.store, whole.read);
  assert.deepEqual(whole.log.stats[1].stats, resumed.log.stats[0].stats, 'and the parts come out the same');
  assert.equal(whole.log.stats.flatMap((one) => one.stats).find((one) => one.word === sweep.TOTAL_ROW).items, 1300, 'with nothing missed');
  assert.deepEqual(collecting.log.spend, [['b1', 450500, 27030, batchCost(450500, 27030)]], 'and everything paid for is counted');
  assert.deepEqual(collecting.log.released, ['b1']);
  const refusing = fake({ pending: ['b1'], out: many.slice(0, 500), results: many.slice(0, 500).map((id) => answer(id, ['jazz'])) });
  const realCollect = refusing.store.collect;
  refusing.store.collect = async (batchId, rows, stats) => {
    if (rows.length > 40) throw new Error('TAGGING_DATABASE');
    return realCollect(batchId, rows, stats);
  };
  await sweep.runSweep(refusing.client, refusing.store, refusing.read);
  assert.equal(refusing.log.collected.reduce((sum, one) => sum + one.rows.length, 0), 500, 'a chunk the database refuses is tried in halves, and nothing is lost');

  // The API answers at most 1,000 rows a call (found in the first real runs): the store asks in parts, so nothing past the first 1,000 is lost.
  const calls = [];
  const fakeDb = {
    rpc: (name, args) => {
      calls.push([name, args]);
      if (name === 'web_pool_unknown') return Promise.resolve({ data: args.p_ids, error: null });
      const builder = {
        range: async (from) => ({ data: from === 0 ? Array.from({ length: 1000 }, (_, i) => `a${i}`) : from === 1000 ? Array.from({ length: 1000 }, (_, i) => `b${i}`) : Array.from({ length: 300 }, (_, i) => `c${i}`), error: null }),
      };
      return builder;
    },
  };
  const realStore = sweep.makeSweepStore(fakeDb, 'lock');
  const asked = Array.from({ length: 2500 }, (_, i) => `id${i}`);
  assert.equal((await realStore.unknown(asked)).length, 2500, 'every id gets an answer');
  assert.ok(calls.filter(([name]) => name === 'web_pool_unknown').every(([, args]) => args.p_ids.length <= 1000), 'at most 1,000 a call');
  assert.equal(calls.filter(([name]) => name === 'web_pool_unknown').length, 3);
  assert.equal((await realStore.outIn('b1')).length, 2300, 'and a big batch is read whole');

  // Collecting from a file: its words go in numbered files, a sample stays as rows, and the file sent goes once it's done with.
  const fileRow = (id) => ({ platform: 'internet_archive', externalId: id, host: null, kind: 'audio', title: `T ${id}`, creator: null, publishedAt: '2020-01-02T03:04:05.000Z', tmdbRef: null, words: [] });
  const twoFiles = Array.from({ length: poolFiles.ITEMS_PER_FILE + 500 }, (_, i) => `f${i}`);
  const fileRun = fake({ pending: ['b9'], results: twoFiles.map((id) => answer(`internet_archive:${id}`, ['jazz', `w${id.length}`])) });
  fileRun.log.files.set('out/b9.br', poolFiles.encodePoolFile(twoFiles.map(fileRow)));
  const fileResult = await sweep.runSweep(fileRun.client, fileRun.store, fileRun.read);
  assert.equal(fileResult.collected, twoFiles.length, 'every answer collected');
  assert.deepEqual(fileRun.log.registered.map((one) => [one.where, one.items]), [['s/b9-0.br', poolFiles.ITEMS_PER_FILE], ['s/b9-1.br', 500]], 'in numbered files, so a run cut short writes the same ones');
  assert.ok(fileRun.log.registered[0].words.includes('jazz'), 'each listed with its words');
  assert.deepEqual(fileRun.log.collected, [], 'with no row written for each item');
  assert.ok(fileRun.log.hot.length > 0 && fileRun.log.hot.length <= 201, 'and only a sample as rows');
  const reopened = poolFiles.decodePoolFile(fileRun.log.files.get('s/b9-1.br'));
  assert.equal(reopened.length, 500);
  assert.deepEqual(reopened[0], { ...fileRow(twoFiles[poolFiles.ITEMS_PER_FILE]), words: ['jazz', 'w5'] }, 'a row comes back from its file as it went in');
  assert.equal(fileRun.log.files.has('out/b9.br'), false, 'the file sent is removed once collected');
  assert.deepEqual(fileRun.log.released, ['b9']);
  const partial = fake({ pending: ['b8'], results: [answer('internet_archive:g1', ['jazz']), { custom_id: customIdFor('internet_archive:g2'), result: { type: 'expired' } }, answer('internet_archive:g3', ['not_valid!'])] });
  partial.log.files.set('out/b8.br', poolFiles.encodePoolFile(['g1', 'g2', 'g3'].map(fileRow)));
  assert.equal((await sweep.runSweep(partial.client, partial.store, partial.read)).noWords, 2, 'answers with no words are said, not lost quietly');
  assert.equal(fileRun.log.stats[0].stats.find((one) => one.word === 'jazz').items, twoFiles.length, 'counted once');
  // A row sent before the files moves over, and only then may it be removed.
  const unfiled = Array.from({ length: 1500 }, (_, i) => ({ ...fileRow(`old${i}`), words: ['jazz'] }));
  const moving = fake({ unfiled });
  await sweep.runSweep(moving.client, moving.store, moving.read);
  assert.equal(moving.log.filed.length, 1500, 'rows sent before the files are copied in');
  assert.equal(moving.log.registered.reduce((sum, one) => sum + one.items, 0), 1500);
  assert.ok(moving.log.registered.every((one) => one.where.startsWith('b/')));

  // A list's extra items: words as the files hold them, with their spaces, and no map drawn to get them.
  const more = require('./tag-station-sweep-out/tag-station/pool-more.js');
  const shownGraph = { tags: [{ name: 'science fiction' }, { name: 'jazz' }, { name: 'film' }], aliases: { scifi: 'science fiction' } };
  const moreFacts = [{ word: 'sci-fi', facet: 'genre', sameAs: 'science fiction', vague: false }, { word: 'trains', facet: 'subject', sameAs: null, vague: false }];
  const spelled = more.spellingsOf(['Science Fiction'], moreFacts, shownGraph);
  assert.ok(spelled.includes('science fiction'), `a two-word word is asked for with its space: ${spelled}`);
  assert.ok(spelled.includes('sci-fi'), 'and a spelling joined to it is asked for too');
  assert.ok(!spelled.includes('trains'));
  const fileRowsAsRows = Array.from({ length: 300 }, (_, i) => ({ item: { id: `peertube:v${i}`, platform: 'peertube', externalId: `v${i}`, kind: 'video', url: 'https://a.example/x', canonicalUrl: 'https://a.example/x', title: `V${i}`, publishedAt: '', fetchedAt: '', views: 99 }, claudeWords: ['sci-fi', 'science fiction', 'off the map', 'film'], listOnly: true }));
  const startedMore = Date.now();
  const moreOut = more.moreItems(fileRowsAsRows, shownGraph);
  assert.ok(Date.now() - startedMore < 200, `no map is drawn to answer a list: ${Date.now() - startedMore} ms`);
  assert.deepEqual(moreOut[0].words.map((one) => one.word), ['film', 'science fiction'], 'spelled as the map spells them, joined, and only those on the map');
  assert.equal(moreOut[0].views, undefined, 'and only what a row needs reaches the answer');
  assert.deepEqual(more.moreItems([{ ...fileRowsAsRows[0], claudeWords: ['off the map'] }], shownGraph), [], 'an item with no word on the map is left out');

  // The file format: small, and exact.
  const sample = Array.from({ length: 2000 }, (_, i) => ({ platform: i % 2 ? 'peertube' : 'internet_archive', externalId: `item-${i}-${(i * 7919).toString(36)}`, host: i % 2 ? 'video.example.org' : null, kind: i % 3 ? 'video' : 'audio', title: `A title for item ${i}`, creator: i % 5 ? `Maker ${i % 40}` : null, publishedAt: i % 7 ? '2019-03-04T05:06:07.000Z' : null, tmdbRef: i % 11 ? null : `movie:${i}`, words: ['jazz', `theme ${i % 50}`, `mood ${i % 9}`] }));
  const encoded = poolFiles.encodePoolFile(sample);
  assert.deepEqual(poolFiles.decodePoolFile(encoded), sample, 'every row comes back exactly');
  assert.ok(encoded.length / sample.length < 40, `about 30 bytes an item, not 520: ${(encoded.length / sample.length).toFixed(1)}`);
  assert.deepEqual(poolFiles.wordsIn(sample.slice(0, 2)), ['jazz', 'mood 0', 'mood 1', 'theme 0', 'theme 1']);
  assert.throws(() => poolFiles.decodePoolFile(Buffer.from('not a file')));

  // 10. The $60 stop, and the size stop.
  assert.equal(sweep.SWEEP_LIMIT_USD, 60);
  const atLimit = fake({ spent: 59.4, items: [candidate('a')] });
  assert.equal((await sweep.runSweep(atLimit.client, atLimit.store, atLimit.read)).stopped, 'spending limit');
  assert.equal(atLimit.reads(), 0, 'at the limit nothing is read');
  const oneCost = worstCaseCost(candidate('a'));
  const near = fake({ spent: 59.4 - oneCost * 2.5, items: [candidate('a'), candidate('b'), candidate('c'), candidate('d')] });
  const nearResult = await sweep.runSweep(near.client, near.store, near.read);
  assert.equal(nearResult.sent, 2, 'near it, only what fits the worst case');
  assert.equal(nearResult.stopped, 'spending limit');
  const full = fake({ room: false, items: [candidate('a')] });
  assert.equal((await sweep.runSweep(full.client, full.store, full.read)).stopped, 'database full');
  assert.deepEqual(full.log.created, []);
  assert.ok(requestFor(candidate('a')).params.max_tokens <= 300);

  // 11. On the map: the sweep's counts count, its rows are only listed, and the map stays bounded and repeatable.
  const row2 = (id, words, over = {}) => ({ item: { id, platform: 'peertube', externalId: id, kind: 'video', url: '', canonicalUrl: '', title: id, publishedAt: '2026-01-01T00:00:00.000Z', fetchedAt: '' }, claudeWords: words, ...over });
  const graph = buildStationGraph([row2('saved', ['jazz', 'trains']), row2('listed', ['jazz', 'trains'], { listOnly: true })], [], { counted: 10, words: [{ word: 'jazz', items: 10, partners: { trains: 6 } }, { word: 'trains', items: 6, partners: { jazz: 6 } }] });
  const jazzTag = graph.tags.find((tag) => tag.name === 'jazz');
  assert.equal(jazzTag.count, 11, 'a saved item and the counted ones, and not the listed one again');
  assert.equal(graph.tagged, 11);
  assert.equal(jazzTag.partners.find((one) => one.name === 'trains').shared, 7, 'the pair counts once, from both sides of the count');
  assert.equal(graph.items.length, 2, 'the listed row is still listed');
  const index = q.buildIndex(graph);
  assert.ok(q.relatedTags(index, { ...require('./tag-station-sweep-out/tag-station/recipe.js').EMPTY_RECIPE, tag: 'jazz' }, q.focusOf(index, { ...require('./tag-station-sweep-out/tag-station/recipe.js').EMPTY_RECIPE, tag: 'jazz' }))[0].reason === 'WITH jazz ON 7 ITEMS', 'reasons come from the counts');
  const words = Array.from({ length: MAX_TAGS + 500 }, (_, i) => ({ word: `word ${i}`, items: MAX_TAGS + 600 - i, partners: { 'word 0': 1 } }));
  const started = Date.now();
  const big = buildStationGraph([row2('listed', ['word 2400', 'word 1'], { listOnly: true })], [], { counted: 100000, words });
  const took = Date.now() - started;
  assert.equal(big.tags.length, MAX_TAGS, 'the map stays a size a browser can hold');
  assert.deepEqual(big.items[0].words.map((one) => one.word), ['word 1'], "a word off the map leaves an item's chips");
  assert.ok(took < 45000, `built in ${took}ms, inside the route's minute`);
  assert.ok(JSON.stringify(big).length < 3 * 1024 * 1024, 'and the answer stays small');
  assert.deepEqual(buildStationGraph([row2('a', ['x'])]).tagged, 1);
  assert.equal(q.sourceLabel('wikidata'), 'WIKIDATA');
  assert.equal(q.sourceLabel('peertube'), 'PEERTUBE');

  // 12. Reading: soft, addresses built by each platform's fixed shape, and only those drawn.
  const fileRows = [
    { platform: 'internet_archive', externalId: 'one', host: null, kind: 'audio', title: 'One', creator: null, publishedAt: null, tmdbRef: null, words: ['jazz'] },
    { platform: 'wikidata', externalId: 'Q1', host: null, kind: 'video', title: 'Film', creator: 'D', publishedAt: '1999-01-01T00:00:00.000Z', tmdbRef: 'movie:1', words: ['dystopia'] },
    { platform: 'peertube', externalId: 'u', host: 'video.blender.org', kind: 'video', title: 'P', creator: null, publishedAt: null, tmdbRef: null, words: ['jazz'] },
  ];
  const db = ({ files = { data: [{ path: 's/one.br' }], error: null }, total = { data: { items: 12 }, error: null }, words: wordsAnswer = { data: [{ word: '#total', items: 12, partners: {} }, { word: 'jazz', items: 3, partners: {} }], error: null } } = {}) => {
    const tables = [];
    const client = {
      tables,
      from: (table) => {
        tables.push(table);
        const self = {
          select: () => self,
          order: () => self,
          eq: () => self,
          maybeSingle: async () => total,
          limit: async () => (table === 'web_pool_shards' ? files : wordsAnswer),
        };
        return self;
      },
      storage: { from: () => ({ download: async () => ({ data: new Blob([poolFiles.encodePoolFile(fileRows)]), error: null }) }) },
    };
    return client;
  };
  const poolClient = db();
  const poolRead = await createSupabaseTagRepository(poolClient).pool();
  assert.ok(!poolClient.tables.includes('web_pool_items'), "the map's sample comes from the files, not the big table, whose sort timed out live");
  assert.equal(poolRead.swept.counted, 12);
  assert.deepEqual(poolRead.swept.words.map((one) => one.word), ['jazz'], 'the total is not a word');
  assert.equal(poolRead.rows[0].item.embedUrl, 'https://archive.org/embed/one');
  assert.equal(poolRead.rows[0].listOnly, true);
  assert.equal(poolRead.rows[0].seenOnly, undefined);
  assert.equal(poolRead.rows[1].seenOnly, true, 'a film has no player here: FIND IN MEDIA');
  assert.equal(poolRead.rows[2].item.url, 'https://video.blender.org/videos/watch/u');
  assert.equal(poolRead.incomplete, undefined);
  // The total alone is enough for the lists to open: the slow read of the commonest words failing doesn't blank them.
  const slowWords = await createSupabaseTagRepository(db({ words: { data: null, error: { code: '57014' } } })).pool();
  assert.equal(slowWords.swept.counted, 12, 'the count survives the commonest words timing out, as they did live');
  assert.equal(slowWords.incomplete, true, 'and that map is marked as not to keep');
  const failed = await createSupabaseTagRepository(db({ files: { data: null, error: {} }, total: { data: null, error: {} }, words: { data: null, error: {} } })).pool();
  assert.deepEqual(failed, { rows: [], swept: { counted: 0, words: [] }, incomplete: true }, 'a failed read is an empty pool, never a broken map');
  assert.ok((await getMockTagRepository().pool()).rows.length > 0, 'the mock has a pool too');

  // 13. The migration only adds, and only the job can write.
  for (const table of ['web_pool_items', 'web_word_stats', 'web_sweep_state']) {
    assert.ok(new RegExp(`create table if not exists public\\.${table}`).test(code));
    assert.ok(new RegExp(`alter table public\\.${table} enable row level security`).test(code));
    assert.ok(new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`).test(code));
  }
  assert.ok(!/drop table|truncate/i.test(code));
  assert.deepEqual([...new Set([...code.matchAll(/delete from public\.(\w+)/g)].map((match) => match[1]))], ['web_pool_items'], 'the only rows ever removed are old pool rows');
  for (const [verb, pattern, allowed] of [
    ['alter', /alter table public\.(\w+)/g, ['web_pool_items', 'web_word_stats', 'web_sweep_state']],
    ['update', /update public\.(\w+)/g, ['web_pool_items']],
    ['insert', /insert into public\.(\w+)/g, ['web_pool_items', 'web_word_stats', 'web_sweep_state']],
  ]) {
    assert.ok([...code.matchAll(pattern)].every((match) => allowed.includes(match[1])), `${verb} touches only its own tables`);
  }
  assert.ok(/offset 100000/.test(code), 'the newest 100,000 stay');
  assert.ok(/held < 50000/.test(code), 'new words stop at 50,000');
  assert.ok(/300 \* 1024 \* 1024/.test(code), 'no sending past 300 MB');
  assert.ok(!/description/.test(/create table if not exists public\.web_pool_items \(([\s\S]*?)\n\);/.exec(code)[1]), 'no description is kept');
  assert.ok(!/(likes|views|rating|person|user_id)/.test(/create table if not exists public\.web_pool_items \(([\s\S]*?)\n\);/.exec(code)[1]), 'no counts and no person');
  for (const name of ['web_pool_room', 'web_sweep_state_read', 'web_sweep_state_write', 'web_pool_unknown', 'web_pool_sent', 'web_pool_pending', 'web_pool_out', 'web_pool_collect', 'web_pool_release', 'web_word_waiting', 'web_word_vocabulary']) {
    const body = new RegExp(`function public\\.${name}\\([\\s\\S]*?\\$\\$;`).exec(code)[0];
    assert.ok(body.includes('web_ingest_lock_ok(p_secret)'), `${name} needs the lock`);
    assert.ok(body.includes("set search_path = ''"), `${name} has a fixed search path`);
  }
  assert.ok(!/to authenticated;[\s\S]*web_pool/.test(code.split('revoke all on function')[0].replace(/grant select[^\n]*\n/g, '')), 'signed-in people can call none of these');
  assert.ok(/'11 \*\/3 \* \* \*'/.test(code), 'its own minute');

  const route = fs.readFileSync(path.join(ROOT, 'app/api/web/sweep/route.ts'), 'utf8');
  const said = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/error\.message === 'TAGGING_DATABASE'/g, '');
  assert.ok(!/error\.(message|stack)/.test(said), "never an error's message or stack in an answer");
  assert.ok(route.includes('LOCK_HEADER') && route.indexOf('lock.length') < route.indexOf('new Anthropic'), 'the lock before anything else');

  console.log(`check-tag-station-sweep: all passed (a full map built in ${took}ms)`);
  finished = true;
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
// A promise that never settles empties the event loop and exits 0 with nothing run: that must fail, not look like a pass.
process.on('exit', (code) => {
  if (code === 0 && !finished) {
    console.error('check-tag-station-sweep stopped before its end');
    process.exitCode = 1;
  }
});
