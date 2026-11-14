/*
 * The companion along the bottom of the site (SPEC-companion.md): its rules, without a browser.
 *   npx tsc app/lib/companion/brain.ts app/lib/companion/wire.ts app/lib/companion/choices.ts app/lib/companion/scene.ts app/lib/companion/ledge.ts app/lib/companion/floor.ts app/lib/watch/members-signature.ts --outDir Temp/companion-check --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
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
const scenes = require(path.join(OUT, 'companion', 'scene.js'));
const ledge = require(path.join(OUT, 'companion', 'ledge.js'));
const floors = require(path.join(OUT, 'companion', 'floor.js'));
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
  assert.match(strip, /Math\.min\(floor\.ledge \? window\.innerHeight : floor\.y, Math\.max\(size\.h, grab\.py \+ grab\.offY\)\)/, 'held, it stays on screen and above its own floor');
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
  assert.match(strip, /if \(kind === 'flick'\) \{[^}]*lastActivity = Date\.now\(\);\s*if \(looping === 'read' && !still\) act = \{ motion: 'flick', tick: 0 \};\s*return;\s*\}\s*reactions \+= 1;/, 'a page turned is played, counts as you being here, and is never counted for the room');
  assert.match(strip, /input:not\(\[type\]\), input\[type="text"\]/, 'typing is heard in text boxes');
  assert.doesNotMatch(strip.slice(strip.indexOf('const WRITING'), strip.indexOf('const TYPING_MS')), /password/, 'never a password box');
  assert.doesNotMatch(strip, /event\.key(?!\.length| === 'Backspace'| === 'Enter')/, 'it hears that a key was typed, never which');
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
  assert.match(dock, /top: live\.rect\.y \+ drop,/);
  assert.match(dock, /live\.rect\.h - drop\}px, calc\(100vh - var\(--music-top, 0px\) - \$\{live\.rect\.y \+ drop\}px - 0\.25rem\)\)` : live\.rect\.h - drop,/, 'shorter by the same, so its foot stays put');
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

console.log(`\n${passed} passed`);
