/*
 * Character speech: who may say what, the random pick, and the cut into bubbles (SPEC-character-speech.md).
 *   npx tsc app/lib/speech/script.ts app/lib/speech/voice.ts app/lib/companion/events.ts --outDir Temp/speech-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
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
const voices = require('./speech-out/speech/voice.js');
const events = require('./speech-out/companion/events.js');

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

// 8. The voice (phase 2; Luke: "Make our own blip voice", "A: From the character"): worked out, never chosen.
const tall = voices.voiceFor('u-amy', 30);
const small = voices.voiceFor('u-amy', 10);
assert.deepEqual(voices.voiceFor('u-amy', 30), tall, 'the same character always has the same voice');
assert.ok(tall.hz < small.hz, `a taller character is deeper (${tall.hz} Hz against ${small.hz} Hz)`);
assert.ok(tall.hz >= 150 && small.hz <= 600, 'and every voice stays where a small speaker can sound it');
const others = ['u-bo', 'u-owner', 'u-cy', 'u-dee', 'u-eve'].map((id) => voices.voiceFor(id, 30));
assert.ok(others.some((voice) => voice.hz !== tall.hz || voice.wave !== tall.wave || voice.blipMs !== tall.blipMs), 'two characters of one height are not one voice');
assert.ok(new Set([tall, ...others].map((voice) => `${voice.wave}:${voice.hz}:${voice.blipMs}:${voice.wobble}`)).size >= 4, 'the accounts spread out');
for (const voice of [tall, small, ...others]) {
  assert.ok(voice.wave === 'square' || voice.wave === 'triangle');
  assert.ok(voice.blipMs >= 40 && voice.blipMs <= 60, 'a blip is 40 to 60 ms');
  assert.ok(voice.wobble > 0 && voice.wobble <= 0.1, 'with a little wobble, never a siren');
}
const plain = voices.voiceFor('u-amy', null);
assert.ok(plain.hz > tall.hz && plain.hz < voices.voiceFor('u-amy', 8).hz, 'a figure with no character of its own has a plain middle voice');
for (const letter of ['a', 'Z', '7', 'é']) assert.ok(voices.speaks(letter), `"${letter}" makes a sound`);
for (const letter of [' ', '.', ',', '!', '?', '-', '@', '"']) assert.ok(!voices.speaks(letter), `"${letter}" is silent`);
for (const roll of [0, 0.5, 0.999]) {
  const consonant = voices.blipHz(tall, 'k', () => roll);
  assert.ok(Math.abs(consonant - tall.hz) <= tall.hz * tall.wobble + 0.001, 'a letter strays no further than the wobble');
  assert.ok(voices.blipHz(tall, 'a', () => roll) > consonant, 'and a vowel sits a little higher');
}
assert.equal(voices.blipGain(0), 0, 'the music bar turned right down is silence');
assert.ok(voices.blipGain(1) > 0 && voices.blipGain(1) <= 0.15, 'at full volume a blip is still well under the music');
assert.equal(voices.blipGain(7), voices.blipGain(1), 'and a wild number is not a loud one');
assert.equal(voices.blipGain(Number.NaN), 0);

// 9. A stream room's chat (phase 3; Luke: "Both at once"): the words of a line reach whoever is listening for that
//    person's companion, only while the line is fresh, and an older caller that hands over no words still works.
const heardChat = [];
const stopChat = events.onCompanionSpoke((who, words) => heardChat.push([who, words]));
events.companionSpoke('u-amy', new Date().toISOString(), 'hello room');
events.companionSpoke('u-bo', new Date().toISOString());
events.companionSpoke('u-amy', new Date(Date.now() - 60000).toISOString(), 'an old line read back in');
events.companionSpoke('u-amy', 'not a time', 'no time at all');
stopChat();
events.companionSpoke('u-amy', new Date().toISOString(), 'nobody is listening now');
assert.deepEqual(heardChat, [['u-amy', 'hello room'], ['u-bo', undefined]], 'a fresh line is heard with its words; a stale one is nobody speaking');

console.log('check-character-speech: ok');
