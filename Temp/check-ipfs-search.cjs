/*
 * IPFS books, step 4 (Luke, 2026-11-11): BOOKS search lists the books on IPFS named in `app/lib/books/ipfs-catalogue.ts`,
 * offline.
 *   npx tsc app/lib/books/ipfs-catalogue.ts app/lib/web/search/providers/books.ts app/lib/web/row-addresses.ts app/lib/web/web-filters.ts app/lib/books/types.ts --outDir Temp/out-ipfs-search --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-ipfs-search.cjs
 *
 * - every entry in the list is usable (a real CID, a title, a year in range); an unusable one is never listed
 * - a search finds an entry by every word in its title or author, and `from:` by its author; an empty search finds none
 * - a row is `ipfs:<CID>` (the reader's own name for it), so READ opens it in the site's reader; its page and cover are the
 *   first gateway's, and pass the row's address rules (a cover from anywhere else does not)
 * - BOOKS lists them first, on the first page only, beside Open Library's and the Archive's rows, and says it answers for
 *   IPFS (run.ts drops rows of any platform a provider doesn't name); the BOOKS filter keeps them; ALL does too
 * - with Open Library and the Archive both down, the IPFS rows still come; with no IPFS rows either, NO ANSWER as before
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, 'out-ipfs-search');
const catalogue = require(path.join(OUT, 'lib', 'books', 'ipfs-catalogue.js'));
const books = require(path.join(OUT, 'lib', 'web', 'search', 'providers', 'books.js'));
const { rowAddresses } = require(path.join(OUT, 'lib', 'web', 'row-addresses.js'));
const { matchesFilters } = require(path.join(OUT, 'lib', 'web', 'web-filters.js'));
const { isReadable, readHref } = require(path.join(OUT, 'lib', 'books', 'types.js'));

const V0 = 'QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o';
const V1 = 'bafybeicg2rebjoofv4kbyovkw7af3rpiitvnl6i7ckcywaq6xjcxnc2mby';
const COVER = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy';
const NOW = new Date('2026-11-11T12:00:00Z');
let passed = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  passed += 1;
};

(async () => {
  /* 1. the list as it stands ------------------------------------------------------------------- */
  for (const book of catalogue.IPFS_BOOKS) ok(catalogue.usableIpfsBook(book, NOW), `a usable entry: ${book.title}`);
  ok(Array.isArray(catalogue.IPFS_BOOKS), 'the list is read');

  /* 2. finding entries --------------------------------------------------------------------------- */
  const list = [
    { cid: V0, title: 'The Strange Case of Dr Jekyll and Mr Hyde', author: 'Robert Louis Stevenson', year: 1886, coverCid: COVER },
    { cid: V1, title: 'Carmilla', author: 'Sheridan Le Fanu', year: 1872 },
    { cid: 'QmNotARealCid', title: 'Broken entry', author: 'Nobody', year: 1900 },
    { cid: V1, title: '', author: 'Empty Title', year: 1900 },
    { cid: V1, title: 'Year out of range', author: 'Someone', year: 3000 },
    { cid: V1, title: 'Bad cover', author: 'Someone', year: 1900, coverCid: 'https://evil.example/x.jpg' },
  ];
  const titles = (found) => found.map((book) => book.title).join(' | ');
  ok(titles(catalogue.findIpfsBooks('jekyll hyde', '', list)) === list[0].title, 'every word in the title finds it');
  ok(titles(catalogue.findIpfsBooks('stevenson', '', list)) === list[0].title, 'a word of the author finds it too');
  ok(titles(catalogue.findIpfsBooks('CARMILLA', '', list)) === 'Carmilla', 'whatever the case');
  ok(catalogue.findIpfsBooks('jekyll carmilla', '', list).length === 0, 'every word must be there');
  ok(titles(catalogue.findIpfsBooks('', 'le fanu', list)) === 'Carmilla' && catalogue.findIpfsBooks('carmilla', 'stevenson', list).length === 0, 'from: an author reads the author only');
  ok(catalogue.findIpfsBooks('', '', list).length === 0, 'an empty search finds none');
  ok(['broken', 'empty', 'range', 'bad'].every((word) => catalogue.findIpfsBooks(word, '', list).length === 0), 'an unusable entry is never listed (a bad CID, no title, a year out of range, a cover that is no CID)');

  /* 3. the row ------------------------------------------------------------------------------------ */
  const item = books.toIpfsItem(list[0], NOW.toISOString());
  ok(item.id === `ipfs:${V0}` && item.platform === 'ipfs' && item.kind === 'text' && item.externalId === V0, 'the row is ipfs:<CID>, a text');
  ok(isReadable(item.id) && readHref(item.id) === `/read/ipfs:${V0}`, "the reader opens it: READ goes to /read/ipfs:<CID>");
  ok(item.creator === 'Robert Louis Stevenson' && item.publishedAt === '1886-01-01T00:00:00.000Z', 'its author and its year');
  const addresses = rowAddresses(item);
  ok(addresses.thumb === `https://4everland.io/ipfs/${COVER}`, `its cover is the first gateway's, and passes the row's rules (${addresses.thumb})`);
  ok(addresses.link === `https://4everland.io/ipfs/${V0}` && addresses.embed === null, 'its page too, and it has no player');
  ok(rowAddresses({ ...item, thumbnailUrl: 'https://evil.example/ipfs/' + COVER }).thumb === null, 'a cover from anywhere else is not drawn');
  ok(rowAddresses({ ...item, thumbnailUrl: `https://4everland.io/ipfs/${COVER}/../x` }).thumb === null, 'nor a path that is not a CID');

  /* 4. BOOKS lists them -------------------------------------------------------------------------- */
  ok(books.booksSearch.alsoAnswersFor.includes('ipfs') && books.booksSearch.alsoAnswersFor.includes('internet_archive'), 'BOOKS answers for IPFS (and still the Archive)');
  catalogue.IPFS_BOOKS.push(list[0], list[1]);
  try {
    const answers = (address) => {
      const url = new URL(address);
      if (url.hostname === 'openlibrary.org') return { numFound: 1, docs: [{ key: '/works/OL85892W', title: 'Dracula', author_name: ['Bram Stoker'], first_publish_year: 1897, id_project_gutenberg: ['345'] }] };
      return { response: { numFound: 0, docs: [] } };
    };
    const fetchOk = async (address) => new Response(JSON.stringify(answers(address)), { status: 200, headers: { 'content-type': 'application/json' } });
    const deps = { fetch: fetchOk, now: () => NOW };
    const first = await books.booksSearch.search('carmilla', null, deps);
    ok(first.items[0]?.id === `ipfs:${V1}`, 'the IPFS book comes first');
    ok(first.items.some((row) => row.id === 'books:OL85892W-pg345'), "beside Open Library's rows");
    const second = await books.booksSearch.search('carmilla', 2, deps);
    ok(!second.items.some((row) => row.platform === 'ipfs'), 'on the first page only');
    const down = async () => {
      throw new TypeError('offline');
    };
    const alone = await books.booksSearch.search('jekyll', null, { fetch: down, now: () => NOW });
    ok(alone.items.length === 1 && alone.items[0].id === `ipfs:${V0}`, 'with Open Library and the Archive down, the IPFS book still comes');
    let refused = null;
    await books.booksSearch.search('nothing here', null, { fetch: down, now: () => NOW }).catch((error) => (refused = error.problem));
    ok(refused === 'NO ANSWER', 'and with nothing at all: NO ANSWER, as before');
  } finally {
    catalogue.IPFS_BOOKS.length = 0;
  }

  /* 5. the filters keep them ------------------------------------------------------------------------ */
  ok(matchesFilters(item, { source: 'books', type: 'all' }, false), 'the BOOKS filter keeps an IPFS row');
  ok(matchesFilters(item, { source: 'all', type: 'text' }, false), 'ALL, texts, keeps it');
  ok(!matchesFilters(item, { source: 'youtube', type: 'all' }, false), 'another source does not');

  console.log(`ok: ${passed} assertions (IPFS books in BOOKS search: the list, finding, the row, the provider, the filters)`);
})().catch((error) => {
  console.log(`FAIL ${error.message}`);
  process.exit(1);
});
