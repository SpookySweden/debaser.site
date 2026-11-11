/*
 * WEB search everywhere: BOOKS (Open Library) and AUDIOBOOKS (LibriVox), offline (SPEC-books.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/search/providers/books.ts app/lib/web/search/providers/audiobooks.ts app/lib/web/books.ts app/lib/web/audio-files.ts app/lib/web/row-addresses.ts --outDir Temp/out-web-search-books --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the fixtures (5 real Open Library works and 5 real LibriVox books for "dracula", 2026-11-10; LibriVox's summaries are
 *   replaced by a short line, so only its shape is kept) parse into rows the page would draw: link and cover, never a player
 * - every work is asked for and kept (SPEC-book-editions.md, Luke 2026-11-11, replacing that day's Gutenberg-only rule), each
 *   carrying how many editions it has; a work with a Project Gutenberg copy carries its number (READ opens it in the reader)
 *   and comes first, then the library scans, then the other works
 * - one request a BOOKS search; the date orders are Open Library's own; a TYPE that isn't text finds nothing
 * - AUDIOBOOKS asks the start of a title, then the whole title, then an author, stopping at the first that finds something;
 *   a 404 is "nothing", not a failure; DATE reads up to 200 and orders them itself
 * - the reader's EPUB comes only from Project Gutenberg's own addresses for a book with a Gutenberg number, and a chapter
 *   of an audiobook only from archive.org
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { NOW, makeAsserts, checkItem, fakeFetch } = require('./web-search-check-kit.cjs');

const OUT = join(__dirname, '..', 'Temp', 'out-web-search-books', 'lib', 'web');
const books = require(join(OUT, 'search', 'providers', 'books.js'));
const audio = require(join(OUT, 'search', 'providers', 'audiobooks.js'));
const reading = require(join(OUT, 'books.js'));
const files = require(join(OUT, 'audio-files.js'));
const { rowAddresses } = require(join(OUT, 'row-addresses.js'));
const asserts = makeAsserts('WEB search: BOOKS and AUDIOBOOKS');
const { ok, same } = asserts;
const deps = (fetch, order) => ({ fetch, now: () => new Date(NOW), order });

(async () => {
  /* BOOKS ------------------------------------------------------------------------------------- */
  const olFixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'search-books.json'), 'utf8'));
  // (2026-11-11, Luke: "currently only two books show") BOOKS also asks the Archive for its library scans: made-up answers.
  const iaScans = {
    response: {
      numFound: 3,
      docs: [
        { identifier: 'made_up_scan_one', title: 'A Made-Up Library Scan', mediatype: 'texts', publicdate: '2009-01-01T00:00:00Z', creator: 'Nobody' },
        { identifier: 'made_up_lent', title: 'Lent Only', mediatype: 'texts', publicdate: '2009-01-01T00:00:00Z', 'access-restricted-item': 'true' },
        { identifier: 'made_up_film', title: 'Not A Book', mediatype: 'movies', publicdate: '2009-01-01T00:00:00Z' },
      ],
    },
  };
  const urls = [];
  const routed = (ol, ia) => async (url) => {
    urls.push(url);
    const host = new URL(url).hostname;
    const body = host === 'openlibrary.org' ? ol : ia;
    if (body === null) return new Response('down', { status: 503 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const fetch = routed(olFixture, iaScans);
  const page = await books.booksSearch.search('dracula', null, deps(fetch));
  same(urls.length, 2, 'two requests a BOOKS search: Open Library and the Archive, at once');
  const asked = new URL(urls.find((url) => url.includes('openlibrary.org')));
  const askedIa = new URL(urls.find((url) => url.includes('archive.org')));
  ok(/mediatype:\(texts\) AND NOT access-restricted-item:true/.test(askedIa.searchParams.get('q')), 'the Archive is asked for texts, never a lending-library item');
  ok(/collection:\(americana OR toronto OR cdl OR library_of_congress OR europeanlibraries OR universallibrary\)/.test(askedIa.searchParams.get('q')), 'from the libraries` scans');
  ok(/title:\(dracula\)/.test(askedIa.searchParams.get('q')), 'the words in the title');
  ok(!/gutenberg/.test(askedIa.searchParams.get('q')), 'not the Archive`s Gutenberg mirror (those are Open Library`s rows)');
  same(asked.hostname, 'openlibrary.org', 'asked of Open Library');
  // SPEC-book-editions.md (Luke, 2026-11-11): the edition count is asked (how many editions exist, not a count of people);
  // no ratings or reading counts are.
  const fieldsAsked = asked.searchParams.get('fields').split(',');
  ok(fieldsAsked.includes('edition_count'), 'how many editions each work has is asked');
  ok(!fieldsAsked.some((field) => field !== 'edition_count' && /count|rating|want|read|edition/.test(field)), 'no counts of people or ratings asked for');
  // Every book is found now, not only those with a Gutenberg copy (the Gutenberg-only filter is gone).
  same(asked.searchParams.get('q'), 'dracula', 'the words alone: every work is asked for');
  ok(!new URL(books.booksSearchUrl('', 1, 'austen')).searchParams.has('q') && new URL(books.booksSearchUrl('', 1, 'austen')).searchParams.get('author') === 'austen', 'an author search asks the author alone');
  ok(olFixture.docs.some((doc) => !doc.id_project_gutenberg), 'the fixture holds works without a Gutenberg copy');
  const workRows = page.items.filter((item) => item.platform === 'books');
  const scanRows = page.items.filter((item) => item.platform === 'internet_archive');
  same(workRows.length, olFixture.docs.length, 'every Open Library work is a row, with or without a Gutenberg copy');
  for (const item of workRows) {
    checkItem(asserts, rowAddresses, item, item.title);
    same(item.kind, 'text', 'a book is text');
    ok(item.embedUrl === undefined, 'no player');
    ok(item.description === undefined, 'and has no "free to read" line (Luke, 2026-11-11): its date is the year it came out');
    ok(item.book && Number.isInteger(item.book.editions), 'each carries how many editions it has');
  }
  same(page.items[0].externalId, 'OL85892W-pg345', 'a work Project Gutenberg has carries its number, and comes first');
  same(page.items.findIndex((item) => item.platform === 'internet_archive'), workRows.filter((item) => /-pg[1-9]/.test(item.externalId)).length, 'then the library scans');
  ok(page.items.slice(page.items.findIndex((item) => item.platform === 'internet_archive') + 1).every((item) => item.platform === 'books' && !/-pg[1-9]/.test(item.externalId)), 'then the other works');
  same(scanRows.map((item) => item.id), ['internet_archive:made_up_scan_one'], 'the lent item and the film are left out');
  checkItem(asserts, rowAddresses, scanRows[0], scanRows[0].title);
  same(scanRows[0].kind, 'text');
  same(page.next, 2, 'and there is more to page through');
  urls.length = 0;
  const olDown = await books.booksSearch.search('dracula', null, deps(routed(null, iaScans)));
  same(olDown.items.map((item) => item.id), ['internet_archive:made_up_scan_one'], 'Open Library down: the scans still show');
  const iaDown = await books.booksSearch.search('dracula', null, deps(routed(olFixture, null)));
  ok(iaDown.items.length === olFixture.docs.length && iaDown.items.every((item) => item.platform === 'books'), 'the Archive down: the Open Library rows still show');
  let bothDown = null;
  try {
    await books.booksSearch.search('dracula', null, deps(routed(null, null)));
  } catch (error) {
    bothDown = error;
  }
  ok(bothDown !== null, 'both down: the search says so');
  same(books.bookParts('OL85892W-pg345'), { work: 'OL85892W', gutenberg: '345' });
  same(books.bookParts('OL85892W/../x'), null, 'a bad id is refused');
  same(new URL(books.booksSearchUrl('dracula', 2, '', 'newest')).searchParams.get('sort'), 'new', 'newest is Open Library`s own sort=new');
  same(new URL(books.booksSearchUrl('dracula', 2, '', 'oldest')).searchParams.get('sort'), 'old', 'oldest is sort=old');
  ok(!new URL(books.booksSearchUrl('dracula', 1)).searchParams.has('sort'), 'best match sends no sort');
  same((await books.booksSearch.search('dracula', null, deps(fakeFetch(olFixture).fetch), '', 'video')).items, [], 'TYPE VIDEO finds no books');
  const hostile = books.toBookItem({ key: '/works/OL1W', title: '<script>x</script>Fine', first_publish_year: 1900, cover_i: 5, id_project_gutenberg: ['1;drop'] }, NOW);
  same(hostile.externalId, 'OL1W', 'a Gutenberg number that is not a number is dropped');
  ok(!/<script/.test(hostile.title), 'markup is stripped');
  same(books.toBookItem({ key: '/works/OL1W', title: 'No year' }, NOW), null, 'a work with no year is skipped');
  same(books.toBookItem({ key: 'https://evil.example/works/OL1W', title: 'x', first_publish_year: 1900 }, NOW), null, 'a key that is not a work key is skipped');

  /* AUDIOBOOKS -------------------------------------------------------------------------------- */
  const lvFixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'web', 'search-audiobooks.json'), 'utf8'));
  const lv = fakeFetch(lvFixture);
  const heard = await audio.audiobooksSearch.search('dracula', null, deps(lv.fetch));
  same(lv.urls.length, 1, 'the start of the title found something: one request');
  same(new URL(lv.urls[0]).searchParams.get('title'), '^dracula', 'it asked the start of a title first');
  ok(heard.items.length === 5, 'the real books parse');
  for (const item of heard.items) {
    checkItem(asserts, rowAddresses, item, item.title);
    same(item.kind, 'audio', 'an audiobook is audio');
    ok(!/<[a-z]/i.test(item.description ?? ''), 'its summary is plain text');
  }
  let calls = 0;
  const nothingThenSome = async (url) => {
    calls += 1;
    const status = calls < 3 ? 404 : 200;
    return new Response(status === 404 ? JSON.stringify({ error: 'Audiobooks could not be found' }) : JSON.stringify(lvFixture), { status, headers: { 'content-type': 'application/json' } });
  };
  const third = await audio.audiobooksSearch.search('bram stoker', null, deps(nothingThenSome));
  same(calls, 3, 'a 404 is nothing: it went on to the whole title, then the author');
  same(third.items.length, 5, 'and the author found them');
  same(audio.asksFor('bram stoker', '')[2], { field: 'author', value: 'stoker' }, 'the author asked is the last word');
  const dated = fakeFetch(lvFixture);
  const oldest = await audio.audiobooksSearch.search('dracula', null, deps(dated.fetch, 'oldest'));
  same(new URL(dated.urls[0]).searchParams.get('limit'), '200', 'DATE reads up to 200');
  ok(oldest.items.every((item, index, all) => index === 0 || all[index - 1].publishedAt <= item.publishedAt), 'and orders them oldest first itself');
  same((await audio.audiobooksSearch.search('dracula', null, deps(fakeFetch(lvFixture).fetch), '', 'text')).items, [], 'TYPE TEXT finds no audiobooks');
  same(audio.toAudiobookItem({ id: '1', title: 'x', url_librivox: 'https://evil.example/x/', copyright_year: '1900' }, NOW), null, 'a page off LibriVox is skipped');

  /* The reader's book (SPEC-reader.md: the EPUB, pictures included) and the bar's chapters ---------- */
  same(
    reading.gutenbergEpubUrls('345'),
    ['https://www.gutenberg.org/cache/epub/345/pg345-images-3.epub', 'https://www.gutenberg.org/cache/epub/345/pg345-images.epub', 'https://www.gutenberg.org/cache/epub/345/pg345.epub'],
    'the book is Gutenberg`s own EPUB files for it, pictured editions first',
  );
  const epub = fakeFetch('PK made-up bytes');
  const opened = await reading.openBookEpub('books:OL85892W-pg345', epub.fetch);
  same(await new Response(opened.body).text(), 'PK made-up bytes', 'the file is passed through as it came');
  same(await reading.openBookEpub('books:OL85892W', epub.fetch), null, 'a book with no Gutenberg copy has no file here');
  same(await reading.openBookEpub('audiobooks:271', epub.fetch), null, 'nor does an audiobook');
  same(await reading.openBookEpub('books:OL1W-pg1/../../x', epub.fetch), null, 'a bad ref is refused');
  same(epub.urls.length, 1, 'only the one good ref fetched anything');
  const feed = `<?xml version="1.0"?><rss><channel><title>A Book</title><item><title>Chapter 1</title><enclosure url="https://www.archive.org/download/a_book/ch1.mp3" type="audio/mpeg"/><itunes:duration>10:00</itunes:duration></item><item><title>Elsewhere</title><enclosure url="https://evil.example/ch2.mp3" type="audio/mpeg"/></item></channel></rss>`;
  const parsed = files.parseLibrivoxFeed(feed);
  same(parsed.files.length, 1, 'a chapter off archive.org is left out');
  same(parsed.files[0].seconds, 600, 'its running time is read');

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${error.stack}`);
  process.exit(1);
});
