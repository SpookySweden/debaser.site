/*
 * The companion along the bottom of the site (SPEC-companion.md): its rules, without a browser.
 *   npx tsc app/lib/companion/brain.ts app/lib/companion/wire.ts app/lib/companion/choices.ts app/lib/companion/scene.ts app/lib/companion/events.ts app/lib/companion/ledge.ts app/lib/companion/floor.ts app/lib/companion/throw.ts app/lib/companion/shove.ts app/lib/companion/loose.ts app/lib/watch/members-signature.ts --outDir Temp/companion-check --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
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
 *   - the wiring: rides on the room's existing presence (no new channel), never per frame, clicks pass through the strip;
 *   - thrown (Luke, 2026-11-14): let go on the move it keeps the pointer's speed, winds up, flies under gravity and drag,
 *     splats on a side or the top of the screen it hits hard and bounces off one it hits softly, bounces on its floor and
 *     settles; a squash keeps as much of it as there was; the smear lies back along its path; a room hears only the end;
 *   - shoved by windows (Luke, 2026-11-16): one that pops up on it knocks it out sideways and up, one dragged into it sends it
 *     the way the window went, one brought down onto its head squashes it flat and it squirts out; a window that only sits
 *     there does nothing, the same window can't hit it every frame, and a first look at the page is not a pop.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'companion-check');
const brain = require(path.join(OUT, 'companion', 'brain.js'));
const wire = require(path.join(OUT, 'companion', 'wire.js'));
const choices = require(path.join(OUT, 'companion', 'choices.js'));
const scenes = require(path.join(OUT, 'companion', 'scene.js'));
const events = require(path.join(OUT, 'companion', 'events.js'));
const ledge = require(path.join(OUT, 'companion', 'ledge.js'));
const floors = require(path.join(OUT, 'companion', 'floor.js'));
const throws = require(path.join(OUT, 'companion', 'throw.js'));
const shoves = require(path.join(OUT, 'companion', 'shove.js'));
const { membersSignature } = require(path.join(OUT, 'watch', 'members-signature.js'));
const readFile = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
// The companion layer draws its figure with app/lib/companion/draw.ts (moved out of Companion.tsx on 2026-11-16 so a
// profile ROOM's carried figure shares it): read together, they are the layer the rules below hold.
const read = (file) => (file === 'app/components/Companion.tsx' ? `${readFile(file)}\n${readFile('app/lib/companion/draw.ts')}` : readFile(file));

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
  assert.match(strip, /if \(event\.type !== 'pointerup' \|\| phase !== 'strip'\) return;/, 'a poke (or a double press) only on its strip');
  assert.match(strip, /window\.addEventListener\('pointerup', onDrop/, 'a let-go is heard anywhere on the window');
  assert.match(strip, /window\.addEventListener\('pointercancel', onDrop/);
  // (2026-11-14: the line moved into `hangAt`, so a let-go starts from the same place a carry draws it; the rule is the same.)
  assert.match(strip, /Math\.min\(floor\.ledge \? window\.innerHeight : floor\.y, Math\.max\(size\.h, held\.py \+ held\.offY\)\)/, 'held, it stays on screen and above its own floor');
  assert.match(strip, /if \(phase === 'held' && grab !== null\) \{\s*const at = hangAt\(floor, size, grab\);\s*x = at\.x;\s*y = at\.y;/, 'which is where a carry draws it');
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
  // Stepped frames on a ten-a-second clock. Luke, 2026-11-16 ("better framerate and visual tracking when picking up,
  // dragging and throwing"): only where it is in the air glides between those frames, every display frame; the loop
  // itself, its walking and its picture stay stepped.
  assert.match(strip, /const timer = setInterval\(tick, TICK_MS\);/, 'the loop is a ten-a-second clock');
  assert.equal((strip.match(/requestAnimationFrame\(/g) ?? []).length, 2, 'a display-frame loop in one place only (the glide, which asks for its own next frame)');
  assert.match(strip, /if \(place === null \|\| glide === null \|\| \(phase !== 'thrown' && phase !== 'fall'\)\) \{/, 'and only while it is in the air');
  assert.match(strip, /data-companion-figure="placeholder"/, 'a placeholder field when there is no SHOWN character; no drawn stand-in');
  assert.match(strip, /data-companion-figure="character"/, "the SHOWN character's baked strip otherwise");
  assert.doesNotMatch(strip, /<svg|<canvas/, 'the code never draws a character');

  for (const file of ['app/components/MusicPlayer.tsx', 'app/components/WatchWindow.tsx']) {
    assert.match(read(file), /data-companion-avoid/, `${file} marks what the companion steps around`);
  }
  assert.match(read('app/layout.tsx'), /<Companion \/>/);
});

/* --- it takes part in what you are doing (Luke, 2026-11-14, step 2) -------------------------------------------- */

ok('typing, a game and a book come before the music; a video after it; the pointer still wins', () => {
  const at = (over) => brain.think(brain.startBrain(0), base({ now: 100, lastActivity: 100, ...over }));
  const typing = at({ scene: 'type' });
  assert.deepEqual([typing.mood, typing.pose], ['stand', 'type']);
  const game = at({ scene: 'game' });
  assert.deepEqual([game.mood, game.pose], ['sit', 'watch']);
  const book = at({ scene: 'read' });
  assert.deepEqual([book.mood, book.pose], ['sit', 'read']);
  const video = at({ scene: 'watch' });
  assert.deepEqual([video.mood, video.pose], ['sit', 'watch']);
  assert.equal(at({ scene: 'read', musicPlaying: true }).pose, 'read', 'a book is read through the music');
  assert.equal(at({ scene: 'type', musicPlaying: true }).pose, 'type');
  assert.equal(at({ scene: 'game', musicPlaying: true }).pose, 'watch');
  assert.equal(at({ scene: 'watch', musicPlaying: true }).mood, 'dance', 'a video left up while music plays is not being watched');
  assert.equal(at({ scene: 'read', pointerX: 300 }).mood, 'chase');
  assert.equal(brain.think(book, base({ now: 200, lastActivity: 100, scene: 'read' })), book, 'settled: nothing re-decided, so nothing re-said');
});

ok('watching, nothing happening is what watching looks like; reading, it dozes off over the book after five quiet minutes', () => {
  const long = brain.CURL_AFTER_MS * 3;
  const watching = brain.think(brain.startBrain(0), base({ now: long, lastActivity: 0, scene: 'watch' }));
  assert.deepEqual([watching.mood, watching.pose], ['sit', 'watch'], 'an hour into a film it is still watching');
  const game = brain.think(brain.startBrain(0), base({ now: long, lastActivity: 0, scene: 'game' }));
  assert.equal(game.pose, 'watch');
  const reading = brain.think(brain.startBrain(0), base({ now: brain.SLEEP_AFTER_MS * 2, lastActivity: 0, scene: 'read' }));
  assert.equal(reading.pose, 'read', 'a slow page is still reading: no nodding off after a minute');
  const dozed = brain.think(reading, base({ now: brain.CURL_AFTER_MS, lastActivity: 0, scene: 'read' }));
  assert.equal(dozed.mood, 'sleep');
  const turned = brain.think(dozed, base({ now: brain.CURL_AFTER_MS + 500, lastActivity: brain.CURL_AFTER_MS + 400, scene: 'read' }));
  assert.equal(turned.pose, 'read', 'a page turned: it is reading again');
});

ok('the scene ending, it is not left holding the pose', () => {
  const book = brain.think(brain.startBrain(0), base({ now: 100, lastActivity: 100, scene: 'read' }));
  const after = brain.think(book, base({ now: 200, lastActivity: 200 }));
  assert.equal(after.pose === 'read', false);
  // Even when nothing has happened for a while and it would sit anyway: a plain sit, not a reading one.
  const idle = brain.think(book, base({ now: brain.SIT_AFTER_MS + 200, lastActivity: 100 }));
  assert.deepEqual([idle.mood, idle.pose], ['sit', null]);
  const watching = brain.think(brain.startBrain(0), base({ now: 100, lastActivity: 100, scene: 'watch' }));
  const stopped = brain.think(watching, base({ now: brain.SLEEP_AFTER_MS + 200, lastActivity: 100 }));
  assert.deepEqual([stopped.mood, stopped.pose], ['sleep', null]);
});

ok('scenes are held and let go; a game beats a book beats a video', () => {
  assert.equal(scenes.companionScene(), null);
  const video = scenes.holdCompanionScene('watch');
  assert.equal(scenes.companionScene(), 'watch');
  const book = scenes.holdCompanionScene('read');
  assert.equal(scenes.companionScene(), 'read');
  const game = scenes.holdCompanionScene('game');
  const second = scenes.holdCompanionScene('game');
  assert.equal(scenes.companionScene(), 'game');
  game();
  assert.equal(scenes.companionScene(), 'game', 'two games held: one let go leaves the other');
  second();
  book();
  assert.equal(scenes.companionScene(), 'watch');
  video();
  video();
  assert.equal(scenes.companionScene(), null);
});

ok("a room is never told what you read or type: those poses, and a page turned, stay on your own screen", () => {
  for (const pose of ['read', 'type']) {
    assert.equal(wire.COMPANION_POSES.includes(pose), false, `${pose} is not a pose the room hears`);
    assert.equal(wire.parseCompanionWire({ x: 0.5, m: pose === 'read' ? 'sit' : 'stand', p: pose }).p, null);
    assert.equal(wire.loopMotion(pose === 'read' ? 'sit' : 'stand', pose, 'dance1'), pose, 'but it is drawn on your own');
  }
  assert.ok(wire.COMPANION_POSES.includes('watch'), 'watching the room\'s video is the room\'s own business');
  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /posing = COMPANION_POSES\.includes\(loop\) \? loop : null;/, 'only those poses are said');
  assert.match(strip, /if \(kind === 'flick'\) \{[^}]*lastActivity = Date\.now\(\);\s*if \(looping === 'read' && !still\) act = \{ motion: 'flick', tick: 0 \};\s*return;\s*\}/, 'a page turned is played, counts as you being here, and is never counted for the room');
  assert.match(strip, /input:not\(\[type\]\), input\[type="text"\]/, 'typing is heard in text boxes');
  assert.doesNotMatch(strip.slice(strip.indexOf('const WRITING'), strip.indexOf('const TYPING_MS')), /password/, 'never a password box');
  assert.doesNotMatch(strip, /event\.key(?!\.length| === 'Backspace'| === 'Enter'| === 'Escape')/, 'it hears that a key was typed, never which (Escape apart, which puts it down when carried)');
});

ok("on top of the room's window: the window leaves room above itself for the tallest companion, and none when nobody is out", () => {
  assert.equal(ledge.ledgeHeadroomState(), 0);
  const small = ledge.holdLedgeHeight(64);
  const tall = ledge.holdLedgeHeight(76.4);
  assert.equal(ledge.ledgeHeadroomState(), 0, 'companions out, but the window is not over their strip (a phone, a small window): it stays where it is');
  ledge.setLedgeCovering(true);
  assert.equal(ledge.ledgeHeadroomState(), 78, 'over the strip: room for the tallest, and a little air over its head');
  ledge.setLedgeCovering(false);
  assert.equal(ledge.ledgeHeadroomState(), 0);
  ledge.setLedgeCovering(true);
  tall();
  assert.equal(ledge.ledgeHeadroomState(), 66);
  small();
  assert.equal(ledge.ledgeHeadroomState(), 0, 'nobody out: the window is where it always was');
  ledge.setLedgeCovering(false);
  assert.match(read('app/lib/companion/floor.ts'), /setLedgeCovering\(ledgeBox !== null && reachesStrip\(ledgeBox, stripY, COVER_REACH\)\);/, 'the floor says whether the window is over the strip, by one measure for every figure');
  assert.equal(floors.reachesStrip({ left: 16, top: 8, right: 1432, bottom: 796 }, 806, 48), true, 'the filled room window, wherever its top is drawn');
  assert.equal(floors.reachesStrip({ left: 16, top: 78, right: 1432, bottom: 796 }, 806, 48), true, 'moving its top does not change the answer');
  assert.equal(floors.reachesStrip({ left: 16, top: 8, right: 1272, bottom: 892 }, 2671, 48), false, 'a phone: the window is at the top of a tall screen, nowhere near the strip');
  const dock = read('app/components/DockWindow.tsx');
  assert.match(dock, /const drop = managed && headroom !== undefined \? Math\.max\(0, headroom - live\.rect\.y\) : 0;/, 'only as much lower as it needs: a window already low enough is not moved');
  // Updated on purpose 2026-11-16 (Luke's ROOMFIX list, item 5: the room window "must not shrink" against the bar): the room
  // window's top and height are one sum that lifts it whole off the bar; the headroom's drop is still in both.
  assert.match(dock, /min\(\$\{live\.rect\.y \+ drop\}px, \$\{foot\} - \$\{live\.rect\.h - drop\}px\)\)\)` : live\.rect\.y \+ drop,/, 'drawn that much lower');
  assert.match(dock, /height: aboveBottomBar \? `min\(\$\{live\.rect\.h - drop\}px, \$\{foot\} - \$\{highest\}px\)\)` : live\.rect\.h - drop,/, 'shorter by the same, so its foot stays put');
  assert.match(dock, /const highest = Math\.max\(layoutTop\(\), headroom \?\? 0\);/, 'and never drawn above the headroom it leaves');
  assert.match(dock, /data-headroom=\{headroom\}/, 'and marked, so the companion knows which window to stand on');
  assert.equal((read('app/components/WatchWindow.tsx').match(/headroom=\{headroom\}/g) ?? []).length, 2, "the stream room's window, live or not yet");
  assert.doesNotMatch(read('app/components/ArcadeWindow.tsx'), /headroom/, 'no other window moves');
  assert.match(read('app/components/Companion.tsx'), /useEffect\(\(\) => holdLedgeHeight\(size\.h\), \[size\.h\]\);/, 'each figure drawn says how tall it is');
});

ok("the floor: its strip, stepping around open windows; while the room's window covers the strip, that window's top edge", () => {
  // On the strip (floor at 806, a 64 x 76 figure): Preferences open at the right reaches down into it; the arcade higher up does not.
  const prefs = { left: 1048, top: 100, right: 1432, bottom: 820 };
  const high = { left: 200, top: 100, right: 600, bottom: 700 };
  const strip = floors.floorFrom(1440, 806, null, [prefs, high], 64, 76);
  assert.equal(strip.y, 806);
  assert.equal(strip.ledge, false);
  assert.deepEqual([strip.left, strip.right], [0, 1440]);
  assert.deepEqual(strip.spans, [{ left: 0, right: 1048 - 6 - 64 }], 'it stops short of the window that would hide it');

  // The room's window, filling the screen from 80 down to the bar: it covers the strip, and has room above it.
  const room = { left: 16, top: 80, right: 1432, bottom: 796 };
  assert.equal(floors.ledgeCovers(room, 806, 76), true);
  const top = floors.floorFrom(1440, 806, room, [], 64, 76);
  assert.equal(top.ledge, true);
  assert.equal(top.y, 80, 'feet on the top edge of the window: above its title bar, over none of its keys');
  assert.deepEqual([top.left, top.right], [16, 1432]);
  assert.deepEqual(top.spans, [{ left: 16, right: 1432 - 64 }], 'between its two corners, never off the end');
  // Another window up there (Preferences, reaching the band it stands in) is stepped around; one lower down is not in the way.
  assert.deepEqual(floors.floorFrom(1440, 806, room, [{ left: 1048, top: 40, right: 1432, bottom: 500 }], 64, 76).spans, [{ left: 16, right: 1048 - 6 - 64 }]);
  assert.deepEqual(floors.floorFrom(1440, 806, room, [{ left: 1048, top: 200, right: 1432, bottom: 500 }], 64, 76).spans, [{ left: 16, right: 1432 - 64 }]);

  // Before it has made room (its top at 8): nowhere above it to stand, so it is a window in the way like any other.
  const tight = { left: 16, top: 8, right: 1432, bottom: 796 };
  assert.equal(floors.ledgeCovers(tight, 806, 76), false);
  const hidden = floors.floorFrom(1440, 806, tight, [], 64, 76);
  assert.equal(hidden.ledge, false);
  assert.deepEqual(hidden.spans, [], 'and it is not drawn behind it');
  // Dragged small and up out of the way: it does not cover the strip, so the strip is the floor, the whole width.
  const away = { left: 300, top: 100, right: 900, bottom: 500 };
  assert.equal(floors.ledgeCovers(away, 806, 76), false);
  const free = floors.floorFrom(1440, 806, away, [], 64, 76);
  assert.deepEqual([free.y, free.ledge], [806, false]);
  assert.deepEqual(free.spans, [{ left: 0, right: 1440 - 64 }]);
  // Small but over part of the strip: they are up on it, between its corners.
  const corner = { left: 900, top: 300, right: 1400, bottom: 800 };
  const perched = floors.floorFrom(1440, 806, corner, [], 64, 76);
  assert.deepEqual([perched.y, perched.ledge, perched.spans], [300, true, [{ left: 900, right: 1400 - 64 }]]);
  // Narrower than the figure: no room on it.
  assert.deepEqual(floors.floorFrom(1440, 806, { left: 500, top: 300, right: 550, bottom: 800 }, [], 64, 76).spans, []);

  const source = read('app/lib/companion/floor.ts');
  assert.match(source, /if \(element instanceof HTMLElement && element\.dataset\.minimized === 'true'\) return false;/, 'folded away, it is not there: back to the strip');
  assert.match(source, /if \(element === ledge \|\| !shown\(element\)\) continue;/, 'the window it stands on is not in its own way');
  const layer = read('app/components/Companion.tsx');
  assert.doesNotMatch(layer, /style\.zIndex/, 'it stands above the window, not in front of it: the layer stays under every window');
  assert.match(layer, /phase === 'strip' && !floor\.ledge && room !== null/, 'it does not climb into a profile room from up there');
  assert.match(layer, /\(floor\.ledge && loop === 'watch' \? 'sit' : loop\)/, 'up there it watches the video by sitting on the edge');
  assert.match(layer, /const tag = frame\.floorY - size\.h < 28 \? 'under' : 'over';/, 'and its name opens under it, not off the top of the screen');
});

ok('a companion missing from one sync of the room is kept a moment, not blinked out; an empty room keeps nobody', () => {
  const one = (key) => ({ key, userId: `u-${key}`, name: key.toUpperCase(), joinedAt: 1, wire: { x: 0.5, m: 'stand', r: 0, k: null, c: null, p: null } });
  const [a, b] = [one('a'), one('b')];
  // b drops out of a sync while a re-says itself: b is still shown.
  let step = wire.withLingering([a, b], [a], new Map(), 1000);
  assert.deepEqual(step.list.map((c) => c.key), ['a', 'b']);
  assert.equal(step.held.get('b').until, 1000 + wire.LINGER_MS);
  // Still missing a second later: still shown, its time not pushed back.
  step = wire.withLingering(step.list, [a], step.held, 2000);
  assert.deepEqual(step.list.map((c) => c.key), ['a', 'b']);
  assert.equal(step.held.get('b').until, 1000 + wire.LINGER_MS);
  // Back in the next sync: shown once, no longer held.
  const back = wire.withLingering(step.list, [a, b], step.held, 2100);
  assert.deepEqual(back.list.map((c) => c.key), ['a', 'b']);
  assert.equal(back.held.size, 0);
  // Never back: gone once its time is up.
  const gone = wire.withLingering(step.list, [a], step.held, 1000 + wire.LINGER_MS + 1);
  assert.deepEqual(gone.list.map((c) => c.key), ['a']);
  assert.equal(gone.held.size, 0, 'and not held again for having just been shown');
  // The tab leaving the room (an empty sync): nobody lingers on the strip.
  assert.deepEqual(wire.withLingering([a, b], [], step.held, 1500).list, []);
  assert.ok(wire.LINGER_MS <= 3000, 'a moment, not a ghost');
});

ok('it never blocks a press: over a key it lets presses through, and a resting pointer is let be', () => {
  const layer = read('app/components/Companion.tsx');
  assert.match(layer, /const want = over \? 'none' : '';\s*if \(place\.style\.pointerEvents !== want\) place\.style\.pointerEvents = want;/, 'standing over a key, presses go to the key');
  assert.match(layer, /if \(frame % 5 === 0 && grab === null\) yieldToKeys\(place\);/, 'looked at twice a second, not while it is being pressed');
  assert.match(layer, /now - pointer\.at < CHASE_FRESH_MS/, 'a pointer that has stopped moving (or gone into a frame) is no longer chased');
});

ok('the one-line hook-ups: the reader, the arcade, the board and the stream room each tell it in a line', () => {
  const reader = read('app/components/reader/ReaderPage.tsx');
  assert.match(reader, /useCompanionScene\('read', phase === 'ready' \|\| phase === 'viewer'\);/, 'reading while a book is open');
  assert.match(reader, /view\.addEventListener\('relocate', \(event\) => \{\s*pokeCompanion\('flick'\);/, 'a page turned');
  assert.match(reader, /action: 'finished' \}\);\s*pokeCompanion\('cheer'\);/, 'a book finished');
  assert.match(read('app/components/GameMatch.tsx'), /useCompanionMatch\(game === 'tic-tac-toe' \? tttWinner\(board\) : duelWinner\(duel\), game === 'tic-tac-toe' \? myMark : mySide\);/, 'a match, and how it ended');
  assert.equal((read('app/components/ForumProvider.tsx').match(/\}\)\.then\(cheerCompanion\);/g) ?? []).length, 2, 'a thread filed and a reply filed');
  assert.match(read('app/components/WatchRoom.tsx'), /useCompanionScene\('watch', room\.isPlaying\);/, "the room's video playing");
  const hooks = read('app/lib/companion/use-companion-scene.ts');
  assert.match(hooks, /if \(winner !== null && last\.current === null\) pokeCompanion\(winner === mine \? 'cheer' : 'slump'\);/, 'once, when the game ends');
  const slots = read('app/lib/ui/art/slots.ts');
  assert.match(slots, /id: 'sprite-companion-book'/, 'the book is an art slot');
  assert.match(read('app/components/Companion.tsx'), /<SpriteSlot src="\/assets\/sprites\/companion-book\.gif"/, "drawn from Luke's file, never by code");
});

/* --- social touches (Luke, 2026-11-14, step 3) ------------------------------------------------------------------ */

ok('a mark for each kind of news, in text: ! for a reply, VS for a game invite, a heart for a recommendation, ... for speaking', () => {
  assert.equal(wire.reactionMark('reply'), '!');
  assert.equal(wire.reactionMark('message'), '!');
  assert.equal(wire.reactionMark('online'), '!');
  assert.equal(wire.reactionMark('invite'), 'VS');
  assert.equal(wire.reactionMark('recommend'), '♥');
  assert.equal(wire.reactionMark('spoke'), '...');
  for (const quiet of ['wake', 'poke', 'wave', 'spin', 'cheer', 'slump', 'land', 'flick', 'look', null]) assert.equal(wire.reactionMark(quiet), null, `${quiet} is a motion alone`);
  for (const kind of wire.COMPANION_REACTIONS) assert.equal(wire.reactionShowsMark(kind), wire.reactionMark(kind) !== null);
  assert.equal(wire.reactionMotion('look'), 'turn', 'a look round is the turn it already had');
  assert.equal(wire.reactionMotion('invite'), 'hop');
  // A browser on older code reads a kind it does not know as none: a plain hop, no mark, nothing broken.
  assert.equal(wire.parseCompanionWire({ x: 0.5, m: 'stand', r: 3, k: 'some-newer-kind' }).k, null);
  const reactions = read('app/components/CompanionReactions.tsx');
  assert.match(reactions, /pokeCompanion\(kinds\.has\('invite'\) \? 'invite' : kinds\.has\('recommend'\) \? 'recommend' : 'reply'\);/, 'the feed says which kind arrived');
  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /if \(mark\.textContent !== text\) mark\.textContent = text;/, 'the mark is text, set as text');
  assert.doesNotMatch(strip, /innerHTML/, 'never markup');
});

ok('what a room is never told: a page turned, a look round at a new theme, a line of chat it already has', () => {
  for (const kind of ['flick', 'look', 'spoke', 'catch']) assert.equal(wire.reactionIsLocal(kind), true, kind);
  for (const kind of ['reply', 'message', 'online', 'wake', 'poke', 'wave', 'spin', 'cheer', 'slump', 'land', 'invite', 'recommend']) assert.equal(wire.reactionIsLocal(kind), false, kind);
  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /if \(reactionIsLocal\(kind\)\) return;\s*reactions \+= 1;/, 'played here, never counted for the room');
  assert.match(read('app/components/CompanionReactions.tsx'), /if \(Date\.now\(\) - since >= THEME_SETTLE_MS\) pokeCompanion\('look'\);/, 'a theme picked, not the saved one settling in as the page opens');
});

ok('a line of chat hops the companion of whoever said it, worked out in each browser; an old line read back in is nobody speaking', () => {
  const heard = [];
  const off = events.onCompanionSpoke((who) => heard.push(who));
  events.companionSpoke('u1', new Date().toISOString());
  events.companionSpoke('u2', new Date(Date.now() - 5 * 60_000).toISOString());
  events.companionSpoke('u3', 'not a time');
  off();
  events.companionSpoke('u4', new Date().toISOString());
  assert.deepEqual(heard, ['u1']);
  // (ROOMSYNC, 2026-11-16) A line that is a picture is held up instead of said ("have the companion raise it rather than
  // sending the text of the url"): the words still go to the bubble for every other line. Updated on purpose.
  assert.match(read('app/lib/watch/use-watch-room.ts'), /if \(current\.messages\.some\(\(message\) => message\.id === change\.message\.id\)\) return;\s*\{[^}]*const picture = chatPicture\(change\.message\.body, isGuestLabel\(change\.message\.authorLabel\)\);\s*if \(picture !== null\) companionHolds\(change\.message\.authorId, change\.message\.createdAt, picture\);\s*else companionSpoke\(change\.message\.authorId, change\.message\.createdAt, change\.message\.body\);/, 'one line, after a line already held is dropped; with its words, for the bubble (2026-11-15, SPEC-character-speech.md phase 3, asked for by PROFILE), unless it is a picture, which is held up');
  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /if \(who === company\.current\.userId\) react\('spoke'\);/, 'yours hops when you speak');
  assert.match(strip, /if \(who !== owner\.current\) return;\s*if \(!still\) act = \{ motion: 'hop', tick: 0 \};\s*markTimer = showMark\(mark, markTimer, '\.\.\.'\);/, "and theirs when they do, with nothing sent");
});

ok('hellos: it waves at a companion new to the room (not at every sync), and climbs on its climbing frames', () => {
  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /const fresh = \[\.\.\.present\]\.filter\(\(key\) => !greeted\.has\(key\)\);/, 'only somebody it has not waved at');
  assert.match(strip, /for \(const key of greeted\) if \(!present\.has\(key\)\) greeted\.delete\(key\);/, 'one that left is waved at again when it comes back');
  assert.match(strip, /else if \(now - lastGreet >= GREET_QUIET_MS\) \{\s*for \(const key of fresh\) greeted\.add\(key\);\s*greetedKeys = keys;\s*lastGreet = now;\s*react\('wave'\);/, 'not more than once every few seconds, and one arriving in that quiet is waved at once it is up');
  assert.match(strip, /if \(brain\.mood === 'dance' && \(trackNow !== dancedTrack \|\| now >= danceUntil\)\) \{\s*dance = pickDance\(dance\);/, 'a new track is always a different dance, even after the music stopped between two tracks');
  assert.match(strip, /play\(y < floor\.y \? 'climb' : 'walk'\);/, 'off its strip it climbs; along it, it walks');
  assert.match(strip, /if \(floor\.ledge && !wasOnLedge\) x = Math\.round\(span\.left \+ Math\.random\(\) \* \(span\.right - span\.left\)\);/, "up onto a room's window it lands somewhere along the edge, not all on one corner");
  assert.match(read('app/components/ProfileRoom.tsx'), /hello=\{visit\.out && visit\.inRoom\}/, "the room's own character is told a companion has arrived");
  assert.match(read('app/components/ProfileCharacter.tsx'), /if \(!hello \|\| reduced\) return;\s*const timer = setTimeout\(\(\) => setState\(\(current\) => greet\(current\)\), HELLO_BACK_MS\);/, 'and waves back a moment later, not under reduced motion');
});


/* --- Luke's list, 2026-11-14: K1 a double press picks it up, K2 a catch, K3 a start at being lifted ------------- */

ok('K1: a second press soon after the first picks it up to follow the pointer; the next press, Escape or the window going puts it down', () => {
  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /if \(at - lastTap <= DOUBLE_MS && place !== null\) \{/, 'two presses close together');
  assert.match(strip, /carried: true \};\s*liftOff\(\);\s*return;/, 'it is picked up, carried with nothing held down');
  assert.match(strip, /pokes = Math\.max\(0, pokes - 1\);/, "the first press's poke is given back");
  // (2026-11-14: it also keeps the pointer's last moves now, `trace`, so a put-down on the move is a throw.)
  assert.match(strip, /if \(grab\.carried\) \{\s*grab\.px = event\.clientX;\s*grab\.py = event\.clientY;\s*trace\(grab, event\);\s*followHand\(\);\s*return;\s*\}/, 'it follows the pointer, whichever pointer (placed at once since 2026-11-16)');
  assert.match(strip, /if \(grab === null \|\| grab\.carried \|\| event\.pointerId !== grab\.id\) return;/, 'letting a key go does not drop it');
  assert.match(strip, /const onPutDown = \(event: PointerEvent\) => \{\s*if \(grab === null \|\| !grab\.carried \|\| event\.button !== 0\) return;/, 'the next press puts it down');
  assert.match(strip, /window\.addEventListener\('pointerdown', onPutDown/, 'heard anywhere on the window');
  assert.match(strip, /window\.removeEventListener\('pointerdown', onPutDown\);/, 'and no longer heard once it is gone');
  assert.match(strip, /if \(event\.key === 'Escape' && grab !== null && grab\.carried\) letGo\(0\);/, 'Escape puts it down');
  assert.match(strip, /if \(grab !== null && grab\.moved\) letGo\(0\);/, 'and so does the window losing the pointer');
  assert.match(strip, /if \(still \|\| !canGrab\(\)\) \{\s*if \(phase === 'strip'\) poke\(\);\s*return;/, 'nothing is picked up under reduced motion: a press there never becomes a carry');
  assert.match(strip, /Math\.hypot\(event\.clientX - grab\.startX, event\.clientY - grab\.startY\) < GRAB_SLOP/, 'and press-and-drag still picks it up, as before');
});

ok('K3: lifted, it starts and wriggles once, with a !, and then hangs', () => {
  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /if \(lifting >= 0 && lifting < actLength\(look, 'lifted'\)\) \{\s*motion = 'lifted';\s*motionTick = lifting;\s*lifting \+= 1;\s*\} else \{\s*lifting = -1;\s*play\('dangle'\);/, 'its start at being lifted plays through once, then the dangle');
  assert.match(strip, /lifting = still \? -1 : 0;\s*[^\n]*\n\s*markTimer = showMark\(mark, markTimer, '!'\);/, 'from the moment it is lifted, by a drag or a double press, with a ! over its head');
  assert.match(strip, /place\.style\.pointerEvents = '';\s*place\.style\.cursor = 'grabbing';/, 'in the hand it takes presses itself again');
  assert.match(strip, /window\.removeEventListener\('pointerdown', onPutDown\);\s*[^\n]*\n\s*if \(place !== null\) \{\s*place\.style\.cursor = '';\s*place\.style\.pointerEvents = '';/, 'and nothing of the carry is left on it when its loop restarts');
});

ok("K2: handed something, a person's character catches it, wherever it is drawn on this screen; nothing is sent", () => {
  const heard = [];
  const off = events.onCompanionCatch((who) => heard.push(who));
  events.companionCatches('u7');
  off();
  events.companionCatches('u8');
  assert.deepEqual(heard, ['u7']);
  assert.equal(wire.reactionMotion('catch'), 'catch');
  assert.equal(wire.reactionMark('catch'), null);
  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /if \(who === company\.current\.userId && phase === 'strip'\) react\('catch'\);/, 'your own companion');
  assert.match(strip, /if \(who === owner\.current && !still\) act = \{ motion: 'catch', tick: 0 \};/, "somebody else's in a room you share");
  assert.match(strip, /data-companion-of=\{ownerId \?\? undefined\}/, 'a companion on the strip says whose it is');
  const walkerSource = read('app/components/ProfileCharacter.tsx');
  assert.match(walkerSource, /return onCompanionCatch\(\(who\) => \{\s*if \(who === person\) setState\(\(current\) => catchIt\(current\)\);\s*\}\);/, "their character in a profile's ROOM");
  assert.match(walkerSource, /data-character-of=\{person\}/, 'which says whose it is too');
  // Updated on purpose (SPEC-character-speech.md, 2026-11-14): commenters' characters visit the room now, and each of
  // them says whose it is too, so three figures are drawn with a person where there were two.
  assert.equal((read('app/components/ProfileRoom.tsx').match(/person=\{/g) ?? []).length, 3, "the room's own character, each visiting commenter's, and your visiting companion");
  const bus = read('app/lib/companion/events.ts');
  assert.doesNotMatch(bus, /fetch\(|supabase|sayCompanion/, 'the bus sends nothing anywhere');
});

/* --- thrown (Luke, 2026-11-14: "retain momentum and splat against the edge of the screen and obey the principles of
       animation such as squash and stretch and wind up and smearing") ------------------------------------------- */

/** A screen 1440 wide for a figure 80 wide and 76 tall, its floor at 800. */
const ARENA = { left: 0, right: 1360, ceiling: 76, floor: 800 };
const BOX = { w: 80, h: 76 };

/** A whole throw, frame by frame, until it is down (or 400 frames, which no throw should take). */
function flight(start, arena = ARENA) {
  const frames = [start];
  while (frames[frames.length - 1].stage !== 'landed' && frames.length < 400) frames.push(throws.throwStep(frames[frames.length - 1], arena));
  return frames;
}

ok('a let-go reads the speed the pointer had: on the move a throw, at rest or slowly a put-down', () => {
  // 30 px every 10 ms to the right and 10 up: 300 px a frame, held to the most a throw may be.
  const fast = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 100 + i * 30, y: 500 - i * 10, t: 1000 + i * 10 }));
  const hard = throws.releaseVelocity(fast, 1052);
  assert.ok(Math.abs(Math.hypot(hard.vx, hard.vy) - throws.THROW_MAX) <= 1, `held to the fastest a throw may be (${hard.vx}, ${hard.vy})`);
  assert.ok(hard.vx > 0 && hard.vy < 0, 'and in the way the pointer was going');
  // 4 px every 10 ms: 40 px a frame, kept as it is.
  const steady = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 100 + i * 4, y: 500, t: 1000 + i * 10 }));
  assert.deepEqual(throws.releaseVelocity(steady, 1052), { vx: 40, vy: 0 });
  assert.equal(throws.isThrow(40, 0), true);
  // The same moves, then the pointer held still a while before letting go: nothing.
  assert.deepEqual(throws.releaseVelocity(steady, 1050 + throws.SAMPLE_FRESH_MS + 1), { vx: 0, vy: 0 }, 'it stopped first: no throw');
  assert.deepEqual(throws.releaseVelocity([], 1000), { vx: 0, vy: 0 });
  assert.deepEqual(throws.releaseVelocity([{ x: 5, y: 5, t: 990 }], 1000), { vx: 0, vy: 0 }, 'one move is no speed');
  // Two moves in the same instant (a burst): judged over a screen frame at least, never divided by nothing.
  const burst = throws.releaseVelocity([{ x: 0, y: 0, t: 1000 }, { x: 8, y: 0, t: 1000 }], 1001);
  assert.deepEqual(burst, { vx: 50, vy: 0 });
  // A slow carry let go is a put-down.
  assert.equal(throws.isThrow(throws.THROW_MIN - 1, 0), false);
  assert.equal(throws.isThrow(0, -throws.THROW_MIN), true, 'straight up counts too');
});

ok('thrown, it winds up for a beat, then keeps its speed: an arc under gravity, slowed by the air, in whole pixels, landing on its floor', () => {
  const start = throws.startThrow(200, 600, 40, -80);
  assert.equal(start.stage, 'wind');
  const frames = flight(start);
  // The wind-up: held where it was let go.
  const wound = frames.filter((frame) => frame.stage === 'wind');
  assert.equal(wound.length, throws.WIND_TICKS, 'a beat of wind-up before it goes');
  assert.ok(wound.every((frame) => frame.x === 200 && frame.y === 600), 'held where it was let go');
  const air = frames.filter((frame) => frame.stage === 'fly');
  // Momentum: its first frame in the air is the pointer's speed, less the air and the pull of the ground.
  assert.equal(air[0].x, Math.round(200 + 40 * throws.DRAG));
  assert.equal(air[0].y, Math.round(600 + (-80 * throws.DRAG + throws.GRAVITY)));
  // An arc: up, over the top, and down.
  const top = Math.min(...air.map((frame) => frame.y));
  const at = air.findIndex((frame) => frame.y === top);
  assert.ok(top < 600 - 150, `it rose (${600 - top}px)`);
  assert.ok(at > 2 && at < air.length - 2, 'and came down again');
  for (let i = 1; i < at; i += 1) assert.ok(air[i].vy > air[i - 1].vy, 'slowing on the way up');
  // The air slows it sideways, a little each frame.
  assert.ok(air[5].vx < air[0].vx && air[5].vx > 0);
  assert.ok(Math.abs(air[1].vx / air[0].vx - throws.DRAG) < 1e-9);
  for (const frame of frames) {
    assert.ok(Number.isInteger(frame.x) && Number.isInteger(frame.y), 'whole pixels: stepped');
    assert.ok(frame.x >= ARENA.left && frame.x <= ARENA.right && frame.y >= ARENA.ceiling && frame.y <= ARENA.floor, `never off the screen (${frame.x}, ${frame.y})`);
  }
  const end = frames[frames.length - 1];
  assert.equal(end.stage, 'landed');
  assert.equal(end.y, ARENA.floor, 'on its floor, not through it');
  assert.ok(end.x > 200, 'further along than where it was let go');
  assert.equal(end.splatted, false);
  assert.equal(throws.throwStep(end, ARENA), end, 'down is down');
});

ok('hard into a side or the top of the screen it splats: stuck flat for a beat, slipping, then it peels off and drops; softly, it bounces off', () => {
  // Hard to the right from near the right side.
  const frames = flight(throws.startThrow(1200, 400, 120, -10));
  const hit = frames.find((frame) => frame.stage === 'stuck');
  assert.ok(hit, 'it splatted');
  assert.equal(hit.edge, 'right');
  assert.equal(hit.x, ARENA.right, 'on the glass');
  assert.ok(hit.impact >= throws.SPLAT_SPEED);
  assert.equal(hit.vx, 0);
  assert.equal(hit.vy, 0);
  const stuck = frames.filter((frame) => frame.stage === 'stuck');
  assert.equal(stuck.length, throws.stuckTicks(hit.impact), 'stuck for its beat');
  assert.ok(stuck.length >= throws.STUCK_TICKS[0] && stuck.length <= throws.STUCK_TICKS[1]);
  assert.ok(stuck.every((frame) => frame.x === ARENA.right), 'and it does not leave the glass');
  assert.equal(stuck[1].y, stuck[0].y, 'held fast at first');
  assert.ok(stuck[stuck.length - 1].y > stuck[0].y, 'then slipping down it');
  const peel = frames.filter((frame) => frame.stage === 'peel');
  assert.equal(peel.length, throws.PEEL_TICKS, 'then it peels');
  const after = frames.slice(frames.indexOf(peel[peel.length - 1]) + 1);
  assert.equal(after[0].stage, 'fly');
  assert.ok(after[0].vx < 0, 'pushed off, away from the side it was on');
  const end = frames[frames.length - 1];
  assert.equal(end.stage, 'landed');
  assert.equal(end.y, ARENA.floor);
  assert.equal(end.splatted, true, 'and it lands dizzy');
  assert.ok(frames.filter((frame) => frame.stage === 'stuck' && frame.age === 0).length === 1, 'one splat a throw: it has not the speed for another');
  // Harder sticks longer.
  assert.ok(throws.stuckTicks(throws.THROW_MAX) > throws.stuckTicks(throws.SPLAT_SPEED));
  assert.equal(throws.stuckTicks(throws.SPLAT_SPEED), throws.STUCK_TICKS[0]);
  assert.equal(throws.stuckTicks(9999), throws.STUCK_TICKS[1]);

  // The left side, and the top.
  const left = flight(throws.startThrow(150, 400, -150, 0)).find((frame) => frame.stage === 'stuck');
  assert.equal(left.edge, 'left');
  assert.equal(left.x, ARENA.left);
  const up = flight(throws.startThrow(600, 300, 0, -160));
  const ceiling = up.find((frame) => frame.stage === 'stuck');
  assert.equal(ceiling.edge, 'top');
  assert.equal(ceiling.y, ARENA.ceiling, 'its head at the top of the screen');
  assert.ok(up.filter((frame) => frame.stage === 'stuck').every((frame) => frame.y === ARENA.ceiling), 'it hangs there: no slipping along the top');
  assert.equal(up[up.length - 1].stage, 'landed');

  // The line between a splat and a bounce is the speed into the glass.
  const just = (speed) => throws.throwStep({ ...throws.startThrow(ARENA.right - 10, 400, speed / throws.DRAG, 0), stage: 'fly' }, ARENA);
  assert.equal(just(throws.SPLAT_SPEED + 0.5).stage, 'stuck', 'just over the speed: a splat');
  const soft = just(throws.SPLAT_SPEED - 1);
  assert.equal(soft.stage, 'fly', 'a hair under: a bounce');
  assert.equal(soft.edge, 'right');
  assert.ok(Math.abs(soft.vx + (throws.SPLAT_SPEED - 1) * throws.WALL_BOUNCE) < 1e-9, 'back the way it came with a share of its speed');
  assert.equal(soft.splatted, false);
  assert.equal(soft.x, ARENA.right, 'the frame of the bounce is on the glass');
  // Fast along the glass is not fast into it: sliding up a side at speed is no splat.
  const along = throws.throwStep({ ...throws.startThrow(ARENA.right - 5, 600, 20, -150), stage: 'fly' }, ARENA);
  assert.equal(along.stage, 'fly');
  // A soft bump on the top comes back down.
  const bump = throws.throwStep({ ...throws.startThrow(600, ARENA.ceiling + 10, 0, -40), stage: 'fly' }, ARENA);
  assert.equal(bump.edge, 'top');
  assert.ok(bump.vy > 0);
});

ok('it bounces on its floor, lower each time, and comes to rest; too slow to bounce it lands; coming in low it skids', () => {
  // Thrown gently sideways from high up: it is the fall that bounces it.
  const frames = flight(throws.startThrow(400, 200, 20, 0));
  const bounces = frames.filter((frame) => frame.stage === 'fly' && frame.edge === 'floor' && frame.vy < 0);
  assert.ok(bounces.length >= 1, 'it bounced');
  assert.equal(bounces[0].y, ARENA.floor, 'the frame of the bounce is on the floor');
  assert.ok(Math.abs(bounces[0].vy + bounces[0].impact * throws.FLOOR_BOUNCE) < 1e-9, 'up again with a share of what it came down with');
  for (let i = 1; i < bounces.length; i += 1) assert.ok(bounces[i].impact < bounces[i - 1].impact, 'each bounce lower than the last');
  const end = frames[frames.length - 1];
  assert.equal(end.stage, 'landed');
  assert.equal(end.bounces, bounces.length);
  assert.ok(end.impact < throws.BOUNCE_MIN, 'it comes to rest only when it is too slow to bounce');
  assert.ok(frames.length < 80, `and does not bounce for ever (${frames.length} frames)`);
  // The line between a bounce and a landing.
  const drop = (speed) => throws.throwStep({ ...throws.startThrow(400, ARENA.floor - 2, 0, (speed - throws.GRAVITY) / throws.DRAG), stage: 'fly' }, ARENA);
  assert.equal(drop(throws.BOUNCE_MIN + 0.5).stage, 'fly');
  assert.ok(drop(throws.BOUNCE_MIN + 0.5).vy < 0);
  assert.equal(drop(throws.BOUNCE_MIN - 1).stage, 'landed');
  // Let go along the floor: a skid, slower each frame, then down. Never through the floor, never bouncing.
  const skid = flight(throws.startThrow(300, ARENA.floor, 50, 5));
  const slide = skid.filter((frame) => frame.stage === 'fly');
  assert.ok(slide.length >= 2, 'it slid');
  assert.ok(slide.every((frame) => frame.y === ARENA.floor), 'along its floor');
  for (let i = 1; i < slide.length; i += 1) assert.ok(Math.abs(slide[i].vx) < Math.abs(slide[i - 1].vx), 'losing speed');
  assert.ok(skid[skid.length - 1].x > 300 + 40 && skid[skid.length - 1].x < 300 + 200, `a short way (${skid[skid.length - 1].x - 300}px)`);
  assert.equal(skid[skid.length - 1].bounces, 0);
  // A skid fast enough into a side still splats.
  assert.ok(flight(throws.startThrow(ARENA.right - 30, ARENA.floor, 170, 0)).some((frame) => frame.stage === 'stuck' && frame.edge === 'right'));
  // A floor that rose over it (the music bar unfolding mid-throw): on it, not under it.
  const under = throws.throwStep({ ...throws.startThrow(400, 900, 0, 0), stage: 'fly' }, ARENA);
  assert.equal(under.y, ARENA.floor);
  // A floor at the very top of the screen (on a room's window with no room over it): thrown up, it is never put under it.
  const tight = { ...ARENA, floor: 70 };
  for (const frame of flight(throws.startThrow(600, 70, 30, -120), tight)) assert.ok(frame.y <= tight.floor, `never under a floor at the top (${frame.y})`);
});

ok('down on something it cannot stand on, it hops off to where it can', () => {
  // The folded player takes the left of the strip: it may stand from 320 on.
  const arena = { ...ARENA, spans: [{ left: 320, right: 1360 }] };
  const frames = flight(throws.startThrow(100, 500, 0, 0), arena);
  const end = frames[frames.length - 1];
  assert.equal(end.stage, 'landed');
  assert.ok(end.x >= 320 - throws.STEP_OVER, `it ends where it can stand, or a step from it (${end.x})`);
  const hop = frames.find((frame) => frame.edge === 'floor' && frame.vx > 0);
  assert.ok(hop && hop.vy <= -throws.HOP_OFF_UP, 'a hop, up and toward the free stretch');
  assert.ok(end.bounces <= throws.HOP_OFF_MOST + 2, 'in a few hops');
  // On a free stretch nothing pushes it sideways.
  const free = flight(throws.startThrow(700, 500, 0, 0), arena);
  assert.equal(free[free.length - 1].x, 700);
  // Nowhere at all to stand: it lands where it is rather than hopping for ever.
  const none = flight(throws.startThrow(700, 500, 0, 0), { ...ARENA, spans: [] });
  assert.equal(none[none.length - 1].stage, 'landed');
});

ok('squash and stretch keep as much of it as there was: pressed short it spreads, drawn out it thins', () => {
  // The harder the hit, the flatter, down to the flattest and no further; no hit, no squash.
  assert.equal(throws.squashFor(0), 1);
  let last = 1;
  for (let impact = 0; impact <= 300; impact += 5) {
    const squash = throws.squashFor(impact);
    assert.ok(squash <= last && squash >= throws.SQUASH_MIN && squash <= 1, `squash ${squash} at ${impact}`);
    last = squash;
  }
  assert.equal(throws.squashFor(300), throws.SQUASH_MIN);
  assert.ok(throws.squashFor(throws.SPLAT_SPEED) < 0.7, 'a hit at splat speed is plainly flat');
  // The faster, the longer, up to the longest; slow, not at all.
  assert.equal(throws.stretchFor(0), 1);
  assert.equal(throws.stretchFor(throws.THROW_MIN), 1);
  assert.ok(throws.stretchFor(100) > 1.2);
  assert.equal(throws.stretchFor(9999), throws.STRETCH_MAX);
  // Volume: along x across x across (it has depth too) stays 1, pressed or drawn out.
  for (const along of [0.4, 0.5, 0.62, 0.9, 1, 1.25, 1.5]) {
    const across = throws.acrossFor(along);
    assert.ok(Math.abs(along * across * across - 1) < 1e-9, `volume kept at ${along}`);
    assert.ok(along < 1 ? across > 1 : along > 1 ? across < 1 : across === 1, 'shorter is wider, longer is thinner');
  }
  // Pressed against each edge: short the way it hit, spread the other way, and the side on the glass does not move.
  const flat = throws.squashLook('floor', 0.5, BOX);
  assert.equal(flat.d, 0.5);
  assert.ok(Math.abs(flat.a - Math.SQRT2) < 1e-9);
  assert.equal(flat.dy, 19, 'half its height shorter about its middle, moved down a quarter: feet where they were');
  assert.equal(flat.dx, 0);
  const wall = throws.squashLook('left', 0.5, BOX);
  assert.equal(wall.a, 0.5);
  assert.ok(Math.abs(wall.d - Math.SQRT2) < 1e-9);
  assert.equal(wall.dx, -20, 'its left side stays on the glass');
  assert.equal(throws.squashLook('right', 0.5, BOX).dx, 20);
  assert.equal(throws.squashLook('top', 0.5, BOX).dy, -19);
  // Its picture stops short of its box (empty margin): it is the picture that stays on the glass.
  assert.equal(throws.squashLook('left', 0.5, { ...BOX, left: 10 }).dx, -15);
  assert.equal(throws.squashLook('top', 0.5, { ...BOX, top: 8 }).dy, -15);
  // Drawn out along its path, whichever way that is: the stretch is along the line it travels, the thinning across it.
  for (const [vx, vy] of [[100, 0], [0, -100], [60, 80], [-70, 70]]) {
    const along = 1.4;
    const m = throws.stretchAlong(vx, vy, along);
    const speed = Math.hypot(vx, vy);
    const [ux, uy] = [vx / speed, vy / speed];
    // What the matrix does to a step along the path, and to one across it.
    const on = [m.a * ux + m.c * uy, m.b * ux + m.d * uy];
    const off = [m.a * -uy + m.c * ux, m.b * -uy + m.d * ux];
    assert.ok(Math.abs(Math.hypot(...on) - along) < 1e-9, `drawn out along (${vx}, ${vy})`);
    assert.ok(Math.abs(Math.hypot(...off) - throws.acrossFor(along)) < 1e-9, 'thinned across it');
    assert.ok(Math.abs(m.b - m.c) < 1e-12, 'never turned: it stays upright');
  }
  assert.deepEqual(throws.stretchAlong(0, 0, 1.4), { a: 1, b: 0, c: 0, d: 1 }, 'going nowhere, it is itself');
});

ok('the look of a throw, frame by frame: pulled back to wind up, drawn out with a smear in the air, flat on a hit, springing back when it lands', () => {
  // The wind-up: pulled back against the throw, further each frame, and pressed short along it.
  const start = throws.startThrow(200, 600, 100, 0);
  const wind0 = throws.throwLook(start, BOX);
  const wind1 = throws.throwLook(throws.throwStep(start, ARENA), BOX);
  assert.ok(wind0.dx < 0 && wind1.dx < wind0.dx, `pulled back, away from where it is going (${wind0.dx}, ${wind1.dx})`);
  assert.equal(wind0.dy, 0);
  assert.ok(wind0.a < 1 && wind1.a < wind0.a, 'pressed short along the throw');
  assert.ok(wind0.d > 1, 'and spread across it');
  assert.deepEqual(wind0.ghosts, []);
  const up = throws.throwLook(throws.startThrow(200, 600, 0, -100), BOX);
  assert.ok(up.dy > 0 && up.dx === 0, 'thrown up, it crouches down first');
  // In the air, fast: drawn out along its path, two copies of itself back along the line to where it was.
  const frames = flight(start);
  const fast = frames.find((frame) => frame.stage === 'fly');
  const air = throws.throwLook(fast, BOX);
  assert.ok(air.a > 1.2 && air.d < 1, `drawn out the way it goes (${air.a.toFixed(2)} by ${air.d.toFixed(2)})`);
  assert.equal(air.ghosts.length, 2, 'a smear of two copies');
  const moved = fast.x - fast.fromX;
  assert.ok(moved > 0);
  assert.ok(air.ghosts[0].dx < 0 && air.ghosts[1].dx < air.ghosts[0].dx && air.ghosts[1].dx > -moved, 'behind it, between where it was and where it is');
  assert.ok(air.ghosts.every((ghost) => Number.isInteger(ghost.dx) && Number.isInteger(ghost.dy)), 'whole pixels');
  // Slow in the air: no smear.
  const slow = throws.throwLook({ ...fast, vx: throws.SMEAR_SPEED - 1, vy: 0 }, BOX);
  assert.deepEqual(slow.ghosts, []);
  assert.equal(throws.throwLook({ ...fast, vx: throws.SMEAR_SPEED, vy: 0 }, BOX).ghosts.length, 2);
  // The frame of a bounce: flat on the floor, feet where they were.
  const fall = flight(throws.startThrow(400, 200, 20, 0));
  const bounce = fall.find((frame) => frame.edge === 'floor' && frame.vy < 0);
  const pressed = throws.throwLook(bounce, BOX);
  assert.equal(pressed.d, throws.squashFor(bounce.impact));
  assert.ok(pressed.d < 0.75 && pressed.a > 1, `squashed on landing (${pressed.d} tall, ${pressed.a.toFixed(2)} wide)`);
  assert.ok(pressed.dy > 0);
  assert.deepEqual(pressed.ghosts, []);
  // A splat: flattest on the hit, giving a little, held, pressed again just before it peels; then back toward its shape.
  const splat = flight(throws.startThrow(1200, 400, 120, -10));
  const stuck = splat.filter((frame) => frame.stage === 'stuck').map((frame) => throws.throwLook(frame, BOX));
  assert.ok(stuck[0].a <= 0.45, `flat on the glass (${stuck[0].a})`);
  assert.ok(stuck[1].a > stuck[0].a, 'it gives');
  assert.ok(stuck.every((look) => look.a <= 0.6 && look.d > 1.25 && look.dx > 0), 'flat against the right side all the while');
  assert.ok(stuck[stuck.length - 1].a < stuck[stuck.length - 2].a, 'pressed again before it peels: a wind-up of its own');
  const peel = splat.filter((frame) => frame.stage === 'peel').map((frame) => throws.throwLook(frame, BOX));
  for (let i = 1; i < peel.length; i += 1) assert.ok(peel[i].a > peel[i - 1].a, 'coming back to its shape as it peels');
  assert.ok(peel[peel.length - 1].a < 1);
  // Off the top it hangs and is drawn out downward before it drops.
  const hang = flight(throws.startThrow(600, 300, 0, -160)).filter((frame) => frame.stage === 'peel').map((frame) => throws.throwLook(frame, BOX));
  assert.ok(hang[hang.length - 1].d > 1 && hang[hang.length - 1].dy > 0, 'drawn out from the top');
  // Settling: the landing's squash, a spring back past its shape, a smaller dip, and done. Nothing after a touch-down too soft to squash.
  const settle = throws.settleFrames(80);
  assert.equal(settle[0], throws.squashFor(80));
  assert.ok(settle[1] > 1 && settle[2] < 1 && settle[2] > settle[0], `squash, spring, dip (${settle.join(' ')})`);
  assert.ok(1 - settle[2] < settle[1] - 1, 'each smaller than the last');
  assert.deepEqual(throws.settleFrames(0), []);
  const landed = splat[splat.length - 1];
  assert.equal(throws.throwLook(landed, BOX).d, throws.squashFor(landed.impact));
});

ok('the throw on the page: only on a moving let-go, never under reduced motion, its own frames and nothing drawn, and a room hears only where it ended', () => {
  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /if \(still \|\| !isThrow\(toss\.vx, toss\.vy\)\) \{\s*letGo\(throwOf\(toss\.vx\)\);\s*return;/, 'slow, or under reduced motion, it is put down as before');
  // (Let go below its floor it is not thrown either: it climbs back up to it since 2026-11-16, held in the section below.)
  assert.match(strip, /fling\(releaseVelocity\(released\.trail, performance\.now\(\)\)\);/, 'a drag let go reads the pointer\'s speed');
  assert.match(strip, /fling\(releaseVelocity\(grab\.trail, performance\.now\(\)\)\);/, 'and so does a put-down after a double press');
  assert.match(strip, /if \(event\.type !== 'pointerup'\) \{\s*letGo\(0\);/, 'a pointer taken away throws nothing');
  // The whole of the throw's frame loop: nothing in it speaks to the room.
  const from = strip.indexOf("if (phase === 'thrown' && thrown !== null) {");
  const to = strip.indexOf("if (phase === 'held' || phase === 'fall') {");
  assert.ok(from > 0 && to > from);
  const loop = strip.slice(from, to);
  assert.match(loop, /const arena = \{ left: -insets\.left, right: floor\.screen - size\.w \+ insets\.right, ceiling: size\.h - insets\.top, floor: floor\.y, spans: floor\.spans \};\s*thrown = throwStep\(thrown, arena\);/, 'the screen is its arena');
  assert.match(loop, /const ahead = throwStep\(thrown, arena\);\s*glideToward\(\{ x: thrown\.x, y: thrown\.y \}, \{ x: ahead\.x, y: ahead\.y \}, size\.h\);/, 'between frames it glides toward the next frame the same rules give (2026-11-16)');
  const flying = loop.slice(0, loop.indexOf('// Down:'));
  assert.doesNotMatch(flying, /say\(|sayCompanion|react\(/, 'in the air the room is told nothing');
  assert.match(loop, /react\(dizzy \? 'dizzy' : 'land'\);/, 'down, it is told once (a reaction says where it is)');
  assert.match(loop, /settle = settleFrames\(thrown\.impact\);/, 'and it settles');
  // The smear is its own strip again, hidden unless thrown, yours only; the squash is a plain 2D transform on hard pixels.
  assert.match(strip, /\{own\s*\? \(\['opacity-50', 'opacity-25'\] as const\)\.map/, 'two fainter copies, on your own companion only');
  assert.match(strip, /className=\{`pointer-events-none invisible absolute inset-0 -z-10 block \$\{faint\}`\}\s*style=\{\{\s*backgroundImage: `url\("\$\{look\.stripUrl\}"\)`,[\s\S]{0,300}?imageRendering: 'pixelated',\s*\}\}\s*data-companion-smear/, 'the smear is its own baked strip, hard-edged, behind it');
  assert.doesNotMatch(strip, /<svg|<canvas|clip-path|border-radius|blur\(/, 'nothing is drawn, nothing is blurred');
  assert.doesNotMatch(strip, /transition/, 'no eased motion: the glide is a straight line between two frames of the rules');
  // Dizzy: a star, the reel, and old tabs in a room see a plain hop.
  assert.equal(wire.reactionMotion('dizzy'), 'dizzy');
  assert.equal(wire.reactionMark('dizzy'), '\u2736');
  assert.equal(wire.reactionIsLocal('dizzy'), false, 'the room sees it reel, where it ended up');
  assert.equal(wire.parseCompanionWire({ x: 0.5, m: 'stand', r: 3, k: 'dizzy' }).k, 'dizzy');
  const motions = read('app/lib/character/motion.ts');
  assert.match(motions, /flung: 'idle',\s*splat: 'stand',\s*dizzy: 'idle',/, 'a strip baked before the throw plays older motions in their place');
});

/* --- shoved by windows (Luke, 2026-11-16) --- */
const SHOVE_FIG = { left: 500, right: 564, top: 836, bottom: 900 };
const SHOVE_ARENA = { left: 0, right: 1536, ceiling: 64, floor: 900 };
const win = (left, top, w = 400, h = 300) => ({ left, top, right: left + w, bottom: top + h });

ok('a window that pops up over it knocks it out sideways, away from the window, and up', () => {
  const right = shoves.shoveFrom({ id: 'a', now: win(400, 700), before: undefined }, SHOVE_FIG, [0.5, 0.5]);
  assert.equal(right.kind, 'pop');
  assert.ok(right.vx < 0, "the window's middle is right of it: out to the left");
  assert.ok(right.vy < 0, 'and up');
  const off = shoves.shoveFrom({ id: 'a', now: win(800, 700), before: undefined }, SHOVE_FIG, [0.5, 0.5]);
  assert.equal(off, null, 'a window that appears somewhere else does nothing');
  const soft = shoves.shoveFrom({ id: 'a', now: win(300, 700), before: undefined }, SHOVE_FIG, [0.5, 0]);
  const hard = shoves.shoveFrom({ id: 'a', now: win(300, 700), before: undefined }, SHOVE_FIG, [0.5, 0.999]);
  assert.ok(Math.abs(hard.vx) > Math.abs(soft.vx) && hard.vy < soft.vy, 'the dice make some pops harder than others');
});

ok('a window dragged into it sends it the way the window went, ahead of it; a slow drag is a bump, a hard one splats it', () => {
  const push = shoves.shoveFrom({ id: 'a', now: win(140, 700), before: win(100, 700) }, SHOVE_FIG, [0.5, 0.5]);
  assert.equal(push.kind, 'push');
  assert.ok(push.vx > 40, 'faster than the window, so it flies off ahead of it');
  assert.ok(push.vy < 0, 'and up');
  const back = shoves.shoveFrom({ id: 'a', now: win(560, 700), before: win(600, 700) }, SHOVE_FIG, [0.5, 0.5]);
  assert.ok(back.vx < 0, 'dragged the other way, it goes the other way');
  assert.equal(shoves.shoveFrom({ id: 'a', now: win(302, 700), before: win(300, 700) }, SHOVE_FIG, [0.5, 0.5]), null, 'a window barely moving over it only leans');
  assert.equal(shoves.shoveFrom({ id: 'a', now: win(300, 700), before: win(300, 700) }, SHOVE_FIG, [0.5, 0.5]), null, 'a window that sits there does nothing');
  // A hard drag to the right, flown out with the throw's own rules: it reaches the right edge fast enough to splat.
  const hardPush = shoves.shoveFrom({ id: 'a', now: win(240, 700), before: win(150, 700) }, SHOVE_FIG, [0.5, 0.5]);
  let t = shoves.shoveThrow(1100, 900, hardPush, null);
  assert.equal(t.stage, 'fly', 'a hit has no wind-up: it is in the air at once');
  let splat = false;
  for (let i = 0; i < 40 && t.stage !== 'landed'; i += 1) {
    t = throws.throwStep(t, SHOVE_ARENA);
    if (t.stage === 'stuck' && t.edge === 'right') splat = true;
  }
  assert.ok(splat, 'flat against the right edge of the screen');
  assert.ok(t.splatted, 'and it lands dizzy');
  const slowPush = shoves.shoveFrom({ id: 'a', now: win(106, 700), before: win(100, 700) }, SHOVE_FIG, [0.5, 0.5]);
  assert.ok(Math.hypot(slowPush.vx, slowPush.vy) < throws.SPLAT_SPEED, 'a slow drag is only a bump');
  const huge = shoves.shoveFrom({ id: 'a', now: win(900, 700), before: win(100, 700) }, { ...SHOVE_FIG, left: 1000, right: 1064 }, [0.5, 0.5]);
  assert.ok(Math.hypot(huge.vx, huge.vy) <= throws.THROW_MAX + 1, 'never faster than a throw');
});

ok('a window brought down onto its head squashes it flat on its floor, and it squirts out sideways', () => {
  const squash = shoves.shoveFrom({ id: 'a', now: win(400, 560), before: win(400, 520) }, SHOVE_FIG, [0.5, 0.5]);
  assert.equal(squash.kind, 'squash');
  let t = shoves.shoveThrow(500, 900, squash, null);
  assert.equal(t.stage, 'stuck');
  assert.equal(t.edge, 'floor');
  const look = throws.throwLook(t, { w: 64, h: 64 });
  assert.ok(look.d < 0.5 && look.a > 1, 'flat and wide');
  let out = false;
  for (let i = 0; i < 40 && t.stage !== 'landed'; i += 1) {
    t = throws.throwStep(t, SHOVE_ARENA);
    if (t.stage === 'fly' && t.vy < 0 && t.vx !== 0) out = true;
  }
  assert.ok(out, 'it squirts out, up and sideways');
  assert.equal(t.stage, 'landed');
  assert.ok(t.splatted, 'dizzy after');
  const aloft = shoves.shoveThrow(500, 700, squash, shoves.shoveThrow(500, 700, { kind: 'pop', vx: 30, vy: -60 }, null));
  assert.equal(aloft.stage, 'fly', 'in the air, a window coming down swats it instead');
  assert.ok(aloft.vy > 0, 'down');
});

ok('it can be juggled, but the same window cannot hit it every frame, and nothing is a pop on the first look', () => {
  const first = shoves.shoveStep([{ id: 'a', box: win(300, 700) }], new Map([['a', win(300, 700)]]), new Map(), SHOVE_FIG, [0.5, 0.5]);
  assert.equal(first.shove, null, 'a window already there is not a pop');
  let step = shoves.shoveStep([{ id: 'a', box: win(140, 700) }], new Map([['a', win(100, 700)]]), new Map(), SHOVE_FIG, [0.5, 0.5]);
  assert.equal(step.shove.kind, 'push');
  assert.equal(step.cooling.get('a'), shoves.SHOVE_COOLDOWN);
  for (let i = 1; i < shoves.SHOVE_COOLDOWN; i += 1) {
    step = shoves.shoveStep([{ id: 'a', box: win(140 + 40 * i, 700) }], step.seen, step.cooling, SHOVE_FIG, [0.5, 0.5]);
    assert.equal(step.shove, null, `not frame ${i} after the hit, though the window still moves over it`);
  }
  step = shoves.shoveStep([{ id: 'a', box: win(400, 700) }], step.seen, step.cooling, SHOVE_FIG, [0.5, 0.5]);
  assert.ok(step.shove !== null, 'but again once it has cooled: a window can juggle it');
  const two = shoves.shoveStep([{ id: 'a', box: win(300, 700) }, { id: 'b', box: win(450, 700) }], new Map(), new Map(), SHOVE_FIG, [0.5, 0.5]);
  assert.ok(two.shove !== null && two.cooling.has('a') && !two.cooling.has('b'), 'one hit a frame');
  const t = shoves.shoveThrow(500, 700, { kind: 'push', vx: -50, vy: -30 }, { ...shoves.shoveThrow(500, 700, { kind: 'pop', vx: 30, vy: -60 }, null), splatted: true });
  assert.equal(t.vx, -50, 'batted the new way in the air');
  assert.equal(t.splatted, true, 'and still dizzy when it lands, if it splatted on the way');
});

ok('the wiring: the loop looks at the windows every frame, not under reduced motion, never the window it stands on', () => {
  const companion = read('app/components/Companion.tsx');
  assert.ok(companion.includes('const windows = still ? [] : measureWindows(floor.ledge);'));
  assert.ok(companion.includes('if (windowsSeen === null) windowsSeen = new Map'), 'the first look only learns where they are');
  assert.ok(companion.includes("(phase === 'strip' || phase === 'fall' || phase === 'thrown')"), 'on its strip, falling or in the air; never in the hand or climbing');
  const floor = read('app/lib/companion/floor.ts');
  assert.ok(floor.includes('if (element === standing || !shown(element)) continue;'), 'not the room window it stands on, nor a folded one');
  assert.ok(floor.includes(`'[data-dock-window], [data-floating-player="floating"]'`), 'every window, and the video while it floats');
});

// Luke's second list (2026-11-16): grabbed out of a profile's ROOM, climbing in, and framerate, tracking and smears.
const loose = require(path.join(OUT, 'companion', 'loose.js'));

ok('dragged: it leans back against the drag, is drawn out along it, and trails copies of itself only when fast', () => {
  assert.deepEqual(throws.dragLook(0, 0), throws.NO_LOOK, 'at rest it is itself');
  assert.deepEqual(throws.dragLook(0.5, 0.4), throws.NO_LOOK, 'a pointer barely moving is no drag');
  const right = throws.dragLook(20, 0);
  assert.ok(right.c < 0, `dragged right, its feet trail left (a shear, c ${right.c})`);
  assert.ok(right.a > 1, 'and it is drawn out along the drag');
  const left = throws.dragLook(-20, 0);
  assert.ok(left.c > 0, 'dragged left, its feet trail right');
  const wild = throws.dragLook(1000, 0);
  assert.ok(Math.abs(wild.c) <= throws.DRAG_LEAN_MAX * throws.STRETCH_MAX + 1e-9, 'the lean has a limit');
  assert.ok(wild.a <= throws.STRETCH_MAX + 1e-9, 'and so has the stretch');
  assert.equal(throws.dragLook(throws.DRAG_SMEAR_SPEED - 1, 0).ghosts.length, 0, 'slower than a smear, no copies');
  const fast = throws.dragLook(60, -20);
  assert.equal(fast.ghosts.length, 2, 'fast, two copies');
  for (const ghost of fast.ghosts) {
    assert.ok(ghost.dx < 0 && ghost.dy > 0, 'back along the way the pointer came');
    assert.ok(Number.isInteger(ghost.dx) && Number.isInteger(ghost.dy), 'in whole pixels');
  }
  assert.ok(Math.abs(fast.ghosts[1].dx) > Math.abs(fast.ghosts[0].dx), 'the fainter one further back');
  assert.equal(fast.dx, 0, 'it is not moved off the pointer');
  assert.equal(fast.dy, 0);
});

ok('in the air it glides between two frames of the rules: exact at each frame, whole pixels, never past the next', () => {
  const from = { x: 100, y: 400 };
  const to = { x: 160, y: 370 };
  assert.deepEqual(throws.glideAt(from, to, 0), from, 'on a frame it is where the rules have it');
  assert.deepEqual(throws.glideAt(from, to, 1), to, 'and at the next one');
  assert.deepEqual(throws.glideAt(from, to, 0.5), { x: 130, y: 385 }, 'halfway, on the straight line');
  assert.deepEqual(throws.glideAt(from, to, 3), to, 'a late frame never carries it past where the rules will have it (past a wall)');
  assert.deepEqual(throws.glideAt(from, to, -1), from);
  const odd = throws.glideAt(from, { x: 101, y: 401 }, 1 / 3);
  assert.ok(Number.isInteger(odd.x) && Number.isInteger(odd.y), 'whole pixels');
});

ok('out of its room: it walks along the floor to under its room, climbs up into it, and is home', () => {
  const ground = { y: 700, spans: [{ left: 0, right: 1200 }] };
  const home = { left: 300, right: 600, floor: 500 };
  let now = loose.startLoose(900, 700, 1);
  assert.equal(now.stage, 'walk');
  now = loose.looseStep(now, ground, home);
  assert.equal(now.x, 900 - loose.LOOSE_WALK, 'it walks toward its room, a walking step a frame');
  assert.equal(now.facing, -1, 'facing the way it goes');
  assert.equal(now.y, 700, 'along the floor');
  let frames = 0;
  while (now.stage === 'walk' && frames < 500) {
    now = loose.looseStep(now, ground, home);
    frames += 1;
  }
  assert.equal(now.stage, 'climb', 'under its room, it climbs');
  assert.equal(now.x, 600, 'at the nearest place in its room');
  assert.ok(now.y < 700 && now.y >= 700 - loose.LOOSE_CLIMB, 'a climbing step a frame, up');
  while (now.stage === 'climb' && frames < 1000) {
    const before = now.y;
    now = loose.looseStep(now, ground, home);
    assert.ok(before - now.y <= loose.LOOSE_CLIMB, 'never more than a climbing step');
    frames += 1;
  }
  assert.equal(now.stage, 'home', 'and it is home');
  assert.deepEqual([now.x, now.y], [600, 500], 'standing on its room floor');
  assert.equal(loose.looseStep(now, ground, home), now, 'home is home');
});

ok('out of its room: it never walks over what it steps around, and waits when its room is out of sight, then pops back', () => {
  // The folded player at 500 to 700: its room above that stretch is climbed into from the nearest free stretch.
  const ground = { y: 700, spans: [{ left: 0, right: 450 }, { left: 750, right: 1200 }] };
  const home = { left: 520, right: 680, floor: 500 };
  let now = loose.startLoose(1000, 700, 1);
  for (let frames = 0; frames < 500 && now.stage === 'walk'; frames += 1) now = loose.looseStep(now, ground, home);
  assert.equal(now.stage, 'climb', 'it walks to the end of its own stretch and climbs from there');
  assert.equal(now.x, 750 - loose.LOOSE_WALK, 'its first climbing step is from the end of its stretch, a step toward its room');
  assert.ok(now.y < 700, 'off the floor: it never walks over the folded player');
  // Its room scrolled away mid-climb: back down to the floor, and it waits.
  now = loose.looseStep(now, ground, null);
  assert.ok(now.y > home.floor, 'off the climb');
  for (let frames = 0; frames < 5; frames += 1) now = loose.looseStep(now, ground, null);
  assert.equal(now.stage, 'wait', 'down on the floor, waiting');
  assert.equal(now.y, 700);
  for (let frames = 0; frames < loose.LOST_TICKS; frames += 1) now = loose.looseStep(now, ground, null);
  assert.equal(now.stage, 'home', 'out of sight long enough, it pops back in');
  // Seen again before that: on its way.
  let back = loose.looseStep({ ...loose.startLoose(100, 700, 1), stage: 'wait', waited: 30 }, ground, { left: 200, right: 400, floor: 500 });
  assert.equal(back.stage, 'walk');
  assert.equal(back.waited, 0, 'the wait starts again from nothing');
});

ok('the wiring: in the hand it is placed on every move, smeared, and in the air it glides; walking stays stepped', () => {
  const strip = read('app/components/Companion.tsx');
  const onDrag = strip.slice(strip.indexOf('const onDrag = (event: PointerEvent) => {'), strip.indexOf('const onPutDown'));
  assert.equal((onDrag.match(/followHand\(\);/g) ?? []).length, 3, 'carried, dragged, and the move that picks it up: each places it at once');
  const follow = strip.slice(strip.indexOf('const followHand = () => {'), strip.indexOf('const onFigure'));
  assert.match(follow, /x = at\.x;\s*y = at\.y;/, 'where the pointer has it, now');
  assert.match(follow, /fx: dragLook\(pull\.vx, pull\.vy\)/, 'leaning back against the drag');
  assert.match(strip, /const ahead = fallNext\(next, floor, size\);\s*glideToward/, 'a drop glides too');
  // Walking stays stepped: the glide never runs on the strip.
  const glide = strip.slice(strip.indexOf('const glideLoop = () => {'), strip.indexOf('const glideToward'));
  assert.match(glide, /phase !== 'thrown' && phase !== 'fall'/);
  assert.match(strip, /if \(glideFrame !== 0\) cancelAnimationFrame\(glideFrame\);/, 'and is stopped when the companion goes');
  assert.match(strip, /place\.dataset\.x !== at\) place\.dataset\.x = at;/, "a frame's own place is written on the figure for the drives");
});

ok('the wiring: it climbs in, never floats: on a page, up to a floor that rises, and when let go below its floor', () => {
  const strip = read('app/components/Companion.tsx');
  assert.match(strip, /if \(first\) \{\s*y = floor\.y \+ size\.h;\s*phase = 'mount';/, 'its first frame on a page, it climbs up from behind the edge of its floor');
  assert.match(strip, /floor\.y < floorWas - 4\) \{\s*y = Math\.min\(floorWas, floor\.y \+ size\.h\);\s*phase = 'mount';/, 'a floor that rises under it is climbed, from just behind its edge');
  assert.match(strip, /floor\.y > floorWas \+ 4\) \{\s*fall = \{ x, y: floorWas/, 'one that drops away is fallen from');
  assert.match(strip, /if \(phase === 'mount'\) \{\s*\/\/[^\n]*\n\s*y = climbToward\(y, floor\.y\);\s*play\('climb'\);/, 'on its climbing frames, a climbing step a frame');
  assert.match(strip, /if \(!still && \(phase === 'strip' \|\| phase === 'mount'\)\) \{/, 'not under reduced motion');
  const fling = strip.slice(strip.indexOf('const fling = '), strip.indexOf('const trace = '));
  assert.match(fling, /if \(!still && y > floor\.y\) \{[\s\S]{0,200}phase = 'mount';/, 'let go below its floor, it climbs back up to it');
  assert.match(strip, /\(fall\?\.y \?\? y\) > floor\.y \+ 1\) \{[\s\S]{0,120}phase = 'mount';/, 'dropped below it too: never pulled up to it in one frame');
  assert.match(strip, /phase === 'thrown' \|\| phase === 'mount';/, 'it can be picked up while it climbs');
  // Somebody else's companion in the room climbs too.
  const other = strip.slice(strip.indexOf('function RoomFigure('));
  assert.match(other, /if \(feet === null\) feet = floor\.y \+ size\.h;/, "new to the room, theirs climbs up from behind the floor's edge");
  assert.match(other, /feet = up \? climbToward\(Math\.min\(feet, floor\.y \+ size\.h\), floor\.y\) : Math\.min\(floor\.y, feet \+ FALL_STEP\);/);
});

ok("the wiring: anybody can take a ROOM's character out, never under reduced motion, never your visiting companion", () => {
  const walker = read('app/components/ProfileCharacter.tsx');
  assert.match(walker, /if \(reduced \|\| who === 'visitor' \|\| event\.button !== 0 \|\| loose !== null\) return;/);
  assert.doesNotMatch(walker.slice(walker.indexOf('const takeOut'), walker.indexOf('const backIn')), /user|signedIn|viewerId/, 'nothing asks who is looking');
  assert.match(walker, /if \(dragged\.current\) \{\s*dragged\.current = false;\s*return;\s*\}/, 'the click that ends a drag is not a hello');
  assert.match(walker, /onPointerDown=\{takeOut\}/);
  // Its release lands on the page, not on the key, so no click clears the mark: a new press and coming back both do.
  assert.match(walker, /const takeOut = \(event: ReactPointerEvent<HTMLButtonElement>\) => \{[\s\S]{0,200}?dragged\.current = false;\s*if \(reduced/, 'a fresh press forgets an old drag');
  assert.match(walker, /setLoose\(null\);[\s\S]{0,200}?dragged\.current = false;/, 'and so does coming back');
  assert.match(walker, /setState\(\(current\) => greet\(\{ \.\.\.current, x: /, 'back in, it waves');
  const out = read('app/components/LooseCharacter.tsx');
  assert.match(out, /createPortal\(/, 'out of the room it is drawn over the page');
  assert.match(out, /pointer-events-none fixed inset-0 z-40 overflow-hidden/, 'under the music bar and every window, taking no presses but on itself');
  assert.match(out, /const room = roomFloor\(boxOf\(stage\), clipOf\(stage\), size, floor\.y\);\s*loose = looseStep\(/, 'its way home is the rule above');
  assert.match(out, /thrown = throwStep\(thrown, arena\);/, "thrown with the companion's own throw");
  assert.match(out, /if \(event\.buttons === 0 && event\.pointerType === 'mouse'\) \{\s*onUp\(/, 'let go before it was listening, it is let go, not stuck to the pointer');
  assert.match(out, /fx: dragLook\(pull\.vx, pull\.vy\)/, 'and dragged with its lean');
  assert.doesNotMatch(out, /<svg|<canvas|clip-path|border-radius|blur\(|transition|fetch\(|localStorage/, 'nothing drawn, nothing eased, nothing sent or saved');
});

ok('the voice key is a symbol: the note, struck through while off, with its name and tip in words', () => {
  const key = read('app/components/SpeechAudioKey.tsx');
  assert.match(key, /\[ <span className=\{on \? undefined : 'line-through'\}>♪<\/span> \]/);
  assert.doesNotMatch(key, /'♪ ON'|'\[ ♪ OFF \]'/, 'no words on it');
  assert.match(key, /aria-label="Character voices"/, 'a name for a screen reader');
  assert.match(key, /aria-pressed=\{on\}/, 'which says whether it is on');
  assert.match(key, /title=\{on \? 'Voices on: press to stop them' : 'Voices off: press to hear them talk'\}/, 'and a tip on hover');
});

console.log(`\n${passed} passed`);
