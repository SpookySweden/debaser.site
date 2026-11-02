/*
 * WEB: KINO, VIBE, years in the words, and a show's seasons from TMDB, offline (Luke, 2026-11-02; run by `npm run checks:web`):
 *   npx tsc app/lib/web/search/providers/kino.ts app/lib/web/search/providers/internet-archive.ts app/lib/web/live-merge.ts app/lib/web/row-addresses.ts app/lib/web/media-titles.ts --outDir Temp/out-web-kino --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - a year in the words is found case by case: never alone, never a future number (2049), the last one typed
 * - VIBE turns words into TMDB genres, a decade and keywords; shows are skipped for a genre they lack (horror)
 * - KINO asks api.themoviedb.org only, with the token as a header and never in an address; no token: NOT SET UP
 * - a year: titles made that year first, then titles with the number in them; each title once
 * - every KINO row has TMDB's seasons and episode counts, a TMDB page link and poster that pass the row check, and no
 *   rating, vote or popularity anywhere in it
 * - the Internet Archive reads a year as `year:` beside the title words, and VIBE as subject/description words
 * - a media server's playable row takes the place of the same title's KINO row, without moving it
 * - a show listed as a whole on a server is offered every episode TMDB lists (the season 1 episode 1 bug)
 */
const { join } = require('node:path');
const { makeAsserts } = require('./web-search-check-kit.cjs');

const OUT = join(__dirname, '..', 'Temp', 'out-web-kino', 'lib', 'web');
const intent = require(join(OUT, 'search-intent.js'));
const { kinoSearch } = require(join(OUT, 'search', 'providers', 'kino.js'));
const ia = require(join(OUT, 'search', 'providers', 'internet-archive.js'));
const merge = require(join(OUT, 'live-merge.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const titles = require(join(OUT, 'media-titles.js'));
const asserts = makeAsserts('WEB KINO, VIBE and years');
const { ok, same } = asserts;

const NOW = new Date('2026-11-02T12:00:00.000Z');

/* ---------------------------------------------------------------- years */
same(intent.splitYear('alien 1979', NOW), { words: 'alien', year: 1979 }, 'a year beside other words is a year');
same(intent.splitYear('1917', NOW), { words: '1917', year: null }, 'a year alone is just a word');
same(intent.splitYear('blade runner 2049', NOW), { words: 'blade runner 2049', year: null }, 'a number past next year is never a year');
same(intent.splitYear('1984 film 1956', NOW), { words: '1984 film', year: 1956 }, 'the last year typed is the one read');
same(intent.splitYear('apollo 13', NOW), { words: 'apollo 13', year: null }, 'a small number is not a year');
same(intent.splitYear('train 1879', NOW).year, null, 'before film, not a year');

/* ---------------------------------------------------------------- VIBE */
const horror80s = intent.vibePlan('80s horror', NOW);
same([horror80s.movieGenres, horror80s.from, horror80s.to, horror80s.skipTv, horror80s.keywords], [[27], '1980-01-01', '1989-12-31', true, []], '"80s horror": horror films of the 1980s, no shows (TMDB has no horror genre for shows)');
same(intent.vibePlan('cosy rain', NOW).keywords, ['cosy', 'rain'], 'other words are left for TMDB keywords');
same(intent.vibePlan('sci fi nineties', NOW).movieGenres, [878], '"sci fi" is one genre');
same(intent.vibePlan('sci fi nineties', NOW).from, '1990-01-01', 'a decade word');
same(intent.decadeOf('20s', NOW), 2020, '"20s" is the 2020s now they have begun');
same(intent.decadeOf('1960s', NOW), 1960, '"1960s"');
ok(intent.vibePlan('the film', NOW).empty, 'words that name nothing leave the plan empty (the plain search is used)');

/* ---------------------------------------------------------------- KINO, with a fake TMDB */
const MULTI = {
  total_pages: 3,
  results: [
    { media_type: 'tv', id: 57243, name: 'Doctor Who', first_air_date: '2005-03-26', poster_path: '/abcdefgh1234.jpg', vote_average: 9, popularity: 99 },
    { media_type: 'movie', id: 348, title: 'Alien', release_date: '1979-05-25', poster_path: '/alienposter1.jpg', vote_count: 5 },
    { media_type: 'person', id: 1, name: 'Somebody' },
  ],
};
const DETAILS = {
  57243: { name: 'Doctor Who', first_air_date: '2005-03-26', overview: 'A <b>time</b> traveller.', genres: [{ name: 'Sci-Fi & Fantasy' }], poster_path: '/abcdefgh1234.jpg', vote_average: 9, seasons: [{ season_number: 0, episode_count: 40 }, { season_number: 1, episode_count: 13 }, { season_number: 2, episode_count: 14 }] },
  348: { title: 'Alien', release_date: '1979-05-25', runtime: 117, genres: [{ name: 'Horror' }], poster_path: '/alienposter1.jpg', popularity: 50 },
};
function tmdbFake() {
  const asked = [];
  const fetch = async (url, init) => {
    asked.push({ url, auth: init?.headers?.Authorization });
    const u = new URL(url);
    if (u.pathname === '/3/search/multi') return new Response(JSON.stringify(MULTI));
    if (u.pathname === '/3/search/keyword') return new Response(JSON.stringify({ results: [{ id: 9663, name: 'sequel' }] }));
    if (u.pathname.startsWith('/3/discover/')) return new Response(JSON.stringify({ total_pages: 1, results: [{ id: u.pathname.endsWith('tv') ? 57243 : 348, name: 'Doctor Who', title: 'Alien' }] }));
    const id = u.pathname.split('/').pop();
    return DETAILS[id] ? new Response(JSON.stringify(DETAILS[id])) : new Response('{}', { status: 404 });
  };
  return { asked, fetch };
}

(async () => {
  let problem = null;
  try {
    await kinoSearch.search('alien', null, { fetch: async () => new Response('{}'), env: {} });
  } catch (error) {
    problem = error.problem;
  }
  same(problem, 'NOT SET UP', 'no TMDB token: KINO says NOT SET UP');

  const plain = tmdbFake();
  const page = await kinoSearch.search('doctor who', null, { fetch: plain.fetch, env: { TMDB_READ_TOKEN: 'test-token' }, now: () => NOW });
  ok(plain.asked.every((call) => new URL(call.url).hostname === 'api.themoviedb.org'), 'KINO asks api.themoviedb.org only');
  ok(plain.asked.every((call) => call.auth === 'Bearer test-token' && !call.url.includes('test-token')), 'the token goes in a header, never in an address');
  same(page.items.map((item) => item.id), ['media:tmdb-tv-57243', 'media:tmdb-movie-348'], 'films and shows only (a person is dropped), each with the media title id');
  same(page.next, 2, 'LOAD MORE asks the next page');
  const show = page.items[0];
  same(show.media.details.seasons, [{ season: 0, episodes: 40 }, { season: 1, episodes: 13 }, { season: 2, episodes: 14 }], 'a show carries every season TMDB lists');
  same(show.media.copies, [], 'a KINO row has no player of its own');
  same(show.platform, 'kino', 'filed under KINO');
  ok(!/<[a-z/]/i.test(show.description), 'markup is stripped from TMDB text');
  ok(!/vote|popularity|rating/i.test(JSON.stringify(page.items)), 'no rating, vote or popularity anywhere in a KINO row');
  const addresses = rowAddresses(show);
  same([addresses.link, addresses.thumb, addresses.embed], ['https://www.themoviedb.org/tv/57243', 'https://image.tmdb.org/t/p/w342/abcdefgh1234.jpg', null], 'the TMDB page and poster pass the row check; no player');
  same((await kinoSearch.search('alien', null, { fetch: plain.fetch, env: { TMDB_READ_TOKEN: 't' }, now: () => NOW }, undefined, 'audio')).items, [], 'TYPE audio finds nothing in KINO');

  const yearly = tmdbFake();
  const byYear = await kinoSearch.search('alien 1979', null, { fetch: yearly.fetch, env: { TMDB_READ_TOKEN: 't' }, now: () => NOW });
  const queries = yearly.asked.filter((call) => call.url.includes('/search/multi')).map((call) => new URL(call.url).searchParams.get('query')).sort();
  same(queries, ['alien', 'alien 1979'], 'a year is asked both ways: as the date, and as a word');
  same(byYear.items[0].id, 'media:tmdb-movie-348', 'the title made that year comes first');
  same(new Set(byYear.items.map((item) => item.id)).size, byYear.items.length, 'each title once');

  const vibe = tmdbFake();
  await kinoSearch.search('80s horror', null, { fetch: vibe.fetch, env: { TMDB_READ_TOKEN: 't' }, now: () => NOW, vibe: true });
  const discover = vibe.asked.filter((call) => call.url.includes('/discover/')).map((call) => new URL(call.url));
  same(discover.map((u) => u.pathname), ['/3/discover/movie'], 'VIBE "80s horror" asks the films list only');
  same([discover[0].searchParams.get('with_genres'), discover[0].searchParams.get('primary_release_date.gte'), discover[0].searchParams.get('primary_release_date.lte')], ['27', '1980-01-01', '1989-12-31'], 'horror, 1980 to 1989');

  const tagged = tmdbFake();
  const byKeyword = await kinoSearch.search('', null, { fetch: tagged.fetch, env: { TMDB_READ_TOKEN: 't' }, now: () => NOW, keyword: 9663 });
  ok(tagged.asked.filter((call) => call.url.includes('/discover/')).every((call) => new URL(call.url).searchParams.get('with_keywords') === '9663'), 'a related keyword asks the titles tagged with it');
  same(byKeyword.items.length, 2, 'films and shows tagged with it');

  /* -------------------------------------------------------------- the Internet Archive */
  same(ia.iaSearchQuery('alien 1979', '', undefined, { now: NOW }).split(' AND mediatype')[0], '(title:(alien AND 1979) OR (title:(alien) AND year:1979))', 'the Archive: the number in the title, or the other words made that year');
  same(ia.iaSearchQuery('cosy rain', '', undefined, { vibe: true }).split(' AND mediatype')[0], '(subject:(cosy OR rain) OR description:(cosy OR rain) OR title:(cosy OR rain))', 'VIBE in the Archive: any word, in its subject tags, description or title');
  same(ia.iaSearchQuery('night of the dead').split(' AND mediatype')[0], 'title:(night AND of AND the AND dead)', 'plain words are unchanged');

  /* -------------------------------------------------------------- a playable row takes the KINO row's place */
  const kinoRow = { ...show, alsoOn: [] };
  const other = { id: 'youtube:x', platform: 'youtube', publishedAt: '2000-01-01T00:00:00.000Z', alsoOn: [] };
  const serverRow = { ...show, platform: 'server_1', media: { ...show.media, copies: [{ server: 'server_1', episodes: [[1, 1]] }] }, alsoOn: [] };
  let list = merge.arrive(merge.EMPTY_LIVE, [kinoRow, other]);
  const at = list.shown.findIndex((row) => row.id === show.id);
  list = merge.arrive(list, [serverRow]);
  same([list.shown.length, list.shown[at].platform], [2, 'server_1'], 'the server row replaces the KINO row in its place');
  list = merge.arrive(list, [kinoRow]);
  same(list.shown[at].platform, 'server_1', 'and a later KINO row never replaces a playable one');

  /* -------------------------------------------------------------- whole shows get TMDB's episodes */
  const filled = titles.withTmdbEpisodes([{ server: 'server_1', series: true, episodes: [] }, { server: 'server_2', episodes: [[1, 1]] }], DETAILS_OF_SHOW());
  same(filled[0].episodes.length, 27, 'a whole-show copy is offered every episode TMDB lists (13 + 14, specials left out)');
  same(filled[0].episodes[13], [2, 1], 'in season order');
  same(filled[1].episodes, [[1, 1]], 'a copy whose list names its episodes keeps exactly those');

  asserts.done();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

function DETAILS_OF_SHOW() {
  return { title: 'Doctor Who', genres: [], seasons: [{ season: 0, episodes: 40 }, { season: 1, episodes: 13 }, { season: 2, episodes: 14 }] };
}
