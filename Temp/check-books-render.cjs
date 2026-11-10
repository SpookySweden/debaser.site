/*
 * Books on screen (SPEC-books.md, Luke 2026-11-10): how the reader cuts a text into paragraphs and pages, where a highlight
 * and a book go from a letter's card, and what the reader and a book's page draw before anything is read. (Who may read a
 * highlight is check-books.cjs, on the live database; the sources are scripts/check-web-search-books.cjs.) No real book
 * text is used: the text here is made up. Run from the root:
 *   npx tsc app/components/BookReader.tsx app/components/BookPage.tsx app/lib/books/pages.ts app/lib/letters/things.ts --rootDir app --outDir Temp/books-render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-books-render.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const el = React.createElement;
const OUT = path.join(__dirname, 'books-render-out');

function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

let auth = { status: 'anonymous', user: null };
stub(path.join(OUT, 'components/AuthProvider.js'), { useAuth: () => auth });
stub(path.join(OUT, 'components/ForumProvider.js'), { useForum: () => ({ threadForAnchor: () => undefined }) });
stub(path.join(OUT, 'components/DockWindow.js'), { default: ({ title, badge, children }) => el('section', { 'data-window': title, 'data-badge': badge }, children) });
stub(path.join(OUT, 'components/WebStream.js'), { WebRow: ({ item }) => el('li', { 'data-web-row': item.id }) });
stub(path.join(OUT, 'components/AddToLetterKey.js'), { default: () => el('span', { 'data-letter-key': true }) });
stub(path.join(OUT, 'components/ProfileAvatarLink.js'), { default: () => el('span') });
let asked = '';
stub('next/navigation', { useSearchParams: () => new URLSearchParams(asked), usePathname: () => '/media', useRouter: () => ({ replace: () => undefined }) });

const { paragraphsOf, pageStarts, pageOf } = require('./books-render-out/lib/books/pages.js');
const types = require('./books-render-out/lib/books/types.js');
const { hrefOf } = require('./books-render-out/lib/letters/things.js');
const reader = require('./books-render-out/lib/books/reader-window.js');
const BookReader = require('./books-render-out/components/BookReader.js').default;
const BookPage = require('./books-render-out/components/BookPage.js').default;

/* 1. Paragraphs and pages ---------------------------------------------------------------------- */
const made = 'First line\nof one paragraph.\n\n\nSecond paragraph.\r\n\r\nThird,  with   spaces.\n \nFourth.';
assert.deepEqual(paragraphsOf(made), ['First line of one paragraph.', 'Second paragraph.', 'Third, with spaces.', 'Fourth.'], 'paragraphs at blank lines, each flowing as one line');
const long = Array.from({ length: 30 }, (_, n) => `Paragraph ${n} `.repeat(20));
const starts = pageStarts(long, 1000);
assert.equal(starts[0], 0, 'the first page starts at the start');
assert.ok(starts.length > 5, 'a long text has many pages');
assert.ok(starts.every((start, index) => index === 0 || start > starts[index - 1]), 'in order, never cutting a paragraph');
assert.equal(pageOf(starts, starts[3] + 0), 3, 'a paragraph is on its page');
assert.deepEqual(pageStarts([], 1000), [0], 'an empty text is one empty page');
console.log('  ok    paragraphs and pages');

/* 2. Where a book and a highlight go ------------------------------------------------------------- */
const highlight = { id: 'h1', bookRef: 'books:OL85892W-pg345', place: 42 };
assert.equal(types.highlightRef(highlight), 'books:OL85892W-pg345|42|h1');
assert.equal(hrefOf({ kind: 'highlight', ref: 'books:OL85892W-pg345|42|h1', title: '' }), '/media/book/books:OL85892W-pg345?at=42', 'a highlight`s card goes to its spot in its book');
assert.equal(hrefOf({ kind: 'highlight', ref: 'javascript:x|1|h', title: '' }), '/media', 'a bad one goes nowhere odd');
assert.equal(hrefOf({ kind: 'web', ref: 'audiobooks:271', title: 'X' }), '/media/book/audiobooks:271', 'a book`s card goes to its page');
assert.equal(types.bookThreadTitle('Ay', 'Dracula'), 'AY READING DRACULA', 'the thread is "[NAME] READING [BOOK]"');
assert.match(types.highlightPost({ quote: 'made up', comment: 'nice', bookRef: 'books:OL1W-pg1', place: 7 }), /^"made up"\n\nnice\n\nREAD IT THERE: \/media\/book\/books:OL1W-pg1\?at=7$/, 'a post is the quote, the comment and the way back');
assert.equal(reader.isReadable('books:OL85892W-pg345'), true);
assert.equal(reader.isReadable('books:OL85892W'), false, 'no Gutenberg copy: not readable here');
assert.deepEqual(reader.readerFromSearch('read=books:OL1W-pg1&at=9'), { bookRef: 'books:OL1W-pg1', at: 9 });
assert.equal(reader.readerFromSearch('read=books:OL1W'), null);
console.log('  ok    where a book and a highlight go');

/* 3. The reader and a book's page, before anything is read ----------------------------------------- */
assert.equal(renderToStaticMarkup(el(BookReader)), '', 'shut, the reader draws nothing');
reader.openReader('books:OL85892W-pg345', 'A BOOK');
const out = renderToStaticMarkup(el(BookReader));
assert.match(out, /data-window="READER"/);
assert.match(out, /READING THE BOOK FROM PROJECT GUTENBERG/, 'it says where the text comes from while it reads');
assert.match(out, /SIGN IN TO HIGHLIGHT AND KEEP YOUR PLACE/, 'signed out: no highlighting, and it says why');
assert.doesNotMatch(out, /HIGHLIGHTS \(/, 'and no highlights list');
auth = { status: 'signed-in', user: { id: 'me', displayName: 'ME' } };
const inside = renderToStaticMarkup(el(BookReader));
assert.match(inside, /\[ HIGHLIGHTS \(0\) \]/, 'signed in: the highlights list');
assert.match(inside, /PICK SOME WORDS TO HIGHLIGHT THEM/);
assert.match(inside, /\[ ◀ PAGE \][\s\S]*\[ PAGE ▶ \]/, 'and the page keys');
reader.closeReader();
assert.match(renderToStaticMarkup(el(BookPage, { bookRef: 'books:../x' })), /THAT ISN&#x27;T A BOOK&#x27;S ADDRESS/, 'a bad address on a book`s page is refused');
const page = renderToStaticMarkup(el(BookPage, { bookRef: 'audiobooks:271' }));
assert.match(page, /READERS/, 'a book`s page lists its readers');
console.log('  ok    the reader and the book page');
console.log('books render checks passed');
