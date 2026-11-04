/*
 * WEB search by creator (`from:`, like the forum's), offline (run by `npm run checks:web`, part of `npm run verify`):
 *   npx tsc app/lib/web/search.ts app/lib/web/web-filters.ts app/lib/web/rows.ts app/lib/web/mock-web-repository.ts app/lib/web/supabase-web-repository.ts app/lib/web/search/run.ts app/lib/web/search/providers/internet-archive.ts app/lib/web/search/providers/openverse.ts --outDir Temp/out-web-author --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the box (web-filters.ts, beside in: and type:): `from:name` or `from:"a name"`, any case, the same creator
 *   once, at most three; a name with no letters or digits is no filter; written back, put in the address and read
 *   back the same; a row's creator becomes the one from: with the other filters kept; suggestions are the
 *   creators on the page; a row from another creator is not kept
 * - a match is the name's words side by side, in order, as whole words of the creator; two names are either
 * - the Postgres pattern matches exactly what the mock matches, and carries only letters, digits and its own syntax
 * - the mock: a creator alone, or a creator and words, gives only those items, every one, newest first, paged
 * - the Supabase repository: the creator is ONE regexIMatch on `creator`; no .or(); words still go to textSearch
 * - search everywhere: a provider with its own creator filter is handed the name and the words as typed; the
 *   others search the name as words; either way an item from another creator is dropped
 * - the Internet Archive asks `creator:(...)`, Openverse `creator=`, and neither sends an empty field
 */
const { join } = require('node:path');
const { makeAsserts } = require('./web-search-check-kit.cjs');

const OUT = join(__dirname, '..', 'Temp', 'out-web-author', 'lib', 'web');
const { authorWords, authorList, matchesAuthor, authorPattern, MAX_AUTHORS } = require(join(OUT, 'search.js'));
const f = require(join(OUT, 'web-filters.js'));
const { MOCK_WEB_ITEMS, getMockWebRepository } = require(join(OUT, 'mock-web-repository.js'));
const { createSupabaseWebRepository } = require(join(OUT, 'supabase-web-repository.js'));
const { rowToItem, itemToRow } = require(join(OUT, 'rows.js'));
const { searchEverywhere } = require(join(OUT, 'search', 'run.js'));
const ia = require(join(OUT, 'search', 'providers', 'internet-archive.js'));
const ov = require(join(OUT, 'search', 'providers', 'openverse.js'));
const asserts = makeAsserts('WEB search by creator');
const { ok, same } = asserts;

/**
 * The Postgres pattern in JavaScript: `[:alnum:]` is every letter and digit, accented ones included, as it is in
 * the live database (checked 2026-10-31: 'Le Café' and 'Prelinger_Archives' match, 'Stuart' is not `art`);
 * case-blind like `~*`.
 */
const pgLike = (pattern) => new RegExp(pattern.replace(/\[:alnum:\]/g, '\\p{L}\\p{N}'), 'iu');

(async () => {
  /* ---------------------------------------------------------------- the box (web-filters.ts) */
  same(f.parseWebSearch('trains from:nasa'), { text: 'trains', source: 'all', type: 'all', authors: ['nasa'] }, 'from: taken out of the words');
  same(f.parseWebSearch('from:"rick prelinger" in:archive x').authors, ['rick prelinger'], 'a quoted name, beside other filters');
  same(f.parseWebSearch('FROM:NASA from:nasa from:"NASA" moon').authors, ['NASA'], 'from: in capitals counts; the same creator once');
  same(f.parseWebSearch('from:a from:b from:c from:d').authors, ['a', 'b', 'c'], `at most ${MAX_AUTHORS} creators`);
  same(f.parseWebSearch('from:%%% from: moon'), { text: 'moon', source: 'all', type: 'all' }, 'a name with no letters is no filter, and no list is left behind');
  same(f.parseWebSearch('xfrom:nasa').text, 'xfrom:nasa', 'from: inside a word is not a filter');
  same(f.formatWebSearch(f.parseWebSearch('from:"rick prelinger" trains type:video')), 'trains type:video from:"rick prelinger"', 'the box is written back the same way');
  same(f.withAuthor('trains in:youtube from:nasa', 'Rick "the" Prelinger'), 'in:youtube from:"Rick the Prelinger"', "a creator's name on a row: words dropped, filters kept, quotes safe");
  same(f.searchAddress(f.parseWebSearch('x from:a from:"b c"')), '/media?q=x&from=a&from=b+c', 'the address carries every creator');
  same(f.boxFromAddress(new URLSearchParams('q=x&from=a&from=b+c&from=%25%25')), 'x from:a from:"b c"', 'and reads them back; an empty one is dropped');
  same(f.activeFilter('x from:"rick pre', 16), { key: 'from', partial: '"rick pre', start: 7, end: 16 }, 'the caret in a quoted creator');
  same(f.suggestFilterValues('from', 'pre', ['Rick Prelinger', 'NASA', 'rick prelinger', 'Prelinger_Archives']).map((s) => s.word), ['"Rick Prelinger"', 'Prelinger_Archives'], 'from: suggests the creators on the page, once each');
  ok(f.matchesFilters({ platform: 'youtube', kind: 'video', creator: 'NASA Johnson' }, { source: 'all', type: 'all', authors: ['nasa'] }, false), 'a row from the creator is kept');
  ok(!f.matchesFilters({ platform: 'youtube', kind: 'video', creator: 'Someone' }, { source: 'all', type: 'all', authors: ['nasa'] }, false), "another creator's row is not");

  /* ---------------------------------------------------------------- the match */
  const by = (creator) => ({ creator });
  ok(matchesAuthor(by('Rick Prelinger'), [['prelinger']]), 'one word of the name');
  ok(matchesAuthor(by('Rick Prelinger'), [['rick', 'prelinger']]), 'the whole name');
  ok(!matchesAuthor(by('Rick Prelinger'), [['prel']]), 'never part of a word');
  ok(!matchesAuthor(by('Rick Prelinger'), [['prelinger', 'rick']]), 'the words in order');
  ok(!matchesAuthor(by('Rick Prelinger'), [['ricky']]), 'not a longer word');
  ok(matchesAuthor(by('NASA Johnson'), [['rick'], ['nasa']]), 'two names are either');
  ok(!matchesAuthor({}, [['nasa']]), 'no creator, no match');
  same(authorWords('  Café, Ålands!  '), ['café', 'ålands'], 'a name is cut to its words');
  same(authorList(['NASA', 'nasa', '', '!!', 'a', 'b', 'c', 'd']), [['nasa'], ['a'], ['b']], `repeats and empty names dropped, at most ${MAX_AUTHORS}`);

  same(
    authorPattern([['rick', 'prelinger'], ['nasa']]),
    '(^|[^[:alnum:]])(?:rick[^[:alnum:]]+prelinger|nasa)([^[:alnum:]]|$)',
    'the Postgres pattern',
  );
  const hostile = authorList(['a|b(.*)', "x'),creator.eq.y"]);
  const fixed = /^\(\^\|\[\^\[:alnum:\]\]\)\(\?:(.*)\)\(\[\^\[:alnum:\]\]\|\$\)$/.exec(authorPattern(hostile));
  ok(fixed !== null && /^([\p{L}\p{N}]|\[\^\[:alnum:\]\]\+|\|)+$/u.test(fixed[1]), 'a hostile name reaches the pattern as letters and digits only');
  const names = [['prelinger'], ['rick', 'prelinger'], ['nasa'], ['café'], ['art'], ['mock', 'reader'], ['reader', 'mock'], ['archives']];
  const creators = [
    'Rick Prelinger', 'Prelinger, Rick', 'Prelinger_Archives', 'rick_prelinger', 'NASA Johnson', 'nasajohnson', 'Le Café', 'Stuart',
    'Mock Reader; Another Mock Reader', 'x2y', '',
  ];
  ok(matchesAuthor(by('Prelinger_Archives'), [['prelinger']]), 'an underscore is a break between words');
  for (const name of names) {
    for (const creator of creators) {
      same(pgLike(authorPattern([name])).test(creator), matchesAuthor(by(creator), [name]), `Postgres and the mock agree: from:"${name.join(' ')}" on "${creator}"`);
    }
  }

  /* ---------------------------------------------------------------- the mock */
  const walk = async (repo, input, size) => {
    const rows = [];
    let cursor = null;
    for (let page = 0; page < 50; page += 1) {
      const answer = await repo.searchItems({ ...input, cursor, limit: size });
      rows.push(...answer.items);
      cursor = answer.nextCursor;
      if (cursor === null) break;
    }
    return rows;
  };
  const placed = (rows) => rows.flatMap((row) => [row.id, ...row.alsoOn.map((copy) => copy.id)]).sort();
  const mock = getMockWebRepository();
  const channel = MOCK_WEB_ITEMS.filter((item) => matchesAuthor(item, [['mock', 'channel']])).map((item) => item.id).sort();
  ok(channel.length >= 2, 'the mock has a creator with several items');
  for (const size of [1, 2, 50]) {
    const rows = await walk(mock, { query: '', from: ['Mock Channel'] }, size);
    same(placed(rows), channel, `mock, pages of ${size}: a creator alone gives every item of theirs once`);
    ok(rows.every((row) => matchesAuthor(row, [['mock', 'channel']])), 'and only theirs lead a row');
  }
  const reader = await walk(mock, { query: '', from: ['reader'] }, 50);
  ok(reader.length > 0 && reader.every((row) => matchesAuthor(row, [['reader']])), 'one word of a name finds its creator');
  same(await mock.searchItems({ query: '', from: ['%%%'] }), { items: [], nextCursor: null }, 'no words and no usable name: nothing');
  const both = await walk(mock, { query: 'mock description', from: ['Mock Photographer'] }, 50);
  same(both.map((row) => row.creator), ['Mock Photographer'], 'words and a creator: both must match');
  const either = await walk(mock, { query: '', from: ['Mock Photographer', 'Mock Author'] }, 50);
  same(either.map((row) => row.creator).sort(), ['Mock Author', 'Mock Photographer'], 'two creators: either');

  /* ---------------------------------------------------------------- Supabase */
  const queries = [];
  const stored = MOCK_WEB_ITEMS.map(itemToRow);
  const fakeClient = () => ({
    from() {
      const q = { filters: [], regex: [], search: [], or: false, limit: null };
      queries.push(q);
      const b = {
        select: () => b,
        textSearch(column, text) {
          q.search.push({ column, text });
          q.filters.push((row) => text.split(' ').every((word) => rowToItem(row).title.toLowerCase().includes(word) || (row.description ?? '').toLowerCase().includes(word)));
          return b;
        },
        regexIMatch(column, pattern) {
          q.regex.push({ column, pattern });
          q.filters.push((row) => pgLike(pattern).test(row[column] ?? ''));
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
        order: () => b,
        limit(n) {
          q.limit = n;
          return b;
        },
        then(resolve, reject) {
          const rows = stored
            .filter((row) => q.filters.every((test) => test(row)))
            .sort((x, y) => Date.parse(y.published_at) - Date.parse(x.published_at) || (x.id < y.id ? 1 : -1))
            .slice(0, q.limit ?? undefined);
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return b;
    },
  });
  const repo = createSupabaseWebRepository(fakeClient);
  for (const size of [1, 3, 50]) {
    queries.length = 0;
    const rows = await walk(repo, { query: '', from: ['Mock Channel'] }, size);
    same(placed(rows), channel, `Supabase, pages of ${size}: a creator alone gives every item of theirs once`);
    for (const q of queries) {
      ok(!q.or, 'no .or() or raw .filter() string is built');
      if (q.regex.length === 0) continue; // the all-copies sibling read: no search on purpose
      same(q.regex, [{ column: 'creator', pattern: '(^|[^[:alnum:]])(?:mock[^[:alnum:]]+channel)([^[:alnum:]]|$)' }], 'one regexIMatch on creator carrying only the name');
      same(q.search, [], 'and no text search when no words were typed');
    }
  }
  queries.length = 0;
  await repo.searchItems({ query: 'mock', from: ['Mock Photographer'], limit: 5 });
  ok(queries.some((q) => q.search.length === 1 && q.regex.length === 1), 'words and a creator: one textSearch and one regexIMatch on the same read');
  queries.length = 0;
  same(await repo.searchItems({ query: '', from: ['!!!'] }), { items: [], nextCursor: null }, 'Supabase: no words, no usable name, no results');
  ok(queries.length === 0, 'and no query is sent');

  /* ---------------------------------------------------------------- search everywhere */
  const item = (platform, id, creator) => ({
    id: `${platform}:${id}`, platform, externalId: id, kind: 'video', url: 'https://example.org/', canonicalUrl: 'https://example.org/',
    title: id, creator, publishedAt: '2026-10-01T00:00:00.000Z', fetchedAt: '2026-10-01T00:00:00.000Z',
  });
  const calls = [];
  const provider = (platform, byAuthor) => ({
    platform, byAuthor, allowedHosts: [], timeoutMs: 200,
    async search(words, page, deps, author, kind) {
      calls.push({ platform, words, author, ...(kind ? { kind } : {}) });
      return { items: [item(platform, `${platform}-a`, 'Rick Prelinger'), item(platform, `${platform}-b`, 'Someone Else')], next: null };
    },
    async fetchOne() {
      return null;
    },
  });
  const providers = [provider('internet_archive', true), provider('youtube', false)];
  const result = await searchEverywhere('trains', null, providers, {}, ['rick', 'prelinger']);
  same(calls, [
    { platform: 'internet_archive', words: 'trains', author: 'rick prelinger' },
    { platform: 'youtube', words: 'rick prelinger trains', author: undefined },
  ], 'a provider with a creator filter gets the name; the others search it as words, name first');
  calls.length = 0;
  await searchEverywhere('a b c d e f g h', null, providers, {}, ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8']);
  same(calls[1].words.split(' ').length, 8, 'name and words together stay within the usual 8 words');
  same(calls[1].words, 'n1 n2 n3 n4 n5 n6 n7 n8', 'the name is kept before the words');
  same(result.items.map((found) => found.id).sort(), ['internet_archive:internet_archive-a', 'youtube:youtube-a'], 'items from another creator are dropped');
  calls.length = 0;
  await searchEverywhere('', null, providers, {}, ['nasa']);
  same(calls.map((call) => call.words), ['', 'nasa'], 'a creator alone: no words for the filtering provider, the name for the rest');
  calls.length = 0;
  const plain = await searchEverywhere('trains', null, providers, {});
  same(calls.map((call) => [call.words, call.author]), [['trains', undefined], ['trains', undefined]], 'no from: is the search as before');
  same(plain.items.length, 4, 'and nothing is dropped');
  calls.length = 0;
  await searchEverywhere('piano', null, providers, {}, null, 'audio');
  same(calls.map((call) => call.kind), ['audio', 'audio'], 'a type: filter is handed to every provider asked');
  calls.length = 0;
  await searchEverywhere('piano', null, providers, {}, ['nasa'], 'image');
  same(calls.map((call) => call.kind), ['image', 'image'], '... with a from: creator too');

  /* ---------------------------------------------------------------- the platforms' own filters */
  ok(ia.internetArchiveSearch.byAuthor === true && ov.openverseSearch.byAuthor === true, 'the Internet Archive and Openverse filter by creator themselves');
  const media = ia.iaSearchQuery('x').replace(/^title:\(x\) AND /, '');
  same(ia.iaSearchQuery('trains', 'rick prelinger'), `title:(trains) AND creator:(rick AND prelinger) AND ${media}`, 'Archive: title words and creator words');
  same(ia.iaSearchQuery('', 'nasa'), `creator:(nasa) AND ${media}`, 'Archive: a creator alone sends no empty title');
  same(ia.iaSearchQuery('trains'), `title:(trains) AND ${media}`, 'Archive: no creator is the query as before');
  same(ia.iaSearchQuery('piano', '', 'audio'), 'title:(piano) AND mediatype:(audio OR etree) AND NOT access-restricted-item:true', 'Archive: type:audio asks the Archive for audio only');
  same(ia.iaSearchQuery('x', '', 'video'), 'title:(x) AND mediatype:(movies) AND NOT access-restricted-item:true', 'Archive: type:video asks for movies only');
  const ovParams = (url) => [...new URL(url).searchParams.keys()];
  ok(ovParams(ov.ovSearchUrl('', 1, 'nasa')).includes('creator') && !ovParams(ov.ovSearchUrl('', 1, 'nasa')).includes('q'), 'Openverse: a creator alone sends creator= and no empty q=');
  same(new URL(ov.ovSearchUrl('moon', 1, 'nasa')).searchParams.get('creator'), 'nasa', 'Openverse: the creator as given');
  ok(!ovParams(ov.ovSearchUrl('moon', 1)).includes('creator'), 'Openverse: no creator is the search as before');

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${error && error.stack}`);
  process.exit(1);
});
