/*
 * SPEC-forum-v2.md (Luke's answers, 2026-11-17): the pure parts of the board's keys working together.
 *   npx tsc app/lib/forum/board-address.ts app/lib/forum/board-empty.ts app/lib/forum/board-new.ts app/lib/forum/news-feed.ts app/lib/forum/stream-facts.ts app/lib/forum/board-query.ts --outDir Temp/forum-v2-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-forum-v2.cjs
 *
 * 1A/2A the place in the address and this browser's memory; 4A BOARD THREADS hides unanswered records; 11A the empty
 * line names its filters; 9B the NEW count; 8A the wire carries the newest after the pins; 3A a record's facts.
 * The board's own wiring (one tab lit, Back, undo, tags set aside) is driven in a browser: scripts/drive-forum-v2.cjs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const out = './forum-v2-out/forum';
const { readBoardPlace, writeBoardPlace, parseStoredPlace, DEFAULT_PLACE } = require(`${out}/board-address.js`);
const { emptyBoardLine } = require(`${out}/board-empty.js`);
const { countNewPosts, newLabel } = require(`${out}/board-new.js`);
const { buildNewsFeed } = require(`${out}/news-feed.js`);
const { streamFacts, streamLength } = require(`${out}/stream-facts.js`);
const { selectBoardThreads } = require(`${out}/board-query.js`);

const params = (search) => new URLSearchParams(search);

/* 1A / 2A: the place in the address ------------------------------------------------------------ */
assert.equal(readBoardPlace(params('')), null, 'a plain /forum names no place (memory may fill in)');
assert.equal(readBoardPlace(params('sort=new&arcade=1')), null, 'nor does an address of other things');
assert.deepEqual(readBoardPlace(params('view=gallery&tags=user%3Alore,user%3Aart&match=all')), {
  view: 'gallery',
  tags: ['user:lore', 'user:art'],
  match: 'all',
});
assert.deepEqual(readBoardPlace(params('view=nonsense')), DEFAULT_PLACE, 'a view nobody has is the feed');
assert.deepEqual(readBoardPlace(params('view=streams')).view, 'streams');
assert.equal(readBoardPlace(params(`tags=${Array.from({ length: 40 }, (_u, i) => `t${i}`).join(',')}`)).tags.length, 20, 'tags capped');

const written = params('sort=top&t=week&arcade=1');
writeBoardPlace(written, { view: 'gallery', tags: ['user:lore'], match: 'any' });
assert.equal(written.get('view'), 'gallery');
assert.equal(written.get('tags'), 'user:lore');
assert.equal(written.get('match'), null, 'ANY is the default and is not written');
assert.equal(written.get('sort'), 'top', 'the sort is left as it was');
assert.equal(written.get('arcade'), '1', 'and so is every other window');
writeBoardPlace(written, DEFAULT_PLACE);
assert.equal(written.get('view'), null, 'FEED is not written');
assert.equal(written.get('tags'), null, 'no tags, no param');
assert.deepEqual(readBoardPlace(written), null, 'back to a plain board');

assert.equal(parseStoredPlace(null), null);
assert.equal(parseStoredPlace('not json'), null);
assert.equal(parseStoredPlace('{"view":"elsewhere"}'), null, 'a stored place with no real view is no place');
assert.deepEqual(parseStoredPlace(JSON.stringify({ view: 'streams', tags: ['a', 7, 'a', ''], match: 'all' })), {
  view: 'streams',
  tags: ['a'],
  match: 'all',
});

/* Threads -------------------------------------------------------------------------------------- */
const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const at = (minutes) => new Date(NOW - minutes * 60000).toISOString();
const reply = (threadId, id, minutes, authorId = 'someone') => ({
  id,
  threadId,
  body: `reply ${id}`,
  author: { id: authorId, displayName: authorId.toUpperCase() },
  createdAt: at(minutes),
  tags: [],
});
const post = (id, minutes, extra = {}) => ({
  id,
  title: `Post ${id}`,
  body: `Words of ${id}`,
  author: { id: `author-${id}`, displayName: `AUTHOR ${id}` },
  createdAt: at(minutes),
  anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' },
  tags: [],
  comments: [],
  origin: 'user',
  ...extra,
});
const record = (id, minutes, comments = []) =>
  post(id, minutes, { title: `STREAM :: HOST :: 2026-11-17`, body: '', anchor: { kind: 'board', id: `watch:room-${id}`, label: 'STREAM' }, comments });

/* 4A: BOARD THREADS ---------------------------------------------------------------------------- */
const board = [post('a', 10), record('s1', 5), record('s2', 6, [reply('s2', 'r1', 1)])];
const query = (sourceFilter) => ({ query: '', sourceFilter, tagKeys: [], tagMatchMode: 'any', sortMode: 'new' });
assert.deepEqual(selectBoardThreads(board, query('all')).map((t) => t.id).sort(), ['a', 's2']);
assert.deepEqual(
  selectBoardThreads(board, query('board')).map((t) => t.id).sort(),
  ['a', 's2'],
  'BOARD THREADS shows no more than ALL: the unanswered record waits under STREAMS (4A)',
);
assert.deepEqual(selectBoardThreads(board, query('stream')).map((t) => t.id).sort(), ['s1', 's2']);

/* 11A: the empty line --------------------------------------------------------------------------- */
const empty = (patch) => emptyBoardLine({ view: 'feed', tagLabels: [], match: 'any', sourceLabel: null, musicOnly: false, musicTagCount: 0, ...patch });
assert.deepEqual(empty({ tagLabels: ['LORE'] }), { line: 'NOTHING TAGGED LORE.', clears: ['tags'] });
assert.deepEqual(empty({ view: 'gallery', tagLabels: ['LORE', 'ART'], match: 'all' }), {
  line: 'NO PICTURES TAGGED LORE AND ART.',
  clears: ['tags', 'feed'],
});
assert.deepEqual(empty({ view: 'gallery', sourceLabel: 'PROFILE COMMENTS' }), {
  line: 'NO PICTURES IN PROFILE COMMENTS.',
  clears: ['source', 'feed'],
});
assert.deepEqual(empty({ musicOnly: true }), { line: 'NOTHING WITH MUSIC.', clears: ['music'] });
assert.deepEqual(empty({ view: 'gallery' }), { line: 'NO PICTURES ON THE BOARD YET.', clears: ['feed'] });
assert.deepEqual(empty({ view: 'streams', tagLabels: ['LORE'] }), { line: 'NO STREAMS ON RECORD.', clears: [] }, 'tags are set aside on STREAMS (12A)');

/* 9B: the NEW count ----------------------------------------------------------------------------- */
const me = 'reader-1';
const threads = [
  post('new-unread', 30),
  post('old-unread', 60 * 24 * 10),
  post('mine', 20, { author: { id: me, displayName: 'ME' } }),
  post('read-quiet', 100, { comments: [reply('read-quiet', 'q1', 90)] }),
  post('read-new-reply', 100, { comments: [reply('read-new-reply', 'n1', 5)] }),
  post('read-my-reply', 100, { comments: [reply('read-my-reply', 'm1', 5, me)] }),
  record('unanswered-record', 3),
];
const marks = { 'read-quiet': at(50), 'read-new-reply': at(50), 'read-my-reply': at(50) };
assert.equal(countNewPosts(threads, {}, me, NOW), 0, 'a reader with nothing read gets no count');
assert.equal(
  countNewPosts(threads, marks, me, NOW),
  2,
  'an unopened post this week, and an opened one with a reply since; not old, not mine, not my reply, not a hidden record',
);
assert.equal(newLabel(0), '');
assert.equal(newLabel(3), '3 NEW');
assert.equal(newLabel(12), '9+ NEW');

/* 8A: the wire ---------------------------------------------------------------------------------- */
const wireThreads = [post('p1', 50, { comments: [reply('p1', 'c1', 2)] }), post('p2', 10), record('rec', 1)];
const pins = [{ threadId: 'p1', pinnedById: null, pinnedByName: 'MOD', pinnedAt: at(40), expiresAt: null }];
assert.deepEqual(buildNewsFeed(wireThreads, 14, { pins, at: new Date(NOW) }).map((r) => r.id), ['news-post-p1'], 'no `newest`: the pins alone');
const wire = buildNewsFeed(wireThreads, 64, { pins, at: new Date(NOW), newest: 12 });
assert.deepEqual(
  wire.map((r) => r.id),
  ['news-post-p1', 'news-reply-c1', 'news-post-p2'],
  'pinned first, then newest first; the pinned post is not said twice; no unanswered stream record',
);
assert.equal(wire[1].href, '/forum#comment-c1', "a reply's row opens the reply itself");
assert.equal(wire[1].tag, 'REPLY');
assert.equal(buildNewsFeed(wireThreads, 64, { at: new Date(NOW), newest: 1 }).length, 1, 'newest is a cap');

/* 3A: a record's facts -------------------------------------------------------------------------- */
assert.equal(streamLength(30), 'UNDER A MINUTE');
assert.equal(streamLength(40 * 60), '40 MIN');
assert.equal(streamLength(65 * 60), '1 H 5 MIN');
assert.equal(streamLength(120 * 60), '2 H');
const entry = (id, playIndex) => ({ id, roomId: 'r', position: 0, inQueue: false, mediaItemId: 'm', link: null, series: null, addedBy: null, addedAt: at(60), playedAt: null, playIndex });
const room = (patch) => ({
  id: 'r', originalHostId: 'h', originalHostLabel: 'HOST', hostId: 'h', forumThreadId: null, currentEntryId: null, positionSeconds: 0,
  isPlaying: false, startedAt: at(60), updatedAt: at(20), endedAt: at(20), origin: 'stream', isPublic: true, privacy: 'open',
  clearedAt: null, name: null, ...patch,
});
const ended = streamFacts({ room: room({}), queue: [entry('a', 0), entry('b', 1), entry('c', 2), entry('d', null)], messages: [], crowns: [] }, NOW);
assert.deepEqual(ended, { videos: '3 VIDEOS', length: '40 MIN', live: false }, 'played entries only; ended at its end');
const one = streamFacts({ room: room({}), queue: [entry('a', 0)], messages: [], crowns: [] }, NOW);
assert.equal(one.videos, '1 VIDEO');
assert.equal(streamFacts({ room: room({}), queue: [], messages: [], crowns: [] }, NOW).videos, 'NOTHING PLAYED');
const live = streamFacts({ room: room({ endedAt: null, updatedAt: at(0) }), queue: [entry('a', 0)], messages: [], crowns: [] }, NOW);
assert.equal(live.live, true, 'a stream still beating is live');
assert.equal(live.length, '1 H', 'and runs until now');

/* The board says what it promises ---------------------------------------------------------------- */
const boardSource = fs.readFileSync('app/components/ForumBoard.tsx', 'utf8');
assert.doesNotMatch(boardSource, /value: 'stream', label: 'STREAMS'/, 'STREAMS is a tab, not a source any more (1A)');
assert.match(boardSource, /data-undo-picks="VIEW"/, 'the tabs are a step the undo arrows can take (2A)');
assert.match(boardSource, /window\.history\.pushState/, 'a reader\'s own change is a step Back can take (2A)');

console.log('forum v2: tabs and address, BOARD THREADS, empty lines, NEW count, the wire, stream facts - all pass');
