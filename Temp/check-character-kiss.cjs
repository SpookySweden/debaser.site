/*
 * Friends kiss now and then, with hearts (app/lib/character/friends.ts).
 *   npx tsc app/lib/character/friends.ts app/lib/character/walker.ts app/lib/companion/wire.ts --outDir Temp/kiss-check --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-character-kiss.cjs
 *
 * Luke, 2026-11-22: "Make it so that moldsvius figtree and Sweden's characters kiss sometimes with hearts and cutely."
 * Holds, in Node: when a kiss comes is worked out from the pair and the clock, so two browsers looking at different
 * moments land on the same kiss with nothing sent; never before the two have stood together a while, never while apart,
 * and rare (a first soon after they meet, then minutes apart); the kiss steps in, leans and ends in that order; two ROOM
 * walkers step in until their boxes overlap, face each other and never cross; the lean is a shear that tips the top
 * toward the friend and keeps the feet put; the left one hops and the right one cheers after; the room hears the kiss as
 * a kind older tabs read as a hop, with a heart where nothing moves. Then the wiring: the ROOM, the strip, the hearts as
 * text, and reduced motion. What it cannot hold is the look on screen: scripts/drive-character-kiss.cjs (local mock server).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const friends = require('./kiss-check/character/friends.js');
const walker = require('./kiss-check/character/walker.js');
const wire = require('./kiss-check/companion/wire.js');

const SWEDEN = '85e2a97c-7963-4b43-981b-370ca3e457d3';
const MOLDAVIUS = 'a887588b-1dd2-4be3-9c9f-9897ec492c31';
const PAIR = friends.pairKeyOf(SWEDEN, MOLDAVIUS);
const START = Date.UTC(2026, 10, 22, 20, 0, 0);

// --- the pair and its moments ----------------------------------------------------------------------------------------
assert.equal(friends.pairKeyOf(MOLDAVIUS, SWEDEN), PAIR, 'the same key whichever of the two asks');
for (let slot = 0; slot < 200; slot += 1) {
  const s = Math.floor(START / friends.KISS_SLOT_MS) + slot;
  const moment = friends.kissMoment(PAIR, s);
  assert.ok(moment >= s * friends.KISS_SLOT_MS && moment < s * friends.KISS_SLOT_MS + friends.KISS_WINDOW_MS, 'each moment is early in its slot');
}

/** One browser's view: looks at the clock every `step` ms from `offset`, with the two together from `since` on. */
function kissesSeen({ step, offset, since, until, apart = () => false }) {
  const kisses = [];
  let from = START + offset;
  let together = null;
  let last = null;
  for (let now = START + offset + step; now <= until; now += step) {
    together = friends.togetherSince(together, now >= since && !apart(now), now);
    const due = friends.kissDue(PAIR, from, now, together, last);
    if (due !== null) {
      kisses.push(due);
      last = due;
    }
    from = now;
  }
  return kisses;
}

// --- two browsers, nothing sent: the same kisses ---------------------------------------------------------------------
{
  const until = START + 2 * 60 * 60 * 1000;
  const mine = kissesSeen({ step: 100, offset: 0, since: START + 5_000, until });
  const theirs = kissesSeen({ step: 100, offset: 37, since: START + 5_300, until });
  const room = kissesSeen({ step: 500, offset: 211, since: START + 5_000, until });
  assert.ok(mine.length > 0, 'two friends together for two hours kiss');
  assert.deepEqual(theirs, mine, 'the friend\'s browser, ticking at other moments, lands on the very same kisses');
  assert.deepEqual(room, mine, 'and so does a ROOM looking every half second');

  // Not before they have stood together a while, and the first soon after.
  assert.ok(mine[0] - (START + 5_000) >= friends.KISS_TOGETHER_MS, `not before ${friends.KISS_TOGETHER_MS / 1000} s together (${(mine[0] - START - 5_000) / 1000} s)`);
  assert.ok(mine[0] - (START + 5_000) <= friends.KISS_TOGETHER_MS + friends.KISS_SLOT_MS + friends.KISS_WINDOW_MS, `the first comes soon after (${(mine[0] - START - 5_000) / 1000} s)`);

  // Rare: never closer than the gap, and on average minutes apart.
  const gaps = mine.slice(1).map((at, index) => at - mine[index]);
  for (const gap of gaps) assert.ok(gap >= friends.KISS_GAP_MS, `kisses at least ${friends.KISS_GAP_MS / 1000} s apart (${gap / 1000} s)`);
  const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  assert.ok(average >= 120_000 && average <= 300_000, `on average every 2 to 5 minutes (${Math.round(average / 1000)} s over ${mine.length} kisses)`);
}

// --- apart, never ----------------------------------------------------------------------------------------------------
{
  const until = START + 60 * 60 * 1000;
  assert.deepEqual(kissesSeen({ step: 100, offset: 0, since: Infinity, until }), [], 'two friends who never stand together never kiss');
  // Together for only 15 seconds at a time: never long enough.
  const flicker = (now) => ((now - START) % 30_000) >= 15_000;
  assert.deepEqual(kissesSeen({ step: 100, offset: 0, since: START, until, apart: flicker }), [], 'together only in short spells: no kiss');
  assert.equal(friends.kissDue(PAIR, START, START + 10 * 60_000, null, null), null, 'not standing together: nothing due');
}

// --- a clock looked at again after a long gap lets the missed kisses go -------------------------------------------------
{
  const slot = Math.floor(START / friends.KISS_SLOT_MS) + 10;
  const moment = friends.kissMoment(PAIR, slot);
  const since = moment - 60_000;
  assert.equal(friends.kissDue(PAIR, moment - 100, moment + 50, since, null), moment, 'looked at on time, the kiss is due');
  assert.equal(friends.kissDue(PAIR, moment - 60_000, moment + 30_000, since, null), null, 'looked at half a minute late (away in a ROOM, a background tab): not played late');
}

// --- the kiss, in order ----------------------------------------------------------------------------------------------
{
  assert.deepEqual(friends.kissPhase(0), { stage: 'go' }, 'it starts by stepping in');
  assert.deepEqual(friends.kissPhase(friends.KISS_GO_MS - 1), { stage: 'go' });
  const leans = [];
  for (let at = friends.KISS_GO_MS; at < friends.KISS_MS; at += friends.KISS_TICK_MS) {
    const phase = friends.kissPhase(at);
    assert.equal(phase?.stage, 'lean', `leaning at ${at} ms`);
    leans.push(phase.lean);
  }
  assert.equal(friends.kissPhase(friends.KISS_MS), null, 'and then it is over');
  assert.equal(friends.kissPhase(-1), null);
  assert.ok(leans[0] < Math.max(...leans) && leans[leans.length - 1] < Math.max(...leans), 'it leans in, and back out');
  assert.ok(Math.max(...leans) <= 0.25, 'a lean, not a fall');
  assert.ok(friends.KISS_MS <= 5_000, 'the whole kiss is a moment');
}

// --- two ROOM walkers step in, face each other, never cross ----------------------------------------------------------
// ([0, 132] and [300, 168] start as far apart as still counts as together for a kiss; the last two stand on the very
// same spot: the smaller id, sweden's here as A, takes the left.)
for (const [startA, startB] of [[0, 90], [40, 140], [200, 110], [0, 132], [300, 168], [120, 120], [0, 0]]) {
  const w = 60;
  const room = 400;
  const step = walker.WALK_BLOCKS_PER_TICK * 2;
  let a = { ...walker.startWalker(room, () => 0.5), x: startA, dir: -1 };
  let b = { ...walker.startWalker(room, () => 0.5), x: startB, dir: 1 };
  const tieLeft = friends.tiesLeft(SWEDEN, MOLDAVIUS);
  assert.notEqual(tieLeft, friends.tiesLeft(MOLDAVIUS, SWEDEN), 'on a tie the two never both take the same side');
  const leftFirst = startA < startB || (startA === startB && tieLeft);
  for (let at = 0; at < friends.KISS_MS; at += friends.KISS_TICK_MS) {
    const phase = friends.kissPhase(at);
    const nextA = friends.kissWalk(a, phase, { friendX: b.x, w, room, step, tieLeft });
    const nextB = friends.kissWalk(b, phase, { friendX: a.x, w, room, step, tieLeft: !tieLeft });
    a = nextA;
    b = nextB;
    assert.equal(a.x < b.x, leftFirst, `${startA}/${startB} at ${at} ms: they never cross over`);
    if (phase.stage === 'lean') {
      assert.equal(a.dir, leftFirst ? 1 : -1, 'leaning, it faces its friend');
      assert.equal(b.dir, leftFirst ? -1 : 1, 'and so does its friend');
      assert.equal(a.motion, 'idle', 'standing still through the lean');
    }
  }
  const gap = Math.abs(b.x - a.x);
  assert.ok(gap <= Math.ceil(w * (1 - friends.KISS_OVERLAP)) + step && gap >= Math.floor(w * (1 - friends.KISS_OVERLAP)) - step,
    `${startA}/${startB}: close enough to kiss, boxes overlapping (${gap} px apart, ${w} wide)`);
}

// --- two friends on the very same spot step apart to hang out (found by the drive: they stood on top of each other) ----
{
  const w = 68;
  const room = 800;
  const standing = { ...walker.startWalker(room, () => 0.5), x: 108, activity: 'idle', motion: 'idle', tick: 3 };
  const tieLeft = friends.tiesLeft(SWEDEN, MOLDAVIUS);
  const a = friends.befriend(standing, standing, { friendX: 108, w, room, random: () => 0.99, tieLeft });
  const b = friends.befriend(standing, standing, { friendX: 108, w, room, random: () => 0.99, tieLeft: !tieLeft });
  assert.equal(a.activity, 'walk', 'one steps off the shared spot');
  assert.equal(b.activity, 'walk', 'and so does the other');
  assert.notEqual(Math.sign(a.target - 108), Math.sign(b.target - 108), `each to its own side (${a.target}, ${b.target})`);
  assert.equal(friends.meetingSpot(100, 100, w, true) < friends.meetingSpot(100, 100, w, false), true, 'the tie-break picks opposite sides');
}

// --- the lean: the top toward the friend, the feet put ---------------------------------------------------------------
for (const toward of [1, -1]) {
  const h = 64;
  const { c, dx } = friends.leanShear(0.18, toward, h);
  // CSS matrix(1, 0, c, 1, dx, 0) about the middle of the box: x' = x + c * y + dx, y down from the middle.
  const feet = c * (h / 2) + dx;
  const top = c * (-h / 2) + dx;
  assert.ok(Math.abs(feet) <= 1, `facing ${toward}: the feet stay where they stand (${feet})`);
  assert.equal(Math.sign(top), toward, `facing ${toward}: the top tips toward its friend (${top})`);
  assert.ok(Math.abs(top) >= h * 0.15, 'by a fair way');
}
assert.deepEqual(friends.leanShear(0, 1, 64), { c: 0, dx: 0 }, 'upright when not leaning');

// --- after: the left one hops, the right one cheers ------------------------------------------------------------------
assert.equal(friends.kissAfter(1), 'hop', 'the one on the left (its friend on its right) hops');
assert.equal(friends.kissAfter(-1), 'cheer', 'the other cheers');

// --- the room hears it ------------------------------------------------------------------------------------------------
assert.ok(wire.COMPANION_REACTIONS.includes('kiss'), 'a kiss is a reaction the room hears');
assert.equal(wire.reactionIsLocal('kiss'), false, 'sent, so everyone in the room sees it');
assert.equal(wire.reactionMark('kiss'), '♥', 'a heart where nothing moves');
assert.equal(wire.reactionMotion('kiss'), 'hop', 'read plainly, a hop');
assert.equal(wire.parseCompanionWire({ x: 0.5, m: 'stand', r: 3, k: 'kiss' })?.k, 'kiss', 'it rides on the wire');

// --- the wiring --------------------------------------------------------------------------------------------------------
{
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r/g, '');
  const room = read('app/components/ProfileRoom.tsx');
  const walkerFile = read('app/components/ProfileCharacter.tsx');
  const companion = read('app/components/Companion.tsx');
  const trail = read('app/components/NoteTrail.tsx');
  // (2026-11-23, "allow to drag into the profile room") Somebody's companion dropped in off a stream room's strip is a
  // fourth kind of figure in the room, handed its kiss too. Updated on purpose.
  assert.equal((room.match(/kiss=\{/g) ?? []).length, 4, 'the owner, every guest, your visiting companion and anybody dropped in are handed their kiss');
  assert.ok(room.includes('kissDue(key, from, now, together'), 'the ROOM keeps the clock for each pair');
  assert.ok(/reduced \|\| nearForKiss\(xa, xb, w\)/.test(room), 'under reduced motion being here together is enough (nobody walks over)');
  assert.ok(walkerFile.includes('kissWalk(current, phase,'), 'the ROOM walker steps in by kissWalk');
  assert.ok(walkerFile.includes("hearts={leaning ? (state.dir === 1 ? 'right' : 'left') : null}"), 'and its hearts rise toward its friend while it leans');
  assert.ok(walkerFile.includes('data-kiss-still'), 'reduced motion: a still heart instead');
  assert.ok(/const leaning = lean > 0;/.test(walkerFile) && /!out && !reduced && kissNow\?\.stage === 'lean'/.test(walkerFile), 'nothing leans under reduced motion');
  assert.ok(companion.includes("react('kiss')"), 'your companion tells the room it kisses');
  assert.ok(companion.includes('kissDue(pairKeyOf(mine, pal), kissFrom, now, kissSince, kissLast)'), 'at the moment both browsers work out');
  assert.ok(companion.includes("now.k === 'kiss' && !still"), 'their companion on your strip leans in too');
  assert.ok(companion.includes("showMark(mark, markTimer, reactionMark('kiss')"), 'reduced motion on the strip: a still heart over its head');
  assert.ok(/kiss = \{ at, spot:/.test(companion), 'the spot it steps in to is fixed once (one target for the room, not one a frame)');
  assert.ok(companion.includes('for (const hear of kissHeard) hear(person, moment);') && companion.includes('const at = due !== null && act === null ? due : asked;'), 'a companion that heard its friend start a kiss joins in on that moment');
  assert.ok(companion.includes('othersHereState().inRoom[pal] === undefined ? friendX : null'), 'never a kiss with a friend up in a profile ROOM');
  assert.ok(trail.includes("const HEARTS = ['♥']"), 'the hearts are the text heart');
  assert.ok(!/<svg|<path|clip-path|border-radius/i.test(trail), 'and nothing drawn by code');
  assert.ok(/const trail: Trail \| null = reduced \? null/.test(trail), 'and none under reduced motion');
}

console.log('check-character-kiss: ok');
