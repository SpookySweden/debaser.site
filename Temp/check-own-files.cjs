/*
 * The READ module's own files (Luke, 2026-11-13: "upload pdfs to be read, which will then automatically hook to the correct
 * book and all its variants"), offline: how a reader's PDF or EPUB is matched to its book.
 *   npx tsc app/lib/books/own-files.ts --outDir Temp/out-own-files --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-own-files.cjs
 *
 * - ISBNs: the check digits of both kinds; a 13-digit one found anywhere, a 10-digit one only after the word ISBN (or in an
 *   identifier field); hyphens and spaces inside; an ISBN-10 and its ISBN-13 are one book; a phone number or a page count
 *   with a bad check digit is not one
 * - a title written inside a file, unless it is a word processor's or scanner's leftover
 * - a file name's words, with its clutter (sites, formats, years, numbers) taken out; a name of nothing is nothing
 * - the order a file is matched in: its ISBN first, then the title inside, then its name; what each asks Open Library
 *   (the number, or words only), and nothing else
 * - the pages read for an ISBN: a PDF's first twelve and last two, an EPUB's first six sections
 * Made-up text only (the ISBNs are the standard worked examples, not books read here).
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, 'out-own-files');
const own = require(path.join(OUT, 'lib/books/own-files.js'));

(async () => {
  /* 1. ISBNs ------------------------------------------------------------------------------------------------ */
  assert.equal(own.isbn13Valid('9780306406157'), true, 'the worked example ISBN-13 holds');
  assert.equal(own.isbn13Valid('9780306406158'), false, 'one digit off is not an ISBN');
  assert.equal(own.isbn13Valid('1234567890128'), false, 'only 978 and 979 are books');
  assert.equal(own.isbn10Valid('0306406152'), true);
  assert.equal(own.isbn10Valid('080442957X'), true, 'X is ten');
  assert.equal(own.isbn10Valid('0306406153'), false);
  assert.equal(own.isbn13Of('0306406152'), '9780306406157', 'an ISBN-10 is its ISBN-13');

  const page = 'The purple kettle press. First printing.\nISBN 978-0-306-40615-7 (paperback)\nISBN-10: 0 306 40615 2\nPrinted in nowhere.';
  assert.deepEqual(own.isbnsIn(page), ['9780306406157'], 'hyphens and spaces inside; the -10 of the same book is the same book');
  assert.deepEqual(own.isbnsIn('Call 0306406152 for the kettle.'), [], 'ten digits without ISBN before them are not one (one in eleven passes by chance)');
  assert.deepEqual(own.isbnsIn('urn:isbn:0306406152', { labelled: true }), ['9780306406157'], 'an identifier field needs no label');
  assert.deepEqual(own.isbnsIn('urn:uuid:9780306406158'), [], 'a wrong check digit is nothing');
  assert.deepEqual(own.isbnsIn('Page 12 of 300. 9780306406157 and 979-10-90636-07-1.'), ['9780306406157', '9791090636071'], 'a 13-digit one anywhere, first found first');
  assert.deepEqual(own.isbnsIn('ISBN 080442957X'), ['9780804429573'], 'an X at the end');
  assert.equal(own.isbnsIn('9780306406157 '.repeat(20)).length, 1, 'the same one once');
  console.log('  ok    ISBNs: both check digits, labels, hyphens, one book found two ways');

  /* 2. A title written inside a file ------------------------------------------------------------------------- */
  assert.equal(own.usableTitle('Microsoft Word - The Purple Kettle.docx'), 'The Purple Kettle', "a word processor's leftovers come off");
  for (const junk of ['untitled', 'Untitled-1', 'Document1', 'scan_0001', '', '   ', '12345', 'book.pdf', 'a1b2c3d4e5f6a7b8c9d0e1f2']) assert.equal(own.usableTitle(junk), '', `"${junk}" is no title`);
  assert.equal(own.usableTitle('  The   Purple\nKettle '), 'The Purple Kettle');
  console.log('  ok    titles inside: real ones kept, leftovers dropped');

  /* 3. A file's name -------------------------------------------------------------------------------------- */
  assert.equal(own.nameWords('The_Purple_Kettle_(1911)_[EPUB].pdf'), 'The Purple Kettle', 'years and formats in brackets go');
  assert.equal(own.nameWords('Quiet Lamp - The Purple Kettle (z-lib.org).epub'), 'Quiet Lamp The Purple Kettle', 'a site in brackets goes, the author stays');
  assert.equal(own.nameWords('purple.kettle.retail.ebook.pdf'), 'purple kettle');
  assert.equal(own.nameWords('scan0001234567.pdf'), '', 'a scanner number is no name');
  assert.equal(own.nameWords('IMG 1.pdf'), '', 'no real word of three letters');
  console.log('  ok    file names: clutter out, a name of nothing is nothing');

  /* 4. The order a file is matched in, and what is asked -------------------------------------------------- */
  const asked = [];
  const answering = (answers) => async (url) => {
    asked.push(String(url));
    return { ok: true, json: async () => answers.shift() ?? { docs: [] } };
  };
  const work = (id, title) => ({ docs: [{ key: `/works/${id}`, title, author_name: ['Quiet Lamp'], cover_i: 9, edition_count: 14 }] });

  let found = await own.matchFile({ isbns: ['9780306406157'], title: 'The Purple Kettle', author: 'Quiet Lamp', name: 'x.pdf' }, answering([work('OL1W', 'By number')]));
  assert.equal(found.how, 'isbn', 'the ISBN first');
  assert.equal(found.match.work, 'books:OL1W');
  assert.equal(found.match.editions, 14, 'with how many editions the book has');
  assert.match(asked[0], /^https:\/\/openlibrary\.org\/search\.json\?isbn=9780306406157&/, 'only the number is sent');
  assert.equal(asked.length, 1, 'found by the number: nothing else asked');

  asked.length = 0;
  found = await own.matchFile({ isbns: ['9780306406157'], title: 'The Purple Kettle', author: 'Quiet Lamp', name: 'x.pdf' }, answering([{ docs: [] }, work('OL2W', 'By title')]));
  assert.equal(found.how, 'inside', 'no edition with that number: the title written inside');
  assert.match(asked[1], /title=The\+Purple\+Kettle/);
  assert.match(asked[1], /author=Quiet\+Lamp/);

  asked.length = 0;
  found = await own.matchFile({ isbns: [], title: '', author: '', name: 'The_Purple_Kettle_(1911).pdf' }, answering([work('OL3W', 'By name')]));
  assert.equal(found.how, 'name', 'nothing inside: the words of its name');
  assert.match(asked[0], /q=The\+Purple\+Kettle/);
  assert.equal(new URL(asked[0]).searchParams.get('q'), 'The Purple Kettle', 'only the cleaned words of the name are sent');

  asked.length = 0;
  found = await own.matchFile({ isbns: [], title: '', author: '', name: 'scan0001234567.pdf' }, answering([]));
  assert.equal(found, null, 'nothing to go on: no match, and nothing asked');
  assert.equal(asked.length, 0);
  assert.equal(await own.workByIsbn('12345', answering([work('OL4W', 'x')])), null, 'a number that is no ISBN is never sent');
  console.log('  ok    matching: ISBN, then the title inside, then the name; only numbers or words are sent');

  /* 4b. The Internet Archive item a file names, a title of two books, an author with dates ----------------- */
  assert.equal(own.archiveIdIn('http://www.archive.org/details/purplekettle00lamp'), 'purplekettle00lamp', 'an Archive PDF names its item');
  assert.equal(own.archiveIdIn('archive.org/details/"><script>'), null, 'only an item id');
  assert.equal(own.archiveIdIn('no address here'), null);
  assert.deepEqual(own.titleTries('The purple kettle : and, the quiet lamp'), ['The purple kettle : and, the quiet lamp', 'The purple kettle'], 'a title of two books: all of it, then the first');
  assert.deepEqual(own.titleTries('The Purple Kettle'), ['The Purple Kettle']);
  assert.equal(own.cleanAuthor('Lamp, Quiet, 1832-1898'), 'Lamp, Quiet', "a catalogue's life dates come off");
  assert.equal(own.cleanAuthor('Quiet Lamp (1901-)'), 'Quiet Lamp');
  assert.equal(own.nameWords('purple-kettle-1911.pdf'), 'purple kettle', 'a year in a name goes');
  asked.length = 0;
  const archiveAnswer = { result: { openlibrary_work: 'OL7W', title: 'The purple kettle', creator: 'Lamp, Quiet, 1832-1898' } };
  found = await own.matchFile({ isbns: ['9780306406157'], title: 'x', author: '', name: 'x.pdf', archive: 'purplekettle00lamp' }, answering([archiveAnswer]));
  assert.equal(found.how, 'archive', 'the Archive item it came from first');
  assert.equal(found.match.work, 'books:OL7W');
  assert.equal(found.match.author, 'Lamp, Quiet');
  assert.equal(asked[0], 'https://archive.org/metadata/purplekettle00lamp/metadata', "only the item's id is asked");
  assert.equal(asked.length, 1);
  asked.length = 0;
  found = await own.matchFile({ isbns: [], title: 'The purple kettle : and, the quiet lamp', author: 'Quiet Lamp', name: 'x.pdf', archive: 'purplekettle00lamp' }, answering([{ result: {} }, { docs: [] }, { docs: [] }, work('OL8W', 'First')]));
  assert.equal(found.how, 'inside', 'an item naming no work: the title, all of it, then its first part');
  assert.equal(found.match.work, 'books:OL8W');
  assert.equal(new URL(asked[3]).searchParams.get('title'), 'The purple kettle', 'the first part is searched');
  console.log('  ok    the Archive item a file names; a title of two books; an author with dates');

  /* 5. The pages read for an ISBN ------------------------------------------------------------------------- */
  const read = [];
  const pdf = { sections: Array.from({ length: 40 }, () => ({})), pageText: async (index) => (read.push(index), index === 3 ? 'ISBN 978-0-306-40615-7' : 'words') };
  const identity = await own.identify({ ...pdf, metadata: { title: 'Microsoft Word - The Purple Kettle.doc', author: 'Quiet Lamp' } }, 'k.pdf', (value) => String(value ?? ''));
  assert.deepEqual(read, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 38, 39], 'a PDF: its first twelve pages and last two');
  assert.deepEqual(identity.isbns, ['9780306406157']);
  assert.equal(identity.title, 'The Purple Kettle');
  const short = [];
  await own.identify({ sections: Array.from({ length: 5 }, () => ({})), pageText: async (index) => (short.push(index), '') }, 'k.pdf', String);
  assert.deepEqual(short, [0, 1, 2, 3, 4], 'a short PDF: each page once');
  const epub = await own.identify(
    { metadata: { identifier: 'urn:uuid:x', altIdentifier: [{ scheme: 'ISBN', value: '0306406152' }] }, sections: Array.from({ length: 9 }, () => ({ createDocument: async () => ({ body: { textContent: 'no number' } }) })) },
    'k.epub',
    () => '',
  );
  assert.deepEqual(epub.isbns, ['9780306406157'], "an EPUB's identifier fields");
  console.log('  ok    the pages read: a PDF front and back, an EPUB its identifiers and first sections');
  console.log('own files: all passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
