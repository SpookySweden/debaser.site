/*
 * Linking YouTube (lib/web/youtube-mine.ts), offline with a fake Google: what is asked, what comes back, and that the
 * token stays out of everything kept.
 *   npx tsc app/lib/web/youtube-mine.ts --rootDir app/lib --outDir Temp/youtube-mine-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { GOOGLE_TOKEN, YouTubeTokenError, readYouTubeMine } = require('./youtube-mine-out/web/youtube-mine.js');

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
      return answer({ items: [{ snippet: { resourceId: { channelId: CHANNEL } } }, { snippet: { resourceId: { channelId: 'nonsense' } } }] });
    }
    if (path.endsWith('/playlistItems')) {
      if (over.channelFails) return answer({}, 500);
      return answer({ items: [{ snippet: { title: 'New <b>one</b>', videoOwnerChannelTitle: 'Bob', publishedAt: '2026-11-01T00:00:00Z', resourceId: { videoId: 'newvideo111' } } }] });
    }
    return answer({}, 404);
  };
  return { impl, asked };
};

(async () => {
  const { impl, asked } = google();
  const items = await readYouTubeMine(TOKEN, impl, new Date('2026-11-04T00:00:00Z'));

  // 1. Newest first, as ordinary YouTube rows, playing through the official embed.
  assert.deepEqual(items.map((item) => item.id), ['youtube:newvideo111', 'youtube:liked111111'], 'uploads and likes, newest first; a bad id is dropped');
  assert.equal(items[0].platform, 'youtube');
  assert.match(items[0].embedUrl, /^https:\/\/www\.youtube-nocookie\.com\/embed\/newvideo111/, 'the official player');
  assert.equal(items[0].creator, 'Bob', 'the channel');
  assert.doesNotMatch(items[0].title, /<b>/, "other people's words are plain text");

  // 2. What Google is asked: read only, metadata only, Google only, and the uploads of real channels.
  for (const { url, auth } of asked) {
    assert.equal(url.hostname, 'www.googleapis.com', 'only Google');
    assert.equal(url.searchParams.get('part'), 'snippet', 'titles and channels: no statistics, so no counts');
    assert.equal(auth, `Bearer ${TOKEN}`, 'with the token in a header');
    assert.ok(!url.href.includes(TOKEN), 'never in an address, where logs would keep it');
  }
  assert.ok(asked.some(({ url }) => url.searchParams.get('playlistId') === `UU${CHANNEL.slice(2)}`), "a channel's uploads list");
  assert.equal(asked.filter(({ url }) => url.pathname.endsWith('/playlistItems')).length, 1, 'a nonsense channel id asks nothing');
  assert.ok(!JSON.stringify(items).includes(TOKEN), 'and the token is in nothing that comes back');

  // 3. A bad or refused token says so; one channel failing leaves the rest.
  await assert.rejects(readYouTubeMine('no spaces allowed here at all', impl), YouTubeTokenError, 'not a token: nothing is sent');
  await assert.rejects(readYouTubeMine(TOKEN, google({ refuse: true }).impl), YouTubeTokenError, 'refused: the page offers the link again');
  assert.deepEqual((await readYouTubeMine(TOKEN, google({ channelFails: true }).impl)).map((item) => item.id), ['youtube:liked111111'], 'a channel failing loses only its own');
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
  assert.match(link, /linker !== session\.user\.id\) return \{ items: \[\], needsLink: true, wrongAccount: true \}/, 'coming back as another account uses nothing and says so');
  assert.doesNotMatch(link, /provider_token[^;]*setItem|setItem[^;]*provider_token/, 'the token is not kept in the browser by us');
  const auth = fs.readFileSync('app/lib/auth/supabase-auth.ts', 'utf8');
  assert.match(auth, /https:\/\/www\.googleapis\.com\/auth\/youtube\.readonly/, 'read-only permission');
  assert.doesNotMatch(auth, /auth\/youtube['"`]/, 'never the full permission');
  assert.match(auth, /auth\.linkIdentity\(/, 'an email account links Google, so it stays the same account');
  assert.match(auth, /queryParams\.login_hint = google\.identity_data\.email/, "a Google account is offered its own address, so Google picks the same one");
  assert.match(fs.readFileSync('app/lib/auth/mock-auth.ts', 'utf8'), /linkYouTube/, 'the mock answers too');
  const page = fs.readFileSync('app/components/WebStream.tsx', 'utf8');
  assert.match(page, /YOUTUBE_LINK_ON && browsing \? \(/, 'the key shows only with the switch on');
  assert.doesNotMatch(fs.readFileSync('.env.production', 'utf8'), /NEXT_PUBLIC_GOOGLE_VIDEOS_LINK=on/, 'and it is off in production until Google is set up');

  console.log('ok: linking YouTube: what is asked, what comes back, and the token kept out');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
