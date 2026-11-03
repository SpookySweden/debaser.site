/*
 * WEB's PeerTube adapter, offline (SPEC-web.md; run by `npm run checks:web`, part of `npm run verify`):
 *   npx tsc app/lib/web/adapters/peertube.ts app/lib/web/row-addresses.ts app/lib/web/mock-web-repository.ts --outDir Temp/out-web-peertube --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the fixture (5 real tilvids.com videos, engagement counts trimmed out, scripts/fixtures/web/) parses
 * - private, unlisted, sensitive, live, federated and badly identified videos are skipped
 * - HTML is stripped; text is capped
 * - every URL is built from the source's own allow-listed instance and the uuid, never taken from the data
 * - a source naming an instance off the list is refused before anything is fetched
 * - items carry no engagement field even when the response has them, and the request asks for none
 * - one request, to the source's own instance only
 * - the mock PeerTube items obey the same allow-list
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'Temp', 'out-web-peertube', 'lib', 'web');
const pt = require(join(OUT, 'adapters', 'peertube.js'));
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
const HOST = 'tilvids.com';
const UUID = '75458950-1377-42fb-be1c-34a2c5b9f98c';

function checkItemShape(item, where, markup = true) {
  for (const key of Object.keys(item)) {
    ok(ALLOWED_KEYS.has(key), `${where}: unexpected field "${key}"`);
    ok(!ENGAGEMENT.test(key), `${where}: engagement field "${key}"`);
  }
  for (const key of ['url', 'canonicalUrl', 'thumbnailUrl', 'embedUrl']) {
    if (item[key] !== undefined) ok(isAllowedUrl(item[key], pt.PT_ALLOWED_HOSTS), `${where}: ${key} off the allow-list: ${item[key]}`);
  }
  if (item.licenseUrl !== undefined) ok(isAllowedUrl(item.licenseUrl, pt.PT_LINK_HOSTS), `${where}: licence off the list`);
  for (const key of ['title', 'creator', 'description']) {
    if (markup && item[key] !== undefined) ok(!/<[a-z/!]/i.test(item[key]), `${where}: ${key} still holds markup`);
  }
  const addresses = rowAddresses(item);
  ok(addresses.link === item.url && addresses.embed === item.embedUrl, `${where}: the page would draw its link and player`);
  if (item.thumbnailUrl) ok(addresses.thumb === item.thumbnailUrl, `${where}: the page would draw its thumbnail`);
}

/* ------------------------------------------------------------------ the real fixture */
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'peertube-tilvids.json'), 'utf8'));
const real = pt.parseChannelVideos(fixture, HOST, NOW);
same(real.length, 5, 'all five fixture videos become items');
for (const item of real) checkItemShape(item, item.externalId);
ok(real.every((item) => item.kind === 'video'), 'PeerTube items are video');
ok(real.every((item) => item.url === `https://${HOST}/videos/watch/${item.externalId}`), 'page URL is built from the uuid');
ok(real.every((item) => item.embedUrl === `https://${HOST}/videos/embed/${item.externalId}`), 'embed URL is built from the uuid');
ok(real.every((item) => /^https:\/\/tilvids\.com\/lazy-static\/thumbnails\/[0-9a-f-]{36}\.jpg$/.test(item.thumbnailUrl)), 'thumbnail is on the instance, re-built');
ok(real.every((item) => item.id === `peertube:${item.externalId}`), 'ids are peertube:{uuid}');
ok(real.every((item) => Number.isInteger(item.durationSeconds) && item.durationSeconds > 0), 'durations are kept');
same(real[0].licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/', 'licence id 2 is CC BY-SA');

/* ------------------------------------------------------------------ hostile and odd docs */
const base = fixture.data[0];
const doc = (uuid, extra = {}) => ({ ...base, uuid, ...extra });
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const docs = [
  doc(u(1), { name: '<b>Bold</b> &amp; <i>it</i>', truncatedDescription: '<script>alert(1)</script><a href="https://evil.example">Link</a> &lt;img&gt;', views: 9, likes: 9, dislikes: 1, comments: 3, downloads: 7 }),
  doc(u(2), { privacy: { id: 2, label: 'Unlisted' } }),
  doc(u(3), { privacy: { id: 3, label: 'Private' } }),
  doc(u(4), { privacy: undefined }),
  doc(u(5), { nsfw: true }),
  doc(u(6), { isLive: true }),
  doc(u(7), { isLocal: false }),
  doc(u(8), { channel: { ...base.channel, host: 'evil.example' } }),
  doc('../../etc/passwd'),
  doc('75458950-1377-42FB-BE1C-34A2C5B9F98C'),
  doc(u(11), { publishedAt: undefined }),
  doc(u(12), { publishedAt: '2099-01-01T00:00:00Z' }),
  doc(u(13), { thumbnailPath: 'https://evil.example/x.jpg', licence: { id: 99 }, duration: -5, truncatedDescription: 'word '.repeat(600) }),
  doc(u(14), { thumbnailPath: '/lazy-static/thumbnails/../../x.jpg', duration: '60' }),
  doc(u(15), { thumbnailPath: `/static/thumbnails/${u(15)}.png`, name: ['array title'], channel: undefined, account: { displayName: 'Account Name' } }),
  doc(u(1)),
  'not an object',
  null,
];
const items = pt.parseChannelVideos({ data: docs }, HOST, NOW);
const byId = Object.fromEntries(items.map((item) => [item.externalId, item]));
same(Object.keys(byId).sort(), [u(1), u(13), u(14), u(15)], 'only public, local, safe, finished, dated videos with a uuid survive');
for (const item of items) checkItemShape(item, item.externalId, false);
same(byId[u(1)].title, 'Bold & it', 'markup is stripped from the title');
same(byId[u(1)].description, 'Link <img>', 'scripts dropped, tags stripped, entities decoded to plain text');
ok(!Object.keys(byId[u(1)]).some((key) => ENGAGEMENT.test(key)), 'engagement counts in the response are not carried');
same(byId[u(13)].thumbnailUrl, undefined, 'a thumbnail path that is a full URL is dropped');
same(byId[u(13)].licenseUrl, undefined, 'an unknown licence id gives no licence');
same(byId[u(13)].durationSeconds, undefined, 'a negative duration is dropped');
ok(byId[u(13)].description.length <= 1000, 'a description is capped at 1000 characters');
same(byId[u(14)].thumbnailUrl, undefined, 'a thumbnail path that climbs is dropped');
same(byId[u(14)].durationSeconds, undefined, 'a duration that is not a number is dropped');
same(byId[u(15)].thumbnailUrl, `https://${HOST}/static/thumbnails/${u(15)}.png`, 'the older /static/ thumbnail path is kept');
same(byId[u(15)].title, u(15), 'a title that is not a string falls back to the uuid');
same(byId[u(15)].creator, 'Account Name', 'the account name stands in for a missing channel');
same(pt.toWebItem(base, 'evil.example', NOW), null, 'an instance off the list gives nothing');

let threw = false;
try {
  pt.parseChannelVideos({ nope: true }, HOST, NOW);
} catch {
  threw = true;
}
ok(threw, 'a response without data is an error, not an empty stream');

/* ------------------------------------------------------------------ what a row may draw */
const good = real[0];
same(rowAddresses({ ...good, embedUrl: `https://${HOST}/videos/embed/${UUID}?autoplay=1` }).embed, null, 'a player address with a query is dropped');
same(rowAddresses({ ...good, embedUrl: `https://${HOST}/admin/plugins` }).embed, null, 'another page of the instance cannot be framed');
same(rowAddresses({ ...good, embedUrl: `https://peertube.example/videos/embed/${UUID}` }).embed, null, 'an instance off the list cannot be framed');
same(rowAddresses({ ...good, thumbnailUrl: `https://${HOST}/lazy-static/avatars/${UUID}.jpg` }).thumb, null, 'an avatar is not a thumbnail');
same(rowAddresses({ ...good, url: `https://${HOST}/videos/watch/${UUID}/../../admin` }).link, null, 'a climbing page path is dropped');
same(rowAddresses({ ...good, url: `https://framatube.org/videos/watch/${UUID}` }).link, `https://framatube.org/videos/watch/${UUID}`, 'another allow-listed instance is a valid page');

/* ------------------------------------------------------------------ the mock items */
const mocks = MOCK_WEB_ITEMS.filter((item) => item.platform === 'peertube');
ok(mocks.length >= 2, 'the mock repository has PeerTube items');
for (const item of mocks) checkItemShape(item, `mock ${item.externalId}`);

/* ------------------------------------------------------------------ the request and the ref */
const url = new URL(pt.channelVideosUrl({ instance: HOST, channel: 'thelinuxexperiment_channel' }));
same(url.origin, `https://${HOST}`, 'the request goes to the instance over https');
same(url.pathname, '/api/v1/video-channels/thelinuxexperiment_channel/videos', 'the channel videos endpoint');
same(url.searchParams.get('sort'), '-publishedAt', 'newest first');
same(url.searchParams.get('count'), '25', '25 videos');
same(url.searchParams.get('nsfw'), 'false', 'safe for work only');
ok(![...url.searchParams.keys()].some((key) => ENGAGEMENT.test(key)) && !ENGAGEMENT.test(url.searchParams.get('sort')), 'nothing about engagement is requested or sorted by');
same(pt.validRef('tilvids.com/thelinuxexperiment_channel'), { instance: HOST, channel: 'thelinuxexperiment_channel' }, 'a good ref is read');
for (const bad of ['evil.example/channel', 'tilvids.com.evil.example/x', 'tilvids.com/../x', 'tilvids.com/a/b', 'tilvids.com/Upper', 'tilvids.com/', 'tilvids.com', 'https://tilvids.com/x', 'tilvids.com/x?y=1', 'tilvids.com/x@evil.example', 7]) {
  same(pt.validRef(bad), null, `the ref ${JSON.stringify(bad)} is refused`);
}

/* ------------------------------------------------------------------ the fetch */
const response = (status, body, headers = {}) => new Response(body, { status, headers });
const source = { id: 's', platform: 'peertube', ref: 'tilvids.com/thelinuxexperiment_channel', label: 'x', enabled: true };

(async () => {
  const requested = [];
  const fetched = await pt.peertubeAdapter.fetchItems(source, {
    fetch: async (input, init) => {
      requested.push({ input, init });
      return response(200, JSON.stringify(fixture), { 'content-type': 'application/json' });
    },
    now: () => new Date(NOW),
  });
  same(fetched.length, 5, 'fetchItems returns the fixture through the fake fetch');
  same(requested.length, 1, 'one request, no retries');
  ok(requested[0].input.startsWith(`https://${HOST}/api/v1/`), 'the request goes to the source instance');

  let error = null;
  try {
    await pt.peertubeAdapter.fetchItems(source, { fetch: async () => response(302, null, { location: `https://framatube.org/api/v1/video-channels/x/videos` }) });
  } catch (e) {
    error = e;
  }
  ok(error && /host not allowed/.test(error.message), 'a redirect to another instance, even an allow-listed one, is refused');

  let called = false;
  error = null;
  try {
    await pt.peertubeAdapter.fetchItems({ ...source, ref: 'evil.example/x' }, { fetch: async () => { called = true; return response(200, '{}'); } });
  } catch (e) {
    error = e;
  }
  ok(error && !called, 'a ref off the instance list is refused before any fetch');

  process.exitCode = 0;
  console.log(`ok: ${passed} assertions (WEB peertube adapter)`);
})().catch((error) => fail(error.stack));
