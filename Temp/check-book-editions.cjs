/*
 * Every edition of every book (SPEC-book-editions.md, Luke 2026-11-11), offline, from saved Open Library and Archive answers
 * (`scripts/fixtures/web/book-editions.json`: Dracula's first ten editions as Open Library lists them, its twelve most
 * detailed, the Archive's answer for their scans, the ISBN 9780141439846's edition, and a book with one edition).
 *   npx tsc app/lib/books/editions.ts app/lib/books/types.ts app/lib/books/ipfs.ts app/lib/web/book-editions.ts app/lib/web/books.ts app/lib/web/search/providers/books.ts app/lib/letters/things.ts app/lib/web/row-addresses.ts --outDir Temp/out-book-editions --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-book-editions.cjs
 *
 * - every saved edition parses, to plain text: notes as a string or `{ value }`, `contributions` and `contributors` as
 *   "Role by Name" lines, the year read from the printed date, the format named PAPERBACK / HARDCOVER / EBOOK / AUDIO
 * - hostile values are refused: markup stripped, a key, work, scan id, cover or language that isn't one is dropped
 * - the list is read whole (500 at a time, only from openlibrary.org and archive.org), then ordered: most details first, so
 *   every detailed edition stands before every bare reprint; newest and oldest by year; filtered ALL / CAN BE READ HERE /
 *   HAS DETAILS; fifty to a page with the next offset
 * - READ / BORROW / NO FREE COPY per edition: a free scan reads here, a lent one is borrowed on archive.org, a scan the
 *   Archive doesn't find is neither, the work's Gutenberg copy (from Open Library, never from the address) and IPFS copy read
 *   here, and with none, NO FREE COPY and the edition's Open Library page
 * - the edition the page opens at is found in the list or read on its own, and refused when it belongs to another book
 * - an ISBN (with hyphens, an X, `isbn` before it) finds that edition's book through Open Library's redirect on its own host,
 *   a redirect anywhere else is refused, and a number that fails its check digit is searched as words
 * - BOOKS search now keeps every work (no Gutenberg-only filter), carrying how many editions each has; an `edition:` address
 *   is a book's address, and its book's row carries the edition; a letter's card goes to it
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'out-book-editions');
const editions = require(path.join(OUT, 'lib', 'books', 'editions.js'));
const listing = require(path.join(OUT, 'lib', 'web', 'book-editions.js'));
const books = require(path.join(OUT, 'lib', 'web', 'books.js'));
const search = require(path.join(OUT, 'lib', 'web', 'search', 'providers', 'books.js'));
const { hrefOf } = require(path.join(OUT, 'lib', 'letters', 'things.js'));
const fixture = JSON.parse(readFileSync(path.join(__dirname, '..', 'scripts', 'fixtures', 'web', 'book-editions.json'), 'utf8'));

const NOW = new Date('2026-11-11T12:00:00Z');
process.exitCode = 1;
let passed = 0;
const ok = (condition, message) => {
  if (!condition) {
    console.log(`FAIL ${message}`);
    process.exit(1);
  }
  passed += 1;
};
const same = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message} (got ${JSON.stringify(a)})`);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Open Library and the Archive as saved: Dracula's pages by offset, its scans, its row, one edition and the ISBN. */
function savedWeb(overrides = {}) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    const at = new URL(url);
    if (overrides[url]) return overrides[url]();
    if (at.hostname === 'openlibrary.org') {
      if (at.pathname === '/works/OL85892W/editions.json') {
        const offset = at.searchParams.get('offset');
        if (offset === '0') return json(fixture.dracula.page0);
        if (offset === '1500') return json(fixture.dracula.page1500);
        return json({ size: fixture.dracula.size, entries: [] });
      }
      if (at.pathname === '/works/OL24218144W/editions.json') return json(fixture.oneEdition.editions);
      if (at.pathname === '/search.json' && at.searchParams.get('q') === 'key:/works/OL85892W') return json(fixture.dracula.workRow);
      if (at.pathname === '/search.json' && at.searchParams.get('q') === 'key:/works/OL24218144W') return json(fixture.oneEdition.workRow);
      if (at.pathname === '/books/OL10416488M.json') return json(fixture.dracula.isbn9780141439846);
      if (at.pathname === '/isbn/9780141439846.json') return new Response(null, { status: 302, headers: { location: '/books/OL10416488M.json' } });
      return json({}, 404);
    }
    if (at.hostname === 'archive.org' && at.pathname === '/advancedsearch.php') {
      const q = at.searchParams.get('q') ?? '';
      return json(q.includes('journalofdisappo0000barb') ? fixture.oneEdition.scans : fixture.dracula.scans);
    }
    return json({}, 404);
  };
  return { fetch, urls };
}

(async () => {
  /* 1. Reading the saved editions ----------------------------------------------------------------------------- */
  const raw = [...fixture.dracula.page0.entries, ...fixture.dracula.page1500.entries];
  const parsed = raw.map((entry) => editions.parseEdition(entry, NOW));
  ok(parsed.every((edition) => edition !== null), 'every saved Dracula edition parses');
  ok(parsed.every((edition) => edition.work === 'OL85892W'), 'each knows its work');
  ok(parsed.every((edition) => /^OL[1-9][0-9]*M$/.test(edition.key)), 'each has its edition key');
  const text = (edition) => [edition.title, edition.subtitle, edition.editionName, edition.byStatement, edition.notes, ...edition.publishers, ...edition.contributors, ...edition.contents].join(' ');
  ok(parsed.every((edition) => !/<[a-z/!]/i.test(text(edition))), 'all of it is plain text');
  const withNotes = parsed.find((edition) => edition.key === 'OL32094672M');
  ok(withNotes && withNotes.notes.length > 0 && typeof withNotes.notes === 'string', 'notes given as { value } are read as text');
  ok(withNotes.editionName === 'Éd. revue.', 'the edition name as printed');
  ok(parsed.some((edition) => edition.contributors.some((line) => / by /.test(line))), 'contributors read as "Role by Name"');
  const one = editions.parseEdition(fixture.oneEdition.editions.entries[0], NOW);
  same(one.contributors, ['Barbellion, W. N. P., 1889-1919.'], 'a contribution with no role is kept as it is');
  ok(/Chatto & Windus/.test(one.notes), 'the one-edition book`s notes are read');
  same(one.pages, 383, 'pages read from `pagination` (383 p.) when there is no number_of_pages');
  same(one.year, 1984, 'its year');
  const isbnEdition = editions.parseEdition(fixture.dracula.isbn9780141439846, NOW);
  same([isbnEdition.format, isbnEdition.isbn, isbnEdition.year, isbnEdition.cover], ['PAPERBACK', '9780141439846', 2003, 10541361], 'format, ISBN-13, year and the first real cover (-1 skipped)');
  same(['Hardcover', 'Mass Market Paperback', 'E-book', 'Audio CD', 'Board book'].map(editions.formatOf), ['HARDCOVER', 'PAPERBACK', 'EBOOK', 'AUDIO', 'BOARD BOOK'], 'the formats');
  same(['October 1, 2003', '1897?', 'c1965', '[n.d.]', '3000'].map((date) => editions.yearOf(date, NOW)), [2003, 1897, 1965, null, null], 'years from printed dates');
  same(
    editions.parseEdition({ key: '/books/OL1M', title: 'x', contributors: [{ role: 'Introduction', name: 'A. N. Other' }], contributions: ['B. Writer (Notes)'] }, NOW).contributors,
    ['Notes by B. Writer', 'Introduction by A. N. Other'],
    'both of Open Library`s names for who else is in it',
  );

  /* 2. Hostile values ------------------------------------------------------------------------------------------- */
  same(editions.parseEdition({ key: '/books/../OL1M', title: 'x' }, NOW), null, 'a key that is not an edition key is refused');
  same(editions.parseEdition({ key: 'https://evil.example/books/OL1M', title: 'x' }, NOW), null, 'a key on another site too');
  same(editions.parseEdition({ key: '/books/OL1M', title: '<b></b>' }, NOW), null, 'no title, no edition');
  const hostile = editions.parseEdition(
    {
      key: '/books/OL1M',
      title: '<script>alert(1)</script>Fine <b>Title</b>',
      ocaid: '../../etc/passwd',
      covers: [-1, '5', 1.5],
      works: [{ key: 'https://evil.example/works/OL1W' }],
      languages: [{ key: '/languages/<x>' }, 'eng'],
      isbn_13: ['9780000000000; drop'],
      notes: { value: '<img src=x onerror=alert(1)>A note' },
      table_of_contents: [{ title: '<a href="javascript:x">Chapter</a>' }],
      number_of_pages: -4,
    },
    NOW,
  );
  same([hostile.title, hostile.ocaid, hostile.cover, hostile.work, hostile.languages, hostile.isbn, hostile.notes, hostile.contents, hostile.pages], ['Fine Title', null, null, null, [], '', 'A note', ['Chapter'], null], 'markup stripped and every bad value dropped');

  /* 3. The list: read whole, ordered, filtered, paged ------------------------------------------------------------- */
  const web = savedWeb();
  const list = await listing.listEditions({ ref: 'books:OL85892W-pg345', offset: 0, show: 'all', order: 'details', at: null }, web.fetch, NOW);
  ok(web.urls.every((url) => /^https:\/\/(openlibrary\.org|archive\.org)\//.test(url)), 'only openlibrary.org and archive.org are asked');
  same(
    web.urls.filter((url) => url.includes('editions.json')).map((url) => new URL(url).searchParams.get('offset')).sort(),
    ['0', '1000', '1500', '500'],
    'Dracula`s 1,920 editions are read 500 at a time',
  );
  ok(web.urls.filter((url) => url.includes('editions.json')).every((url) => new URL(url).searchParams.get('limit') === '500'), 'each asks 500');
  same(web.urls.filter((url) => url.includes('archive.org')).length, 1, 'one Archive request for all the scans');
  ok(!/edition_count|ratings|want|already/.test(new URL(web.urls.find((url) => url.includes('archive.org'))).searchParams.getAll('fl[]').join()), 'the Archive is asked only identifier and access-restricted-item');
  same([list.size, list.read, list.matching, list.editions.length, list.next], [1920, 22, 22, 22, null], 'size as Open Library says, 22 read, one page');
  same(list.gutenbergRef, 'books:OL85892W-pg345', 'the work`s Gutenberg copy');
  const detailedKeys = new Set(fixture.dracula.page1500.entries.map((entry) => entry.key.slice('/books/'.length)));
  const firstBare = list.editions.findIndex((edition) => !detailedKeys.has(edition.key));
  ok(firstBare === detailedKeys.size && list.editions.slice(firstBare).every((edition) => !detailedKeys.has(edition.key)), 'every detailed edition stands before every bare reprint');
  ok(list.editions.every((edition, index, all) => index === 0 || editions.detailScore(all[index - 1]) >= editions.detailScore(edition)), 'most details first');
  // The Gutenberg number comes from Open Library, never from the address the browser sent.
  const forged = await listing.listEditions({ ref: 'books:OL85892W-pg999', offset: 0, show: 'all', order: 'details', at: null }, savedWeb().fetch, NOW);
  same(forged.gutenbergRef, 'books:OL85892W-pg345', 'a forged Gutenberg number in the address is ignored');
  const newest = await listing.listEditions({ ref: 'books:OL85892W', offset: 0, show: 'all', order: 'newest', at: null }, savedWeb().fetch, NOW);
  const years = newest.editions.map((edition) => edition.year).filter((year) => year !== null);
  ok(years.every((year, index) => index === 0 || years[index - 1] >= year), 'NEWEST: by year, newest first');
  const oldest = await listing.listEditions({ ref: 'books:OL85892W', offset: 0, show: 'all', order: 'oldest', at: null }, savedWeb().fetch, NOW);
  const oldYears = oldest.editions.map((edition) => edition.year).filter((year) => year !== null);
  ok(oldYears.every((year, index) => index === 0 || oldYears[index - 1] <= year) && oldYears[0] < years[0], 'OLDEST: oldest first');
  const detailed = await listing.listEditions({ ref: 'books:OL85892W', offset: 0, show: 'details', order: 'details', at: null }, savedWeb().fetch, NOW);
  ok(detailed.matching > 0 && detailed.editions.every(editions.hasDetails), 'HAS DETAILS keeps only editions with contributors, notes or contents');
  ok(detailed.editions.every((edition) => detailedKeys.has(edition.key)), 'and no bare reprint');
  const readable = await listing.listEditions({ ref: 'books:OL85892W', offset: 0, show: 'readable', order: 'details', at: null }, savedWeb().fetch, NOW);
  same(readable.matching, 0, 'CAN BE READ HERE: none, since every saved Dracula scan is a lending copy');
  ok(list.editions.filter((edition) => edition.ocaid && edition.ocaid !== 'dracul00stok').every((edition) => edition.scan === 'lent'), 'the scans the Archive calls access-restricted are lent');
  same(list.editions.find((edition) => edition.ocaid === 'dracul00stok').scan, null, 'a scan the Archive doesn`t find is unknown');
  // Fifty to a page.
  const many = Array.from({ length: 60 }, (_, index) => ({ key: `/books/OL${index + 1}M`, title: `Copy ${index + 1}`, works: [{ key: '/works/OL85892W' }] }));
  const paging = savedWeb({ 'https://openlibrary.org/works/OL85892W/editions.json?limit=500&offset=0': () => json({ size: 60, entries: many }) });
  const page1 = await listing.listEditions({ ref: 'books:OL85892W', offset: 0, show: 'all', order: 'newest', at: null }, paging.fetch, NOW);
  const page2 = await listing.listEditions({ ref: 'books:OL85892W', offset: 50, show: 'all', order: 'newest', at: null }, paging.fetch, NOW);
  same([page1.editions.length, page1.next, page2.editions.length, page2.next], [50, 50, 10, null], 'fifty to a page, then the rest');
  // Another work's edition slipped into the answer is left out.
  const stray = savedWeb({ 'https://openlibrary.org/works/OL85892W/editions.json?limit=500&offset=0': () => json({ size: 2, entries: [many[0], { key: '/books/OL99M', title: 'Other', works: [{ key: '/works/OL1W' }] }] }) });
  same((await listing.listEditions({ ref: 'books:OL85892W', offset: 0, show: 'all', order: 'details', at: null }, stray.fetch, NOW)).editions.map((edition) => edition.key), ['OL1M'], 'an edition of another work is left out');
  same(await listing.listEditions({ ref: 'audiobooks:271', offset: 0, show: 'all', order: 'details', at: null }, savedWeb().fetch, NOW), null, 'only an Open Library book has editions');

  /* 4. Opened at an edition --------------------------------------------------------------------------------------- */
  const atListed = await listing.listEditions({ ref: 'books:OL85892W', offset: 0, show: 'all', order: 'details', at: 'OL32094672M' }, savedWeb().fetch, NOW);
  same(atListed.at && atListed.at.key, 'OL32094672M', 'an edition in the list');
  const atAlone = savedWeb();
  const atOwn = await listing.listEditions({ ref: 'books:OL85892W', offset: 0, show: 'all', order: 'details', at: 'OL10416488M' }, atAlone.fetch, NOW);
  same(atOwn.at && [atOwn.at.key, atOwn.at.scan], ['OL10416488M', null], 'an edition not in what was read is read on its own');
  ok(atAlone.urls.some((url) => url === 'https://openlibrary.org/books/OL10416488M.json'), 'from its own address');
  const elsewhere = await listing.listEditions({ ref: 'books:OL24218144W', offset: 0, show: 'all', order: 'details', at: 'OL10416488M' }, savedWeb().fetch, NOW);
  same(elsewhere.at, null, 'an edition of another book is not shown as this one`s');

  /* 5. READ / BORROW / NO FREE COPY -------------------------------------------------------------------------------- */
  // Luke, 2026-11-13 ("any book can be read in the ereader"): every way opens inside /read. BORROW and SCAN-ON-ARCHIVE
  // route through /read/internet_archive:<ocaid>, where the reader shows the Archive's own viewer (lending flow carried
  // by the embed). NO FREE COPY opens /read/books:<work>, where the reader shows a page with a link to Open Library.
  const base = { ...editions.parseEdition({ key: '/books/OL5M', title: 'x' }, NOW), work: 'OL1W' };
  const kinds = (edition, work = { gutenbergRef: null, ipfsCid: null }) => editions.waysToRead(edition, work).map((way) => `${way.kind} ${way.href}`);
  same(kinds({ ...base, ocaid: 'freescan', scan: 'free' }), ['scan /read/internet_archive:freescan'], 'a free scan reads in the site`s reader');
  same(kinds({ ...base, ocaid: 'lentscan', scan: 'lent' }), ['borrow /read/internet_archive:lentscan'], 'a lent scan opens the Archive`s viewer inside /read');
  same(kinds({ ...base, ocaid: 'unknown', scan: null }), ['archive /read/internet_archive:unknown'], 'a scan the Archive said nothing about: inside /read too');
  same(kinds({ ...base, scan: null }), ['none /read/books:OL1W'], 'no scan and no copy: NO FREE COPY opens the reader on the work');
  const lcp = await listing.readScanAccess(['made_up_lcp'], async () => json({ response: { docs: [{ identifier: 'made_up_lcp' }] } }));
  same(lcp.get('made_up_lcp'), 'lent', 'an LCP lending copy is lent even without the flag');
  same(kinds({ ...base, scan: null }, { gutenbergRef: 'books:OL85892W-pg345', ipfsCid: 'QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o' }), ['gutenberg /read/books:OL85892W-pg345', 'ipfs /read/ipfs:QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o'], 'the work`s Gutenberg and IPFS copies');
  const lentDracula = list.editions.find((edition) => edition.scan === 'lent');
  same(kinds(lentDracula, list).map((line) => line.split(' ')[0]), ['borrow', 'gutenberg'], 'a lent Dracula: BORROW (inside /read), and Gutenberg`s text in the reader');
  const oneList = await listing.listEditions({ ref: 'books:OL24218144W', offset: 0, show: 'all', order: 'details', at: null }, savedWeb().fetch, NOW);
  same([oneList.size, oneList.editions.length, oneList.gutenbergRef], [1, 1, null], 'the one-edition book: one edition, no Gutenberg copy');
  same(kinds(oneList.editions[0], oneList), ['borrow /read/internet_archive:journalofdisappo0000barb'], 'its lending-library scan: BORROW inside /read');

  /* 5b. Any book opens inside /read ------------------------------------------------------------------------------- */
  const { isReadable } = require(path.join(OUT, 'lib', 'books', 'types.js'));
  ok(isReadable('books:OL85892W'), 'a bare Open Library work ref is readable');
  ok(isReadable('books:OL85892W-pg345'), 'a Gutenberg ref is readable');
  ok(isReadable('internet_archive:draculaIA'), 'an Internet Archive ref is readable');
  ok(!isReadable('books:OL85892M'), 'an edition key is not a bare work ref');
  // The route answers { redirect } for a bare work ref the resolver resolves, and { noFreeCopy } when nothing is found.
  const resolver = await listing.resolveWorkCopy('OL85892W', savedWeb().fetch, NOW);
  same(resolver, { ref: 'books:OL85892W-pg345' }, 'Dracula resolves to its Gutenberg copy');
  const noCopy = await listing.resolveWorkCopy('OL999999W', async (url) => {
    const at = new URL(url);
    if (at.pathname === '/search.json') return json({ docs: [] });
    if (at.pathname === '/works/OL999999W/editions.json') return json({ size: 0, entries: [] });
    return json({}, 404);
  }, NOW);
  same(noCopy, null, 'a work with no copy at all resolves to null');
  const archiveResolve = await listing.resolveWorkCopy('OL24218144W', savedWeb().fetch, NOW);
  same(archiveResolve, { ref: 'internet_archive:journalofdisappo0000barb' }, 'a work with only a scan resolves to its Archive ref (reader opens the viewer)');
  // openBookEpub for a bare work ref signals a redirect; for a work with no copy, a noFreeCopy marker.
  const redirected = await books.openBookEpub('books:OL85892W', savedWeb().fetch);
  same(redirected, { redirect: 'books:OL85892W-pg345' }, 'the route tells the reader where the copy is');
  const nothing = await books.openBookEpub('books:OL999999W', async (url) => {
    const at = new URL(url);
    if (at.pathname === '/search.json') return json({ docs: [] });
    if (at.pathname === '/works/OL999999W/editions.json') return json({ size: 0, entries: [] });
    return json({}, 404);
  });
  same(nothing, { noFreeCopy: { work: 'OL999999W', openLibraryUrl: 'https://openlibrary.org/works/OL999999W' } }, 'a work with no free copy: the reader shows a link to Open Library');
  // archiveBookOf for a lending-library item no longer refuses outright: EPUB and PDF stay null so the reader shows the Archive's viewer.
  const lentStub = books.archiveBookOf({ files: [{ name: 'book.epub', size: 1024 }], metadata: { mediatype: 'texts', 'access-restricted-item': 'true' } });
  same([lentStub && lentStub.epub, lentStub && lentStub.pdf, Array.isArray(lentStub && lentStub.servers) ? lentStub.servers.length : -1], [null, null, 0], 'a lending-library item is a viewer-only stub, never a file passed through us');
  const darkItem = books.archiveBookOf({ files: [], is_dark: true, metadata: { mediatype: 'texts' } });
  same(darkItem, null, 'a dark item is still refused');

  /* 6. ISBN --------------------------------------------------------------------------------------------------------- */
  same(['978-0-14-143984-6', 'isbn 014143984x', 'ISBN-10: 0-8044-2957-X', '9780141439847', '12345', 'dracula'].map(editions.isbnOf), ['9780141439846', '014143984X', '080442957X', null, null, null], 'ISBNs read, a wrong check digit is not one');
  const isbnWeb = savedWeb();
  const found = await search.booksSearch.search('978-0-14-143984-6', null, { fetch: isbnWeb.fetch, now: () => NOW });
  same(found.items.map((item) => [item.id, item.book && item.book.edition]), [['books:OL85892W-pg345', 'OL10416488M']], 'an ISBN finds its edition`s book, opened at that edition');
  ok(isbnWeb.urls[0] === 'https://openlibrary.org/isbn/9780141439846.json' && isbnWeb.urls[1] === 'https://openlibrary.org/books/OL10416488M.json', 'through Open Library`s redirect on its own host');
  const offsite = savedWeb({ 'https://openlibrary.org/isbn/9780141439846.json': () => new Response(null, { status: 302, headers: { location: 'https://evil.example/books/OL10416488M.json' } }) });
  await search.booksSearch.search('9780141439846', null, { fetch: offsite.fetch, now: () => NOW });
  ok(!offsite.urls.some((url) => url.includes('evil.example')), 'a redirect to another host is never followed');
  ok(offsite.urls.some((url) => url.includes('/search.json?q=9780141439846')), 'and the number is searched as words instead');

  /* 7. Search keeps every work; an edition's address -------------------------------------------------------------------- */
  ok(!/id_project_gutenberg:\*/.test(new URL(search.booksSearchUrl('dracula', 1)).searchParams.get('q')), 'no Gutenberg-only filter');
  ok(new URL(search.booksSearchUrl('dracula', 1)).searchParams.get('fields').split(',').includes('edition_count'), 'how many editions is asked');
  const row = search.toBookItem(fixture.oneEdition.workRow.docs[0], NOW.toISOString());
  same([row.id, row.book], ['books:OL24218144W', { editions: 1 }], 'a work with no Gutenberg copy is a row, with its edition count');
  ok(books.BOOK_REF.test('edition:OL10416488M') && !books.BOOK_REF.test('edition:OL1W') && !books.BOOK_REF.test('edition:OL1M/../x'), 'edition:OL…M is a book`s address');
  const info = await books.readBookInfo('edition:OL10416488M', savedWeb().fetch, NOW);
  same([info.id, info.book.edition, info.book.editions], ['books:OL85892W-pg345', 'OL10416488M', 1920], 'an edition`s address answers with its book, carrying the edition');
  same(hrefOf({ kind: 'web', ref: 'edition:OL10416488M', title: 'Dracula' }), '/media/book/edition:OL10416488M', 'a letter`s card for an edition goes to it');
  same(await books.openBookEpub('edition:OL10416488M', savedWeb().fetch), null, 'an edition`s address is never a file to fetch');

  console.log(`ok: ${passed} assertions (every edition of every book)`);
  process.exitCode = 0;
})().catch((error) => {
  console.log(`FAIL ${error.stack}`);
  process.exit(1);
});
