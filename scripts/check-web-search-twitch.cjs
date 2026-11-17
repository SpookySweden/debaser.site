/*
 * LIVE (SPEC-live-streams.md, Luke 2026-11-17): the Twitch provider, its keys, the one-minute live cache, YouTube's live mode,
 * the `[ ● LIVE ]` filter, the feed's LIVE place and the live lane's asks, offline (run by `npm run checks:web`):
 *   npx tsc app/lib/web/search/providers/twitch.ts app/lib/web/search/providers/youtube.ts app/lib/web/search/live-fetch.ts app/lib/web/search/run.ts app/lib/web/row-addresses.ts app/lib/web/web-filters.ts app/lib/web/feed-mix.ts app/lib/web/live-lane.ts --outDir Temp/out-web-search-twitch --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * The site-API fixture is a real answer (search "chess", 2026-11-17) with the viewer counts replaced by small made-up numbers:
 * they exist only to prove POPULAR orders by them and that none comes out. The Helix answers are hand-built in the documented
 * shapes (no keys yet to record a real one).
 *
 * - an item: only WebItem fields and the `live` mark, every address passes the row check, no count anywhere, bad logins skipped
 * - no keys: one POST to Twitch's site API, the words as a variable (never inside the question), offline channels skipped
 * - keys: the pass from id.twitch.tv (form body), then Helix with the bearer pass and the client id in headers, never in an address;
 *   Helix failing falls back to the site API; the keys never in an error, a result or a cursor
 * - POPULAR by the counts, DATE by start time, and no count in what comes out; `fetchOne` saves nothing
 * - the live cache keeps a 200 a minute, never the token endpoint
 * - YouTube: the live filter is asked under `live`; a LIVE NOW badge with no length is kept and marked; upcoming is skipped
 * - run.ts asks only the live-capable providers under `live`
 * - `is:live` reads, writes and travels in the address; it asks only Twitch and YouTube; it keeps only lives
 * - the feed: the fifth place of a block is a live when there is one, FOR YOU's when there is none
 * - the live lane asks for channels from history first, then makers as logins, and the taste's words
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { NOW, makeAsserts, checkItem } = require('./web-search-check-kit.cjs');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-search-twitch', 'lib', 'web');
const tw = require(join(OUT, 'search', 'providers', 'twitch.js'));
const yt = require(join(OUT, 'search', 'providers', 'youtube.js'));
const { makeLiveFetch } = require(join(OUT, 'search', 'live-fetch.js'));
const { searchEverywhere } = require(join(OUT, 'search', 'run.js'));
const { rowAddresses, startingEmbed } = require(join(OUT, 'row-addresses.js'));
const filters = require(join(OUT, 'web-filters.js'));
const { mixFeed, BLOCK_PATTERN } = require(join(OUT, 'feed-mix.js'));
const { liveAsk, orderLives, loginLike, playedChannel } = require(join(OUT, 'live-lane.js'));
const asserts = makeAsserts('LIVE: Twitch, YouTube lives, the LIVE key and the feed');
const { ok, same } = asserts;

const ID = 'abcdefghijklmnopqrstuvwxyz0123';
const SECRET = 'zyxwvutsrqponmlkjihgfedcba9876';
const PASS = 'passpasspasspasspasspass01';
const withKeys = (fetch) => ({ fetch, now: () => new Date(NOW), env: { TWITCH_CLIENT_ID: ID, TWITCH_CLIENT_SECRET: SECRET } });
const noKeys = (fetch) => ({ fetch, now: () => new Date(NOW), env: {} });
// A count as a field (a stream title may well say "viewers" in words: that is the streamer's text, not a count).
const COUNTS = /"(?:viewers|viewersCount|viewer_count|concurrentViewers)"\s*:/;
const leaks = (value) => [ID, SECRET, PASS].some((secret) => JSON.stringify(value ?? null).includes(secret) || String(value?.message ?? '').includes(secret));

/** A fake network: answers by host, records every call (url, method, headers, body). */
function network(answers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ?? null });
    const host = new URL(url).hostname;
    const answer = answers[host];
    if (answer === undefined) return new Response('{}', { status: 404 });
    const { status = 200, body } = typeof answer === 'function' ? answer(url, init) : answer;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

const SITE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'search-twitch-site.json'), 'utf8'));
const HELIX_SEARCH = {
  data: [
    { broadcaster_login: 'hannahsayce', display_name: 'HannahSayce', title: 'Long stream', game_name: 'Chess', started_at: '2026-10-31T10:00:00Z', tags: ['English'], broadcaster_language: 'en', is_live: true, thumbnail_url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/x.png' },
    { broadcaster_login: 'offlineone', display_name: 'OfflineOne', title: 'Old', game_name: 'Chess', started_at: '', tags: [], broadcaster_language: 'en', is_live: false },
    { broadcaster_login: 'Bad-Login', display_name: 'Bad', title: 'x', is_live: true },
  ],
  pagination: { cursor: 'eyJiIjp7IkN1cnNvciI6IjEifX0' },
};
const TOKEN = { access_token: PASS, expires_in: 5000000, token_type: 'bearer' };

(async () => {
  /* ---------------------------------------------------------------- an item */
  const item = tw.twitchItem({ login: 'HannahSayce', name: 'HannahSayce', title: 'Long <b>stream</b>', game: 'Chess', tags: ['English'], language: 'EN', startedAt: '2026-10-31T10:00:00Z', viewers: 280 }, NOW);
  checkItem(asserts, rowAddresses, item, 'twitch item');
  same([item.id, item.url, item.thumbnailUrl, item.embedUrl], ['twitch:hannahsayce', 'https://www.twitch.tv/hannahsayce', 'https://static-cdn.jtvnw.net/previews-ttv/live_user_hannahsayce-640x360.jpg', 'https://player.twitch.tv/?channel=hannahsayce'], 'its addresses, from the login');
  same([item.live, item.kind, item.publishedAt, item.description, item.language], [true, 'video', '2026-10-31T10:00:00.000Z', 'Chess', 'en'], 'marked live, a video, dated when it started, the game, the language');
  ok(!COUNTS.test(JSON.stringify(item)), 'no count in an item');
  for (const login of ['_under', 'a', 'bad-login', '../x', 'x'.repeat(26), '']) same(tw.twitchItem({ login }, NOW), null, `a login WEB refuses is skipped: "${login}"`);
  // The row check holds the player to `?channel=<login>` exactly.
  for (const embed of ['https://player.twitch.tv/?channel=a&parent=evil.com', 'https://player.twitch.tv/?video=123', 'https://player.twitch.tv/x?channel=abc', 'https://www.twitch.tv/?channel=abc']) {
    same(rowAddresses({ ...item, embedUrl: embed }).embed, null, `a player address of another shape is refused: ${embed}`);
  }
  same(new URL(startingEmbed(item.embedUrl, 'twitch')).searchParams.get('parent'), 'debaser-site.vercel.app', 'the player is told this site (parent), as Twitch requires');

  /* ---------------------------------------------------------------- no keys: the site API */
  {
    const net = network({ 'gql.twitch.tv': { body: SITE } });
    const page = await tw.twitchSearch.search('chess', null, noKeys(net.fetch));
    same(net.calls.length, 1, 'one question');
    const call = net.calls[0];
    same([call.url, call.method, call.headers['Client-ID']], ['https://gql.twitch.tv/gql', 'POST', tw.TWITCH_SITE_CLIENT_ID], 'a POST to the site API with its public client id');
    const sent = JSON.parse(call.body);
    same(sent.variables.q, 'chess', 'the words go as a variable');
    ok(!sent.query.includes('chess'), '... never inside the question');
    const live = SITE.data.searchFor.channels.items.filter((one) => one.stream).map((one) => `twitch:${one.login}`);
    same(page.items.map((one) => one.id), live, 'only the channels that are live, in Twitch\'s order');
    for (const one of page.items) checkItem(asserts, rowAddresses, one, one.id);
    ok(!COUNTS.test(JSON.stringify(page)), 'no count in the answer');
    same(page.next, 's' + SITE.data.searchFor.channels.cursor, 'the next page goes back to the site API');
    const second = network({ 'gql.twitch.tv': { body: SITE } });
    await tw.twitchSearch.search('chess', page.next, noKeys(second.fetch));
    same(JSON.parse(second.calls[0].body).variables.c, SITE.data.searchFor.channels.cursor, 'the next page asks with its cursor');
    same(await tw.twitchSearch.search('chess', 'h' + 'abc', noKeys(net.fetch)), { items: [], next: null }, 'a Helix page without keys is the end');
    same(await tw.twitchSearch.search('chess', 'not a page!', noKeys(net.fetch)), { items: [], next: null }, 'an unreadable page is the end');
    same(await tw.twitchSearch.search('chess', null, noKeys(net.fetch), undefined, 'audio'), { items: [], next: null }, 'Twitch has no audio');
    same(await tw.twitchSearch.fetchOne('hannahsayce', noKeys(net.fetch)), null, 'nothing of Twitch is ever saved (fetchOne)');
  }

  /* ---------------------------------------------------------------- orders */
  {
    const net = network({ 'gql.twitch.tv': { body: SITE } });
    const popular = await tw.twitchSearch.search('chess', null, { ...noKeys(net.fetch), order: 'popular' });
    const byCount = SITE.data.searchFor.channels.items.filter((one) => one.stream).sort((a, b) => b.stream.viewersCount - a.stream.viewersCount).map((one) => `twitch:${one.login}`);
    same(popular.items.map((one) => one.id), byCount, 'POPULAR: the most watched first, decided here');
    ok(!COUNTS.test(JSON.stringify(popular)), '... and no count comes out');
    const newest = await tw.twitchSearch.search('chess', null, { ...noKeys(net.fetch), order: 'newest' });
    const starts = newest.items.map((one) => Date.parse(one.publishedAt));
    ok(starts.every((time, index) => index === 0 || starts[index - 1] >= time), 'DATE: started most recently first');
  }

  /* ---------------------------------------------------------------- keys: Helix first */
  {
    tw.forgetTwitchPass();
    const net = network({ 'id.twitch.tv': { body: TOKEN }, 'api.twitch.tv': { body: HELIX_SEARCH } });
    const page = await tw.twitchSearch.search('chess', null, withKeys(net.fetch));
    same(net.calls.map((call) => new URL(call.url).hostname), ['id.twitch.tv', 'api.twitch.tv'], 'the pass, then Helix');
    const [token, helix] = net.calls;
    same([token.method, token.headers['Content-Type']], ['POST', 'application/x-www-form-urlencoded'], 'the pass is asked by a form POST');
    same(Object.fromEntries(new URLSearchParams(token.body)), { client_id: ID, client_secret: SECRET, grant_type: 'client_credentials' }, '... with the app keys in its body');
    ok(!token.url.includes(SECRET) && !helix.url.includes(SECRET) && !helix.url.includes(PASS), 'no key or pass in any address');
    same([helix.headers['Client-Id'], helix.headers.Authorization], [ID, `Bearer ${PASS}`], 'Helix is told who asks by header');
    const asked = new URL(helix.url);
    same([asked.pathname, asked.searchParams.get('query'), asked.searchParams.get('live_only')], ['/helix/search/channels', 'chess', 'true'], 'Helix searches live channels for the words');
    same(page.items.map((one) => one.id), ['twitch:hannahsayce'], 'offline and bad logins are skipped');
    same(page.items[0].thumbnailUrl, 'https://static-cdn.jtvnw.net/previews-ttv/live_user_hannahsayce-640x360.jpg', 'the preview picture, not the avatar Helix sends');
    same(page.next, 'h' + HELIX_SEARCH.pagination.cursor, 'the next page goes back to Helix');
    ok(!leaks(page), 'no key in the answer');
    const counted = network({ 'api.twitch.tv': (url) => ({ body: url.includes('/search/') ? { data: [HELIX_SEARCH.data[0], { ...HELIX_SEARCH.data[0], broadcaster_login: 'second', display_name: 'Second' }] } : { data: [{ user_login: 'second', viewer_count: 900 }, { user_login: 'hannahsayce', viewer_count: 5 }] } }) });
    const popular = await tw.twitchSearch.search('chess', null, { ...withKeys(counted.fetch), order: 'popular' });
    same(popular.items.map((one) => one.id), ['twitch:second', 'twitch:hannahsayce'], 'POPULAR with keys: Helix\'s /streams is asked for the counts and orders by them');
    ok(!COUNTS.test(JSON.stringify(popular)), '... and none comes out');
    const again = network({ 'api.twitch.tv': { body: HELIX_SEARCH } });
    await tw.twitchSearch.search('chess', null, withKeys(again.fetch));
    same(again.calls.map((call) => new URL(call.url).hostname), ['api.twitch.tv'], 'the pass is kept, not asked again');
  }
  {
    tw.forgetTwitchPass();
    const net = network({ 'id.twitch.tv': { body: TOKEN }, 'api.twitch.tv': { status: 500, body: '{}' }, 'gql.twitch.tv': { body: SITE } });
    const page = await tw.twitchSearch.search('chess', null, withKeys(net.fetch));
    ok(page.items.length > 0 && page.next.startsWith('s'), 'Helix failing falls back to the site API');
    ok(!leaks(net.calls.filter((call) => call.url.includes('gql')).map((call) => [call.url, call.headers, call.body])), 'the keys never go to the site API');
  }
  {
    tw.forgetTwitchPass();
    const net = network({ 'id.twitch.tv': { status: 400, body: { message: `bad ${SECRET}` } }, 'gql.twitch.tv': { status: 503, body: '{}' } });
    let caught = null;
    try {
      await tw.twitchSearch.search('chess', null, withKeys(net.fetch));
    } catch (error) {
      caught = error;
    }
    ok(caught !== null && caught.problem === 'COULD NOT READ' && !leaks(caught) && !String(caught.stack).includes(SECRET), 'both failing: a fixed phrase, no key');
  }
  {
    tw.forgetTwitchPass();
    const logins = Array.from({ length: 120 }, (_, index) => `chan${index}`);
    const net = network({ 'id.twitch.tv': { body: TOKEN }, 'api.twitch.tv': { body: { data: [{ user_login: 'chan3', user_name: 'Chan3', title: 'On', game_name: 'Music', started_at: '2026-10-31T11:00:00Z', viewer_count: 9, tags: [] }] } } });
    const found = await tw.twitchLiveNow([...logins, 'Bad-One'], withKeys(net.fetch));
    same(new URL(net.calls[1].url).searchParams.getAll('user_login').length, 100, 'at most 100 channels in one question');
    same(found.map((one) => one.id), ['twitch:chan3'], 'the live ones come back as rows');
    ok(!COUNTS.test(JSON.stringify(found)), '... with no count');
  }

  /* ---------------------------------------------------------------- the live cache */
  {
    let clock = 0;
    let asked = 0;
    const base = async (url) => {
      asked += 1;
      return new Response(JSON.stringify({ n: asked }), { status: url.includes('fail') ? 500 : 200 });
    };
    const fetch = makeLiveFetch(base, () => clock);
    await fetch('https://gql.twitch.tv/gql', { method: 'POST', body: '{"a":1}' });
    const kept = await (await fetch('https://gql.twitch.tv/gql', { method: 'POST', body: '{"a":1}' })).json();
    same([asked, kept.n], [1, 1], 'the same question within a minute is answered from memory');
    await fetch('https://gql.twitch.tv/gql', { method: 'POST', body: '{"a":2}' });
    same(asked, 2, 'another question is asked');
    clock = 61_000;
    await fetch('https://gql.twitch.tv/gql', { method: 'POST', body: '{"a":1}' });
    same(asked, 3, 'after a minute it is asked again');
    await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: 'x' });
    await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: 'x' });
    same(asked, 5, 'the token endpoint is never kept');
    await fetch('https://api.twitch.tv/fail');
    await fetch('https://api.twitch.tv/fail');
    same(asked, 7, 'a failure is never kept');
  }

  /* ---------------------------------------------------------------- YouTube's live mode */
  {
    const video = (id, extra) => ({ videoRenderer: { videoId: id, title: { runs: [{ text: `Video ${id}` }] }, ownerText: { runs: [{ text: 'Lofi Girl' }] }, ...extra } });
    const answer = {
      contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [
        video('LiveNow0001', { badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW', label: 'LIVE' } }] }),
        video('Upcoming001', { upcomingEventData: { startTime: '1' }, badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } }] }),
        video('Recorded001', { publishedTimeText: { simpleText: '2 days ago' }, lengthText: { simpleText: '1:02:03' } }),
        video('NoBadge0001', {}),
      ] } }] } } } },
    };
    const bodies = [];
    const fetch = async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(answer), { status: 200 });
    };
    const plain = await yt.youtubeSearch.search('lofi', null, { fetch, now: () => new Date(NOW), env: {} });
    same(plain.items.map((one) => one.externalId), ['Recorded001'], 'an ordinary search (cached a day) still leaves YouTube lives out: a row would say LIVE long after');
    const page = await yt.youtubeSearch.search('lofi', null, { fetch, liveFetch: fetch, live: true, now: () => new Date(NOW), env: {} });
    same(bodies[1].params, 'EgJAAQ==', 'under live, YouTube\'s own Live filter is asked');
    same(page.items.map((one) => [one.externalId, one.live === true, one.publishedAt]), [['LiveNow0001', true, NOW], ['Recorded001', false, '2026-10-29T12:00:00.000Z']], 'a LIVE NOW badge with no length is kept, marked and dated now; upcoming and undated are skipped');
    for (const one of page.items) checkItem(asserts, rowAddresses, one, one.id);
    const odd = yt.parseYtSearch({ items: [
      { id: { videoId: 'aqz-KE-bpKQ' }, snippet: { title: 'On air', channelTitle: 'Blender', publishedAt: '2014-11-10T14:05:55Z', liveBroadcastContent: 'live' } },
      { id: { videoId: 'eRsGyueVLvQ' }, snippet: { title: 'Soon', channelTitle: 'Blender', publishedAt: '2014-11-10T14:05:55Z', liveBroadcastContent: 'upcoming' } },
    ] }, NOW, true);
    same(odd.items.map((one) => [one.externalId, one.live]), [['aqz-KE-bpKQ', true]], 'the Data API under live: a live result is kept and marked, upcoming skipped');
    same(yt.parseYtSearch({ items: [{ id: { videoId: 'aqz-KE-bpKQ' }, snippet: { title: 'On air', publishedAt: '2014-11-10T14:05:55Z', liveBroadcastContent: 'live' } }] }, NOW).items, [], '... and an ordinary search leaves it out');
    same(yt.toWebItem({ id: 'aqz-KE-bpKQ', snippet: { title: 'On air', publishedAt: '2014-11-10T14:05:55Z', liveBroadcastContent: 'live' } }, NOW, 'videos'), null, '... but never from videos.list, which is how an opened item is saved');
    ok(yt.ytSearchUrl('lofi', null, 'AIzaSyTESTKEYtestkey0123456789-_abcdEF', 'relevance', true).includes('eventType=live'), 'the Data API fallback asks eventType=live');
  }

  /* ---------------------------------------------------------------- run.ts under live */
  {
    const asked = [];
    const provider = (platform, live) => ({ platform, live, allowedHosts: [], timeoutMs: 1000, search: async () => (asked.push(platform), { items: [], next: null }), fetchOne: async () => null });
    await searchEverywhere('chess', null, [provider('internet_archive', false), provider('twitch', true), provider('youtube', true)], { live: true });
    same(asked.sort(), ['twitch', 'youtube'], 'under live only the providers that can say what is on now are asked');
  }

  /* ---------------------------------------------------------------- the LIVE key */
  {
    const search = filters.parseWebSearch('chess is:live');
    same([search.text, search.live], ['chess', true], '`is:live` reads');
    same(filters.formatWebSearch(search), 'chess is:live', 'and writes');
    same(filters.parseWebSearch('chess is:live is:all').live, undefined, '`is:all` clears it');
    same(filters.withFilter('chess', 'is', 'live'), 'chess is:live', 'the key writes it');
    same(filters.withFilter('chess is:live', 'is', 'all'), 'chess', 'and takes it out');
    const address = filters.searchAddress(search);
    ok(address.includes('live=1'), 'the address carries it');
    same(filters.boxFromAddress(new URLSearchParams(address.split('?')[1])), 'chess is:live', 'and the address reads back');
    same(filters.sourcesToAsk({ source: 'all', type: 'all', live: true }), { stream: false, live: ['twitch', 'youtube'] }, 'it asks only Twitch and YouTube, never the saved stream');
    same(filters.sourcesToAsk({ source: 'internet_archive', type: 'all', live: true }).live, [], 'a source that has no lives asks nothing');
    same(filters.sourcesToAsk({ source: 'all', type: 'audio', live: true }).live, [], 'nor does a kind lives never are');
    ok(filters.sourcesToAsk({ source: 'all', type: 'all' }).live.includes('twitch'), 'an ALL search asks Twitch too');
    ok(filters.SOURCE_OPTIONS.some((option) => option.value === 'twitch' && option.label === 'TWITCH'), 'TWITCH is a SOURCE choice');
    ok(filters.matchesFilters({ platform: 'twitch', kind: 'video', live: true }, { source: 'all', type: 'all', live: true }, false), 'a live row stays under the key');
    ok(!filters.matchesFilters({ platform: 'youtube', kind: 'video' }, { source: 'all', type: 'all', live: true }, false), 'a recorded row does not');
    ok(filters.hasFilters(filters.parseWebSearch('is:live')), 'RESET FILTERS knows about it');
  }

  /* ---------------------------------------------------------------- the feed's LIVE place */
  {
    const row = (id, extra = {}) => ({ id, platform: 'internet_archive', externalId: id, kind: 'video', url: 'u', canonicalUrl: 'u', title: id, publishedAt: NOW, fetchedAt: NOW, ...extra });
    const you = Array.from({ length: 30 }, (_, index) => row(`you${index}`));
    const base = { forYou: you, forYouEnded: true, youtube: null, reading: null, discover: null, people: null, visitor: true, readingOpens: {}, taste: { tags: {}, creators: {}, platforms: {} }, dropped: () => false, now: Date.parse(NOW) };
    const at = BLOCK_PATTERN.indexOf('live');
    same(at, 4, 'one LIVE place in each block of 12, the fifth');
    const lives = [row('twitch:a', { platform: 'twitch', live: true }), row('twitch:b', { platform: 'twitch', live: true })];
    const mixed = mixFeed({ ...base, live: { rows: lives, fromBlock: 0 } });
    same([mixed[at].item.id, mixed[at].lane, mixed[12 + at].item.id], ['twitch:a', 'live', 'twitch:b'], 'a live in that place, block after block');
    const none = mixFeed(base);
    same(none[at].lane, 'you', 'with no lives the place is FOR YOU\'s');
  }

  /* ---------------------------------------------------------------- the live lane's asks */
  {
    const history = [
      { kind: 'media', ref: 'twitch:oldone', title: '', maker: '', words: [], action: 'opened', firstAt: '2026-10-01T00:00:00Z', lastAt: '2026-10-01T00:00:00Z' },
      { kind: 'media', ref: 'twitch:newone', title: '', maker: '', words: [], action: 'played', firstAt: '2026-10-30T00:00:00Z', lastAt: '2026-10-30T00:00:00Z' },
      { kind: 'media', ref: 'twitch:nope', title: '', maker: '', words: [], action: 'not_for_me', firstAt: '2026-10-30T00:00:00Z', lastAt: '2026-10-30T00:00:00Z' },
      { kind: 'media', ref: 'youtube:abc', title: '', maker: '', words: [], action: 'played', firstAt: '2026-10-30T00:00:00Z', lastAt: '2026-10-30T00:00:00Z' },
    ];
    const taste = { tags: { jazz: 5, chess: 3, 'x y': 9, ok: 1 }, creators: { 'lofi girl': 4, 'Gotham Chess': 2 }, platforms: {} };
    const ask = liveAsk(taste, history, ['Chillhop Music', '!!']);
    same(ask.channels, ['newone', 'oldone', 'lofigirl', 'gothamchess', 'chillhopmusic'], 'history first (newest), then the taste\'s makers and YOUR YOUTUBE\'s channels as logins; NOT FOR ME left out');
    same(ask.words, ['jazz', 'chess'], 'the taste\'s strongest plain words');
    same(loginLike('Lofi Girl'), 'lofigirl', 'a maker spelt as a login');
    same(liveAsk(taste, history, [], ['roomwatched']).channels.slice(0, 3), ['newone', 'oldone', 'roomwatched'], 'channels watched in a room (HISTORY) come after the opened ones');
    same([playedChannel('https://www.twitch.tv/lacy'), playedChannel('https://www.twitch.tv/videos/123'), playedChannel('https://evil.tv/lacy')], ['lacy', null, null], 'a HISTORY line\'s channel, only from a channel address');
    const ordered = orderLives([{ id: 'twitch:stranger', tags: ['jazz'] }, { id: 'twitch:oldone', tags: [] }], taste, history, Date.parse(NOW));
    same(ordered.map((one) => one.id), ['twitch:oldone', 'twitch:stranger'], 'a channel watched here comes first');
  }

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${error && error.stack}`);
  process.exit(1);
});
