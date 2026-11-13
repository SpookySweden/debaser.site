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
  assert.deepEqual(wire.parseCompanionWire({ x: 7, m: 'walk', r: -3, k: 'boom', c: '' }), { x: 1, m: 'walk', r: 0, k: null, c: null });
  assert.deepEqual(wire.parseCompanionWire({ x: 0.25, m: 'dance', r: 4, k: 'message', c: 'strip/1' }), { x: 0.25, m: 'dance', r: 4, k: 'message', c: 'strip/1' });
  assert.equal(wire.reactionShowsMark('reply'), true);
  assert.equal(wire.reactionShowsMark('wake'), false);
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
