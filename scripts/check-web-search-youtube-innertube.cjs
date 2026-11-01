/*
 * WEB search everywhere: YouTube through InnerTube first, the Data API as the fallback, offline (SPEC-web-search.md,
 * "YouTube through InnerTube"; run by `npm run checks:web`):
 *   npx tsc app/lib/web/search/providers/youtube-innertube.ts app/lib/web/search/providers/youtube.ts app/lib/web/search/run.ts app/lib/web/search/cursor.ts app/lib/web/row-addresses.ts --outDir Temp/out-web-search-it --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * The fixtures are real InnerTube answers ("night of the living dead", recorded 2026-11-01), trimmed, with
 * hand-made entries added from real ones: a live broadcast, an id that is not an id, an id starting with "-",
 * markup in a title, a repeat.
 *
 * - the request: one JSON POST to www.youtube.com/youtubei/v1/search, the WEB client, videos only; the next page
 *   sends only the token; a 6s wait; never a redirect after a post
 * - the answer: only plain videoRenderers; metadata only (no views, badges or lengths), ids validated, live and
 *   upcoming skipped, dates from "N units ago", markup removed; addresses built from the id, never from the answer
 * - the order: InnerTube answering means no Data API request and no daily budget spent; InnerTube failing falls
 *   back to the Data API (spending the budget), and with no key or no budget left YouTube says NO ANSWER / DAILY
 *   LIMIT REACHED; a next page goes back to whichever answered; the cursor carries the long token
 * - the shape changing (YouTube's risk) is a failure the fallback catches, never a crash or junk rows
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { NOW, makeAsserts, checkItem } = require('./web-search-check-kit.cjs');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-search-it', 'lib', 'web');
const it = require(join(OUT, 'search', 'providers', 'youtube-innertube.js'));
const yt = require(join(OUT, 'search', 'providers', 'youtube.js'));
const { searchEverywhere } = require(join(OUT, 'search', 'run.js'));
const { encodeSearchCursor, decodeSearchCursor } = require(join(OUT, 'search', 'cursor.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const asserts = makeAsserts('WEB search: YouTube through InnerTube');
const { ok, same } = asserts;

const fixture = (name) => JSON.parse(readFileSync(join(ROOT, 'scripts', 'fixtures', 'web', name), 'utf8'));
const FIRST = fixture('search-youtube-innertube.json');
const MORE = fixture('search-youtube-innertube-more.json');
const KEY = 'AIzaSyTESTKEYtestkey0123456789-_abcdEF';
const API_ANSWER = { items: [{ id: { videoId: 'aqz-KE-bpKQ' }, snippet: { title: 'Big Buck Bunny', channelTitle: 'Blender', publishedAt: '2014-11-10T14:05:55Z', liveBroadcastContent: 'none' } }] };

/** A fake network: InnerTube answers `innertube` (a body, or a status number), the Data API `api`. Every request is recorded. */
function network({ innertube = FIRST, api = API_ANSWER } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body === undefined ? undefined : JSON.parse(init.body), redirect: init.redirect, hasSignal: init.signal !== undefined });
    const answer = new URL(url).hostname === 'www.googleapis.com' ? api : innertube;
    if (typeof answer === 'number') return new Response('no', { status: answer });
    if (answer instanceof Error) throw answer;
    return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}
function deps(net, { key = true, budget = true } = {}) {
  const spent = [];
  return {
    spent,
    deps: {
      fetch: net.fetch,
      now: () => new Date(NOW),
      env: key ? { YOUTUBE_API_KEY: KEY } : {},
      spendBudget: (platform) => {
        spent.push(platform);
        return budget;
      },
    },
  };
}
async function problemOf(work) {
  try {
    await work();
    return 'no problem';
  } catch (error) {
    return error.problem ?? error.message;
  }
}

(async () => {
  /* ---------------------------------------------------------------- the request */
  {
    const net = network();
    const { deps: d } = deps(net);
    await yt.youtubeSearch.search('night living dead', null, d);
    same(net.calls.length, 1, 'InnerTube answering: one request');
    const [call] = net.calls;
    same(call.url, 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false', 'to InnerTube search');
    same(call.method, 'POST', 'a POST');
    same(call.headers['Content-Type'], 'application/json', 'with a JSON body');
    same(call.body, { context: { client: { clientName: 'WEB', clientVersion: call.body.context.client.clientVersion, hl: 'en', gl: 'US' } }, query: 'night living dead', params: 'EgIQAQ==' }, 'the WEB client, the words, videos only; nothing else');
    ok(/^2\.\d{8}\.\d{2}\.\d{2}$/.test(call.body.context.client.clientVersion), 'a WEB client version');
    same(call.redirect, 'manual', 'redirects are not followed by the platform');
    ok(call.hasSignal, 'with a time limit');
    same(it.INNERTUBE_TIMEOUT_MS, 6000, 'of 6s');
    ok(!JSON.stringify(call).includes(KEY), 'the key is never sent to InnerTube');
  }
  {
    const net = network({ innertube: { status: 'redirect' } });
    let redirected = 0;
    const fetch = async (url, init) => {
      redirected += 1;
      return new Response('', { status: 302, headers: { location: 'https://www.youtube.com/elsewhere' } });
    };
    same(await problemOf(() => it.innertubeSearch('x', null, fetch, NOW)), 'redirect after a post', 'a redirect after a post is refused');
    same(redirected, 1, '... and never followed');
    void net;
  }

  /* ---------------------------------------------------------------- the answer */
  const page = it.parseInnertube(FIRST, NOW);
  same(page.items.map((item) => item.externalId), ['YcixZ89-9Ac', 'awmux5tWU90', 'AGsB9eJUrSc', 'V5XwrRFP7Zw', 'BHXb6t7tV9w', 'o7xO_ciIEeA', 'MarkUp00001'],
    'the plain videos only: no shelf, no film for sale, no live broadcast, no bad id, no "-" id, no repeat');
  for (const item of page.items) checkItem(asserts, rowAddresses, item, `innertube ${item.externalId}`);
  const raw = JSON.stringify(FIRST);
  ok(/viewCountText/.test(raw) && /badges/.test(raw) && /lengthText/.test(raw), 'the fixture does hold views, badges and lengths ...');
  const out = JSON.stringify(page.items);
  const text = (node) => node && (node.simpleText ?? (node.runs ?? []).map((run) => run.text).join(''));
  const counts = [];
  JSON.parse(raw, (key, value) => {
    if (['viewCountText', 'shortViewCountText', 'lengthText'].includes(key) && text(value)) counts.push(text(value));
    if (key === 'label' && typeof value === 'string' && /views|minutes/.test(value)) counts.push(value);
    return value;
  });
  ok(counts.length >= 12 && counts.some((count) => /views/.test(count)), `the fixture's view counts and lengths (${counts.slice(0, 3).join(' | ')} ...)`);
  for (const count of counts) ok(!out.includes(count), `... "${count}" reaches no item`);
  ok(page.items.every((item) => Object.keys(item).sort().join() === ['canonicalUrl', 'creator', 'description', 'embedUrl', 'externalId', 'fetchedAt', 'id', 'kind', 'platform', 'publishedAt', 'thumbnailUrl', 'title', 'url'].filter((k) => k !== 'description' || item.description !== undefined).sort().join()), 'exactly the metadata fields');
  const first = page.items[0];
  same([first.title, first.creator, first.url, first.thumbnailUrl, first.embedUrl], ['The Night of the Living Dead Full Film 4K Remaster', 'Mortons Movie Reviews', 'https://youtu.be/YcixZ89-9Ac', 'https://i.ytimg.com/vi/YcixZ89-9Ac/hqdefault.jpg', 'https://www.youtube-nocookie.com/embed/YcixZ89-9Ac'], 'title, channel, and addresses built from the id (the nocookie player)');
  same(first.publishedAt, '2025-10-31T12:00:00.000Z', '"1 year ago": a year before it was read');
  same(page.items.find((item) => item.externalId === 'MarkUp00001').title, 'Bold & plain', 'markup removed, entities decoded');
  const urlsInAnswer = new Set(raw.match(/https?:\/\/[^"\\]+/g) ?? []);
  ok(urlsInAnswer.size > 0, 'the answer holds addresses (thumbnails, links) ...');
  for (const item of page.items) {
    for (const key of ['url', 'canonicalUrl', 'thumbnailUrl', 'embedUrl']) ok(!urlsInAnswer.has(item[key]), `... and no item address is taken from it: ${item[key]}`);
  }
  ok(typeof page.next === 'string' && page.next.length > 500 && it.INNERTUBE_TOKEN.test(page.next), 'the next page token (about 600 characters)');

  same(it.relativeDate('3 weeks ago', NOW), '2026-10-10T12:00:00.000Z', 'weeks');
  same(it.relativeDate('Streamed 2 days ago', NOW), '2026-10-29T12:00:00.000Z', 'a past stream');
  same(it.relativeDate('1 month ago', NOW), '2026-10-01T12:00:00.000Z', 'a month is 30 days');
  for (const odd of [undefined, '', 'Scheduled for 12/1/26', 'LIVE', '3 years from now', 'vor 3 Jahren', '99999 years ago']) same(it.relativeDate(odd, NOW), undefined, `not a date: ${JSON.stringify(odd)}`);

  const more = it.parseInnertube(MORE, NOW);
  same(more.items.length, 4, 'a next page: its videos');
  ok(more.next !== null && more.next !== page.next, '... and its own next token');

  for (const changed of [{}, { contents: {} }, { contents: { twoColumnSearchResultsRenderer: { primaryContents: {} } } }, [], null, 'nope', { onResponseReceivedCommands: [] }]) {
    same(await problemOf(async () => it.parseInnertube(changed, NOW)), 'unexpected response shape', `a changed shape is a failure, not junk: ${JSON.stringify(changed)}`);
  }
  const answer = (contents) => ({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents } } } } });
  same(it.parseInnertube(answer([{ itemSectionRenderer: { contents: [{ backgroundPromoRenderer: { title: { runs: [{ text: 'No results found' }] } } }] } }]), NOW), { items: [], next: null }, "YouTube's own No results notice: nothing found");
  same(await problemOf(async () => it.parseInnertube(answer([]), NOW)), 'unreadable answer', 'an empty answer (a consent or blocked page) is a failure, not "nothing found"');
  // YouTube changing its wording: every video there, none readable.
  const reworded = JSON.parse(JSON.stringify(FIRST).replace(/"simpleText":"(\d+) (\w+?)s? ago"/g, '"simpleText":"il y a $1 $2"'));
  same(await problemOf(async () => it.parseInnertube(reworded, NOW)), 'unreadable answer', 'videos none of which can be read (changed wording) are a failure');
  {
    const net = network({ innertube: reworded });
    const { deps: d, spent } = deps(net);
    const found = await yt.youtubeSearch.search('night', null, d);
    same([found.items.map((item) => item.externalId), spent], [['aqz-KE-bpKQ'], ['youtube']], '... so the Data API answers instead of YouTube showing nothing');
  }

  /* ---------------------------------------------------------------- the order */
  {
    const net = network();
    const { deps: d, spent } = deps(net);
    const found = await yt.youtubeSearch.search('night living dead', null, d);
    ok(found.items.length === 7 && net.calls.every((call) => new URL(call.url).hostname === 'www.youtube.com'), 'InnerTube answering: its results, no Data API request');
    same(spent, [], '... and no daily budget spent');
    ok(found.next.startsWith('it_'), "the next page is marked as InnerTube's");

    const net2 = network({ innertube: MORE });
    const { deps: d2, spent: spent2 } = deps(net2);
    const next = await yt.youtubeSearch.search('night living dead', found.next, d2);
    same(next.items.length, 4, 'LOAD MORE goes back to InnerTube');
    same(net2.calls[0].body, { context: net2.calls[0].body.context, continuation: found.next.slice(3) }, '... sending only the token');
    same(spent2, [], '... without spending budget');
    same(await yt.youtubeSearch.search('x', 'it_short', d2), { items: [], next: null }, 'a token not shaped like one is the end, never sent');
  }
  for (const failure of [500, 429, 403, 'not json', { changed: true }, new Error('offline')]) {
    const net = network({ innertube: failure });
    const { deps: d, spent } = deps(net);
    const found = await yt.youtubeSearch.search('night', null, d);
    const hosts = net.calls.map((call) => new URL(call.url).hostname);
    same([found.items.map((item) => item.externalId), hosts, spent], [['aqz-KE-bpKQ'], ['www.youtube.com', 'www.googleapis.com'], ['youtube']], `InnerTube failing (${failure instanceof Error ? 'no answer' : JSON.stringify(failure)}): the Data API answers, and one search of its budget is spent`);
  }
  {
    const net = network({ innertube: 500 });
    same(await problemOf(() => yt.youtubeSearch.search('night', null, deps(net, { key: false }).deps)), 'NO ANSWER', 'InnerTube failing and no key: YOUTUBE: NO ANSWER');
    same(net.calls.length, 1, '... with no Data API request');
    const net2 = network({ innertube: 500 });
    same(await problemOf(() => yt.youtubeSearch.search('night', null, deps(net2, { budget: false }).deps)), 'DAILY LIMIT REACHED', 'InnerTube failing and the budget spent: DAILY LIMIT REACHED');
    same(net2.calls.length, 1, '... with no Data API request');
    const net3 = network({ innertube: 500 });
    same(await problemOf(() => yt.youtubeSearch.search('night', 'it_' + 'A'.repeat(600), deps(net3).deps)), 'NO ANSWER', 'an InnerTube next page failing: NO ANSWER (the Data API cannot continue it)');
    same(net3.calls.length, 1, '... with no Data API request');
    const net4 = network();
    const { deps: d4, spent: spent4 } = deps(net4);
    await yt.youtubeSearch.search('night', 'CBQQAA', d4);
    same([net4.calls.map((call) => new URL(call.url).hostname), spent4], [['www.googleapis.com'], ['youtube']], 'a Data API next page goes back to the Data API (spending budget)');
  }
  {
    // Through run.ts: the budget is not spent up front for YouTube.
    const net = network();
    const { deps: d, spent } = deps(net);
    const result = await searchEverywhere('night', null, [yt.youtubeSearch], d);
    same([result.statuses, spent], [[{ platform: 'youtube', problem: null }], []], 'a whole search with InnerTube answering spends no YouTube budget');
    const cursor = result.nextCursor;
    ok(cursor !== null && cursor.length <= 1500, `the cursor carries the long token (${cursor && cursor.length} characters)`);
    same(decodeSearchCursor(cursor, ['youtube']), { youtube: result.statuses && JSON.parse(Buffer.from(cursor, 'base64url').toString()).youtube }, '... and reads back');
    same(decodeSearchCursor(encodeSearchCursor({ youtube: 'it_' + 'A'.repeat(900) }), ['youtube']), null, 'a token past the limit is not a cursor');
    same(decodeSearchCursor(encodeSearchCursor({ peertube: 'A'.repeat(300) }), ['peertube']), null, 'only the it_ form may be long');
  }

  /* ---------------------------------------------------------------- the files */
  const source = readFileSync(join(ROOT, 'app/lib/web/search/providers/youtube-innertube.ts'), 'utf8');
  ok(!/viewCount|shortViewCount|lengthText|badges|thumbnail\b|navigationEndpoint|url\b.*videoRenderer/.test(source.replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'the reader never touches views, lengths, badges, thumbnails or links');
  ok(!/invidious|piped/i.test(source + readFileSync(join(ROOT, 'app/lib/web/search/providers/youtube.ts'), 'utf8')), 'no Invidious or Piped');

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${error.stack}`);
  process.exit(1);
});
