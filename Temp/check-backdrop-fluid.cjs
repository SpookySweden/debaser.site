/**
 * FLUID (SPEC-backgrounds.md): the ink-in-water background's own arithmetic, run with no browser.
 *
 * Held here:
 *   1. still water stays still, and clean still water costs nothing; ink in still water stays where it is;
 *   2. a push moves ink the way it was pushed; the pressure step stops the water bunching;
 *   3. the knobs: INK LASTS, THICKNESS, SWIRL, BUOYANCY, the wind, the pointer (stirring only as it moves), AUTO SPLATS,
 *      WINDOWS ARE SOLID; the one-press keys and a press on the background;
 *   4. the picture: no ink is left empty; COLOUR STEPS and DITHER; each colour set its own; KALEIDOSCOPE folds it;
 *   5. its knobs, looks and parties are in range, and long runs with everything happening stay finite.
 *
 * Compiled fresh on every run:
 *   npx tsc app/lib/backdrops/fluid/sim.ts app/lib/backdrops/fluid/def.ts app/lib/backdrops/engine.ts app/lib/backdrops/knobs.ts --outDir Temp/backdrop-fluid-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, 'backdrop-fluid-out');
const F = require(path.join(OUT, 'fluid/sim.js'));
const { FLUID_DEF } = require(path.join(OUT, 'fluid/def.js'));
const K = require(path.join(OUT, 'knobs.js'));
const E = require(path.join(OUT, 'engine.js'));

const seeded = (seed) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const D = FLUID_DEF.defaults;
/** Settings with nothing happening by itself. */
const quiet = (changes = {}) => K.parseValues(FLUID_DEF, { ...D, auto: 0, pointer: 'ignore', swirl: 0, thickness: 0, fade: 100, ...changes });
const world = (w = 64, h = 48, solids = [], seed = 5) => ({ state: F.newFluid(w, h), env: { w, h, pointer: null, solids, random: seeded(seed) } });
const run = (state, values, env, steps, each) => {
  for (let n = 0; n < steps; n += 1) {
    if (each) each(n);
    F.stepFluid(state, values, env);
  }
};
const total = (state) => state.ink.reduce((sum, one) => sum + one.reduce((a, b) => a + b, 0), 0);
/** Where the ink is, on average. */
const middle = (state) => {
  let [sx, sy, sum] = [0, 0, 0];
  for (let y = 0; y < state.h; y += 1) for (let x = 0; x < state.w; x += 1) {
    const n = x + 1 + (state.w + 2) * (y + 1);
    const here = state.ink[0][n] + state.ink[1][n] + state.ink[2][n];
    sx += x * here;
    sy += y * here;
    sum += here;
  }
  return { x: sx / sum, y: sy / sum };
};
const finite = (state) => [state.u, state.v, ...state.ink].every((field) => field.every(Number.isFinite));

/* ------------------------------------------------------------------ 1. still water */
{
  const { state, env } = world();
  const before = [state.u.slice(), state.v.slice(), state.p.slice()];
  run(state, quiet(), env, 200);
  assert.ok(state.u.every((v) => v === 0) && state.v.every((v) => v === 0) && total(state) === 0, 'clean still water stays clean and still');
  assert.ok(state.p.every((v, n) => v === before[2][n]) && state.solved === 0, 'and nothing is worked out for it: the water rests (no step of two hundred was solved)');
  assert.ok(state.t > 6, 'though its clock runs');
  F.splat(state, 32, 24, 0, 0, 5, 1, 0);
  const [m0, t0] = [middle(state), total(state)];
  run(state, quiet(), env, 60);
  const m1 = middle(state);
  assert.ok(Math.abs(m1.x - m0.x) < 0.05 && Math.abs(m1.y - m0.y) < 0.05, 'ink dropped into still water stays where it is');
  assert.ok(total(state) > t0 * 0.9 && total(state) < t0, 'and, set to last, has barely faded two seconds on');
  assert.equal(state.solved, 60, 'while there is ink, every step is worked out');
}

/* ------------------------------------------------------------------ 2. pushes, and no bunching */
for (const [fx, fy, way] of [[40, 0, 'right'], [-40, 0, 'left'], [0, 40, 'down'], [0, -40, 'up']]) {
  const { state, env } = world();
  F.splat(state, 32, 24, fx, fy, 5, 1, 0);
  const from = middle(state);
  run(state, quiet(), env, 45);
  const to = middle(state);
  const moved = way === 'right' ? to.x - from.x : way === 'left' ? from.x - to.x : way === 'down' ? to.y - from.y : from.y - to.y;
  const across = way === 'right' || way === 'left' ? Math.abs(to.y - from.y) : Math.abs(to.x - from.x);
  assert.ok(moved > 2 && across < 1, `ink pushed ${way} goes ${way} (${moved.toFixed(1)} cells, ${across.toFixed(2)} off line)`);
  assert.ok(finite(state), 'and every number is still a number');
}
{
  const { state, env } = world();
  F.splat(state, 32, 24, 60, 0, 5, 1, 0);
  const before = F.bunching(state);
  F.stepFluid(state, quiet(), env);
  assert.ok(F.bunching(state) < before * 0.5, `the pressure step stops the water bunching (${before.toFixed(3)} to ${F.bunching(state).toFixed(3)} a cell)`);
  assert.equal(F.PRESSURE_PASSES, 16, 'in sixteen passes');
}

/* ------------------------------------------------------------------ 3. the knobs */
{
  const left = (fade) => {
    const { state, env } = world();
    F.splat(state, 32, 24, 0, 0, 5, 1, 0);
    const start = total(state);
    run(state, quiet({ fade }), env, 90);
    return total(state) / start;
  };
  assert.ok(left(0) < 0.05 && left(50) > left(0) && left(100) > 0.9, `INK LASTS: from gone in three seconds to hardly faded (${left(0).toFixed(2)}, ${left(50).toFixed(2)}, ${left(100).toFixed(2)} left)`);
  const flowAfter = (thickness) => {
    const { state, env } = world();
    F.splat(state, 32, 24, 60, 0, 5, 1, 0);
    run(state, quiet({ thickness }), env, 30);
    return state.flowNow;
  };
  assert.ok(flowAfter(100) < flowAfter(0) * 0.3, `THICKNESS: thick water has all but stopped where thin water still runs (${flowAfter(100).toFixed(3)} against ${flowAfter(0).toFixed(3)})`);
  const curl = (swirl) => {
    const { state, env } = world(64, 48, [], 9);
    F.burst(state, 6, quiet(), env);
    run(state, quiet({ swirl }), env, 40);
    let sum = 0;
    const row = state.w + 2;
    for (let j = 2; j < state.h; j += 1) for (let i = 2; i < state.w; i += 1) sum += Math.abs(state.v[i + 1 + row * j] - state.v[i - 1 + row * j] - state.u[i + row * (j + 1)] + state.u[i + row * (j - 1)]);
    return sum;
  };
  assert.ok(curl(100) > curl(0) * 1.2, `SWIRL: the water curls more tightly (${Math.round(curl(100))} against ${Math.round(curl(0))})`);
  const drift = (changes) => {
    const { state, env } = world();
    F.splat(state, 32, 24, 0, 0, 5, 1, 0);
    const from = middle(state);
    run(state, quiet(changes), env, 60);
    const to = middle(state);
    return { x: to.x - from.x, y: to.y - from.y };
  };
  assert.ok(drift({ buoyancy: 100 }).y < -1.5 && drift({ buoyancy: -100 }).y > 1.5, 'BUOYANCY: ink rises, or sinks');
  assert.ok(drift({ windX: 100 }).x > 1.5 && drift({ windX: -100 }).x < -1.5 && drift({ windY: 100 }).y > 1.5, 'the wind blows it its way');
}
{
  // The pointer stirs only as it moves, and only when it is set to.
  const stirred = (pointer, moving) => {
    const { state, env } = world();
    run(state, quiet({ pointer }), env, 30, (n) => (env.pointer = { x: moving ? 10 + n : 20, y: 24, down: false }));
    return state;
  };
  const dragged = stirred('stir', true);
  assert.ok(total(dragged) > 1 && middle(dragged).x > 12, 'a moving pointer leaves ink along its way');
  let rightward = 0;
  for (let n = 0; n < dragged.u.length; n += 1) rightward += dragged.u[n];
  assert.ok(rightward > 1, 'and drags the water the way it went');
  assert.equal(total(stirred('stir', false)), 0, 'a pointer that is not moving leaves nothing');
  assert.equal(total(stirred('ignore', true)), 0, 'POINTER on IGNORE: nothing');
  const jumped = world();
  jumped.env.pointer = { x: 2, y: 2, down: false };
  F.stepFluid(jumped.state, quiet({ pointer: 'stir' }), jumped.env);
  jumped.env.pointer = { x: 60, y: 44, down: false };
  F.stepFluid(jumped.state, quiet({ pointer: 'stir' }), jumped.env);
  assert.equal(total(jumped.state), 0, 'a pointer that jumps across the screen (back from another window) is not a stroke');
}
{
  const alone = world();
  run(alone.state, quiet({ auto: 60 }), alone.env, 200);
  assert.ok(total(alone.state) > 1, 'AUTO SPLATS: ink arrives by itself');
  // Walls: nothing moves and nothing is inked inside a solid.
  const box = { x0: 20, y0: 15, x1: 44, y1: 33 };
  const { state, env } = world(64, 48, [box]);
  const values = quiet({ auto: 100, swirl: 60 });
  for (let n = 0; n < 200; n += 1) {
    if (n % 20 === 0) F.splat(state, 32, 24, 30, 10, 6, 1, n);
    F.stepFluid(state, values, env);
  }
  let inside = 0;
  for (let y = box.y0; y < box.y1; y += 1) for (let x = box.x0; x < box.x1; x += 1) {
    const n = x + 1 + 66 * (y + 1);
    inside += Math.abs(state.u[n]) + Math.abs(state.v[n]) + state.ink[0][n] + state.ink[1][n] + state.ink[2][n];
  }
  assert.equal(inside, 0, 'WINDOWS ARE SOLID: no water moves and no ink lies under the site window');
  assert.ok(total(state) > 1, 'while there is ink everywhere else');
  const open = world(64, 48, [box]);
  F.stepFluid(open.state, quiet({ walls: false }), open.env);
  F.splat(open.state, 32, 24, 0, 0, 5, 1, 0);
  assert.ok(open.state.ink[0][33 + 66 * 25] > 0.5, 'switched off, ink goes there like anywhere');
}
{
  const { state, env } = world();
  F.fluidAction(state, 'splat', quiet(), env);
  const splashed = total(state);
  assert.ok(splashed > 5, 'SPLAT: a burst of ink');
  F.stepFluid(state, quiet(), env);
  assert.ok(state.flowNow > 0, 'with a push in it');
  F.fluidAction(state, 'calm', quiet(), env);
  assert.ok(state.u.every((v) => v === 0) && state.v.every((v) => v === 0) && total(state) > splashed * 0.8, 'CALM: the water stops, the ink stays');
  F.fluidPress(state, 5, 5, quiet(), env);
  assert.ok(state.ink.some((one) => one[6 + 66 * 6] > 0.5), 'a press on the background is a splat there');
  F.fluidAction(state, 'clear', quiet(), env);
  assert.equal(total(state), 0, 'CLEAR: clean water');
}

/* ------------------------------------------------------------------ 4. the picture */
{
  // (Dyes as unlike one another as the real ones are, so two colour sets can't look the same by accident.)
  const palette = Object.fromEntries(E.DYES.map((name, n) => [name, E.pixel((n * 97 + 20) % 256, (n * 57 + 140) % 256, (n * 151 + 60) % 256)]));
  const { state, env } = world(32, 24);
  const blank = new Uint32Array(32 * 24).fill(7);
  F.renderFluid(state, D, blank, palette);
  assert.ok(blank.every((p) => p === 0), 'no ink: every cell left for the black behind');
  F.burst(state, 8, quiet(), env);
  run(state, quiet(), env, 10);
  const draw = (changes) => {
    const pixels = new Uint32Array(32 * 24);
    F.renderFluid(state, K.parseValues(FLUID_DEF, { ...D, ...changes }), pixels, palette);
    return pixels;
  };
  const drawn = draw({});
  assert.ok(drawn.some((p) => p !== 0) && drawn.every((p) => p === 0 || p >>> 24 === 255), 'ink is drawn in solid colours');
  const levels = (pixels) => new Set(Array.from(pixels).flatMap((p) => (p === 0 ? [] : [p & 255, (p >>> 8) & 255, (p >>> 16) & 255])));
  assert.ok(levels(draw({ steps: 2, dither: 0 })).size <= 2 && levels(draw({ steps: 4, dither: 100 })).size <= 4 && levels(draw({ steps: 8 })).size > 4, 'COLOUR STEPS: each ink is cut to that many shades, whatever the dither');
  assert.notDeepEqual(Array.from(draw({ steps: 3, dither: 0 })), Array.from(draw({ steps: 3, dither: 100 })), 'DITHER: the shades are speckled into one another');
  const sets = ['dyes', 'fire', 'sea', 'mono', 'rainbow'].map((colours) => Array.from(draw({ colours, steps: 8, dither: 0 })).join(','));
  assert.equal(new Set(sets).size, 5, 'each colour set is its own');
  const at = (pixels, x, y) => pixels[y * 32 + x];
  const two = draw({ mirror: '2', dither: 0 });
  const four = draw({ mirror: '4', dither: 0 });
  const eight = draw({ mirror: '8', dither: 0 });
  for (let y = 0; y < 24; y += 1) for (let x = 0; x < 16; x += 1) {
    assert.equal(at(two, x, y), at(two, 31 - x, y), 'KALEIDOSCOPE 2: left and right the same');
    assert.equal(at(four, x, y), at(four, 31 - x, y), 'KALEIDOSCOPE 4: left and right');
    assert.equal(at(four, x, y), at(four, x, 23 - y), 'and top and bottom');
    assert.equal(at(eight, x, y), at(eight, 31 - x, 23 - y), 'KALEIDOSCOPE 8: every corner');
  }
  assert.notDeepEqual(Array.from(four), Array.from(eight), 'and 8 folds once more than 4');
  assert.notDeepEqual(Array.from(draw({ mirror: 'off', dither: 0 })), Array.from(two), 'OFF is the water as it is');
}

/* ------------------------------------------------------------------ 5. in range, and never breaking */
assert.ok(K.sameValues(FLUID_DEF, FLUID_DEF.looks[0].values, D), 'the first look is FLUID as it comes');
assert.deepEqual(FLUID_DEF.looks.map((look) => look.label), ['INK', 'SMOKE', 'LAVA', 'OIL SLICK'], 'the looks along the foot');
assert.equal(F.fluidEngine.cell(D), 10, 'a square of water is ten screen pixels as it comes');
assert.equal(F.fluidEngine.rate(D), 30, 'thirty steps a second');
{
  const { env } = world(48, 27);
  const started = F.fluidEngine.init(env, D);
  assert.ok(total(started) > 1, 'it starts with a few splats, so there is something to see at once');
}
for (const values of [...FLUID_DEF.looks.map((look) => look.values), ...Array.from({ length: 6 }, (_, n) => K.partyValues(FLUID_DEF, seeded(n + 1))), K.parseValues(FLUID_DEF, { ...D, time: 3, push: 100, swirl: 100, auto: 100, buoyancy: 100, windX: -100, thickness: 0, fade: 100 })]) {
  assert.deepEqual(K.parseValues(FLUID_DEF, values), values, 'a look or a party reads back as itself');
  const { state, env } = world(96, 54, [{ x0: 20, y0: 10, x1: 76, y1: 44 }], 3);
  let fastest = 0;
  for (let n = 0; n < 600; n += 1) {
    env.pointer = { x: 48 + Math.sin(n / 9) * 40, y: 27 + Math.cos(n / 7) * 20, down: false };
    F.stepFluid(state, values, env);
    if (n % 100 === 50) F.fluidAction(state, ['splat', 'calm', 'splat', 'clear', 'splat', 'splat'][Math.floor(n / 100)], values, env);
    if (n % 60 === 0) F.fluidPress(state, (n * 7) % 96, (n * 3) % 54, values, env);
    if (n % 50 === 0) {
      assert.ok(finite(state), 'every number stays a number');
      for (let i = 0; i < state.u.length; i += 1) fastest = Math.max(fastest, Math.abs(state.u[i]), Math.abs(state.v[i]));
    }
  }
  assert.ok(fastest < 2000, `and the water never runs away with itself (fastest ${Math.round(fastest)} cells a second)`);
  assert.ok(state.ink.every((one) => one.every((v) => v >= 0 && v <= 4)), 'nor the ink');
  assert.ok(F.fluidEngine.meters(state).every((meter) => Number.isFinite(meter.value)), 'and the meters have numbers');
}

console.log('backdrop: fluid');
console.log('  still   : clean still water rests; ink in still water stays put');
console.log('  moving  : a push carries ink its way; the pressure step stops the water bunching');
console.log('  knobs   : ink lasts, thickness, swirl, buoyancy, wind, pointer, auto splats, solid windows; splat, calm, clear, a press');
console.log('  picture : empty left empty, colour steps, dither, five colour sets, kaleidoscope 2 / 4 / 8');
console.log('  range   : 4 looks, 6 parties and everything-at-once, 600 steps each: finite and bounded');
