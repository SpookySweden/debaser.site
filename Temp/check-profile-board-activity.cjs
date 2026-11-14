/*
 * BOARD ACTIVITY on a profile: folded by default, and does every row lead to its own post or reply?
 *   npx tsc app/lib/forum/anchors.ts app/lib/profile/board-activity.ts --outDir Temp/board-activity-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/ProfileBoardActivity.tsx --outDir Temp/board-activity-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-profile-board-activity.cjs
 *
 * Luke, 2026-11-14: "clicking on a comment or any kind of forum or interaction under a users profile, in the list,
 * needs to bring you more directly to the corresponding thread" and "make board activity expandable and collapsd by
 * default".
 *
 * Offline. What it holds:
 *   - the board's address is read as a post, a reply or a tag, and nothing else (`readBoardAddress`);
 *   - an address finds the post it names, or the post holding the reply it names, and finds nothing while the
 *     board does not have it, which is what makes the board wait instead of guessing (`findBoardPost`);
 *   - the list is this person's posts AND replies, newest first, each with the address of exactly that post or
 *     reply, with nothing from a private record (`boardActivityRows`);
 *   - the section is drawn shut: one key carrying aria-expanded="false", and no rows in the page until it is pressed.
 *
 * What it cannot hold: that the board really lands on the post (its page, open, in view, marked). That is a browser's
 * job: `scripts/drive-profile-rows.cjs`.
 */
const assert = require('node:assert/strict');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'next/link') {
    return {
      __esModule: true,
      default: ({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const anchors = require('./board-activity-out/forum/anchors.js');
const { boardActivityRows, BOARD_ACTIVITY_STEP } = require('./board-activity-out/profile/board-activity.js');

// 1. The address.
assert.deepEqual(anchors.readBoardAddress('#thread-abc'), { kind: 'thread', id: 'abc' }, 'a post');
assert.deepEqual(anchors.readBoardAddress('#comment-r9'), { kind: 'comment', id: 'r9' }, 'a reply');
assert.deepEqual(anchors.readBoardAddress('#tag-LO%20FI'), { kind: 'tag', key: 'LO FI' }, 'a tag, decoded');
assert.deepEqual(
  anchors.readBoardAddress('#thread-profile:user-1:picture:v2'),
  { kind: 'thread', id: 'profile:user-1:picture:v2' },
  "a profile's comment thread keeps its whole id, colons and all",
);
assert.equal(anchors.readBoardAddress(''), null, 'no address');
assert.equal(anchors.readBoardAddress('#thread-'), null, 'an empty id names nothing');
assert.equal(anchors.readBoardAddress('#forum-thread-list'), null, 'some other anchor on the page');
assert.deepEqual(anchors.readBoardAddress('#thread-50%'), { kind: 'thread', id: '50%' }, 'a stray percent sign does not throw');

assert.equal(anchors.boardThreadHref('abc'), '/forum#thread-abc');
assert.equal(anchors.boardCommentHref('r9'), '/forum#comment-r9');
// The address a row is given is the address the board reads back.
assert.deepEqual(anchors.readBoardAddress(anchors.boardThreadHref('abc').slice('/forum'.length)), { kind: 'thread', id: 'abc' });
assert.deepEqual(anchors.readBoardAddress(anchors.boardCommentHref('r9').slice('/forum'.length)), { kind: 'comment', id: 'r9' });

// 2. The board, as a reader holds it.
const person = { id: 'user-sweden', displayName: 'sweden' };
const other = { id: 'user-amy', displayName: 'amy' };
const thread = (id, author, createdAt, comments = [], extra = {}) => ({
  id,
  title: `TITLE ${id}`,
  body: 'words',
  author,
  createdAt,
  anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' },
  tags: [],
  origin: 'user',
  comments,
  ...extra,
});
const reply = (id, threadId, author, createdAt, body) => ({ id, threadId, author, createdAt, body, tags: [] });

const threads = [
  thread('t1', person, '2026-11-01T10:00:00.000Z', [reply('r1', 't1', other, '2026-11-01T11:00:00.000Z', 'nice one')]),
  thread('t2', other, '2026-11-02T10:00:00.000Z', [
    reply('r2', 't2', person, '2026-11-05T09:00:00.000Z', 'a reply   over\ntwo lines'),
    reply('r3', 't2', other, '2026-11-05T10:00:00.000Z', 'not theirs'),
  ]),
  // A comment left on somebody's profile is a reply in that profile's own thread on the board.
  thread('profile:user-amy', { id: null, displayName: 'debaser.site' }, '2026-11-06T10:00:00.000Z', [
    reply('pc1', 'profile:user-amy', person, '2026-11-06T10:00:00.000Z', 'love the picture'),
  ]),
  // An item's own thread (no body: a comment box opened it). Whoever commented first is stored as its author, but
  // the board credits it to the site, so it is not their post: their comment in it is their row.
  thread('item-1', person, '2026-10-20T10:00:00.000Z', [reply('r4', 'item-1', person, '2026-10-20T10:00:00.000Z', 'need to add this')], {
    body: '',
    anchor: { kind: 'web', id: 'web-1', label: 'The Recluse - Cymande' },
  }),
  // A private stream's record: no title, nothing to lead to.
  thread('private-1', person, '2026-11-07T10:00:00.000Z', [], { title: '', privateRecord: { messages: 3 } }),
];

assert.equal(anchors.findBoardPost(threads, { kind: 'thread', id: 't2' }).thread.id, 't2', 'a post is found by its id');
const held = anchors.findBoardPost(threads, { kind: 'comment', id: 'pc1' });
assert.equal(held.thread.id, 'profile:user-amy', 'a reply is found in the post that holds it');
assert.equal(held.commentId, 'pc1', 'and the reply itself is what gets marked');
assert.equal(anchors.findBoardPost(threads, { kind: 'thread', id: 'gone' }), null, 'a post the board does not hold is not guessed at');
assert.equal(anchors.findBoardPost([], { kind: 'comment', id: 'r2' }), null, 'nor a reply, while the board is still empty');
assert.equal(anchors.findBoardPost(threads, { kind: 'tag', key: 'x' }), null, 'a tag is not a post');

// 3. The rows.
const rows = boardActivityRows(threads, 'user-sweden');
assert.deepEqual(
  rows.map((row) => row.id),
  ['reply:pc1', 'reply:r2', 'post:t1', 'reply:r4'],
  'their posts and their replies, newest first, nobody else\'s, no private record, and an item\'s thread only as their comment in it',
);
assert.equal(rows[3].title, 'COMMENTS ON The Recluse - Cymande', "an item's thread is named as the board names it");
assert.equal(rows[0].href, '/forum#comment-pc1', 'a comment on a profile leads to that comment on the board');
assert.equal(rows[1].href, '/forum#comment-r2', 'a reply leads to that reply, not just to its post');
assert.equal(rows[2].href, '/forum#thread-t1', 'a post leads to that post');
assert.equal(rows[1].words, 'a reply over two lines', "a reply's words, on one line");
assert.equal(rows[1].title, 'TITLE t2', 'and the post it was written under');
assert.equal(rows[2].words, undefined, 'a post is named by its title alone');
// Every row's address is one the board can find on this same board.
for (const row of rows) {
  const address = anchors.readBoardAddress(row.href.slice('/forum'.length));
  assert.notEqual(anchors.findBoardPost(threads, address), null, `${row.id} leads somewhere on the board`);
}
assert.deepEqual(boardActivityRows(threads, 'user-nobody'), [], 'somebody who has done nothing has no rows');
assert.ok(BOARD_ACTIVITY_STEP >= 5, 'the list opens with a readable handful');

// 4. The section, as the page first draws it: shut.
const ProfileBoardActivity = require('./board-activity-render/components/ProfileBoardActivity.js').default;
const shut = renderToStaticMarkup(React.createElement(ProfileBoardActivity, { userId: 'user-sweden', threads }));
assert.match(shut, /BOARD ACTIVITY/, 'the title is always there');
assert.match(shut, /aria-expanded="false"/, 'one key, and it says the list is folded away');
assert.match(shut, /\[ SHOW ▾ \]/, 'named for what it does');
assert.doesNotMatch(shut, /TITLE t1|comment-pc1|NOTHING YET/, 'and nothing of the list is drawn until it is pressed');
assert.doesNotMatch(shut, /\d+ REPL(Y|IES)/, 'no counts: a profile shows a person, not a console');

console.log('check-profile-board-activity: ok');
