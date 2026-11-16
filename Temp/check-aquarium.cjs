/**
 * The AQUARIUM background (Luke, 2026-11-15): the Windows 98 Underwater sea behind the site window, chosen in PREFERENCES >
 * BACKGROUND, the default for a browser that has chosen nothing - and, since SPEC-aquarium-settings.md, a sea whose every knob
 * is in the AQUARIUM window. (Until that SPEC the fish were CSS crossings and this check held the stylesheet's keyframes; the
 * fish are a simulation now, so those lines went and the simulation's are here instead.)
 *
 * Held here:
 *   1. the background choice: AQUARIUM by default, TILE beside it, remembered, read back, written before the first paint;
 *   2. the settings: junk, old and missing values read back safely; RESET is the look that shipped; PARTY and the presets stay in range;
 *   3. the simulation, on its defaults, is the screensaver: each fish alone, at its recorded speed, leaving and coming back;
 *   4. the simulation's knobs do what they say: shoals stay and gather, fish flee the pointer, eat food, sink under gravity,
 *      line up in a parade; nothing ever goes missing or NaN with everything on;
 *   5. saving: this browser's copy, and an account's copy (the mock one) carrying settings and background to a fresh browser;
 *   6. the server draws no aquarium; the window lists every knob; the shell, PREFERENCES and the sea key open it;
 *   7. every picture is on disk at the size the code lays it out at, and the stylesheet stands aside as it should.
 *
 * Compiled fresh on every run:
 *   npx tsc app/components/Aquarium.tsx app/components/BackdropSettingsWindow.tsx app/lib/ui/backdrop-slot.ts app/lib/aquarium/settings.ts app/lib/aquarium/sim.ts app/lib/aquarium/settings-slot.ts --outDir Temp/aquarium-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { readPng } = require('../scripts/png-read.cjs');

const OUT = path.join(__dirname, 'aquarium-out');
const fresh = (file) => {
  for (const key of Object.keys(require.cache)) if (key.startsWith(OUT)) delete require.cache[key];
  return require(path.join(OUT, file));
};

/* ------------------------------------------------------------------ 1. the background choice */
const backdropFile = 'lib/ui/backdrop-slot.js';
const slot = fresh(backdropFile);
// Updated on purpose 2026-11-16 (Luke: "new defaults ... FLUID background", reset for everyone by the new .v2 key).
assert.equal(slot.DEFAULT_BACKDROP, 'fluid', 'a browser with nothing stored gets FLUID');
assert.deepEqual([slot.BACKDROPS[0].id, slot.BACKDROPS[slot.BACKDROPS.length - 1].id], ['aquarium', 'tile'], 'AQUARIUM first, TILE last, the simulated backgrounds between');
assert.equal(slot.backdropState().id, 'fluid', 'the store starts on the default');

// A browser: storage that keeps what it is given, and the document the choice is written onto.
const stored = new Map();
/** How many times each key has been written. */
const writes = new Map();
const browser = () => ({
  localStorage: {
    getItem: (k) => (stored.has(k) ? stored.get(k) : null),
    setItem: (k, v) => {
      writes.set(k, (writes.get(k) ?? 0) + 1);
      stored.set(k, String(v));
    },
    removeItem: (k) => stored.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
});
global.window = browser();
const root = { dataset: {} };
const stop = slot.initBackdrop(root);
assert.equal(root.dataset.backdrop, 'fluid', 'nothing stored: FLUID goes on the document');
slot.setBackdrop('tile');
assert.equal(root.dataset.backdrop, 'tile', 'pressing TILE puts the tile on at once');
assert.equal(stored.get('debaser.site.backdrop.v2'), 'tile', 'and remembers it');
stop();
assert.equal(fresh(backdropFile).backdropState().id, 'tile', 'a reload starts on the stored choice');
stored.set('debaser.site.backdrop.v2', 'nonsense');
assert.equal(fresh(backdropFile).backdropState().id, 'fluid', 'a stored id that is no longer offered falls back to the default');
stored.clear();
delete global.window;

function boot(storedValue, storageThrows = false) {
  const attrs = {};
  const sandbox = {
    localStorage: {
      getItem: () => {
        if (storageThrows) throw new Error('blocked');
        return storedValue;
      },
    },
    document: { documentElement: { setAttribute: (k, v) => (attrs[k] = v) } },
  };
  vm.runInNewContext(slot.backdropBootScript(), sandbox);
  return attrs['data-backdrop'];
}
assert.equal(boot(null), 'fluid', 'boot: nothing stored writes FLUID');
assert.equal(boot('tile'), 'tile', 'boot: TILE stored writes the tile');
assert.equal(boot('fishbowl'), 'fluid', 'boot: junk writes the default');
assert.equal(boot(null, true), 'fluid', 'boot: storage that throws still writes the default');
const layout = fs.readFileSync('app/layout.tsx', 'utf8');
assert.match(layout, /backdropBootScript\(\)/, 'the boot script is in the page head');
assert.match(layout, /<Aquarium \/>/, 'the shell draws the aquarium once');

/* ------------------------------------------------------------------ 2. the settings */
const S = fresh('lib/aquarium/settings.js');
const D = S.DEFAULT_SETTINGS;
const rangeKnobs = S.KNOBS.filter((k) => k.kind === 'range');
const switchKnobs = S.KNOBS.filter((k) => k.kind === 'switch');

assert.deepEqual(S.parseAquariumSettings(undefined), D, 'nothing stored reads as the default');
assert.deepEqual(S.parseAquariumSettings('fish'), D, 'junk reads as the default');
assert.deepEqual(S.parseAquariumSettings([1, 2, 3]), D, 'a list reads as the default');
assert.deepEqual(S.parseAquariumSettings({ v: 0, size: 3 }).size, 3, 'an older save keeps what still fits');
assert.deepEqual(S.parseAquariumSettings(D), D, 'the default reads back as itself');
for (const knob of S.KNOBS) assert.ok(knob.key in D, `${knob.key} has a default`);
assert.equal(new Set(S.KNOBS.map((k) => k.key)).size, S.KNOBS.length, 'no knob is listed twice');
assert.equal(Object.keys(D).length, S.KNOBS.length + 1, 'every setting but the version is a knob in the window');
for (const tab of S.TABS) assert.ok(S.KNOBS.some((k) => k.tab === tab.id), `${tab.label} has knobs`);
assert.ok(S.KNOBS.length >= 38, `the window has the SPEC's knobs (${S.KNOBS.length})`);

const wild = S.parseAquariumSettings({ size: 99, count: -5, speed: 2.37, light: 0, flap: 'fast', butterfly: 'yes', pointer: 'bite', tintHue: Infinity, time: NaN, extra: 1 });
assert.equal(wild.size, 12, 'too big is held to the top of the range');
assert.equal(wild.count, 0, 'too small to the bottom');
assert.equal(wild.speed, 2.25, 'and a value between steps is snapped to one');
assert.equal(wild.light, 20, 'the sea can never be set darker than it allows');
assert.equal(wild.flap, D.flap, 'a number stored as words falls back');
assert.equal(wild.butterfly, true, 'a switch stored as words falls back');
assert.equal(wild.pointer, 'ignore', 'a choice that is not offered falls back');
assert.equal(wild.tintHue, D.tintHue, 'infinity falls back');
assert.equal(wild.time, D.time, 'not-a-number falls back');
assert.ok(!('extra' in wild), 'unknown keys are dropped');
assert.equal(S.parseAquariumSettings({ depthTop: 80, depthBottom: 20 }).depthBottom, 90, 'the depth band cannot cross itself');
assert.equal(S.withSetting(D, 'depthBottom', 10).depthTop, 0, 'dragging LOWEST up pushes HIGHEST along');
assert.equal(S.withSetting(D, 'size', 3).size, 3, 'one knob changes');
assert.ok(S.sameSettings(S.withSetting(S.withSetting(D, 'size', 3), 'size', 2), D), 'and changes back');

const inRange = (settings, what) => {
  for (const knob of rangeKnobs) {
    const v = settings[knob.key];
    assert.ok(Number.isFinite(v) && v >= knob.min && v <= knob.max, `${what}: ${knob.key} ${v} is in ${knob.min}..${knob.max}`);
    const steps = (v - knob.min) / knob.step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, `${what}: ${knob.key} ${v} is on a step`);
  }
  for (const knob of switchKnobs) assert.equal(typeof settings[knob.key], 'boolean', `${what}: ${knob.key} is on or off`);
  assert.ok(['ignore', 'scare', 'follow'].includes(settings.pointer), `${what}: the pointer choice is one offered`);
  assert.deepEqual(S.parseAquariumSettings(settings), settings, `${what} reads back as itself`);
};
/** The same numbers every run. */
const seeded = (seed) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let seed = 1; seed <= 200; seed += 1) {
  const party = S.partySettings(seeded(seed));
  inRange(party, `party ${seed}`);
  assert.ok(party.light >= 65, 'a party never turns the light right down');
  assert.equal(party.tiny, false, 'nor shrinks the sea into the tank');
  assert.ok(party.butterfly && party.trigger && party.ray && party.stripe, 'nor sends a kind of fish away');
  assert.ok(party.count >= 3, 'nor empties the sea');
}
assert.ok(!S.sameSettings(S.partySettings(seeded(7)), S.partySettings(seeded(8))), 'two parties differ');
assert.deepEqual(S.PRESETS.map((p) => p.label), ['98', 'CALM', 'SCHOOL', 'CHAOS'], 'the looks along the foot');
assert.equal(S.PRESETS[0].settings, D, '98 is the default itself');
for (const preset of S.PRESETS) inRange(preset.settings, `preset ${preset.label}`);
assert.ok(JSON.stringify({ ...S.PRESETS[3].settings, backdrop: 'aquarium' }).length < 2048, 'a save is a small thing (well under the table`s 4 KB)');
const size = S.KNOBS.find((k) => k.key === 'size');
assert.equal(S.shownValue(size, 2), '2x', 'a value is written with its unit');
assert.equal(S.shownValue(S.KNOBS.find((k) => k.key === 'current'), 40), '+40', 'and the two-way knobs with their sign');
for (const key of ['size', 'coralSize']) assert.equal(S.KNOBS.find((k) => k.key === key).step, 1, `${key} moves in whole steps: pictures are never shown between sizes`);

/* ------------------------------------------------------------------ 3. the simulation on its defaults */
const M = fresh('lib/aquarium/sim.js');
const SEA = { w: 1920, h: 1080, pointer: null };
const DT = 1 / 15;
const run = (settings, seconds, { env = SEA, seed = 42, each, state = M.newSim(), giant = false } = {}) => {
  const random = seeded(seed);
  const plan = M.fishPlan(settings, giant);
  for (let n = 0; n < Math.round(seconds / DT); n += 1) {
    M.stepSim(state, plan, settings, env, DT, random);
    if (each) each(state, plan, n);
  }
  return { state, plan };
};
const set = (changes) => S.parseAquariumSettings({ ...D, ...changes });

const plan = M.fishPlan(D);
assert.deepEqual(plan.map((f) => f.species.id), ['butterfly', 'trigger', 'ray', 'stripe'], 'the default sea: one of each');
assert.ok(plan.every((f) => f.scale === 2), 'each twice its size, as the screensaver showed them');

// Each fish, while in the sea, holds exactly its recorded speed and one straight line; it arrives from outside, and leaves.
const seen = plan.map(() => ({ ticks: 0, crossings: 0, waited: 0, wasWaiting: true, entryOk: true, vx: new Set(), drift: 0 }));
run(D, 400, {
  each: (state, fish) => {
    state.fish.forEach((f, n) => {
      const log = seen[n];
      const w = fish[n].species.w * 2;
      if (f.wait > 0) {
        log.wasWaiting = true;
        log.waited += 1;
        return;
      }
      if (log.wasWaiting) {
        log.crossings += 1;
        if (!(f.x <= -w / 2 + 0.01 || f.x >= SEA.w + w / 2 - 0.01)) log.entryOk = false;
        log.wasWaiting = false;
      }
      log.ticks += 1;
      log.vx.add(Math.abs(Math.round(f.vx * 1000) / 1000));
      log.drift = Math.max(log.drift, Math.abs(f.vy));
      assert.ok(f.y > -200 && f.y < SEA.h + 200, 'a crossing fish stays near the sea');
    });
  },
});
seen.forEach((log, n) => {
  const cruise = plan[n].species.speed * 2;
  assert.deepEqual([...log.vx], [cruise], `${plan[n].species.id} holds its recorded speed (${cruise} px/s) the whole way`);
  assert.ok(log.crossings >= 2, `${plan[n].species.id} crosses, leaves and comes back (${log.crossings} crossings in 400s)`);
  assert.ok(log.entryOk, `${plan[n].species.id} always comes in from off the side`);
  assert.ok(log.waited > 0, `${plan[n].species.id} is away a while between crossings`);
  assert.ok(log.drift * ((SEA.w + plan[n].species.w * 2) / cruise) <= 80.01, `${plan[n].species.id} drifts 80 pixels at the most over a crossing`);
});

// The bubbles keep the screensaver's loop.
assert.equal(M.bubbleAt(0).opacity, 0, 'a bubble fades in');
assert.equal(M.bubbleAt(0.5).opacity, 1, 'is whole on the way');
assert.ok(Math.abs(M.bubbleAt(0.9999).dy + 200) < 0.5, 'and rises 200 pixels');
assert.equal(M.bubbleAt(1).opacity, 0, 'then is gone');
assert.deepEqual([0, 1, 2, 3].map((n) => Math.round(M.streamBubble(0.9, n, 1).age * 1000)), [214, 0, -1000, -1000], 'the first four start when the screensaver`s did');
assert.equal(M.BUBBLE_LOOP, 4.2, 'a loop of 4.2 seconds');

/* ------------------------------------------------------------------ 4. the knobs */
// The plan: counts, kinds, sizes, shoals.
assert.equal(M.fishPlan(set({ count: 40 })).length, 40, 'FISH COUNT is how many there are');
assert.equal(M.fishPlan(set({ count: 0 })).length, 0, 'none is none');
assert.equal(M.fishPlan(set({ butterfly: false, trigger: false, ray: false, stripe: false })).length, 0, 'no kinds on: no fish');
assert.deepEqual([...new Set(M.fishPlan(set({ count: 9, ray: false, trigger: false })).map((f) => f.species.id))], ['butterfly', 'stripe'], 'only the kinds that are on');
assert.ok(M.fishPlan(set({ size: 4 })).every((f) => f.scale === 4), 'FISH SIZE sizes every fish');
// Bigger fish (Luke, 2026-11-15): up to 12x, and the sea holds fewer of them the bigger they are.
assert.equal(S.KNOBS.find((k) => k.key === 'size').max, 12, 'FISH SIZE goes up to 12x');
assert.equal(M.fishPlan(set({ size: 4, count: 40 })).length, 40, 'at 4x the sea still holds all forty, as it did');
assert.equal(M.fishPlan(set({ size: 8, count: 40 })).length, 10, 'at 8x, ten');
const huge = M.fishPlan(set({ size: 12, count: 40 }));
assert.ok(huge.length === 4 && huge.every((f) => f.scale === 12), 'at 12x, four, each twelve times its picture');
assert.equal(M.fishPlan(set({ size: 12, count: 1 })).length, 1, 'and one fish is one fish at any size');
const bigMix = M.fishPlan(set({ size: 12, mixed: true, count: 40 }));
assert.ok(bigMix.length >= 1 && bigMix.reduce((sum, f) => sum + f.scale * f.scale, 0) <= M.FISH_ROOM, 'MIXED SIZES up to 12x fills the sea and no more');
const mixed = M.fishPlan(set({ size: 4, mixed: true, count: 40 }));
assert.ok(mixed.every((f) => Number.isInteger(f.scale) && f.scale >= 1 && f.scale <= 4), 'MIXED SIZES stays between 1 and FISH SIZE, in whole sizes');
assert.ok(new Set(mixed.map((f) => f.scale)).size > 1, 'and really mixes');
assert.deepEqual(mixed.map((f) => f.scale), M.fishPlan(set({ size: 4, mixed: true, count: 40 })).map((f) => f.scale), 'the same fish keeps its size from one change to the next');
const giant = M.fishPlan(set({ count: 40 }), true);
assert.ok(giant.length === M.GIANT_MOST && giant.every((f) => f.scale === M.GIANT_SCALE), 'GIANT MODE: sixteen times the size, and only as many fish as that leaves room for');
assert.ok(M.GIANT_SCALE === 16 && M.GIANT_MOST === 2, 'which is two');
assert.ok(M.fishPlan(set({ tiny: true, size: 4 })).every((f) => f.scale === 1), 'TINY TANK: everything at its own size');
const shoals = M.fishPlan(set({ count: 40, schoolSize: 5 }));
const byShoal = new Map();
for (const f of shoals) byShoal.set(f.school, [...(byShoal.get(f.school) ?? []), f.species.id]);
for (const [, members] of byShoal) {
  assert.ok(members.length <= 5, 'no shoal is bigger than SCHOOL SIZE');
  assert.equal(new Set(members).size, 1, 'and a shoal is all one kind');
}

// SCHOOLING: the fish stay in the sea and gather. The same fish without it are spread across the whole crossing.
const spread = (state, fish) => {
  let total = 0;
  let pairs = 0;
  for (let a = 0; a < fish.length; a += 1) for (let b = a + 1; b < fish.length; b += 1) {
    if (fish[a].school !== fish[b].school || state.fish[a].wait > 0 || state.fish[b].wait > 0) continue;
    total += Math.hypot(state.fish[a].x - state.fish[b].x, state.fish[a].y - state.fish[b].y);
    pairs += 1;
  }
  return pairs === 0 ? Infinity : total / pairs;
};
const schoolSettings = { count: 12, trigger: false, ray: false, stripe: false, schoolSize: 12 };
const shoal = run(set({ ...schoolSettings, schooling: 100 }), 90);
assert.ok(shoal.state.fish.every((f) => f.wait === 0), 'a shoal`s fish are all in the sea');
assert.ok(shoal.state.fish.every((f) => f.x > -400 && f.x < SEA.w + 400), 'and stay about it: they turn at the edges');
const loose = run(set(schoolSettings), 90);
assert.ok(spread(shoal.state, shoal.plan) < 350, `a shoal keeps together (${Math.round(spread(shoal.state, shoal.plan))} px apart on average)`);
assert.ok(spread(shoal.state, shoal.plan) < spread(loose.state, loose.plan) / 2, 'far closer than the same fish swimming alone');
const headings = shoal.state.fish.map((f) => f.face);
assert.ok(Math.abs(headings.reduce((a, b) => a + b, 0)) >= 8, 'and mostly faces one way');

// One fish, put where the test wants it.
const placed = (settings, at) => {
  const state = M.newSim();
  const fishPlan = M.fishPlan(settings);
  M.stepSim(state, fishPlan, settings, SEA, DT, seeded(1));
  state.fish.forEach((f, n) => Object.assign(f, { wait: 0, x: at.x + n * 30, y: at.y, vx: 66, vy: 0, dir: 1, face: 1, drift: 0 }));
  return state;
};
const one = { count: 1, trigger: false, ray: false, stripe: false };

// SCARE: a fish with the pointer just ahead of it turns and runs; the same fish with IGNORE swims on.
const scared = placed(set({ ...one, pointer: 'scare' }), { x: 900, y: 500 });
run(set({ ...one, pointer: 'scare' }), 2, { state: scared, env: { ...SEA, pointer: { x: 960, y: 500 } } });
assert.ok(scared.fish[0].x < 900, `SCARE: it backs away from the pointer (${Math.round(scared.fish[0].x)})`);
assert.equal(scared.fish[0].face, -1, 'and faces the way it flees');
const calm = placed(set(one), { x: 900, y: 500 });
run(set(one), 2, { state: calm, env: { ...SEA, pointer: { x: 960, y: 500 } } });
assert.ok(Math.abs(calm.fish[0].x - (900 + 66 * 2)) < 1, 'IGNORE: it swims straight on at its own speed');
const far = placed(set({ ...one, pointer: 'scare', scareRadius: 60 }), { x: 900, y: 500 });
run(set({ ...one, pointer: 'scare', scareRadius: 60 }), 1, { state: far, env: { ...SEA, pointer: { x: 900, y: 900 } } });
assert.ok(Math.abs(far.fish[0].x - 966) < 1, 'SCARE RADIUS: a pointer further off than that is no worry');

// FOLLOW: it comes to the pointer and stays by it.
const follower = placed(set({ ...one, pointer: 'follow' }), { x: 300, y: 300 });
run(set({ ...one, pointer: 'follow' }), 40, { state: follower, env: { ...SEA, pointer: { x: 1400, y: 700 } } });
assert.ok(Math.hypot(follower.fish[0].x - 1400, follower.fish[0].y - 700) < 120, 'FOLLOW: it ends up beside the pointer');

// Food: dropped, it sinks; the fish comes and it is gone. Out of reach, it is left; left long enough, it goes.
const hungry = set({ ...one, feed: true, pelletLife: 60 });
const fed = placed(hungry, { x: 600, y: 400 });
M.dropPellet(fed, 900, 300);
const y0 = fed.pellets[0].y;
run(hungry, 0.5, { state: fed });
assert.ok(fed.pellets[0].y > y0, 'food sinks');
run(hungry, 15, { state: fed });
assert.equal(fed.pellets.length, 0, 'and the fish eats it, long before it would have gone by itself');
const fussy = placed(set({ ...one, feed: true, greed: 10, pelletLife: 30 }), { x: 100, y: 200 });
fussy.fish[0].vx = 0;
M.dropPellet(fussy, 1800, 900);
run(set({ ...one, feed: true, greed: 10, pelletLife: 30, speed: 0.25 }), 10, { state: fussy });
assert.equal(fussy.pellets.length, 1, 'GREED: food too far off is left alone');
run(set({ ...one, feed: true, greed: 10, pelletLife: 30, speed: 0.25 }), 25, { state: fussy });
assert.equal(fussy.pellets.length, 0, 'FOOD LASTS: uneaten food goes when its time is up');
const glut = M.newSim();
for (let n = 0; n < 40; n += 1) M.dropPellet(glut, n * 10, 100);
assert.equal(glut.pellets.length, M.MOST_PELLETS, 'there is only ever so much food in the sea');

// Bubbles from a click, and the pointer's wake.
const burst = M.newSim();
M.burstBubbles(burst, 500, 500, seeded(3));
assert.equal(burst.bubbles.length, 6, 'a click lets out six bubbles');
run(set(one), M.BUBBLE_LOOP + 0.5, { state: burst });
assert.equal(burst.bubbles.length, 0, 'which rise and are gone');
const wake = M.newSim();
let px = 100;
run(set({ ...one, wake: true }), 3, { state: wake, each: () => (px += 20), env: { ...SEA, get pointer() { return { x: px, y: 400 }; } } });
assert.ok(wake.bubbles.length > 5 && wake.bubbles.length <= M.MOST_BUBBLES, `WAKE: bubbles trail a moving pointer (${wake.bubbles.length})`);
const stillWake = run(set({ ...one, wake: true }), 3, { env: { ...SEA, pointer: { x: 300, y: 300 } } });
assert.equal(stillWake.state.bubbles.length, 0, 'and a pointer that is not moving leaves none');

// GRAVITY: down to the floor and no further; turned over, up to the surface.
const sunk = placed(set({ ...one, gravity: 100 }), { x: 200, y: 300 });
run(set({ ...one, gravity: 100 }), 15, { state: sunk });
assert.equal(sunk.fish[0].wait > 0 ? null : Math.round(sunk.fish[0].y), sunk.fish[0].wait > 0 ? null : Math.round(SEA.h - 55), 'GRAVITY: a fish sinks to the floor and rests on it');
const floated = placed(set({ ...one, gravity: -100 }), { x: 200, y: 300 });
run(set({ ...one, gravity: -100 }), 6, { state: floated });
assert.equal(Math.round(floated.fish[0].y), 55, 'turned over, it floats to the surface');

// CURRENT: carries fish along; a fish swept out comes back in rather than being lost.
const swept = placed(set({ ...one, current: 100 }), { x: 500, y: 300 });
run(set({ ...one, current: 100 }), 2, { state: swept });
assert.ok(Math.abs(swept.fish[0].x - (500 + (66 + 60) * 2)) < 1, 'CURRENT: the water adds its own speed');
assert.equal(M.currentOf(set({ current: -100 })), -60, 'and runs either way');
for (const current of [-100, 100, -85, 55]) {
  // No fish is ever turned back at the edge it came in by: each one that comes in is still in the sea a second later.
  const since = [];
  let crossings = 0;
  let turnedBack = 0;
  run(set({ current }), 300, {
    each: (state) =>
      state.fish.forEach((f, n) => {
        if (f.wait > 0) {
          if (since[n] !== undefined && since[n] < 15) turnedBack += 1;
          since[n] = undefined;
          return;
        }
        if (since[n] === undefined) crossings += 1;
        since[n] = (since[n] ?? 0) + 1;
      }),
  });
  assert.ok(crossings >= 8, `CURRENT ${current}: the fish keep coming (${crossings} crossings)`);
  assert.equal(turnedBack, 0, `CURRENT ${current}: none is turned back where it came in, even one slower than the water`);
}

// FOLLOW THE LEADER: the second fish settles in behind the first.
const parade = run(set({ count: 6, trigger: false, ray: false, stripe: false, parade: true }), 120);
for (let n = 1; n < 6; n += 1) {
  const ahead = parade.state.fish[n - 1];
  const me = parade.state.fish[n];
  assert.ok(Math.hypot(ahead.x - me.x, ahead.y - me.y) < 420, `FOLLOW THE LEADER: fish ${n + 1} keeps up with the one in front`);
}

// WANDER: fish turn round mid-sea, which a crossing fish never does.
let turns = 0;
const lastFace = [];
run(set({ count: 8, wander: 100 }), 120, {
  each: (state) =>
    state.fish.forEach((f, n) => {
      if (f.wait > 0) {
        lastFace[n] = undefined;
        return;
      }
      if (lastFace[n] !== undefined && lastFace[n] !== f.face && f.x > 200 && f.x < SEA.w - 200) turns += 1;
      lastFace[n] = f.face;
    }),
});
assert.ok(turns > 5, `WANDER: fish change their minds mid-sea (${turns} turns)`);

// DAY AND NIGHT, DISCO.
assert.equal(M.nightAt(D, 120), 0, 'no night unless DAY AND NIGHT is on');
assert.ok(M.nightAt(set({ dayNight: true }), 0) < 0.001 && M.nightAt(set({ dayNight: true }), 120) > 0.999, 'on, midday at the start and midnight two minutes in');
assert.ok(new Set([0, 1, 2, 3, 4].map((t) => M.discoHue(t))).size >= 4, 'DISCO changes colour as the seconds go');

// Everything on at once, for five minutes, with a pointer charging about and food raining: nothing lost, nothing NaN.
for (const settings of [S.PRESETS[3].settings, set({ ...S.PRESETS[3].settings, parade: true, schooling: 100, gravity: 100, tiny: true }), S.partySettings(seeded(11)), S.partySettings(seeded(12))]) {
  const env = settings.tiny ? { ...M.TINY_TANK } : { w: SEA.w, h: SEA.h };
  let tick = 0;
  const chaos = M.newSim();
  run(settings, 300, {
    state: chaos,
    env: { ...env, get pointer() { return { x: (tick * 37) % env.w, y: (tick * 13) % env.h }; } },
    each: (state, fish) => {
      tick += 1;
      if (tick % 20 === 0) M.dropPellet(state, (tick * 7) % env.w, 10);
      if (tick % 50 === 0) M.burstBubbles(state, (tick * 3) % env.w, env.h / 2, seeded(tick));
      assert.equal(state.fish.length, fish.length, 'as many fish as the plan says');
      for (const f of state.fish) assert.ok([f.x, f.y, f.vx, f.vy, f.wait].every(Number.isFinite), 'every fish is somewhere');
      assert.ok(state.bubbles.length <= M.MOST_BUBBLES && state.pellets.length <= M.MOST_PELLETS, 'and the loose bubbles and food are capped');
    },
  });
  const margin = 3 * 120 * 16;
  assert.ok(chaos.fish.every((f) => f.x > -margin && f.x < env.w + margin && f.y > -margin && f.y < env.h + margin), 'no fish has swum off for good');
}

/* ------------------------------------------------------------------ 5. saving */
process.env.NEXT_PUBLIC_SUPABASE_URL = '';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '';
process.env.NEXT_PUBLIC_AUTH_BACKEND = 'mock';
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
(async () => {
  global.window = browser();
  let store = fresh('lib/aquarium/settings-slot.js');
  assert.deepEqual(store.aquariumSettings(), D, 'a browser with nothing stored draws the default sea');
  store.setAquariumSettings(S.withSetting(D, 'count', 17));
  assert.equal(JSON.parse(stored.get('debaser.site.aquarium.v1')).count, 17, 'a change is kept in this browser at once');
  assert.equal(stored.has('debaser.aquarium.mock.v1'), false, 'and goes nowhere else while nobody is signed in');
  store = fresh('lib/aquarium/settings-slot.js');
  assert.equal(store.aquariumSettings().count, 17, 'a reload reads it back');
  stored.set('debaser.site.aquarium.v1', '{not json');
  assert.deepEqual(fresh('lib/aquarium/settings-slot.js').aquariumSettings(), D, 'a damaged copy reads as the default');

  // Signed in (the mock account): what the browser holds goes to an account that has nothing; later changes follow.
  stored.clear();
  store = fresh('lib/aquarium/settings-slot.js');
  store.setAquariumSettings(S.withSetting(D, 'size', 3));
  await store.setAquariumAccount('person-a');
  assert.equal(JSON.parse(stored.get('debaser.aquarium.mock.v1'))['person-a'].size, 3, 'signing in carries the browser`s sea to an account with none');
  store.setAquariumSettings(S.withSetting(store.aquariumSettings(), 'rainbow', true));
  assert.notEqual(JSON.parse(stored.get('debaser.aquarium.mock.v1'))['person-a'].rainbow, true, 'a change is not written to the account on the instant (a slider drag is one save)');
  store.flushAquariumSave();
  await settle();
  assert.equal(JSON.parse(stored.get('debaser.aquarium.mock.v1'))['person-a'].rainbow, true, 'but is once it settles');
  require(path.join(OUT, backdropFile)).setBackdrop('tile');
  store.flushAquariumSave();
  await settle();
  assert.equal(JSON.parse(stored.get('debaser.aquarium.mock.v1'))['person-a'].backdrop, 'tile', 'the BACKGROUND choice rides along');
  assert.equal(store.aquariumSaveFailed(), false, 'and nothing has failed');

  // Another machine: an empty browser, the same account. The sea and the background arrive.
  const account = stored.get('debaser.aquarium.mock.v1');
  stored.clear();
  stored.set('debaser.aquarium.mock.v1', account);
  store = fresh('lib/aquarium/settings-slot.js');
  assert.deepEqual(store.aquariumSettings(), D, 'a fresh browser starts on the default');
  await store.setAquariumAccount('person-a');
  assert.equal(store.aquariumSettings().size, 3, 'signing in brings the account`s sea');
  assert.equal(store.aquariumSettings().rainbow, true, 'all of it');
  assert.equal(require(path.join(OUT, backdropFile)).backdropState().id, 'tile', 'and its background');
  assert.equal(JSON.parse(stored.get('debaser.site.aquarium.v1')).size, 3, 'kept in this browser too, for the next first paint');
  const before = writes.get('debaser.aquarium.mock.v1') ?? 0;
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(writes.get('debaser.aquarium.mock.v1') ?? 0, before, 'putting the account`s copy on is not a change to save back');
  await store.setAquariumAccount('person-b');
  assert.equal(JSON.parse(stored.get('debaser.aquarium.mock.v1'))['person-a'].size, 3, 'somebody else signing in here leaves the first account`s copy alone');
  assert.deepEqual(store.aquariumSettings(), D, 'and, having saved nothing, starts on the default sea rather than the first person`s');
  assert.equal(require(path.join(OUT, backdropFile)).backdropState().id, 'aquarium', 'with the aquarium on');
  assert.equal(JSON.parse(stored.get('debaser.aquarium.mock.v1'))['person-b'], undefined, 'nothing of the first person`s is saved as theirs');
  await store.setAquariumAccount(null);
  await store.setAquariumAccount('person-a');
  assert.equal(store.aquariumSettings().size, 3, 'the first person, back again, gets their own sea');

  // The window, and GIANT MODE.
  assert.deepEqual(store.aquariumWindowState(), { open: false, seeThrough: false, dock: 'aquarium' }, 'the window starts shut and solid, and names itself for the undo arrows');
  store.toggleAquariumWindow();
  store.toggleAquariumSeeThrough();
  assert.deepEqual(store.aquariumWindowState(), { open: true, seeThrough: true, dock: 'aquarium' }, 'a press opens it; [ 50% ] makes it see-through');
  store.toggleAquariumWindow();
  assert.equal(store.aquariumWindowState().open, false, 'and a second press shuts it');
  store.toggleGiant();
  assert.equal(store.aquariumGiant(), true, 'GIANT MODE goes on');
  store.toggleGiant();
  assert.equal(store.aquariumGiant(), false, 'and off again at a second press (or by itself, twenty seconds on)');
  assert.equal(store.GIANT_MS, 20000, 'twenty seconds');
  const slotSource = fs.readFileSync('app/lib/backdrops/store.ts', 'utf8');
  assert.match(slotSource, /process\.env\.NEXT_PUBLIC_AQUARIUM_DATA_SOURCE === 'supabase' \? SUPABASE_STORE : null/, 'accounts are only asked of the database once its table is switched on');
  assert.match(slotSource, /from\('user_aquarium'\)/, 'in the table the SPEC names');
  // The table (Luke's OK 2026-11-15, "Yes, add it"): owner only, nothing for a visitor, and switched on for the deployed site.
  const migration = fs.readFileSync('supabase/migrations/20261115235034_user_aquarium.sql', 'utf8').replace(/--.*$/gm, '');
  assert.match(
    migration,
    /create table if not exists public\.user_aquarium \(\s*person uuid primary key references auth\.users \(id\) on delete cascade,\s*settings jsonb not null default '\{\}'::jsonb\s*\);/,
    'one row a person, gone with their account',
  );
  assert.match(migration, /alter table public\.user_aquarium enable row level security;/, 'row level security is on');
  const policies = [...migration.matchAll(/create policy "([^"]+)" on public\.user_aquarium\s+for (\w+) to (\w+)([^;]*);/g)].map((m) => ({
    name: m[1],
    does: m[2],
    who: m[3],
    rule: m[4].replace(/\s+/g, ' ').trim(),
  }));
  assert.deepEqual(policies.map((p) => p.does).sort(), ['insert', 'select', 'update'], 'a person may read, add and change their row: nothing deletes');
  for (const policy of policies) {
    assert.equal(policy.who, 'authenticated', `${policy.name}: signed-in people only`);
    const own = policy.rule.split('person = auth.uid()').length - 1;
    assert.ok(own === (policy.does === 'update' ? 2 : 1) && !/ or |true/.test(policy.rule), `${policy.name}: their own row and no other (${policy.rule})`);
  }
  assert.match(
    migration,
    /revoke all on public\.user_aquarium from public, anon, authenticated;\s*grant select, insert, update on public\.user_aquarium to authenticated;/,
    'a visitor is granted nothing',
  );
  assert.doesNotMatch(migration, /to anon|to public/, 'and no rule names a visitor');
  assert.match(migration, /pg_column_size\(settings\) < 4096/, 'a save is held to 4 KB');
  assert.match(fs.readFileSync('.env.production', 'utf8'), /^NEXT_PUBLIC_AQUARIUM_DATA_SOURCE=supabase\r?$/m, 'the deployed site saves to accounts');
  stored.clear();
  delete global.window;

  /* ---------------------------------------------------------------- 6. what is drawn, and where from */
  const Aquarium = require('./aquarium-out/components/Aquarium.js').default;
  assert.equal(renderToString(React.createElement(Aquarium)), '', 'the server draws no aquarium');
  const windowModule = require('./aquarium-out/components/BackdropSettingsWindow.js');
  assert.equal(typeof windowModule.default, 'function', 'the AQUARIUM window is a component');
  const key = renderToString(React.createElement(windowModule.BackdropKey));
  assert.match(key, /class="aquarium-key /, 'the sea key is placed by the stylesheet');
  assert.match(key.replace(/<!-- -->/g, ''), /\[ AQUARIUM \]/, 'and says what it opens');
  const knobs = renderToString(React.createElement(windowModule.BackdropKnobs, { id: 'aquarium' })).replace(/<!-- -->/g, '');
  for (const tab of S.TABS) assert.ok(knobs.includes(`[ ${tab.label} ]`), `the window has a ${tab.label} tab`);
  // (HIGHEST and LOWEST are drawn as one control, DEPTH: a strip with two handles.)
  const paired = new Set(S.AQUARIUM.widgets.flatMap((w) => (w.kind === 'band' ? [w.low, w.high] : [w.x, w.y])));
  for (const knob of S.KNOBS.filter((k) => k.tab === 'fish' && !paired.has(k.key))) assert.ok(knobs.includes(knob.label), `FISH lists ${knob.label}`);
  assert.ok(knobs.includes('DEPTH') && knobs.includes('data-backdrop-band="depth"'), 'and DEPTH, the band HIGHEST and LOWEST share');
  assert.ok(knobs.includes('type="range"') && knobs.includes('aria-valuetext="2x"'), 'a slider is a real slider, its value read out');
  for (const look of ['RESET', 'PARTY', '98', 'CALM', 'SCHOOL', 'CHAOS']) assert.ok(knobs.includes(`[ ${look} ]`), `the foot has [ ${look} ]`);
  const windowSource = fs.readFileSync('app/components/BackdropSettingsWindow.tsx', 'utf8');
  assert.match(windowSource, /<DockWindow/, 'a window beside the page, with no scrim');
  assert.doesNotMatch(windowSource, /<PopoutWindow/, 'not a dialogue that takes the screen');
  assert.match(windowSource, /seeThrough=\{seeThrough\}/, 'that can be made see-through');
  assert.match(fs.readFileSync('app/components/DockWindow.tsx', 'utf8'), /seeThrough \? ' opacity-50' : ''/, 'by half');
  assert.match(layout, /<BackdropSettingsWindow \/>/, 'the shell draws the window once');
  assert.match(layout, /<BackdropKey \/>/, 'and the key on the sea');
  const prefs = fs.readFileSync('app/components/PreferencesWindow.tsx', 'utf8');
  assert.match(prefs, /<span>BACKGROUND<\/span>/, 'PREFERENCES has a BACKGROUND section');
  assert.match(prefs, /BACKDROPS\.map\(/, 'listing every background the store offers');
  assert.match(prefs, /onClick=\{\(\) => setBackdrop\(backdrop\.id\)\}/, 'each row switches to its own');
  assert.match(prefs, /setBackdrop\(backdrop\.id\);\s*openBackdropWindow\(\);/, 'and [ SETTINGS ] beside a background puts it on and opens its window');
  assert.match(fs.readFileSync('app/components/ThemeHost.tsx', 'utf8'), /useEffect\(\(\) => initBackdrop\(\), \[\]\)/, 'the choice is applied on mount');
  const sea = fs.readFileSync('app/components/Aquarium.tsx', 'utf8');
  assert.match(sea, /if \(hidden \|\| still\) return;/, 'the loop never runs in a hidden tab or with motion off');
  // The rule itself is `onBareBackground` (runtime.ts), held by behaviour in check-backdrops.cjs since 2026-11-16 (it also
  // has to count a press with the site window put away, which lands on the page's body).
  assert.match(sea, /: !onBareBackground\(event\.target\)\) return;/, 'a click only counts on the bare sea, never on the page');
  assert.doesNotMatch(sea, /useState<Sim|setFish|setState\(/, 'where a fish is, is never React state');

  /* ---------------------------------------------------------------- 7. the pictures and the stylesheet */
  for (const species of M.SPECIES) {
    const png = readPng(path.join('assets/aquarium', species.file));
    assert.equal(png.width, species.w * species.frames, `${species.file}: ${species.frames} frames of ${species.w} wide`);
    assert.equal(png.height, species.h, `${species.file}: ${species.h} tall`);
  }
  for (const [file, w, h] of [['coral-left.png', 216, 208], ['coral-right.png', 178, 141]]) {
    const png = readPng(path.join('assets/aquarium', file));
    assert.equal(`${png.width}x${png.height}`, `${w}x${h}`, `${file} is the size the component lays it out at`);
    assert.match(sea, new RegExp(`${file.replace('.', '\\.')}'\\)\\} alt="" className="aquarium-still [a-z]+-0" width=\\{${w} \\* coral\\} height=\\{${h} \\* coral\\}`), `${file} laid out at ${w}x${h}, times CORAL SIZE`);
  }
  for (const [file, size] of [['bubble-big.png', 7], ['bubble-small.png', 5], ['pellet.png', 3]]) {
    const png = readPng(path.join('assets/aquarium', file));
    assert.equal(`${png.width}x${png.height}`, `${size}x${size}`, `${file} is ${size}x${size}`);
  }
  assert.match(fs.readFileSync('assets/aquarium/README.txt', 'utf8'), /pellet\.png/, 'the pictures say where they came from, the food included');

  const css = fs.readFileSync('app/globals.css', 'utf8');
  assert.match(css, /html\[data-backdrop\]:not\(\[data-backdrop='tile'\]\) \[data-site-window='desk'\] \{\s*background: none;/, 'the desk lets go of its tile for any background but TILE');
  assert.match(css, /html\[data-backdrop\]:not\(\[data-backdrop='tile'\]\) body \{\s*background: var\(--dye-black\);/, 'and the canvas is the sea before the fish arrive');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.aquarium-fish,\s*\.aquarium-bubble \{\s*display: none;/, 'motion off: no fish, no bubbles');
  assert.match(css, /\.aquarium\[data-aquarium='paused'\] \*,\s*\.aquarium-stage\[data-aquarium='paused'\] \* \{\s*animation-play-state: paused;/, 'a hidden tab pauses them (on a stage too)');
  assert.match(css, /html:not\(\[data-backdrop\]\) \.aquarium-key,\s*html\[data-backdrop='tile'\] \.aquarium-key \{\s*display: none;/, 'the key on the background is not shown on TILE');
  // Since 2026-11-16 these stand aside only while the site window is there: put away (HIDE WINDOW), the key shows.
  assert.match(css, /html\[data-site-fill='on'\]:not\(\[data-site-hidden='on'\]\) \.aquarium-key,\s*html:has\(\[data-page-fill\]\):not\(\[data-site-hidden='on'\]\) \.aquarium-key \{\s*display: none;/, 'and stands aside when the site window fills the screen');
  assert.match(fs.readFileSync('app/components/SiteWindow.tsx', 'utf8'), /data-page-fill=\{fill \? '' : undefined\}/, 'which a page that fills by itself says');
  assert.match(fs.readFileSync('app/theme/tokens.css', 'utf8'), /--z-index-backdrop: -1;/, 'the layer sits under the page');

  console.log('aquarium');
  console.log('  choice   : AQUARIUM by default, TILE beside it, written before the first paint');
  console.log(`  settings : ${S.KNOBS.length} knobs in ${S.TABS.length} tabs; junk reads back safe; 200 parties and 4 presets in range`);
  console.log('  default  : each fish alone at its recorded speed, in from the side, away between crossings');
  console.log('  knobs    : shoals, scare, follow, food, bubbles, wake, gravity, current, parade, wander; 5 minutes of chaos lose nothing');
  console.log('  saving   : this browser at once; the (mock) account after a settle, background included, to a fresh browser');
  console.log('  drawn    : nothing by the server; the window lists its knobs; shell, PREFERENCES and the sea key open it');
  console.log(`  art      : ${M.SPECIES.length} fish strips, 2 coral banks, 2 bubbles, 1 food pellet, each the size the code lays out`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
