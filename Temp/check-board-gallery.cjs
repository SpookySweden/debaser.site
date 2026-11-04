/*
 * Scratch check for the board's gallery reading of the list - the Explorer-style view:
 *   npx tsc app/lib/forum/board-query.ts app/lib/forum/format.ts app/lib/forum/media.ts app/lib/forum/post-layout.ts app/lib/forum/tags.ts app/lib/forum/anchors.ts app/lib/forum/tag-vocabulary.ts app/lib/forum/site-author.ts app/lib/concepts/sheets.ts --outDir Temp/gallery-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/ForumGalleryView.tsx app/components/ForumGalleryTile.tsx --outDir Temp/gallery-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-board-gallery.cjs
 *
 * Two halves, and neither of them is a thing a screenshot can answer.
 *
 * The first is a question of *behaviour*: `imageOnly` is what narrows the board to the posts that carry
 * a picture, and a check that reads source cannot tell a used value from a decorative one - so the
 * filter is driven here, through the same `selectBoardThreads` the board calls, with a post whose only
 * picture is in a reply and a post whose only picture belongs to the item it is filed under.
 *
 * The second is the tile: pre-expanded means the drawing, the writing and the credit strip are all in
 * the markup with nobody having pressed anything, and the one plate is what goes to the post.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

/** A module replaced before anything requires it. */
function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub('./gallery-render/components/AuthProvider.js', {
  default: ({ children }) => children,
  useAuth: () => ({ user: null, ready: true }),
});

/** `ProfileName` draws the lamp, so the presence store has to answer. Nobody is on in this render. */
stub('./gallery-render/components/PresenceProvider.js', {
  default: ({ children }) => children,
  usePresence: () => ({ ready: true, status: 'offline', record: undefined }),
  usePresenceDirectory: () => ({ ready: true, statusFor: () => 'offline', recordFor: () => undefined }),
});

const { carriesImage, selectBoardThreads } = require('./gallery-out/forum/board-query.js');
const ForumGalleryView = require('./gallery-render/components/ForumGalleryView.js').default;
const GalleryTile = require('./gallery-render/components/ForumGalleryTile.js').default;

const render = (element) => renderToStaticMarkup(element);
const element = React.createElement;

const SHEET_IMAGE = { src: '/assets/sheets/sheet-03.png', alt: 'sheet three', width: 240, height: 160 };
const REPLY_IMAGE = { src: '/assets/sheets/sheet-04.png', alt: 'detail', width: 96, height: 96 };
const ITEM_ART = { src: '/assets/concepts/concept-sheet-01.png', alt: 'sheet', width: 352, height: 366 };

const comment = (id, media) => ({
  id,
  threadId: 't',
  body: 'THE REPLY BODY MUST NOT BE ON A TILE',
  author: { id: 'user-amy', displayName: 'amy' },
  createdAt: '2026-09-21T10:00:00.000Z',
  tags: [],
  ...(media === undefined ? {} : { media }),
});

const base = {
  author: { id: 'user-sweden', displayName: 'sweden' },
  createdAt: '2026-09-21T09:00:00.000Z',
  tags: [],
  comments: [],
  origin: 'user',
};

const POST_IMAGE = {
  ...base,
  id: 'thread-post-image',
  title: 'SHEET 03',
  body: 'Which reads better at 100 percent?',
  anchor: { kind: 'board', id: 'board', label: 'BOARD' },
  media: SHEET_IMAGE,
};

const REPLY_IMAGE_ONLY = {
  ...base,
  id: 'thread-reply-image',
  title: 'A POST WITH NO PICTURE OF ITS OWN',
  body: 'read the reply',
  anchor: { kind: 'board', id: 'board', label: 'BOARD' },
  comments: [comment('c1', REPLY_IMAGE)],
};

const TEXT_ONLY = {
  ...base,
  id: 'thread-text-only',
  title: 'WORDS ONLY',
  body: 'no picture anywhere in here',
  anchor: { kind: 'board', id: 'board', label: 'BOARD' },
};

/** A comment on a concept sheet: its preview is the *item's* artwork, not a picture the poster filed. */
const ITEM_ART_ONLY = {
  ...base,
  id: 'thread-item-art',
  title: 'RE: SHEET 01',
  body: '',
  anchor: { kind: 'asset', id: 'concept-sheet-01', label: 'SHEET 01', href: '/concepts', preview: ITEM_ART },
};

// 1. What "carries a picture" means: the post's own, or one a reply came with. The item's artwork is
//    not the post's, and a gallery of it would be the concept archive drawn a second time.
assert.equal(carriesImage(POST_IMAGE), true, 'a picture attached to the post counts');
assert.equal(carriesImage(REPLY_IMAGE_ONLY), true, 'and so does one a reply came with');
assert.equal(carriesImage(TEXT_ONLY), false, 'a post of nothing but words does not');
assert.equal(carriesImage(ITEM_ART_ONLY), false, 'and the item`s own artwork is not the post`s picture');

// 2. The filter itself, driven rather than read: the board's own query, asked the way the board asks.
const ALL = [POST_IMAGE, REPLY_IMAGE_ONLY, TEXT_ONLY, ITEM_ART_ONLY];
const query = (extra) => ({
  query: '',
  sourceFilter: 'all',
  tagKeys: [],
  tagMatchMode: 'any',
  sortMode: 'newest',
  ...extra,
});

assert.equal(selectBoardThreads(ALL, query({})).length, 4, 'with no filter, the board is the whole list');

const gallery = selectBoardThreads(ALL, query({ imageOnly: true }));
assert.deepEqual(
  gallery.map((thread) => thread.id),
  ['thread-post-image', 'thread-reply-image'],
  'the gallery keeps the post with a picture and the post whose reply has one, in the same order',
);
assert.equal(
  selectBoardThreads(ALL, query({ imageOnly: false })).length,
  4,
  'and the feed is unchanged: the switch is off, not the rule',
);

// The two readings compose: a search inside the gallery narrows the pictures, it does not widen them.
assert.deepEqual(
  selectBoardThreads(ALL, query({ imageOnly: true, query: 'WORDS ONLY' })),
  [],
  'a text-only post cannot be searched into the gallery',
);

// 3. The tile, drawn: pre-expanded means everything is in the markup with nothing pressed.
const view = render(element(ForumGalleryView, { threads: [POST_IMAGE], onOpen: () => undefined }));
assert.match(view, /id="forum-thread-list"/, 'the gallery is the same place on the page as the feed');
assert.match(view, /data-view="gallery"/, 'and says which reading it is');
assert.match(view, /SHEET 03/, 'the title is drawn');
assert.match(view, /Which reads better at 100 percent\?/, 'and the writing, without anything being opened');
assert.match(view, /sheet-03\.png/, 'and the drawing itself');
// (2026-10-25, SPEC-less-text.md) The source bar shortened: `IMAGE ATTACHED TO THIS POST` -> `POST IMAGE`,
// `IMAGE ATTACHED TO A REPLY` -> `REPLY IMAGE` (app/lib/forum/media.ts imageSourceLabel).
assert.match(view, />POST IMAGE</, 'under a bar naming where the picture came from');
assert.doesNotMatch(view, /IMAGE ATTACHED TO/, 'in two words');
assert.match(view, /POSTED/, 'with the credit strip');
assert.match(view, /sweden/, 'naming the poster');
// (2026-10-25, SPEC-less-text.md) `[ OPEN THE POST ]` -> `[ OPEN ]`.
assert.match(view, /\[ OPEN \]/, 'and one plate that goes to the post');
assert.doesNotMatch(view, /\[ OPEN THE POST \]/, 'in the short wording');
// A tile is a post, so it is drawn in the reader's own reading state: white until the post is opened,
// quiet afterwards, from the same marks the feed's rows use (`app/lib/forum/read-state.ts`).
assert.match(view, /bg-paper text-ink/, 'a tile nobody has opened stands on the field');
assert.match(
  render(element(GalleryTile, { thread: POST_IMAGE, onOpen: () => undefined, read: true })),
  /bg-chrome-dark text-ink/,
  'and goes quiet once it has been read',
);
assert.match(
  render(
    element(ForumGalleryView, {
      threads: [POST_IMAGE],
      onOpen: () => undefined,
      seenByThread: { 'thread-post-image': '2026-09-29T12:00:00.000Z' },
    }),
  ),
  /bg-chrome-dark text-ink/,
  'the view hands each tile its own answer, so one read post does not read the next one for it',
);
const mixed = render(
  element(ForumGalleryView, {
    threads: [POST_IMAGE, REPLY_IMAGE_ONLY],
    onOpen: () => undefined,
    seenByThread: { 'thread-post-image': '2026-09-29T12:00:00.000Z' },
  }),
);
assert.equal((mixed.match(/bg-chrome-dark text-ink/g) ?? []).length, 1, 'one read post is one quiet tile');
assert.equal((mixed.match(/bg-paper text-ink/g) ?? []).length, 1, 'and the unread post beside it is still on the field');

// The plate belongs to the post it is drawn in. A press is not something a server render performs,
// and there is no DOM here to issue one into, so the wiring is read from the tile's own source - and
// said so plainly rather than dressed up as a click.
const wired = render(
  element(ForumGalleryView, { threads: [POST_IMAGE, REPLY_IMAGE_ONLY], onOpen: () => undefined }),
);
assert.equal((wired.match(/\[ OPEN \]/g) ?? []).length, 2, 'one plate per tile');

const tile = render(element(GalleryTile, { thread: REPLY_IMAGE_ONLY, onOpen: () => undefined }));
assert.match(tile, />REPLY IMAGE</, 'a tile says when the picture came from a reply instead');
assert.match(tile, /read the reply/, 'and shows the post it belongs to');
assert.match(
  fs.readFileSync('app/components/ForumGalleryTile.tsx', 'utf8'),
  /onClick=\{\(\) => onOpen\(thread\.id\)\}/,
  'and its plate hands the board the id of the post the tile was drawn for',
);

// Nothing on a tile draws the conversation: the plate is the way to it, and a grid of reply boxes
// would be a worse board rather than a second view of one.
assert.doesNotMatch(tile, /THE REPLY BODY MUST NOT BE ON A TILE/, 'a reply body is not on a tile');
assert.doesNotMatch(tile, /\[ FILE REPLY \]/, 'and neither is a reply box');

// 4. The board offers the switch, and the board's own query is what reads it: an assertion on the
//    *declaration* alone would pass while the value went nowhere, which is the fault this holds.
const board = fs
  .readFileSync('app/components/ForumBoard.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
assert.match(board, /imageOnly: view === 'gallery'/, 'the board asks for image posts only in the gallery');
// One tag, however it is formatted: the board hands the gallery the marks as well as the threads now,
// so the element is written across several lines - and a check that pinned the trailing space would
// fail on a reformat rather than on the behaviour it is holding.
assert.match(board, /<ForumGalleryView\s/, 'and draws the gallery instead of the rows');
assert.match(board, /seenByThread=\{forum\.seenByThread\}/, 'telling it what the reader has already read');
assert.match(board, /aria-pressed=\{view === option\.value\}/, 'with a pressed-in plate for the view in force');
assert.match(board, /label: '\[ FEED \]'/, 'naming the feed');
assert.match(board, /label: '\[ GALLERY \]'/, 'and the gallery');

console.log('board gallery checks passed');
console.log(`  filter   : ${gallery.map((thread) => thread.id).join(' + ')} - the picture may be in a reply`);
console.log('  kept out : the item`s own artwork is a preview, not the post`s picture');
console.log('  tile     : pre-expanded - drawing, writing and credit strip, with one plate to the post');
