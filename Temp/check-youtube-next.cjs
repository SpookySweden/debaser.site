/*
 * YouTube's own "watch next" (lib/web/youtube-next.ts; Luke, 2026-11-14), offline, against a real answer:
 *   npx tsc app/lib/web/youtube-next.ts --outDir Temp/youtube-next-out --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * The fixture is YouTube's real answer for one public video (Big Buck Bunny), asked once on 2026-11-14 and cut down:
 * six suggestions in today's shape, the Shorts shelf beside them, and the "more" entry (scripts/fixtures/web/).
 * - it parses: id, title, channel and age only; the view counts beside them are never read; Shorts are left out
 * - both shapes YouTube sends are read; playlists, live broadcasts and the seed itself are left out
 * - a changed or unreadable answer throws, and the fallback searches the seed's own title words
 * - what is asked of YouTube is the video and nothing about the person
 * - the route asks who is calling first, limits it, and stores nothing
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseNext, ageDate, youtubeNext, relatedFor, nextWords, seedsFrom, nextBody, NEXT_URL, NEXT_MAX } = require('./youtube-next-out/lib/web/youtube-next.js');

const NOW = '2026-11-14T12:00:00.000Z';
const DAY = 86_400_000;
const fixture = JSON.parse(fs.readFileSync('scripts/fixtures/web/youtube-next.json', 'utf8'));
const answer = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const wrap = (results) => ({ contents: { twoColumnWatchNextResults: { secondaryResults: { secondaryResults: { results } } } } });
const lockup = (id, over = {}) => ({
  lockupViewModel: {
    contentId: id,
    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    metadata: { lockupMetadataViewModel: { title: { content: over.title ?? `Title ${id}` }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: 'A channel' } }] }, { metadataParts: [{ text: { content: '2.1M' } }, ...(over.noAge ? [] : [{ text: { content: over.age ?? '3y ago' } }])] }] } } } },
    rendererContext: { commandContext: { onTap: { innertubeCommand: over.tap ?? { commandMetadata: { webCommandMetadata: { url: `/watch?v=${id}` } }, watchEndpoint: { videoId: id } } } } },
    ...(over.type ? { contentType: over.type } : {}),
  },
});

(async () => {
  // 1. The real answer.
  const items = parseNext(fixture, NOW);
  assert.deepEqual(items.map((item) => item.externalId), ['xOXolSQcEb4', 'Y-rmzh0PI3c', 'YaFg-73TmAI', 'to8yh83jlXg', 'XZe_u0Pm8_4', '04__TTodUPY'], "the six suggestions, in YouTube's order");
  assert.equal(items[0].title, 'SNOW BEAR - A Hand-Drawn Animated Short Film (4K) by Aaron Blaise');
  assert.equal(items[0].creator, 'The Art of Aaron Blaise', 'the channel, which is how channels they do not subscribe to arrive');
  assert.equal(items[1].creator, 'Blender');
  assert.equal(items[0].publishedAt, new Date(Date.parse(NOW) - 11 * 30 * DAY).toISOString(), '"11mo ago" as a date');
  assert.equal(items[1].publishedAt, new Date(Date.parse(NOW) - 11 * 365 * DAY).toISOString(), '"11y ago" as a date');
  assert.equal(items[4].publishedAt, new Date(Date.parse(NOW) - 3 * 7 * DAY).toISOString(), '"3w ago" as a date');
  const all = JSON.stringify(items);
  assert.ok(JSON.stringify(fixture).includes('10 million views'), 'the answer does carry view counts');
  assert.doesNotMatch(all, /10M|1\.3M|views|Fundraiser/, '... and none of them, nor a badge, is in what is read');
  assert.ok(!all.includes('7aX5o12yuic'), 'the Short on the shelf beside them is left out');
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), ['canonicalUrl', 'creator', 'embedUrl', 'externalId', 'fetchedAt', 'id', 'kind', 'platform', 'publishedAt', 'thumbnailUrl', 'title', 'url'], 'metadata only: no counts, no description from here');
    assert.equal(item.embedUrl, `https://www.youtube-nocookie.com/embed/${item.externalId}`, "the platform's own player");
    assert.equal(item.thumbnailUrl, `https://i.ytimg.com/vi/${item.externalId}/hqdefault.jpg`, "the picture's address is built from the id, never taken from the answer");
  }
  assert.ok(!parseNext(fixture, NOW, 'Y-rmzh0PI3c').some((item) => item.externalId === 'Y-rmzh0PI3c'), 'the video asked about is never its own suggestion');

  // 2. What is left out, and the older shape.
  const mixed = parseNext(
    wrap([
      lockup('aaaaaaaaaaa'),
      lockup('aaaaaaaaaaa'),
      lockup('bbbbbbbbbbb', { tap: { reelWatchEndpoint: { videoId: 'bbbbbbbbbbb' } } }),
      lockup('ccccccccccc', { tap: { commandMetadata: { webCommandMetadata: { url: '/shorts/ccccccccccc' } } } }),
      lockup('ddddddddddd', { title: 'Quick one #shorts' }),
      lockup('eeeeeeeeeee', { type: 'LOCKUP_CONTENT_TYPE_PLAYLIST' }),
      lockup('fffffffffff', { noAge: true }),
      lockup('not an id!!'),
      { itemSectionRenderer: { contents: [{ compactVideoRenderer: { videoId: 'ggggggggggg', title: { simpleText: 'Older shape' }, longBylineText: { runs: [{ text: 'Old Channel' }] }, publishedTimeText: { simpleText: '3 years ago' }, viewCountText: { simpleText: '5,000 views' } } }] } },
      { adSlotRenderer: {} },
    ]),
    NOW,
  );
  assert.deepEqual(mixed.map((item) => item.externalId), ['aaaaaaaaaaa', 'ggggggggggg'], 'once each; no Shorts (three ways of telling), playlists, live broadcasts, bad ids or adverts; the older shape is read too');
  assert.equal(mixed[1].creator, 'Old Channel');
  assert.doesNotMatch(JSON.stringify(mixed), /5,000|2\.1M/);
  assert.equal(parseNext(wrap(Array.from({ length: 30 }, (_, n) => lockup(`v${String(n).padStart(10, '0')}`))), NOW).length, NEXT_MAX, 'a dozen at most');

  // 3. A changed answer is a failure, not an empty shelf; nothing to suggest is simply nothing.
  assert.throws(() => parseNext({ contents: {} }, NOW), /unexpected response shape/);
  assert.throws(() => parseNext(wrap([lockup('aaaaaaaaaaa', { age: 'eleven moons past' })]), NOW), /unreadable answer/, 'videos, none readable: YouTube changed its wording');
  assert.deepEqual(parseNext(wrap([]), NOW), []);
  assert.deepEqual(parseNext(wrap([{ adSlotRenderer: {} }]), NOW), []);

  // 4. Ages.
  assert.equal(ageDate('2d ago', NOW), new Date(Date.parse(NOW) - 2 * DAY).toISOString());
  assert.equal(ageDate('5h ago', NOW), new Date(Date.parse(NOW) - 5 * 3_600_000).toISOString());
  assert.equal(ageDate('3 years ago', NOW), new Date(Date.parse(NOW) - 3 * 365 * DAY).toISOString(), 'the long wording too');
  assert.equal(ageDate('Streamed 2w ago', NOW), new Date(Date.parse(NOW) - 14 * DAY).toISOString());
  for (const not of ['10M', '1.3M views', '742', '', undefined, 7, '3 lightyears ago']) assert.equal(ageDate(not, NOW), undefined, `"${not}" is not an age`);

  // 5. What is asked of YouTube: the video, and nothing about who is asking.
  const asked = [];
  const youtube = (body, status = 200) => async (url, init) => {
    asked.push({ url: new URL(url), init });
    return answer(body, status);
  };
  const got = await youtubeNext('aqz-KE-bpKQ', youtube(fixture), NOW);
  assert.equal(got.length, 6);
  assert.equal(asked.length, 1, 'one request');
  assert.equal(asked[0].url.href, NEXT_URL);
  assert.equal(`${asked[0].url.hostname}${asked[0].url.pathname}`, 'www.youtube.com/youtubei/v1/next');
  assert.equal(asked[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(asked[0].init.body), nextBody('aqz-KE-bpKQ'));
  assert.deepEqual(Object.keys(JSON.parse(asked[0].init.body)).sort(), ['context', 'videoId'], 'the video and the client, nothing else');
  assert.doesNotMatch(JSON.stringify(asked[0].init.headers ?? {}), /authorization|cookie/i, 'no sign-in of anybody goes to YouTube');
  asked.length = 0;
  await assert.rejects(youtubeNext('not a video id', youtube(fixture), NOW), /not a video id/);
  assert.equal(asked.length, 0, 'a bad id asks nothing');

  // 6. The fallback: YouTube's list, or a search of the seed's own title words, or nothing. It never throws.
  const seed = { id: 'aqz-KE-bpKQ', title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film', creator: 'Blender' };
  const searched = [];
  const search = (found) => async (words) => {
    searched.push(words);
    if (found === null) throw new Error('no answer');
    return found;
  };
  const video = (id, platform = 'youtube') => ({ id: `${platform}:${id}`, platform, externalId: id, title: id });
  const viaNext = await relatedFor(seed, { fetch: youtube(fixture), fetchedAt: NOW, search: search([]) });
  assert.deepEqual([viaNext.via, viaNext.items.length, searched.length], ['next', 6, 0], "YouTube's own list when it answers: no search is made");
  const viaSearch = await relatedFor(seed, { fetch: youtube({ error: {} }, 500), fetchedAt: NOW, search: search([video('aqz-KE-bpKQ'), video('found000001'), video('elsewhere01', 'vimeo')]) });
  assert.deepEqual([viaSearch.via, viaSearch.items.map((item) => item.externalId)], ['search', ['found000001']], 'InnerTube failing: the search, without the seed itself or another site');
  assert.deepEqual(searched, ['big buck bunny 60fps blender'], "... asked the seed's own weightiest title words");
  const changed = await relatedFor(seed, { fetch: youtube({ contents: { somethingNew: {} } }), fetchedAt: NOW, search: search([video('found000002')]) });
  assert.equal(changed.via, 'search', 'YouTube changing its answer: the search');
  const empty = await relatedFor(seed, { fetch: youtube(wrap([])), fetchedAt: NOW, search: search([video('found000003')]) });
  assert.equal(empty.via, 'search', 'an empty list: the search');
  const neither = await relatedFor(seed, { fetch: youtube({}, 500), fetchedAt: NOW, search: search(null) });
  assert.deepEqual(neither, { seed: 'aqz-KE-bpKQ', via: 'none', items: [] }, 'both failing: nothing, and no error');
  const wordless = await relatedFor({ id: 'aqz-KE-bpKQ', title: '!!!', creator: '' }, { fetch: youtube({}, 500), fetchedAt: NOW, search: search([video('x')]) });
  assert.equal(wordless.via, 'none', 'no words to search by: nothing is asked');

  // 6b. The words.
  assert.equal(nextWords({ title: 'The Great Cotton Swab Battle 🐜 Minuscule Movie Clip 🎬🍿' }), 'great cotton swab battle minuscule');
  assert.equal(nextWords({ title: 'Jazz', creator: 'Blue Note Records' }, ['Music']), 'jazz blue note records music', 'a short title borrows the channel and a topic');
  assert.equal(nextWords({ title: 'The official video (HD)', creator: '' }), null);

  // 6c. Seeds from the browser: real ids, plain short words, a few at most.
  assert.deepEqual(seedsFrom([{ id: 'aqz-KE-bpKQ', title: '  Big   Buck ', creator: 'Blender', extra: 'dropped' }, { id: 'aqz-KE-bpKQ' }, { id: 'nonsense' }, 'junk', { id: 'Y-rmzh0PI3c', title: 7 }], 6), [
    { id: 'aqz-KE-bpKQ', title: 'Big Buck', creator: 'Blender' },
    { id: 'Y-rmzh0PI3c', title: '', creator: '' },
  ]);
  assert.equal(seedsFrom(Array.from({ length: 9 }, (_, n) => ({ id: `v${String(n).padStart(10, '0')}` })), 6).length, 6);
  assert.deepEqual(seedsFrom('no', 6), []);

  // 7. The route: who is calling first, limited, cached by video, nothing stored.
  const route = fs.readFileSync('app/api/web/youtube/related/route.ts', 'utf8');
  assert.ok(route.indexOf('auth.getUser(session)') < route.indexOf('request.json()'), 'the session is checked before the body is read');
  assert.match(route, /data\.user\.is_anonymous === true\) return json\(\{ error: 'Sign in first\.' \}, 401\)/, 'visitors and guests are refused');
  assert.match(route, /seedsFrom\(body\?\.seeds, MOST_SEEDS\)\.filter\(\(\) => perPerson\.allow\(person\)\)/, 'a few seeds a request, so many a day a person');
  assert.match(route, /relatedFor\(seed, \{ fetch: cachedFetch,/, "YouTube's answers are kept in the server's day-long cache, by video");
  assert.doesNotMatch(route, /\.from\(|\.rpc\(|console\./, 'nothing is stored or logged');
  const lib = fs.readFileSync('app/lib/web/youtube-next.ts', 'utf8');
  assert.match(lib, /safeFetchJson\(NEXT_URL, \{ allowedHosts: INNERTUBE_HOSTS,/, 'through safe-fetch, to the one allowed host');
  const code = lib.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(code, /viewCount|accessibilityLabel|badge/i, 'no count or badge is ever named in the code, so none can be read');

  // 8. The browser: once a day a video, a dozen a day a person, by account, and the shelf never waits long.
  const browser = fs.readFileSync('app/lib/web/youtube-related.ts', 'utf8');
  assert.match(browser, /if \(user !== null && saved\.user !== user\) return empty;/, "someone else signing in on this browser gets nothing of it");
  assert.match(browser, /\.slice\(0, Math\.max\(0, DAY_SEEDS - kept\.asked\)\)/, "the day's count");
  assert.match(browser, /kept\.bySeed\[seed\.id\] === undefined/, 'a video already asked about today is not asked again');
  assert.match(browser, /if \(have\.length > 0\) return have;/, 'with something kept the shelf does not wait');
  assert.match(browser, /seeds: wanted\.map\(\(\{ id, title, creator \}\) => \(\{ id, title, creator \}\)\)/, 'only the id, title and channel of each seed are sent');

  console.log("ok: YouTube's watch next: a real answer parsed, metadata only, no Shorts, the fallback search, and the limits");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
