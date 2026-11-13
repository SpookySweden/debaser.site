/*
 * Book sources added by hand (Luke, 2026-11-11): the two lists in `app/lib/books/book-sources.ts` that the Book Source
 * Patcher writes, the books on IPFS and the Open Library works named by hand, and how BOOKS lists them. Offline.
 *   npx tsc app/lib/books/book-sources.ts app/lib/books/ipfs-catalogue.ts app/lib/web/search/providers/books.ts app/lib/web/row-addresses.ts --outDir Temp/out-book-sources --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-book-sources.cjs
 *
 * - the file keeps the patcher's shape: each marker once, inside its own array, in order, and every line between a pair
 *   of markers one entry in the exact one-line shape the patcher reads back (so a hand edit can't leave it unreadable)
 * - every entry in both lists is usable; `ipfs-catalogue.ts` still hands out the same IPFS list and checks
 * - `usableWork` refuses a work number that isn't one, an empty title, a year out of range; an unusable work never lists
 * - a named work is found by every word of its title or author, `from:` by its author; an empty search finds none
 * - its row is `books:<work>`, Open Library's own shape, with its author and year and no edition count
 * - BOOKS lists it after the IPFS books and before Open Library's rows, on the first page only; a work Open Library also
 *   returns shows once, in the named place, as Open Library's fuller row; with both sources down a named work still comes
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out-book-sources');
const sources = require(path.join(OUT, 'lib', 'books', 'book-sources.js'));
const catalogue = require(path.join(OUT, 'lib', 'books', 'ipfs-catalogue.js'));
const books = require(path.join(OUT, 'lib', 'web', 'search', 'providers', 'books.js'));

const V1 = 'bafybeicg2rebjoofv4kbyovkw7af3rpiitvnl6i7ckcywaq6xjcxnc2mby';
const NOW = new Date('2026-11-11T12:00:00Z');
let passed = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  passed += 1;
};

(async () => {
  /* 1. the file's shape, as the patcher reads it ------------------------------------------------- */
  const text = fs.readFileSync(path.join(ROOT, 'app', 'lib', 'books', 'book-sources.ts'), 'utf8');
  const lines = text.split(/\r?\n/);
  const at = (marker) => {
    const found = lines.map((line, index) => (line.trim() === marker ? index : -1)).filter((index) => index >= 0);
    ok(found.length === 1, `one ${marker} line`);
    return found[0];
  };
  const ipfsStart = at('// IPFS-START');
  const ipfsEnd = at('// IPFS-END');
  const worksStart = at('// WORKS-START');
  const worksEnd = at('// WORKS-END');
  ok(ipfsStart < ipfsEnd && ipfsEnd < worksStart && worksStart < worksEnd, 'the markers are in order');
  ok(/export const IPFS_BOOKS: readonly IpfsBook\[\] = \[\s*$/.test(lines[ipfsStart - 1]) && lines[ipfsEnd + 1].trim() === '];', 'the IPFS markers sit inside IPFS_BOOKS');
  ok(/export const NAMED_WORKS: readonly NamedWork\[\] = \[\s*$/.test(lines[worksStart - 1]) && lines[worksEnd + 1].trim() === '];', 'the works markers sit inside NAMED_WORKS');
  // The patcher's own line shapes (book-source-patcher/src-tauri/src/patcher.rs, IPFS_LINE and WORK_LINE).
  const QUOTED = "'((?:[^'\\\\]|\\\\.)*)'";
  const IPFS_LINE = new RegExp(`^\\s*\\{ cid: '([^']*)', title: ${QUOTED}, author: ${QUOTED}, year: ([0-9]{1,4})(?:, coverCid: '([^']*)')?(?:, work: '([^']*)')? \\},\\s*$`);
  const WORK_LINE = new RegExp(`^\\s*\\{ work: '([^']*)', title: ${QUOTED}, author: ${QUOTED}, year: ([0-9]{1,4}) \\},\\s*$`);
  const between = (from, to) => lines.slice(from + 1, to).filter((line) => line.trim() !== '');
  ok(between(ipfsStart, ipfsEnd).every((line) => IPFS_LINE.test(line)), 'every IPFS line is one the patcher reads back');
  ok(between(worksStart, worksEnd).every((line) => WORK_LINE.test(line)), 'every works line is one the patcher reads back');
  ok(between(ipfsStart, ipfsEnd).length === sources.IPFS_BOOKS.length && between(worksStart, worksEnd).length === sources.NAMED_WORKS.length, 'one entry a line, nothing else between the markers');
  ok(IPFS_LINE.test(`  { cid: '${V1}', title: 'Jekyll\\'s \\\\ Case', author: 'R. L. Stevenson', year: 1886, work: 'OL1W' },`), 'a title with a quote or slash is a line it reads');

  /* 2. the lists as they stand ------------------------------------------------------------------- */
  for (const book of sources.IPFS_BOOKS) ok(sources.usableIpfsBook(book, NOW), `a usable IPFS entry: ${book.title}`);
  for (const work of sources.NAMED_WORKS) ok(sources.usableWork(work, NOW), `a usable named work: ${work.title}`);
  ok(catalogue.IPFS_BOOKS === sources.IPFS_BOOKS && catalogue.usableIpfsBook === sources.usableIpfsBook && catalogue.findIpfsBooks === sources.findIpfsBooks, 'ipfs-catalogue.ts hands out the same list and checks');

  /* 3. usableWork and finding ------------------------------------------------------------------- */
  const dracula = { work: 'OL85892W', title: 'Dracula', author: 'Bram Stoker', year: 1897 };
  const carmilla = { work: 'OL1149563W', title: 'Carmilla', author: 'Sheridan Le Fanu', year: 1872 };
  ok(sources.usableWork(dracula, NOW), 'a real work is usable');
  for (const [bad, why] of [
    [{ ...dracula, work: 'OL85892M' }, 'an edition number'],
    [{ ...dracula, work: 'ol85892w' }, 'lower case'],
    [{ ...dracula, work: '/works/OL85892W' }, 'a path'],
    [{ ...dracula, work: 'OL0W' }, 'a leading zero'],
    [{ ...dracula, title: '  ' }, 'an empty title'],
    [{ ...dracula, title: 'x'.repeat(301) }, 'a title too long'],
    [{ ...dracula, year: 0 }, 'year 0'],
    [{ ...dracula, year: 2028 }, 'two years ahead'],
    [{ ...dracula, year: 1897.5 }, 'a fraction'],
  ]) ok(!sources.usableWork(bad, NOW), `usableWork refuses ${why}`);
  ok(sources.usableWork({ ...dracula, year: 2027 }, NOW), 'next year is allowed');
  const list = [dracula, carmilla, { ...dracula, work: 'nope', title: 'Broken work' }];
  const titles = (found) => found.map((work) => work.title).join(' | ');
  ok(titles(sources.findNamedWorks('dracula', '', list)) === 'Dracula', 'a word of the title finds it');
  ok(titles(sources.findNamedWorks('stoker', '', list)) === 'Dracula', 'a word of the author too');
  ok(titles(sources.findNamedWorks('', 'le fanu', list)) === 'Carmilla' && sources.findNamedWorks('carmilla', 'stoker', list).length === 0, 'from: reads the author only');
  ok(sources.findNamedWorks('', '', list).length === 0, 'an empty search finds none');
  ok(sources.findNamedWorks('broken', '', list).length === 0, 'an unusable work is never listed');

  /* 4. the row ------------------------------------------------------------------------------------ */
  const row = books.toNamedWorkItem(dracula, NOW.toISOString());
  ok(row.id === 'books:OL85892W' && row.platform === 'books' && row.externalId === 'OL85892W' && row.kind === 'text', "the row is books:<work>, Open Library's own shape");
  ok(row.url === 'https://openlibrary.org/works/OL85892W' && row.creator === 'Bram Stoker' && row.publishedAt === '1897-01-01T00:00:00.000Z', 'its page, author and year');
  ok(row.book === undefined && row.thumbnailUrl === undefined, 'no edition count or cover it does not know');

  /* 5. BOOKS lists them ---------------------------------------------------------------------------- */
  sources.NAMED_WORKS.push(dracula, carmilla);
  sources.IPFS_BOOKS.push({ cid: V1, title: 'Carmilla', author: 'Sheridan Le Fanu', year: 1872 });
  try {
    const answers = (address) => {
      const url = new URL(address);
      if (url.hostname === 'openlibrary.org') {
        return {
          numFound: 2,
          docs: [
            { key: '/works/OL45883W', title: 'Some other book', author_name: ['Someone'], first_publish_year: 1900, id_project_gutenberg: ['1'] },
            { key: '/works/OL85892W', title: 'Dracula', author_name: ['Bram Stoker'], first_publish_year: 1897, id_project_gutenberg: ['345'], edition_count: 900 },
          ],
        };
      }
      return { response: { numFound: 0, docs: [] } };
    };
    const fetchOk = async (address) => new Response(JSON.stringify(answers(address)), { status: 200, headers: { 'content-type': 'application/json' } });
    const deps = { fetch: fetchOk, now: () => NOW };
    const both = await books.booksSearch.search('carmilla', null, deps);
    const ids = both.items.map((item) => item.id);
    ok(ids[0] === `ipfs:${V1}` && ids[1] === 'books:OL1149563W', `the IPFS book, then the named work (${ids.slice(0, 3).join(', ')})`);
    ok(ids.indexOf('books:OL45883W-pg1') > 1, "then Open Library's rows");
    const draculaSearch = await books.booksSearch.search('dracula', null, deps);
    const draculaIds = draculaSearch.items.map((item) => item.id);
    ok(draculaIds[0] === 'books:OL85892W-pg345', `a work Open Library also returns shows in the named place as its fuller row (${draculaIds.join(', ')})`);
    ok(draculaIds.filter((id) => id.startsWith('books:OL85892W')).length === 1, 'and only once');
    const second = await books.booksSearch.search('dracula', 2, deps);
    ok(!second.items.some((item) => item.id === 'books:OL85892W'), 'on the first page only');
    const down = async () => {
      throw new TypeError('offline');
    };
    const alone = await books.booksSearch.search('stoker', null, { fetch: down, now: () => NOW });
    ok(alone.items.length === 1 && alone.items[0].id === 'books:OL85892W', 'with Open Library and the Archive down, a named work still comes');
  } finally {
    sources.NAMED_WORKS.length = 0;
    sources.IPFS_BOOKS.length = 0;
  }

  console.log(`ok: ${passed} assertions (book sources: the file's shape, the two lists, usableWork, finding, the row, BOOKS)`);
})().catch((error) => {
  console.log(`FAIL ${error.message}`);
  process.exit(1);
});
