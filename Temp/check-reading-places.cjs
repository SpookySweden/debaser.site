/*
 * Keeping your place in every book (SPEC-reading-places.md, Luke 2026-11-13), offline: the pure parts.
 *   npx tsc app/lib/books/reading-places.ts app/lib/books/page-pictures.ts app/lib/books/copies.ts --outDir Temp/out-reading-places --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-reading-places.cjs
 *
 * - a place as this browser keeps it: the JSON record, the old bare CFI, junk refused; a blank title keeps the saved one
 * - a visitor's shelf from the browser's keys; CONTINUE READING and READ, newest first; the finish line and going back
 * - your own file: `own:<SHA-256>` (the fingerprint the browser works out matches Node's), which the table's ref rule takes;
 *   READ for it goes to /read?file=<fingerprint>
 * - a row's cover (Gutenberg's, the Archive's, none for IPFS or your file); TODAY / YESTERDAY / a date
 * - your own pace: pauses and going back don't count, nothing is said before there's enough, then minutes at your pace
 * - Gutenberg's licence: how far and FINISHED measure the book itself, not the licence after it
 * - page pictures: only images on iiif.archive.org, with sizes; each page a document of our own with no script, the address
 *   escaped; the pages make a fixed-layout book with one section each
 * The places on the account, for each kind of book, are asked live in Temp/check-books.cjs; the browsers (two devices, your
 * own file's bytes going nowhere, finishing a book) in scripts/drive-reading-places.cjs. No book text is used here.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'out-reading-places');
const places = require(path.join(OUT, 'lib/books/reading-places.js'));
const pictures = require(path.join(OUT, 'lib/books/page-pictures.js'));
const types = require(path.join(OUT, 'lib/books/types.js'));

const CFI = 'epubcfi(/6/14!/4/2/10)';
const NOW = new Date('2026-11-13T12:00:00Z');

/* 1. A place in this browser ----------------------------------------------------------------------- */
const old = places.placeFromStored('books:OL1W-pg1', CFI);
assert.equal(old.cfi, CFI, 'the old bare CFI still reads');
assert.equal(old.progress, 0);
assert.equal(places.placeFromStored('books:OL1W-pg1', null), null);
assert.equal(places.placeFromStored('books:OL1W-pg1', 'not a place'), null, 'junk is nothing');
assert.equal(places.placeFromStored('books:OL1W-pg1', JSON.stringify({ cfi: 'javascript:alert(1)', progress: 40 })), null, 'a record without a real CFI is nothing');
const saved = places.storedPlace({ cfi: CFI, page: 0, title: '  Dracula\n', progress: 42.7, finishedAt: null }, null, NOW);
const back = places.placeFromStored('books:OL1W-pg1', saved);
assert.deepEqual(
  { cfi: back.cfi, title: back.title, progress: back.progress, finishedAt: back.finishedAt, updatedAt: back.updatedAt },
  { cfi: CFI, title: 'Dracula', progress: 42, finishedAt: null, updatedAt: NOW.toISOString() },
  'a record reads back, the title tidied and the percent whole',
);
assert.equal(places.placeFromStored('x:y', places.storedPlace({ cfi: CFI, page: 0, title: '', progress: 50, finishedAt: null }, back, NOW)).title, 'Dracula', 'a blank title keeps the one it had');
const wild = places.placeFromStored('x:y', JSON.stringify({ cfi: CFI, progress: 900, page: -3, title: 'x'.repeat(400), finishedAt: 'whenever' }));
assert.deepEqual([wild.progress, wild.page, wild.title.length, wild.finishedAt], [100, 0, 300, null], 'out-of-range values are held in range');
console.log('  ok    a place in this browser');

/* 2. Shelves --------------------------------------------------------------------------------------- */
const store = new Map([
  ['debaser-reader-place:books:OL1W-pg1', places.storedPlace({ cfi: CFI, page: 0, title: 'A', progress: 10, finishedAt: null }, null, new Date('2026-11-10T00:00:00Z'))],
  ['debaser-reader-place:books:OL2W-pg2', places.storedPlace({ cfi: CFI, page: 0, title: 'B', progress: 60, finishedAt: null }, null, new Date('2026-11-12T00:00:00Z'))],
  ['debaser-reader-place:books:OL3W-pg3', places.storedPlace({ cfi: CFI, page: 0, title: 'C', progress: 100, finishedAt: '2026-11-11T00:00:00Z' }, null, NOW)],
  ['debaser-reader-place:books:OL4W-pg4', '{broken'],
  ['debaser-reader-look', '{}'],
]);
const fake = { get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null, getItem: (key) => store.get(key) ?? null };
const found = places.browserPlaces(fake);
assert.deepEqual(found.map((place) => place.title).sort(), ['A', 'B', 'C'], 'a visitor`s shelf: every readable place, nothing else');
const { reading, read } = places.shelves(found);
assert.deepEqual(reading.map((place) => place.title), ['B', 'A'], 'CONTINUE READING: the unfinished ones, last read first');
assert.deepEqual(read.map((place) => place.title), ['C'], 'READ: the finished ones');
assert.equal(places.finishedAfter(0.5, null, NOW), null, 'part way: not finished');
assert.equal(places.finishedAfter(1, null, NOW), NOW.toISOString(), 'the last page: finished now');
assert.equal(places.finishedAfter(0.999, '2026-11-01T00:00:00.000Z', NOW), '2026-11-01T00:00:00.000Z', 'already finished: the first date stays');
assert.equal(places.finishedAfter(0.3, '2026-11-01T00:00:00.000Z', NOW), null, 'read again from earlier: back in CONTINUE READING');
console.log('  ok    CONTINUE READING and READ');

/* 3. Your own file --------------------------------------------------------------------------------- */
(async () => {
  const bytes = Buffer.from('%PDF-1.4 made-up test bytes, not a book');
  const hash = await places.fingerprint(new Blob([bytes]));
  assert.equal(hash, crypto.createHash('sha256').update(bytes).digest('hex'), 'the fingerprint is the SHA-256 of the bytes');
  const ref = types.ownRef(hash);
  assert.equal(ref, `own:${hash}`);
  assert.equal(types.ownHash(ref), hash);
  assert.equal(types.ownRef('ABC'), null, 'only 64 hex characters make a fingerprint');
  assert.equal(types.ownHash('books:OL1W-pg1'), null);
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261110222807_books.sql'), 'utf8');
  const rule = /book_ref ~ '([^']+)'/.exec(migration)[1];
  assert.ok(new RegExp(rule).test(ref), 'the book_places ref rule already takes own:<fingerprint>');
  assert.equal(places.continueHref(ref), `/read?file=${hash}`, 'READ for your own file asks for it again');
  assert.equal(places.continueHref('books:OL1W-pg1'), '/read/books:OL1W-pg1');
  assert.equal(places.coverOf(ref), null, 'your own file has no cover');
  console.log('  ok    your own file');

  /* 4. Covers and when ----------------------------------------------------------------------------- */
  assert.equal(places.coverOf('books:OL85892W-pg345'), 'https://www.gutenberg.org/cache/epub/345/pg345.cover.medium.jpg');
  assert.equal(places.coverOf('internet_archive:abc_1'), 'https://archive.org/services/img/abc_1');
  assert.equal(places.coverOf('ipfs:bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'), null);
  assert.equal(places.whenText('2026-11-13T08:00:00Z', NOW), 'TODAY');
  assert.equal(places.whenText('2026-11-12T08:00:00Z', NOW), 'YESTERDAY');
  assert.equal(places.whenText('2026-11-10T08:00:00Z', NOW), '3 DAYS AGO');
  assert.equal(places.whenText('2026-10-02T08:00:00Z', NOW), '2 OCT 2026');
  assert.equal(places.finishedWhen('2026-10-02T08:00:00Z', NOW), 'ON 2 OCT 2026');
  assert.equal(places.finishedWhen('2026-11-13T08:00:00Z', NOW), 'TODAY');
  assert.equal(places.whenText(null, NOW), '');
  assert.equal(places.progressText({ progress: 42 }), '42%');
  console.log('  ok    covers and when');

  /* 5. Your own pace -------------------------------------------------------------------------------- */
  let pace = places.NO_PACE;
  assert.equal(places.chapterLeftText(pace, 10), '', 'nothing to judge yet: nothing said');
  pace = places.paceAfter(pace, { at: 0, left: 100 }, { at: 60_000, left: 99 });
  pace = places.paceAfter(pace, { at: 60_000, left: 99 }, { at: 60_000 + 20 * 60_000, left: 98 });
  assert.equal(pace.minutes, 1, 'a 20-minute gap is a pause, not reading');
  pace = places.paceAfter(pace, { at: 0, left: 98 }, { at: 30_000, left: 99 });
  assert.equal(pace.units, 1, 'going back doesn`t count');
  assert.equal(places.chapterLeftText(pace, 10), '', 'a minute is not enough to judge');
  pace = places.paceAfter(pace, { at: 0, left: 99 }, { at: 120_000, left: 95 });
  assert.deepEqual(pace, { units: 5, minutes: 3 });
  assert.equal(places.chapterLeftText(pace, 10), '6 MIN LEFT IN CHAPTER', 'then minutes at your own pace (5 in 3 minutes: 10 take 6)');
  assert.equal(places.chapterLeftText(pace, 0.2), 'UNDER A MINUTE LEFT IN CHAPTER');
  assert.equal(places.chapterLeftText(pace, 120), '1 H 12 MIN LEFT IN CHAPTER');
  assert.deepEqual(places.paceFrom(JSON.stringify(pace)), pace, 'a pace keeps in this browser');
  assert.deepEqual(places.paceFrom('{"units":-1}'), places.NO_PACE);
  assert.equal(places.pageText(12, 300), 'PAGE 12 OF 300');
  assert.equal(places.pageText(0, 300), '');
  console.log('  ok    your own pace, and pages');

  /* 6. Gutenberg's licence --------------------------------------------------------------------------- */
  const end = places.storyEndOf([{ label: 'The Gift of the Magi', start: 0.07 }, { label: 'THE FULL PROJECT GUTENBERG™ LICENSE', start: 0.428 }]);
  assert.equal(end, 0.428, 'the book ends where the licence starts');
  assert.equal(places.storyEndOf([{ label: 'CHAPTER I', start: 0.1 }]), 1, 'no licence: the whole file');
  assert.equal(places.storyEndOf([{ label: 'THE FULL PROJECT GUTENBERG LICENSE', start: null }]), 1);
  assert.equal(places.storyFraction(0.214, end), 0.5, 'half way through the story is 50%, not 21%');
  assert.equal(places.storyFraction(0.428, end), 1, 'the story`s last page is the end');
  assert.equal(places.storyFraction(0.9, end), 1, 'the licence is past the end');
  assert.equal(places.finishedAfter(places.storyFraction(0.428, end), null, NOW), NOW.toISOString(), 'so the story`s last page finishes it');
  console.log('  ok    Gutenberg`s licence is not the book');

  /* 7. Page pictures -------------------------------------------------------------------------------- */
  const service = (n) => `https://iiif.archive.org/image/iiif/3/item%2Fitem_jp2.zip%2Fitem_${n}.jp2`;
  const canvas = (n, body, size = { width: 2000, height: 3000 }) => ({ type: 'Canvas', ...size, items: [{ items: [{ body }] }] });
  const manifest = {
    type: 'Manifest',
    viewingDirection: 'left-to-right',
    items: [
      canvas(1, { id: 'x', service: [{ id: service(1) }] }),
      canvas(2, { id: 'x', service: [{ id: 'https://evil.example/image/iiif/3/x' }] }),
      canvas(3, { id: 'x', service: [{ id: service(3) }] }, { width: 0, height: 10 }),
      canvas(4, { id: 'x', service: [{ id: `${service(4)}?x=1` }] }),
      canvas(5, { id: 'x', service: [{ id: 'http://iiif.archive.org/image/iiif/3/x' }] }),
      canvas(6, { id: 'x', service: [{ id: service(6) }] }),
    ],
  };
  const got = pictures.pagesOf(manifest);
  assert.deepEqual(
    got.pages.map((page) => page.image),
    [`${service(1)}/full/!1400,1400/0/default.jpg`, `${service(6)}/full/!1400,1400/0/default.jpg`],
    'only images on iiif.archive.org over https, with a size, and nothing odd in the address',
  );
  assert.equal(got.rightToLeft, false);
  assert.deepEqual(pictures.pagesOf(null).pages, []);
  assert.deepEqual(pictures.pagesOf({ items: 'x' }).pages, []);
  assert.equal(pictures.pagesOf({ ...manifest, viewingDirection: 'right-to-left' }).rightToLeft, true);
  assert.equal(pictures.manifestUrl('a b/c'), 'https://iiif.archive.org/iiif/3/a%20b%2Fc/manifest.json');
  const doc = pictures.pageDocument({ image: 'https://iiif.archive.org/image/iiif/3/x"><script>alert(1)</script>', width: 2000, height: 3000 }, 7);
  assert.ok(!/<script/i.test(doc), 'a page document never carries a script, even from a hostile address');
  assert.ok(doc.includes('x&quot;>&lt;script>'), 'the address is escaped, so it can`t close the attribute');
  assert.ok(doc.includes('width=2000, height=3000') && doc.includes('alt="Page 7"') && doc.includes('referrerpolicy="no-referrer"'));
  const book = pictures.pictureBook(got, 'A TITLE');
  assert.equal(book.rendition.layout, 'pre-paginated', 'the pages open as fixed pages, like a PDF');
  assert.equal(book.sections.length, 2, 'one section a page');
  assert.equal(typeof book.splitTOCHref, 'function', 'with what the engine needs to count how far');
  console.log('  ok    page pictures');

  /* 8. The table's shape ----------------------------------------------------------------------------- */
  const clean = types.cleanPlace({ cfi: 'bad', page: 12.9, title: ' x ', progress: -5, finishedAt: 'nope' });
  assert.deepEqual(clean, { cfi: null, page: 12, title: 'x', progress: 0, finishedAt: null }, 'a place is made safe before it is saved');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261113022702_reading_places.sql'), 'utf8');
  for (const column of ['title', 'progress', 'finished_at']) assert.match(sql, new RegExp(`add column if not exists ${column} `), `the migration adds ${column}, re-runnably`);
  assert.doesNotMatch(sql, /create table|drop table|delete from|update public/i, 'no new table and no rows changed');
  console.log('  ok    the table`s shape');

  /* 9. Every copy of a book (Luke, 2026-11-13; copies.ts) ---------------------------------------------- */
  const copies = require(path.join(OUT, 'lib/books/copies.js'));
  assert.equal(copies.workOf('books:OL138052W-pg11'), 'books:OL138052W', 'a Gutenberg ref names its work');
  assert.equal(copies.workOf('books:OL138052W'), 'books:OL138052W');
  assert.equal(copies.workOf('internet_archive:x'), null, 'an Archive ref is asked');
  assert.equal(copies.workOf(`own:${'a'.repeat(64)}`), null);
  assert.equal(copies.cleanWork('books:OL1W'), 'books:OL1W');
  assert.equal(copies.cleanWork('none'), null);
  assert.equal(copies.threadKeyOf(`own:${'a'.repeat(64)}`, 'books:OL1W'), 'books:OL1W', 'a matched copy posts to the book`s thread');
  assert.equal(copies.threadKeyOf(`own:${'a'.repeat(64)}`, null), `own:${'a'.repeat(64)}`, 'an unmatched file keeps its own');
  assert.equal(copies.backLinkOf(`own:${'a'.repeat(64)}`, 'books:OL1W'), '/media/book/books:OL1W', 'a post from your own file points at the book`s page');
  assert.equal(copies.backLinkOf(`own:${'a'.repeat(64)}`, null), '/read');
  const offered = copies.matchesOf({
    docs: [
      { key: '/works/OL138052W', title: 'A Title', author_name: ['An Author'], cover_i: 7 },
      { key: '/books/OL1M', title: 'An edition, not a work' },
      { key: '/works/OL2W', title: '' },
      { key: '/works/OL3W', title: '<b>Plain</b>', author_name: 'not a list' },
    ],
  });
  assert.deepEqual(offered.map((each) => [each.work, each.author]), [['books:OL138052W', 'An Author'], ['books:OL3W', '']], 'works only, with a title');
  assert.equal(copies.matchLine({ title: 'A Title', author: 'An Author' }), 'THIS IS: A TITLE BY AN AUTHOR');
  assert.equal(copies.searchWords('Alice’s  Adventures: in <Wonderland>!'), 'Alice s Adventures in Wonderland', 'only letters, digits and spaces are sent');
  const fakeFetch = (answers) => async (url) => ({ ok: true, json: async () => answers.shift() ?? { docs: [] }, url });
  assert.equal((await copies.findWorks('A Title', 'Odd, Author', fakeFetch([{ docs: [] }, { docs: [{ key: '/works/OL9W', title: 'A Title' }] }])))[0].work, 'books:OL9W', 'no answer by title and author: asked again by title alone');
  assert.equal(copies.pageCfi(105), 'epubcfi(/6/212)', 'page 106 is the fixed page CFI the engine makes');
  assert.equal(copies.pageOfCfi('epubcfi(/6/212)'), 105);
  assert.equal(copies.pageOfCfi('epubcfi(/6/14!/4/2)'), null, 'an EPUB CFI is not a page');
  assert.equal(copies.pageOfCfi(null), null);
  // Made-up words, shaped like a quote with dialogue marks (no book text in a check).
  const probe = copies.quoteProbe('“Grey!” said the test, “the purple kettle hums beside a quiet lamp, and the ruler counts nothing but blue!”');
  assert.ok(probe.length >= 12 && probe.length <= 80 && !/[“”!]/.test(probe), 'a quote is searched for by a plain run of its words');
  assert.equal(copies.copyName(`own:${'a'.repeat(64)}`), "A READER'S OWN FILE");
  // One row a book on the shelf, whichever copy was read last.
  const shelf = places.shelves([
    { bookRef: 'books:OL5W-pg5', cfi: CFI, page: 0, title: 'G', progress: 10, finishedAt: null, updatedAt: '2026-11-01T00:00:00Z', workRef: null },
    { bookRef: `own:${'b'.repeat(64)}`, cfi: CFI, page: 3, title: 'P', progress: 30, finishedAt: null, updatedAt: '2026-11-02T00:00:00Z', workRef: 'books:OL5W' },
    { bookRef: `own:${'c'.repeat(64)}`, cfi: null, page: 0, title: '', progress: 0, finishedAt: null, updatedAt: '2026-11-03T00:00:00Z', workRef: 'books:OL6W' },
  ]);
  assert.deepEqual(shelf.reading.map((place) => place.title), ['P'], 'two copies of one book are one row, the last read; a matched file not yet read is none');
  console.log('  ok    every copy of a book');
  console.log('reading places: all passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
