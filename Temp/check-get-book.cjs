/*
 * GET THIS BOOK (Luke, 2026-11-13): every link is a plain https address on its own service's fixed host, with the book's
 * words only ever in the search part, and the dropdown shows them all. Run from the root:
 *   npx tsc app/components/GetThisBook.tsx app/lib/books/get-book.ts --rootDir app --outDir Temp/get-book-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-get-book.cjs
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { getBookLinks } = require('./get-book-out/lib/books/get-book.js');
const GetThisBook = require('./get-book-out/components/GetThisBook.js').default;

const HOSTS = new Set([
  'openlibrary.org', 'www.overdrive.com', 'archive.org', 'search.worldcat.org', 'discover.libraryhub.jisc.ac.uk', 'bookshop.org',
  'uk.bookshop.org', 'www.hive.co.uk', 'www.abebooks.com', 'www.betterworldbooks.com', 'librivox.org', 'libro.fm', 'books.google.com',
]);

/* 1. Every link: https, a known host, the book's words only in the query ------------------------------- */
const hostile = { title: 'Evil"><script>x</script> /../@evil.example?a=b#c', author: 'Some One', work: 'OL1W/../x' };
for (const group of getBookLinks(hostile)) {
  for (const link of group.links) {
    const url = new URL(link.href);
    assert.equal(url.protocol, 'https:', `${link.label} is https`);
    assert.ok(HOSTS.has(url.hostname), `${link.label} goes to its own service, not ${url.hostname}`);
    assert.equal(url.hash, '', `${link.label}: nothing from the title becomes a fragment`);
    assert.ok(!/<script|evil\.example/.test(url.pathname), `${link.label}: nothing from the title reaches the path`);
  }
}
const groups = getBookLinks({ title: 'Dracula', author: 'Bram Stoker', work: 'OL85892W' });
assert.deepEqual(groups.map((group) => group.heading), ['BORROW, FREE', 'FIND IN A LIBRARY', 'BUY', 'LISTEN', 'PREVIEW'], 'free ways first');
assert.equal(groups[0].links[0].href, 'https://openlibrary.org/works/OL85892W', 'a known work borrows from its own Open Library page');
assert.equal(getBookLinks(hostile)[0].links[0].href.startsWith('https://openlibrary.org/search?q='), true, 'a work id that is not one is searched instead');
const byIsbn = getBookLinks({ title: 'X', isbn: '9780141439846' });
assert.ok(byIsbn[2].links.find((link) => link.label === 'ABEBOOKS').href.endsWith('isbn=9780141439846'), 'an ISBN finds that very book');
assert.ok(getBookLinks({ title: 'X', isbn: '97801<4>' })[1].links[0].href.endsWith('q=X'), 'a broken ISBN is not used');
console.log('  ok    every link');

/* 2. The dropdown --------------------------------------------------------------------------------------- */
const shut = renderToStaticMarkup(React.createElement(GetThisBook, { title: 'Dracula', author: 'Bram Stoker' }));
assert.match(shut, /aria-expanded="false"[^>]*>\[ GET THIS BOOK ▾ \]/, 'shut, it is one key');
assert.doesNotMatch(shut, /WORLDCAT/, 'with nothing listed until it is opened');
console.log('  ok    the dropdown');
console.log('get this book checks passed');
