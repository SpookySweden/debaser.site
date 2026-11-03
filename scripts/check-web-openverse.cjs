/*
 * WEB's Openverse adapter, offline (SPEC-web.md; run by `npm run checks:web`, part of `npm run verify`):
 *   npx tsc app/lib/web/adapters/openverse.ts app/lib/web/row-addresses.ts app/lib/web/mock-web-repository.ts --outDir Temp/out-web-openverse --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the fixtures (5 real images, 5 real audio results, scripts/fixtures/web/) parse
 * - sensitive and badly identified results are skipped
 * - HTML is stripped; text is capped
 * - every URL is built from the id on api.openverse.org / openverse.org; the direct file, landing page
 *   and creator URLs in the data are never used; a licence is kept only on creativecommons.org
 * - no embed, ever (Openverse has no player; its pages refuse framing)
 * - items carry no engagement field, and the request asks for none
 * - one request; a ref that is not image:/audio: is refused before anything is fetched
 * - the mock Openverse items obey the same allow-list
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'Temp', 'out-web-openverse', 'lib', 'web');
const ov = require(join(OUT, 'adapters', 'openverse.js'));
const { isAllowedUrl } = require(join(OUT, 'urls.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const { MOCK_WEB_ITEMS } = require(join(OUT, 'mock-web-repository.js'));

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

function checkItemShape(item, where, markup = true) {
  for (const key of Object.keys(item)) {
    ok(ALLOWED_KEYS.has(key), `${where}: unexpected field "${key}"`);
    ok(!ENGAGEMENT.test(key), `${where}: engagement field "${key}"`);
  }
  for (const key of ['url', 'canonicalUrl', 'thumbnailUrl']) {
    if (item[key] !== undefined) ok(isAllowedUrl(item[key], ov.OV_ALLOWED_HOSTS), `${where}: ${key} off the allow-list: ${item[key]}`);
  }
  ok(item.embedUrl === undefined, `${where}: an Openverse item has no player`);
  if (item.licenseUrl !== undefined) ok(isAllowedUrl(item.licenseUrl, ov.OV_LINK_HOSTS), `${where}: licence off the list`);
  for (const key of ['title', 'creator', 'description']) {
    if (markup && item[key] !== undefined) ok(!/<[a-z/!]/i.test(item[key]), `${where}: ${key} still holds markup`);
  }
  const addresses = rowAddresses(item);
  ok(addresses.link === item.url, `${where}: the page would draw its link`);
  if (item.thumbnailUrl) ok(addresses.thumb === item.thumbnailUrl, `${where}: the page would draw its thumbnail`);
  ok(addresses.embed === null, `${where}: the page would draw no player`);
}

/* ------------------------------------------------------------------ the real fixtures */
const images = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'openverse-images-nasa.json'), 'utf8'));
const audio = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'openverse-audio-piano.json'), 'utf8'));

// Openverse alone waits 20s (Luke, 2026-10-31); every other adapter keeps safe-fetch's 10s default.
const ADAPTERS_DIR = join(__dirname, '..', 'app', 'lib', 'web', 'adapters');
ok(ov.OV_FETCH_TIMEOUT_MS === 20_000, `Openverse's wait is 20s (${ov.OV_FETCH_TIMEOUT_MS})`);
ok(/timeoutMs: OV_FETCH_TIMEOUT_MS/.test(readFileSync(join(ADAPTERS_DIR, 'openverse.ts'), 'utf8')), 'the Openverse read passes its own wait to safe-fetch');
for (const other of ['internet-archive.ts', 'peertube.ts', 'podcast.ts', 'youtube.ts']) {
  ok(!/timeoutMs/.test(readFileSync(join(ADAPTERS_DIR, other), 'utf8')), `${other} keeps the 10s default`);
}
const realImages = ov.parseSearchResponse(images, 'image', NOW);
const realAudio = ov.parseSearchResponse(audio, 'audio', NOW);
same(realImages.length, 5, 'all five fixture images become items');
same(realAudio.length, 5, 'all five fixture audio results become items');
for (const item of [...realImages, ...realAudio]) checkItemShape(item, item.externalId);
ok(realImages.every((item) => item.kind === 'image' && item.url === `https://openverse.org/image/${item.externalId}`), 'image pages are built from the id');
ok(realImages.every((item) => item.thumbnailUrl === `https://api.openverse.org/v1/images/${item.externalId}/thumb/`), 'image thumbnails are built from the id');
ok(realAudio.every((item) => item.kind === 'audio' && item.url === `https://openverse.org/audio/${item.externalId}`), 'audio pages are built from the id');
same(realAudio[0].thumbnailUrl, undefined, 'an audio result without a thumbnail gets none');
same(realAudio[1].thumbnailUrl, `https://api.openverse.org/v1/audio/${realAudio[1].externalId}/thumb/`, 'an audio result with one gets the built address');
same(realAudio[0].durationSeconds, 10, 'audio duration is read from milliseconds');
same(realAudio[0].licenseUrl, 'https://creativecommons.org/licenses/by/4.0/', 'the licence URL comes from the API');
ok(realImages.every((item) => item.publishedAt === new Date(images.results.find((r) => r.id === item.externalId).indexed_on).toISOString()), 'the date is indexed_on');
const fileHosts = [...images.results, ...audio.results].map((r) => new URL(r.url).hostname);
ok(![...realImages, ...realAudio].some((item) => Object.values(item).some((v) => typeof v === 'string' && fileHosts.some((h) => v.includes(h)))), 'no direct file host from the data appears in an item');

/* ------------------------------------------------------------------ hostile and odd docs */
const base = images.results[0];
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const doc = (id, extra = {}) => ({ ...base, id, ...extra });
const docs = [
  doc(u(1), { title: '<b>Bold</b> &amp; <i>it</i>', creator: '<script>alert(1)</script>Ann &lt;b&gt;', likes: 9, views: 9, rating: 5 }),
  doc(u(2), { mature: true }),
  doc(u(3), { mature: undefined }),
  doc(u(4), { unstable__sensitivity: ['user_reported_sensitive'] }),
  doc('../../etc/passwd'),
  doc('3C5A0C54-9781-4A2E-B649-1DCC5FA638D7'),
  doc(u(7), { indexed_on: undefined }),
  doc(u(8), { indexed_on: '2099-01-01T00:00:00Z' }),
  doc(u(9), { license_url: 'https://evil.example/licence', title: 'word '.repeat(200), url: 'https://evil.example/file.jpg', thumbnail: 'https://evil.example/t.jpg' }),
  doc(u(10), { license_url: 'http://creativecommons.org/licenses/by/2.0/', title: ['array'], creator: null }),
  doc(u(1)),
  'not an object',
  null,
];
const items = ov.parseSearchResponse({ results: docs }, 'image', NOW);
const byId = Object.fromEntries(items.map((item) => [item.externalId, item]));
same(Object.keys(byId).sort(), [u(1), u(10), u(9)].sort(), 'only safe, dated results with a uuid survive');
for (const item of items) checkItemShape(item, item.externalId, false);
same(byId[u(1)].title, 'Bold & it', 'markup is stripped from the title');
same(byId[u(1)].creator, 'Ann <b>', 'scripts dropped, entities decoded to plain text');
same(byId[u(9)].licenseUrl, undefined, 'a licence off the link list is dropped');
same(byId[u(9)].thumbnailUrl, `https://api.openverse.org/v1/images/${u(9)}/thumb/`, 'a thumbnail URL in the data is ignored; the built one is used');
ok(byId[u(9)].title.length <= 300, 'a title is capped at 300 characters');
same(byId[u(10)].licenseUrl, 'https://creativecommons.org/licenses/by/2.0/', 'an http licence is upgraded to https');
same(byId[u(10)].title, u(10), 'a title that is not a string falls back to the id');
same(byId[u(10)].creator, undefined, 'a missing creator is left out');
same(ov.toWebItem({ ...audio.results[0], duration: -1 }, 'audio', NOW).durationSeconds, undefined, 'a negative duration is dropped');

let threw = false;
try {
  ov.parseSearchResponse({ nope: true }, 'image', NOW);
} catch {
  threw = true;
}
ok(threw, 'a response without results is an error, not an empty stream');

/* ------------------------------------------------------------------ what a row may draw */
const good = realImages[0];
same(rowAddresses({ ...good, embedUrl: `https://openverse.org/image/${good.externalId}` }).embed, null, 'even its own page cannot be framed');
same(rowAddresses({ ...good, thumbnailUrl: `https://api.openverse.org/v1/images/${good.externalId}/thumb/?full_size=true` }).thumb, null, 'a thumbnail with a query is dropped');
same(rowAddresses({ ...good, thumbnailUrl: `https://api.openverse.org/v1/images/${good.externalId}/` }).thumb, null, 'the API detail endpoint is not a thumbnail');
same(rowAddresses({ ...good, url: 'https://openverse.org/search?q=x' }).link, null, 'another Openverse page is not an item link');
same(rowAddresses({ ...good, url: `https://api.openverse.org/image/${good.externalId}` }).link, `https://api.openverse.org/image/${good.externalId}`, 'the page shape is held, host on the list');

/* ------------------------------------------------------------------ the request and the ref */
const url = new URL(ov.searchUrl({ media: 'image', query: 'nasa moon' }));
same(url.origin + url.pathname, 'https://api.openverse.org/v1/images/', 'images search on the API');
same(new URL(ov.searchUrl({ media: 'audio', query: 'x' })).pathname, '/v1/audio/', 'audio search on the API');
same(url.searchParams.get('q'), 'nasa moon', 'the query is passed');
same(url.searchParams.get('page_size'), '20', '20 results, the anonymous maximum');
same(url.searchParams.get('mature'), 'false', 'sensitive results left out');
ok(![...url.searchParams.keys()].some((key) => ENGAGEMENT.test(key)), 'nothing about engagement is requested');
same(ov.validRef('image:nasa'), { media: 'image', query: 'nasa' }, 'image:{query} is read');
same(ov.validRef('audio:  rain  '), { media: 'audio', query: 'rain' }, 'audio:{query} is read and trimmed');
for (const bad of ['video:x', 'nasa', 'image:', 'image:   ', `image:${'x'.repeat(201)}`, 'image:a\nb', 'IMAGE:x', 7, null]) {
  same(ov.validRef(bad), null, `the ref ${JSON.stringify(bad)} is refused`);
}

/* ------------------------------------------------------------------ the mock items */
const mocks = MOCK_WEB_ITEMS.filter((item) => item.platform === 'openverse');
ok(mocks.length >= 2, 'the mock repository has Openverse items');
for (const item of mocks) checkItemShape(item, `mock ${item.externalId}`);

/* ------------------------------------------------------------------ the fetch */
const response = (status, body, headers = {}) => new Response(body, { status, headers });
const source = { id: 's', platform: 'openverse', ref: 'image:nasa', label: 'x', enabled: true };

(async () => {
  const requested = [];
  const fetched = await openverseFetch(requested);
  same(fetched.length, 5, 'fetchItems returns the fixture through the fake fetch');
  same(requested.length, 1, 'one request, no retries');
  ok(requested[0].startsWith('https://api.openverse.org/v1/images/?'), 'the request goes to the API');

  let error = null;
  try {
    await ov.openverseAdapter.fetchItems(source, { fetch: async () => response(429, 'slow down') });
  } catch (e) {
    error = e;
  }
  ok(error && /HTTP 429/.test(error.message), 'a rate-limit answer is an error, not retried');

  error = null;
  try {
    await ov.openverseAdapter.fetchItems(source, { fetch: async () => response(302, null, { location: 'https://openverse.org/x' }) });
  } catch (e) {
    error = e;
  }
  ok(error && /host not allowed/.test(error.message), 'a redirect off the API host is refused');

  let called = false;
  error = null;
  try {
    await ov.openverseAdapter.fetchItems({ ...source, ref: 'nasa' }, { fetch: async () => { called = true; return response(200, '{}'); } });
  } catch (e) {
    error = e;
  }
  ok(error && !called, 'a malformed ref is refused before any fetch');

  process.exitCode = 0;
  console.log(`ok: ${passed} assertions (WEB openverse adapter)`);
})().catch((error) => fail(error.stack));

async function openverseFetch(requested) {
  return ov.openverseAdapter.fetchItems(source, {
    fetch: async (input) => {
      requested.push(input);
      return response(200, JSON.stringify(images), { 'content-type': 'application/json' });
    },
    now: () => new Date(NOW),
  });
}
