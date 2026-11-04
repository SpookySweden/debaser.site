/*
 * Read and unread on the board: what a reader has opened, what is new since, and what the rows are
 * drawn in.
 *   npx tsc app/lib/forum/read-state.ts --outDir Temp/read-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-board-read.cjs
 *
 * The rule this file holds is the one the owner asked for: a post the reader has opened goes quiet and
 * one they have not stays white, and the same is asked of every reply *independently* - so a post read
 * last week with two replies filed since is a quiet post with white rows in it. That is the whole
 * reason the marker is an instant rather than a flag.
 *
 * The module is driven for real, with a fake `localStorage` installed before it is required, because
 * the interesting cases are the ones a source grep cannot see: a value somebody edited by hand, a
 * reply filed one second after the marker, an account's marks leaking into another account's.
 */
const assert = require('node:assert/strict');

/** The smallest `localStorage` the module can be fooled by. */
function fakeStorage() {
  const rows = new Map();

  return {
    rows,
    getItem: (key) => (rows.has(key) ? rows.get(key) : null),
    setItem: (key, value) => {
      rows.set(key, String(value));
    },
    removeItem: (key) => {
      rows.delete(key);
    },
  };
}

global.window = { localStorage: fakeStorage() };

const storage = global.window.localStorage;
const { GUEST_ACCOUNT, accountOf, loadMarks, postIsRead, replyIsRead, saveThreadRead } = require('./read-out/read-state.js');

const MORNING = '2026-09-29T09:00:00.000Z';
const NOON = '2026-09-29T12:00:00.000Z';
const EVENING = '2026-09-29T18:00:00.000Z';

// 1. Nothing read is a row with nothing in the map at all - not a flag set to false.
const empty = loadMarks('account-a');
assert.deepEqual(empty, {}, 'a reader who has opened nothing has no marks');
assert.equal(postIsRead(empty, 't1'), false, 'so every post is unread');
assert.equal(replyIsRead(empty, 't1', MORNING), false, 'and every reply in it is too');

// 2. Opening a post marks it read, and the mark is in storage rather than only in memory.
const after = saveThreadRead('account-a', 't1', NOON);
assert.equal(postIsRead(after, 't1'), true, 'opening a post reads it');
assert.equal(postIsRead(after, 't2'), false, 'and reads nothing else');
assert.equal(postIsRead(loadMarks('account-a'), 't1'), true, 'the mark survives into the next read');

// 3. The replies that were there when it was opened are read; one filed after is not. This is the whole
//    point of the instant: both, neither, or one of the two.
assert.equal(replyIsRead(after, 't1', MORNING), true, 'a reply filed before the marker has been read');
assert.equal(replyIsRead(after, 't1', NOON), true, 'one filed at the same instant counts as read');
assert.equal(replyIsRead(after, 't1', EVENING), false, 'one filed after the marker is still new');
assert.equal(replyIsRead(after, 't2', MORNING), false, 'and a reply in a post nobody opened is new');

// 4. A second visit moves the marker, and what was new becomes read without anything else changing.
const later = saveThreadRead('account-a', 't1', EVENING);
assert.equal(replyIsRead(later, 't1', EVENING), true, 'the next visit reads the reply filed since the last one');
assert.equal(postIsRead(later, 't1'), true, 'and the post is still read');

// 5. Per account, and a guest is an account of its own rather than everybody.
saveThreadRead(GUEST_ACCOUNT, 't9', NOON);
assert.equal(postIsRead(loadMarks(GUEST_ACCOUNT), 't9'), true, 'a signed-out reader has their own marks');
assert.equal(postIsRead(loadMarks('account-b'), 't9'), false, 'which the next account to sign in does not inherit');
assert.equal(accountOf({ id: null, displayName: 'Anonymous' }), GUEST_ACCOUNT, 'no account is the guest account');
assert.equal(accountOf({ id: 'user-7', displayName: 'seven' }), 'user-7', 'and an account is keyed by its own id');

// 6. The store is re-read from scratch for the hand-edited cases: the module caches what it parsed,
//    and a second `require` of the same file is what a fresh page view does.
function freshStore(value) {
  const modulePath = require.resolve('./read-out/read-state.js');
  delete require.cache[modulePath];
  storage.setItem('debaser.forum.read.v1', value);

  return require(modulePath);
}

// A marker that is not an instant is dropped rather than compared, and a whole account row that is not
// an object goes with it - a value in localStorage is a value a user can edit.
const reparsed = freshStore(
  JSON.stringify({ version: 1, accounts: { 'account-c': { t1: 'yesterday', t2: NOON }, broken: 7 } }),
);
assert.deepEqual(reparsed.loadMarks('account-c'), { t2: NOON }, 'a hand-edited value is dropped, and the rest survives');
assert.equal(reparsed.postIsRead(reparsed.loadMarks('account-c'), 't1'), false, 'so a post with a bogus marker reads as unread');

// Storage that cannot be parsed at all reads as nothing read, which is the honest answer.
assert.deepEqual(freshStore('not json').loadMarks('account-d'), {}, 'a store that cannot be parsed is an empty one');
assert.deepEqual(freshStore('').loadMarks('account-d'), {}, 'and so is an empty one');

// A mark whose instant is not a date is refused rather than stored: `saveThreadRead` answers with the
// marks as they stand, so a caller cannot be handed a map that disagrees with what is on disk.
assert.deepEqual(freshStore(JSON.stringify({ version: 1, accounts: {} })).saveThreadRead('account-e', 't1', 'never'), {}, 'a mark that is not an instant is not written');

// 7. What the rows are drawn in. The board's own markup renders through a provider tree this check does
//    not stub (check-board-comments.cjs is the one that does), so the *drawing* half is held at source:
//    the two fills are one shared pair, both kinds of row take them from there rather than writing a
//    class of their own, and the pair resolves to the two tokens whose contrast check-surreal holds.
const fs = require('node:fs');
const controls = fs.readFileSync('app/lib/ui/controls.ts', 'utf8');
assert.match(controls, /export const ROW_READ = 'bg-chrome-dark text-ink';/, 'a read row is the furniture surface, read in the field ink');
assert.match(controls, /export const ROW_UNREAD = 'bg-paper text-ink';/, 'and an unread row is the plain field');
assert.match(controls, /ROW_READ[\s\S]{0,240}ROW_UNREAD/, 'declared as a pair, so one cannot be changed without the other being read');

const cardSource = fs.readFileSync('app/components/ForumThreadCard.tsx', 'utf8');
assert.match(cardSource, /isRead \? ROW_READ : ROW_UNREAD/, 'the post row is filled by whether it has been read');
assert.match(cardSource, /postIsRead\(forum\.seenByThread, thread\.id\)/, 'and that is the question it is filled from, not a local flag');
assert.match(cardSource, /seenByThread=\{forum\.seenByThread\}/, 'the replies are handed the same marks');

const listSource = fs.readFileSync('app/components/CommentThreadList.tsx', 'utf8');
assert.match(
  listSource,
  /read=\{replyIsRead\(seenByThread, thread\.id, comment\.createdAt\)\}/,
  'each reply is asked about its own instant, independently of the post',
);

const replySource = fs.readFileSync('app/components/CommentNodeCard.tsx', 'utf8');
assert.match(replySource, /read \? ROW_READ : ROW_UNREAD/, 'and the reply row is filled by that answer');

// The gallery is the same posts read the other way, so its tiles go quiet by the same rule.
const viewSource = fs.readFileSync('app/components/ForumGalleryView.tsx', 'utf8');
assert.match(viewSource, /read=\{postIsRead\(seenByThread, thread\.id\)\}/, 'a gallery tile is asked the same question');
const tileSource = fs.readFileSync('app/components/ForumGalleryTile.tsx', 'utf8');
assert.match(tileSource, /read \? ROW_READ : ROW_UNREAD/, 'and filled from the same pair');

const boardSource = fs.readFileSync('app/components/ForumBoard.tsx', 'utf8');
const openCalls = boardSource.match(/markThreadRead\(/g) ?? [];
assert.ok(
  openCalls.length >= 4,
  `every way a post can open marks it read - a click, a tile, a #thread- link and filing one (found ${openCalls.length})`,
);
assert.match(boardSource, /if \(open\) markThreadRead\(threadId\)/, 'and closing a post does not');

console.log('board read checks passed');
console.log('  marks    : a post is read once opened, and the marker is an instant');
console.log('  replies  : filed before it they are read, filed after they are new - independently of the post');
console.log('  accounts : per account, guest included, and no account inherits another`s reading');
console.log('  storage  : a hand-edited or unparseable store is dropped rather than trusted');
console.log('  fills    : ROW_READ / ROW_UNREAD, drawn by the post row and by every reply (held at source; see the note in this file)');

