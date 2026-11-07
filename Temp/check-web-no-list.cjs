/**
 * A media server with no list file (app/lib/web/wildcard-search.ts, Luke 2026-11-07): it shows at once, a show has its real seasons, and only a title it has gets a button.
 *   npx tsc app/lib/web/wildcard-search.ts --outDir Temp/out-no-list --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-web-no-list.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const out = (file) => path.join(__dirname, 'out-no-list', 'lib', 'web', file);
const servers = require(out('media-servers.js'));
const server = { id: 'no_list', label: 'NO LIST', base: 'https://no-list.example', listPath: '*', play: { movie: '/m/{tmdb}', tv: '/t/{tmdb}/{season}/{episode}' } };
servers.MEDIA_SERVERS.push(server);
const { wildcardSearch } = require(out('wildcard-search.js'));
const { heldEpisodes, mediaPlayUrl } = require(out('media-titles.js'));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetchImpl = async (input) => {
  const url = new URL(String(input));
  if (url.pathname === '/3/search/multi') return json({ results: [{ media_type: 'movie', id: 603, title: 'A Film', release_date: '1999-03-31' }, { media_type: 'tv', id: 1399, name: 'A Show', first_air_date: '2011-04-17' }, { media_type: 'tv', id: 7, name: 'No Details' }], total_pages: 1 });
  if (url.pathname === '/3/movie/603') return json({ title: 'A Film', overview: 'Read from TMDB.', runtime: 136, genres: [{ name: 'Action' }] });
  if (url.pathname === '/3/tv/1399') return json({ name: 'A Show', seasons: [{ season_number: 0, episode_count: 3 }, { season_number: 1, episode_count: 2 }, { season_number: 2, episode_count: 1 }], genres: [] });
  return json({}, 404);
};

(async () => {
  const asks = [];
  const has = async (input) => {
    const url = String(input);
    asks.push(url);
    return new Response('player', { status: 200, headers: { 'Content-Type': 'text/html' } });
  };
  const items = await wildcardSearch('anything', { fetch: fetchImpl, token: 'test', askServer: has });
  assert.deepEqual(asks, ['https://no-list.example/m/603', 'https://no-list.example/t/1399/1/1', 'https://no-list.example/t/7/1/1'], 'each title is asked about once, at its player page');
  assert.equal(items.length, 3, 'every title TMDB finds gets a row, with no list and no update run');
  const [film, show, bare] = items;
  assert.equal(film.description, 'Read from TMDB.', 'with its details');
  assert.equal(mediaPlayUrl(server, film.media, {}), 'https://no-list.example/m/603', 'a film plays by its TMDB number');
  assert.deepEqual([...heldEpisodes(show.media).entries()], [[1, [1, 2]], [2, [1]]], "a show offers TMDB's real seasons and episodes, not the specials");
  assert.equal(mediaPlayUrl(server, show.media, { season: 2, episode: 1 }), 'https://no-list.example/t/1399/2/1', 'and plays the one picked');
  assert.equal(mediaPlayUrl(server, show.media, { season: 9, episode: 9 }), null, 'an episode TMDB does not list is not offered');
  assert.equal(bare.title, 'No Details', 'a title whose details fail still shows');
  assert.deepEqual(await wildcardSearch('x', { fetch: fetchImpl, token: '' }), [], 'no TMDB token: no rows, and no error');
  assert.deepEqual(await wildcardSearch('x', { fetch: async () => { throw new Error('down'); }, token: 'test' }), [], 'TMDB down: no rows, and no error');

  // Only what it has. Fresh titles, so nothing is remembered from above.
  const answers = { '/m/11': 200, '/m/12': 404, '/m/13': 410, '/m/14': 500, '/m/15': 401 };
  const titles = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/3/search/multi') return json({ results: Object.keys(answers).map((key) => ({ media_type: 'movie', id: Number(key.slice(3)), title: key, release_date: '2000-01-01' })), total_pages: 1 });
    return json({}, 404);
  };
  const ask = async (input) => new Response('x', { status: answers[new URL(String(input)).pathname], headers: { 'Content-Type': 'text/html' } });
  const found = await wildcardSearch('more', { fetch: titles, token: 'test', askServer: ask });
  assert.deepEqual(found.map((item) => item.media.tmdbId), [11, 14, 15], 'a 404 or 410 is no button; a server error or a login page keeps it');
  let again = 0;
  await wildcardSearch('more', { fetch: titles, token: 'test', askServer: async (input) => { again += 1; return ask(input); } });
  assert.equal(again, 0, 'and it is not asked again straight away');
  console.log('no-list server checks passed');
})().catch((error) => { console.error(error); process.exit(1); });
