/*
 * Characters who are friends: they find each other and hang out (app/lib/character/friends.ts).
 *   npx tsc app/lib/character/friends.ts app/lib/character/walker.ts app/lib/companion/brain.ts app/lib/companion/wire.ts --outDir Temp/friends-check --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-character-friends.cjs
 *
 * Luke, 2026-11-21: "make it so that moldavius figtree and swedens characters like eachother and hang out with eachother
 * in a jovial manner". Holds, in Node: the pair is friends (and nobody else), two friends in a profile's ROOM end up
 * standing together far more than two strangers do and face each other there, they never cross over on the way, the
 * companion's brain heads for a friend on a stream room's strip and stays with it, what friends say is noise and never
 * words of a person's, and the room hears the friendly cheer as a kind older tabs read as a hop. Then the wiring.
 * What it cannot hold is the look on screen: a local mock dev server drive (scripts/drive-character-friends.cjs).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const friends = require('./friends-check/character/friends.js');
const walker = require('./friends-check/character/walker.js');
const brain = require('./friends-check/companion/brain.js');
const wire = require('./friends-check/companion/wire.js');

const SWEDEN = '85e2a97c-7963-4b43-981b-370ca3e457d3';
const MOLDAVIUS = 'a887588b-1dd2-4be3-9c9f-9897ec492c31';

/** Steady dice, so a run is the same every time. */
function dice(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// --- who is friends -------------------------------------------------------------------------------------------------
assert.equal(friends.areFriends(SWEDEN, MOLDAVIUS), true, 'sweden and moldavius figtree are friends');
assert.equal(friends.areFriends(MOLDAVIUS, SWEDEN), true, 'both ways round');
assert.equal(friends.areFriends(SWEDEN, SWEDEN), false, 'nobody is their own friend');
assert.equal(friends.areFriends(SWEDEN, 'someone-else'), false, 'a stranger is not');
assert.equal(friends.areFriends(null, MOLDAVIUS), false, 'nobody signed in is nobody');
assert.equal(friends.friendIn(SWEDEN, ['a', MOLDAVIUS, 'b']), MOLDAVIUS);
assert.equal(friends.friendIn('a', ['b', MOLDAVIUS]), null);
assert.equal(friends.areFriends('x', 'y', [['x', 'y']]), true, 'a pair added later works the same');

// --- meeting halfway, never crossing ---------------------------------------------------------------------------------
{
  const w = 60;
  let a = 0;
  let b = 500;
  for (let round = 0; round < 8; round += 1) {
    const nextA = friends.meetingSpot(a, b, w);
    const nextB = friends.meetingSpot(b, a, w);
    a = nextA;
    b = nextB;
    assert.ok(a < b, `round ${round}: they never cross over (${a} < ${b})`);
  }
  assert.ok(friends.nearFriend(a, b, w), `they end up together (${a}, ${b})`);
  assert.ok(b - a >= w, `side by side, not on top of each other (${b - a} >= ${w})`);
}

// --- befriend: the ROOM walker's choices ------------------------------------------------------------------------------
{
  const base = { activity: 'idle', motion: 'idle', tick: 5, left: 20, x: 0, target: 0, dir: 1, nextReaction: 0 };
  const fresh = { ...base, tick: 0, x: 0 };
  const always = () => 0;
  const never = () => 0.999;
  assert.equal(friends.befriend(base, fresh, { friendX: null, w: 60, room: 600, random: always }), fresh, 'no friend: untouched');
  const headed = friends.befriend(base, fresh, { friendX: 500, w: 60, room: 600, random: always });
  assert.equal(headed.activity, 'walk', 'a fresh choice apart heads for the friend');
  assert.equal(headed.target, friends.meetingSpot(0, 500, 60));
  assert.equal(headed.dir, 1, 'facing the way it goes');
  const midWalk = { ...base, activity: 'walk', motion: 'walk', tick: 7, target: 300 };
  assert.equal(friends.befriend(midWalk, { ...midWalk, tick: 8, x: 2 }, { friendX: 500, w: 60, room: 600, random: always }).target, 300, 'a walk under way toward the friend is left alone');
  const awayWalk = { ...base, activity: 'walk', motion: 'walk', tick: 7, x: 300, target: 0, dir: -1 };
  const turned = friends.befriend(awayWalk, { ...awayWalk, tick: 8, x: 298 }, { friendX: 500, w: 60, room: 600, random: always });
  assert.equal(turned.target, friends.meetingSpot(298, 500, 60), 'a walk away from the friend turns round, now and then');
  assert.equal(turned.dir, 1);
  assert.equal(friends.befriend(awayWalk, { ...awayWalk, tick: 8, x: 298 }, { friendX: 500, w: 60, room: 600, random: never }).target, 0, 'but not every tick');
  const dance = { ...fresh, activity: 'dance', motion: 'dance1' };
  assert.equal(friends.befriend(base, dance, { friendX: 500, w: 60, room: 600, random: always }), dance, 'a dance is left alone');
  const near = { ...base, x: 200, tick: 6, dir: -1 };
  const faced = friends.befriend(base, near, { friendX: 270, w: 60, room: 600, random: never });
  assert.equal(faced.dir, 1, 'together, it faces its friend');
  const fun = friends.befriend(base, near, { friendX: 270, w: 60, room: 600, random: always });
  assert.equal(fun.activity, 'react', 'together, now and then something cheerful');
  assert.ok(friends.FRIEND_ACTS.includes(fun.motion), `a wave, hop or cheer (${fun.motion})`);
  assert.equal(fun.nextReaction, near.nextReaction, 'without using up the clicks\' turn');
}

// --- two walkers in one ROOM: friends end up together, strangers do not -------------------------------------------------
function roomRun(befriended, seed) {
  const random = dice(seed);
  const w = 60;
  const width = 900;
  const room = width - w;
  const ticksOf = () => 12;
  let a = { ...walker.startWalker(room, random), x: 20 };
  let b = { ...walker.startWalker(room, random), x: 800 };
  let together = 0;
  let standing = 0;
  let facing = 0;
  let crossed = 0;
  const ticks = 6000;
  for (let t = 0; t < ticks; t += 1) {
    const input = { mood: 'calm', music: false, room, step: 2, ticksOf, random };
    const nextA = walker.stepWalker(a, input);
    const nextB = walker.stepWalker(b, input);
    const wasLeft = a.x < b.x;
    a = befriended ? friends.befriend(a, nextA, { friendX: b.x, w, room, random }) : nextA;
    b = befriended ? friends.befriend(b, nextB, { friendX: a.x, w, room, random }) : nextB;
    if (t < 1000) continue;
    if (friends.nearFriend(a.x, b.x, w)) {
      together += 1;
      if (a.activity === 'idle' && b.activity === 'idle') {
        standing += 1;
        if (a.dir === (b.x >= a.x ? 1 : -1) && b.dir === (a.x >= b.x ? 1 : -1)) facing += 1;
      }
    }
    if (wasLeft !== a.x < b.x) crossed += 1;
  }
  return { together: together / (ticks - 1000), facing: standing === 0 ? 0 : facing / standing, crossed };
}
{
  const pals = roomRun(true, 7);
  const strangers = roomRun(false, 7);
  assert.ok(pals.together > 0.6, `friends spend most of their time together (${pals.together.toFixed(2)})`);
  assert.ok(strangers.together < 0.35, `strangers mostly do not (${strangers.together.toFixed(2)})`);
  assert.ok(pals.together > strangers.together * 2, 'far more than strangers');
  assert.ok(pals.facing > 0.9, `standing about together, they face each other (${pals.facing.toFixed(2)})`);
  console.log(`  room: friends together ${(pals.together * 100).toFixed(0)}% (strangers ${(strangers.together * 100).toFixed(0)}%), facing ${(pals.facing * 100).toFixed(0)}% of that, crossed over ${pals.crossed}x`);
}

// --- the companion's brain on a stream room's strip ------------------------------------------------------------------
{
  const now = 100_000;
  const state = { ...brain.startBrain(0), until: 0 };
  const input = { now, lastActivity: now, musicPlaying: false, pointerX: null, x: 100, span: { left: 0, right: 1200 }, random: () => 0.1 };
  const apart = brain.think(state, { ...input, friend: { spot: 700, near: false } });
  assert.equal(apart.mood, 'walk', 'apart: it walks over');
  assert.equal(apart.target, 700, 'to the spot beside its friend');
  const together = brain.think(state, { ...input, friend: { spot: 110, near: true } });
  assert.ok(together.mood === 'stand' || together.mood === 'sit', `together: it stays to hang out (${together.mood})`);
  const alone = brain.think(state, { ...input, friend: null });
  assert.notEqual(alone.target, 700, 'no friend: its own wander');
  const music = brain.think(state, { ...input, musicPlaying: true, friend: { spot: 700, near: false } });
  assert.equal(music.mood, 'dance', 'the music still wins: it dances where it is');
  const chase = brain.think(state, { ...input, pointerX: 300, friend: { spot: 700, near: false } });
  assert.equal(chase.mood, 'chase', 'the pointer still wins');
}

// --- what friends say: noises, never words ---------------------------------------------------------------------------
{
  const a = friends.friendLines(SWEDEN);
  const b = friends.friendLines(MOLDAVIUS);
  assert.equal(a.length, friends.NOISES_EACH);
  for (const line of [...a, ...b]) {
    assert.ok(friends.FRIEND_NOISES.includes(line.text), `only the cheerful noises (${line.text})`);
    assert.equal(line.target.kind, 'none', 'a cheerful noise leads nowhere when pressed');
    assert.equal(friends.wantsAnswer(line), true, 'a cheerful line is answered');
  }
  assert.deepEqual(friends.friendLines(SWEDEN), a, 'the same character always has the same noises');
  assert.notDeepEqual(a.map((l) => l.text), b.map((l) => l.text), 'each friend sounds like itself');
  assert.equal(new Set(a.map((l) => l.id)).size, a.length, 'ids unique among one speaker\'s lines');
  const answer = friends.friendAnswer(MOLDAVIUS, () => 0.5);
  assert.equal(answer.speakerId, MOLDAVIUS);
  assert.ok(b.some((l) => l.text === answer.text), 'an answer is one of its own noises');
  assert.equal(friends.wantsAnswer(answer), false, 'an answer is not answered again (no endless back and forth)');
  for (const noise of friends.FRIEND_NOISES) assert.ok(!/[a-z]{6,}/i.test(noise.replace(/(he|ha|la|hoo|o)+/gi, '')), `no real words: ${noise}`);
}

// --- the room hears it ------------------------------------------------------------------------------------------------
assert.ok(wire.COMPANION_REACTIONS.includes('friend'), 'a friendly cheer is a reaction the room hears');
assert.equal(wire.reactionMark('friend'), '♪', 'with a note over its head');
assert.equal(wire.reactionMotion('friend'), 'cheer', 'played as a cheer');
assert.equal(wire.reactionIsLocal('friend'), false, 'and sent, so everyone in the room sees it');

// --- the wiring -------------------------------------------------------------------------------------------------------
{
  const root = path.join(__dirname, '..');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const room = read('app/components/ProfileRoom.tsx');
  assert.equal((room.match(/friendId=\{/g) ?? []).length, 3, 'the owner, every guest and your visiting companion are told their friend');
  assert.equal((room.match(/spots=\{spots\}/g) ?? []).length, 3, 'and share where each stands');
  assert.ok(room.includes('friendLines(person.id)'), 'friends get their cheerful lines in the ROOM');
  assert.ok(room.includes('wantsAnswer(said.line)'), 'and answer each other');
  const walkerFile = read('app/components/ProfileCharacter.tsx');
  assert.ok(walkerFile.includes('befriend(current, next,'), 'the ROOM walker asks befriend every tick');
  const companion = read('app/components/Companion.tsx');
  assert.ok(companion.includes('areFriends(userId, companion.userId)'), 'your companion is told where a friend\'s companion is');
  assert.ok(companion.includes("react('friend')"), 'and cheers at them');
  assert.ok(/brain\.pose === null && \(brain\.mood === 'stand' \|\| brain\.mood === 'sit'\) && now >= nextCheer/.test(companion), 'only while just hanging out, never breaking off typing, a game, a book or a video');
  assert.ok(/friend,\n\s*\}\);/.test(companion.replace(/\r/g, '')), 'the brain hears about the friend');
}

console.log('check-character-friends: OK');
