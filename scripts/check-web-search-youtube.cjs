/*
 * WEB search everywhere: the YouTube provider and the YouTube key, offline (SPEC-web-search.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/search/providers/youtube.ts app/lib/web/search/run.ts app/lib/web/row-addresses.ts --outDir Temp/out-web-search-yt --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   npx tsc app/api/web/search/route.ts node_modules/next/types/global.d.ts --outDir Temp/out-web-search-yt-route --rootDir . --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * The fixture is hand-built in the documented `search.list` shape from real videos (ids, titles, channels and
 * dates read live through oEmbed), because no key exists yet to record a real answer. Replace it with a real
 * answer once Luke has added the key.
 *
 * - the Data API provider (now the fallback behind InnerTube): without a usable key it says NOT SET UP and asks nothing
 * - 403 -> DAILY LIMIT REACHED, 400 -> KEY REFUSED, no answer -> NO ANSWER; live and upcoming broadcasts and ids
 *   starting with - or _ are skipped; escaped titles are decoded; addresses are the stream adapter's
 * - one request to www.googleapis.com; the page token is passed on only when it is a token
 * - fetchOne: videos.list with the key; keyless oEmbed without it; a 4xx from oEmbed is null
 * - THE KEY: never in an error, a result, a cursor, or any answer of the real route, whatever the platform does;
 *   named only in the two server files allowed to read it; never NEXT_PUBLIC; never in browser code or .env.production
 */
const { readFileSync, readdirSync, statSync, existsSync } = require('node:fs');
const { join, relative } = require('node:path');
const { NOW, makeAsserts, checkItem, fakeFetch } = require('./web-search-check-kit.cjs');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-search-yt', 'lib', 'web');
const yt = require(join(OUT, 'search', 'providers', 'youtube.js'));
const { searchEverywhere } = require(join(OUT, 'search', 'run.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const asserts = makeAsserts('WEB search: YouTube and its key');
const { ok, same } = asserts;

const KEY = 'AIzaSyTESTKEYtestkey0123456789-_abcdEF';
const withKey = (fetch) => ({ fetch, now: () => new Date(NOW), env: { YOUTUBE_API_KEY: KEY } });
const noKey = (fetch) => ({ fetch, now: () => new Date(NOW), env: {} });
const leaks = (value) => JSON.stringify(value).includes(KEY) || String(value && value.stack).includes(KEY) || String(value && value.message).includes(KEY);

async function problem(work) {
  try {
    await work();
  } catch (error) {
    ok(!leaks(error), `an error carries the key: ${error.message}`);
    return error.problem ?? error.message;
  }
  return null;
}

(async () => {
  // Since InnerTube (check-web-search-youtube-innertube.cjs), youtubeSearch asks it first and this Data API
  // provider, youtubeApiSearch, is the fallback; everything below up to the real route is the Data API alone.
  /* ---------------------------------------------------------------- no key */
  for (const env of [{}, { YOUTUBE_API_KEY: '' }, { YOUTUBE_API_KEY: 'short' }, { YOUTUBE_API_KEY: 'has spaces in it and is long enough' }, { YOUTUBE_API_KEY: 'x&key=y&part=z0000000000000000000' }]) {
    const fake = fakeFetch({});
    same(await problem(() => yt.youtubeApiSearch.search('night', null, { fetch: fake.fetch, env })), 'NOT SET UP', `no usable key (${JSON.stringify(env)}): NOT SET UP`);
    same(fake.urls.length, 0, '... and nothing is asked');
  }

  /* ---------------------------------------------------------------- the fixture */
  const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'search-youtube-shape.json'), 'utf8'));
  const page = yt.parseYtSearch(fixture, NOW);
  same(page.items.map((item) => item.externalId), ['aqz-KE-bpKQ', 'eRsGyueVLvQ', 'WhWc3b3KhnY', 'mN0zPOpADL4'], 'ids starting with _ are skipped');
  for (const item of page.items) {
    checkItem(asserts, rowAddresses, item, item.externalId);
    same(item.embedUrl, `https://www.youtube-nocookie.com/embed/${item.externalId}`, 'the privacy-enhanced player');
    same(item.url, `https://youtu.be/${item.externalId}`, 'the short page');
  }
  same(page.items[0].description, 'An open movie made with Blender & friends.', 'escaped text decoded');
  same(page.next, 'CBQQAA', 'next page token');
  const odd = yt.parseYtSearch({ items: [
    { id: { videoId: 'aqz-KE-bpKQ' }, snippet: { ...fixture.items[0].snippet, liveBroadcastContent: 'live' } },
    { id: { videoId: 'aqz-KE-bpKQ' }, snippet: { ...fixture.items[0].snippet, liveBroadcastContent: 'upcoming' } },
    { id: { videoId: 'short' }, snippet: fixture.items[0].snippet },
    { id: { videoId: 'aqz-KE-bpKQ<' }, snippet: fixture.items[0].snippet },
    { id: { channelId: 'UCx' }, snippet: fixture.items[0].snippet },
  ], nextPageToken: 'bad token!' }, NOW);
  same(odd, { items: [], next: null }, 'live, upcoming, malformed and channel results are skipped; a bad token is no token');

  /* ---------------------------------------------------------------- requests and errors */
  const fake = fakeFetch(fixture);
  const found = await yt.youtubeApiSearch.search('night living dead', null, withKey(fake.fetch));
  same(found.items.length, 4, 'a search with a key returns the results');
  same(fake.urls.length, 1, 'one request');
  const url = new URL(fake.urls[0]);
  same(url.origin + url.pathname, 'https://www.googleapis.com/youtube/v3/search', 'the Data API');
  same(
    ['part', 'type', 'videoEmbeddable', 'safeSearch', 'q', 'key'].map((name) => url.searchParams.get(name)),
    ['snippet', 'video', 'true', 'moderate', 'night living dead', KEY],
    'videos only, embeddable, moderate safe search, the words',
  );
  ok(!/statistics|contentDetails/.test(url.search), 'asks for no statistics');
  const next = fakeFetch(fixture);
  await yt.youtubeApiSearch.search('x', 'CBQQAA', withKey(next.fetch));
  same(new URL(next.urls[0]).searchParams.get('pageToken'), 'CBQQAA', 'a token is passed on');
  const bad = fakeFetch(fixture);
  await yt.youtubeApiSearch.search('x', 'a&key=evil', withKey(bad.fetch));
  same(new URL(bad.urls[0]).searchParams.get('pageToken'), null, 'a token that is not one is dropped');
  ok(yt.youtubeApiSearch.dailyBudget && yt.youtubeApiSearch.dailyBudget.perInstance <= 90 && yt.youtubeApiSearch.dailyBudget.perAddress <= 20, 'YouTube has a daily budget under its ~100 searches');

  for (const [status, want] of [[403, 'DAILY LIMIT REACHED'], [400, 'KEY REFUSED'], [500, 'COULD NOT READ']]) {
    const failing = fakeFetch({ error: { message: `bad key ${KEY}` } }, status);
    same(await problem(() => yt.youtubeApiSearch.search('x', null, withKey(failing.fetch))), want, `${status} -> ${want}`);
  }
  same(await problem(() => yt.youtubeApiSearch.search('x', null, withKey(async () => { throw new TypeError(`fetch failed for ${KEY}`); }))), 'NO ANSWER', 'no answer -> NO ANSWER');

  /* ---------------------------------------------------------------- fetchOne */
  const one = fakeFetch({ items: [{ id: 'aqz-KE-bpKQ', snippet: fixture.items[0].snippet }] });
  same((await yt.youtubeSearch.fetchOne('aqz-KE-bpKQ', withKey(one.fetch))).externalId, 'aqz-KE-bpKQ', 'fetchOne with a key');
  same(new URL(one.urls[0]).pathname, '/youtube/v3/videos', '... asks videos.list');
  const oembed = fakeFetch({ type: 'video', title: 'Big Buck Bunny', author_name: 'Blender', thumbnail_url: 'https://evil.example.org/x.jpg', html: '<iframe src="https://evil.example.org">' });
  const keyless = await yt.youtubeSearch.fetchOne('aqz-KE-bpKQ', noKey(oembed.fetch));
  same([keyless.title, keyless.creator, keyless.publishedAt], ['Big Buck Bunny', 'Blender', NOW], 'fetchOne without a key: oEmbed, dated when read');
  ok(!JSON.stringify(keyless).includes('evil'), "oEmbed's own thumbnail and html are never used");
  same(new URL(oembed.urls[0]).origin + new URL(oembed.urls[0]).pathname, 'https://www.youtube.com/oembed', '... asks oEmbed');
  same(new URL(oembed.urls[0]).searchParams.get('url'), 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', '... for the URL built from the id');
  same(await yt.youtubeSearch.fetchOne('aqz-KE-bpKQ', noKey(fakeFetch('Not Found', 404).fetch)), null, 'a 404 from oEmbed is null');
  const refused = fakeFetch({});
  same(await yt.youtubeSearch.fetchOne('../../x', noKey(refused.fetch)), null, 'a bad id is refused');
  same(refused.urls.length, 0, '... without a request');

  /* ---------------------------------------------------------------- the key through the fan-out */
  const outcomes = [];
  for (const body of [[fixture, 200], [{ error: KEY }, 403], [{ error: KEY }, 400], [KEY, 500]]) {
    const result = await searchEverywhere('night', null, [yt.youtubeApiSearch], withKey(fakeFetch(body[0], body[1]).fetch));
    ok(!leaks(result), `a ${body[1]} answer leaks the key into the result`);
    outcomes.push(result.statuses[0].problem);
  }
  same(outcomes, [null, 'DAILY LIMIT REACHED', 'KEY REFUSED', 'COULD NOT READ'], 'each outcome is its fixed phrase');

  /* ---------------------------------------------------------------- the key through the real route */
  const route = require(join(ROOT, 'Temp', 'out-web-search-yt-route', 'app', 'api', 'web', 'search', 'route.js'));
  const realFetch = global.fetch;
  process.env.YOUTUBE_API_KEY = KEY;
  const scenarios = [
    ['every platform answers', async (url) => (String(url).includes('googleapis') ? new Response(JSON.stringify(fixture)) : new Response('{}', { status: 500 }))],
    ['YouTube refuses with the key in its message', async (url) => new Response(JSON.stringify({ error: { message: `key ${KEY} is bad`, url: String(url) } }), { status: 403 })],
    ['the network fails with the URL in the error', async (url) => { throw new TypeError(`connect failed ${url}`); }],
    ['a redirect off the list', async (url) => new Response(null, { status: 302, headers: { location: `https://evil.example.org/?u=${encodeURIComponent(String(url))}` } })],
  ];
  let address = 0;
  for (const [name, impl] of scenarios) {
    global.fetch = impl;
    for (const query of ['night living dead', 'night living dead&cursor=eyJ5b3V0dWJlIjoiQ0JRUUFBIn0']) {
      address += 1;
      const response = await route.GET(new Request(`https://debaser.site/api/web/search?q=${query}`, { headers: { 'x-real-ip': `10.0.0.${address}` } }));
      const text = await response.text();
      ok(!text.includes(KEY), `the route's answer holds the key (${name})`);
      ok(!text.includes('googleapis') && !text.includes('evil.example'), `the route's answer holds a platform URL (${name})`);
      ok(![...response.headers.values()].some((value) => value.includes(KEY)), `a response header holds the key (${name})`);
    }
  }
  global.fetch = async () => new Response(JSON.stringify(fixture));
  const answered = await (await route.GET(new Request('https://debaser.site/api/web/search?q=blender', { headers: { 'x-real-ip': '10.1.1.1' } }))).json();
  same(answered.statuses.find((s) => s.platform === 'youtube'), { platform: 'youtube', problem: null, label: 'YOUTUBE' }, 'with a key the route searches YouTube');
  delete process.env.YOUTUBE_API_KEY;
  const unset = await (await route.GET(new Request('https://debaser.site/api/web/search?q=blender', { headers: { 'x-real-ip': '10.1.1.2' } }))).json();
  // Without a key InnerTube is still asked (here it answers in the wrong shape), and with no fallback: NO ANSWER.
  same(unset.statuses.find((s) => s.platform === 'youtube'), { platform: 'youtube', problem: 'NO ANSWER', label: 'YOUTUBE' }, 'without one, and InnerTube failing: YOUTUBE: NO ANSWER');
  ok(unset.statuses.filter((s) => s.platform !== 'youtube').length === 4, '... and the others are still asked');
  // One provider at a time (the page asks each on its own, so each one's rows show as soon as they arrive).
  process.env.YOUTUBE_API_KEY = KEY;
  const askedHosts = [];
  global.fetch = async (url) => {
    askedHosts.push(new URL(String(url)).hostname);
    return new Response(JSON.stringify(fixture));
  };
  const alone = await (await route.GET(new Request('https://debaser.site/api/web/search?q=blender&provider=youtube', { headers: { 'x-real-ip': '10.1.1.3' } }))).json();
  same(alone.statuses.map((s) => s.platform), ['youtube'], 'provider=youtube asks YouTube alone');
  // InnerTube first (here answering in the Data API's shape, so failing), then the Data API: YouTube's hosts only.
  same(askedHosts, ['www.youtube.com', 'www.googleapis.com'], '... asking only YouTube (InnerTube, then the Data API)');
  same(alone.items.length, 4, '... and answers its results');
  const bogus = await route.GET(new Request('https://debaser.site/api/web/search?q=blender&provider=vidsrc', { headers: { 'x-real-ip': '10.1.1.4' } }));
  same(bogus.status, 400, 'a provider that does not exist is refused');
  const sneaky = await route.GET(new Request('https://debaser.site/api/web/search?q=blender&provider=__proto__', { headers: { 'x-real-ip': '10.1.1.5' } }));
  same(sneaky.status, 400, '... whatever it is called');
  delete process.env.YOUTUBE_API_KEY;
  global.fetch = realFetch;

  /* ---------------------------------------------------------------- the key's name in the code */
  // The series route and its reader (SPEC-stream-series.md, 2026-11-02) read the key on the server for a playlist's
  // `playlistItems`, the way the provider does; nothing they answer or throw carries it.
  const ALLOWED = new Set([
    'app/api/web/search/route.ts',
    'app/api/web/ingest/route.ts',
    'app/lib/web/search/providers/youtube.ts',
    'app/lib/web/search/types.ts',
    'app/api/web/series/route.ts',
    'app/lib/web/series-files.ts',
  ]);
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(full);
    }
    return out;
  };
  const appFiles = walk(join(ROOT, 'app'));
  ok(appFiles.length > 50, 'app files were read');
  for (const file of appFiles) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf8');
    if (text.includes('YOUTUBE_API_KEY')) ok(ALLOWED.has(rel), `${rel} names YOUTUBE_API_KEY (only the search route, the ingest route, the provider and the series reader may)`);
    if (/^\s*['"]use client['"]/.test(text)) ok(!text.includes('YOUTUBE_API_KEY'), `browser file ${rel} names the key`);
    ok(!/NEXT_PUBLIC_YOUTUBE/.test(text), `${rel} has a NEXT_PUBLIC YouTube value`);
  }
  for (const env of ['.env.production', '.env.example', '.env']) {
    if (existsSync(join(ROOT, env))) ok(!/YOUTUBE/.test(readFileSync(join(ROOT, env), 'utf8')), `${env} (committed) mentions YouTube`);
  }
  const provider = readFileSync(join(ROOT, 'app/lib/web/search/providers/youtube.ts'), 'utf8');
  ok(!/process\.env/.test(provider.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'the provider reads no process.env (the route hands it the key)');
  ok(!/console\./.test(provider), 'the provider logs nothing');
  const routeText = readFileSync(join(ROOT, 'app/api/web/search/route.ts'), 'utf8');
  ok(!/console\./.test(routeText), 'the route logs nothing');

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${String(error.stack).replaceAll(KEY, '<key>')}`);
  process.exit(1);
});
