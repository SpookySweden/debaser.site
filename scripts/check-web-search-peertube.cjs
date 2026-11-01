/*
 * WEB search everywhere: the PeerTube provider (Sepia Search) and the instances index, offline (SPEC-web-search.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/search/providers/peertube.ts app/lib/web/row-addresses.ts --outDir Temp/out-web-search-pt --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the fixtures (5 real Sepia results with views/likes/comments cut out, and the real index of 1,738 hosts) parse
 * - a video is kept only when its instance is in the index and its account, channel and page name that one host:
 *   a port, a mismatch, or a host the index lacks drops it, whatever the result says
 * - every address is built from that host and the uuid; the page check passes them only with the index's hosts
 * - private, sensitive, live and badly identified videos are skipped; HTML is stripped; no engagement field comes out
 * - the index refuses IP addresses, ports, local names and odd shapes, and a failed read falls back to the fixed list
 * - one request to sepiasearch.org; paging steps by 20 and stops at 1000; fetchOne asks by uuid only
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { NOW, makeAsserts, checkItem, fakeFetch } = require('./web-search-check-kit.cjs');

const OUT = join(__dirname, '..', 'Temp', 'out-web-search-pt', 'lib', 'web');
const pt = require(join(OUT, 'search', 'providers', 'peertube.js'));
const index = require(join(OUT, 'search', 'peertube-index.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const asserts = makeAsserts('WEB search: PeerTube (Sepia Search, instances index)');
const { ok, same } = asserts;

(async () => {
  /* ---------------------------------------------------------------- the index */
  const indexBody = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'search-peertube-index.json'), 'utf8'));
  const hosts = index.parseIndex(indexBody);
  same(hosts.size, 1738, 'every real index host is accepted');
  for (const bad of ['127.0.0.1', '10.0.0.1', 'localhost', 'vid.amat.us:10443', 'a.b.local', 'x.internal', 'UPPER.COM', 'evil.com/path', 'https://x.org', '-x.org', 'x..org', 'x.org.', '', null, 7, 'x.123']) {
    ok(!index.isPublicHostname(bad), `not a public host name: ${JSON.stringify(bad)}`);
  }
  same([...index.parseIndex({ data: [{ host: 'good.example.org' }, { host: '127.0.0.1' }, { host: 'a.local' }, null, { nohost: 1 }] })], ['good.example.org'], 'odd entries are skipped');
  const down = await index.peertubeHosts(async () => { throw new TypeError('down'); }, 1);
  same([...down].sort(), ['framatube.org', 'tilvids.com', 'video.blender.org'], 'an index that cannot be read leaves the fixed list alone');
  const tiny = await index.peertubeHosts(fakeFetch({ data: [{ host: 'one.example.org' }] }).fetch, 2);
  ok(!tiny.has('one.example.org'), 'an implausibly small index is not trusted');
  const indexFetch = fakeFetch(indexBody);
  const full = await index.peertubeHosts(indexFetch.fetch, 10 ** 13);
  ok(full.has('fedi.video') && full.has('video.blender.org'), 'a good index adds its hosts to the fixed list');
  same(indexFetch.urls, ['https://instances.joinpeertube.org/api/v1/instances/hosts?count=5000&start=0'], 'the index is read from joinpeertube.org');
  await index.peertubeHosts(indexFetch.fetch, 10 ** 13 + 1000);
  same(indexFetch.urls.length, 1, 'and held, not read again at once');

  /* ---------------------------------------------------------------- the real fixture */
  const extra = { peertube: [...hosts] };
  const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'search-peertube-sepia.json'), 'utf8'));
  const real = pt.parseSepia(fixture, 0, hosts, NOW);
  same(real.items.map((item) => new URL(item.url).host), ['vod.newellijay.tv', 'fedi.video', 'peertube.linuxrocks.online'], 'kept: one consistent indexed host each; dropped: a port and a host mismatch');
  for (const item of real.items) {
    checkItem(asserts, rowAddresses, item, item.externalId, extra);
    const host = new URL(item.url).host;
    same(item.embedUrl, `https://${host}/videos/embed/${item.externalId}`, 'player built from host and uuid');
    ok(item.thumbnailUrl.startsWith(`https://${host}/lazy-static/thumbnails/`), 'thumbnail on the same host');
    same(rowAddresses(item).embed, null, 'without the index hosts the page draws no player for it');
  }
  same(real.next, 20, 'next start is 20');
  const notIndexed = pt.parseSepia(fixture, 0, new Set(['fedi.video']), NOW);
  same(notIndexed.items.map((item) => new URL(item.url).host), ['fedi.video'], 'a host missing from the index is dropped');

  /* ---------------------------------------------------------------- hostile docs */
  const base = fixture.data[1];
  const variant = (change) => ({ ...JSON.parse(JSON.stringify(base)), ...change });
  const hostile = [
    variant({ uuid: 'not-a-uuid' }),
    variant({ privacy: { id: 2 } }),
    variant({ nsfw: true }),
    variant({ isLive: true }),
    variant({ account: { ...base.account, host: 'evil.example.org' } }),
    variant({ url: 'https://evil.example.org/videos/watch/' + base.uuid }),
    variant({ channel: { ...base.channel, host: 'peertube.linuxrocks.online' } }),
    variant({ publishedAt: 'never' }),
  ];
  same(pt.parseSepia({ data: hostile, total: 8 }, 0, hosts, NOW).items.length, 0, 'every hostile variant is skipped');
  const marked = pt.parseSepia({ data: [variant({ name: '<script>x</script>Night &amp; day', thumbnailPath: '/lazy-static/thumbnails/../../etc/passwd', views: 9, likes: 9 })], total: 1 }, 0, hosts, NOW);
  same(marked.items[0].title, 'Night & day', 'HTML stripped, script text dropped');
  same(marked.items[0].thumbnailUrl, undefined, 'a thumbnail path that is not the exact shape gives no thumbnail');
  checkItem(asserts, rowAddresses, marked.items[0], 'marked', extra);

  /* ---------------------------------------------------------------- requests */
  const fake = fakeFetch(fixture);
  const page = await pt.peertubeSearch.search('night living dead', null, { fetch: fake.fetch, now: () => new Date(NOW), peertubeHosts: hosts });
  same(fake.urls.length, 1, 'one request (the index came from deps)');
  const url = new URL(fake.urls[0]);
  same(url.origin + url.pathname, 'https://sepiasearch.org/api/v1/search/videos', 'asks Sepia Search only');
  same([url.searchParams.get('search'), url.searchParams.get('start'), url.searchParams.get('count'), url.searchParams.get('nsfw')], ['night living dead', '0', '20', 'false'], 'the words, first page, safe for work');
  same(page.items.length, 3, 'three kept');
  for (const [bad, want] of [[40, '40'], [13, '0'], [5000, '0'], [-20, '0'], ['20', '0']]) {
    const probe = fakeFetch(fixture);
    await pt.peertubeSearch.search('x', bad, { fetch: probe.fetch, now: () => new Date(NOW), peertubeHosts: hosts });
    same(new URL(probe.urls[0]).searchParams.get('start'), want, `start ${JSON.stringify(bad)} -> ${want}`);
  }
  same(pt.parseSepia({ data: [], total: 100000 }, 980, hosts, NOW).next, null, 'paging stops at 1000');

  const none = fakeFetch(fixture);
  same(await pt.peertubeSearch.fetchOne('../x', { fetch: none.fetch, peertubeHosts: hosts }), null, 'fetchOne refuses a non-uuid');
  same(none.urls.length, 0, '... without a request');
  const one = fakeFetch({ total: 1, data: [fixture.data[1]] });
  const found = await pt.peertubeSearch.fetchOne(fixture.data[1].uuid, { fetch: one.fetch, now: () => new Date(NOW), peertubeHosts: hosts });
  same(found && found.externalId, fixture.data[1].uuid, 'fetchOne returns the video');
  same(new URL(one.urls[0]).searchParams.get('uuids'), fixture.data[1].uuid, 'fetchOne asks Sepia by uuid');

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${error.stack}`);
  process.exit(1);
});
