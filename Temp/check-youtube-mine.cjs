/*
 * Linking YouTube (lib/web/youtube-mine.ts), offline with a fake Google: what is asked, what comes back, and that the
 * token stays out of everything kept.
 *   npx tsc app/lib/web/youtube-mine.ts app/lib/web/recommend.ts --rootDir app/lib --outDir Temp/youtube-mine-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *
 * Widened on purpose 2026-11-13 (Luke: "takes into account what would be shown on your youtube homepage"): 50 channels,
 * 50 likes, the person's playlist names and the topics YouTube files their channels under, which teach the page's order.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { GOOGLE_TOKEN, YouTubeTokenError, readYouTubeMine, topicWord } = require('./youtube-mine-out/web/youtube-mine.js');
const { withYouTube, subscribedFirst, channelNames, pickSeed, NO_TASTE } = require('./youtube-mine-out/web/recommend.js');

const TOKEN = 'ya29.a0AfB_byC-example-token-value';
const CHANNEL = `UC${'a'.repeat(22)}`;
const answer = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const google = (over = {}) => {
  const asked = [];
  const impl = async (url, init) => {
    asked.push({ url: new URL(url), auth: new Headers(init?.headers).get('authorization') });
    const path = new URL(url).pathname;
    if (over.refuse) return answer({ error: {} }, 401);
    if (path.endsWith('/videos')) {
      return answer({ items: [{ id: 'liked111111', snippet: { title: 'Liked', channelTitle: 'Ada', publishedAt: '2026-01-01T00:00:00Z' } }, { id: 'not valid id!', snippet: { title: 'Bad' } }] });
    }
    if (path.endsWith('/subscriptions')) {
      return answer({ items: [{ snippet: { title: 'Bob Films', resourceId: { channelId: CHANNEL } } }, { snippet: { title: 'Nobody', resourceId: { channelId: 'nonsense' } } }] });
    }
    if (path.endsWith('/playlistItems')) {
      if (over.channelFails) return answer({}, 500);
      return answer({ items: [{ snippet: { title: 'New <b>one</b>', videoOwnerChannelTitle: 'Bob', publishedAt: '2026-11-01T00:00:00Z', resourceId: { videoId: 'newvideo111' } } }] });
    }
    if (path.endsWith('/playlists')) {
      if (over.extrasFail) return answer({}, 500);
      return answer({ items: [{ snippet: { title: '  Rainy   day jazz ' } }, { snippet: { title: 'Rainy day jazz' } }] });
    }
    if (path.endsWith('/channels')) {
      if (over.extrasFail) return answer({}, 500);
      return answer({
        items: [
          {
            id: CHANNEL,
            topicDetails: {
              topicCategories: [
                'https://en.wikipedia.org/wiki/Film',
                'https://en.wikipedia.org/wiki/Lifestyle_(sociology)',
                'https://evil.example/wiki/Film',
                'https://en.wikipedia.org/wiki/%3Cscript%3E',
              ],
            },
          },
        ],
      });
    }
    return answer({}, 404);
  };
  return { impl, asked };
};

(async () => {
  const { impl, asked } = google();
  const read = await readYouTubeMine(TOKEN, impl, new Date('2026-11-04T00:00:00Z'));
  const { items } = read;

  // 1. Newest first, as ordinary YouTube rows, playing through the official embed.
  assert.deepEqual(items.map((item) => item.id), ['youtube:newvideo111', 'youtube:liked111111'], 'uploads and likes, newest first; a bad id is dropped');
  assert.equal(items[0].platform, 'youtube');
  assert.match(items[0].embedUrl, /^https:\/\/www\.youtube-nocookie\.com\/embed\/newvideo111/, 'the official player');
  assert.equal(items[0].creator, 'Bob', 'the channel');
  assert.doesNotMatch(items[0].title, /<b>/, "other people's words are plain text");

  // 2. What Google is asked: read only, metadata only, Google only, and the uploads of real channels.
  for (const { url, auth } of asked) {
    assert.equal(url.hostname, 'www.googleapis.com', 'only Google');
    assert.ok(['snippet', 'topicDetails'].includes(url.searchParams.get('part')), 'titles, channels and topics: no statistics, so no counts');
    assert.ok(!/search$/.test(url.pathname), 'never search (100 units each)');
    assert.equal(auth, `Bearer ${TOKEN}`, 'with the token in a header');
    assert.ok(!url.href.includes(TOKEN), 'never in an address, where logs would keep it');
  }
  assert.ok(asked.some(({ url }) => url.searchParams.get('playlistId') === `UU${CHANNEL.slice(2)}`), "a channel's uploads list");
  assert.equal(asked.filter(({ url }) => url.pathname.endsWith('/playlistItems')).length, 1, 'a nonsense channel id asks nothing');
  assert.ok(!JSON.stringify(read).includes(TOKEN), 'and the token is in nothing that comes back');

  // 2b. What it says about the person: the real channels by name, the topics as plain words, the playlist names once.
  assert.deepEqual(read.channels, [{ id: CHANNEL, name: 'Bob Films' }], 'a nonsense channel id is dropped');
  assert.deepEqual(read.topics, ['Film', 'Lifestyle'], "Wikipedia's topic pages as words; another host and markup are dropped");
  assert.deepEqual(read.playlists, ['Rainy day jazz'], 'playlist names, tidied, once each');
  assert.equal(topicWord('https://en.wikipedia.org/wiki/Video_game_culture'), 'Video game culture');
  assert.equal(topicWord('http://en.wikipedia.org/wiki/Film'), null, 'https only');
  const channelsAsked = asked.find(({ url }) => url.pathname.endsWith('/channels'));
  assert.equal(channelsAsked.url.searchParams.get('id'), CHANNEL, 'topics asked for the subscribed channels, in one request');
  assert.equal(asked.find(({ url }) => url.pathname.endsWith('/subscriptions')).url.searchParams.get('maxResults'), '50');
  const extrasFail = await readYouTubeMine(TOKEN, google({ extrasFail: true }).impl);
  assert.deepEqual([extrasFail.topics, extrasFail.playlists, extrasFail.items.length], [[], [], 2], 'topics or playlists failing loses only those');

  // 2c. What it teaches: channels as creators, topics first among the page's own searches, subscribed rows first.
  const taste = withYouTube(NO_TASTE, read);
  assert.ok(taste.creators['bob films'] > 0 && taste.tags.film > 0 && taste.tags['rainy day jazz'] > 0, 'channels, topics and playlists all count');
  assert.equal(pickSeed({ kino: false, kind: 'all' }, taste, new Set(), 0), 'film', "the page's first search for this reader is their channels' strongest topic");
  assert.deepEqual(withYouTube(NO_TASTE, { channels: [], topics: [], playlists: [] }), NO_TASTE, 'no YouTube: nothing changes');
  const rows = [{ id: 'a', creator: 'Someone' }, { id: 'b', creator: 'BOB FILMS' }, { id: 'c' }, { id: 'd', creator: 'Bob Films' }];
  assert.deepEqual(subscribedFirst(rows, channelNames(read.channels)).map((row) => row.id), ['b', 'd', 'a', 'c'], 'their channels lead the page, every row kept once');
  assert.deepEqual(subscribedFirst(rows, new Set()).map((row) => row.id), ['a', 'b', 'c', 'd'], 'no channels: the order as it came');

  // 3. A bad or refused token says so; one channel failing leaves the rest.
  await assert.rejects(readYouTubeMine('no spaces allowed here at all', impl), YouTubeTokenError, 'not a token: nothing is sent');
  await assert.rejects(readYouTubeMine(TOKEN, google({ refuse: true }).impl), YouTubeTokenError, 'refused: the page offers the link again');
  assert.deepEqual((await readYouTubeMine(TOKEN, google({ channelFails: true }).impl)).items.map((item) => item.id), ['youtube:liked111111'], 'a channel failing loses only its own');
  assert.ok(GOOGLE_TOKEN.test(TOKEN));

  // 4. The route: session before anything, nothing stored, plain errors.
  const route = fs.readFileSync('app/api/web/youtube/mine/route.ts', 'utf8');
  assert.ok(route.indexOf('auth.getUser(session)') < route.indexOf('x-google-token'), 'the session is checked before the token is looked at');
  assert.doesNotMatch(route, /\.from\(|\.rpc\(|console\./, 'nothing is stored or logged');

  // 5. The browser: off until Luke turns it on, it asks for read-only, and UNLINK forgets.
  const link = fs.readFileSync('app/lib/web/youtube-link.ts', 'utf8');
  assert.match(link, /process\.env\.NEXT_PUBLIC_GOOGLE_VIDEOS_LINK === 'on'/, 'behind its switch');
  assert.match(link, /saved\.user !== user/, "someone else signing in on this browser never sees this person's YouTube");
  assert.match(link, /kept\(session\.user\.id\)/, 'what is kept is read by account');
  assert.match(link, /if \(!session\) return nothing;/, 'and signed out there is nothing');
  assert.match(link, /linker !== session\.user\.id\) return \{ \.\.\.nothing, needsLink: true, wrongAccount: true \}/, 'coming back as another account uses nothing and says so');
  assert.match(link, /const nothing: YouTubeMine = \{ \.\.\.NOTHING_FOUND,/, '... and nothing is nothing at all');
  assert.doesNotMatch(link, /provider_token[^;]*setItem|setItem[^;]*provider_token/, 'the token is not kept in the browser by us');
  const auth = fs.readFileSync('app/lib/auth/supabase-auth.ts', 'utf8');
  assert.match(auth, /https:\/\/www\.googleapis\.com\/auth\/youtube\.readonly/, 'read-only permission');
  assert.doesNotMatch(auth, /auth\/youtube['"`]/, 'never the full permission');
  assert.match(auth, /auth\.linkIdentity\(/, 'an email account links Google, so it stays the same account');
  assert.match(auth, /queryParams\.login_hint = google\.identity_data\.email/, "a Google account is offered its own address, so Google picks the same one");
  assert.match(fs.readFileSync('app/lib/auth/mock-auth.ts', 'utf8'), /linkYouTube/, 'the mock answers too');
  const page = fs.readFileSync('app/components/WebStream.tsx', 'utf8');
  assert.match(page, /YOUTUBE_LINK_ON && browsing \? \(/, 'the key shows only with the switch on');
  // Updated on purpose 2026-11-13 (SPEC-recommender.md step 3): the taste YouTube adds to is now this browser's and the FOR YOU history's.
  assert.match(page, /withYouTube\(tasteFromHistory\([^)]*savedTaste\), mineSignals\)/, "the page's order learns from the YouTube signals");
  assert.match(page, /sortOf\(what\.filters\)\.sort === 'best' \? subscribedFirst\(ownRows, subscribed\.current\) : ownRows/, 'subscribed rows lead only under BEST MATCH');
  // Updated on purpose 2026-11-14: Luke set up Google ("Yes, switch it on"), so it is on in production now.
  assert.match(fs.readFileSync('.env.production', 'utf8'), /^NEXT_PUBLIC_GOOGLE_VIDEOS_LINK=on\r?$/m, 'on in production since Google was set up');

  console.log('ok: linking YouTube: what is asked, what comes back, and the token kept out');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
