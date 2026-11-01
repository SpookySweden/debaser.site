/*
 * WEB media servers: the tables, the reader, the hourly update and TMDB, offline (SPEC-media-servers.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/media-rows.ts app/lib/web/media-ingest.ts app/lib/web/tmdb.ts app/lib/web/supabase-web-repository.ts --outDir Temp/out-web-media-db --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the migration: Row Level Security on both tables, readable by signed-in people only (never `anon`), no
 *   write policy, every function refuses without the ingest lock, re-runnable
 * - the reader: only listed servers' copies count (a title left with none is no row), episodes and TMDB's details
 *   re-checked, no rating or popularity selected; a search is per-word `ilike` carrying the cleaned words only;
 *   a failed media read leaves the stream showing
 * - the update: a server that does not answer keeps everything (no finish); a list is saved in batches then
 *   finished; the list is fetched on the server's own host only
 * - TMDB: asked only with the token, which travels as a header and never in an address or the result; a 404
 *   saves "asked, nothing known"; vote_average, vote_count and popularity are cut
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { makeAsserts } = require('./web-search-check-kit.cjs');

const ROOT = join(__dirname, '..');
// Against two FIXED test servers (web-media-test-servers.cjs), whatever servers Luke has listed.
const OUT = join(
  require('./web-media-test-servers.cjs').compileWithTestServers('out-web-media-db-fixed', ['lib/web/media-rows.ts', 'lib/web/media-ingest.ts', 'lib/web/tmdb.ts', 'lib/web/supabase-web-repository.ts']),
  'lib',
  'web',
);
const rows = require(join(OUT, 'media-rows.js'));
const ingest = require(join(OUT, 'media-ingest.js'));
const tmdb = require(join(OUT, 'tmdb.js'));
const { createSupabaseWebRepository } = require(join(OUT, 'supabase-web-repository.js'));
const asserts = makeAsserts('WEB media servers (database)');
const { ok, same } = asserts;

async function main() {
  /* ---------------------------------------------------------------- the migration */
  const sql = readFileSync(join(ROOT, 'supabase', 'migrations', '20261101120000_web_media.sql'), 'utf8').replace(/\r\n/g, '\n');
  for (const table of ['web_media_titles', 'web_media_copies']) {
    ok(sql.includes(`alter table public.${table} enable row level security;`), `${table}: Row Level Security on`);
    ok(new RegExp(`create policy "[^"]+" on public\\.${table}\\n  for select to authenticated using \\(true\\);`).test(sql), `${table}: readable by signed-in people only`);
    ok(sql.includes(`revoke all on public.${table} from anon, authenticated;`) && sql.includes(`grant select on public.${table} to authenticated;`), `${table}: select is the only grant, and only to authenticated`);
    ok(!new RegExp(`grant [^;]* on public\\.${table} to [^;]*anon`).test(sql), `${table}: nothing granted to anon (a visitor reads nothing)`);
    ok(!new RegExp(`for (insert|update|delete|all)[^;]*on public\\.${table}|on public\\.${table}\\s+for (insert|update|delete|all)`).test(sql), `${table}: no write policy`);
  }
  const functions = [...sql.matchAll(/create or replace function public\.(\w+)\([^)]*\)[\s\S]*?\n\$\$;/g)];
  same(functions.map((m) => m[1]), ['web_media_save', 'web_media_finish', 'web_media_needing_details', 'web_media_save_details'], 'four functions');
  for (const [body, name] of functions) {
    ok(/if not public\.web_ingest_lock_ok\(p_secret\) then\s+raise exception 'not allowed' using errcode = '28000';/.test(body), `${name} refuses without the ingest lock`);
    ok(/security definer\s+set search_path = ''/.test(body), `${name} runs as its owner with an empty search path`);
  }
  ok(/create table if not exists public\.web_media_titles/.test(sql) && /drop policy if exists/.test(sql), 'the migration can be re-run');
  ok(!/vote|popularity|rating/i.test(sql.replace(/--.*$/gm, '')), 'no rating, vote count or popularity column anywhere');
  ok(/published_at timestamptz not null default/.test(sql) && !/published_at = excluded/.test(sql), 'a title keeps the time it first appeared');
  ok(/delete from public\.web_media_copies where server = p_server and seen_at < p_run;/.test(sql), 'finishing a run drops only that server\'s copies its list no longer had');

  /* ---------------------------------------------------------------- the reader */
  ok(!/vote|popularity|rating/i.test(rows.WEB_MEDIA_COLUMNS), 'the column list selects no rating, vote count or popularity');
  const row = (extra = {}) => ({
    id: 'media:tmdb-tv-1399',
    media_type: 'tv',
    tmdb_id: 1399,
    title: 'Show',
    creator: null,
    description: 'From the list',
    thumbnail_url: null,
    duration_seconds: null,
    released_at: null,
    details: { title: 'TMDB Show', genres: ['Drama', 7], overview: 'From TMDB', posterPath: '/abcdefgh1234.jpg', runtimeMinutes: 50, seasons: [{ season: 1, episodes: 10 }, { season: 'x' }] },
    published_at: '2026-11-01T10:00:00+00:00',
    fetched_at: '2026-11-01T11:00:00+00:00',
    web_media_copies: [
      { server: 'server_2', local_id: null, episodes: [[1, 1]] },
      { server: 'server_1', local_id: null, episodes: [[1, 1], [1, 2], ['a', 3], [2]] },
      { server: 'gone_server', local_id: null, episodes: [[9, 9]] },
    ],
    ...extra,
  });
  const item = rows.mediaRowToItem(row());
  same(item.media.copies.map((copy) => copy.server), ['server_1', 'server_2'], 'copies in the servers\' listed order; a server no longer listed is dropped');
  same(item.media.copies[0].episodes, [[1, 1], [1, 2]], 'episodes must be pairs of whole numbers');
  same([item.title, item.description, item.media.details.genres, item.media.details.seasons], ['TMDB Show', 'From TMDB', ['Drama'], [{ season: 1, episodes: 10 }]], 'TMDB\'s details re-checked on the way in');
  same([item.publishedAt, item.platform, item.id], ['2026-11-01T10:00:00.000Z', 'server_1', 'media:tmdb-tv-1399'], 'its place in the stream, its first server, its id');
  same(rows.mediaRowToItem(row({ web_media_copies: [{ server: 'gone_server', local_id: null, episodes: null }] })), null, 'no copy on a listed server: no row');
  same(rows.mediaRowToItem(row({ id: 'internet_archive:x' })), null, 'a malformed id: no row');
  same(rows.mediaRowToItem(row({ details: { title: 5 } })).title, 'Show', 'details of the wrong shape are ignored: the list\'s words show');

  /* ---------------------------------------------------------------- the Supabase read */
  const queries = [];
  const fake = (mediaFails) => ({
    from(table) {
      const q = { table, columns: null, ilike: [], ors: [], imatch: [], limit: null, filters: [] };
      queries.push(q);
      const b = {
        select(columns) { q.columns = columns; return b; },
        ilike(column, value) { q.ilike.push([column, value]); return b; },
        or(text) { q.ors.push(text); return b; },
        regexIMatch(column, value) { q.imatch.push([column, value]); return b; },
        textSearch() { return b; },
        eq() { return b; },
        lt() { return b; },
        in() { return b; },
        order() { return b; },
        limit(n) { q.limit = n; return b; },
        then(resolve) {
          if (table === 'web_media_titles') return resolve(mediaFails ? { data: null, error: { message: 'permission denied' } } : { data: [row()], error: null });
          return resolve({ data: [], error: null });
        },
      };
      return b;
    },
  });
  const repo = createSupabaseWebRepository(() => fake(false));
  const listed = await repo.listItems({ limit: 10 });
  same(listed.items.map((r) => r.id), ['media:tmdb-tv-1399'], 'the media titles join the stream');
  queries.length = 0;
  await repo.searchItems({ query: "Show's & (night)!", limit: 10 });
  const mediaQ = queries.find((q) => q.table === 'web_media_titles');
  // Updated on purpose 2026-11-01 (Luke: find a film series by its name): each word in the title OR the series' name.
  same(
    mediaQ.ors,
    ['title.ilike.*show*,details->collection->>name.ilike.*show*', 'title.ilike.*s*,details->collection->>name.ilike.*s*', 'title.ilike.*night*,details->collection->>name.ilike.*night*'],
    'a search is one title-or-series-name filter per cleaned word: letters and digits only, nothing else of what was typed',
  );
  queries.length = 0;
  await repo.searchItems({ query: 'a),id.gt.0,title.eq.x*', limit: 10 });
  const hostileQ = queries.find((q) => q.table === 'web_media_titles');
  ok(hostileQ.ors.every((text) => /^title\.ilike\.\*[\p{L}\p{N}]+\*,details->collection->>name\.ilike\.\*[\p{L}\p{N}]+\*$/u.test(text)), 'typed commas, brackets, dots and stars never reach the filter: ' + JSON.stringify(hostileQ.ors));
  ok(mediaQ.columns === rows.WEB_MEDIA_COLUMNS && mediaQ.limit !== null, 'the media read selects its column list, with a limit');

  // A film series longer than the first read's room (40 a series): read again on its own, so every film is in the picker.
  const longSeries = Array.from({ length: 65 }, (_, i) => row({
    id: `media:tmdb-movie-${i + 1}`,
    media_type: 'movie',
    tmdb_id: i + 1,
    title: `Part ${i + 1}`,
    details: { title: `Part ${i + 1}`, date: `${1950 + i}-01-01`, genres: [], collection: { id: 77, name: 'Long Series' } },
    published_at: new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString(),
    web_media_copies: [{ server: 'server_1', local_id: null, episodes: null }],
  })).reverse();
  const longReads = [];
  const longFake = {
    from() {
      const q = { inIds: null, eqId: null, limit: null };
      const b = {
        select() { return b; }, or() { return b; }, regexIMatch() { return b; }, lt() { return b; }, order() { return b; },
        in(column, ids) { q.inIds = ids; return b; },
        eq(column, value) { if (column === 'collection_id') q.eqId = value; return b; },
        limit(n) { q.limit = n; return b; },
        then(resolve) {
          longReads.push({ ...q });
          return resolve({ data: longSeries.slice(0, q.limit), error: null });
        },
      };
      return b;
    },
  };
  const longPage = await createSupabaseWebRepository(() => longFake).listItems({ limit: 5 });
  const longRow = longPage.items.find((r) => r.title === 'Long Series');
  same(longRow ? longRow.media.parts.length : 0, 65, 'a series of 65 films shows all 65 in its FILM picker');
  ok(longReads.some((r) => r.inIds && r.limit === 40) && longReads.some((r) => r.eqId === 77 && r.limit === 500), 'the full first read is redone one series at a time, with room for a whole series');
  const failing = createSupabaseWebRepository(() => fake(true));
  same((await failing.listItems({ limit: 10 })).items, [], 'a refused media read (a visitor, or a failure) is an empty page, never an error that hides the stream');

  /* ---------------------------------------------------------------- the update */
  const calls = [];
  const store = {
    async save(server, run, titles) { calls.push(['save', server, titles.length]); },
    async finish(server) { calls.push(['finish', server]); },
    async needingDetails(limit) { calls.push(['needing', limit]); return [{ id: 'media:tmdb-movie-157336', type: 'movie', tmdbId: 157336 }, { id: 'media:tmdb-movie-404', type: 'movie', tmdbId: 404 }]; },
    async saveDetails(list) { calls.push(['details', list]); },
  };
  const S1 = { id: 'server_1', label: 'SERVER 1', base: 'https://one.example', listPath: '/debaser/list.json', play: { movie: '/m/{tmdb}', tv: '/t/{tmdb}/{season}/{episode}' } };
  const S2 = { ...S1, id: 'server_2', base: 'https://two.example' };
  const asked = [];
  const bigList = Array.from({ length: 1201 }, (_, i) => ({ title: `Film ${i}`, type: 'movie', tmdb_id: String(i + 1) }));
  const fetchImpl = async (url, init) => {
    asked.push({ url, auth: init?.headers?.Authorization ?? null });
    if (url.startsWith('https://one.example/')) return new Response(JSON.stringify(bigList), { status: 200 });
    if (url.startsWith('https://two.example/')) throw new TypeError('getaddrinfo ENOTFOUND');
    if (url.includes('/3/movie/157336')) return new Response(JSON.stringify({ title: 'Interstellar', release_date: '2014-11-05', overview: 'Space.', poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', runtime: 169, genres: [{ name: 'Science Fiction' }], vote_average: 8.4, vote_count: 30000, popularity: 99 }), { status: 200 });
    if (url.includes('/3/movie/404')) return new Response('{}', { status: 404 });
    return new Response('nope', { status: 500 });
  };
  const TOKEN = 'test-token-value-1234567890';
  const result = await ingest.runMediaIngest(store, { fetch: fetchImpl, tmdbToken: TOKEN, servers: [S1, S2] });
  same(calls.filter((c) => c[0] !== 'details' && c[0] !== 'needing'), [['save', 'server_1', 500], ['save', 'server_1', 500], ['save', 'server_1', 201], ['finish', 'server_1']], 'a list is saved in batches of 500, then finished; a server that did not answer is never finished (keeps what it had)');
  same(result.servers, [{ server: 'server_1', titles: 1201, error: null }, { server: 'server_2', titles: 0, error: 'NOT ANSWERING' }], 'the result names each server and a fixed phrase');
  same(asked.filter((a) => !a.url.includes('themoviedb')).map((a) => [a.url, a.auth]), [['https://one.example/debaser/list.json', null], ['https://two.example/debaser/list.json', null]], 'each list from its own server\'s host, and the TMDB token is never sent to a server');
  const tmdbAsks = asked.filter((a) => a.url.includes('themoviedb'));
  ok(tmdbAsks.length === 2 && tmdbAsks.every((a) => a.auth === `Bearer ${TOKEN}` && !a.url.includes(TOKEN)), 'TMDB is asked with the token as a header, never in the address');
  ok(tmdbAsks.every((a) => a.url.startsWith('https://api.themoviedb.org/3/movie/')), 'on TMDB\'s API host only');
  const saved = calls.find((c) => c[0] === 'details')[1];
  same(saved.map((s) => [s.id, s.details === null ? null : s.details.title]), [['media:tmdb-movie-157336', 'Interstellar'], ['media:tmdb-movie-404', null]], 'details saved; a number TMDB does not know is saved as asked-and-unknown');
  ok(!/vote|popularity/i.test(JSON.stringify(saved)), 'vote_average, vote_count and popularity are cut before saving');
  ok(!JSON.stringify(result).includes(TOKEN), 'the token never appears in the result');

  calls.length = 0;
  const noToken = await ingest.runMediaIngest(store, { fetch: fetchImpl, servers: [S1] });
  same([noToken.detailsError, calls.some((c) => c[0] === 'needing')], ['NOT SET UP', false], 'without TMDB_READ_TOKEN, TMDB is never asked');
  calls.length = 0;
  await ingest.runMediaIngest(store, { fetch: async () => new Response('<html>oops</html>', { status: 200 }), servers: [S1] });
  same(calls, [], 'an answer that is not a list saves and drops nothing');
  calls.length = 0;
  const empty = await ingest.runMediaIngest(store, { fetch: async () => new Response('[]', { status: 200 }), servers: [S1] });
  same([calls, empty.servers[0].error], [[], 'EMPTY LIST'], 'an empty list (a server mid-rebuild) drops nothing');
  calls.length = 0;
  const junk = await ingest.runMediaIngest(store, { fetch: async () => new Response('[{"x":1},{"title":""}]', { status: 200 }), servers: [S1] });
  same([calls, junk.servers[0].error], [[], 'NOTHING USABLE'], 'a list with nothing usable in it drops nothing');
  // Review finding 2026-11-01: the cursor carries milliseconds, so the stored first-seen time must too.
  ok(/published_at timestamptz not null default date_trunc\('milliseconds', now\(\)\)/.test(sql), 'first-seen times are stored to the millisecond');
  ok(/date_trunc\('milliseconds', p_run\), date_trunc\('milliseconds', p_run\)/.test(sql), 'and the save writes them to the millisecond');

  /* ---------------------------------------------------------------- film series and whole shows */
  const withSeries = tmdb.toDetails({ title: 'A New Hope', release_date: '1977-05-25', genres: [], belongs_to_collection: { id: 10, name: 'Star Wars Collection', poster_path: '/abcdefgh1234.jpg', backdrop_path: '/x.jpg' } }, 'movie');
  same(withSeries.collection, { id: 10, name: 'Star Wars Collection', posterPath: '/abcdefgh1234.jpg' }, 'a film\'s TMDB collection is kept: number, name, poster');
  same(tmdb.toDetails({ title: 'X', genres: [], belongs_to_collection: { id: 'ten', name: 'Bad' } }, 'movie').collection, undefined, 'a malformed collection is dropped');
  same(tmdb.toDetails({ name: 'Show', genres: [], belongs_to_collection: { id: 10, name: 'No' } }, 'tv').collection, undefined, 'shows have no collection');
  const sql2 = readFileSync(join(ROOT, 'supabase', 'migrations', '20261101150000_web_media_collections.sql'), 'utf8').replace(/\r\n/g, '\n');
  ok(/add column if not exists collection_id integer/.test(sql2) && /create index if not exists web_media_titles_collection_idx/.test(sql2), 'the collection column and its index, re-runnable');
  ok(/if not public\.web_ingest_lock_ok\(p_secret\) then\s+raise exception 'not allowed' using errcode = '28000';/.test(sql2), 'the details save still refuses without the lock');
  ok(/\(r\.details -> 'collection' ->> 'id'\) ~ '\^\[1-9\]\[0-9\]\{0,8\}\$'/.test(sql2), 'collection_id is taken from the details only as a whole number');
  ok(!/grant [^;]* on public\.web_media_titles to [^;]*anon/.test(sql2) && !/create policy/.test(sql2), 'no new grant or policy: visitors still read nothing');
  const seriesRow = rows.mediaRowToItem(row({ media_type: 'movie', id: 'media:tmdb-movie-11', details: { title: 'Star Wars', genres: [], collection: { id: 10, name: 'Star Wars Collection' } }, web_media_copies: [{ server: 'server_1', local_id: null, episodes: null }] }));
  same(seriesRow.media.details.collection, { id: 10, name: 'Star Wars Collection' }, 'the collection is read back from the details');
  const wholeRow = rows.mediaRowToItem(row({ web_media_copies: [{ server: 'server_1', local_id: null, episodes: [] }] }));
  same(wholeRow.media.copies, [{ server: 'server_1', episodes: [], series: true }], 'a show copy with no episodes reads as the whole show');
  ok(/collection_id/.test(rows.WEB_MEDIA_COLUMNS) && !/vote|popularity|rating/i.test(rows.WEB_MEDIA_COLUMNS), 'the column list adds collection_id and still no rating or popularity');

  same(tmdb.detailsUrl('tv', 1399), 'https://api.themoviedb.org/3/tv/1399?language=en-US', 'TMDB addresses are built from fixed parts and a checked number');
  let threw = false;
  try { tmdb.detailsUrl('movie', -1); } catch { threw = true; }
  ok(threw, 'a bad number never becomes an address');
  same(tmdb.toDetails({ name: 'Show', first_air_date: '2011-04-17', episode_run_time: [55], seasons: [{ season_number: 1, episode_count: 10 }], genres: [] }, 'tv'), { title: 'Show', genres: [], date: '2011-04-17', runtimeMinutes: 55, seasons: [{ season: 1, episodes: 10 }] }, 'a show: name, first air date, episode length, seasons');

  asserts.done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
