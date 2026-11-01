/*
 * WEB's YouTube channel RSS adapter, offline (SPEC-web.md; run by `npm run checks:web`, part of `npm run verify`):
 *   npx tsc app/lib/web/adapters/youtube.ts app/lib/web/row-addresses.ts app/lib/web/mock-web-repository.ts --outDir Temp/out-web-youtube --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the fixture (Blender's real channel feed, 5 entries, media:community trimmed out, scripts/fixtures/web/) parses
 * - entries with a bad video id, from another channel, or undated are skipped
 * - HTML is stripped; text is capped
 * - page, thumbnail and player are built from the video id: youtu.be, i.ytimg.com, and the player only on
 *   www.youtube-nocookie.com; no URL from the feed is used
 * - media:community (star ratings, view counts) is never read; items carry no engagement field
 * - one request, to www.youtube.com only; a bad channel id is refused before anything is fetched
 * - the mock YouTube items obey the same allow-list
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'Temp', 'out-web-youtube', 'lib', 'web');
const yt = require(join(OUT, 'adapters', 'youtube.js'));
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
]);
const ENGAGEMENT = /like|view|download|rating|star|follow|comment|play_?count|favou?rite|subscri|review|score/i;
const NOW = '2026-10-31T12:00:00.000Z';
const CHANNEL = 'UCSMOQeBJ2RAnuFungnQOxLg';

function checkItemShape(item, where, markup = true) {
  for (const key of Object.keys(item)) {
    ok(ALLOWED_KEYS.has(key), `${where}: unexpected field "${key}"`);
    ok(!ENGAGEMENT.test(key), `${where}: engagement field "${key}"`);
  }
  ok(isAllowedUrl(item.url, ['youtu.be']) && item.url === item.canonicalUrl, `${where}: page off youtu.be: ${item.url}`);
  ok(isAllowedUrl(item.thumbnailUrl, ['i.ytimg.com']), `${where}: thumbnail off i.ytimg.com: ${item.thumbnailUrl}`);
  ok(isAllowedUrl(item.embedUrl, ['www.youtube-nocookie.com']), `${where}: player off youtube-nocookie: ${item.embedUrl}`);
  ok(item.licenseUrl === undefined, `${where}: YouTube items carry no licence`);
  for (const key of ['title', 'creator', 'description']) {
    if (markup && item[key] !== undefined) ok(!/<[a-z/!]/i.test(item[key]), `${where}: ${key} still holds markup`);
  }
  const addresses = rowAddresses(item);
  same(addresses, { link: item.url, thumb: item.thumbnailUrl, embed: item.embedUrl, licence: null }, `${where}: the page would draw its link, picture and player`);
}

/* ------------------------------------------------------------------ the real fixture */
const fixture = readFileSync(join(__dirname, 'fixtures', 'web', 'youtube-blender.xml'), 'utf8');
const real = yt.parseFeed(fixture, CHANNEL, NOW);
same(real.map((item) => item.externalId), ['H5TGt-susIY', 'YsKxkP_kGbE', 'dVrELpmfcEQ', 'EycY6jDFK74', 'oMeecNng9TM'], 'all five fixture entries become items, in order');
for (const item of real) checkItemShape(item, item.externalId);
ok(real.every((item) => item.url === `https://youtu.be/${item.externalId}`), 'page URL is built from the id');
ok(real.every((item) => item.thumbnailUrl === `https://i.ytimg.com/vi/${item.externalId}/hqdefault.jpg`), 'thumbnail URL is built from the id (the feed says i1.ytimg.com)');
ok(real.every((item) => item.embedUrl === `https://www.youtube-nocookie.com/embed/${item.externalId}`), 'the player is the privacy-enhanced one');
ok(real.every((item) => item.kind === 'video' && item.creator === 'Blender' && item.id === `youtube:${item.externalId}`), 'kind, creator and id');
same(real[0].publishedAt, '2026-10-28T20:22:59.000Z', 'the published date is read');
ok(real[0].description.startsWith('Hola Community!') && Array.from(real[0].description).length <= 1000, 'the description is read and capped');

/* ------------------------------------------------------------------ hostile and odd entries */
const entry = (id, inner = '', channel = CHANNEL) =>
  `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><yt:channelId>${channel}</yt:channelId><published>2026-10-01T00:00:00+00:00</published>${inner}</entry>`;
const COMMUNITY = '<media:community><media:starRating count="9999" average="5.00" min="1" max="5"/><media:statistics views="9999"/></media:community>';
const feedOf = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"><title>t</title>${entries.join('')}</feed>`;
const hostile = yt.parseFeed(
  feedOf([
    entry('AAAAAAAAAA1', `<title>&lt;b&gt;Bold&lt;/b&gt; &amp;amp; it</title><link rel="alternate" href="https://evil.example/watch"/><author><name>&lt;script&gt;x&lt;/script&gt;Chan</name></author><media:group><media:thumbnail url="https://evil.example/t.jpg"/><media:content url="https://evil.example/v"/><media:description><![CDATA[<a href="https://evil.example">Link</a> ok]]></media:description>${COMMUNITY}</media:group>`),
    entry('-AAAAAAAAA2'),
    entry('_AAAAAAAAA3'),
    entry('AAAA'),
    entry('AAAAAAAAAA../'),
    entry('AAAAAAAAA%2F'),
    entry('AAAAAAAAAA7', '', 'UCxxxxxxxxxxxxxxxxxxxxxx'),
    `<entry><yt:videoId>AAAAAAAAAA8</yt:videoId><yt:channelId>${CHANNEL}</yt:channelId></entry>`,
    `<entry><yt:videoId>AAAAAAAAAA9</yt:videoId><yt:channelId>${CHANNEL}</yt:channelId><published>2100-01-01T00:00:00Z</published></entry>`,
    entry('AAAAAAAAA10', '<media:group><media:title>From the group</media:title></media:group>'),
    entry('AAAAAAAAAA1', '<title>duplicate</title>'),
  ]),
  CHANNEL,
  NOW,
);
const byId = Object.fromEntries(hostile.map((item) => [item.externalId, item]));
same(Object.keys(byId), ['AAAAAAAAAA1', 'AAAAAAAAA10'], 'only well-formed ids from this channel with a date survive, once each');
for (const item of hostile) checkItemShape(item, item.externalId, false);
same(byId.AAAAAAAAAA1.title, 'Bold & it', 'markup is stripped from the title');
same(byId.AAAAAAAAAA1.creator, 'Chan', 'scripts are dropped from the author');
same(byId.AAAAAAAAAA1.description, 'Link ok', 'CDATA HTML is stripped');
ok(!JSON.stringify(byId.AAAAAAAAAA1).includes('9999') && !JSON.stringify(byId.AAAAAAAAAA1).includes('evil.example'), 'no rating, view count or feed URL reaches the item');
same(byId.AAAAAAAAA10.title, 'From the group', 'media:title stands in for a missing title');
let threw = false;
try {
  yt.parseFeed('<rss><channel/></rss>', CHANNEL, NOW);
} catch {
  threw = true;
}
ok(threw, 'an RSS document is not a YouTube feed');

/* ------------------------------------------------------------------ what a row may draw */
const good = real[0];
const id = good.externalId;
same(rowAddresses({ ...good, embedUrl: `https://www.youtube.com/embed/${id}` }).embed, null, 'the cookie-setting player on www.youtube.com is refused');
same(rowAddresses({ ...good, embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1` }).embed, null, 'a player address with a query is refused');
same(rowAddresses({ ...good, embedUrl: `https://www.youtube-nocookie.com/${id}` }).embed, null, 'a player address of the wrong shape is refused');
same(rowAddresses({ ...good, url: `https://www.youtube.com/${id}` }).link, null, 'a page link is only ever youtu.be');
same(rowAddresses({ ...good, url: `https://youtu.be/${id}/../x` }).link, null, 'a climbing page path is refused');
same(rowAddresses({ ...good, thumbnailUrl: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` }).thumb, null, 'only the hqdefault picture shape is drawn');
same(rowAddresses({ ...good, thumbnailUrl: `https://youtu.be/vi/${id}/hqdefault.jpg` }).thumb, null, 'a picture is only ever from i.ytimg.com');

/* ------------------------------------------------------------------ the request and the ref */
const url = new URL(yt.feedUrl(CHANNEL));
same(url.toString(), `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`, 'the channel feed URL');
same(yt.validRef(CHANNEL), CHANNEL, 'a channel id is read');
for (const bad of ['SMOQeBJ2RAnuFungnQOxLg', `${CHANNEL}x`, 'UCSMOQeBJ2RAnuFungnQOx/g', `${CHANNEL}&x=1`, ` ${CHANNEL}`, '@blender', 'https://www.youtube.com/@blender', 7, null]) {
  same(yt.validRef(bad), null, `the ref ${JSON.stringify(bad)} is refused`);
}

/* ------------------------------------------------------------------ the mock items */
const mocks = MOCK_WEB_ITEMS.filter((item) => item.platform === 'youtube');
ok(mocks.length >= 2, 'the mock repository has YouTube items');
for (const item of mocks) checkItemShape(item, `mock ${item.externalId}`);

/* ------------------------------------------------------------------ the fetch */
const response = (status, body, headers = {}) => new Response(body, { status, headers });
const source = { id: 's', platform: 'youtube', ref: CHANNEL, label: 'x', enabled: true };

(async () => {
  const requested = [];
  const fetched = await yt.youtubeAdapter.fetchItems(source, {
    fetch: async (input, init) => {
      requested.push({ input, init });
      return response(200, fixture, { 'content-type': 'text/xml; charset=UTF-8' });
    },
    now: () => new Date(NOW),
  });
  same(fetched.length, 5, 'fetchItems returns the fixture through the fake fetch');
  same(requested.length, 1, 'one request, no retries');
  same(requested[0].input, `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`, 'the request is the channel feed');

  let error = null;
  try {
    await yt.youtubeAdapter.fetchItems(source, { fetch: async () => response(302, null, { location: 'https://i.ytimg.com/x' }) });
  } catch (e) {
    error = e;
  }
  ok(error && /host not allowed/.test(error.message), 'a redirect off www.youtube.com is refused, even to another YouTube host');

  let called = false;
  error = null;
  try {
    await yt.youtubeAdapter.fetchItems({ ...source, ref: '@blender' }, { fetch: async () => { called = true; return response(200, ''); } });
  } catch (e) {
    error = e;
  }
  ok(error && !called, 'a bad channel id is refused before any fetch');

  process.exitCode = 0;
  console.log(`ok: ${passed} assertions (WEB youtube adapter)`);
})().catch((error) => fail(error.stack));
