/*
 * FORUMFIX (review fixes, 2026-11-17, Luke's answers to a Claude review run): the rules under the six fixes (run from
 * the root):
 *   npx tsc app/lib/forum/board-query.ts app/lib/auth/lost-account.ts app/lib/ui/art/on-disk.ts app/lib/profile/text-face.ts app/components/ProfileAvatar.tsx --rootDir app --outDir Temp/forumfix-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-forumfix.cjs
 *
 * 1. "Had an account?": NOT NOW is kept in this browser for the case it was said about, and a new case asks again.
 * 3. Luke's 4A: an auto-made STREAM record stays off the main board (ALL SOURCES) until somebody replies to it;
 *    STREAMS lists them all.
 * 5. "make a default silly art fitting the site": an account with no picture wears a face built from text
 *    characters (never a drawing, never a request for a missing file), readable at every size the slot is shown;
 *    the house picture's file is only asked for once it is on disk.
 * The browser parts (the window, the 24px hit areas, REPLY building the form, the plain line, the Google key) are
 * driven on a local mock server: scripts/drive-forumfix.cjs.
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

const OUT = './forumfix-out';
const read = (file) => readFileSync(file, 'utf8');
let passed = 0;
const ok = (what, test) => {
  test();
  passed += 1;
  console.log(`  ok  ${what}`);
};

// --- 1. NOT NOW is remembered --------------------------------------------------------------------------
const lost = require(`${OUT}/lib/auth/lost-account.js`);
ok('NOT NOW is kept for the case it was said about, and a new case asks again', () => {
  assert.equal(typeof lost.rememberNotNow, 'function', 'lost-account.ts keeps NOT NOW');
  assert.equal(lost.saidNotNowTo('asking'), false, 'nothing said yet');
  lost.rememberNotNow('asking');
  assert.equal(lost.saidNotNowTo('asking'), true, 'said for the first question');
  assert.equal(lost.saidNotNowTo(JSON.stringify({ email: 'a@b.c', name: 'A' })), false, 'a lost account found later asks again');
});
ok('the window reads the kept NOT NOW and keeps off /account', () => {
  const source = read('app/components/LostAccountWindow.tsx');
  assert.match(source, /saidNotNowTo\(/, 'the window asks whether NOT NOW was said');
  assert.match(source, /rememberNotNow\(/, 'NOT NOW is written down');
  assert.match(source, /'\/account'/, 'the window knows the login page');
});

// --- 3. STREAM records off the main board ----------------------------------------------------------------
const query = require(`${OUT}/lib/forum/board-query.js`);
const thread = (id, anchor, comments = []) => ({
  id,
  title: id,
  body: '',
  author: { id: null, displayName: 'ALICE' },
  createdAt: '2026-11-17T00:00:00Z',
  anchor,
  tags: [],
  comments,
  origin: 'user',
});
const reply = { id: 'r', threadId: 's2', body: 'hi', author: { id: null, displayName: 'BOB' }, createdAt: '2026-11-17T00:01:00Z', tags: [] };
const general = { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' };
const plain = thread('p', general);
const quiet = thread('s1', { kind: 'board', id: 'watch:room-1', label: 'STREAM' });
const answered = thread('s2', { kind: 'board', id: 'watch:room-2', label: 'STREAM' }, [reply]);
const options = { query: '', sourceFilter: 'all', tagKeys: [], tagMatchMode: 'any', sortMode: 'newest' };
ok('ALL SOURCES leaves out a stream record nobody replied to, and keeps one with a reply', () => {
  const ids = query.selectBoardThreads([plain, quiet, answered], options).map((t) => t.id).sort();
  assert.deepEqual(ids, ['p', 's2']);
});
ok('STREAMS lists every record', () => {
  const ids = query.selectBoardThreads([plain, quiet, answered], { ...options, sourceFilter: 'stream' }).map((t) => t.id).sort();
  assert.deepEqual(ids, ['s1', 's2']);
});
ok('onMainBoard says the same, for the jump to a post', () => {
  assert.equal(query.onMainBoard(plain), true);
  assert.equal(query.onMainBoard(quiet), false);
  assert.equal(query.onMainBoard(answered), true);
});
ok('the board has a STREAMS key beside FEED and GALLERY', () => {
  const board = read('app/components/ForumBoard.tsx');
  assert.match(board, /\[ STREAMS \]/, 'a STREAMS key');
  assert.match(board, /onMainBoard\(/, 'a jump to a quiet record opens STREAMS');
});

// --- 4. the reply form waits for REPLY -------------------------------------------------------------------
ok('the post builds its reply form only after REPLY', () => {
  const card = read('app/components/ForumThreadCard.tsx');
  assert.match(card, /data-post-reply/, 'a REPLY key on the post');
  assert.match(card, /replyOpen \? \(\s*<CommentComposer/, 'the composer is drawn only while REPLY is open');
});

// --- 5. the text face ------------------------------------------------------------------------------------
const art = require(`${OUT}/lib/ui/art/on-disk.js`);
const faces = require(`${OUT}/lib/profile/text-face.js`);
ok('a file is only asked for once the build saw it on disk', () => {
  assert.equal(art.artOnDisk('/assets/profiles/avatar-default.png'), false, 'the default picture is not drawn yet');
  assert.equal(art.artOnDisk('/assets/icons/google-retro.png'), false, 'nor the Google mark');
});
ok('the face is text characters only, and fits each size the slot is shown at', () => {
  for (const size of [128, 96, 80, 56, 48, 28, 26, 20]) {
    const face = faces.textFaceFor(size);
    assert.match(face.face, /^[\x20-\x7e]+$/, `${size}px: plain characters the site's own font has (${face.face})`);
    // IBM Plex Mono is 0.6em a character; the smallest size used is text-label, 13px (nothing under 13px).
    const px = { 'text-label': 13, 'text-key': 14, 'text-title': 16, 'text-heading': 18, 'text-display': 20, 'text-headline': 24 }[face.sizeClass];
    assert.ok(px !== undefined && px >= 13, `${size}px: a site text size (${face.sizeClass})`);
    assert.ok(face.face.length * px * 0.6 <= size - 2, `${size}px: ${face.face} at ${px}px fits inside the frame`);
  }
});
// A server render from here on: next/image takes a `window` for a browser and reaches for `document`.
delete globalThis.window;
const ProfileAvatar = require(`${OUT}/components/ProfileAvatar.js`).default;
const { DEFAULT_AVATAR_SRC } = require(`${OUT}/lib/profile/avatar-catalogue.js`);
const html = (props) => renderToStaticMarkup(React.createElement(ProfileAvatar, { displayName: 'ALICE', ...props }));
ok('an account with no picture wears the text face, framed or plain, with no image asked for', () => {
  for (const variant of ['plain', 'framed']) {
    for (const size of [128, 28]) {
      const out = html({ variant, size });
      assert.match(out, /data-text-face/, `${variant} ${size}px wears the face`);
      assert.doesNotMatch(out, /<img/, `${variant} ${size}px asks for no file`);
    }
  }
});
ok('the house picture is the face too until its file is on disk', () => {
  const out = html({ variant: 'plain', size: 28, src: DEFAULT_AVATAR_SRC });
  assert.match(out, /data-text-face/);
  assert.doesNotMatch(out, /avatar-default\.png"/, 'no request for the undrawn file');
});
ok('a real picture is still shown', () => {
  const out = html({ variant: 'plain', size: 28, src: '/assets/profiles/uploads/x.png' });
  assert.doesNotMatch(out, /data-text-face/);
});
ok('the Google key is text until its mark is on disk, and the build reads the disk', () => {
  const key = read('app/components/GoogleSignInButton.tsx');
  assert.match(key, /artOnDisk\(GOOGLE_ICON_SRC\)/, 'the key asks whether the mark is drawn');
  const config = read('next.config.ts');
  assert.match(config, /ART_ON_DISK/, 'next.config.ts tells the build which art files exist');
});

// --- 6. the plain line -----------------------------------------------------------------------------------
ok('the guest strip says plainly what ERROR: UNREGISTERED ENTITY means', () => {
  const strip = read('app/components/GuestPrompt.tsx');
  assert.match(strip, /ERROR: UNREGISTERED ENTITY\./, 'the flavour stays');
  assert.match(strip, /NOT SIGNED IN/, 'the plain line');
});

console.log(`\ncheck-forumfix: ${passed} passed`);
