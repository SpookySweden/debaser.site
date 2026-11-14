/*
 * Character speech: who may say what, the random pick, and the cut into bubbles (SPEC-character-speech.md).
 *   npx tsc app/lib/speech/script.ts --outDir Temp/speech-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-character-speech.cjs
 *
 * Luke, 2026-11-14: "have any comments made on the profile by that person, or comments in reply to that person by spoken
 * as pixelated urr urr urr undertale looking text", and of replies: "any general replies theyve made to anything that
 * user said or posted, clicking the bubble goes to the post", "random selection of all", "Two-line pages".
 *
 * Offline, and it holds the rule the whole feature stands on: **a character only says what its own person wrote**, out
 * of what the page was handed (which is already what this reader may read). Then: what counts as a reply to the owner,
 * where a pressed bubble leads, that no line repeats before the others have had a turn, and that the pages lose no words.
 * What it cannot hold is the bubble on screen: `scripts/drive-character-speech.cjs`.
 */
const assert = require('node:assert/strict');
const speech = require('./speech-out/speech/script.js');

const owner = { id: 'u-owner', name: 'sweden' };
const amy = { id: 'u-amy', name: 'amy' };
const bo = { id: 'u-bo', name: 'Good morning' };
const author = (person) => ({ id: person.id, displayName: person.name });

const remark = (id, person, body, kind = 'profile', createdAt = '2026-11-01T10:00:00.000Z') => ({ id, kind, author: author(person), body, createdAt });
const reply = (id, threadId, person, body, parentId) => ({ id, threadId, author: author(person), body, createdAt: '2026-11-02T10:00:00.000Z', tags: [], ...(parentId ? { parentId } : {}) });
const thread = (id, person, comments, extra = {}) => ({
  id,
  title: `TITLE ${id}`,
  body: 'a post with words',
  author: author(person),
  createdAt: '2026-11-01T09:00:00.000Z',
  anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' },
  tags: [],
  origin: 'user',
  comments,
  ...extra,
});

const comments = [
  remark('c1', amy, 'love   this\npage'),
  remark('c2', amy, 'nice picture', 'avatar'),
  remark('c3', owner, 'thanks all'),
  remark('c4', bo, 'hello from bo'),
  remark('c5', amy, 'hi @sweden from your own page'),
];

const threads = [
  // The owner's post: amy answers it, bo answers amy (not the owner), the owner answers amy.
  thread('t-owner', owner, [
    reply('r1', 't-owner', amy, 'great post'),
    reply('r2', 't-owner', bo, 'agreed amy', 'r1'),
    reply('r3', 't-owner', owner, 'cheers amy', 'r1'),
    reply('r10', 't-owner', bo, 'bo answering the owner'),
  ]),
  // Somebody else's post: the owner replies, amy answers the owner's reply, and amy says something to nobody in particular.
  thread('t-bo', bo, [
    reply('r4', 't-bo', owner, 'owner was here'),
    reply('r5', 't-bo', amy, 'answering the owner', 'r4'),
    reply('r6', 't-bo', amy, 'talking to bo'),
    reply('r7', 't-bo', amy, 'hey @sweden look at this'),
  ]),
  // A post of amy's that names the owner, and one that does not.
  thread('t-amy-names', amy, [], { body: 'has @Sweden seen page 12' }),
  thread('t-amy-plain', amy, []),
  // An item's own thread the owner happened to open: a remark there is about the item, not an answer to the owner.
  thread('t-item', owner, [reply('r8', 't-item', amy, 'about the item')], { body: '', anchor: { kind: 'web', id: 'w1', label: 'A FILM' } }),
  // The profile's own comments as the board holds them: the same words must not be said twice.
  thread('profile:u-owner', { id: null, name: 'debaser.site' }, [reply('profile-comment:c1', 'profile:u-owner', amy, 'love   this\npage'), reply('profile-comment:c5', 'profile:u-owner', amy, 'hi @sweden from your own page')], { body: '' }),
  // A private record: never read out.
  thread('t-private', owner, [reply('r9', 't-private', amy, 'in private')], { title: '', privateRecord: { messages: 2 } }),
];

const material = (speakerId, present = [owner, amy, bo]) => ({ owner, speakerId, present, comments, threads });
const ids = (lines) => lines.map((line) => line.id).sort();

// 1. A visitor's character: their comments here, and their replies to the owner anywhere on the board.
const amyLines = speech.linesFor(material(amy.id));
assert.deepEqual(
  ids(amyLines),
  ['post:t-amy-names', 'profile-comment:c1', 'profile-comment:c2', 'profile-comment:c5', 'r1', 'r5', 'r7'].sort(),
  'a comment on the profile, on the picture, a reply under the owner\'s post, a reply to the owner\'s reply, a reply and a post that name the owner: and nothing else',
);
assert.ok(amyLines.every((line) => line.speakerId === amy.id), 'every line is its own person\'s');
const byId = (lines, id) => lines.find((line) => line.id === id);
assert.equal(byId(amyLines, 'profile-comment:c1').text, 'love this page', 'the words as written, on one line');
assert.deepEqual(byId(amyLines, 'profile-comment:c1').target, { kind: 'here', commentId: 'c1' }, 'a comment on the profile itself opens here');
assert.deepEqual(byId(amyLines, 'profile-comment:c2').target, { kind: 'board', href: '/forum#comment-profile-comment:c2' }, 'a remark on the picture leads to it on the board');
assert.deepEqual(byId(amyLines, 'r5').target, { kind: 'board', href: '/forum#comment-r5' }, 'a reply leads to that exact reply');
assert.deepEqual(byId(amyLines, 'post:t-amy-names').target, { kind: 'board', href: '/forum#thread-t-amy-names' }, 'a post leads to that post');
assert.equal(amyLines.filter((line) => line.text === 'love this page').length, 1, 'the same comment is not said twice for being on the board as well');
assert.equal(amyLines.filter((line) => line.text === 'hi @sweden from your own page').length, 1, 'even when it names the owner, which the board would count as a reply');
assert.equal(byId(amyLines, 'r10'), undefined, "somebody else's reply to the owner is never put in this character's mouth");
assert.equal(byId(amyLines, 'r6'), undefined, 'a reply to somebody else is not a reply to the owner');
assert.equal(byId(amyLines, 'r8'), undefined, "nor is a remark on an item's own thread");
assert.equal(byId(amyLines, 'r9'), undefined, 'and a private record is never read out');

// 2. The owner's character: their own remarks here, and their replies to the people in the room.
assert.deepEqual(ids(speech.linesFor(material(owner.id))), ['profile-comment:c3', 'r3', 'r4'].sort(), 'the owner answers amy (r3) and posts under bo\'s post (r4)');
assert.deepEqual(ids(speech.linesFor(material(owner.id, [owner, amy]))), ['profile-comment:c3', 'r3'].sort(), 'with bo not in the room, the reply to bo is not said');
assert.deepEqual(ids(speech.linesFor(material(owner.id, [owner]))), ['profile-comment:c3'], 'alone, only their own remarks');

// 3. What the page was not handed is never said: a kind the owner switched off simply is not in `comments`.
const hidden = speech.linesFor({ ...material(amy.id), comments: comments.filter((comment) => comment.kind !== 'profile') });
assert.equal(byId(hidden, 'profile-comment:c1'), undefined, 'a comment this reader may not see is not spoken');
assert.deepEqual(speech.linesFor({ ...material('u-nobody') }), [], 'somebody who wrote nothing says nothing');

// 4. Who may come to visit.
assert.deepEqual(
  speech.guestCandidates(
    [remark('a', amy, 'x', 'profile', '2026-11-01T10:00:00.000Z'), remark('b', bo, 'y', 'profile', '2026-11-03T10:00:00.000Z'), remark('c', amy, 'z', 'profile', '2026-11-02T10:00:00.000Z'), remark('d', owner, 'me'), remark('e', { id: null, name: 'guest' }, 'anon')],
    owner.id,
    null,
    6,
  ),
  [bo, amy],
  'whoever commented, most recent first, each once, never the owner, never somebody with no account',
);
assert.deepEqual(speech.guestCandidates(comments, owner.id, amy.id, 6), [bo], 'and never the reader: their own companion is the one that visits');
assert.equal(speech.guestCandidates(comments, owner.id, null, 1).length, 1, 'no more than asked for');

// 5. The random pick: everything gets a turn before anything is said again.
const lines = amyLines;
let dice = 0;
const random = () => {
  dice = (dice * 9301 + 49297) % 233280;
  return dice / 233280;
};
let said = [];
const order = [];
for (let turn = 0; turn < lines.length * 3; turn += 1) {
  const picked = speech.nextLine(lines, said, random);
  said = picked.said;
  order.push(picked.line.id);
}
for (let round = 0; round < 3; round += 1) {
  const part = order.slice(round * lines.length, (round + 1) * lines.length);
  assert.equal(new Set(part).size, lines.length, `round ${round + 1}: every line once before any is said again`);
}
for (let at = 1; at < order.length; at += 1) assert.notEqual(order[at], order[at - 1], 'and never the same line twice running');
assert.equal(speech.nextLine([], [], random), null, 'nothing to say is nothing');
assert.equal(speech.nextLine([lines[0]], [lines[0].id], random).line.id, lines[0].id, 'one line is all there is to say');
assert.notDeepEqual(order.slice(0, lines.length), ids(lines), 'the order is the dice\'s, not the list\'s');

// 6. The cut into bubbles: two lines a page, no line too long, and not a word lost.
const LONG = 'the drawing is the one for me and I would say so again, though a supercalifragilisticexpialidocious-word turns up now and then!';
const pages = speech.pagesOf(LONG);
assert.ok(pages.length > 1, 'a long comment takes more than one page');
assert.ok(pages.every((page) => page.length >= 1 && page.length <= speech.BUBBLE_LINES), 'never more than two lines a page');
assert.ok(pages.flat().every((line) => line.length <= speech.BUBBLE_LINE && line.length > 0), 'never a line longer than the bubble');
assert.equal(pages.flat().join(' ').replace(/ /g, ''), LONG.replace(/ /g, ''), 'and every letter of it is there, in order');
assert.deepEqual(speech.pagesOf('short one'), [['short one']], 'a short line is one page of one line');
assert.deepEqual(speech.pagesOf('   '), [], 'no words, no pages');
assert.deepEqual(speech.pagesOf('aa bb cc dd', 5, 1), [['aa bb'], ['cc dd']], 'broken between words');

// 7. The pace.
assert.ok(speech.pausesAfter('.') && speech.pausesAfter(',') && speech.pausesAfter('!') && speech.pausesAfter('?'), 'a stop after punctuation');
assert.ok(!speech.pausesAfter('a') && !speech.pausesAfter(' '), 'and none after a letter');
for (const roll of [0, 0.5, 0.999]) {
  const wait = speech.waitWithin(speech.SPEECH_PACE.gapMs, () => roll);
  assert.ok(wait >= speech.SPEECH_PACE.gapMs[0] && wait <= speech.SPEECH_PACE.gapMs[1], 'the gap between bubbles stays in its range');
}
assert.ok(speech.SPEECH_PACE.gapMs[0] >= 5000, 'never chattering: at least a few seconds between bubbles');

console.log('check-character-speech: ok');
