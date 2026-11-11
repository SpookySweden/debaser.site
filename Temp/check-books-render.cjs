/*
 * Books on screen (SPEC-books.md, Luke 2026-11-10; SPEC-reader.md, 2026-11-11): where a highlight and a book go from a
 * letter's card and a post, and what a book's page draws before anything is read. (The reader's own pure parts are
 * check-reader.cjs; who may read a highlight is check-books.cjs, on the live database; the sources are
 * scripts/check-web-search-books.cjs.) No real book text is used. Run from the root:
 *   npx tsc app/components/BookPage.tsx app/components/reader/ReaderPage.tsx app/lib/letters/things.ts --rootDir app --outDir Temp/books-render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
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
stub(path.join(OUT, 'components/WebStream.js'), { WebRow: ({ item }) => el('li', { 'data-web-row': item.id }) });
stub(path.join(OUT, 'components/AddToLetterKey.js'), { default: () => el('span', { 'data-letter-key': true }) });
stub(path.join(OUT, 'components/ProfileAvatarLink.js'), { default: () => el('span') });
let asked = '';

stub('next/navigation', { useSearchParams: () => new URLSearchParams(asked), usePathname: () => '/media', useRouter: () => ({ replace: () => undefined }) });

const types = require('./books-render-out/lib/books/types.js');
const { hrefOf } = require('./books-render-out/lib/letters/things.js');
const BookPage = require('./books-render-out/components/BookPage.js').default;
const ReaderPage = require('./books-render-out/components/reader/ReaderPage.js').default;
const HighlightBar = require('./books-render-out/components/reader/HighlightBar.js').default;
const panels = require('./books-render-out/components/reader/ReaderPanels.js');
const look = require('./books-render-out/lib/books/reader-look.js');

/* 1. Where a book and a highlight go ------------------------------------------------------------- */
const highlight = { id: 'h1', bookRef: 'books:OL85892W-pg345', place: 0 };
assert.equal(types.highlightRef(highlight), 'books:OL85892W-pg345|0|h1');
assert.equal(hrefOf({ kind: 'highlight', ref: 'books:OL85892W-pg345|0|h1', title: '' }), '/read/books:OL85892W-pg345?h=h1', 'a highlight`s card opens the reader at it');
assert.equal(hrefOf({ kind: 'highlight', ref: 'books:OL85892W-pg345|42', title: '' }), '/read/books:OL85892W-pg345', 'an old card without an id opens the book');
assert.equal(hrefOf({ kind: 'highlight', ref: 'javascript:x|1|h', title: '' }), '/media', 'a bad one goes nowhere odd');
assert.equal(hrefOf({ kind: 'highlight', ref: 'books:OL1W-pg1|0|x"><script>', title: '' }), '/read/books:OL1W-pg1', 'an id with odd characters is dropped');
assert.equal(hrefOf({ kind: 'web', ref: 'audiobooks:271', title: 'X' }), '/media/book/audiobooks:271', 'a book`s card goes to its page');
assert.equal(types.bookThreadTitle('Ay', 'Dracula'), 'AY READING DRACULA', 'the thread is "[NAME] READING [BOOK]"');
assert.equal(
  types.highlightPost({ quote: 'made up', comment: 'nice', bookRef: 'books:OL1W-pg1', cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:7)' }),
  '"made up"\n\nnice\n\nREAD IT THERE: /read/books:OL1W-pg1?at=epubcfi(/6/4!/4/2,/1:0,/1:7)',
  'a post is the quote, the comment and the way back to that spot, readable',
);
assert.equal(types.highlightPost({ quote: 'old', comment: '', bookRef: 'books:OL1W-pg1', cfi: null }), '"old"\n\nREAD IT THERE: /read/books:OL1W-pg1', 'an old one goes to the book');
assert.equal(types.isReadable('books:OL85892W-pg345'), true);
assert.equal(types.isReadable('books:OL85892W'), false, 'no Gutenberg copy: not readable here');
console.log('  ok    where a book and a highlight go');

/* 2. A book's page --------------------------------------------------------------------------------- */
assert.match(renderToStaticMarkup(el(BookPage, { bookRef: 'books:../x' })), /THAT ISN&#x27;T A BOOK&#x27;S ADDRESS/, 'a bad address on a book`s page is refused');
const page = renderToStaticMarkup(el(BookPage, { bookRef: 'audiobooks:271' }));
assert.match(page, /READERS/, 'a book`s page lists its readers');
console.log('  ok    the book page');

/* 3. The reader (SPEC-reader.md), before the book arrives ------------------------------------------- */
auth = { status: 'anonymous', user: null };
const reading = renderToStaticMarkup(el(ReaderPage, { bookRef: 'books:OL85892W-pg345' }));
assert.match(reading, /\[ ◀ BACK \]/, 'a way back');
for (const key of ['CONTENTS', 'SEARCH', 'BOOKMARKS', 'HIGHLIGHTS', 'LOOK', 'FOCUS']) assert.match(reading, new RegExp(`\\[ ${key} \\]`), `the top bar has ${key}`);
assert.match(reading, /READING THE BOOK FROM PROJECT GUTENBERG/, 'it says where the book comes from while it reads');
assert.match(reading, /type="range"[^>]*disabled/, 'the progress bar waits for the book');
assert.match(reading, /bg-reader-dark-paper/, 'the page is the dark paper until a look is read');
assert.doesNotMatch(reading, /gutenberg\.org/, 'no Gutenberg address reaches the page');
console.log('  ok    the reader, before the book arrives');

const spot = { x: 300, top: 200, bottom: 230, stageWidth: 900, stageHeight: 600 };
const noop = () => undefined;
const outBar = renderToStaticMarkup(el(HighlightBar, { spot, quote: 'made up', existing: null, signedIn: false, onColour: noop, onComment: noop, onLock: noop, onDelete: noop, onClose: noop }));
assert.match(outBar, /LOG IN TO HIGHLIGHT/, 'signed out: one line, no colours');
assert.doesNotMatch(outBar, /bg-mark-/);
const inBar = renderToStaticMarkup(el(HighlightBar, { spot, quote: 'made up', existing: null, signedIn: true, onColour: noop, onComment: noop, onLock: noop, onDelete: noop, onClose: noop }));
for (const colour of look.HIGHLIGHT_COLOURS) assert.match(inBar, new RegExp(`bg-mark-${colour}`), `the bar offers ${colour}`);
assert.match(inBar, /COMMENT/);
assert.match(inBar, /🔓/, 'and the lock, open (posted) to start');
assert.match(inBar, /position:absolute|absolute/, 'laid over the page, so nothing on it moves');
const madeBar = renderToStaticMarkup(el(HighlightBar, { spot, quote: 'made up', existing: { colour: 'green', isLocked: true }, signedIn: true, onColour: noop, onComment: noop, onLock: noop, onDelete: noop, onClose: noop }));
assert.match(madeBar, /\[ DELETE \]/, 'a highlight already made can be deleted');
assert.match(madeBar, /🔒/, 'and shows its lock');
assert.match(madeBar, /aria-pressed="true"[^>]*bg-mark-green|bg-mark-green[^>]*aria-pressed="true"/, 'and its colour');
console.log('  ok    the highlight bar');

const lookPanel = renderToStaticMarkup(el(panels.LookSettings, { settings: look.DEFAULT_SETTINGS, onChange: noop }));
for (const word of ['TEXT SIZE', 'LINE SPACING', 'MARGINS', 'FONT', 'PAPER', 'LIGHT', 'DARK', 'SEPIA', 'TYPEWRITER']) assert.match(lookPanel, new RegExp(word), `LOOK has ${word}`);
assert.match(lookPanel, /bg-reader-sepia-paper/, 'each paper shown in its own colours');
assert.match(renderToStaticMarkup(el(panels.BookmarkList, { signedIn: false, bookmarks: [], onAdd: noop, onGo: noop, onRemove: noop })), /LOG IN TO KEEP BOOKMARKS/);
const marks = renderToStaticMarkup(el(panels.BookmarkList, { signedIn: true, bookmarks: [{ id: 'b1', person: 'me', bookRef: 'books:OL1W-pg1', cfi: 'epubcfi(/6/2!/4)', label: 'CHAPTER I · 3%', createdAt: '' }], onAdd: noop, onGo: noop, onRemove: noop }));
assert.match(marks, /\+ BOOKMARK THIS PAGE/);
assert.match(marks, /CHAPTER I · 3%[\s\S]*\[ GO TO \][\s\S]*\[ DELETE \]/);
const held = { id: 'h1', person: 'me', bookRef: 'books:OL1W-pg1', bookTitle: 'X', cfi: null, place: 4, startAt: 0, endAt: 3, quote: 'old one', comment: 'a note', colour: 'blue', isLocked: false, forumCommentId: null, createdAt: '2026-11-10T10:00:00Z' };
const listed = renderToStaticMarkup(el(panels.HighlightList, { signedIn: true, highlights: [held], onGo: noop, onLock: noop, onRemove: noop }));
assert.match(listed, /old one[\s\S]*a note[\s\S]*2026-11-10 10:00/, 'a highlight, its comment, and when');
assert.match(listed, /disabled=""[^>]*>\[ GO TO \]/, 'an old paragraph highlight has nowhere to go in the EPUB');
assert.match(listed, /\[ 🔓 POSTED \]/);
assert.match(listed, /data-letter-key/, '+ LETTER');
assert.match(listed, /bg-mark-blue/, 'and its colour');
const toc = renderToStaticMarkup(el(panels.ContentsList, { toc: [{ label: 'ONE', href: 'a.xhtml', subitems: [{ label: 'ONE A', href: 'a.xhtml#x' }] }, { label: 'TWO', href: 'b.xhtml' }], current: 'b.xhtml', onGo: noop }));
assert.match(toc, /ONE[\s\S]*ONE A[\s\S]*▶ TWO/, 'the contents, nested, the current chapter marked');
console.log('  ok    the reader`s panels');
console.log('books render checks passed');
