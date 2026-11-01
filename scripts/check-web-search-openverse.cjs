/*
 * WEB search everywhere: the Openverse provider, offline (SPEC-web-search.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/search/providers/openverse.ts app/lib/web/row-addresses.ts --outDir Temp/out-web-search-ov --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the fixture (5 real image results from a live search, one flagged sensitive by Openverse) parses into items the page would draw: link and thumbnail, never a player
 * - every address is built from the id, never taken from the result's own URLs; sensitive and badly identified works are skipped
 * - one request a search, images only, sensitive works asked away, an 8s wait (fetchOne keeps 20s); paging stops at page 5
 * - a 429 (the shared anonymous budget) becomes "DAILY LIMIT REACHED"
 * - fetchOne refuses a non-uuid without fetching, returns null for a 404, and returns only the work asked for
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { NOW, makeAsserts, checkItem, fakeFetch } = require('./web-search-check-kit.cjs');

const OUT = join(__dirname, '..', 'Temp', 'out-web-search-ov', 'lib', 'web');
const ov = require(join(OUT, 'search', 'providers', 'openverse.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const asserts = makeAsserts('WEB search: Openverse');
const { ok, same } = asserts;
const deps = (fetch) => ({ fetch, now: () => new Date(NOW) });

(async () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'search-openverse-images.json'), 'utf8'));
  const real = ov.parseOvSearch(fixture, 1, NOW);
  // The third real result is flagged sensitive by Openverse (unstable__sensitivity), so it is skipped.
  same(real.items.length, 4, 'four of the five fixture results become items');
  ok(!real.items.some((item) => item.externalId === fixture.results[2].id), 'the sensitive real result is the one skipped');
  for (const item of real.items) {
    checkItem(asserts, rowAddresses, item, item.externalId);
    same(item.url, `https://openverse.org/image/${item.externalId}`, 'page built from the id');
    same(item.thumbnailUrl, `https://api.openverse.org/v1/images/${item.externalId}/thumb/`, 'thumbnail built from the id');
    same(item.embedUrl, undefined, 'never a player');
    same(item.kind, 'image', 'images');
  }
  const raw = JSON.stringify(real.items);
  for (const doc of fixture.results) {
    ok(!raw.includes(doc.url) && !raw.includes(doc.foreign_landing_url), 'the result\'s own file and landing URLs are never used');
  }
  same(real.next, 2, 'next page 2');

  const base = fixture.results[0];
  const hostile = [
    { ...base, id: 'not-a-uuid' },
    { ...base, mature: true },
    { ...base, unstable__sensitivity: ['sensitive_text'] },
    { ...base, indexed_on: 'never' },
  ];
  same(ov.parseOvSearch({ results: hostile, page_count: 1 }, 1, NOW).items.length, 0, 'sensitive and odd results are skipped');
  same(ov.parseOvSearch({ results: [], page_count: 12 }, 5, NOW).next, null, 'paging stops at page 5');

  const fake = fakeFetch(fixture);
  await ov.openverseSearch.search('night living dead', null, deps(fake.fetch));
  same(fake.urls.length, 1, 'one request');
  const url = new URL(fake.urls[0]);
  same(url.origin + url.pathname, 'https://api.openverse.org/v1/images/', 'images only, from the API');
  same([url.searchParams.get('q'), url.searchParams.get('page'), url.searchParams.get('mature')], ['night living dead', '1', 'false'], 'the words, page 1, no sensitive works');
  same(ov.openverseSearch.timeoutMs, 8000, 'a live search waits 8s (the ingest keeps 20s)');
  ok(ov.openverseSearch.dailyBudget && ov.openverseSearch.dailyBudget.perInstance < 200, 'Openverse has a daily budget under its 200 a day');
  for (const [bad, want] of [[3, '3'], [6, '1'], [0, '1'], [2.5, '1'], ['2', '1']]) {
    const probe = fakeFetch(fixture);
    await ov.openverseSearch.search('x', bad, deps(probe.fetch));
    same(new URL(probe.urls[0]).searchParams.get('page'), want, `page ${JSON.stringify(bad)} -> ${want}`);
  }

  const limited = fakeFetch({ detail: 'slow down' }, 429);
  let problem = null;
  try {
    await ov.openverseSearch.search('x', null, deps(limited.fetch));
  } catch (error) {
    problem = error.status;
  }
  same(problem, 429, 'a 429 is passed up as a status (the route shows DAILY LIMIT REACHED)');

  const none = fakeFetch(base);
  same(await ov.openverseSearch.fetchOne('../x', deps(none.fetch)), null, 'fetchOne refuses a non-uuid');
  same(none.urls.length, 0, '... without a request');
  same(await ov.openverseSearch.fetchOne(base.id, deps(fakeFetch({ detail: 'Not found.' }, 404).fetch)), null, 'a 404 is null (gone)');
  const one = fakeFetch(base);
  const found = await ov.openverseSearch.fetchOne(base.id, deps(one.fetch));
  same(found && found.externalId, base.id, 'fetchOne returns the work');
  same(one.urls[0], `https://api.openverse.org/v1/images/${base.id}/`, 'fetchOne asks for that work');
  same(await ov.openverseSearch.fetchOne(fixture.results[1].id, deps(fakeFetch(base).fetch)), null, 'an answer about another work is null');

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${error.stack}`);
  process.exit(1);
});
