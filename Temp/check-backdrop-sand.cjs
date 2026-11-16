/**
 * SAND (SPEC-backgrounds.md): the falling-sand background's own simulation, run with no browser.
 *
 * Held here:
 *   1. nothing is made or lost by falling: with no rain, drain, fire, growth or drying, every kind of grain is still there,
 *      to the grain, hundreds of steps on;
 *   2. sand comes to rest - on the floor, and on anything solid (the site window) - and nothing is ever inside a solid;
 *   3. water finds its level, sand sinks through it, oil floats on it;
 *   4. fire eats plant and oil and goes out; water puts it out; plant grows through water;
 *   5. the knobs: pouring only while held and only within the brush, rubbing out, rain and its width, the open floor,
 *      gravity turned over, wind, sifting, evaporating; the one-press keys;
 *   6. the picture: empty cells are left empty, grains get a dye, every colour set differs;
 *   7. its knobs, looks and parties are in range, and a long run with everything on never breaks.
 *
 * Compiled fresh on every run:
 *   npx tsc app/lib/backdrops/sand/sim.ts app/lib/backdrops/sand/def.ts app/lib/backdrops/engine.ts app/lib/backdrops/knobs.ts --outDir Temp/backdrop-sand-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, 'backdrop-sand-out');
const S = require(path.join(OUT, 'sand/sim.js'));
const { SAND_DEF } = require(path.join(OUT, 'sand/def.js'));
const K = require(path.join(OUT, 'knobs.js'));
const E = require(path.join(OUT, 'engine.js'));

const seeded = (seed) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const D = SAND_DEF.defaults;
/** Settings with nothing happening by itself: no rain, a shut floor, no sifting. */
const quiet = (changes = {}) => K.parseValues(SAND_DEF, { ...D, rain: 0, drain: false, sift: 0, grow: 0, evaporate: 0, ...changes });
const world = (w, h, solids = [], seed = 7) => ({ state: S.newSand(w, h), env: { w, h, pointer: null, solids, random: seeded(seed) } });
const run = (state, values, env, steps) => {
  for (let n = 0; n < steps; n += 1) S.stepSand(state, values, env);
};
const count = (state, kind) => state.cells.reduce((sum, cell) => sum + (cell === kind ? 1 : 0), 0);
const at = (state, x, y) => state.cells[y * state.w + x];
const KINDS = { sand: S.SAND, water: S.WATER, stone: S.STONE, plant: S.PLANT, fire: S.FIRE, smoke: S.SMOKE, oil: S.OIL };

/* ------------------------------------------------------------------ 1. nothing made, nothing lost */
{
  const { state, env } = world(60, 40);
  const fill = seeded(3);
  for (let y = 0; y < 25; y += 1) for (let x = 0; x < 60; x += 1) {
    const r = fill();
    if (r < 0.2) S.place(state, x, y, S.SAND, fill);
    else if (r < 0.35) S.place(state, x, y, S.WATER, fill);
    else if (r < 0.42) S.place(state, x, y, S.OIL, fill);
    else if (r < 0.46) S.place(state, x, y, S.STONE, fill);
  }
  const before = Object.fromEntries(Object.entries(KINDS).map(([name, kind]) => [name, count(state, kind)]));
  run(state, quiet(), env, 600);
  const after = Object.fromEntries(Object.entries(KINDS).map(([name, kind]) => [name, count(state, kind)]));
  assert.deepEqual(after, before, 'falling, sinking and running make and lose no grain of any kind');
  assert.ok(before.sand > 200 && before.water > 150, 'a fair test: plenty of grains');
}

/* ------------------------------------------------------------------ 2. coming to rest, and solids */
{
  const { state, env } = world(40, 30);
  for (let n = 0; n < 60; n += 1) S.place(state, 20, n % 10, S.SAND, env.random), run(state, quiet(), env, 3);
  run(state, quiet(), env, 200);
  const snapshot = Array.from(state.cells);
  run(state, quiet(), env, 50);
  assert.deepEqual(Array.from(state.cells), snapshot, 'a heap of sand comes to rest and stays');
  for (let y = 0; y < 29; y += 1) for (let x = 0; x < 40; x += 1) if (at(state, x, y) === S.SAND) assert.notEqual(at(state, x, y + 1), S.EMPTY, 'no resting grain has nothing under it');
  assert.equal(at(state, 20, 29), S.SAND, 'the heap stands on the floor');
  const heights = [];
  for (let x = 0; x < 40; x += 1) heights.push(Array.from({ length: 30 }, (_, y) => at(state, x, y)).filter((c) => c === S.SAND).length);
  assert.ok(Math.max(...heights) < 30 && heights.filter((n) => n > 0).length >= 5, `it slides out into a heap, not a tower (${heights.filter((n) => n > 0).length} columns wide)`);
}
{
  // The site window: a solid box in the middle. Sand lands on its top edge and nothing is ever inside it.
  const box = { x0: 10, y0: 15, x1: 30, y1: 25 };
  const { state, env } = world(40, 30, [box]);
  const values = quiet();
  for (let n = 0; n < 200; n += 1) {
    S.place(state, 12 + (n % 16), 0, S.SAND, env.random);
    S.stepSand(state, values, env);
    for (let y = box.y0; y < box.y1; y += 1) for (let x = box.x0; x < box.x1; x += 1) assert.equal(at(state, x, y), S.EMPTY, 'nothing gets inside a solid');
  }
  run(state, values, env, 100);
  const onTop = Array.from({ length: 20 }, (_, n) => at(state, 10 + n, 14)).filter((c) => c === S.SAND).length;
  assert.ok(onTop >= 12, `sand heaps on the window's top edge (${onTop} of 20 cells along it)`);
  const off = quiet({ solid: false });
  run(state, off, env, 200);
  assert.ok(count(state, S.SAND) > 0 && Array.from({ length: 20 }, (_, n) => at(state, 10 + n, 14)).every((c) => c === S.EMPTY), 'WINDOWS ARE SOLID off: it falls straight through to the floor');
}

/* ------------------------------------------------------------------ 3. water, and what floats */
{
  const { state, env } = world(40, 20);
  for (let n = 0; n < 120; n += 1) S.place(state, 5, n % 6, S.WATER, env.random), run(state, quiet(), env, 2);
  run(state, quiet(), env, 600);
  const depth = [];
  for (let x = 0; x < 40; x += 1) depth.push(Array.from({ length: 20 }, (_, y) => at(state, x, y)).filter((c) => c === S.WATER).length);
  assert.ok(Math.max(...depth) - Math.min(...depth) <= 1, `water poured in one corner finds its level (${Math.min(...depth)} to ${Math.max(...depth)} deep)`);
}
{
  const { state, env } = world(10, 20);
  for (let y = 10; y < 20; y += 1) for (let x = 0; x < 10; x += 1) S.place(state, x, y, y < 15 ? S.SAND : y < 18 ? S.OIL : S.WATER, env.random);
  run(state, quiet(), env, 800);
  const rowOf = (kind) => {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < 20; y += 1) for (let x = 0; x < 10; x += 1) if (at(state, x, y) === kind) (sum += y), (n += 1);
    return sum / n;
  };
  assert.ok(rowOf(S.SAND) > rowOf(S.WATER) && rowOf(S.WATER) > rowOf(S.OIL), 'stacked upside down, they sort themselves: sand at the bottom, water over it, oil on top');
}

/* ------------------------------------------------------------------ 4. fire and life */
{
  const { state, env } = world(30, 20);
  for (let y = 12; y < 20; y += 1) for (let x = 5; x < 25; x += 1) S.place(state, x, y, S.PLANT, env.random);
  const plants = count(state, S.PLANT);
  S.place(state, 15, 11, S.FIRE, env.random, 30);
  const values = quiet({ fireSpread: 100 });
  let smoke = 0;
  for (let n = 0; n < 900; n += 1) {
    S.stepSand(state, values, env);
    smoke = Math.max(smoke, count(state, S.SMOKE));
  }
  assert.ok(count(state, S.PLANT) < plants * 0.2, `fire eats plant (${count(state, S.PLANT)} of ${plants} left)`);
  assert.ok(smoke > 0, 'and leaves smoke');
  assert.equal(count(state, S.FIRE) + count(state, S.SMOKE), 0, 'then burns out, and the smoke clears');
  const { state: calm, env: calmEnv } = world(30, 20);
  for (let y = 12; y < 20; y += 1) for (let x = 5; x < 25; x += 1) S.place(calm, x, y, S.PLANT, calmEnv.random);
  S.place(calm, 15, 11, S.FIRE, calmEnv.random, 30);
  run(calm, quiet({ fireSpread: 0 }), calmEnv, 300);
  assert.equal(count(calm, S.PLANT), plants, 'FIRE SPREADS at nothing: the plant is untouched');
}
{
  const { state, env } = world(20, 10);
  for (let x = 0; x < 20; x += 1) S.place(state, x, 9, S.WATER, env.random), S.place(state, x, 8, S.FIRE, env.random, 200);
  run(state, quiet(), env, 3);
  assert.equal(count(state, S.FIRE), 0, 'water puts fire out');
}
{
  const { state, env } = world(20, 10);
  for (let y = 5; y < 10; y += 1) for (let x = 0; x < 20; x += 1) S.place(state, x, y, S.WATER, env.random);
  S.place(state, 10, 9, S.PLANT, env.random);
  run(state, quiet({ grow: 100 }), env, 600);
  assert.ok(count(state, S.PLANT) > 40, `plant grows through water (${count(state, S.PLANT)} cells)`);
  assert.equal(count(state, S.PLANT) + count(state, S.WATER), 100, 'each new cell of plant is a cell of water drunk');
}

/* ------------------------------------------------------------------ 5. the knobs */
{
  // Pouring: only while held, only within the brush.
  const { state, env } = world(40, 40);
  env.pointer = { x: 20, y: 5, down: false };
  run(state, quiet({ gravity: 0 }), env, 20);
  assert.equal(count(state, S.SAND), 0, 'a pointer that is not held down pours nothing');
  env.pointer = { x: 20, y: 5, down: true };
  run(state, quiet({ gravity: 0, brush: 3, pour: 100 }), env, 30);
  let outside = 0;
  for (let y = 0; y < 40; y += 1) for (let x = 0; x < 40; x += 1) if (at(state, x, y) !== S.EMPTY && Math.hypot(x - 20, y - 5) > 3.01) outside += 1;
  assert.ok(count(state, S.SAND) >= 20 && outside === 0, `held down, sand comes out within the brush and nowhere else (${count(state, S.SAND)} grains)`);
  run(state, quiet({ gravity: 0, brush: 6, grain: 'erase', pour: 100 }), env, 5);
  assert.equal(count(state, S.SAND), 0, 'RUB OUT takes it away again');
  for (const [grain, kind] of [['water', S.WATER], ['stone', S.STONE], ['plant', S.PLANT], ['oil', S.OIL]]) {
    const fresh = world(40, 40);
    fresh.env.pointer = { x: 20, y: 20, down: true };
    run(fresh.state, quiet({ gravity: 0, grain, pour: 100, flow: 1 }), fresh.env, 3);
    assert.ok(count(fresh.state, kind) > 5, `GRAIN ${grain}: that is what comes out`);
  }
}
{
  // Rain, its width, and the open floor.
  const none = world(100, 40);
  run(none.state, quiet(), none.env, 100);
  assert.equal(none.state.cells.some((c) => c !== S.EMPTY), false, 'RAIN at nothing: an empty sky');
  const wide = world(100, 40);
  run(wide.state, quiet({ rain: 50 }), wide.env, 300);
  const columns = (state) => new Set(Array.from(state.cells.keys()).filter((i) => state.cells[i] !== S.EMPTY).map((i) => i % state.w));
  assert.ok(count(wide.state, S.SAND) > 100 && columns(wide.state).size > 80, 'RAIN: sand falls by itself, right across');
  const thin = world(100, 40);
  run(thin.state, quiet({ rain: 50, rainWide: 10 }), thin.env, 30);
  assert.ok([...columns(thin.state)].every((x) => x >= 44 && x <= 55), 'RAIN WIDTH 10%: only down the middle');
  const wet = world(100, 40);
  run(wet.state, quiet({ rain: 50, rainOf: 'water' }), wet.env, 100);
  assert.ok(count(wet.state, S.WATER) > 50 && count(wet.state, S.SAND) === 0, 'RAIN OF water: water');
  const mixed = world(100, 40);
  run(mixed.state, quiet({ rain: 80, rainOf: 'mix' }), mixed.env, 100);
  assert.ok(new Set(mixed.state.cells).size >= 4, 'RAIN OF mix: several kinds');
  // A strip along the top that is solid (the guest strip): the rain comes in under it, not behind it.
  const strip = world(100, 40, [{ x0: 0, y0: 0, x1: 100, y1: 6 }]);
  run(strip.state, quiet({ rain: 50 }), strip.env, 20);
  assert.ok(count(strip.state, S.SAND) > 10, `rain still falls when the top of the screen is covered (${count(strip.state, S.SAND)} grains)`);
  for (let y = 0; y < 6; y += 1) for (let x = 0; x < 100; x += 1) assert.equal(at(strip.state, x, y), S.EMPTY, 'and none of it is behind the strip');
  const open = world(100, 40);
  run(open.state, quiet({ rain: 50, drain: true }), open.env, 1500);
  assert.ok(count(open.state, S.SAND) < 400, `OPEN FLOOR: it falls out of the bottom and never fills (${count(open.state, S.SAND)} grains in the air)`);
  const shut = world(100, 40);
  run(shut.state, quiet({ rain: 50 }), shut.env, 1500);
  assert.ok(count(shut.state, S.SAND) > 1000, 'shut, it piles up');
}
{
  // Gravity turned over, wind, sifting, drying up.
  const up = world(20, 20);
  S.place(up.state, 10, 10, S.SAND, up.env.random);
  run(up.state, quiet({ gravity: -100 }), up.env, 30);
  assert.equal(at(up.state, 10, 0), S.SAND, 'GRAVITY below nothing: sand falls upwards');
  const still = world(20, 20);
  S.place(still.state, 10, 10, S.SAND, still.env.random);
  run(still.state, quiet({ gravity: 0 }), still.env, 30);
  assert.equal(at(still.state, 10, 10), S.SAND, 'at nothing it hangs where it is');
  const slow = world(20, 200);
  S.place(slow.state, 10, 0, S.SAND, slow.env.random);
  run(slow.state, quiet({ gravity: 30 }), slow.env, 100);
  const fell = Array.from(slow.state.cells).indexOf(S.SAND) / 20;
  assert.ok(fell > 10 && fell < 55, `weak gravity is a slow fall (${Math.floor(fell)} cells in 100 steps)`);
  const mean = (wind) => {
    const blown = world(200, 60, [], 11);
    for (let n = 0; n < 40; n += 1) S.place(blown.state, 100, 0, S.SAND, blown.env.random), run(blown.state, quiet({ wind }), blown.env, 2);
    run(blown.state, quiet({ wind }), blown.env, 80);
    const xs = Array.from(blown.state.cells.keys()).filter((i) => blown.state.cells[i] === S.SAND).map((i) => i % 200);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  assert.ok(mean(100) > 108 && mean(-100) < 92 && Math.abs(mean(0) - 100) < 4, `WIND carries falling sand its way (${Math.round(mean(-100))}, ${Math.round(mean(0))}, ${Math.round(mean(100))})`);
  const box = { x0: 0, y0: 20, x1: 40, y1: 30 };
  const sifted = world(40, 30, [box]);
  for (let x = 0; x < 40; x += 1) for (let y = 15; y < 20; y += 1) S.place(sifted.state, x, y, S.SAND, sifted.env.random);
  run(sifted.state, quiet({ sift: 100 }), sifted.env, 600);
  assert.ok(count(sifted.state, S.SAND) < 60, `SIFT: a heap resting on a window sifts away through it (${count(sifted.state, S.SAND)} of 200 left)`);
  const kept = world(40, 30, [box]);
  for (let x = 0; x < 40; x += 1) for (let y = 15; y < 20; y += 1) S.place(kept.state, x, y, S.SAND, kept.env.random);
  run(kept.state, quiet(), kept.env, 600);
  assert.equal(count(kept.state, S.SAND), 200, 'at nothing, it stays');
  const pond = world(30, 10);
  for (let x = 0; x < 30; x += 1) for (let y = 7; y < 10; y += 1) S.place(pond.state, x, y, S.WATER, pond.env.random);
  run(pond.state, quiet({ evaporate: 100 }), pond.env, 2000);
  assert.ok(count(pond.state, S.WATER) < 30, `EVAPORATE: open water dries up (${count(pond.state, S.WATER)} of 90 left)`);
}
{
  // The one-press keys.
  const { state, env } = world(40, 30);
  for (let x = 0; x < 40; x += 1) S.place(state, x, 29, S.SAND, env.random), S.place(state, x, 28, S.PLANT, env.random);
  const snapshot = Array.from(state.cells);
  S.sandAction(state, 'shake', quiet(), env);
  assert.ok(count(state, S.SAND) === 40 && Array.from(state.cells).some((c, i) => c !== snapshot[i]), 'SHAKE: the loose grains jump, and none is lost');
  assert.equal(count(state, S.PLANT), 40, 'what is rooted stays');
  S.sandAction(state, 'burn', quiet(), env);
  assert.ok(count(state, S.FIRE) > 5, 'BURN: the plant catches');
  S.sandAction(state, 'flood', quiet(), env);
  assert.ok(count(state, S.WATER) > 100, 'FLOOD: water in the bottom third');
  S.sandAction(state, 'clear', quiet(), env);
  assert.equal(state.cells.some((c) => c !== S.EMPTY), false, 'CLEAR: nothing left');
}

/* ------------------------------------------------------------------ 6. the picture */
{
  const palette = Object.fromEntries(E.DYES.map((name, n) => [name, E.pixel(10 + n * 9, 250 - n * 9, (n * 37) % 256)]));
  const { state, env } = world(8, 2);
  [S.SAND, S.WATER, S.STONE, S.PLANT, S.FIRE, S.SMOKE, S.OIL].forEach((kind, x) => S.place(state, x, 0, kind, env.random, 20));
  const pictures = {};
  for (const colours of ['dyes', 'desert', 'neon', 'mono']) {
    const pixels = new Uint32Array(16);
    S.renderSand(state, K.parseValues(SAND_DEF, { ...D, colours }), pixels, palette);
    for (let x = 0; x < 7; x += 1) assert.ok(pixels[x] >>> 24 === 255, `${colours}: a grain is a solid colour`);
    for (let x = 7; x < 16; x += 1) assert.equal(pixels[x], 0, `${colours}: an empty cell is left for the black behind`);
    assert.equal(new Set(Array.from(pixels.slice(0, 7))).size, 7, `${colours}: each kind of grain looks different`);
    pictures[colours] = Array.from(pixels).join(',');
  }
  assert.equal(new Set(Object.values(pictures)).size, 4, 'and each colour set is its own');
  const flat = new Uint32Array(16);
  const speckled = new Uint32Array(16);
  const many = world(16, 1);
  for (let x = 0; x < 16; x += 1) S.place(many.state, x, 0, S.SAND, many.env.random);
  S.renderSand(many.state, K.parseValues(SAND_DEF, { ...D, speckle: 0 }), flat, palette);
  S.renderSand(many.state, K.parseValues(SAND_DEF, { ...D, speckle: 100 }), speckled, palette);
  assert.ok(new Set(flat).size === 1 && new Set(speckled).size > 4, 'SPECKLE: from every grain alike to every grain its own shade');
  assert.equal(E.mix(E.pixel(0, 0, 0), E.pixel(200, 100, 50), 0.5), E.pixel(100, 50, 25), 'two colours mixed are half way between');
  assert.equal(E.pixelFromHex('#1d3ca6'), E.pixel(0x1d, 0x3c, 0xa6), 'a token`s value becomes a pixel');
  assert.equal(E.pixelFromHex('blue'), null, 'and anything else does not');
}

/* ------------------------------------------------------------------ 7. in range, and never breaking */
assert.ok(K.sameValues(SAND_DEF, SAND_DEF.looks[0].values, D), 'the first look is SAND as it comes');
assert.deepEqual(SAND_DEF.looks.map((look) => look.label), ['DUNES', 'RAINSTORM', 'FOREST FIRE', 'HOURGLASS'], 'the looks along the foot');
assert.equal(S.sandEngine.cell(D), 4, 'a grain is four screen pixels as it comes');
assert.equal(S.sandEngine.rate(D), 30, 'thirty steps a second');
for (const values of [...SAND_DEF.looks.map((look) => look.values), ...Array.from({ length: 6 }, (_, n) => K.partyValues(SAND_DEF, seeded(n + 1)))]) {
  assert.deepEqual(K.parseValues(SAND_DEF, values), values, 'a look or a party reads back as itself');
  const box = { x0: 30, y0: 20, x1: 90, y1: 45 };
  const { state, env } = world(120, 68, [box], 5);
  for (let n = 0; n < 900; n += 1) {
    env.pointer = { x: (n * 7) % 120, y: (n * 3) % 68, down: n % 40 < 20 };
    S.stepSand(state, values, env);
    if (n % 150 === 149) S.sandAction(state, ['shake', 'flood', 'burn', 'shake', 'clear', 'burn'][Math.floor(n / 150)], values, env);
    if (n % 30 === 0) for (let y = box.y0; y < box.y1; y += 1) for (let x = box.x0; x < box.x1; x += 1) assert.equal(at(state, x, y), S.EMPTY, 'nothing ever gets inside the window');
  }
  assert.ok(state.cells.every((c) => c <= S.OIL), 'every cell holds a kind of grain that exists');
  assert.ok(S.sandEngine.meters(state)[0].value >= 0, 'and the meter has a number');
}

console.log('backdrop: sand');
console.log('  grains  : falling, sinking and running make and lose none; heaps come to rest; nothing is ever inside a solid');
console.log('  liquids : water finds its level; sand, water and oil sort themselves');
console.log('  fire    : eats plant and oil and burns out; water puts it out; plant grows through water');
console.log('  knobs   : brush, rub out, rain and its width, open floor, gravity, wind, sift, evaporate; shake, burn, flood, clear');
console.log('  picture : empty left empty, each kind its own dye, four colour sets, speckle');
console.log('  range   : 4 looks and 6 parties, 900 steps each with a pointer pouring and every key pressed');
