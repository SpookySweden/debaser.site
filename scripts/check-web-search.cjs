/*
 * WEB Phase 4, search, run offline (SPEC-web.md; run by `npm run checks:web`, part of `npm run verify`):
 *   npx tsc app/lib/web/search.ts app/lib/web/rows.ts app/lib/web/mock-web-repository.ts app/lib/web/supabase-web-repository.ts --outDir Temp/out-web-p4s --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - what the reader types is cut to its words: letters and digits only, lower case, a capped length and word
 *   count; tsquery and PostgREST syntax ( & | ! :* ' ( ) , . ) never survives; nothing to search is no search
 * - a match is every word, whole words only, in the title, creator, description or tags
 * - the mock: results newest first, paged by the same cursors with nothing dropped or repeated; a work's
 *   copies still group under a search, led by a copy that matches
 * - the Supabase repository: the search is ONE textSearch on search_tsv ('simple', plain) whose value is
 *   exactly the cleaned words; no .or() and no other filter carries it; a query with no words reads nothing;
 *   paging under a search gives every match once, in stream order
 * - the migration: search_tsv is a generated column over the four fields ('simple'), with a GIN index, and
 *   its helper is immutable, has an empty search_path and is not callable by anon or authenticated
 * - the page: one labelled search field capped at MAX_LINK_LENGTH (it takes pasted links), searches through searchItems, and a
 *   CLEAR key with an accessible name
 */
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-p4s', 'lib', 'web');
const { searchWords, searchText, matchesSearch, MAX_QUERY_LENGTH, MAX_QUERY_WORDS } = require(join(OUT, 'search.js'));
const { itemToRow, rowToItem, WEB_ITEM_COLUMNS } = require(join(OUT, 'rows.js'));
const { MOCK_WEB_ITEMS, getMockWebRepository } = require(join(OUT, 'mock-web-repository.js'));
// Updated on purpose 2026-11-01 (SPEC-media-servers.md): the mock's media-server titles are searched too.
const { MOCK_MEDIA_ITEMS } = require(join(OUT, 'mock-media-titles.js'));
const { createSupabaseWebRepository } = require(join(OUT, 'supabase-web-repository.js'));
const { compareItems, decodeCursor } = require(join(OUT, 'paging.js'));

process.exitCode = 1;
let passed = 0;
const fail = (message) => {
  console.log(`FAIL ${message}`);
  process.exit(1);
};
const ok = (condition, message) => {
  if (!condition) fail(message);
  passed += 1;
};
const same = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message} (got ${JSON.stringify(a)})`);

/* ------------------------------------------------------------------ the words */
same(searchWords('  Burning   of ROME '), ['burning', 'of', 'rome'], 'words, lower case, spaces collapsed');
same(searchWords("rome & !fire | 'x':* (a),b.c"), ['rome', 'fire', 'x', 'a', 'b', 'c'], 'operators and punctuation are dropped');
same(searchWords('a),id.gt.0'), ['a', 'id', 'gt', '0'], 'a PostgREST filter fragment is only words');
same(searchWords('rome rome ROME'), ['rome'], 'repeated words count once');
same(searchWords('Café Ünïcode 日本'), ['café', 'ünïcode', '日本'], 'letters of any script are words');
for (const empty of ['', '   ', '!!! ()', null, undefined, 42, ['rome']]) {
  ok(searchWords(empty) === null, `nothing to search is null (${JSON.stringify(empty)})`);
}
const long = `${'a'.repeat(MAX_QUERY_LENGTH)}zzz`;
same(searchWords(long), ['a'.repeat(MAX_QUERY_LENGTH)], `only the first ${MAX_QUERY_LENGTH} characters are read`);
ok(MAX_QUERY_LENGTH <= 200, 'the length cap is small');
same(searchWords('one two three four five six seven eight nine ten').length, MAX_QUERY_WORDS, `at most ${MAX_QUERY_WORDS} words`);
same(searchText('Burning, Rome!'), 'burning rome', 'the database gets the words, space-separated');
ok(/^[\p{L}\p{N} ]*$/u.test(searchText("x'); drop table web_items; --") ?? ''), 'the database text is letters, digits and spaces only');

/* ------------------------------------------------------------------ matching */
const it = (extra) => ({
  id: 'internet_archive:x',
  platform: 'internet_archive',
  externalId: 'x',
  kind: 'audio',
  url: 'https://archive.org/details/x',
  canonicalUrl: 'https://archive.org/details/x',
  title: 'The Burning of Rome',
  publishedAt: '2026-10-30T10:00:00.000Z',
  fetchedAt: '2026-10-31T12:00:00.000Z',
  ...extra,
});
ok(matchesSearch(it({}), ['burning', 'rome']), 'title words match');
ok(matchesSearch(it({ creator: 'Tacitus' }), ['tacitus']), 'creator matches');
ok(matchesSearch(it({ description: 'Read by a volunteer.' }), ['volunteer']), 'description matches');
ok(matchesSearch(it({ tags: ['history', 'Latin'] }), ['latin']), 'tags match');
ok(matchesSearch(it({ creator: 'Tacitus' }), ['rome', 'tacitus']), 'words may come from different fields');
ok(!matchesSearch(it({}), ['rom']), 'whole words only (rom is not rome)');
ok(!matchesSearch(it({}), ['rome', 'carthage']), 'every word is needed');

/* ------------------------------------------------------------------ the mock */
const walk = async (repo, query, size) => {
  const rows = [];
  let cursor = null;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await repo.searchItems({ query, cursor, limit: size });
    ok(page.items.length <= size, `a page of ${size} holds at most ${size}`);
    rows.push(...page.items);
    if (!page.nextCursor) break;
    ok(decodeCursor(page.nextCursor) !== null, 'a search page hands out a real cursor');
    cursor = page.nextCursor;
  }
  return rows;
};

(async () => {
  const mock = getMockWebRepository();
  const expected = [...MOCK_WEB_ITEMS, ...MOCK_MEDIA_ITEMS].filter((item) => matchesSearch(item, ['mock', 'description'])).sort(compareItems);
  ok(expected.length >= 5, 'the mock has enough matches to page through');
  for (const size of [1, 2, 3, 50]) {
    const rows = await walk(mock, 'Mock DESCRIPTION', size);
    const placed = rows.flatMap((row) => [row.id, ...row.alsoOn.map((copy) => copy.id)]);
    same([...placed].sort(), expected.map((item) => item.id).sort(), `mock, pages of ${size}: every match once`);
    const order = rows.map((row) => row.id);
    same(order, expected.map((item) => item.id).filter((id) => order.includes(id)), `mock, pages of ${size}: newest first`);
  }
  same(await mock.searchItems({ query: '  !!  ' }), { items: [], nextCursor: null }, 'mock: no words, no results');
  same((await mock.searchItems({ query: 'nothingmatchesthis' })).items, [], 'mock: no match is an empty page');

  const tagged = await walk(mock, 'duplicate', 10);
  same(tagged.map((row) => [row.id, row.alsoOn.map((copy) => copy.id)]), [['internet_archive:mock-item-21', ['internet_archive:mock-item-22']]], 'mock: a tag finds item 21, with its copy listed');
  const secondOnly = await walk(mock, 'second copy', 10);
  same(secondOnly.map((row) => [row.id, row.alsoOn.map((copy) => copy.id)]), [['internet_archive:mock-item-22', ['internet_archive:mock-item-21']]], 'mock: when only the older copy matches, it leads and lists the other');

  /* ---------------------------------------------------------------- Supabase */
  const queries = [];
  const fakeClient = (rowsIn) => ({
    from() {
      const q = { columns: null, filters: [], limit: null, search: [], or: false, inKeys: null };
      queries.push(q);
      const b = {
        select(columns) {
          q.columns = columns;
          return b;
        },
        textSearch(column, text, options) {
          q.search.push({ column, text, options });
          const wanted = text.split(' ');
          q.filters.push((row) => matchesSearch(rowToItem(row), wanted));
          return b;
        },
        eq(column, value) {
          q.filters.push((row) => (column === 'published_at' ? Date.parse(row[column]) === Date.parse(value) : row[column] === value));
          return b;
        },
        lt(column, value) {
          q.filters.push((row) => (column === 'published_at' ? Date.parse(row[column]) < Date.parse(value) : row[column] < value));
          return b;
        },
        in(column, values) {
          q.inKeys = values;
          q.filters.push((row) => values.includes(row[column]));
          return b;
        },
        or() {
          q.or = true;
          return b;
        },
        filter() {
          q.or = true;
          return b;
        },
        order() {
          return b;
        },
        limit(n) {
          q.limit = n;
          return b;
        },
        then(resolve) {
          if (q.limit == null) return resolve({ data: null, error: { message: 'no limit' } });
          const found = rowsIn.filter((row) => q.filters.every((f) => f(row))).map(rowToItem).sort(compareItems);
          resolve({ data: found.slice(0, q.limit).map(itemToRow), error: null });
        },
      };
      return b;
    },
  });

  const stored = MOCK_WEB_ITEMS.map(itemToRow);
  // Only web_items rows are stored here (the media tables are held by check-web-media-db.cjs).
  const storedExpected = expected.filter((item) => !item.id.startsWith('media:'));
  const repo = createSupabaseWebRepository(() => fakeClient(stored));
  for (const size of [1, 3, 50]) {
    queries.length = 0;
    const rows = await walk(repo, 'Mock, DESCRIPTION!', size);
    const placed = rows.flatMap((row) => [row.id, ...row.alsoOn.map((copy) => copy.id)]);
    same([...placed].sort(), storedExpected.map((item) => item.id).sort(), `Supabase, pages of ${size}: every match once`);
    ok(queries.length > 0, 'the search read something');
    for (const q of queries) {
      // Updated on purpose 2026-11-01 (SPEC-media-servers.md): the media titles' search is held by check-web-media-db.cjs,
      // including its one `.or()` (title or series name, built from letters-and-digits words only, asserted there).
      if (q.columns !== WEB_ITEM_COLUMNS && /web_media_copies/.test(q.columns ?? '')) continue;
      ok(!q.or, 'no .or() or raw .filter() string is built');
      ok(q.columns === WEB_ITEM_COLUMNS && q.limit != null, 'every query selects the column list, with a limit');
      if (q.inKeys) continue; // the all-copies sibling read: no search on purpose
      same(q.search, [{ column: 'search_tsv', text: 'mock description', options: { config: 'simple', type: 'plain' } }], 'one plain textSearch on search_tsv carrying only the words');
    }
  }
  const hostile = "a),id.gt.0&title=eq.x'--";
  queries.length = 0;
  await repo.searchItems({ query: hostile, limit: 5 });
  ok(queries.length > 0 && queries.every((q) => q.search.every((s) => /^[\p{L}\p{N} ]+$/u.test(s.text))), 'a hostile query reaches the database as words only');
  queries.length = 0;
  same(await repo.searchItems({ query: '((( )))' }), { items: [], nextCursor: null }, 'Supabase: no words, no results');
  ok(queries.length === 0, 'and no query is sent');

  /* ---------------------------------------------------------------- the migration */
  const name = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((file) => /^\d{14}_web_search_dedupe\.sql$/.test(file));
  ok(name.length === 1, 'exactly one *_web_search_dedupe.sql migration');
  const sql = readFileSync(join(ROOT, 'supabase', 'migrations', name[0]), 'utf8').replace(/--.*$/gm, '').toLowerCase().replace(/\s+/g, ' ');
  ok(/add column if not exists search_tsv tsvector generated always as \(/.test(sql), 'search_tsv is a generated column (if not exists)');
  const generated = sql.slice(sql.indexOf('search_tsv tsvector'), sql.indexOf(') stored'));
  for (const field of ['coalesce(title', 'coalesce(creator', 'web_tags_text(tags)', 'coalesce(description']) {
    ok(generated.includes(field), `search_tsv reads ${field}`);
  }
  ok((generated.match(/to_tsvector\('simple'::regconfig/g) || []).length === 4, "every part uses the 'simple' configuration");
  ok(/create index if not exists web_items_search_idx on public\.web_items using gin \(search_tsv\)/.test(sql), 'search_tsv has a GIN index');
  ok(/create or replace function public\.web_tags_text\(tags text\[\]\) returns text language sql immutable/.test(sql), 'the tags helper is immutable');
  ok(/set search_path = ''/.test(sql), 'with an empty search_path');
  ok(/revoke all on function public\.web_tags_text\(text\[\]\) from public, anon, authenticated/.test(sql), 'and is not callable by anon or authenticated');
  ok(!/security definer/.test(sql), 'no security definer');
  ok(!/(enable|disable) row level security|create policy|drop policy|grant select|grant (insert|update|delete|all)/.test(sql), 'RLS, policies and table grants are left alone');
  for (const m of sql.matchAll(/grant ([^;]+);/g)) ok(m[1] === 'execute on function public.web_tags_text(text[]) to service_role', `the only grant is the helper to service_role (got grant ${m[1]})`);

  /* ---------------------------------------------------------------- the page */
  const page = readFileSync(join(ROOT, 'app', 'components', 'WebStream.tsx'), 'utf8');
  ok(/<form role="search"/.test(page), 'the page has a search form');
  ok(/<label htmlFor="web-search"/.test(page) && /id="web-search"[\s\S]{0,40}type="search"/.test(page), 'its field is labelled and is a search field');
  // Since search everywhere (SPEC-web-search.md) the field also takes a pasted address, so it is capped at the
  // link length; the words of a search are still cut to MAX_QUERY_LENGTH by searchWords (asserted above).
  ok(/maxLength=\{MAX_LINK_LENGTH\}/.test(page), 'the field is capped at MAX_LINK_LENGTH');
  // The box's filters (in:, type:) are taken out first (web-filters.ts), then the words go through searchText.
  ok(/const query = searchText\(parsed\.text\);/.test(page), 'a typed search goes through searchText (letters and digits, capped)');
  ok(/\.searchItems\(/.test(page), 'it searches through the repository');
  ok(/aria-label="Clear the search"/.test(page), 'the CLEAR key has an accessible name');
  ok(!/dangerouslySetInnerHTML/.test(page), 'nothing is rendered as HTML');

  console.log(`ok: ${passed} assertions (WEB search: words, matching, mock and Supabase paging, parameters, migration, page)`);
  process.exitCode = 0;
})().catch((error) => fail(error.stack));
