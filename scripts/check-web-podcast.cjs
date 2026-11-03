/*
 * WEB's podcast RSS adapter and its XML reader, offline (SPEC-web.md; run by `npm run checks:web`, part of `npm run verify`):
 *   npx tsc app/lib/web/adapters/podcast.ts app/lib/web/row-addresses.ts app/lib/web/mock-web-repository.ts --outDir Temp/out-web-podcast --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the fixture (Hacker Public Radio's real feed, cut to 5 episodes, scripts/fixtures/web/) parses
 * - explicit, blocked, enclosure-less, undated and unidentifiable episodes are skipped
 * - HTML (the feed's CDATA) is stripped; text is capped; an author's email address never shows
 * - the only feed that can be read is one listed in PODCAST_FEEDS; an episode link off the feed's own
 *   host and path falls back to the show page; the feed's image and enclosure URLs are never used
 * - the XML reader refuses DTDs and entity declarations, malformed and over-deep or over-large input
 * - items carry no engagement field; one request, to the feed's own host only
 * - the mock podcast items obey the same allow-list
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'Temp', 'out-web-podcast', 'lib', 'web');
const pod = require(join(OUT, 'adapters', 'podcast.js'));
const xml = require(join(OUT, 'adapters', 'xml.js'));
const { PODCAST_FEEDS } = require(join(OUT, 'hosts.js'));
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
const throws = (fn, pattern, message) => {
  try {
    fn();
  } catch (error) {
    ok(pattern.test(error.message), `${message} (threw "${error.message}")`);
    return;
  }
  fail(`${message} (did not throw)`);
};

const ALLOWED_KEYS = new Set([
  'id', 'platform', 'externalId', 'kind', 'url', 'canonicalUrl', 'title', 'creator', 'description',
  'thumbnailUrl', 'embedUrl', 'licenseUrl', 'durationSeconds', 'tags', 'publishedAt', 'fetchedAt',
  // The platform's own language (Luke, 2026-11-03: language flags on content), a code like 'es' or 'pt-BR'.
  'language',
]);
const ENGAGEMENT = /like|view|download|rating|star|follow|comment|play_?count|favou?rite|subscri|review|score/i;
const NOW = '2026-10-31T12:00:00.000Z';
const FEED = PODCAST_FEEDS.find((feed) => feed.key === 'hpr');
ok(FEED, 'the Hacker Public Radio feed is listed');

function checkItemShape(item, where, markup = true) {
  for (const key of Object.keys(item)) {
    ok(ALLOWED_KEYS.has(key), `${where}: unexpected field "${key}"`);
    ok(!ENGAGEMENT.test(key), `${where}: engagement field "${key}"`);
  }
  for (const key of ['url', 'canonicalUrl', 'thumbnailUrl']) {
    if (item[key] !== undefined) ok(isAllowedUrl(item[key], pod.POD_ALLOWED_HOSTS), `${where}: ${key} off the allow-list: ${item[key]}`);
  }
  ok(item.embedUrl === undefined, `${where}: a podcast item has no player`);
  if (item.licenseUrl !== undefined) ok(isAllowedUrl(item.licenseUrl, pod.POD_LINK_HOSTS), `${where}: licence off the list`);
  for (const key of ['title', 'creator', 'description']) {
    if (markup && item[key] !== undefined) ok(!/<[a-z/!]/i.test(item[key]), `${where}: ${key} still holds markup`);
  }
  if (item.creator !== undefined) ok(!/@/.test(item.creator), `${where}: the creator shows an email address`);
  const addresses = rowAddresses(item);
  ok(addresses.link === item.url, `${where}: the page would draw its link`);
  if (item.thumbnailUrl) ok(addresses.thumb === item.thumbnailUrl, `${where}: the page would draw its thumbnail`);
  ok(addresses.embed === null, `${where}: the page would draw no player`);
}

/* ------------------------------------------------------------------ the real fixture */
const fixture = readFileSync(join(__dirname, 'fixtures', 'web', 'podcast-hpr.xml'), 'utf8');
const real = pod.parseFeed(fixture, FEED, NOW);
same(real.length, 4, 'four of the five fixture episodes become items (one is marked explicit)');
for (const item of real) checkItemShape(item, item.externalId);
same(real.map((item) => item.url), [4760, 4759, 4758, 4757].map((n) => `https://hackerpublicradio.org/eps/hpr${n}/index.html`), 'episode links are kept on their own host and shape');
ok(real.every((item) => item.kind === 'audio'), 'audio/ogg enclosures are audio');
ok(real.every((item) => item.thumbnailUrl === FEED.artworkUrl && item.licenseUrl === FEED.licenseUrl), 'artwork and licence come from the feed list, not the feed');
ok(real.every((item) => /^hpr-[0-9a-f]{32}$/.test(item.externalId) && item.id === `podcast:${item.externalId}`), 'ids are a hash of the guid');
same(real[0].creator, 'Ahuka', 'the name is taken out of "email (Name)"');
same(real[0].publishedAt, '2026-10-30T00:00:00.000Z', 'pubDate is read');
ok(real.every((item) => item.description.length <= 1000), 'long descriptions are capped');
ok(!real.some((item) => Object.values(item).some((v) => typeof v === 'string' && /ccdn\.php|hpr_feed_itunes/.test(v))), 'the enclosure and feed image URLs are never used');
same(pod.parseFeed(fixture, FEED, NOW).map((item) => item.id), real.map((item) => item.id), 'ids are stable across reads');

/* ------------------------------------------------------------------ hostile and odd episodes */
const ep = (inner) => `<item>${inner}</item>`;
const ENC = '<enclosure url="https://evil.example/a.mp3" length="1" type="audio/mpeg"/>';
const DATE = '<pubDate>Fri, 30 Oct 2026 00:00:00 +0000</pubDate>';
const feedOf = (items) => `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>t</title>${items.join('')}</channel></rss>`;
const hostile = pod.parseFeed(
  feedOf([
    ep(`<guid>g1</guid><title>&lt;b&gt;Bold&lt;/b&gt; &amp;amp; it</title><description><![CDATA[<script>alert(1)</script><p>Para</p><img src=x onerror=alert(1)>]]></description><link>https://evil.example/eps/hpr1/index.html</link><itunes:author>a@b.example</itunes:author><itunes:duration>1:02:03</itunes:duration>${ENC}${DATE}`),
    ep(`<guid>g2</guid><title>explicit</title><itunes:explicit>yes</itunes:explicit>${ENC}${DATE}`),
    ep(`<guid>g3</guid><title>blocked</title><itunes:block>Yes</itunes:block>${ENC}${DATE}`),
    ep(`<guid>g4</guid><title>no enclosure</title>${DATE}`),
    ep(`<guid>g5</guid><title>pdf</title><enclosure url="https://x.example/a.pdf" type="application/pdf"/>${DATE}`),
    ep(`<guid>g6</guid><title>no date</title>${ENC}`),
    ep(`<guid>g7</guid><title>future</title>${ENC}<pubDate>Fri, 01 Jan 2100 00:00:00 +0000</pubDate>`),
    ep(`<title>no id at all</title><enclosure type="audio/mpeg"/>${DATE}`),
    ep(`<guid>g9</guid><title>video</title><link>https://hackerpublicradio.org/eps/hpr9/index.html?utm=1</link><enclosure url="x" type="video/mp4"/><itunes:duration>abc</itunes:duration>${DATE}`),
    ep(`<guid>g10</guid><title>climb</title><link>https://hackerpublicradio.org/eps/hpr1/../../admin</link><author>x@y.example (Real Name)</author><itunes:duration>3600</itunes:duration>${ENC}${DATE}`),
    ep(`<guid>g1</guid><title>duplicate</title>${ENC}${DATE}`),
  ]),
  FEED,
  NOW,
);
const byTitle = Object.fromEntries(hostile.map((item) => [item.title, item]));
same(hostile.map((item) => item.title), ['Bold & it', 'video', 'climb'], 'only clean, enclosed, dated, identified episodes survive, once each');
for (const item of hostile) checkItemShape(item, item.title, false);
const first = hostile[0];
same(first.description, 'Para', 'CDATA HTML is stripped, scripts dropped');
same(first.url, FEED.showUrl, 'an episode link off the feed host falls back to the show page');
same(first.creator, undefined, 'an author that is only an email address shows nothing');
same(first.durationSeconds, 3723, 'HH:MM:SS duration is read');
same(byTitle.video.kind, 'video', 'a video enclosure is video');
same(byTitle.video.url, FEED.showUrl, 'an episode link with a query falls back to the show page');
same(byTitle.video.durationSeconds, undefined, 'a malformed duration is dropped');
same(byTitle.climb.url, FEED.showUrl, 'an episode link that climbs out of the path shape falls back');
same(byTitle.climb.creator, 'Real Name', 'the bracketed name is kept');
same(byTitle.climb.durationSeconds, 3600, 'a duration in seconds is read');
throws(() => pod.parseFeed('<feed><entry/></feed>', FEED, NOW), /not an RSS feed/, 'an Atom document is not a podcast feed');
same(pod.parseDuration('00:00'), undefined, 'a zero duration is dropped');
same(pod.parseDuration('999999:00:00'), undefined, 'an absurd duration is dropped');

/* ------------------------------------------------------------------ the XML reader */
throws(() => xml.parseXml('<!DOCTYPE r [<!ENTITY a "aaaa">]><r>&a;</r>'), /DTDs/, 'a DTD is refused');
throws(() => xml.parseXml('<r><!ENTITY x SYSTEM "file:///etc/passwd"></r>'), /DTDs/, 'an entity declaration is refused');
throws(() => xml.parseXml('<r><a></r>'), /mismatched/, 'a mismatched end tag is refused');
throws(() => xml.parseXml('<r>'), /unclosed/, 'an unclosed element is refused');
throws(() => xml.parseXml('<r a=1/>'), /attribute/, 'an unquoted attribute is refused');
throws(() => xml.parseXml('<r/><s/>'), /root/, 'two roots are refused');
throws(() => xml.parseXml('<r><![CDATA[x</r>'), /CDATA/, 'an unclosed CDATA is refused');
throws(() => xml.parseXml(`${'<a>'.repeat(40)}${'</a>'.repeat(40)}`), /deeply/, 'deep nesting is refused');
throws(() => xml.parseXml(`<r>${'<a/>'.repeat(xml.XML_MAX_ELEMENTS + 1)}</r>`), /too many/, 'too many elements are refused');
throws(() => xml.parseXml(`<r>${'x'.repeat(xml.XML_MAX_LENGTH)}</r>`), /too large/, 'an over-large document is refused');
same(xml.parseXml('<r a="x&gt;y" b=\'2\'>&lt;&#65;&#x42;&nope;</r>').attrs, { a: 'x>y', b: '2' }, 'attributes: both quotes, > inside a value, entities decoded');
same(xml.parseXml('<r>&lt;&#65;&#x42;&nope;</r>').text, '<AB&nope;', 'only the five XML entities and numeric references are decoded');
same(xml.parseXml('<r a="&toString;">&constructor;&__proto__;&hasOwnProperty;</r>').text, '&constructor;&__proto__;&hasOwnProperty;', 'an entity named after an object member stays literal');
same(xml.parseXml('<r a="&toString;"/>').attrs.a, '&toString;', 'the same in an attribute');
same(xml.parseXml('<r><![CDATA[&amp;<b>]]></r>').text, '&amp;<b>', 'CDATA is kept as written');
same(xml.parseXml('<?xml version="1.0"?><!-- c --><r><!-- <x> --></r>').children, [], 'comments and the declaration are skipped');
ok(Object.getPrototypeOf(xml.parseXml('<r __proto__="x"/>').attrs) === null, 'attributes cannot reach the object prototype');

/* ------------------------------------------------------------------ the ref and what a row may draw */
same(pod.validRef(FEED.feedUrl), FEED, 'a listed feed URL is read');
for (const bad of ['https://evil.example/feed.xml', `${FEED.feedUrl}?x=1`, FEED.feedUrl.replace('https:', 'http:'), ` ${FEED.feedUrl}`, 'hpr', 7, null]) {
  same(pod.validRef(bad), null, `the ref ${JSON.stringify(bad)} is refused`);
}
const good = real[0];
same(rowAddresses({ ...good, url: 'https://hackerpublicradio.org/admin.php' }).link, null, 'another page of the show host is not an episode link');
same(rowAddresses({ ...good, thumbnailUrl: 'https://hackerpublicradio.org/images/other.png' }).thumb, null, 'only the listed artwork is a thumbnail');
same(rowAddresses({ ...good, url: 'https://evil.example/eps/hpr1/index.html' }).link, null, 'an episode shape on another host is dropped');
same(rowAddresses({ ...good, embedUrl: good.url }).embed, null, 'nothing of a podcast can be framed');

/* ------------------------------------------------------------------ the mock items */
const mocks = MOCK_WEB_ITEMS.filter((item) => item.platform === 'podcast');
ok(mocks.length >= 2, 'the mock repository has podcast items');
for (const item of mocks) checkItemShape(item, `mock ${item.externalId}`);

/* ------------------------------------------------------------------ the fetch */
const response = (status, body, headers = {}) => new Response(body, { status, headers });
const source = { id: 's', platform: 'podcast', ref: FEED.feedUrl, label: 'x', enabled: true };

(async () => {
  const requested = [];
  const fetched = await pod.podcastAdapter.fetchItems(source, {
    fetch: async (input, init) => {
      requested.push({ input, init });
      return response(200, fixture, { 'content-type': 'application/xml' });
    },
    now: () => new Date(NOW),
  });
  same(fetched.length, 4, 'fetchItems returns the fixture through the fake fetch');
  same(requested.length, 1, 'one request, no retries');
  same(requested[0].input, FEED.feedUrl, 'the request is the listed feed URL');
  ok(/rss\+xml/.test(requested[0].init.headers.Accept), 'it asks for RSS');

  let error = null;
  try {
    await pod.podcastAdapter.fetchItems(source, { fetch: async () => response(302, null, { location: 'https://hackerpublicradio.org.evil.example/feed' }) });
  } catch (e) {
    error = e;
  }
  ok(error && /host not allowed/.test(error.message), 'a redirect off the feed host is refused');

  let called = false;
  error = null;
  try {
    await pod.podcastAdapter.fetchItems({ ...source, ref: 'https://evil.example/feed.xml' }, { fetch: async () => { called = true; return response(200, ''); } });
  } catch (e) {
    error = e;
  }
  ok(error && !called, 'a feed off the list is refused before any fetch');

  process.exitCode = 0;
  console.log(`ok: ${passed} assertions (WEB podcast adapter, XML reader)`);
})().catch((error) => fail(error.stack));
