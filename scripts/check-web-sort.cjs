/*
 * WEB search sorting (SPEC-web-sort.md), offline; run by `npm run checks:web`, part of `npm run verify`:
 *   npx tsc app/lib/web/web-sort.ts app/lib/web/live-merge.ts app/lib/web/web-filters.ts app/lib/web/search/run.ts app/lib/web/search/index.ts app/lib/web/search/providers/youtube-dates.ts app/lib/web/supabase-web-repository.ts app/lib/web/mock-web-repository.ts --outDir Temp/out-web-sort --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - each provider's address for each order: the Archive's `sort[]`, Sepia's `sort`, Commons' `gsrsort` (dated by
 *   first upload), Openverse's `unstable__sort_*`, YouTube's InnerTube `CAMSAhAB` and the Data API's `order`
 * - a provider without an order is not asked, and its line says so; the client's NO_POPULAR is the providers' own
 * - taking turns (BEST MATCH, POPULAR): one from each source in its own order
 * - the date hold-back: a later page with an older row never jumps ahead of rows shown; LOAD MORE asks the source
 *   holding the rest back; rows shown before a slower source answered go back to waiting (until the reader acts)
 * - POPULAR with KINO: a media server's row only ever takes its KINO row's place
 * - YouTube by date on a fake InnerTube: walking every page in either direction gives every matching upload once,
 *   in date order; no empty window is ever sent; strays are dropped; a YouTube that ignores windows is refused
 * - KINO: every page read, the vote floor, undated titles left out of DATE, and no count or rating in the answer
 * - `sort:` in the box and `?sort=` in the address; the saved stream oldest first in both repositories
 */
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const { makeAsserts } = require('./web-search-check-kit.cjs');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-sort', 'lib', 'web');
const sort = require(join(OUT, 'web-sort.js'));
const merge = require(join(OUT, 'live-merge.js'));
const filters = require(join(OUT, 'web-filters.js'));
const { searchEverywhere } = require(join(OUT, 'search', 'run.js'));
const { SEARCH_PROVIDERS } = require(join(OUT, 'search', 'index.js'));
const ia = require(join(OUT, 'search', 'providers', 'internet-archive.js'));
const pt = require(join(OUT, 'search', 'providers', 'peertube.js'));
const wc = require(join(OUT, 'search', 'providers', 'wikimedia-commons.js'));
const ov = require(join(OUT, 'search', 'providers', 'openverse.js'));
const yt = require(join(OUT, 'search', 'providers', 'youtube.js'));
const it = require(join(OUT, 'search', 'providers', 'youtube-innertube.js'));
const dates = require(join(OUT, 'search', 'providers', 'youtube-dates.js'));
const kino = require(join(OUT, 'search', 'providers', 'kino.js'));
const { createSupabaseWebRepository } = require(join(OUT, 'supabase-web-repository.js'));
const { getMockWebRepository } = require(join(OUT, 'mock-web-repository.js'));
const asserts = makeAsserts('WEB search sorting');
const { ok, same } = asserts;

const NOW = new Date('2026-11-02T20:00:00.000Z');
const query = (url) => Object.fromEntries(new URL(url).searchParams.entries());
const ids = (rows) => rows.map((row) => row.id);
const row = (id, publishedAt, extra = {}) => ({ id, platform: id.split(':')[0], externalId: id.split(':')[1], publishedAt, title: id, kind: 'video', alsoOn: [], ...extra });
const day = (n) => new Date(Date.UTC(2026, 0, n)).toISOString();

(async () => {
  /* ---------------------------------------------------------------- each provider's own order */
  same(query(ia.iaSearchUrl('q', 1, 'popular'))['sort[]'], 'downloads desc', 'Archive POPULAR is its downloads order');
  same(query(ia.iaSearchUrl('q', 1, 'newest'))['sort[]'], 'publicdate desc', 'Archive newest is publicdate desc (the date it shows)');
  same(query(ia.iaSearchUrl('q', 1, 'oldest'))['sort[]'], 'publicdate asc', 'Archive oldest is publicdate asc');
  ok(!('sort[]' in query(ia.iaSearchUrl('q', 1))), 'Archive best match sends no sort');
  same(query(pt.sepiaSearchUrl('q', 0, 'popular')).sort, '-views', 'PeerTube POPULAR is Sepia -views');
  same(query(pt.sepiaSearchUrl('q', 0, 'newest')).sort, '-publishedAt', 'PeerTube newest');
  same(query(pt.sepiaSearchUrl('q', 0, 'oldest')).sort, 'publishedAt', 'PeerTube oldest');
  ok(!('sort' in query(pt.sepiaSearchUrl('q', 0))), 'PeerTube best match sends no sort');
  same(query(wc.commonsSearchUrl('q', 0, undefined, 'newest')).gsrsort, 'create_timestamp_desc', 'Commons newest');
  same(query(wc.commonsSearchUrl('q', 0, undefined, 'oldest')).gsrsort, 'create_timestamp_asc', 'Commons oldest');
  same(query(wc.commonsSearchUrl('q', 0, undefined, 'oldest')).iilimit, '50', 'Commons by date asks for every upload');
  ok(!('gsrsort' in query(wc.commonsSearchUrl('q', 0))), 'Commons best match sends no sort');
  const twoUploads = { ns: 6, pageid: 7, title: 'File:A.jpg', imageinfo: [{ timestamp: '2024-01-01T00:00:00Z', mediatype: 'BITMAP', url: 'x' }, { timestamp: '2010-05-05T00:00:00Z', mediatype: 'BITMAP' }] };
  same(wc.toWebItem(twoUploads, NOW.toISOString()).publishedAt, '2010-05-05T00:00:00.000Z', 'a Commons file is dated by its first upload, as create_timestamp orders it');
  same(query(ov.ovSearchUrl('q', 1, '', 'newest')).unstable__sort_by, 'indexed_on', 'Openverse by date is indexed_on (the date it shows)');
  same(query(ov.ovSearchUrl('q', 1, '', 'oldest')).unstable__sort_dir, 'asc', 'Openverse oldest');
  ok(!('unstable__sort_by' in query(ov.ovSearchUrl('q', 1))), 'Openverse best match sends no sort');
  ok(!ov.inDateOrder([row('openverse:a', day(1)), row('openverse:b', day(5))], 'newest'), 'an Openverse answer out of date order is caught');
  same(it.innertubeBody('q', null, it.VIDEOS_BY_VIEWS).params, 'CAMSAhAB', 'YouTube POPULAR is its own view-count sort');
  same(it.innertubeBody('q', null).params, 'EgIQAQ==', 'YouTube best match is the plain videos filter');
  same(query(yt.ytSearchUrl('q', null, 'k'.repeat(30), 'popular')).order, 'viewCount', 'the Data API fallback asks viewCount');
  same(query(yt.ytSearchUrl('q', null, 'k'.repeat(30), 'newest')).order, 'date', 'the Data API fallback asks date for newest');
  ok(!('order' in query(yt.ytSearchUrl('q', null, 'k'.repeat(30), 'oldest'))), 'the Data API has no oldest-first: none is pretended');

  // The client's list of sources with no popularity order is the providers' own.
  const noPopular = SEARCH_PROVIDERS.filter((provider) => !(provider.orders ?? []).includes('popular')).map((provider) => provider.platform).sort();
  same([...sort.NO_POPULAR].filter((source) => source !== 'stream').sort(), noPopular, 'NO_POPULAR names exactly the providers without a popularity order');
  ok(SEARCH_PROVIDERS.every((provider) => ['newest', 'oldest'].every((order) => (provider.orders ?? []).includes(order))), 'every provider can give DATE both ways');

  /* ---------------------------------------------------------------- run.ts: not asked, and says so; mixing */
  const asked = [];
  const fake = (platform, items, orders) => ({
    platform,
    allowedHosts: [],
    timeoutMs: 1000,
    orders,
    async search(_words, _page, deps) {
      asked.push([platform, deps.order]);
      return { items, next: null };
    },
    async fetchOne() {
      return null;
    },
  });
  const a = fake('internet_archive', [row('internet_archive:a1', day(3)), row('internet_archive:a2', day(9))], ['popular', 'newest', 'oldest']);
  const b = fake('wikimedia_commons', [row('wikimedia_commons:b1', day(5))], ['newest', 'oldest']);
  const c = fake('peertube', [row('peertube:c1', day(1)), row('peertube:c2', day(7))], ['popular', 'newest', 'oldest']);
  const popular = await searchEverywhere('w', null, [a, b, c], { order: 'popular' });
  same(asked.map(([platform]) => platform), ['internet_archive', 'peertube'], 'POPULAR does not ask a source with no popularity order');
  same(popular.statuses.find((status) => status.platform === 'wikimedia_commons').problem, 'NO POPULARITY ORDER', '... and its line says so');
  same(ids(popular.items), ['internet_archive:a1', 'peertube:c1', 'internet_archive:a2', 'peertube:c2'], 'POPULAR takes turns, each in its own order');
  ok(asked.every(([, order]) => order === 'popular'), 'each provider is handed the order');
  const oldest = await searchEverywhere('w', null, [a, b, c], { order: 'oldest' });
  same(ids(oldest.items), ['peertube:c1', 'internet_archive:a1', 'wikimedia_commons:b1', 'peertube:c2', 'internet_archive:a2'], 'DATE oldest is one date order');
  same(sort.takeTurns([[1, 2, 3], [], ['x']]), [1, 'x', 2, 3], 'takeTurns skips a source that has run out');

  /* ---------------------------------------------------------------- the page's merge: turns */
  let list = merge.emptyLive({ kind: 'turns' });
  list = merge.arrive(list, [row('youtube:y1', day(1)), row('youtube:y2', day(9)), row('youtube:y3', day(5))], false, { lane: 'youtube', more: true });
  list = merge.arrive(list, [row('internet_archive:s1', day(2)), row('internet_archive:s2', day(3))], false, { lane: 'internet_archive', more: false });
  same(ids(list.shown), ['internet_archive:s1', 'youtube:y1', 'internet_archive:s2', 'youtube:y2', 'youtube:y3'], 'turns: one from each source, in each one\'s own order, whichever answered first');
  list = merge.arrive(list, [row('youtube:y4', day(30))], true, { lane: 'youtube', more: false });
  same(ids(list.shown).slice(-1), ['youtube:y4'], "turns: LOAD MORE's rows go at the end");

  /* ---------------------------------------------------------------- the page's merge: by date, held back */
  const desc = { kind: 'date', dir: 'desc' };
  list = merge.emptyLive(desc);
  list = merge.arrive(list, [row('internet_archive:a10', day(10)), row('internet_archive:a9', day(9)), row('internet_archive:a8', day(8))], false, { lane: 'internet_archive', more: true });
  list = merge.arrive(list, [row('peertube:p7', day(7)), row('peertube:p6', day(6)), row('peertube:p2', day(2))], false, { lane: 'peertube', more: true });
  same(ids(list.shown), ['internet_archive:a10', 'internet_archive:a9', 'internet_archive:a8'], "rows another source's next page could beat are not shown yet");
  same(merge.heldBack(list), 3, '... they are held back');
  same(merge.lanesToAsk(list), ['internet_archive'], 'LOAD MORE asks the source holding them back, by itself');
  list = merge.arrive(list, [row('internet_archive:a7', day(7)), row('internet_archive:a4', day(4))], true, { lane: 'internet_archive', more: true });
  same(ids(list.shown), ['internet_archive:a10', 'internet_archive:a9', 'internet_archive:a8', 'peertube:p7', 'internet_archive:a7', 'peertube:p6', 'internet_archive:a4'], 'its next page releases what nothing can beat any more, in date order, below what was shown');
  same(ids(merge.lanesToAsk(list).length === 1 ? list.lanes.peertube.buffer : []), ['peertube:p2'], "PeerTube's 2nd still waits: the Archive's next page could hold the 3rd");
  same(merge.lanesToAsk(list), ['internet_archive'], '... so the Archive is asked again, by itself');
  list = merge.arrive(list, [row('peertube:p1', day(1))], true, { lane: 'peertube', more: false });
  list = merge.arrive(list, [], true, { lane: 'internet_archive', more: false });
  const all = list.shown.map((r) => r.publishedAt);
  ok(all.every((at, index) => index === 0 || all[index - 1] >= at), 'every page walked: the whole list is one date order, nothing ever overtaken');
  same(list.shown.length, 9, '... with every row once');
  same(merge.heldBack(list), 0, '... and nothing left held');

  // A source that answered with nothing yet but has more (YouTube out of time before its first day) holds all back.
  list = merge.emptyLive(desc);
  list = merge.arrive(list, [], false, { lane: 'youtube', more: true });
  list = merge.arrive(list, [row('internet_archive:x1', day(5))], false, { lane: 'internet_archive', more: false });
  same(list.shown.length, 0, 'a source with no rows yet but more to come holds everything back');
  same(merge.lanesToAsk(list), ['youtube'], '... and is the one asked next');
  list = merge.arrive(list, [row('youtube:y9', day(9))], true, { lane: 'youtube', more: false });
  same(ids(list.shown), ['youtube:y9', 'internet_archive:x1'], '... its rows then come first, as they should');
  // A page the filters emptied still says where its source is.
  list = merge.emptyLive(desc);
  list = merge.arrive(list, [], false, { lane: 'wikimedia_commons', more: true, page: [{ publishedAt: day(3) }] });
  list = merge.arrive(list, [row('internet_archive:x5', day(5)), row('internet_archive:x1', day(1))], false, { lane: 'internet_archive', more: false });
  same(ids(list.shown), ['internet_archive:x5'], "a filtered-out page still moves its source's place: what it cannot beat shows");
  // By date with KINO: a server's copy arriving while its KINO row is held back still takes that row's place.
  list = merge.emptyLive(desc);
  list = merge.arrive(list, [row('internet_archive:new', day(20))], false, { lane: 'internet_archive', more: true });
  list = merge.arrive(list, [row('media:tmdb-movie-5', day(10), { platform: 'kino', media: { copies: [] } })], false, { lane: 'kino', more: false });
  list = merge.arrive(list, [row('media:tmdb-movie-5', day(10), { platform: 'server-1', media: { copies: [{ server: 'server-1' }] } })], false, { lane: 'servers', more: false });
  list = merge.arrive(list, [], true, { lane: 'internet_archive', more: false });
  same(list.shown.map((r) => r.platform), ['internet_archive', 'server-1'], "a held-back KINO row is replaced by the server's copy (its SERVER buttons kept)");

  // A slow source's first answer sends rows already shown back to waiting, until the reader acts.
  const asc = { kind: 'date', dir: 'asc' };
  list = merge.emptyLive(asc);
  list = merge.arrive(list, [row('peertube:p2018', '2018-01-01T00:00:00.000Z'), row('peertube:p2023', '2023-01-01T00:00:00.000Z')], false, { lane: 'peertube', more: false });
  same(ids(list.shown), ['peertube:p2018', 'peertube:p2023'], 'the first source to answer shows at once');
  list = merge.arrive(list, [row('wikimedia_commons:c2005', '2005-01-01T00:00:00.000Z'), row('wikimedia_commons:c2006', '2006-01-01T00:00:00.000Z')], false, { lane: 'wikimedia_commons', more: true });
  same(ids(list.shown), ['wikimedia_commons:c2005', 'wikimedia_commons:c2006'], "a slower source's next page could beat them: before the reader acts, they go back to waiting");
  let frozen = merge.freeze(merge.emptyLive(asc));
  frozen = merge.arrive(frozen, [row('peertube:p2018', '2018-01-01T00:00:00.000Z')], false, { lane: 'peertube', more: false });
  frozen = merge.release(frozen);
  frozen = merge.arrive(frozen, [row('wikimedia_commons:c2005', '2005-01-01T00:00:00.000Z')], false, { lane: 'wikimedia_commons', more: true });
  same(ids(frozen.shown), ['peertube:p2018'], 'after the reader acts nothing shown moves');
  same(ids(merge.release(frozen).shown), ['wikimedia_commons:c2005', 'peertube:p2018'], 'N MORE RESULTS puts the held rows at the top, in the order');

  // POPULAR with KINO: the saved stream only ever replaces its KINO row, in place.
  list = merge.emptyLive({ kind: 'turns' });
  const kinoRow = (id) => row(id, day(1), { platform: 'kino', media: { copies: [] } });
  const serverRow = (id) => row(id, day(1), { platform: 'server-1', media: { copies: [{ server: 'server-1' }] } });
  list = merge.arrive(list, [serverRow('media:tmdb-movie-1'), serverRow('media:tmdb-movie-2')], false, { lane: 'stream', more: false, swapOnly: true });
  same(list.shown.length, 0, "a server's row never shows on its own under POPULAR");
  list = merge.arrive(list, [kinoRow('media:tmdb-movie-9'), kinoRow('media:tmdb-movie-2')], false, { lane: 'kino', more: true });
  same(ids(list.shown), ['media:tmdb-movie-9', 'media:tmdb-movie-2'], 'KINO rows in their own (rating) order');
  same(list.shown[1].platform, 'server-1', "the server's copy took its KINO row's place");
  same(list.waiting.map((r) => r.id), ['media:tmdb-movie-1'], 'the other still waits for its KINO row');

  /* ---------------------------------------------------------------- YouTube by date, on a fake InnerTube */
  const WORDS = 'night of the living dead';
  const PT_DAY = (iso) => new Date(Date.parse(iso) - 8 * 3_600_000).toISOString().slice(0, 10);
  const age = (iso) => {
    const ms = NOW.getTime() - Date.parse(iso);
    for (const [unit, size] of [['year', 365 * 864e5], ['month', 30 * 864e5], ['week', 7 * 864e5], ['day', 864e5], ['hour', 36e5]]) {
      const n = Math.floor(ms / size);
      if (n >= 1) return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
    return '5 minutes ago';
  };
  const VIDEOS = [];
  const at = (y, m, d, h) => new Date(Date.UTC(y, m - 1, d, h)).toISOString();
  const spots = [at(2005, 6, 1, 20), at(2005, 6, 1, 21), at(2006, 2, 26, 18), at(2008, 3, 10, 15), at(2012, 10, 31, 20), at(2019, 7, 4, 16), at(2024, 1, 2, 19), at(2026, 10, 31, 22), at(2026, 11, 1, 18), at(2026, 11, 2, 9), at(2026, 11, 2, 18)];
  spots.forEach((time, index) => VIDEOS.push({ id: `v${String(index).padStart(2, '0')}xxxxxxxx`.slice(0, 11), time, title: `Night of the Living Dead part ${index}` }));
  // A busy day: 45 uploads, so it runs to three pages.
  for (let n = 0; n < 45; n += 1) VIDEOS.push({ id: `b${String(n).padStart(2, '0')}xxxxxxxx`.slice(0, 11), time: at(2016, 10, 31, 9 + (n % 12)), title: `night of the living dead ${n}` });
  VIDEOS.push({ id: 'zjunkxxxxxx', time: at(2016, 10, 31, 12), title: 'LitRPG audiobook' });
  const token = (q, offset) => Buffer.from(JSON.stringify({ q, offset }).padEnd(24, ' ')).toString('base64url');
  const sent = [];
  const innertube = ({ ignore = false, strays = [] } = {}) => async (url, init) => {
    const body = JSON.parse(init.body);
    let q;
    let offset = 0;
    if (body.continuation) ({ q, offset } = JSON.parse(Buffer.from(body.continuation, 'base64url').toString().trim()));
    else q = body.query;
    sent.push(q);
    const window = /after:(\d{4}-\d{2}-\d{2}) before:(\d{4}-\d{2}-\d{2})/.exec(q);
    const inside = VIDEOS.filter((video) => ignore || !window || (PT_DAY(video.time) >= window[1] && PT_DAY(video.time) < window[2]));
    const answer = [...(offset === 0 ? strays : []), ...inside.slice(offset, offset + 20)];
    const renderers = answer.map((video) => ({ videoRenderer: { videoId: video.id, title: { runs: [{ text: video.title }] }, ownerText: { runs: [{ text: 'Chan' }] }, publishedTimeText: { simpleText: age(video.time) } } }));
    const more = inside.length > offset + 20 ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: token(q, offset + 20) } } } }] : [];
    const items = renderers.length === 0 && offset === 0 ? [{ backgroundPromoRenderer: {} }] : renderers;
    const sections = [{ itemSectionRenderer: { contents: items } }, ...more];
    const json = offset === 0 ? { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: sections } } } } } : { onResponseReceivedCommands: [{ appendContinuationItemsAction: { continuationItems: sections } }] };
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const walk = async (direction, fetchImpl) => {
    const seen = [];
    let cursor = null;
    for (let page = 0; page < 40; page += 1) {
      const answer = await dates.datedSearch(WORDS, direction, cursor, { fetch: fetchImpl, now: () => NOW });
      seen.push(...answer.items);
      cursor = answer.next;
      if (cursor === null) break;
      ok(dates.YT_DATED_CURSOR.test(cursor), `the cursor is a short day token (${cursor})`);
    }
    return { seen, cursor };
  };
  const matching = VIDEOS.filter((video) => video.title.toLowerCase().includes(WORDS));
  for (const direction of ['newest', 'oldest']) {
    const { seen, cursor } = await walk(direction, innertube());
    same(cursor, null, `${direction}: the walk ends`);
    same(seen.map((item) => item.externalId).sort(), matching.map((video) => video.id).sort(), `${direction}: every matching upload once, none missed (the busy day read to its end), the non-matching one left out`);
    const times = seen.map((item) => item.publishedAt);
    ok(times.every((t, i) => i === 0 || (direction === 'newest' ? times[i - 1] >= t : times[i - 1] <= t)), `${direction}: in date order across every page`);
    ok(seen.every((item) => PT_DAY(item.publishedAt) === PT_DAY(VIDEOS.find((video) => video.id === item.externalId).time) || item.publishedAt.endsWith('T12:00:00.000Z')), `${direction}: each dated within its own day`);
  }
  ok(sent.length > 0 && sent.every((q) => { const w = /after:(\S+) before:(\S+)/.exec(q); return w && w[1] < w[2]; }), 'no empty window (after:D before:D answers everything) is ever sent');
  const recent = (await dates.datedSearch(WORDS, 'newest', null, { fetch: innertube(), now: () => NOW })).items;
  same(recent[0].publishedAt, at(2026, 11, 2, 18), 'an upload "N hours ago" keeps its time');
  same(recent.find((item) => item.externalId.startsWith('v07')).publishedAt, '2026-10-31T12:00:00.000Z', 'an older upload is dated midday of its day');
  const strays = [{ id: 'sstrayxxxxx', time: at(2026, 11, 2, 15), title: 'night of the living dead stray' }];
  const withStrays = await walk('oldest', innertube({ strays }));
  const stray = withStrays.seen.filter((item) => item.externalId === 'sstrayxxxxx');
  same(stray.length, 1, "a recent upload slipped into every window shows once, in its own day's place");
  same(PT_DAY(stray[0].publishedAt), '2026-11-02', '... dated its own day');
  same(withStrays.seen.length, matching.length + 1, '... and everything else is still found once');
  const strayTimes = withStrays.seen.map((item) => item.publishedAt);
  ok(strayTimes.every((t, i) => i === 0 || strayTimes[i - 1] <= t), '... still in date order');
  let refused = null;
  try {
    await dates.datedSearch(WORDS, 'oldest', null, { fetch: innertube({ ignore: true }), now: () => NOW });
  } catch (error) {
    refused = error.problem;
  }
  same(refused, "CAN'T SORT BY DATE", 'a YouTube that ignores the windows is refused, never shown in a wrong order');
  same(dates.narrower({ from: '2005-01-01', to: '2006-01-01' }, true).length, 8, 'a sparse year is cut in eight');
  same(dates.narrower({ from: '2005-01-01', to: '2006-01-01' }, false).length, 12, 'a full year is cut into months');
  same(dates.narrower({ from: '2005-02-01', to: '2005-03-01' }, false).length, 28, 'a full month into days');

  /* ---------------------------------------------------------------- KINO: every page, the vote floor, nothing leaks */
  const hit = (id, rating, votes, date) => ({ hit: { type: 'movie', tmdbId: id, title: `T${id}`, ...(date ? { date } : {}) }, rating, votes });
  const rated = [hit(1, 9.9, 3, '2001-01-01'), hit(2, 7.1, 900, '1968-10-04'), hit(3, 8.2, 60, '1990-10-19'), hit(4, 6.0, 5000), hit(5, 10, 1, '2020-01-01')];
  same(kino.orderKino(rated, 'popular', NOW.toISOString()).map((h) => h.tmdbId), [3, 2, 4, 5, 1], 'POPULAR: rating order, titles under 50 votes after the rest');
  same(kino.orderKino(rated, 'oldest', NOW.toISOString()).map((h) => h.tmdbId), [2, 3, 1, 5], 'DATE oldest by release date; an undated title has no place and is left out');
  same(kino.orderKino(rated, 'newest', NOW.toISOString()).map((h) => h.tmdbId), [5, 1, 3, 2], 'DATE newest the same, reversed');
  const tmdbAsked = [];
  const tmdb = async (url) => {
    const u = new URL(url);
    tmdbAsked.push(u.pathname + u.search);
    if (u.pathname === '/3/search/multi') {
      const page = Number(u.searchParams.get('page'));
      const results = [0, 1].map((n) => ({ media_type: 'movie', id: page * 10 + n, title: `Film ${page}-${n}`, release_date: `19${60 + page * 2 + n}-01-01`, vote_average: 7.77 + page / 100 + n / 1000, vote_count: page === 3 ? 10 : 400, popularity: 123.456 }));
      return new Response(JSON.stringify({ page, total_pages: 3, results }), { status: 200 });
    }
    return new Response(JSON.stringify({ title: 'Film', genres: [], vote_average: 9.99, vote_count: 99999, popularity: 77.7, release_date: '1999-09-09' }), { status: 200 });
  };
  const env = { TMDB_READ_TOKEN: 'token' };
  const sorted = await searchEverywhere(WORDS, null, [kino.kinoSearch], { fetch: tmdb, env, order: 'popular', now: () => NOW });
  same([1, 2, 3].every((page) => tmdbAsked.some((path) => path.includes(`/3/search/multi`) && path.includes(`page=${page}`))), true, 'KINO sorted: every page of the search is read');
  same(sorted.items.slice(0, 4).map((item) => item.media.tmdbId), [21, 20, 11, 10], 'KINO POPULAR across all pages, the 10-vote page last');
  const answer = JSON.stringify(sorted);
  ok(!/vote|rating|popular/i.test(answer.replace(/"order"/g, '')), 'no count or rating field reaches the answer');
  ok(!/7\.7|9\.99|123\.456|99999|77\.7/.test(answer), 'no count or rating value reaches the answer');
  const byDate = await searchEverywhere(WORDS, null, [kino.kinoSearch], { fetch: tmdb, env, order: 'oldest', now: () => NOW });
  same(byDate.items.map((item) => item.publishedAt.slice(0, 4)), ['1962', '1963', '1964', '1965', '1966', '1967'], 'KINO oldest, dated as ordered (not by its details\' date)');
  const route = readFileSync(join(ROOT, 'app/api/web/search/route.ts'), 'utf8');
  ok(/json\(\{ items, statuses, nextCursor: result\.nextCursor \}/.test(route), 'the route answers only items, statuses and the cursor');

  /* ---------------------------------------------------------------- sort: in the box and the address */
  same(filters.parseWebSearch('night sort:popular').sort, 'popular', 'sort:popular is read from the box');
  same(filters.parseWebSearch('night sort:oldest').text, 'night', '... and taken out of the words');
  same(filters.parseWebSearch('night sort:newest').sort, undefined, 'sort:newest is the default (no word)');
  same(filters.searchAddress(filters.parseWebSearch('night sort:popular')), '/archive?q=night&sort=popular', 'the address carries ?sort=popular');
  same(filters.searchAddress(filters.parseWebSearch('night sort:oldest')), '/archive?q=night&sort=date&dir=asc', 'oldest first is ?sort=date&dir=asc');
  same(filters.boxFromAddress(new URLSearchParams('q=night&sort=date&dir=asc')), 'night sort:oldest', 'the address back to the box');
  same(filters.boxFromAddress(new URLSearchParams('q=night&sort=best&dir=asc')), 'night sort:best', 'a flip on BEST MATCH means nothing');
  same(filters.withFilter('night in:youtube', 'sort', 'best'), 'night in:youtube sort:best', 'the SORT key writes the word, filters kept');
  same(filters.withFilter('night sort:best', 'sort', 'newest'), 'night', 'DATE newest clears it');
  same(sort.searchOrder(filters.sortOf({ sort: 'oldest' })), 'oldest', 'the box word becomes the order asked');
  same(sort.readSort('nonsense', 'asc'), { sort: 'date', dir: 'desc' }, 'an unknown sort in the address is the default');

  /* ---------------------------------------------------------------- the saved stream, oldest first */
  const mock = getMockWebRepository();
  const pages = async (oldestFirst) => {
    const out = [];
    let cursor = null;
    for (let n = 0; n < 50; n += 1) {
      const page = await mock.searchItems({ query: 'the', cursor, limit: 3, ...(oldestFirst ? { oldestFirst } : {}) });
      out.push(...page.items);
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    return out;
  };
  const newestFirst = await pages(false);
  const oldestFirst = await pages(true);
  ok(newestFirst.length > 3, 'the mock has a few pages to walk');
  same(ids(oldestFirst).sort(), ids(newestFirst).sort(), 'mock: oldest first has the same rows');
  ok(oldestFirst.every((r, i) => i === 0 || oldestFirst[i - 1].publishedAt <= r.publishedAt), 'mock: oldest first, across pages');

  const ROWS = Array.from({ length: 13 }, (_, i) => ({
    id: `internet_archive:item-${String.fromCharCode(97 + (i % 5))}${i}`,
    platform: 'internet_archive',
    external_id: `item-${String.fromCharCode(97 + (i % 5))}${i}`,
    kind: 'audio',
    url: 'https://archive.org/details/x',
    canonical_url: 'https://archive.org/details/x',
    title: `Night film ${i}`,
    creator: null,
    description: null,
    thumbnail_url: null,
    embed_url: null,
    license_url: null,
    duration_seconds: null,
    tags: null,
    published_at: new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 3))).toISOString().replace('.000Z', '+00:00'),
    fetched_at: '2026-10-31T12:00:00+00:00',
  }));
  const orders = [];
  const client = {
    from(table) {
      const q = { filters: [], orders: [], limit: null };
      const cmp = (column, x, y) => (column === 'published_at' ? Date.parse(x) - Date.parse(y) : x < y ? -1 : x > y ? 1 : 0);
      const builder = {
        select: () => builder,
        textSearch: (_c, text) => (q.filters.push((r) => r.title.toLowerCase().includes(text.split(' ')[0])), builder),
        or: () => builder,
        regexIMatch: () => builder,
        in: (column, values) => (q.filters.push((r) => values.includes(r[column])), builder),
        eq: (column, value) => (q.filters.push((r) => cmp(column, r[column], value) === 0), builder),
        lt: (column, value) => (q.filters.push((r) => cmp(column, r[column], value) < 0), builder),
        gt: (column, value) => (q.filters.push((r) => cmp(column, r[column], value) > 0), builder),
        order: (column, { ascending }) => (q.orders.push([column, ascending]), orders.push([table, column, ascending]), builder),
        limit: (n) => ((q.limit = n), builder),
        then(resolve) {
          const rows = (table === 'web_items' ? ROWS : []).filter((r) => q.filters.every((f) => f(r)));
          rows.sort((x, y) => {
            for (const [column, ascending] of q.orders) {
              const d = cmp(column, x[column], y[column]);
              if (d !== 0) return ascending ? d : -d;
            }
            return 0;
          });
          resolve({ data: rows.slice(0, q.limit), error: null });
        },
      };
      return builder;
    },
  };
  const repo = createSupabaseWebRepository(() => client);
  for (const size of [1, 2, 4, 5]) {
    const walked = [];
    let cursor = null;
    for (let n = 0; n < 40; n += 1) {
      const page = await repo.searchItems({ query: 'night', cursor, limit: size, oldestFirst: true });
      walked.push(...page.items);
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    same(walked.length, ROWS.length, `Supabase oldest first, pages of ${size}: every row once`);
    ok(walked.every((r, i) => i === 0 || walked[i - 1].publishedAt < r.publishedAt || (walked[i - 1].publishedAt === r.publishedAt && walked[i - 1].id < r.id)), `Supabase oldest first, pages of ${size}: published_at then id ascending, ties included`);
  }
  ok(orders.some(([table, column, ascending]) => table === 'web_items' && column === 'published_at' && ascending === true), 'the Supabase read really asks for ascending');

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
