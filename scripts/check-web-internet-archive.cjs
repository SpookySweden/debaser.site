/*
 * WEB's Internet Archive adapter, safe fetch and paging, offline (SPEC-web.md; run by `npm run checks:web`,
 * part of `npm run verify`):
 *   npx tsc app/lib/web/adapters/internet-archive.ts app/lib/web/paging.ts app/lib/web/mock-web-repository.ts app/lib/web/row-addresses.ts --outDir Temp/out-web --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the fixture (5 real docs, scripts/fixtures/web/) parses; fields arriving as a string or an array both work
 * - access-restricted items and invalid identifiers are skipped
 * - HTML is stripped and entities decoded; text is capped
 * - every URL an item carries is https on the platform's allow-list (licence: its link hosts)
 * - items carry no engagement field, and the search never asks for one
 * - the fetch refuses other hosts, http, redirects off the list, and bodies over the cap
 * - keyset paging neither drops nor repeats items, ties included; a bad cursor gives an empty page
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'Temp', 'out-web', 'lib', 'web');
const ia = require(join(OUT, 'adapters', 'internet-archive.js'));
const paging = require(join(OUT, 'paging.js'));
const { MOCK_WEB_ITEMS } = require(join(OUT, 'mock-web-repository.js'));
const { isAllowedUrl } = require(join(OUT, 'urls.js'));
const { safeFetchText, MAX_RESPONSE_BYTES } = require(join(OUT, 'safe-fetch.js'));
const { sanitiseText, plausibleIsoDate } = require(join(OUT, 'sanitise.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const { decodeCursor, encodeCursor } = paging;

// Failing until the last line says otherwise: if the process ends early (Node does not wait on an
// `AbortSignal.timeout` timer), the run is a failure, never a silent pass.
process.exitCode = 1;
let passed = 0;
const fail = (message) => {
  console.log(`FAIL ${message}`);
  process.exit(1);
};
const ok = (condition, message) => {
  if (!condition) fail(message);
  passed += 1;
};
const same = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message} (got ${JSON.stringify(a)})`);

const ALLOWED_KEYS = new Set([
  'id', 'platform', 'externalId', 'kind', 'url', 'canonicalUrl', 'title', 'creator', 'description',
  'thumbnailUrl', 'embedUrl', 'licenseUrl', 'durationSeconds', 'tags', 'publishedAt', 'fetchedAt',
  // The platform's own language (Luke, 2026-11-03: language flags on content), a code like 'es' or 'pt-BR'.
  'language',
]);
const ENGAGEMENT = /like|view|download|rating|star|follow|comment|play_?count|favou?rite|subscri|review|score/i;
const NOW = '2026-10-31T12:00:00.000Z';

/** `markup`: also hold that no tag-like text is left - true for real data, whose text had no escaped tags. */
function checkItemShape(item, where, markup = true) {
  for (const key of Object.keys(item)) {
    ok(ALLOWED_KEYS.has(key), `${where}: unexpected field "${key}"`);
    ok(!ENGAGEMENT.test(key), `${where}: engagement field "${key}"`);
  }
  for (const key of ['url', 'canonicalUrl', 'thumbnailUrl', 'embedUrl']) {
    if (item[key] !== undefined) ok(isAllowedUrl(item[key], ia.IA_ALLOWED_HOSTS), `${where}: ${key} off the allow-list: ${item[key]}`);
  }
  if (item.licenseUrl !== undefined) ok(isAllowedUrl(item.licenseUrl, ia.IA_LINK_HOSTS), `${where}: licence off the list`);
  for (const key of ['title', 'creator', 'description']) {
    if (markup && item[key] !== undefined) ok(!/<[a-z/!]/i.test(item[key]), `${where}: ${key} still holds markup`);
  }
}

/* ------------------------------------------------------------------ the real fixture */
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'internet-archive-librivox.json'), 'utf8'));
const real = ia.parseSearchResponse(fixture, NOW);
same(real.length, 5, 'all five fixture docs become items');
for (const item of real) checkItemShape(item, item.externalId);
ok(real.every((item) => item.kind === 'audio'), 'LibriVox docs are audio');
ok(real.every((item) => item.embedUrl === `https://archive.org/embed/${item.externalId}`), 'embed URL is built from the id');
ok(real.every((item) => item.thumbnailUrl === `https://archive.org/services/img/${item.externalId}`), 'thumbnail URL is built from the id');
ok(real.every((item) => item.url === `https://archive.org/details/${item.externalId}`), 'page URL is built from the id');
ok(real.every((item) => item.fetchedAt === NOW && !Number.isNaN(Date.parse(item.publishedAt))), 'dates are ISO');

/* ------------------------------------------------------------------ hostile and odd docs */
const docs = [
  { identifier: 'array-fields', title: ['First title', 'Second'], creator: ['Ann', 'Bo'], description: ['<p>One</p>', 'Two'], mediatype: ['movies'], publicdate: ['2026-01-02T03:04:05Z'], licenseurl: 'http://creativecommons.org/licenses/by/4.0/' },
  { identifier: 'restricted-string', title: 'x', publicdate: '2026-01-01T00:00:00Z', 'access-restricted-item': 'true' },
  { identifier: 'restricted-bool', title: 'x', publicdate: '2026-01-01T00:00:00Z', 'access-restricted-item': true },
  { identifier: 'restricted-array', title: 'x', publicdate: '2026-01-01T00:00:00Z', 'access-restricted-item': ['TRUE'] },
  { identifier: 'open-false', title: 'kept', publicdate: '2026-01-01T00:00:00Z', 'access-restricted-item': 'false', mediatype: 'image' },
  { identifier: '../etc/passwd', title: 'x', publicdate: '2026-01-01T00:00:00Z' },
  { identifier: '-leading-dash', title: 'x', publicdate: '2026-01-01T00:00:00Z' },
  { identifier: 'has space', title: 'x', publicdate: '2026-01-01T00:00:00Z' },
  { identifier: 'javascript:alert(1)', title: 'x', publicdate: '2026-01-01T00:00:00Z' },
  { identifier: '', title: 'x', publicdate: '2026-01-01T00:00:00Z' },
  { identifier: ['ok-from-array'], title: 'arr id', publicdate: '2026-01-01T00:00:00Z', mediatype: 'texts' },
  { identifier: 'no-date', title: 'x' },
  { identifier: 'html', title: '<b>Bold</b> &amp; <i>it</i>', description: '<script>alert(1)</script><a href="https://evil.example">Link</a> &lt;img src=x onerror=alert(1)&gt; &#x41;&#66; &nbsp; ok', publicdate: '2026-01-01T00:00:00Z', licenseurl: 'https://evil.example/licence', downloads: 999, num_favorites: 5, avg_rating: 4 },
  { identifier: 'long', title: 'x', description: 'word '.repeat(600), publicdate: '2026-01-01T00:00:00Z', mediatype: 'weird' },
  'not an object',
  null,
];
const items = ia.parseSearchResponse({ response: { docs } }, NOW);
const byId = Object.fromEntries(items.map((item) => [item.externalId, item]));
same(Object.keys(byId).sort(), ['array-fields', 'html', 'long', 'ok-from-array', 'open-false'], 'only the valid, open, dated docs survive');
// The hostile docs decode `&lt;img&gt;` into the literal text `<img>` on purpose (plain text, rendered inert),
// so their text is held to the exact values below instead.
for (const item of items) checkItemShape(item, item.externalId, false);

same(byId['array-fields'].title, 'First title', 'an array title reads its first entry');
same(byId['array-fields'].creator, 'Ann; Bo', 'array creators are joined');
same(byId['array-fields'].description, 'One Two', 'array descriptions are joined and stripped');
same(byId['array-fields'].kind, 'video', 'movies is video');
same(byId['array-fields'].licenseUrl, 'https://creativecommons.org/licenses/by/4.0/', 'an http licence is upgraded to https');
same(byId['open-false'].embedUrl, undefined, 'an image item has no player');
same(byId['ok-from-array'].kind, 'text', 'texts is text');
same(byId.html.title, 'Bold & it', 'markup is stripped from the title');
same(byId.html.description, 'Link <img src=x onerror=alert(1)> AB ok', 'scripts dropped, tags stripped, entities decoded to plain text');
same(byId.html.licenseUrl, undefined, 'a licence off the link list is dropped');
ok(!('downloads' in byId.html) && !('num_favorites' in byId.html), 'engagement data in the response is not carried');
ok(byId.long.description.length <= 1000, 'a description is capped at 1000 characters');
same(byId.long.kind, 'other', 'an unknown mediatype is other');

let threw = false;
try {
  ia.parseSearchResponse({ nope: true }, NOW);
} catch {
  threw = true;
}
ok(threw, 'a response without docs is an error, not an empty stream');

/* ------------------------------------------------------------------ text and dates */
const astral = String.fromCodePoint(0x1f600);
same(sanitiseText(astral.repeat(600)), astral.repeat(600), 'emoji count as one character each: 600 is under the cap, nothing cut');
same(Array.from(sanitiseText(astral.repeat(1200))).length, 1000, 'a long emoji string is cut to 1000 characters');
const lone = String.fromCharCode(0xd800);
same(sanitiseText(`a${lone}b`), 'ab', 'a raw lone surrogate is dropped');
same(sanitiseText('a&#xD800;b'), 'ab', 'an entity for a surrogate is dropped');
same(sanitiseText(`x${String.fromCharCode(0x202e)}y${String.fromCharCode(0x2066)}z`), 'x y z', 'bidirectional overrides become spaces');
same(sanitiseText(`a${String.fromCharCode(0)}b`), 'a b', 'control characters become spaces');
same(plausibleIsoDate('2099-01-01', NOW), undefined, 'a date in the future is refused');
same(plausibleIsoDate('+010000-01-01T00:00:00Z', NOW), undefined, 'a year past 9999 is refused');
same(plausibleIsoDate('2026-10-31T13:00:00Z', NOW), '2026-10-31T13:00:00.000Z', 'within a day of fetching is kept');
same(plausibleIsoDate('1923', NOW), '1923-01-01T00:00:00.000Z', 'a bare year is read');
same(ia.toWebItem({ identifier: 'future', publicdate: '2099-01-01', title: 'x' }, NOW), null, 'an item dated in the future is skipped');

/* ------------------------------------------------------------------ what a row may draw */
const good = real[0];
same(rowAddresses(good), { link: good.url, thumb: good.thumbnailUrl, embed: good.embedUrl, licence: good.licenseUrl }, 'a real item keeps every address');
const hostile = {
  ...good,
  url: 'javascript:alert(1)',
  thumbnailUrl: 'http://archive.org/services/img/x',
  embedUrl: 'https://archive.org/account/login.php',
  licenseUrl: 'https://archive.org/details/x',
};
same(rowAddresses(hostile), { link: null, thumb: null, embed: null, licence: null }, 'javascript:, http, an off-shape path and a licence off its list are all dropped');
same(rowAddresses({ ...good, embedUrl: 'https://archive.org/embed/x?autoplay=1' }).embed, null, 'a player address with a query is dropped');
same(rowAddresses({ ...good, url: 'https://evil.example/details/x' }).link, null, 'an off-list host is dropped');
same(rowAddresses({ ...good, thumbnailUrl: 'https://archive.org.evil.example/services/img/x' }).thumb, null, 'a look-alike host is dropped');
same(rowAddresses({ ...good, platform: 'nope' }), { link: null, thumb: null, embed: null, licence: null }, 'an unknown platform draws nothing');

/* ------------------------------------------------------------------ the request */
const url = new URL(ia.searchUrl('collection:librivoxaudio AND mediatype:audio'));
same(url.origin, 'https://archive.org', 'the search goes to archive.org over https');
same(url.searchParams.getAll('fl[]'), ia.IA_FIELDS.slice(), 'the search asks for exactly the metadata fields');
ok(!url.searchParams.getAll('fl[]').some((field) => ENGAGEMENT.test(field)), 'no engagement field is requested');
same(url.searchParams.get('rows'), '25', '25 rows');
same(url.searchParams.get('sort[]'), 'publicdate desc', 'newest first');
same(ia.validQuery('x'.repeat(501)), null, 'an over-long query is refused');
same(ia.validQuery('a\nb'), null, 'a query with a control character is refused');
same(ia.validQuery('   '), null, 'an empty query is refused');

/* ------------------------------------------------------------------ the fetch */
const response = (status, body, headers = {}) => new Response(body, { status, headers });
const source = { id: 's', platform: 'internet_archive', ref: 'collection:librivoxaudio', label: 'x', enabled: true };

async function rejects(promise, pattern, message) {
  try {
    await promise;
  } catch (error) {
    ok(pattern.test(error.message), `${message} (threw "${error.message}")`);
    return;
  }
  fail(`${message} (did not throw)`);
}

// Holds the process open while the timeout tests wait on unref'd timers.
const keepAlive = setInterval(() => undefined, 1000);
(async () => {
  const requested = [];
  const fetched = await ia.internetArchiveAdapter.fetchItems(source, {
    fetch: async (input, init) => {
      requested.push({ input, init });
      return response(200, JSON.stringify(fixture), { 'content-type': 'application/json' });
    },
    now: () => new Date(NOW),
  });
  same(fetched.length, 5, 'fetchItems returns the fixture through the fake fetch');
  same(requested.length, 1, 'one request, no retries');
  ok(requested[0].init.redirect === 'manual' && requested[0].init.credentials === 'omit', 'redirects by hand, no credentials');
  ok(/^DebaserSiteWEB\/1\.0 \(\+https:\/\/debaser\.site/.test(requested[0].init.headers['User-Agent']), 'a descriptive User-Agent');

  const offList = async () => response(302, null, { location: 'https://evil.example/steal' });
  await rejects(ia.internetArchiveAdapter.fetchItems(source, { fetch: offList }), /host not allowed/, 'a redirect off the allow-list is refused');
  const toHttp = async () => response(301, null, { location: 'http://archive.org/x' });
  await rejects(ia.internetArchiveAdapter.fetchItems(source, { fetch: toHttp }), /host not allowed/, 'a redirect to http is refused');
  let hops = 0;
  const loop = async () => {
    hops += 1;
    return response(302, null, { location: 'https://archive.org/again' });
  };
  await rejects(ia.internetArchiveAdapter.fetchItems(source, { fetch: loop }), /too many redirects/, 'a redirect loop stops');
  ok(hops <= 4, 'at most three redirects are followed');

  const big = 'x'.repeat(MAX_RESPONSE_BYTES + 10);
  await rejects(ia.internetArchiveAdapter.fetchItems(source, { fetch: async () => response(200, big) }), /too large/, 'a body over the cap is refused while streaming');
  await rejects(
    ia.internetArchiveAdapter.fetchItems(source, { fetch: async () => response(200, 'x', { 'content-length': String(MAX_RESPONSE_BYTES + 1) }) }),
    /too large/,
    'a declared length over the cap is refused',
  );
  await rejects(ia.internetArchiveAdapter.fetchItems(source, { fetch: async () => response(503, 'down') }), /HTTP 503/, 'an error status is an error');
  await rejects(ia.internetArchiveAdapter.fetchItems(source, { fetch: async () => response(200, '<html>') }), /not JSON/, 'a non-JSON body is an error');
  let called = false;
  await rejects(
    ia.internetArchiveAdapter.fetchItems({ ...source, ref: '' }, { fetch: async () => { called = true; return response(200, '{}'); } }),
    /query/,
    'an empty source query is refused',
  );
  ok(!called, 'nothing is fetched for a refused query');
  const hang = (input, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  await rejects(safeFetchText('https://archive.org/x', { allowedHosts: ['archive.org'], fetchImpl: hang, timeoutMs: 50 }), /timed out/, 'a request that never answers times out');
  const slowBody = async (input, init) =>
    new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); init.signal.addEventListener('abort', () => controller.error(init.signal.reason)); } }));
  await rejects(safeFetchText('https://archive.org/x', { allowedHosts: ['archive.org'], fetchImpl: slowBody, timeoutMs: 50 }), /body read failed/, 'a body that stalls times out as a SafeFetchError');
  await rejects(
    safeFetchText('https://archive.org/x', { allowedHosts: ['archive.org'], fetchImpl: async () => response(302, null, { location: 'https://[::1' }) }),
    /malformed location/,
    'a malformed redirect is a SafeFetchError',
  );
  await rejects(safeFetchText('http://archive.org/x', { allowedHosts: ['archive.org'], fetchImpl: async () => response(200, '') }), /host not allowed/, 'http is refused');
  await rejects(safeFetchText('https://archive.org.evil.example/', { allowedHosts: ['archive.org'], fetchImpl: async () => response(200, '') }), /host not allowed/, 'a look-alike host is refused');
  await rejects(safeFetchText('https://user@archive.org/', { allowedHosts: ['archive.org'], fetchImpl: async () => response(200, '') }), /host not allowed/, 'credentials in the URL are refused');

  /* ---------------------------------------------------------------- paging */
  const seen = [];
  let cursor = null;
  for (let page = 0; page < 10; page += 1) {
    const result = paging.pageOf(MOCK_WEB_ITEMS, cursor, 5);
    seen.push(...result.items.map((item) => item.id));
    cursor = result.nextCursor;
    if (cursor === null) break;
  }
  same(seen.length, MOCK_WEB_ITEMS.length, 'paging through the mock reaches every item');
  same(new Set(seen).size, seen.length, 'no item is repeated across pages');
  const sorted = [...MOCK_WEB_ITEMS].sort(paging.compareItems).map((item) => item.id);
  same(seen, sorted, 'pages come newest first, ties by id');
  same(paging.pageOf(MOCK_WEB_ITEMS, 'garbage!!', 5), { items: [], nextCursor: null }, 'an unreadable cursor gives an empty page');
  const b64 = (text) => Buffer.from(text).toString('base64url');
  same(decodeCursor(encodeCursor({ publishedAt: NOW, id: 'internet_archive:abc' })), { publishedAt: NOW, id: 'internet_archive:abc' }, 'a cursor round-trips');
  same(decodeCursor(b64(`${NOW}|internet_archive:a,b)or(1=1`)), null, 'a cursor id with filter characters is refused');
  same(decodeCursor(b64('2026-10-31|internet_archive:abc')), null, 'a cursor date that is not canonical ISO is refused');
  same(decodeCursor(b64(`${NOW}|noplatform`)), null, 'a cursor id without a platform is refused');
  same(paging.clampLimit(1000), paging.MAX_PAGE_SIZE, 'the page size is capped');
  // Each platform's own check holds its mock items to its allow-list; this one holds the Archive's.
  const archiveMocks = MOCK_WEB_ITEMS.filter((item) => item.platform === 'internet_archive');
  ok(archiveMocks.length >= 10, 'the Archive mock items are found');
  for (const item of archiveMocks) checkItemShape(item, `mock ${item.externalId}`);
  ok(MOCK_WEB_ITEMS.every((item) => item.title.startsWith('MOCK ITEM')), 'every mock title says MOCK');

  clearInterval(keepAlive);
  process.exitCode = 0;
  console.log(`ok: ${passed} assertions (WEB internet archive adapter, safe fetch, paging)`);
})().catch((error) => fail(error.stack));
