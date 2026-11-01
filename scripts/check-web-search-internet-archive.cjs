/*
 * WEB search everywhere: the Internet Archive provider, offline (SPEC-web-search.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/search/providers/internet-archive.ts app/lib/web/row-addresses.ts --outDir Temp/out-web-search-ia --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the fixture (5 real docs from a live title search, scripts/fixtures/web/) parses into items the page would draw
 * - string and array fields both work; restricted, undated and badly identified docs are skipped; HTML is stripped
 * - the query is built only from the search's words, title-only, restricted items left out; no engagement field is asked for
 * - one request, to archive.org only; paging stops at the last page and at page 50
 * - fetchOne refuses an unsafe id without fetching, and returns only the item it was asked for
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { NOW, makeAsserts, checkItem, fakeFetch } = require('./web-search-check-kit.cjs');

const OUT = join(__dirname, '..', 'Temp', 'out-web-search-ia', 'lib', 'web');
const ia = require(join(OUT, 'search', 'providers', 'internet-archive.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const asserts = makeAsserts('WEB search: Internet Archive');
const { ok, same } = asserts;
const deps = (fetch) => ({ fetch, now: () => new Date(NOW) });

(async () => {
  /* ---------------------------------------------------------------- the real fixture */
  const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'search-internet-archive.json'), 'utf8'));
  const real = ia.parseIaSearch(fixture, 1, NOW);
  same(real.items.length, 5, 'all five fixture docs become items');
  for (const item of real.items) checkItem(asserts, rowAddresses, item, item.externalId);
  same(real.next, 2, 'more results than one page: next is page 2');
  ok(real.items.some((item) => item.kind === 'video') && real.items.some((item) => item.kind === 'image'), 'kinds are mapped');
  ok(real.items.filter((item) => item.kind === 'image').every((item) => item.embedUrl === undefined), 'an image has no player');

  /* ---------------------------------------------------------------- hostile and odd docs */
  const docs = [
    { identifier: 'arrays', title: ['<b>One</b> &amp; two', 'x'], creator: ['Ann', 'Bo'], mediatype: ['movies'], publicdate: ['2026-01-02T03:04:05Z'] },
    { identifier: 'restricted', title: 'x', publicdate: '2026-01-01T00:00:00Z', 'access-restricted-item': 'true' },
    { identifier: '-bad', title: 'x', publicdate: '2026-01-01T00:00:00Z' },
    { identifier: 'bad/../id', title: 'x', publicdate: '2026-01-01T00:00:00Z' },
    { identifier: 'undated', title: 'x' },
    { identifier: 'arrays', title: 'duplicate', publicdate: '2026-01-01T00:00:00Z' },
    null,
    'string',
  ];
  const odd = ia.parseIaSearch({ response: { docs, numFound: 8 } }, 1, NOW);
  same(odd.items.map((item) => item.externalId), ['arrays'], 'only the good doc is kept, once');
  same(odd.items[0].title, 'One & two', 'HTML stripped and entities decoded, first of an array');
  same(odd.items[0].creator, 'Ann; Bo', 'creators joined');
  same(odd.next, null, 'no next page when everything was on this one');
  let threw = false;
  try {
    ia.parseIaSearch({ nope: true }, 1, NOW);
  } catch {
    threw = true;
  }
  ok(threw, 'a wrong shape throws');

  /* ---------------------------------------------------------------- the request */
  const query = ia.iaSearchQuery('night living dead');
  same(query, 'title:(night AND living AND dead) AND mediatype:(movies OR audio OR texts OR image OR etree) AND NOT access-restricted-item:true', 'query');
  const fake = fakeFetch(fixture);
  const page = await ia.internetArchiveSearch.search('night living dead', null, deps(fake.fetch));
  same(fake.urls.length, 1, 'one request');
  const url = new URL(fake.urls[0]);
  same(url.origin + url.pathname, 'https://archive.org/advancedsearch.php', 'asks the Archive only');
  same(url.searchParams.get('q'), query, 'sends the built query');
  same(url.searchParams.get('page'), '1', 'first page');
  ok(!url.searchParams.getAll('fl[]').some((field) => /download|view|rating|review|favorite|num_/i.test(field)), 'asks for no engagement field');
  same(page.items.length, 5, 'the search returns the fixture');

  const later = fakeFetch(fixture);
  await ia.internetArchiveSearch.search('night', 3, deps(later.fetch));
  same(new URL(later.urls[0]).searchParams.get('page'), '3', 'a cursor page is used');
  const tampered = fakeFetch(fixture);
  await ia.internetArchiveSearch.search('night', 'x"y', deps(tampered.fetch));
  same(new URL(tampered.urls[0]).searchParams.get('page'), '1', 'a page that is not a number starts at 1');
  for (const bad of [999, -1, 0, 2.5, '7']) {
    const probe = fakeFetch(fixture);
    await ia.internetArchiveSearch.search('night', bad, deps(probe.fetch));
    same(new URL(probe.urls[0]).searchParams.get('page'), '1', `page ${JSON.stringify(bad)} is out of range: starts at 1`);
  }
  same(ia.parseIaSearch({ response: { docs: [], numFound: 100000 } }, 50, NOW).next, null, 'paging stops at page 50');

  /* ---------------------------------------------------------------- fetchOne */
  const none = fakeFetch(fixture);
  same(await ia.internetArchiveSearch.fetchOne('../etc', deps(none.fetch)), null, 'an unsafe id is refused');
  same(none.urls.length, 0, '... without a request');
  const one = fakeFetch(fixture);
  const found = await ia.internetArchiveSearch.fetchOne('night-of-the-living-dead-london', deps(one.fetch));
  same(found && found.externalId, 'night-of-the-living-dead-london', 'fetchOne returns the one asked for');
  same(new URL(one.urls[0]).searchParams.get('q'), 'identifier:"night-of-the-living-dead-london"', 'fetchOne asks by identifier');
  same(await ia.internetArchiveSearch.fetchOne('not-in-the-answer', deps(fakeFetch(fixture).fetch)), null, 'an id the answer lacks is null');

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${error.stack}`);
  process.exit(1);
});
