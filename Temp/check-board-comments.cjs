/*
 * Scratch check for the board's own surfaces: the reply tree, a post card, the moderation
 * controls, the new-post form and the board itself (run from the root):
 *   npx tsc app/lib/forum/format.ts app/lib/forum/tags.ts app/lib/forum/comment-tree.ts app/lib/forum/tag-vocabulary.ts app/lib/forum/post-layout.ts app/lib/forum/media.ts app/lib/forum/anchors.ts app/lib/forum/board-query.ts app/lib/forum/paging.ts app/lib/forum/site-author.ts app/lib/concepts/sheets.ts app/lib/audio/tags.ts app/lib/audio/forum-tracks.ts app/lib/audio/archive-tree.ts app/lib/audio/sorts.ts app/lib/audio/tracks.ts --outDir Temp/board-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/CommentThreadList.tsx app/components/ForumThreadCard.tsx app/components/NewPostForm.tsx app/components/ForumBoard.tsx app/components/MediaThumbnail.tsx app/components/ForumModerationControls.tsx app/components/ConceptSheetFrame.tsx app/components/CommentPopout.tsx app/components/TagWindow.tsx --outDir Temp/board-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-board-comments.cjs
 *
 * What it is for: the reply tree is the one surface with nested state and with permissions
 * attached to it - a guest must not be handed the admin's controls, nesting must stop
 * indenting rather than run off the side of the page, and a picture in a reply must be the
 * file the poster attached or an honest notice, never a drawn substitute. None of that is
 * visible to a reader of the code, so it is asserted here.
 *
 * The last section covers the tag filter, which reads replies as well as posts: the tag chooser
 * counts a tag wherever it was typed, so a `MECHANICS (1)` chip has to bring the post that reply
 * answered, and the card has to say it matched on that reply (and open onto it).
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

/** A module replaced before anything requires it. */
function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

/** Who is reading, switched between renders: the permissions are the point of two cases. */
let viewer = null;

const FORUM = {
  threads: [],
  /** Pins come in beside the board now; the board's screens read them for ordering. */
  pins: [],
  pinForThread: () => undefined,
  pinThread: async () => undefined,
  unpinThread: async () => undefined,
  author: { id: null, displayName: 'Anonymous' },
  ready: true,
  source: 'supabase',
  tagVocabulary: [],
  tagColours: {},
  rememberTagColour: () => undefined,
  /** Nothing read and nothing marked: the board draws every row white, which is the state a new reader is in. */
  seenByThread: {},
  markThreadRead: () => undefined,
  createThread: async () => undefined,
  addComment: async () => undefined,
  threadForAnchor: () => undefined,
  commentCountForAnchor: () => 0,
  updateThread: async () => undefined,
  deleteThread: async () => undefined,
  updateComment: async () => undefined,
  deleteComment: async () => undefined,
  clearLocalPosts: async () => undefined,
};

stub('./board-render/components/ForumProvider.js', {
  default: ({ children }) => children,
  useForum: () => FORUM,
});

/** The composer's MP3 control reads the site's player; the player is not on trial here. */
stub('./board-render/components/MusicPlayerProvider.js', {
  default: ({ children }) => children,
  useMusicPlayer: () => ({
    queue: [],
    track: undefined,
    playing: false,
    loading: false,
    elapsed: 0,
    duration: Number.NaN,
    play: () => undefined,
    toggle: () => undefined,
    refresh: () => undefined,
  }),
});

stub('./board-render/components/AuthProvider.js', {
  default: ({ children }) => children,
  useAuth: () => ({
    user: viewer,
    ready: true,
    banAccount: async () => undefined,
    unbanAccount: async () => undefined,
  }),
});

stub('./board-render/components/PresenceProvider.js', {
  default: ({ children }) => children,
  usePresence: () => ({ ready: true, status: 'offline', record: undefined }),
  usePresenceDirectory: () => ({ ready: true, statusFor: () => 'offline', recordFor: () => undefined }),
});

// Tagging an account needs to know which accounts there are, and filing a tag needs somewhere
// to file it: the composers read both stores. The notification stub records what a post tried
// to deliver, which is how "a tag is filed, and a reply tags who it answers" is checked below.
const COMMS = {
  accounts: [
    { id: 'user-amy', displayName: 'amy' },
    { id: 'user-sweden', displayName: 'sweden' },
    { id: 'user-debaser', displayName: 'debaser.site' },
  ],
};

const filed = [];
const NOTIFICATIONS = {
  ready: true,
  userId: 'user-sweden',
  items: [],
  unread: 0,
  summary: 'NO NOTIFICATIONS',
  error: null,
  retry: () => undefined,
  markRead: async () => undefined,
  markAllRead: async () => undefined,
  notifyTagged: async (input) => {
    filed.push(input);
  },
  source: 'mock',
};

stub('./board-render/components/CommsProvider.js', {
  default: ({ children }) => children,
  useComms: () => COMMS,
});

stub('./board-render/components/NotificationsProvider.js', {
  default: ({ children }) => children,
  useNotifications: () => NOTIFICATIONS,
});

stub('./board-render/components/PopoutWindow.js', {
  __esModule: true,
  default: ({ title, badge, status: windowStatus, actions, children }) =>
    React.createElement(
      'div',
      { 'data-window': title, 'data-badge': badge, 'data-status': windowStatus },
      React.createElement('div', { 'data-actions': 'true' }, actions),
      children,
    ),
});

const comment = (id, body, extra = {}) => ({
  id,
  threadId: 'thread-1',
  body,
  author: { id: 'user-amy', displayName: 'amy' },
  createdAt: '2026-09-21T10:00:00.000Z',
  tags: [],
  ...extra,
});

const THREAD = {
  id: 'thread-1',
  title: 'SHEET 03',
  body: 'Which reads better at 100 percent?',
  author: { id: 'user-sweden', displayName: 'sweden' },
  createdAt: '2026-09-21T09:00:00.000Z',
  anchor: { kind: 'board', id: 'board', label: 'BOARD' },
  tags: [{ id: 'cat-design', kind: 'category', label: 'DESIGN' }],
  media: { src: '/assets/sheets/sheet-03.png', alt: 'sheet three', width: 240, height: 160 },
  comments: [
    comment('c1', 'the second pass reads better @sweden', { tags: [{ id: 'user-line', kind: 'user', label: 'LINE WORK' }] }),
    comment('c2', 'agreed - the knuckles', {
      parentId: 'c1',
      media: { src: '/assets/sheets/sheet-04.png', alt: 'detail', width: 96, height: 96 },
    }),
    comment('c3', 'deeper still', { parentId: 'c2' }),
    comment('c4', 'and deeper', { parentId: 'c3' }),
  ],
  origin: 'user',
};


const CommentThreadList = require('./board-render/components/CommentThreadList.js').default;
const CommentNodeCard = require('./board-render/components/CommentNodeCard.js').default;
const ForumThreadCard = require('./board-render/components/ForumThreadCard.js').default;
const NewPostForm = require('./board-render/components/NewPostForm.js').default;
const ForumBoard = require('./board-render/components/ForumBoard.js').default;
const MediaThumbnail = require('./board-render/components/MediaThumbnail.js').default;
const moderation = require('./board-render/components/ForumModerationControls.js');

const element = React.createElement;
const render = (child) => renderToStaticMarkup(child);

// 1. The reply tree: one card per reply, replies nested, and nesting that stops indenting at
//    the cap rather than walking off the right-hand side of the card.
const tree = render(element(CommentThreadList, { thread: THREAD }));
assert.equal((tree.match(/<li /g) ?? []).length, 4, 'one card per reply');
assert.equal((tree.match(/ml-4 border-l-line border-ink pl-2/g) ?? []).length, 3, 'nesting indents to depth 3');
assert.equal((tree.match(/\bml-2\b/g) ?? []).length, 0, 'and nothing has run past the cap yet');

const capped = render(element(CommentThreadList, { thread: THREAD, maxIndentDepth: 1 }));
assert.equal((capped.match(/ml-4 border-l-line border-ink pl-2/g) ?? []).length, 1, 'a shallower cap indents once');
assert.equal((capped.match(/\bml-2\b/g) ?? []).length, 2, 'and the deeper replies line up flat');

// 2. Threading controls: every reply can be answered, and only a reply that has replies
//    under it carries the fold - a leaf does not offer to hide nothing.
// (2026-10-23, SPEC-efficiency.md) The reply keys are short now: `[ COMMENT ]` -> `[ REPLY ]`,
// `[ HIDE n REPLIES ]` / `[ SHOW n REPLIES ]` -> `[ n REPLIES ▴ ]` / `[ n REPLIES ▾ ]`.
assert.equal((tree.match(/\[ REPLY \]/g) ?? []).length, 4, 'every reply can be answered');
assert.equal((tree.match(/\[ 1 REPLY ▴ \]/g) ?? []).length, 3, 'a reply with a reply under it folds it');
assert.doesNotMatch(tree, /REPL(Y|IES) ▾ \]/, 'nothing is folded away to begin with');
assert.match(tree, /the second pass reads better/, 'bodies are drawn');
// The reply tags are tokens split over two spans (the namespace in the quiet grey, the name in ink),
// so they are asserted on the *text* of the markup, the way a reader sees them.
const textOf = (html) => html.replace(/<[^>]*>/g, '');

assert.match(textOf(tree), /user:line-work/, 'a reply keeps its own tags, written as the token a list is made of');
assert.match(tree, /TAGGED:/, 'and a reply that names somebody says so');
assert.match(tree, /href="\/profile\/user-sweden"/, 'with the tag opening that account');
assert.match(tree, /@sweden/, 'written the way it was written');
assert.match(tree, /sheet-04\.png/, 'artwork attached to a reply is the file that was attached');
assert.equal((tree.match(/<svg|data:image/g) ?? []).length, 0, 'and never artwork drawn in code');

const empty = render(element(CommentThreadList, { thread: { ...THREAD, comments: [] } }));
assert.match(empty, /NO REPLIES YET\./, 'an unanswered post says so');
assert.doesNotMatch(empty, /<li /, 'and draws no cards');


// 3. One card on its own: the reply box opens under it, with the composer's own controls.
const cardProps = {
  comment: THREAD.comments[0],
  index: 0,
  depth: 0,
  avatarSize: 44,
  maxIndentDepth: 3,
  viewer: { id: null, displayName: 'Anonymous' },
  repliesHidden: false,
  busy: false,
  error: null,
  status: null,
  draft: '',
  onDraftChange: () => undefined,
  onToggleReply: () => undefined,
  onToggleReplies: () => undefined,
  onSubmit: () => undefined,
};

const openBox = render(element(CommentNodeCard, { ...cardProps, replyCount: 1, replyOpen: true }));
assert.match(openBox, /\[ CANCEL \]/, 'the open box offers to close');
// (2026-10-25, SPEC-less-text.md) Placeholder `Add to this reply thread...` -> `Reply...`, and the reply
// box's key `[ FILE COMMENT ]` -> `[ FILE REPLY ]` (it files a reply).
assert.match(openBox, /placeholder="Reply\.\.\."/, 'with the short reply placeholder');
assert.doesNotMatch(openBox, /Add to this reply thread/, 'not the long one');
assert.match(openBox, /\[ FILE REPLY \]/, 'and the way to file it');
assert.match(openBox, /amy/, 'the reply is named');
// The reply box is the words and the way to file them, and nothing else. It used to open with a byline
// and a character count above the box and four attachment controls under it - seven lines of form
// between a reader and the button they opened the post to press. What a reply can still carry is one
// press away, and the plate names every one of them: `[ + TAGS / PICTURE / MP3 / @NAME ]`.
assert.doesNotMatch(openBox, /AUTHOR:/, 'the byline is gone from the reply box');
assert.doesNotMatch(openBox, /CHARS/, 'and so is the character count');
// The fixture hands this box no accounts, tags or track, so there is nothing to fold: no plate is
// drawn for an empty shelf. The post's own card below is the case that has all four.
assert.doesNotMatch(openBox, /<details/, 'and no plate is drawn when there is nothing to put behind one');

const closedBox = render(element(CommentNodeCard, { ...cardProps, replyCount: 0, replyOpen: false }));
// (2026-10-23, SPEC-efficiency.md) `[ COMMENT ]` -> `[ REPLY ]`, and the fold is `[ n REPLIES ▴ ]`.
assert.match(closedBox, /\[ REPLY \]/, 'a closed one offers to answer');
assert.doesNotMatch(closedBox, /REPL(Y|IES) [▴▾] \]/, 'and offers no fold when it has no replies');

// 4. Permissions: the moderation controls belong to the house account and to nobody else -
//    not a guest, and not the account that wrote the post.
const asGuest = render(element(moderation.ThreadModeration, { thread: THREAD }));
assert.doesNotMatch(asGuest, /\[ ADMIN \]|EDIT POST|REMOVE POST|BAN/, 'a guest is handed no controls');

viewer = { id: 'user-sweden', displayName: 'sweden' };
const asAuthor = render(element(moderation.ThreadModeration, { thread: THREAD }));
assert.doesNotMatch(asAuthor, /\[ ADMIN \]|REMOVE POST/, 'the poster is not the moderator');

viewer = { id: 'debaser-site', displayName: 'debaser.site' };
const asAdmin = render(element(moderation.ThreadModeration, { thread: THREAD }));
assert.match(asAdmin, /\[ ADMIN \]/, 'the house account is');
assert.match(asAdmin, /REMOVE POST/, 'and may take a post down');
assert.match(asAdmin, /BAN/, 'and ban the account behind a reply');

const replyModeration = render(element(moderation.CommentModeration, { comment: THREAD.comments[1] }));
assert.match(replyModeration, /EDIT REPLY/, 'a reply can be rewritten');
assert.match(replyModeration, /REMOVE REPLY/, 'and removed');

// 5. The post card: what a thread looks like on the board.
viewer = null;
const card = render(element(ForumThreadCard, { thread: THREAD }));
assert.match(card, /SHEET 03/, 'the title');
assert.match(card, /Which reads better at 100 percent\?/, 'the body');
assert.match(card, /DESIGN/, 'its tags');
// The drawing waits for the click that opens the post. A collapsed card used to reveal a 72px
// thumbnail on hover, which meant the picture a post was filed for was invisible to anybody without a
// pointer - so the row says `[ IMG ]` and the drawing appears when the post is opened. Both halves are
// asserted, because either one alone would pass with the other's behaviour gone.
assert.match(card, /\[ IMG/, 'the collapsed row says a picture is filed with this post');
assert.doesNotMatch(card, /sheet-03\.png/, 'but the drawing itself is not drawn until it is opened');
const openPost = render(element(ForumThreadCard, { thread: THREAD, isOpen: true }));
assert.match(openPost, /sheet-03\.png/, 'and opening the post draws the artwork it was posted with');
assert.match(openPost, /FILE REPLY/, 'the post`s own reply box files a reply');
assert.doesNotMatch(openPost, /AUTHOR:/, 'and drops the byline the same way the reply-on-a-reply box does');
// What a reply can still carry - tags, a tagged account, a picture, an MP3 - is one plate away rather
// than four controls deep, and the plate spells all four out: an unexplained `[ + ]` is a puzzle.
// (2026-10-23, SPEC-efficiency.md) The key is `[ + ATTACH ]` now, and the four things it carries are its tip.
assert.match(openPost, /\[ \+ ATTACH \]/, 'one plate names what else a reply can carry');
// (2026-10-25, SPEC-less-text.md) The tip `Tags, a picture, an MP3 or an @name` repeated what the fold opens
// onto: cut (rule 1). The four are the controls inside the fold, so that is what is asserted now.
assert.doesNotMatch(openPost, /<summary[^>]*title=/, 'the plate carries no tip any more');
const attachFold = (openPost.match(/<details[\s\S]*?<\/details>/) ?? [''])[0];
assert.match(attachFold, /TAG/i, 'the fold holds the tags control');
assert.match(attachFold, /PICTURE|IMG|IMAGE/i, 'a picture control');
assert.match(attachFold, /MP3/i, 'and an MP3 control');
assert.match(openPost, /<details/, 'and what it carries is folded behind it');
// (2026-10-24, Luke's OK on the review leftovers) The reply form inside an open post has no box of its own:
// the typing field's frame is what says "write here".
assert.match(openPost, /<form class="mt-2">/, 'the reply form is not a box inside the post');
assert.doesNotMatch(openPost, /<details open/, 'which starts closed');
assert.match(card, /thread-thread-1/, 'and the anchor other windows scroll to');
assert.match(card, /pointer-events-none/, 'the hover preview keeps its space reserved');
assert.match(card, /the second pass reads better/, 'the replies are on the card');

// 6. The new-post form: fields, the target it is filed against, and the way to file it.
const form = render(element(NewPostForm, { onClose: () => undefined, onCreated: () => undefined }));
assert.match(form, /<textarea/, 'a body field');
assert.match(form, /FILE COMMENT|POST/, 'and the button that files it');
assert.match(form, /FORUM BOARD/, 'the board it lands on is named');

// The destination is a file tree, not a drop-down: folders you open, leaves you click.
assert.match(form, /role="tree"/, 'the destination is a tree');
assert.match(form, /aria-label="Close FORUM BOARD"/, 'the board folder starts open');
assert.match(form, /\[-\]/, 'an open folder draws the Win95 minus box');
assert.match(form, /aria-label="Open HOME PAGE"/, 'the other pages are folders that start closed');
assert.match(form, /aria-selected="true"[^>]*>.*GENERAL BOARD/s, 'and the board is the selection');
assert.match(form, /\[board\]<\/span>/, 'a leaf says what kind of item it is');
assert.doesNotMatch(form, /HOME PORTAL ARCHIVE SUMMARY/, 'a closed folder draws none of its leaves');
// (2026-10-23, SPEC-efficiency.md) The `FILING INTO:` readback is cut: the tree's own selection says it.
assert.doesNotMatch(form, /FILING INTO:/, 'the choice is not restated under the tree that shows it');

// The artwork picker is the icon view of a file browser: thumbnail tiles, one chosen, the
// choice shown large beside them - and every image is a file, never something drawn here.
assert.match(form, /role="radiogroup" aria-label="Containing media"/, 'the media pane is a picker');
assert.match(form, /role="radio" aria-checked="true"/, 'exactly the current choice is checked');
// (2026-10-25, SPEC-less-text.md) The no-artwork tile `NONE - TEXT ONLY` (+ `PICK A SHEET TO ATTACH IT.`)
// shortened to `NONE`.
assert.match(form, />NONE</, 'a post may carry nothing');
assert.doesNotMatch(form, /NONE - TEXT ONLY|PICK A SHEET TO ATTACH IT/, 'said in one word');
assert.match(form, /url=%2Fassets%2F/, 'the tiles point at the hand-drawn files');
assert.equal((form.match(/<svg/g) ?? []).length, 0, 'and nothing is drawn in code');

// Tagging: the strip names the accounts, and the words are the tag.
assert.match(form, /TAG A USER:/, 'the composer offers to tag somebody');
// (2026-10-25, SPEC-less-text.md) The how-to line `OR WRITE @NAME IN THE POST - IT IS THE SAME TAG.` is cut (rule 1).
assert.doesNotMatch(form, /OR WRITE @NAME IN THE POST/, 'without the how-to line beside it');
assert.match(form, /PICK AN ACCOUNT\.\.\./, 'with the accounts to choose from');

// A reply answers somebody, so that somebody is tagged without being asked.
const replies = render(element(ForumThreadCard, { thread: THREAD }));
// (2026-10-25, SPEC-less-text.md) `ANSWERS THIS POST, SO <name> IS TAGGED AUTOMATICALLY.` -> `AUTO-TAGGED: <name>`.
assert.match(replies, /AUTO-TAGGED: /, 'the reply box says who it tags by itself');
assert.doesNotMatch(replies, /ANSWERS THIS POST, SO|IS TAGGED\s*AUTOMATICALLY/, 'in two words, not a sentence');
assert.match(replies, /TAG A USER:/, 'and offers the rest of the accounts');
// `(?<!AUTO-)`: the reply box's own `AUTO-TAGGED:` must not stand in for the post's tag row.
assert.match(replies, /(?<!AUTO-)TAGGED:/, 'the post itself says who it names');

// A post that names nobody has no tag row to draw: nothing is claimed that is not there.
const untagged = render(
  element(ForumThreadCard, { thread: { ...THREAD, body: 'no names here', comments: [] } }),
);
assert.doesNotMatch(untagged, /(?<!AUTO-)TAGGED:/);

// 7. The board itself: the wire, the controls, and a card per thread.
// (2026-11-04) A board still being read says so: it used to say THE BOARD IS EMPTY until the posts arrived.
FORUM.threads = [];
FORUM.ready = false;
const reading = render(element(ForumBoard, null));
assert.match(reading, /READING THE BOARD\.\.\./, 'a board being read says so');
assert.doesNotMatch(reading, /THE BOARD IS EMPTY/, 'and does not claim to be empty');
FORUM.ready = true;
assert.match(render(element(ForumBoard, null)), /THE BOARD IS EMPTY\./, 'a board that has been read and has nothing says that');

FORUM.threads = [THREAD];
const board = render(element(ForumBoard, null));
// (2026-10-23, SPEC-efficiency.md) With nothing pinned the newswire is not drawn at all (this fixture pins
// nothing: `pins: []`). Search lives in the `[ SORT / SEARCH ▾ ]` panel, one press away, so the
// closed board has no input of its own.
assert.doesNotMatch(board, /NEWSWIRE/, 'an empty wire is not drawn');
assert.match(board, /SHEET 03/, 'each thread is drawn');
// (2026-11-04, SPEC-forum-search.md, Luke 2026-10-31) `[ SORT / SEARCH ▾ ]` split in two: the search is a
// Discord-style box on the row itself, always drawn, and the key names the sort it is on. HOT is the default.
assert.match(board, /role="combobox"[^>]*aria-label="Search the board"/, 'there is something to search with, on the row itself');
assert.match(board, /\[ SORT: HOT ▾ \]/, 'and the sort key says which sort this is, one press away');
assert.doesNotMatch(board, /SORT \/ SEARCH/, 'the old key that hid the search is gone');
assert.match(board, /\[ TAGS ▾ \]/, 'and the tag filter beside it');
// (2026-10-24, Luke's OK on the review leftovers) Each panel is written straight after the key that opens
// it, so the Tab key reaches it next (before SORT / SEARCH and + NEW POST), and ESC hands focus back to
// that key. Read in the source: a server render never has a panel open. The real Tab/ESC walk was driven
// in a browser when this landed.
// (2026-11-04, SPEC-forum-search.md) The sort key is `[ SORT: <what> ▾ ]` now, written as a template, and the
// search box sits between the sort panel and + NEW POST; the order is unchanged.
{
  const boardSource = readFileSync('app/components/ForumBoard.tsx', 'utf8');
  const at = (pattern) => {
    const found = boardSource.search(pattern);
    assert.notEqual(found, -1, `ForumBoard draws ${pattern}`);
    return found;
  };
  const tagsKey = at(/\[ TAGS ▾ \]/);
  const tagsPanel = at(/id="board-tags-panel"/);
  const sortKey = at(/\[ SORT: \$\{sortKeyLabel\}/);
  const sortPanel = at(/id="board-controls-panel"/);
  const searchBox = at(/<ForumSearchBox\b/);
  const newPost = at(/\+ NEW POST\r?\n/);
  assert.ok(tagsKey < tagsPanel && tagsPanel < sortKey, 'the tags panel comes straight after its key');
  assert.ok(sortKey < sortPanel && sortPanel < searchBox && searchBox < newPost, 'the sort panel straight after its own, then the search box, before + NEW POST');
  assert.match(
    boardSource,
    /setMenu\(null\);\s*\/\/[^\n]*\n\s*\(menu === 'tags' \? tagsKeyRef : controlsKeyRef\)\.current\?\.focus\(\);/,
    'and ESC hands focus back to the key that opened the panel',
  );
}

FORUM.threads = [];
const emptyBoard = render(element(ForumBoard, null));
assert.doesNotMatch(emptyBoard, /SHEET 03/, 'an empty board draws no cards');

// 8. A picture in a post is the file, and a missing one is a notice.
const thumb = render(element(MediaThumbnail, { media: THREAD.media, size: 96 }));
assert.match(thumb, /sheet-03\.png/, 'the thumbnail points at the attachment');
assert.equal((thumb.match(/<svg/g) ?? []).length, 0, 'and draws nothing itself');

// 9. The artwork comment surfaces: the sheet, the control under it, and the window it opens.
const { CONCEPT_SHEETS } = require('./board-out/concepts/sheets.js');
const ConceptSheetFrame = require('./board-render/components/ConceptSheetFrame.js').default;
const CommentPopout = require('./board-render/components/CommentPopout.js').default;
const CommentWindow = require('./board-render/components/CommentWindow.js').default;

const sheet = CONCEPT_SHEETS[0];
const frame = render(element(ConceptSheetFrame, { sheet, index: 0 }));
assert.match(frame, /F1\b/, 'the frame is numbered');
// (2026-10-23, SPEC-efficiency.md) `ARCHIVE FILE: <path>` is cut (a raw path is nothing a reader acts on); the
// artwork is still the file on disk, below.
assert.doesNotMatch(frame, /ARCHIVE FILE:/, 'and prints no file path');
// (2026-10-23, SPEC-efficiency.md) With the printed path gone, the file is read where the picture asks
// for it: the image's address, which the image component carries URL-encoded.
assert.ok(frame.includes(encodeURIComponent(sheet.src)), 'the artwork is the file on disk');
assert.match(frame, /\[ COMMENT \]/, 'with the comment control under it');
assert.equal((frame.match(/<svg/g) ?? []).length, 0, 'and nothing drawn in code');

const anchor = sheet.anchor;
const popout = render(element(CommentPopout, { anchor }));
assert.match(popout, /aria-haspopup="dialog"/, 'the comment control opens a window, and says so');
assert.match(popout, /\[ COMMENT \]/, 'with no count while the item has no thread');

FORUM.commentCountForAnchor = () => 2;
const counted = render(element(CommentPopout, { anchor, compact: true }));
assert.match(counted, /\[ COMMENT \(2\) \]/, 'and the count once there is one');
// (2026-10-23, docs/theming.md) py-[2px] became py-0.5: the same 2px, on the spacing scale.
// (2026-10-23, SPEC-efficiency.md) Keys lost their 2px outline, so the small plate (PLATE) is px-1 py-1:
// the same height, 12px narrower. Still the small plate, which is what this asks.
assert.match(counted, /px-1 py-1(?![.\d])/, 'the compact control is the small plate');

const emptyWindow = render(element(CommentWindow, { anchor, onClose: () => undefined }));
assert.match(emptyWindow, new RegExp(`COMMENT WINDOW :: ${anchor.label}`), 'the window names the item');
// (2026-10-25, SPEC-less-text.md) `NO THREAD EXISTS FOR THIS ITEM YET.` + its how-to line were cut: the
// header's `NO THREAD YET` already says it. The `SOURCE: <kind> :: ID: <id>` readback (developer detail) is
// cut too; the `LOOK AT` link under the header still says what the window is attached to.
assert.match(emptyWindow, /NO THREAD YET/, 'an item nobody has discussed says so');
assert.doesNotMatch(emptyWindow, /NO THREAD EXISTS FOR THIS ITEM YET|opens one on the forum board automatically/, 'once, not twice');
assert.doesNotMatch(emptyWindow, /SOURCE: [A-Z-]+ :: ID:/, 'without the source/id readback');
assert.match(emptyWindow, /LOOK AT/, 'and the window still links what it is attached to');
assert.match(emptyWindow, /placeholder="Comment\.\.\."/, 'with the short placeholder');
assert.match(emptyWindow, /FILE COMMENT|POST/, 'with the box to start the thread');

// 10. The tag filter, and the reply a tag is often typed into. The chooser counts a tag wherever it
//     sits on a thread, so the filter has to find it there: a chip reading `MECHANICS (1)` that
//     showed an empty board was the bug this section exists to stop coming back.
const { buildTagVocabulary } = require('./board-out/forum/tag-vocabulary.js');
const { countTagHits, selectBoardThreads, threadTagKeys, threadTagMatches } = require('./board-out/forum/board-query.js');

const MECHANICS = { id: 'user-mechanics', kind: 'user', label: 'MECHANICS' };
const TAGGED_REPLY = {
  ...THREAD,
  id: 'thread-2',
  title: 'STAT BLOCK',
  tags: [{ id: 'cat-design', kind: 'category', label: 'DESIGN' }],
  comments: [
    comment('c1', 'reads better at 100 percent'),
    comment('c2', 'the reach rules are off', { tags: [MECHANICS] }),
  ],
};

const query = (tagKeys, tagMatchMode = 'any') => ({
  query: '',
  sourceFilter: 'all',
  tagKeys,
  tagMatchMode,
  sortMode: 'newest',
});

assert.equal(threadTagKeys(TAGGED_REPLY).includes('mechanics'), true, 'a tag on a reply is a tag on the thread');
assert.equal(countTagHits(TAGGED_REPLY, ['mechanics']), 1, 'and it counts as a hit');
assert.equal(
  selectBoardThreads([TAGGED_REPLY], query(['mechanics'])).length,
  1,
  'so the post it answers is what the filter shows',
);
assert.equal(selectBoardThreads([TAGGED_REPLY], query(['MECHANICS'])).length, 1, 'and casing never matters');
assert.equal(selectBoardThreads([TAGGED_REPLY], query(['mechanics'], 'all')).length, 1, 'and in ALL mode');
assert.equal(
  selectBoardThreads([TAGGED_REPLY], query(['design', 'mechanics'], 'all')).length,
  1,
  'ALL still means every selected tag, wherever on the thread each one sits',
);
assert.equal(selectBoardThreads([TAGGED_REPLY], query(['spoiler'])).length, 0, 'and nothing invents a match');
assert.equal(selectBoardThreads([THREAD], query(['mechanics'])).length, 0, 'a post nobody tagged with it stays out');

// The chooser's own count is the promise the filter has to keep: every tag it offers with a count
// has to bring at least one post.
const boardThreads = [THREAD, TAGGED_REPLY];
const vocabulary = buildTagVocabulary(boardThreads);
const offered = vocabulary.filter((option) => option.count > 0);

assert.equal(offered.length > 0, true, 'the chooser offers the tags in use');
assert.equal(
  offered.find((option) => option.key === 'mechanics')?.count,
  1,
  'MECHANICS is offered with the count the reply gave it',
);
// Every option says which namespace the filter panel files it under: the board's own vocabulary and
// the tags on a post are grouped by the same rule, or the panel and the post would disagree.
assert.equal(offered.find((option) => option.key === 'mechanics')?.namespace, 'user', 'MECHANICS is a user tag');
assert.equal(offered.find((option) => option.key === 'design')?.namespace, 'theme', 'DESIGN is a theme');
assert.equal(
  vocabulary.find((option) => option.key === 'spoiler')?.namespace,
  'warn',
  'and a starter tag nobody has used yet is still a warning',
);
assert.equal(
  vocabulary.every((option) => option.namespace.length > 0),
  true,
  'no offered tag is left without a namespace',
);
for (const option of offered) {
  assert.equal(
    selectBoardThreads(boardThreads, query([option.key])).length > 0,
    true,
    `${option.label} (${option.count}) brings a post`,
  );
}

// Where the match was found, which is what the card has to say: on the post, or on a reply.
const onReply = threadTagMatches(TAGGED_REPLY, ['mechanics']);
assert.equal(onReply.length, 1, 'one match on the reply');
assert.equal(onReply[0].comment.id, 'c2', 'naming the reply that carries it');
assert.equal(threadTagMatches(THREAD, ['design'])[0].comment, undefined, 'and a post tag names no reply');

const matched = render(element(ForumThreadCard, { thread: TAGGED_REPLY, tagFilter: ['mechanics'] }));
assert.match(matched, /FILTER MATCH:/, 'the card says which tag the filter matched');
assert.match(matched, /MECHANICS/, 'by name');
assert.match(matched, /IN 1 REPLY BY amy/, 'and that it was a reply, and whose');
// (2026-10-25, SPEC-less-text.md) `[ OPEN THE REPLY ]` -> `[ OPEN REPLY ]`, and its tip (which restated it) is cut.
assert.match(matched, /\[ OPEN REPLY \]/, 'with a way to open the post onto it');
assert.doesNotMatch(matched, /\[ OPEN THE REPLY \]|title="Open this post at the reply/, 'in the short wording, with no tip');
assert.match(matched, /id="comment-c2"/, 'the reply is what that button scrolls to');
assert.equal((matched.match(/FILTER MATCH/g) ?? []).length, 2, 'the matching reply is marked as well');
assert.equal((matched.match(/scroll-mt-24/g) ?? []).length, 1, 'and only it is ringed');

const onPost = render(element(ForumThreadCard, { thread: THREAD, tagFilter: ['design'] }));
assert.match(onPost, /ON THIS POST/, 'a match on the post itself says so');
assert.doesNotMatch(onPost, /\[ OPEN (THE )?REPLY \]/, 'and needs no button to open anything');
assert.equal((onPost.match(/scroll-mt-24/g) ?? []).length, 0, 'and no reply is marked');

assert.doesNotMatch(card, /FILTER MATCH/, 'with no filter on the board, a card talks about no matches');
assert.match(
  readFileSync('app/components/ForumBoard.tsx', 'utf8'),
  /tagFilter=\{tagFilters\}/,
  'and the board hands its filter to every card it draws',
);

// 11. Tags as a list of `namespace:name` tokens rather than a row of chips, and the fold that keeps a
//     post's tags to one line. The namespace is the half of a tag's meaning that says whether a word
//     is a theme read out of the post, a warning, or something a poster typed; the token is what lets
//     a list of six tags be a line instead of three rows of buttons.
const TagStrip = require('./board-render/components/TagStrip.js').default;
const { groupByNamespace, tagNamespace, tagToken } = require('./board-out/forum/tag-vocabulary.js');

const tag = (id, kind, label) => ({ id, kind, label });

assert.equal(tagToken(tag('cat-lore', 'category', 'LORE')), 'theme:lore', 'a theme tag is theme:name');
assert.equal(tagToken(tag('content-spoiler', 'content', 'SPOILER')), 'warn:spoiler', 'a warning is warn:name');
assert.equal(tagToken(tag('user-line', 'user', 'LINE WORK')), 'user:line-work', 'a typed tag is user:name, spaces and all');
assert.equal(tagToken(tag('source-board', 'source', 'BOARD')), 'filed:board', 'and a retired badge is filed:name');
assert.equal(tagNamespace(tag('user-line', 'user', 'line work')), 'user', 'the namespace is read off the kind');

const folded = groupByNamespace([
  { namespace: 'user', key: 'line-work' },
  { namespace: 'theme', key: 'lore' },
  { namespace: 'warn', key: 'spoiler' },
]);
assert.deepEqual(
  folded.map((group) => `${group.namespace}:${group.items.length}`),
  ['theme:1', 'warn:1', 'user:1'],
  'and the lists are filed theme first, then warn, then user',
);
assert.deepEqual(
  groupByNamespace([]).length,
  0,
  'a list with nothing in it draws no headings at all',
);

// The strip itself: the first N tokens, the rest behind `[+n]`, and the tokens that are there are
// links into the filter.
const many = Array.from({ length: 7 }, (_unused, index) => tag(`user-t${index}`, 'user', `TAG ${index}`));
const strip = render(element(TagStrip, { tags: many, limit: 5 }));
assert.equal((strip.match(/href="\/forum#tag-/g) ?? []).length, 5, 'five tokens, one line');
assert.match(strip, /\[\+2\]/, 'the other two behind a fold');
assert.doesNotMatch(textOf(strip), /user:tag-6/, 'and not drawn until they are asked for');
assert.doesNotMatch(strip, /\[-\]/, 'with nothing to fold back yet');
assert.match(textOf(strip), /user:tag-0/, 'the ones that are drawn say their namespace');

const openStrip = render(element(TagStrip, { tags: many }));
assert.equal((openStrip.match(/href="\/forum#tag-/g) ?? []).length, 7, 'no limit, no fold: every tag');
assert.match(
  render(element(TagStrip, { tags: [], emptyLabel: 'NO TAGS' })),
  /NO TAGS/,
  'and an empty list says so when it is asked to',
);

// The card's own tags go through it, and still filter: a token is a link, not decoration.
assert.match(textOf(card), /theme:design/, 'the post card writes its tags as tokens');
assert.match(card, /href="\/forum#tag-design"/, 'which filter the board to that tag');
// (2026-10-23, docs/theming.md) gap-x-[10px] became gap-x-2.5: the same 10px, on the spacing scale.
assert.match(card, /gap-x-2\.5/, 'in one wrapped line rather than a row of chips');

// The card's own replies label, which the tag work put a spotlight on: "0 REPLYS" was on every
// post that had none.
const { countReplies } = require('./board-out/forum/format.js');
assert.equal(countReplies(0), '0 REPLIES');
assert.equal(countReplies(1), '1 REPLY');
assert.equal(countReplies(4), '4 REPLIES');

// 12. The tag window: every tag in one ranked list, the board's music under its own tab, and the
//     rules that hold it together asked of the board itself. Rendering the window once per tab is
//     how a static render can be asked about all three.
const TagWindow = require('./board-render/components/TagWindow.js').default;
/** The window takes callbacks for everything it can do; a static render only has to hand them over. */
const noop = () => undefined;
const {
  collectFiledTracks,
  filedFileUploader,
  groupFiledTracks,
  sortFiledFiles,
} = require('./board-out/audio/forum-tracks.js');
const { carriesMusic, matchesMusicTags } = require('./board-out/forum/board-query.js');
const { buildArchiveRows } = require('./board-out/audio/archive-tree.js');

const musicTrack = (src, tags, title = 'GLASS CORRIDOR') => ({ src, title, credit: 'HEXHAM', length: '3:00', tags });

const MUSIC_POST = {
  ...THREAD,
  id: 'thread-music',
  title: 'A MIX',
  createdAt: '2026-09-22T09:00:00.000Z',
  tags: [{ id: 'cat-design', kind: 'category', label: 'DESIGN' }],
  track: musicTrack('/assets/audio/hexham-glass-corridor.mp3', ['LO FI', 'AMBIENT']),
  comments: [
    comment('c9', 'this one', {
      createdAt: '2026-09-22T10:00:00.000Z',
      track: musicTrack('/assets/audio/hexham-glass-corridor.mp3', ['LO FI']),
    }),
  ],
};
const QUIET_POST = { ...THREAD, id: 'thread-quiet', title: 'NO MUSIC HERE', comments: [] };
const musicBoard = [MUSIC_POST, QUIET_POST];

// One file, two posts: the count is what "popular" means, and the newest post is what "recent" is.
const filedOnBoard = collectFiledTracks(musicBoard);
const grouped = groupFiledTracks(filedOnBoard);
assert.equal(filedOnBoard.length, 2, 'the post and the reply both carry the file');
assert.equal(grouped.length, 1, 'which is one file');
assert.equal(grouped[0].count, 2, 'filed twice');
assert.equal(grouped[0].newest, '2026-09-22T10:00:00.000Z', 'recent is the newest filing');
assert.deepEqual(grouped[0].filings.map((entry) => entry.origin), ['REPLY', 'POST'], 'and the filings are newest first');
assert.equal(filedFileUploader(grouped[0]), 'amy', 'uploader is whoever filed it first');

// The board's music filter: a post carries music when it or a reply does, and a sound is matched by
// key like every other tag on the site.
assert.equal(carriesMusic(MUSIC_POST), true);
assert.equal(carriesMusic(QUIET_POST), false);
assert.equal(matchesMusicTags(MUSIC_POST, ['lo fi']), true, 'a sound is matched the way it is spelled');
assert.equal(matchesMusicTags(MUSIC_POST, ['drone']), false);
assert.equal(matchesMusicTags(QUIET_POST, []), true, 'and nothing chosen takes everything');
assert.deepEqual(
  selectBoardThreads(musicBoard, { query: '', sourceFilter: 'all', tagKeys: [], tagMatchMode: 'any', sortMode: 'newest', musicOnly: true }).map((thread) => thread.id),
  ['thread-music'],
  'the switch keeps only the post that carries it',
);
assert.deepEqual(
  selectBoardThreads(musicBoard, { query: '', sourceFilter: 'all', tagKeys: [], tagMatchMode: 'any', sortMode: 'newest', musicTagKeys: ['ambient'] }).map((thread) => thread.id),
  ['thread-music'],
  'and a sound keeps only the music wearing it',
);

// The archive says when a file was last posted and how many posts carry it: that is what the
// browser's own RECENT and POPULAR orderings are read from.
const archiveRows = buildArchiveRows([], musicBoard);
assert.equal(archiveRows[0].filedCount, 2, 'two posts carry the file');
assert.equal(archiveRows[0].filedAt, '2026-09-22T10:00:00.000Z');

// The window itself, one render per tab. `buildTagVocabulary(musicBoard)` is the provider's own list,
// so the index and the test tab are asked of the same board the rows above were.
FORUM.threads = musicBoard;
FORUM.tagVocabulary = buildTagVocabulary(musicBoard);

const windowMain = render(
  element(TagWindow, {
    onClose: noop,
    tagKeys: ['design'],
    onToggleTag: noop,
    onClearTags: noop,
    matchMode: 'any',
    onMatchMode: noop,
    musicOnly: false,
    onMusicOnly: noop,
    musicTagKeys: [],
    onToggleMusicTag: noop,
    showing: 2,
    total: 2,
  }),
);
// (2026-10-23, SPEC-efficiency.md) Titled TAG INDEX now, the name of the board key that opens it
// (`[ TAG INDEX... ]` in the `[ TAGS ▾ ]` panel); it was ALL TAGS, after the key that is gone.
assert.match(windowMain, /TAG INDEX/, 'the window is titled');
assert.match(windowMain, /\[ MAIN \]/, 'with a tab for the index');
assert.match(windowMain, /\[ MUSIC \]/, 'a tab for the music');
// (2026-10-25, SPEC-less-text.md) The TEST tab (developer diagnostics naming Temp/ file paths) is removed
// on purpose: two tabs now. The rules it ran are asked of the fixture board below instead.
assert.doesNotMatch(windowMain, /\[ TEST \]/, 'and no TEST tab any more');
// (2026-10-25, SPEC-less-text.md) The header `n TAGS, MOST USED FIRST :: n INCLUDED :: CLICK ONE TO INCLUDE IT
// IN THE BOARD` is cut to `n INCLUDED`. The ranking is still the order the ticks are drawn in.
assert.match(windowMain, /1 INCLUDED/, 'the index says how many tags are included');
assert.doesNotMatch(windowMain, /MOST USED FIRST|CLICK ONE TO INCLUDE IT/, 'without the how-to header');
// Each tick is drawn by its key; walking the text in vocabulary order (which is ranked by use) finds every
// one after the last, so the drawn order is the ranked order.
const mainText = textOf(windowMain);
let cursor = 0;
for (const option of FORUM.tagVocabulary) {
  const at = mainText.indexOf(option.key, cursor);
  assert.ok(at >= cursor, `${option.key} is drawn, in its ranked place (most used first)`);
  cursor = at + option.key.length;
}
assert.match(windowMain, /design/, 'every tag is listed');
assert.match(windowMain, /aria-pressed="true"/, 'the one the board is filtering by is marked');
assert.match(textOf(windowMain), /2 OF 2 POSTS SHOWN/, 'and the window says what the board is showing');
assert.doesNotMatch(windowMain, /MUSIC TAGS \(/, 'the other tab stays out of the render');

const windowMusic = render(
  element(TagWindow, {
    onClose: noop,
    tagKeys: [],
    onToggleTag: noop,
    onClearTags: noop,
    matchMode: 'any',
    onMatchMode: noop,
    musicOnly: true,
    onMusicOnly: noop,
    musicTagKeys: ['lo-fi'],
    onToggleMusicTag: noop,
    showing: 1,
    total: 2,
    initialTab: 'music',
  }),
);
// (2026-10-25, SPEC-less-text.md) `FILTER THE FORUM TO MUSIC ONLY` -> `MUSIC ONLY`; `SET MUSIC TAGS (n IN FORCE)
// :: A POST SHOWS WHEN ITS MUSIC WEARS ONE` -> `MUSIC TAGS (n)`; the `n OF n POSTS CARRY A TRACK :: n FILE(S)
// FILED ON THE BOARD` readback is cut (the file list under it shows the files).
assert.match(windowMusic, /MUSIC ONLY/, 'the music tab has the switch');
assert.doesNotMatch(windowMusic, /FILTER THE FORUM TO MUSIC ONLY/, 'in two words');
assert.match(windowMusic, /checked=""/, 'which is ticked when it is on');
assert.match(textOf(windowMusic), /MUSIC TAGS \(1\)/, 'and the sounds, to filter the board by what it sounds like');
assert.doesNotMatch(windowMusic, /SET MUSIC TAGS|IN FORCE|A POST SHOWS WHEN ITS MUSIC WEARS ONE/, 'with the short heading');
assert.doesNotMatch(textOf(windowMusic), /FILE\(S\) FILED ON THE BOARD|POSTS CARRY A TRACK/, 'and no count readback');
assert.match(windowMusic, /FIND A FILE:/, 'with a searcher over the files themselves');
assert.match(windowMusic, /ORDER:/, 'and an order to ask for');
for (const label of ['RECENT', 'POPULAR', 'UPLOADER']) {
  assert.match(windowMusic, new RegExp(`>${label}<`), `${label} is one of the orders`);
}
assert.match(windowMusic, /GLASS CORRIDOR/, 'the file is listed');
assert.match(textOf(windowMusic), /FILED 2×/, 'with how many posts carry it');
assert.match(windowMusic, /\[ PLAY \]/, 'and a way to play it');
assert.match(windowMusic, /\[ OPEN POST \]/, 'and a way back to the post it was filed on');

const windowTest = render(
  element(TagWindow, {
    onClose: noop,
    tagKeys: [],
    onToggleTag: noop,
    onClearTags: noop,
    matchMode: 'any',
    onMatchMode: noop,
    musicOnly: true,
    onMusicOnly: noop,
    musicTagKeys: [],
    onToggleMusicTag: noop,
    showing: 1,
    total: 2,
    initialTab: 'test',
  }),
);
// (2026-10-25, SPEC-less-text.md) The TEST tab is gone on purpose: asked for by its old key, the window
// draws no test panel, and the source keeps no trace of the tab or its self-test.
assert.doesNotMatch(windowTest, /PROPERTIES HOLD|\[ PASS \]|\[ FAIL \]|\[ TEST \]/, 'no TEST tab, even when asked for');
assert.doesNotMatch(windowTest, /Temp\/check-/, 'and no developer file paths on screen');
const tagWindowSource = readFileSync('app/components/TagWindow.tsx', 'utf8');
assert.doesNotMatch(tagWindowSource, /'test'|\[ TEST \]|boardSelfTest|testPanel/, 'the TEST tab is gone from the source');
// The rules the tab used to run in the browser, asked of the same fixture board here instead, so the
// promises it reported on are still held by a check.
const windowOptions = FORUM.tagVocabulary;
assert.ok(
  windowOptions.every((option, index) => index === 0 || windowOptions[index - 1].count >= option.count),
  'the tag list is ranked by use',
);
assert.ok(
  windowOptions.filter((option) => option.count > 0).every(
    (option) => selectBoardThreads(musicBoard, query([option.key])).length > 0,
  ),
  'every tag offered brings a post',
);
assert.ok(
  selectBoardThreads(musicBoard, { ...query([]), musicOnly: true }).every(carriesMusic),
  'music only keeps posts carrying a track',
);
const recentFiles = sortFiledFiles(grouped, 'recent').map((file) => Date.parse(file.newest));
assert.ok(recentFiles.every((at, index) => index === 0 || recentFiles[index - 1] >= at), 'recent is newest first');
const popularFiles = sortFiledFiles(grouped, 'popular').map((file) => file.count);
assert.ok(popularFiles.every((n, index) => index === 0 || popularFiles[index - 1] >= n), 'popular is most posted first');

console.log('board + comment checks passed');
console.log('  replies    :', THREAD.comments.length, 'nested to depth 3, capped by maxIndentDepth');
console.log('  controls   : a guest gets none, the poster none, the house account all of them');
console.log('  card/form  : title, body, tags, artwork, replies, target and file button');
console.log('  board      : the wire, the search field and a card per thread');
console.log('  tag filter : a tag on a reply brings the post, and the card opens onto that reply');
