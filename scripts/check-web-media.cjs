/*
 * WEB media servers (SPEC-media-servers.md), offline; run by `npm run checks:web`:
 *   npx tsc app/lib/web/media-titles.ts app/lib/web/media-merge.ts app/lib/web/web-filters.ts app/lib/web/hosts.ts app/lib/web/row-addresses.ts app/lib/web/mock-media-titles.ts --outDir Temp/out-web-media --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the list file, in the friend's real shape: films and episodes read; numbers as strings or numbers; a show
 *   entry without season and episode, a title-less or id-less entry, and anything not an array dropped;
 *   `provider` never decides the server; text sanitised; a picture off the server's own host DROPPED
 * - one title on two servers is ONE item with both servers (and each server's own episodes); a title with no
 *   TMDB number never merges across servers
 * - play addresses: built from the server's patterns with checked numbers, on the server's own host, only for
 *   a server that holds that very episode
 * - the merge with the stream: newest first, one cursor, no row lost or shown twice across pages
 * - a new server in media-servers.ts is offered as a SOURCE choice by itself: a copy of the code with a fake
 *   server added is compiled and asked
 * - the rules above run against a copy of the code with two FIXED test servers (web-media-test-servers.cjs), so
 *   Luke's own list (rewritten by the Debaser Servers program) never changes what they test; his real list is
 *   checked on its own: ids, labels and addresses well formed and unique, every player pattern on its own host
 */
const { join } = require('node:path');
const { makeAsserts } = require('./web-search-check-kit.cjs');
const { compileWithTestServers } = require('./web-media-test-servers.cjs');

const ROOT = join(__dirname, '..');
const ENTRIES = ['lib/web/media-titles.ts', 'lib/web/media-merge.ts', 'lib/web/media-collections.ts', 'lib/web/web-filters.ts', 'lib/web/row-addresses.ts', 'lib/web/mock-media-titles.ts', 'lib/web/mock-web-repository.ts', 'lib/web/paging.ts'];
const OUT = join(compileWithTestServers('out-web-media-fixed', ENTRIES), 'lib', 'web');
const m = require(join(OUT, 'media-titles.js'));
const merge = require(join(OUT, 'media-merge.js'));
const filters = require(join(OUT, 'web-filters.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const { MOCK_MEDIA_ITEMS } = require(join(OUT, 'mock-media-titles.js'));
// Luke's real list, as the header's compile built it from app/.
const REAL = join(ROOT, 'Temp', 'out-web-media', 'lib', 'web');
const asserts = makeAsserts('WEB media servers');
const { ok, same } = asserts;

const NOW = '2026-11-01T12:00:00.000Z';
const S1 = { id: 'server_1', base: 'https://placeholder-server1.xyz', play: { movie: '/debaser/play/movie/{tmdb}', tv: '/debaser/play/tv/{tmdb}/{season}/{episode}', other: '/debaser/play/item/{id}' } };
const S2 = { ...S1, id: 'server_2', base: 'https://placeholder-server2.xyz' };

/* ---------------------------------------------------------------- the list file */
// The friend's sample, exactly as sent (2026-11-01).
const SAMPLE = [
  { title: 'Example Movie', type: 'movie', tmdb_id: '157336', provider: 'friends_server' },
  { title: 'Example TV Show', type: 'tv', tmdb_id: '1399', season: '1', episode: '1', provider: 'friends_server' },
];
const sample = m.parseList(SAMPLE, 'server_1', NOW);
same(
  sample.map((entry) => [entry.key, entry.type, entry.tmdbId, entry.title, entry.season, entry.episode]),
  [
    ['tmdb-movie-157336', 'movie', 157336, 'Example Movie', undefined, undefined],
    ['tmdb-tv-1399', 'tv', 1399, 'Example TV Show', 1, 1],
  ],
  'the friend\'s sample: a film and an episode, numbers read from strings',
);
ok(sample.every((entry) => entry.server === 'server_1' && !('provider' in entry)), 'the server is the list it came from; `provider` is never read');
same(m.parseList([{ title: 'N', type: 'movie', tmdb_id: 603 }], 'server_1', NOW)[0].tmdbId, 603, 'a TMDB number may also be a number');

const hostile = m.parseList(
  [
    // (A show with neither season nor episode is a whole show now: held below.)
    { title: 'Show with one number', type: 'tv', tmdb_id: '1399', season: '1' },
    { title: 'Whole show, no number', type: 'tv' },
    { title: '', type: 'movie', tmdb_id: '1' },
    { type: 'movie', tmdb_id: '2' },
    { title: 'No number, no id', type: 'movie' },
    { title: 'Bad number', type: 'movie', tmdb_id: '12a' },
    { title: 'Negative', type: 'movie', tmdb_id: '-5' },
    { title: 'Bad id', type: 'movie', id: '../etc/passwd' },
    'a string',
    null,
    [1, 2],
  ],
  'server_1',
  NOW,
);
same(hostile, [], 'unusable entries are dropped: a season without an episode, a whole show with no number, no title, no number or id, bad numbers, bad ids, non-objects');

/* ---------------------------------------------------------------- whole shows (the WHOLE SERIES player) */
const wholeOnly = m.groupTitles(m.parseList([{ title: 'Whole', type: 'tv', tmdb_id: '1399' }], 'server_1', NOW));
same(wholeOnly.map((t) => [t.key, t.copies]), [['tmdb-tv-1399', [{ server: 'server_1', series: true, episodes: [] }]]], 'a show with neither season nor episode is kept: the server holds the whole show');
const S1x = { id: 'server_1', base: 'https://placeholder-server1.xyz', play: { movie: '/m/{tmdb}', tv: '/t/{tmdb}/{season}/{episode}', series: '/debaser/play/tv/{tmdb}' } };
const S2x = { ...S1x, id: 'server_2', base: 'https://placeholder-server2.xyz', play: { movie: '/m/{tmdb}', tv: '/t/{tmdb}/{season}/{episode}' } };
const mixed = { type: 'tv', tmdbId: 1399, copies: [{ server: 'server_1', series: true, episodes: [] }, { server: 'server_2', episodes: [[1, 1]] }] };
same(m.mediaPlayUrl(S1x, mixed, { whole: true }), 'https://placeholder-server1.xyz/debaser/play/tv/1399', 'WHOLE SERIES uses the server\'s series player, with the number only');
same(m.mediaPlayUrl(S2x, mixed, { whole: true }), null, 'a server with no series player cannot play the whole series');
same(m.mediaPlayUrl(S1x, mixed, { season: 1, episode: 1 }), null, 'a server listing only the whole show holds no single episode');
same(m.mediaPlayUrl({ ...S2x, play: { ...S2x.play, series: '/s/{tmdb}' } }, mixed, { whole: true }), 'https://placeholder-server2.xyz/s/1399', 'a server holding some episodes can play the whole series, given a series player');
same(m.mediaPlayUrl({ ...S1x, play: { ...S1x.play, series: 'https://evil.example/{tmdb}' } }, mixed, { whole: true }), null, 'a series pattern off the server\'s host is refused');
same(m.parseList({ items: SAMPLE }, 'server_1', NOW), [], 'a list that is not an array reads as nothing');
same(m.parseList('<html>error</html>', 'server_1', NOW), [], 'an error page reads as nothing');

const own = m.parseList(
  [
    {
      title: '<b>Home</b> video &amp; more',
      type: 'movie',
      id: 'home-1',
      creator: '<i>Friend</i>',
      description: '<script>x()</script>Plain words',
      date: '2026-10-12',
      duration: '754',
      thumbnail: 'https://placeholder-server1.xyz/pictures/home-1.jpg',
    },
    { title: 'Off host', type: 'movie', id: 'home-2', thumbnail: 'https://evil.example/pictures/home-2.jpg' },
    { title: 'Lookalike host', type: 'movie', id: 'home-3', thumbnail: 'https://placeholder-server1.xyz.evil.example/a.jpg' },
    { title: 'Plain http', type: 'movie', id: 'home-4', thumbnail: 'http://placeholder-server1.xyz/a.jpg' },
    { title: 'With query', type: 'movie', id: 'home-5', thumbnail: 'https://placeholder-server1.xyz/a.jpg?x=1' },
    { title: 'Climbs out', type: 'movie', id: 'home-6', thumbnail: 'https://placeholder-server1.xyz/a/../../b.jpg' },
    { title: 'Other port', type: 'movie', id: 'home-7', thumbnail: 'https://placeholder-server1.xyz:8443/a.jpg' },
    { title: 'Another server', type: 'movie', id: 'home-8', thumbnail: 'https://placeholder-server2.xyz/a.jpg' },
  ],
  'server_1',
  NOW,
);
same(own[0].title, 'Home video & more', 'titles are sanitised (HTML stripped, entities decoded)');
same([own[0].creator, own[0].description], ['Friend', 'Plain words'], 'creator and description sanitised; a script\'s text is gone');
same([own[0].key, own[0].localId, own[0].durationSeconds, own[0].date], ['server_1-home-1', 'home-1', 754, '2026-10-12T00:00:00.000Z'], 'the list\'s own id, duration and date');
same(own[0].thumbnailUrl, 'https://placeholder-server1.xyz/pictures/home-1.jpg', 'a picture on the server\'s own host is kept');
same(own.slice(1).map((entry) => entry.thumbnailUrl), [undefined, undefined, undefined, undefined, undefined, undefined, undefined], 'off-host, lookalike, http, query, .., other port and another server\'s pictures are DROPPED');

/* ---------------------------------------------------------------- one title on two servers */
const titles = m.groupTitles([
  ...m.parseList(
    [
      { title: 'Film', type: 'movie', tmdb_id: '157336' },
      { title: 'Show', type: 'tv', tmdb_id: '1399', season: '1', episode: '1' },
      { title: 'Show', type: 'tv', tmdb_id: '1399', season: '1', episode: '2' },
      { title: 'Show', type: 'tv', tmdb_id: '1399', season: '2', episode: '1' },
      { title: 'Show', type: 'tv', tmdb_id: '1399', season: '1', episode: '1' },
      { title: 'Home', type: 'movie', id: 'same-id' },
    ],
    'server_1',
    NOW,
  ),
  ...m.parseList(
    [
      { title: 'Film (second spelling)', type: 'movie', tmdb_id: '157336' },
      { title: 'Show', type: 'tv', tmdb_id: '1399', season: '1', episode: '1' },
      { title: 'Home', type: 'movie', id: 'same-id' },
    ],
    'server_2',
    NOW,
  ),
]);
same(titles.length, 4, 'film, show, and the two home videos: four titles');
const film = titles.find((title) => title.key === 'tmdb-movie-157336');
same(film.copies.map((copy) => copy.server), ['server_1', 'server_2'], 'ONE film with both servers');
same(film.title, 'Film', 'its words come from the first server listing it');
const show = titles.find((title) => title.key === 'tmdb-tv-1399');
same(
  show.copies.map((copy) => [copy.server, copy.episodes]),
  [
    ['server_1', [[1, 1], [1, 2], [2, 1]]],
    ['server_2', [[1, 1]]],
  ],
  'ONE show; each server keeps its own episodes (once each, in order)',
);
same(titles.filter((title) => title.title === 'Home').map((title) => title.id), ['media:server_1-same-id', 'media:server_2-same-id'], 'no TMDB number: never merged across servers, even with the same id');
same([...m.heldEpisodes(show).entries()], [[1, [1, 2]], [2, [1]]], 'the pickers offer every episode any server holds');

/* ---------------------------------------------------------------- play addresses */
const filmInfo = { type: 'movie', tmdbId: 157336, copies: film.copies };
same(m.mediaPlayUrl(S1, filmInfo), 'https://placeholder-server1.xyz/debaser/play/movie/157336', 'a film on server 1');
same(m.mediaPlayUrl(S2, filmInfo), 'https://placeholder-server2.xyz/debaser/play/movie/157336', 'the same film on server 2');
const showInfo = { type: 'tv', tmdbId: 1399, copies: show.copies };
same(m.mediaPlayUrl(S1, showInfo, { season: 2, episode: 1 }), 'https://placeholder-server1.xyz/debaser/play/tv/1399/2/1', 'an episode server 1 holds');
same(m.mediaPlayUrl(S2, showInfo, { season: 2, episode: 1 }), null, 'server 2 does not hold S2E1: no address');
same(m.mediaPlayUrl(S1, showInfo, {}), null, 'a show needs a season and an episode');
same(m.mediaPlayUrl({ ...S1, id: 'server_9' }, filmInfo), null, 'a server with no copy: no address');
const homeInfo = { type: 'movie', copies: [{ server: 'server_1', localId: 'same-id' }] };
same(m.mediaPlayUrl(S1, homeInfo), 'https://placeholder-server1.xyz/debaser/play/item/same-id', 'a server\'s own video by its own id');
same(m.mediaPlayUrl({ ...S1, play: { ...S1.play, other: undefined } }, homeInfo), null, 'no pattern for own videos: no address');
same(m.mediaPlayUrl({ ...S1, play: { ...S1.play, movie: 'https://evil.example/{tmdb}' } }, filmInfo), null, 'a pattern pointing off the server\'s host is refused');
same(m.mediaPlayUrl(S1, { type: 'movie', copies: [{ server: 'server_1', localId: '../x' }] }), null, 'an unsafe id never reaches an address');

/* ---------------------------------------------------------------- rows and pictures */
const item = m.titleToItem(film, { publishedAt: NOW, fetchedAt: NOW }, { title: 'TMDB Title', overview: 'From TMDB', posterPath: '/abcdefgh1234.jpg', runtimeMinutes: 169, genres: ['Drama'] });
same([item.id, item.platform, item.title, item.description, item.durationSeconds], ['media:tmdb-movie-157336', 'server_1', 'TMDB Title', 'From TMDB', 169 * 60], 'TMDB\'s details win over the list\'s words');
same(item.thumbnailUrl, 'https://image.tmdb.org/t/p/w342/abcdefgh1234.jpg', 'the poster is hotlinked from TMDB\'s image host');
same(rowAddresses(item).thumb, item.thumbnailUrl, 'and the page draws it');
same(rowAddresses(item).link, null, 'a title row draws no link of its own');
same(rowAddresses(item).embed, null, 'nor an embed: players are built per server');
same(m.posterUrl('/../../evil.jpg'), undefined, 'a poster name TMDB would not write is refused');
ok(!JSON.stringify(item).match(/vote|popularity|rating/i), 'no rating, vote count or popularity anywhere on a row');

/* ---------------------------------------------------------------- the merge with the stream */
const at = (n) => `2026-10-${String(n).padStart(2, '0')}T00:00:00.000Z`;
const web = (n) => ({ id: `internet_archive:w${n}`, publishedAt: at(n), alsoOn: [] });
const med = (n) => ({ id: `media:m${n}`, publishedAt: at(n) });
const streamAll = [web(30), web(26), web(20), web(12), web(3)];
const mediaAll = [med(28), med(25), med(19), med(2)];
const { pageOf } = require(join(OUT, 'paging.js'));
const seen = [];
let cursor = null;
for (let pages = 0; pages < 10; pages += 1) {
  const s = pageOf(streamAll, cursor, 3);
  const page = merge.mergeStreamPages({ items: s.items.map((row) => ({ ...row, alsoOn: [] })), nextCursor: s.nextCursor }, pageOf(mediaAll, cursor, 3), 3);
  seen.push(...page.items.map((row) => row.id));
  if (page.nextCursor === null) break;
  cursor = page.nextCursor;
}
same(
  seen,
  ['internet_archive:w30', 'media:m28', 'internet_archive:w26', 'media:m25', 'internet_archive:w20', 'media:m19', 'internet_archive:w12', 'internet_archive:w3', 'media:m2'],
  'stream and media titles in one order across pages: every row once, none lost',
);

/* ---------------------------------------------------------------- film series (TMDB collections) */
const col = require(join(OUT, 'media-collections.js'));
const seriesFilm = (n, day, collection) => ({
  id: `media:tmdb-movie-${n}`,
  publishedAt: at(day),
  title: `Film ${n}`,
  media: { type: 'movie', tmdbId: n, copies: [{ server: n % 2 ? 'server_1' : 'server_2' }], details: { title: `Film ${n}`, date: `${2000 + (n % 10)}-01-01`, genres: [], ...(collection ? { collection: { id: collection, name: `Series ${collection}`, posterPath: '/abcdefgh1234.jpg' } } : {}) } },
});
// Three films of series 7 (days 29, 22, 5), two of series 8 (27, 4), one alone (15).
const films = [seriesFilm(1, 29, 7), seriesFilm(2, 27, 8), seriesFilm(3, 22, 7), seriesFilm(4, 15), seriesFilm(5, 5, 7), seriesFilm(6, 4, 8)].sort(compareByStream);
function compareByStream(a, b) { return a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : a.id < b.id ? 1 : -1; }
async function seriesPaging() {
  const rowsSeen = [];
  const filmsSeen = [];
  let cur = null;
  for (let pages = 0; pages < 10; pages += 1) {
    // Pages of 2, so a series' films are spread over several pages.
    const page = await col.readMediaPage(async (after) => pageOf(films, after, 2), async (ids) => films.filter((f) => ids.includes(f.media.details.collection?.id)), cur);
    for (const row of page.items) {
      rowsSeen.push(row.title);
      filmsSeen.push(...(row.media.parts ?? [row]).map((p) => p.id));
    }
    if (page.nextCursor === null) break;
    cur = page.nextCursor;
  }
  same(rowsSeen, ['Series 7', 'Series 8', 'Film 4'], 'films of one TMDB collection are ONE row each, at the newest film\'s place; across pages no series is shown twice');
  same(filmsSeen.slice().sort(), films.map((f) => f.id).sort(), 'every film is on exactly one row');

  // Searching a series' name finds it, though none of its films' titles has those words (Luke, 2026-11-01).
  const { getMockWebRepository } = require(join(OUT, 'mock-web-repository.js'));
  const found = await getMockWebRepository().searchItems({ query: 'fake collection', limit: 20 });
  const seriesFound = found.items.find((r) => r.title === 'MOCK FILM SERIES (a fake collection)');
  same(seriesFound ? seriesFound.media.parts.length : 0, 2, 'searching "fake collection" finds the series row, with both its films');
  const byFilm = await getMockWebRepository().searchItems({ query: 'part two', limit: 20 });
  ok(byFilm.items.some((r) => r.title === 'MOCK SERIES FILM 06: part two'), 'and searching one film\'s own title finds that film (alone, so as a plain row)');
}
const seriesRow = col.collapseCollections([films[0]], films)[0];
same(seriesRow.media.parts.map((p) => p.id), ['media:tmdb-movie-1', 'media:tmdb-movie-3', 'media:tmdb-movie-5'], 'its films are in release order');
same(seriesRow.media.copies.map((c) => c.server).sort(), ['server_1'], 'its SERVER buttons are every server holding any of its films');
same(seriesRow.thumbnailUrl, 'https://image.tmdb.org/t/p/w342/abcdefgh1234.jpg', 'it shows the collection\'s poster');
same(col.collapseCollections([films[1]], [films[1]]).map((r) => r.title), ['Film 2'], 'a collection with one film on the servers stays a plain film row');

/* ---------------------------------------------------------------- the mock */
const mockFilm = MOCK_MEDIA_ITEMS.find((row) => row.id === 'media:tmdb-movie-999999901');
same(mockFilm.media.copies.map((copy) => copy.server), ['server_1', 'server_2'], 'the mock: one title shared by both fake servers');
ok(MOCK_MEDIA_ITEMS.every((row) => /MOCK/.test(row.title)), 'every mock title says MOCK');

/* ---------------------------------------------------------------- the SOURCE choices */
same(
  filters.SOURCE_OPTIONS.filter((option) => /^server_/.test(option.value)).map((option) => [option.value, option.label]),
  [['server_1', 'SERVER 1'], ['server_2', 'SERVER 2']],
  'each listed server is a SOURCE choice',
);
same(filters.parseWebSearch('in:server-2 film').source, 'server_2', '`in:server-2` reads as that server');
same(filters.sourcesToAsk({ source: 'server_2', type: 'all' }), { stream: true, live: [] }, 'a server is read with the stream, never asked live');
ok(filters.matchesFilters(mockFilm, { source: 'server_2', type: 'all' }, true), 'in:server-2 keeps a title server 2 holds, though its row is filed under server 1');
ok(!filters.matchesFilters(MOCK_MEDIA_ITEMS.find((row) => row.id === 'media:tmdb-movie-999999904'), { source: 'server_2', type: 'all' }, true), 'and drops one only server 1 holds');

// A fake server added to a copy of media-servers.ts: compiled and asked, so "adding a server adds its choice" is
// what the code does, not what a comment says.
const FAKE_LINE = "  { id: 'fake_server', label: 'FAKE SERVER', base: 'https://fake.example', listPath: '/l.json', play: { movie: '/m/{tmdb}', tv: '/t/{tmdb}/{season}/{episode}' } },";
const fakeFilters = require(join(compileWithTestServers('out-web-media-fake', ['lib/web/web-filters.ts'], [FAKE_LINE]), 'lib', 'web', 'web-filters.js'));
ok(fakeFilters.SOURCE_OPTIONS.some((option) => option.value === 'fake_server' && option.label === 'FAKE SERVER'), 'a server added to media-servers.ts is offered as a SOURCE choice by itself');
same(fakeFilters.parseWebSearch('in:fake-server x').source, 'fake_server', 'and `in:fake-server` finds it');
ok(fakeFilters.suggestFilterValues('in', 'fake').some((option) => option.word === 'fake-server'), 'and the suggestion list offers it');

/* ---------------------------------------------------------------- Luke's real list */
// What the Debaser Servers program (or a hand edit) saved: a mistake here stops `npm run verify`, so it never
// reaches the site.
const real = require(join(REAL, 'media-servers.js'));
const realTitles = require(join(REAL, 'media-titles.js'));
const realFilters = require(join(REAL, 'web-filters.js'));
const list = real.MEDIA_SERVERS;
ok(list.length >= 1, 'at least one server is listed (the site needs one)');
same(new Set(list.map((s) => s.id)).size, list.length, 'every server id is different');
same(new Set(list.map((s) => s.label)).size, list.length, 'every server name is different');
for (const s of list) {
  ok(/^[a-z][a-z0-9_]{0,40}$/.test(s.id), `${s.id}: id is lowercase letters, digits and _`);
  ok(/^[A-Z0-9][A-Z0-9 ._-]{0,29}$/.test(s.label), `${s.id}: name "${s.label}" is capitals, digits and spaces, 30 at most`);
  let url = null;
  try { url = new URL(s.base); } catch { /* reported below */ }
  ok(url !== null && url.protocol === 'https:' && url.origin === s.base && url.port === '', `${s.id}: address "${s.base}" is https and nothing after the host`);
  ok(/^\/(?!.*\.\.)[A-Za-z0-9._~/-]{1,200}$/.test(s.listPath), `${s.id}: list file path "${s.listPath}" is a plain path`);
  const film = realTitles.mediaPlayUrl(s, { type: 'movie', tmdbId: 157336, copies: [{ server: s.id }] });
  ok(film !== null, `${s.id}: its film pattern makes an address on its own host`);
  const episode = realTitles.mediaPlayUrl(s, { type: 'tv', tmdbId: 1399, copies: [{ server: s.id, episodes: [[1, 2]] }] }, { season: 1, episode: 2 });
  ok(episode !== null && episode.includes('1399') && /\/1\/2(?:$|[/?])/.test(episode), `${s.id}: its show pattern makes an address with the number, season and episode`);
  if (s.play.other !== undefined) ok(realTitles.mediaPlayUrl(s, { type: 'movie', copies: [{ server: s.id, localId: 'abc' }] }) !== null, `${s.id}: its own-video pattern makes an address on its own host`);
  ok(realFilters.SOURCE_OPTIONS.some((option) => option.value === s.id && option.label === s.label), `${s.id}: offered as a SOURCE choice`);
  if (s.play.series !== undefined) {
    const whole = realTitles.mediaPlayUrl(s, { type: 'tv', tmdbId: 1399, copies: [{ server: s.id, series: true, episodes: [] }] }, { whole: true });
    ok(whole !== null && whole.includes('1399'), `${s.id}: its whole-series pattern makes an address with the number, on its own host`);
  }
}

seriesPaging().then(() => asserts.done(), (error) => {
  console.error(error);
  process.exit(1);
});
