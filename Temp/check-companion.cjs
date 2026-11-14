/*
 * The companion along the bottom of the site (SPEC-companion.md): its rules, without a browser.
 *   npx tsc app/lib/companion/brain.ts app/lib/companion/wire.ts app/lib/companion/choices.ts app/lib/watch/members-signature.ts --outDir Temp/companion-check --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-companion.cjs
 *
 * What it holds:
 *   - what it decides: chases a pointer near the strip, dances to the music bar, sits then sleeps when nothing happens,
 *     wakes when something does, and only ever walks inside the free stretch it stands in;
 *   - the stretches: the folded player, the floating video and the TV box are stepped around, never over;
 *   - the switch: no companion signed out, off on a phone unless switched on there, and (until characters on profiles is
 *     live) off by default on a computer;
 *   - the room wire: malformed presence is no companion, at most 8 are drawn, and a companion's step does not tell the
 *     room window that somebody joined;
 *   - the wiring: rides on the room's existing presence (no new channel), never per frame, clicks pass through the strip.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'companion-check');
const brain = require(path.join(OUT, 'companion', 'brain.js'));
const wire = require(path.join(OUT, 'companion', 'wire.js'));
const choices = require(path.join(OUT, 'companion', 'choices.js'));
const { membersSignature } = require(path.join(OUT, 'watch', 'members-signature.js'));
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok    ${name}`);
}

/** A seeded dice, so a run is the same run every time. */
function dice(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SPAN = { left: 0, right: 1000 };
const base = (over) => ({ now: 0, lastActivity: 0, musicPlaying: false, pointerX: null, x: 500, span: SPAN, random: dice(1), ...over });

ok('a pointer near the strip is chased, and kept after a moment once it leaves', () => {
  let state = brain.think(brain.startBrain(0), base({ now: 100, lastActivity: 100, pointerX: 300 }));
  assert.equal(state.mood, 'chase');
  assert.equal(state.target, 300);
  state = brain.think(state, base({ now: 100 + brain.CHASE_LINGER_MS - 100, lastActivity: 100 }));
  assert.equal(state.mood, 'chase', 'still after it within the linger');
  state = brain.think(state, base({ now: 100 + brain.CHASE_LINGER_MS + 100, lastActivity: 100 }));
  assert.notEqual(state.mood, 'chase', 'gives up after the linger');
});

ok('a chase target past the end of its stretch stops at the end', () => {
  const state = brain.think(brain.startBrain(0), base({ pointerX: 5000 }));
  assert.equal(state.target, SPAN.right);
});

ok('the music bar playing makes it dance, and the chase still wins', () => {
  assert.equal(brain.think(brain.startBrain(0), base({ musicPlaying: true })).mood, 'dance');
  assert.equal(brain.think(brain.startBrain(0), base({ musicPlaying: true, pointerX: 10 })).mood, 'chase');
});

ok('nothing happening: it sits, then sleeps; dancing keeps it awake', () => {
  assert.equal(brain.think(brain.startBrain(0), base({ now: brain.SIT_AFTER_MS })).mood, 'sit');
  assert.equal(brain.think(brain.startBrain(0), base({ now: brain.SLEEP_AFTER_MS })).mood, 'sleep');
  assert.equal(brain.think(brain.startBrain(0), base({ now: brain.SLEEP_AFTER_MS, musicPlaying: true })).mood, 'dance');
});

ok('you coming back wakes it', () => {
  const asleep = brain.think(brain.startBrain(0), base({ now: brain.SLEEP_AFTER_MS }));
  const woken = brain.think(asleep, base({ now: brain.SLEEP_AFTER_MS + 100, lastActivity: brain.SLEEP_AFTER_MS + 50 }));
  assert.notEqual(woken.mood, 'sleep');
  assert.notEqual(woken.mood, 'sit');
});

ok('ten busy minutes of wandering: it walks, stands and sits, and never leaves its stretch', () => {
  const span = { left: 320, right: 1180 };
  const random = dice(7);
  let state = brain.startBrain(0);
  let x = 900;
  const seen = new Set();
  for (let now = 0; now < 600_000; now += 100) {
    state = brain.think(state, { now, lastActivity: now, musicPlaying: false, pointerX: null, x, span, random });
    seen.add(state.mood);
    if (state.target !== null) {
      assert.ok(state.target >= span.left && state.target <= span.right, `target ${state.target} outside ${span.left}..${span.right}`);
      x += Math.sign(state.target - x) * Math.min(3, Math.abs(state.target - x));
    }
    assert.ok(x >= span.left && x <= span.right);
  }
  for (const mood of ['walk', 'stand', 'sit']) assert.ok(seen.has(mood), `never ${mood}`);
});

ok('the folded player tile and the floating video are stepped around, never over', () => {
  // A 1280px screen, the folded tile at the left (8..312) and a floating video at the right (900..1260).
  const spans = brain.freeSpans(1280, [{ left: 8, right: 312 }, { left: 900, right: 1260 }], 32, 6);
  assert.deepEqual(spans, [{ left: 318, right: 862 }]);
  // Nothing on the strip: the whole width, less the figure.
  assert.deepEqual(brain.freeSpans(1280, [], 32, 6), [{ left: 0, right: 1248 }]);
  // A gap narrower than the figure is no gap.
  assert.deepEqual(brain.freeSpans(90, [{ left: 30, right: 60 }], 32, 6), []);
  assert.deepEqual(brain.freeSpans(100, [{ left: 30, right: 60 }], 32, 6), [{ left: 66, right: 68 }], 'just room on the right');
  // Standing where a tile has just appeared: it steps to the nearest free stretch.
  assert.deepEqual(brain.spanFor([{ left: 0, right: 100 }, { left: 400, right: 900 }], 300), { left: 400, right: 900 });
  assert.equal(brain.spanFor([], 10), null);
});

ok('the switch: none signed out, off on a phone until switched on there, off by default until a SHOWN character', () => {
  const d = choices.DEFAULT_COMPANION;
  assert.equal(choices.companionOut(d, { signedIn: false, phone: false, hasShown: true }), false);
  assert.equal(choices.companionOut({ ...d, computer: true }, { signedIn: false, phone: false, hasShown: true }), false);
  assert.equal(choices.companionOut(d, { signedIn: true, phone: false, hasShown: false }), false);
  assert.equal(choices.companionOut(d, { signedIn: true, phone: false, hasShown: true }), true);
  assert.equal(choices.companionOut(d, { signedIn: true, phone: true, hasShown: true }), false);
  const phoneOn = choices.withSwitch(d, true, true);
  assert.equal(choices.companionOut(phoneOn, { signedIn: true, phone: true, hasShown: false }), true);
  assert.equal(choices.companionOut(phoneOn, { signedIn: true, phone: false, hasShown: false }), false, 'the phone switch leaves the computer alone');
  assert.deepEqual(choices.parseCompanionChoices({ computer: 'yes', phone: 1 }), d);
  assert.deepEqual(choices.parseCompanionChoices({ computer: false, phone: true, character: 'abc' }), { computer: false, phone: true }, 'no character to choose: always the SHOWN one');
  assert.doesNotMatch(read('app/components/CompanionPreferences.tsx'), /WEARS|readLibrary/, 'no character picker');
});

ok('somebody else presence is read carefully: junk is no companion, the share stays 0..1', () => {
  assert.equal(wire.parseCompanionWire(null), null);
  assert.equal(wire.parseCompanionWire({ x: 0.5, m: 'fly' }), null);
  assert.equal(wire.parseCompanionWire({ x: 'left', m: 'walk' }), null);
  assert.deepEqual(wire.parseCompanionWire({ x: 7, m: 'walk', r: -3, k: 'boom', c: '', p: 'fly' }), { x: 1, m: 'walk', r: 0, k: null, c: null, p: null });
  assert.deepEqual(wire.parseCompanionWire({ x: 0.25, m: 'dance', r: 4, k: 'message', c: 'strip/1' }), { x: 0.25, m: 'dance', r: 4, k: 'message', c: 'strip/1', p: null }, 'a browser on older code says no pose');
  assert.deepEqual(wire.parseCompanionWire({ x: 0.25, m: 'sleep', r: 4, k: 'cheer', c: 'strip/1', p: 'curl' }), { x: 0.25, m: 'sleep', r: 4, k: 'cheer', c: 'strip/1', p: 'curl' });
  assert.equal(wire.parseCompanionWire({ x: 0.5, m: 'stand', p: 'hop' }).p, null, 'a one-off is not a pose');
  assert.equal(wire.reactionShowsMark('reply'), true);
  assert.equal(wire.reactionShowsMark('wake'), false);
});

/* --- a life of its own (Luke, 2026-11-14) --------------------------------------------------------------------- */

ok('left alone five minutes it curls right up; before that a sleep is a plain sleep; coming back wakes it', () => {
  const asleep = brain.think(brain.startBrain(0), base({ now: brain.SLEEP_AFTER_MS }));
  assert.equal(asleep.mood, 'sleep');
  assert.equal(asleep.pose, null);
  const curled = brain.think(asleep, base({ now: brain.CURL_AFTER_MS }));
  assert.equal(curled.mood, 'sleep');
  assert.equal(curled.pose, 'curl');
  assert.equal(brain.think(curled, base({ now: brain.CURL_AFTER_MS + 100 })), curled, 'and stays curled, with nothing re-decided');
  const woken = brain.think(curled, base({ now: brain.CURL_AFTER_MS + 200, lastActivity: brain.CURL_AFTER_MS + 150 }));
  assert.equal(woken.mood, 'stand');
  assert.equal(woken.pose, null);
});

ok('in the small hours of your own clock it nods off sooner; by day it does not', () => {
  const early = brain.SLEEP_AFTER_MS * brain.NIGHT_SHARE;
  assert.ok(early < brain.SLEEP_AFTER_MS);
  assert.equal(brain.think(brain.startBrain(0), base({ now: early, hour: 2 })).mood, 'sleep');
  assert.equal(brain.think(brain.startBrain(0), base({ now: early, hour: 14 })).mood, 'sit');
  assert.equal(brain.think(brain.startBrain(0), base({ now: early })).mood, 'sit', 'no clock: daytime');
  assert.equal(brain.think(brain.startBrain(0), base({ now: brain.SIT_AFTER_MS * brain.NIGHT_SHARE, hour: 0 })).mood, 'sit');
  assert.equal(brain.isNight(brain.NIGHT_UNTIL_HOUR), false);
  assert.equal(brain.isNight(23), false);
});

ok('it runs after the pointer', () => {
  const state = brain.think(brain.startBrain(0), base({ pointerX: 300 }));
  assert.equal(state.pose, 'run');
  assert.equal(wire.loopMotion('chase', null, 'dance1'), 'run');
});

ok('bored, it stretches, spins and runs back and forth: each asked for once, all inside its stretch', () => {
  const span = { left: 320, right: 1180 };
  const random = dice(3);
  let state = brain.startBrain(0);
  let x = 700;
  const acts = [];
  let zooms = 0;
  let zoomTargets = new Set();
  for (let now = 0; now < 3_600_000; now += 100) {
    const before = state;
    state = brain.think(state, { now, lastActivity: now, musicPlaying: false, pointerX: null, x, span, random, hour: 14 });
    if (state.act !== null) {
      acts.push(state.act);
      assert.equal(state.mood, 'stand', 'a stretch or a spin is done standing');
      assert.equal(brain.think(state, { now: now + 100, lastActivity: now, musicPlaying: false, pointerX: null, x, span, random, hour: 14 }).act, null, 'asked for in one thought only');
    }
    if (state.mood === 'walk' && state.pose === 'run') {
      // A new burst is one whose runs-left went back up (two can follow straight on from each other).
      if (!(before.mood === 'walk' && before.pose === 'run') || state.laps > before.laps) {
        zooms += 1;
        zoomTargets = new Set();
      }
      zoomTargets.add(state.target);
      assert.ok(zoomTargets.size <= 2, 'back and forth between two spots');
      assert.ok(Math.abs(state.target - state.home) <= brain.ZOOM_REACH);
    }
    if (state.target !== null) {
      assert.ok(state.target >= span.left && state.target <= span.right, `target ${state.target} outside its stretch`);
      x += Math.sign(state.target - x) * Math.min(state.pose === 'run' ? 6 : 3, Math.abs(state.target - x));
    }
  }
  assert.ok(acts.includes('stretch'), 'never stretched');
  assert.ok(acts.includes('dance4'), 'never spun');
  assert.ok(zooms >= 1, 'never ran about');
  // A stretch too narrow to run about in: a spin instead, never a run.
  let narrow = brain.startBrain(0);
  const tight = { left: 100, right: 100 + brain.ZOOM_REACH };
  for (let now = 0; now < 3_600_000; now += 100) {
    narrow = brain.think(narrow, { now, lastActivity: now, musicPlaying: false, pointerX: null, x: 150, span: tight, random, hour: 14 });
    assert.notEqual(narrow.pose, 'run');
  }
});

ok('let go, it falls faster each frame, lands exactly on its floor and never leaves the screen; a throw carries and fades', () => {
  let fall = { x: 400, y: 100, vx: 0, vy: 0, landed: false };
  const drops = [];
  for (let i = 0; i < 100 && !fall.landed; i += 1) {
    const next = brain.fallStep(fall, 800, 1200);
    drops.push(next.y - fall.y);
    fall = next;
  }
  assert.equal(fall.landed, true);
  assert.equal(fall.y, 800, 'on the floor, not through it');
  assert.equal(fall.x, 400, 'dropped, not thrown: straight down');
  assert.ok(drops[1] > drops[0] && drops[2] > drops[1], 'faster each frame');
  assert.ok(Math.max(...drops) <= brain.FALL_MAX);
  assert.ok(drops.every((d) => Number.isInteger(d)), 'whole pixels: stepped');
  // Thrown hard to the right near the edge: it stops at the edge.
  let thrown = { x: 1150, y: 100, vx: brain.throwOf(500), vy: 0, landed: false };
  assert.equal(thrown.vx, brain.THROW_MAX);
  const speeds = [];
  while (!thrown.landed) {
    thrown = brain.fallStep(thrown, 800, 1200);
    speeds.push(thrown.vx);
    assert.ok(thrown.x >= 0 && thrown.x <= 1200);
  }
  assert.ok(speeds[speeds.length - 1] < speeds[0], 'the throw fades');
  assert.equal(brain.throwOf(-500), -brain.THROW_MAX);
  assert.equal(brain.fallStep({ x: 5, y: 900, vx: 0, vy: 0, landed: false }, 800, 1200).y, 800, 'let go under a floor that rose: on it at once');
});

ok('a pose is only drawn with the mood it goes with, and every reaction has its one-off motion', () => {
  assert.equal(wire.loopMotion('sleep', 'curl', 'dance1'), 'curl');
  assert.equal(wire.loopMotion('stand', 'curl', 'dance1'), 'idle', 'a curl is only ever a sleep');
  assert.equal(wire.loopMotion('dance', 'dance4', 'dance1'), 'dance4', 'the dance its owner sees');
  assert.equal(wire.loopMotion('dance', null, 'dance2'), 'dance2');
  assert.equal(wire.loopMotion('walk', 'run', 'dance1'), 'run');
  assert.equal(wire.loopMotion('walk', null, 'dance1'), 'walk');
  assert.equal(wire.loopMotion('sit', 'run', 'dance1'), 'sit');
  for (const kind of wire.COMPANION_REACTIONS) assert.equal(typeof wire.reactionMotion(kind), 'string', kind);
  assert.equal(wire.reactionMotion(null), 'hop', 'a kind this browser does not know is a hop');
  assert.equal(wire.reactionMotion('wake'), 'stretch');
  assert.equal(wire.reactionMotion('land'), 'land');
  assert.equal(wire.reactionMotion('cheer'), 'cheer');
  assert.deepEqual(wire.COMPANION_MOODS, ['stand', 'walk', 'sit', 'sleep', 'dance', 'chase'], 'the moods stay the first six, so older code still draws it');
});

ok('picking it up: only yours, a drag not a press, nothing under reduced motion, and never left hanging', () => {
  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /own \? 'cursor-grab touch-none select-none' : ''/, 'only your own companion can be picked up');
  assert.match(strip, /Math\.hypot\(event\.clientX - grab\.startX, event\.clientY - grab\.startY\) < GRAB_SLOP/, 'a press that has not moved is a poke');
  assert.match(strip, /if \(still \|\| !canGrab\(\)\) \{/, 'nothing is carried under reduced motion, or out of a room it is in');
  assert.match(strip, /if \(!canGrab\(\)\) \{\s*grab = null;\s*return;\s*\}/, 'a press held while it climbed into the room picks nothing up');
  assert.match(strip, /if \(event\.type === 'pointerup' && phase === 'strip'\) poke\(\);/, 'a poke only on its strip');
  assert.match(strip, /window\.addEventListener\('pointerup', onDrop/, 'a let-go is heard anywhere on the window');
  assert.match(strip, /window\.addEventListener\('pointercancel', onDrop/);
  assert.match(strip, /Math\.min\(floor\.y, Math\.max\(size\.h, grab\.py \+ grab\.offY\)\)/, 'held, it stays on screen and above its own floor');
  assert.match(strip, /const slid = under === null \? next\.x : Math\.min\(under\.right, Math\.max\(under\.left, next\.x\)\)/, 'it lands on a stretch it can stand on');
  assert.match(read('app/components/NoteTrail.tsx'), /mood === 'sleep' \? 'snores'/, 'z z z while it sleeps');
  assert.match(read('app/components/NoteTrail.tsx'), /const trail: Trail \| null = reduced \? null/, 'and none under reduced motion');
});

ok('an old strip is baked again only by its owner, on a computer, once', () => {
  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /if \(stale === null \|\| userId === null \|\| phone !== false\) return;/, 'only a stale strip, signed in, on a computer');
  assert.match(strip, /import\('\.\.\/lib\/character\/rebake'\)/, 'the baking code is fetched only then');
  const rebake = read('app/lib/character/rebake.ts');
  assert.match(rebake, /if \(!shown\.stale \|\| shown\.person !== person\) return 'skipped';/, "never somebody else's");
  assert.match(rebake, /if \(tried\.has\(strip\)\) return 'skipped';/, 'once a page load');
  assert.match(rebake, /mood: shown\.mood/, 'the mood is kept');
  assert.doesNotMatch(rebake, /\.delete\(|hide\(/, 'it never takes a character down');
});

ok('a full room draws at most 8 companions, oldest first, yours always among them', () => {
  const others = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, name: `P${i}`, joinedAt: 100 - i, wire: { x: 0, m: 'stand', r: 0, k: null, c: null } }));
  assert.equal(wire.MAX_COMPANIONS, 8);
  assert.equal(wire.companionsToDraw(others, true).length, 7);
  assert.equal(wire.companionsToDraw(others, false).length, 8);
  assert.equal(wire.companionsToDraw(others, true)[0].key, 'k11');
});

ok('re-saying the same companion is not a new message; the room hears only a change', () => {
  const said = [];
  const off = wire.subscribeToCompanionOut(() => said.push(wire.companionOutState()));
  const one = { x: 0.5, m: 'walk', r: 0, k: null, c: null };
  wire.sayCompanion(one);
  wire.sayCompanion({ ...one });
  wire.sayCompanion({ ...one, m: 'sit' });
  off();
  assert.equal(said.length, 2);
});

ok('a companion stepping does not tell the room window anybody joined', () => {
  const a = { key: 'a', userId: 'u1', guestId: null, name: 'A', joinedAt: 1 };
  const b = { key: 'b', userId: 'u2', guestId: null, name: 'B', joinedAt: 2 };
  assert.equal(membersSignature([a, b]), membersSignature([b, a]));
  assert.notEqual(membersSignature([a]), membersSignature([a, b]));
});

ok('the wiring: the room presence carries it, no new channel, clicks pass through all but the figure', () => {
  const live = read('app/lib/watch/supabase-watch-repository.ts');
  const join = live.slice(live.indexOf('joinRoom(roomId'), live.indexOf('subscribeWatching('));
  assert.equal((join.match(/client\.channel\(/g) ?? []).length, 1, 'joinRoom opens exactly the one room channel');
  assert.match(join, /companion: self\.userId === null \? null : companionOutState\(\)/, 'the companion rides in the tracked presence');
  assert.match(join, /subscribeToCompanionOut\(/, 're-says only when the companion changes');
  assert.match(join, /setRoomCompanions\(\[\]\)/, 'leaving the room empties the strip of other companions');
  // (2026-11-13) A failed join is tried again with a fresh sign-in, or the room hears only this tab for good (Luke saw it).
  assert.match(join, /status === 'CHANNEL_ERROR' \|\| status === 'TIMED_OUT' \|\| status === 'CLOSED'/, 'a refused, timed-out or closed join is noticed');
  assert.match(join, /client\.auth\.getSession\(\)\)\s*\.then\(\(\) => client\.realtime\.setAuth\(\)\)/, 'a fresh sign-in is asked for first');
  assert.match(join, /\.then\(join\)/, 'and the room is joined again');
  assert.match(join, /if \(retry !== null\) clearTimeout\(retry\)/, 'leaving stops any try still waiting');
  const mock = read('app/lib/watch/mock-watch-repository.ts');
  assert.match(mock, /subscribeToCompanionOut\(/, 'the mock room carries companions too');

  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /pointer-events-none fixed inset-0 z-40/, 'the strip layer takes no clicks');
  assert.match(strip, /group pointer-events-auto/, 'only the figure does');
  assert.match(read('app/lib/companion/use-phone.ts'), /prefers-reduced-motion: reduce/, 'reduced motion is read');
  assert.match(strip, /if \(phone === null \|\| still === null \|\| shown === undefined\) return null;/, 'nothing is drawn on a guess before the device, the motion setting and the SHOWN character are read');
  assert.match(strip, /hasShown: shown !== null/, 'a SHOWN character makes it on by default');
  assert.match(strip, /useShownCharacter\(companion\.wire\.c === null \? null : companion\.userId\)/, "room companions wear their owner's SHOWN character");
  assert.match(strip, /if \(still\) \{\s*brain = \{ mood: 'stand'/, 'and stands it still in one frame');
  assert.doesNotMatch(strip, /requestAnimationFrame/, 'stepped frames on a ten-a-second clock, not a smooth loop');
  assert.match(strip, /data-companion-figure="placeholder"/, 'a placeholder field when there is no SHOWN character; no drawn stand-in');
  assert.match(strip, /data-companion-figure="character"/, "the SHOWN character's baked strip otherwise");
  assert.doesNotMatch(strip, /<svg|<canvas/, 'the code never draws a character');

  for (const file of ['app/components/MusicPlayer.tsx', 'app/components/WatchWindow.tsx']) {
    assert.match(read(file), /data-companion-avoid/, `${file} marks what the companion steps around`);
  }
  assert.match(read('app/layout.tsx'), /<Companion \/>/);
});

console.log(`\n${passed} passed`);
