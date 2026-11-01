/*
 * WEB search everywhere: the Wikimedia Commons provider, offline (SPEC-web-search.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/search/providers/wikimedia-commons.ts app/lib/web/row-addresses.ts --outDir Temp/out-web-search-wc --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the fixture (5 real file pages from a live search: a video, bitmaps, a drawing) parses into items the page would draw
 * - the id is the numeric page id; the page link is Special:Redirect/page/{id}
 * - a video or audio file plays through Commons' own player page (?embedplayer=yes), never the raw file; an image has no player
 * - the file name can only ever be one path segment; odd titles, other namespaces and missing pages are skipped
 * - thumbnails are rebuilt on thumb.wikimedia.org from a path of the exact shape, query dropped; anything else is no thumbnail
 * - HTML in the credit and description is stripped; the licence is kept only on creativecommons.org
 * - the page check refuses a player address with any other query, or none
 * - one request to commons.wikimedia.org; paging by Commons' own offset, stopping at 1000; fetchOne by page id only
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { NOW, makeAsserts, checkItem, fakeFetch } = require('./web-search-check-kit.cjs');

const OUT = join(__dirname, '..', 'Temp', 'out-web-search-wc', 'lib', 'web');
const wc = require(join(OUT, 'search', 'providers', 'wikimedia-commons.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const asserts = makeAsserts('WEB search: Wikimedia Commons');
const { ok, same } = asserts;
const deps = (fetch) => ({ fetch, now: () => new Date(NOW) });

(async () => {
  /* ---------------------------------------------------------------- the real fixture */
  const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'search-wikimedia-commons.json'), 'utf8'));
  const real = wc.parseCommons(fixture, NOW);
  same(real.items.length, 5, 'all five fixture pages become items');
  for (const item of real.items) {
    checkItem(asserts, rowAddresses, item, item.externalId);
    same(item.url, `https://commons.wikimedia.org/wiki/Special:Redirect/page/${item.externalId}`, 'page by id');
    ok(/^[1-9][0-9]*$/.test(item.externalId), 'numeric id');
    ok(item.thumbnailUrl === undefined || (item.thumbnailUrl.startsWith('https://thumb.wikimedia.org/wikipedia/commons/thumb/') && !item.thumbnailUrl.includes('?')), 'thumbnail on the thumbnail host, no query');
  }
  const video = real.items.find((item) => item.kind === 'video');
  same(video.embedUrl, 'https://commons.wikimedia.org/wiki/File:Night_of_the_Living_Dead_(1968).webm?embedplayer=yes', "a video plays through Commons' player page");
  same(video.title, 'Night of the Living Dead (1968)', 'title');
  ok(!/upload\.wikimedia\.org/.test(JSON.stringify(real.items)), 'no item points at a raw file');
  ok(real.items.filter((item) => item.kind === 'image').every((item) => item.embedUrl === undefined), 'images have no player');
  same(real.next, 20, 'next offset from Commons');

  /* ---------------------------------------------------------------- hostile and odd pages */
  const good = fixture.query.pages[0];
  const variant = (change, info = {}) => ({ ...JSON.parse(JSON.stringify(good)), ...change, imageinfo: [{ ...good.imageinfo[0], ...info }] });
  const odd = [
    variant({ ns: 0 }),
    variant({ missing: true }),
    variant({ pageid: '123' }),
    variant({ pageid: 0 }),
    variant({ title: 'Category:Night' }),
    variant({ title: 'File:a/b.webm' }),
    variant({ title: 'File:a?embedplayer=no#x.webm' }),
    variant({ title: 'File:' + 'x'.repeat(300) }),
    variant({}, { timestamp: 'never' }),
    { ...good, imageinfo: [] },
  ];
  same(wc.parseCommons({ query: { pages: odd } }, NOW).items.length, 0, 'every odd page is skipped');
  same(wc.fileSegment('File:Café (1) & co.ogg'), 'Caf%C3%A9_(1)_%26_co.ogg', 'a name becomes one encoded segment');

  const marked = wc.parseCommons({
    query: {
      pages: [variant({ pageid: 99 }, {
        thumburl: 'https://evil.example.org/wikipedia/commons/thumb/2/24/X.webm/330px--X.webm.jpg',
        extmetadata: {
          ObjectName: { value: '<b>Bold</b> &amp; <i>x</i>' },
          Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Y">Y</a>' },
          ImageDescription: { value: '<script>alert(1)</script>Desc' },
          LicenseUrl: { value: 'https://evil.example.org/licence' },
        },
      })],
    },
  }, NOW).items[0];
  same([marked.title, marked.creator, marked.description], ['Bold & x', 'Y', 'Desc'], 'HTML stripped from title, credit and description');
  same(marked.thumbnailUrl, undefined, 'a thumbnail off Commons is dropped');
  same(marked.licenseUrl, undefined, 'a licence off creativecommons.org is dropped');
  const pathTrick = wc.parseCommons({ query: { pages: [variant({ pageid: 98 }, { thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/24/X.webm/../../../x/330px--X.jpg' })] } }, NOW).items[0];
  same(pathTrick.thumbnailUrl, undefined, 'a thumbnail path of another shape is dropped');
  same(wc.parseCommons({ batchcomplete: true }, NOW), { items: [], next: null }, 'no hits: empty, not an error');
  let threw = false;
  try {
    wc.parseCommons({ error: { code: 'x' } }, NOW);
  } catch {
    threw = true;
  }
  ok(threw, 'an API error throws');

  /* ---------------------------------------------------------------- the page check */
  const base = { ...video };
  same(rowAddresses({ ...base, embedUrl: base.embedUrl.replace('embedplayer=yes', 'embedplayer=no') }).embed, null, 'any other query: no player');
  same(rowAddresses({ ...base, embedUrl: base.embedUrl.replace('?embedplayer=yes', '') }).embed, null, 'no query: no player (that is the plain file page)');
  same(rowAddresses({ ...base, embedUrl: base.embedUrl + '&action=raw' }).embed, null, 'an extra parameter: no player');
  same(rowAddresses({ ...base, embedUrl: 'https://commons.wikimedia.org/wiki/Special:Upload?embedplayer=yes' }).embed, null, 'another page with the query: no player');
  same(rowAddresses({ ...base, embedUrl: 'https://upload.wikimedia.org/wikipedia/commons/2/24/X.webm' }).embed, null, 'the raw file: no player');
  for (const sneaky of ['%2F', '%2f', '%2E%2E', '%5C', '%2e']) {
    same(rowAddresses({ ...base, embedUrl: `https://commons.wikimedia.org/wiki/File:X${sneaky}Y.webm?embedplayer=yes` }).embed, null, `an encoded ${sneaky} in the name: no player`);
  }
  ok(rowAddresses({ ...base, embedUrl: 'https://commons.wikimedia.org/wiki/File:Caf%C3%A9_(1).ogg?embedplayer=yes' }).embed !== null, 'other encoded characters are fine');
  same(rowAddresses({ ...base, url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/X.webm' }).link, null, 'a link of another shape is refused');

  /* ---------------------------------------------------------------- requests */
  const fake = fakeFetch(fixture);
  await wc.wikimediaCommonsSearch.search('night living dead', null, deps(fake.fetch));
  same(fake.urls.length, 1, 'one request');
  const url = new URL(fake.urls[0]);
  same(url.origin + url.pathname, 'https://commons.wikimedia.org/w/api.php', 'asks Commons only');
  same([url.searchParams.get('gsrsearch'), url.searchParams.get('gsrnamespace'), url.searchParams.get('gsroffset')], ['night living dead', '6', '0'], 'the words, files only, first page');
  for (const [bad, want] of [[40, '40'], [5000, '0'], [-1, '0'], [1.5, '0'], ['20', '0']]) {
    const probe = fakeFetch(fixture);
    await wc.wikimediaCommonsSearch.search('x', bad, deps(probe.fetch));
    same(new URL(probe.urls[0]).searchParams.get('gsroffset'), want, `offset ${JSON.stringify(bad)} -> ${want}`);
  }
  same(wc.parseCommons({ continue: { gsroffset: 1000 }, query: { pages: [] } }, NOW).next, null, 'paging stops at 1000');
  const none = fakeFetch(fixture);
  same(await wc.wikimediaCommonsSearch.fetchOne('File:X', deps(none.fetch)), null, 'fetchOne refuses a non-id');
  same(none.urls.length, 0, '... without a request');
  const one = fakeFetch({ query: { pages: [good] } });
  const found = await wc.wikimediaCommonsSearch.fetchOne(String(good.pageid), deps(one.fetch));
  same(found && found.externalId, String(good.pageid), 'fetchOne returns the page');
  same(new URL(one.urls[0]).searchParams.get('pageids'), String(good.pageid), 'fetchOne asks by page id');

  /* ---------------------------------------------------------------- a type: filter */
  const typed = (kind) => new URL(wc.commonsSearchUrl('piano', 0, kind)).searchParams.get('gsrsearch');
  same(typed(undefined), 'piano', 'no type: the words alone');
  same(typed('audio'), 'piano filetype:audio', 'type:audio asks Commons for audio only');
  same(typed('image'), 'piano filetype:bitmap|drawing', 'type:image asks for pictures and drawings');
  same(typed('text'), 'piano filetype:office', 'type:text asks for documents');

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${error.stack}`);
  process.exit(1);
});
