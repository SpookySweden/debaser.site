/*
 * The reading in MEDIA's default feed (SPEC-media-feed.md; run by `npm run checks:web`), offline against real saved
 * documents (scripts/fixtures/web/brief-*) and hostile ones:
 *   npx tsc app/lib/web/brief/index.ts app/lib/web/brief/addresses.ts app/lib/web/row-addresses.ts --outDir Temp/out-web-brief --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --strictNullChecks
 *
 * - arXiv, Europe PMC, Wikipedia and every listed article feed parse; HTML is stripped
 * - every link and picture passes the page's own re-check (`readingRowAddresses`; `rowAddresses` for the YouTube and
 *   Archive rows), and nothing else does: off-list hosts and
 *   paths, http, tracking queries kept, a forged open link
 * - Hacker News and Lobsters rows link to the story's site, name that site, and carry no summary (decision 2A)
 * - no counts anywhere: no citation counts, no Wikipedia "most read", no YouTube ratings, no points
 * - one request per source; a failing source does not stop the others, and keeps its last good answer for six hours
 * - each kind's shelf life holds
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'Temp', 'out-web-brief', 'lib', 'web');
const FIX = join(__dirname, 'fixtures', 'web');
const brief = require(join(OUT, 'brief', 'index.js'));
const feeds = require(join(OUT, 'brief', 'feeds.js'));
const arxiv = require(join(OUT, 'brief', 'arxiv.js'));
const epmc = require(join(OUT, 'brief', 'europe-pmc.js'));
const wiki = require(join(OUT, 'brief', 'wikipedia.js'));
const articles = require(join(OUT, 'brief', 'articles.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const { readingRowAddresses, isReadingRow } = require(join(OUT, 'brief', 'addresses.js'));
/** The page's re-check: a reading row against the reading lists, any other row against its platform's. */
const pageCheck = (item) => (isReadingRow(item) ? readingRowAddresses(item) : rowAddresses(item));

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
const throws = (fn, message) => {
  try {
    fn();
  } catch {
    passed += 1;
    return;
  }
  fail(message);
};

const NOW = new Date('2026-11-16T16:00:00Z');
const AT = NOW.toISOString();
const fixture = (name) => readFileSync(join(FIX, name), 'utf8');
const ENGAGEMENT = /"(likes?|views?|viewCount|ratings?|stars?|score|points|comments?|commentCount|citedByCount|citations?|mostread|popularity|followers?|subscribers?|count)"\s*:/i;

/** A tag left in text (a plain `<` in "p < 0.05" is fine). */
const TAG = /<\/?[a-z!]/i;

/** Every address on a row passes the page's re-check, and the row has a link. */
function addressesHold(item, label) {
  const shown = pageCheck(item);
  ok(shown.link === item.url, `${label}: its link passes the page's check (${item.url})`);
  if (item.thumbnailUrl) ok(shown.thumb === item.thumbnailUrl, `${label}: its picture passes the page's check (${item.thumbnailUrl})`);
  ok(shown.embed === null, `${label}: a reading row has no player`);
  ok(!TAG.test(item.title) && !TAG.test(item.description ?? ''), `${label}: no HTML left in its text`);
  ok(!ENGAGEMENT.test(JSON.stringify(item)), `${label}: no count of any kind`);
}

/* ------------------------------------------------------------------ arXiv */
const papers = arxiv.parseArxiv(fixture('brief-arxiv.xml'), AT);
ok(papers.length >= 5, `arXiv: the saved answer gives papers (${papers.length})`);
for (const paper of papers) {
  addressesHold(paper, `arXiv ${paper.id}`);
  ok(paper.platform === 'paper' && paper.outlet === 'ARXIV' && /^paper:arxiv-[0-9]{4}\.[0-9]{4,5}v[0-9]+$/.test(paper.id), `arXiv: ${paper.id} is a PAPER row credited to ARXIV`);
}
ok(papers.some((paper) => (paper.tags ?? []).length > 0), 'arXiv: subjects come through as words');
ok(papers.some((paper) => / ET AL\.$/.test(paper.creator ?? '')), 'arXiv: more than three authors end in ET AL.');
const arxivAsk = new URL(arxiv.arxivUrl());
ok(arxivAsk.hostname === 'export.arxiv.org' && arxivAsk.searchParams.get('search_query').includes('cat:cs.AI'), 'arXiv: the request is to the API with the listed fields');
const hostileArxiv = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry><id>http://evil.example/abs/2611.00001v1</id><published>2026-11-15T00:00:00Z</published><title>Off the list</title></entry>
  <entry><id>http://arxiv.org/abs/../../etc</id><published>2026-11-15T00:00:00Z</published><title>Climbing</title></entry>
  <entry><id>http://arxiv.org/abs/2611.00002v1</id><published>2099-01-01T00:00:00Z</published><title>From the future</title></entry>
  <entry><id>http://arxiv.org/abs/2611.00003v2</id><published>2026-11-15T00:00:00Z</published><title>&lt;script&gt;x&lt;/script&gt;<![CDATA[<b>Bold</b> claim]]></title><summary><![CDATA[<img src=x onerror=alert(1)>Plain]]></summary></entry>
</feed>`;
const hostilePapers = arxiv.parseArxiv(hostileArxiv, AT);
ok(hostilePapers.length === 1 && hostilePapers[0].id === 'paper:arxiv-2611.00003v2', 'arXiv: off-list, malformed and future entries are skipped');
ok(!/[<>]/.test(hostilePapers[0].title) && hostilePapers[0].description === 'Plain', 'arXiv: HTML in a title or summary is stripped');
throws(() => arxiv.parseArxiv('<!DOCTYPE x [<!ENTITY a "b">]><feed/>', AT), 'arXiv: a DTD is refused');

/* ------------------------------------------------------------------ Europe PMC */
const epmcBody = JSON.parse(fixture('brief-europepmc.json'));
const epmcPapers = epmc.parseEuropePmc(epmcBody, AT);
ok(epmcPapers.length >= 5, `Europe PMC: the saved answer gives papers (${epmcPapers.length})`);
for (const paper of epmcPapers) {
  addressesHold(paper, `Europe PMC ${paper.id}`);
  ok(paper.description !== undefined, `Europe PMC: a preprint keeps its abstract (${paper.id})`);
}
const epmcAsk = new URL(epmc.europePmcUrl());
ok(epmcAsk.hostname === 'www.ebi.ac.uk' && !/cited/i.test(epmcAsk.search), 'Europe PMC: the request asks for no counts');
const hostileEpmc = {
  resultList: {
    result: [
      { id: '../../x', source: 'PPR', title: 'Climbing', firstPublicationDate: '2026-11-14' },
      { id: 'PPR1', source: 'EVIL', title: 'Off the list', firstPublicationDate: '2026-11-14' },
      { id: '123', source: 'MED', title: '<i>Closed</i>', abstractText: 'Paywalled abstract', isOpenAccess: 'N', firstPublicationDate: '2026-11-14', citedByCount: 999 },
    ],
  },
};
const hostileEpmcRows = epmc.parseEuropePmc(hostileEpmc, AT);
ok(hostileEpmcRows.length === 1 && hostileEpmcRows[0].id === 'paper:epmc-123', 'Europe PMC: bad ids and sources are skipped');
ok(hostileEpmcRows[0].description === undefined && hostileEpmcRows[0].title === 'Closed', 'Europe PMC: a closed record shows no abstract, and its title loses its HTML');
ok(!/999|cited/i.test(JSON.stringify(hostileEpmcRows)), 'Europe PMC: the citation count is never read');
throws(() => epmc.parseEuropePmc({ nope: true }, AT), 'Europe PMC: a wrong shape throws');

/* ------------------------------------------------------------------ Wikipedia */
const featured = JSON.parse(fixture('brief-wikipedia.json'));
const wikiRows = wiki.parseFeatured({ ...featured, mostread: { articles: [{ title: 'Most_read', views: 123456 }] } }, AT);
const itn = wikiRows.filter((row) => row.kind === 'news');
const tfa = wikiRows.filter((row) => row.kind === 'longread');
ok(itn.length >= 1 && tfa.length === 1, `Wikipedia: "In the news" and the featured article both come through (${itn.length} + ${tfa.length})`);
for (const row of wikiRows) addressesHold(row.item, `Wikipedia ${row.item.id}`);
ok(!JSON.stringify(wikiRows).includes('Most_read') && !JSON.stringify(wikiRows).includes('123456'), 'Wikipedia: "most read" and its view counts are never read');
ok(itn.every((row) => row.item.outlet === 'WIKIPEDIA' && row.item.publishedAt === '2026-11-16T00:00:00.000Z'), 'Wikipedia: stories are credited and dated today');
ok(wiki.articlePage('A#b') === null && wiki.articlePage('') === null && wiki.articlePage('AC/DC') !== null, 'Wikipedia: a title with a fragment is refused, a slash is encoded');
ok(new URL(wiki.wikipediaUrl(NOW)).pathname === '/api/rest_v1/feed/featured/2026/11/16', "Wikipedia: today's feed is asked for");

/* ------------------------------------------------------------------ article feeds */
const FEED_FIXTURES = {
  bbc: 'brief-bbc.xml', npr: 'brief-npr.xml', dw: 'brief-dw.xml', aljazeera: 'brief-aljazeera.xml', pbs: 'brief-pbs.xml',
  guardian: 'brief-guardian.xml', quanta: 'brief-quanta.xml', aeon: 'brief-aeon.xml', nautilus: 'brief-nautilus.xml',
  owid: 'brief-owid.xml', hn: 'brief-hn.xml', lobsters: 'brief-lobsters.xml', hackaday: 'brief-hackaday.xml', make: 'brief-make.xml',
};
ok(feeds.ARTICLE_FEEDS.every((feed) => FEED_FIXTURES[feed.key]), 'every listed article feed has a saved document here');
const byFeed = {};
for (const feed of feeds.ARTICLE_FEEDS) {
  const items = articles.parseArticles(fixture(FEED_FIXTURES[feed.key]), feed, AT);
  byFeed[feed.key] = items;
  ok(items.length >= 3, `${feed.key}: the saved feed gives articles (${items.length})`);
  for (const item of items) {
    addressesHold(item, `${feed.key} ${item.id}`);
    ok(item.platform === feed.kind && item.outlet === feed.outlet, `${feed.key}: rows are ${feed.kind} rows credited to ${feed.outlet}`);
    if (!feed.open) ok(new URL(item.url).search === '' && new URL(item.url).hash === '', `${feed.key}: the outlet's tracking query is dropped (${item.url})`);
  }
}
ok(byFeed.bbc.some((item) => item.thumbnailUrl), 'BBC: pictures pass their path rule');
ok(byFeed.hackaday.some((item) => item.thumbnailUrl) && byFeed.pbs.some((item) => item.thumbnailUrl), 'Hackaday and PBS: pictures pass their path rules');
ok(byFeed.guardian.every((item) => !item.thumbnailUrl), 'The Guardian: no pictures (their addresses carry a signature)');
ok(byFeed.guardian.some((item) => (item.tags ?? []).length > 0), 'The Guardian: categories come through as words');
for (const key of ['hn', 'lobsters']) {
  for (const item of byFeed[key]) {
    ok(item.description === undefined, `${key}: no summary (it is only a comments link)`);
    ok(item.creator === feeds.openLinkSite(item.url), `${key}: the row names the story's site (${item.creator})`);
  }
}
ok(!byFeed.lobsters.some((item) => / via | by /.test(item.creator ?? '')), 'Lobsters: no usernames');
const hnOrder = articles.parseArticles(fixture('brief-hn.xml'), feeds.ARTICLE_FEEDS.find((feed) => feed.key === 'hn'), AT).map((item) => item.title);
const hnTitles = [...fixture('brief-hn.xml').matchAll(/<item><title>([^<]*)<\/title>/g)].map((m) => m[1].replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"'));
ok(hnOrder[0] === hnTitles[0] && hnOrder[1] === hnTitles[1], 'Hacker News: the front page keeps its own order');

const bbcFeed = feeds.ARTICLE_FEEDS.find((feed) => feed.key === 'bbc');
const hnFeed = feeds.ARTICLE_FEEDS.find((feed) => feed.key === 'hn');
const rssOf = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items}</channel></rss>`;
const hostileBbc = articles.parseArticles(
  rssOf(`
  <item><title>Off host</title><link>https://evil.example/news/articles/abcdefgh12</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate></item>
  <item><title>Plain http</title><link>http://www.bbc.co.uk/news/articles/abcdefgh12</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate></item>
  <item><title>Off path</title><link>https://www.bbc.co.uk/iplayer/episode/x</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate></item>
  <item><title>Climbing</title><link>https://www.bbc.co.uk/news/../../admin</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate></item>
  <item><title>Good &lt;b&gt;one&lt;/b&gt;</title><link>https://www.bbc.co.uk/news/articles/abcdefgh12?at_medium=RSS#top</link><description><![CDATA[<p onclick="x">Summary</p>]]></description><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate>
    <media:thumbnail url="https://evil.example/ace/standard/240/cpsprodpb/e0bf/live/84ae2db0-e165-11f1-9e72-69608c7a1547.jpg"/></item>
  <item><title>Picture with a query</title><link>https://www.bbc.co.uk/news/articles/zzzzzzzz12</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate>
    <media:thumbnail url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/e0bf/live/84ae2db0-e165-11f1-9e72-69608c7a1547.jpg?track=1"/></item>`),
  bbcFeed,
  AT,
);
ok(hostileBbc.length === 2, `article feeds: off-host, http, off-path and climbing links are skipped (${hostileBbc.map((item) => item.title).join(' | ')})`);
ok(hostileBbc[0].url === 'https://www.bbc.co.uk/news/articles/abcdefgh12' && hostileBbc[0].description === 'Summary' && hostileBbc[0].title === 'Good one', 'article feeds: the query and fragment are dropped and HTML stripped');
ok(hostileBbc[0].thumbnailUrl === undefined, 'article feeds: a picture off its host is dropped');
ok(hostileBbc[1].thumbnailUrl === 'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/e0bf/live/84ae2db0-e165-11f1-9e72-69608c7a1547.jpg', "article feeds: a listed picture is rebuilt without its query");
const hostileHn = articles.parseArticles(
  rssOf(`
  <item><title>Http</title><link>http://example.com/a</link><pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate></item>
  <item><title>Local</title><link>https://localhost/a</link><pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate></item>
  <item><title>Numbers</title><link>https://127.0.0.1/a</link><pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate></item>
  <item><title>Port</title><link>https://example.com:8443/a</link><pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate></item>
  <item><title>Login</title><link>https://user:pw@example.com/a</link><pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate></item>
  <item><title>Script</title><link>javascript:alert(1)</link><pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate></item>
  <item><title>A story</title><link>https://www.github.com/x/y?tab=readme#top</link><pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate><description>points: 999</description></item>`),
  hnFeed,
  AT,
);
ok(hostileHn.length === 1 && hostileHn[0].url === 'https://www.github.com/x/y?tab=readme', `open links: only an ordinary https story passes, query kept and fragment dropped (${hostileHn.map((item) => item.title).join(' | ')})`);
ok(hostileHn[0].creator === 'GITHUB.COM' && !JSON.stringify(hostileHn).includes('999'), 'open links: the row names GITHUB.COM and reads no points');
throws(() => articles.parseArticles('<html><body>not a feed</body></html>', bbcFeed, AT), 'article feeds: a page that is not a feed throws');

/* ------------------------------------------------------------------ the page's re-check */
const forged = { ...hostileHn[0], id: 'tech:hackaday-abc', url: 'https://evil.example/x' };
ok(pageCheck(forged).link === null, 'the open link is only for Hacker News and Lobsters ids: any other tech row stays on its list');
ok(pageCheck({ ...hostileHn[0], url: 'http://example.com/a' }).link === null, 'an open link is re-checked on the page too');
ok(pageCheck({ ...byFeed.bbc[0], url: 'https://www.bbc.co.uk/news/articles/abcdefgh12?x=1' }).link === null, 'a news row with a query fails the page check');
ok(pageCheck({ ...byFeed.bbc[0], thumbnailUrl: 'https://ichef.bbci.co.uk/other/x.jpg' }).thumb === null, 'a picture off its path fails the page check');
ok(rowAddresses(byFeed.bbc[0]).link === null && rowAddresses(papers[0]).link === null, "the platforms' own lists (rowAddresses) give a reading row nothing: only the reading lists do");
ok(readingRowAddresses(byFeed.bbc[0]).embed === null && readingRowAddresses(byFeed.bbc[0]).licence === null, 'a reading row never has a player or a licence');
ok(readingRowAddresses({ ...byFeed.bbc[0], platform: 'youtube' }).link === null, 'the reading lists answer for reading rows only');

/* ------------------------------------------------------------------ the whole brief */
const RESPONSES = [
  ['export.arxiv.org', 'brief-arxiv.xml'],
  ['www.ebi.ac.uk', 'brief-europepmc.json'],
  ['en.wikipedia.org', 'brief-wikipedia.json'],
  ['channel_id=UCknLrEdhRCp1aegoMqRaCZg', 'brief-yt_dw.xml'],
  ['channel_id=UC6ZFN9Tx6xh-skXCuRHCDpQ', 'brief-yt_pbs.xml'],
  ['channel_id=UCNye-wNBqNL5ZzHSJj3l8Bg', 'brief-yt_aje.xml'],
  ['archive.org/advancedsearch', 'search-internet-archive.json'],
  ...feeds.ARTICLE_FEEDS.map((feed) => [feed.feedUrl, FEED_FIXTURES[feed.key]]),
];
function fakeFetch(asked, broken = () => false) {
  return async (url) => {
    asked.push(url);
    if (broken(url)) return new Response('nope', { status: 500 });
    const hit = RESPONSES.find(([part]) => url.includes(part));
    if (!hit) return new Response('', { status: 404 });
    const body = fixture(hit[1]);
    return new Response(body, { status: 200, headers: { 'content-type': hit[1].endsWith('.json') ? 'application/json' : 'application/xml' } });
  };
}

(async () => {
  brief.forgetLastGood();
  const asked = [];
  const rows = await brief.readBrief({ fetch: fakeFetch(asked), now: () => NOW });
  ok(asked.length === brief.BRIEF_SOURCES.length, `one request per source (${asked.length} for ${brief.BRIEF_SOURCES.length})`);
  for (const kind of feeds.READING_KINDS) ok(rows.some((row) => row.kind === kind), `the brief has ${kind} rows`);
  ok(rows.some((row) => row.kind === 'news' && row.item.platform === 'youtube'), "the broadcasters' news videos come through as YouTube rows");
  ok(rows.some((row) => row.kind === 'longread' && row.item.platform === 'internet_archive'), "the Archive's lectures come through as Internet Archive rows");
  ok(!rows.some((row) => /\/shorts\//.test(row.item.url)), 'no YouTube Shorts');
  ok(new Set(rows.map((row) => row.item.id)).size === rows.length, 'no row twice');
  ok(!ENGAGEMENT.test(JSON.stringify(rows)) && !/media:community|starRating|statistics/.test(JSON.stringify(rows)), 'no counts anywhere in the brief');
  ok(rows.every((row) => brief.onShelf(row, NOW.getTime())), 'every row is inside its shelf life');

  // A day later, two days of news have aged off; papers have not.
  const later = new Date(NOW.getTime() + 3 * 86_400_000);
  brief.forgetLastGood();
  const old = await brief.readBrief({ fetch: fakeFetch([]), now: () => later });
  ok(!old.some((row) => row.kind === 'news' && Date.parse(row.item.publishedAt) < later.getTime() - 48 * 3_600_000), 'news older than 48 hours is off the shelf');
  ok(old.some((row) => row.kind === 'paper'), 'papers stay for 30 days');

  // One source broken: the others carry on; it keeps its last good answer for six hours, then goes quiet.
  brief.forgetLastGood();
  await brief.readBrief({ fetch: fakeFetch([]), now: () => NOW });
  const brokenBbc = (url) => url.includes('feeds.bbci.co.uk');
  const soon = await brief.readBrief({ fetch: fakeFetch([], brokenBbc), now: () => new Date(NOW.getTime() + 3_600_000) });
  ok(soon.some((row) => row.item.outlet === 'BBC NEWS'), 'a failing feed keeps its last good answer');
  ok(soon.some((row) => row.item.outlet === 'NPR'), 'the other feeds carry on');
  const quiet = await brief.readBrief({ fetch: fakeFetch([], brokenBbc), now: () => new Date(NOW.getTime() + 7 * 3_600_000) });
  ok(!quiet.some((row) => row.item.outlet === 'BBC NEWS'), 'after six hours a failing feed goes quiet');
  const allBroken = await brief.readBrief({ fetch: fakeFetch([], () => true), now: () => new Date(NOW.getTime() + 8 * 3_600_000) });
  ok(Array.isArray(allBroken), 'everything failing gives an empty brief, never a thrown error');

  console.log(`check-web-brief: ${passed} passed`);
  process.exitCode = 0;
})().catch((error) => fail(error && error.stack ? error.stack : String(error)));
