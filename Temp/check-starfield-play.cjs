/**
 * STARFIELD's stars answer a press (SPEC-backgrounds.md, "A star, pressed"; Luke, 2026-11-28), run with no browser.
 *
 * Compiled fresh on every run:
 *   npx tsc app/lib/backdrops/starfield/sim.ts app/lib/backdrops/starfield/def.ts app/lib/backdrops/engine.ts app/lib/backdrops/knobs.ts --outDir Temp/starfield-play-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const OUT = path.join(__dirname, 'starfield-play-out');
const ST = require(path.join(OUT, 'starfield/sim.js'));
const { STARFIELD_DEF } = require(path.join(OUT, 'starfield/def.js'));
const K = require(path.join(OUT, 'knobs.js'));
const E = require(path.join(OUT, 'engine.js'));

const seeded = (seed) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const palette = Object.fromEntries(E.DYES.map((name, n) => [name, E.pixel((n * 97 + 20) % 256, (n * 57 + 140) % 256, (n * 151 + 60) % 256)]));
const W = 320;
const H = 180;
const envOf = (seed = 7) => ({ w: W, h: H, pointer: null, solids: [], random: seeded(seed) });
const engine = ST.starfieldEngine;

/* ------------------------------------------------------------------ OFF is the starfield as it was */

/**
 * A fingerprint of whole runs through the engine's own doors (init, step, press, render), with a press now and then: every
 * star's place and light and every cell of the picture, every ten steps. Recorded from the starfield as it was before a star
 * could be pressed (commit 7bb62731): if OFF ever takes a different step, the number changes.
 */
function fingerprint(extra) {
  const hash = crypto.createHash('sha256');
  const settings = [
    {},
    { speed: 85, warp: 80, spin: 15, stars: 500, colours: 'rainbow' },
    { speed: 0, fall: 35, wind: 15, size: 3, spread: 100, warp: 0 },
    { reverse: true, speed: 60, steer: true, time: 2 },
  ];
  for (const [n, changes] of settings.entries()) {
    const values = { ...K.parseValues(STARFIELD_DEF, { ...STARFIELD_DEF.defaults, ...changes }), ...extra };
    const env = envOf(n + 3);
    const state = engine.init(env, values);
    const pixels = new Uint32Array(W * H);
    for (let step = 0; step < 400; step += 1) {
      env.pointer = { x: (step * 5) % W, y: (step * 3) % H, down: step % 90 < 20 };
      if (step % 130 === 60) {
        // On a star where there is one, else on empty sky: both are presses today's starfield answers the same way.
        let at = [3, 3];
        for (let i = 0; i < state.count; i += 1) {
          if (state.lit[i] > 0 && state.sx[i] >= 0 && state.sx[i] < W && state.sy[i] >= 0 && state.sy[i] < H) {
            at = [state.sx[i], state.sy[i]];
            break;
          }
        }
        engine.press(state, at[0], at[1], values, env);
      }
      engine.step(state, values, env);
      if (step % 10 === 0) {
        engine.render(state, values, pixels, palette, env);
        hash.update(Buffer.from(pixels.buffer));
        for (const field of [state.x, state.y, state.z, state.ox, state.oy, state.px, state.py, state.sx, state.sy, state.lit]) hash.update(Buffer.from(field.buffer));
        hash.update(`${state.count},${state.t},${state.hyper},${state.cx},${state.cy},${state.inView}`);
      }
    }
  }
  return hash.digest('hex');
}

const AS_IT_WAS = '96e3d6609c9904287f85d93d5ed5d797e7b4bc64460f29155dd2bacdf3ef0a1c';

if (process.argv.includes('--record')) {
  console.log(fingerprint({}));
  process.exit(0);
}
assert.equal(fingerprint({ touch: 'off' }), AS_IT_WAS, 'OFF: the starfield runs as it did before, step for step and cell for cell');

/* ------------------------------------------------------------------ helpers */

const CELL = 3;
const MODES = ['nudge', 'laser', 'throw', 'pull', 'burst', 'tie'];
/** A still sky (SPEED nothing), so what moves is what the press moved. */
const still = (changes = {}) => K.parseValues(STARFIELD_DEF, { ...STARFIELD_DEF.defaults, twinkle: 0, speed: 0, warp: 0, ...changes });
const FIELDS = ['x', 'y', 'z', 'ox', 'oy', 'sx', 'sy', 'lit'];
const sky = (s) => [s.count, s.hyper, ...FIELDS.map((f) => Array.from(s[f].slice(0, s.count)).join(','))].join('|');
const picture = (s, values) => {
  const pixels = new Uint32Array(s.w * s.h);
  engine.render(s, values, pixels, palette, envOf());
  return pixels;
};
const samePicture = (a, b) => a.every((p, i) => p === b[i]);
const visible = (s, n) => s.lit[n] > 0 && s.sx[n] >= 0 && s.sx[n] < s.w && s.sy[n] >= 0 && s.sy[n] < s.h;

/** Two skies from one seed, run the same: one to press, one to leave alone. */
function twins(values, seed = 11, steps = 5) {
  const make = () => {
    const env = envOf(seed);
    const state = engine.init(env, values);
    for (let n = 0; n < steps; n += 1) engine.step(state, values, env);
    return { state, env };
  };
  const [a, b] = [make(), make()];
  const run = (count, each) => {
    for (let n = 0; n < count; n += 1) {
      engine.step(a.state, values, a.env);
      engine.step(b.state, values, b.env);
      if (each) each(n);
    }
  };
  return { a: a.state, b: b.state, envA: a.env, envB: b.env, run };
}

/** A star well inside the picture with no other star within a reach and a half: a press on it is on it alone. */
function lonely(state, margin = 45) {
  const all = Array.from({ length: state.count }, (_, n) => n).filter((n) => visible(state, n));
  const apart = (n) => Math.min(...all.filter((m) => m !== n).map((m) => Math.hypot(state.sx[m] - state.sx[n], state.sy[m] - state.sy[n])));
  const inside = all.filter((n) => state.sx[n] > margin && state.sx[n] < W - margin && state.sy[n] > margin && state.sy[n] < H - margin);
  assert.ok(inside.length > 0, 'a star to press');
  return inside.sort((m, n) => apart(n) - apart(m))[0];
}

/* ------------------------------------------------------------------ nobody pressing, and the empty sky */

for (const mode of MODES) {
  assert.equal(fingerprintUnpressed({ touch: mode }), fingerprintUnpressed({ touch: 'off' }), `${mode}: with nobody pressing, the very same sky as OFF`);
}
function fingerprintUnpressed(extra) {
  const values = { ...still({ speed: 60, warp: 50, wind: 20 }), ...extra };
  const env = envOf(5);
  const state = engine.init(env, values);
  const hash = crypto.createHash('sha256');
  for (let step = 0; step < 300; step += 1) {
    engine.step(state, values, env);
    if (step % 20 === 0) hash.update(Buffer.from(picture(state, values).buffer)).update(sky(state));
  }
  return hash.digest('hex');
}

/* ------------------------------------------------------------------ the empty sky: one press nothing, two quick ones hyperspace */

/** A place with no star within 20 cells, and another one beside it (or `apart` cells off). */
function emptyPlace(state, apart = 2) {
  const clear = (x, y) => Array.from({ length: state.count }, (_, n) => n).every((n) => !visible(state, n) || Math.hypot(state.sx[n] - x, state.sy[n] - y) > 20);
  for (let x = 2; x < W - apart - 2; x += 5) {
    for (let y = 2; y < H - 2; y += 5) if (clear(x, y) && clear(x + apart, y)) return [[x, y], [x + apart, y]];
  }
  throw new Error('no empty sky');
}

/**
 * Presses on the bare sky as the page makes them: down, a step or more with the button held (the hand moving `drag` cells a
 * step), up, a step, then `wait` steps before the next. `b` is given hyperspace at the very step `a` should take it.
 */
function presses(mode, list, changes = {}) {
  const values = still({ touch: mode, stars: 20, ...changes });
  const pair = twins(values);
  const [first, second] = emptyPlace(pair.a, list.some((each) => each.far) ? 14 : 2);
  let rushedAt = -1;
  let step = 0;
  const go = () => {
    const before = pair.a.hyper;
    engine.step(pair.a, values, pair.envA);
    engine.step(pair.b, values, pair.envB);
    if (before === 0 && pair.a.hyper > 0 && rushedAt === -1) {
      rushedAt = step;
      ST.starsPress(pair.b);
    }
    step += 1;
  };
  for (const [k, { held = 1, drag = 0, wait = 2, quick = false, star = false, far = false }] of list.entries()) {
    let [x, y] = k === 0 ? first : far ? second : [first[0] + 1, first[1]];
    if (star) {
      const n = lonely(pair.a);
      [x, y] = [pair.a.sx[n], pair.a.sy[n]];
    }
    pair.envA.pointer = { x, y, down: !quick };
    engine.press(pair.a, x, y, values, pair.envA);
    if (quick) pair.envA.pointer = { x, y, down: false };
    else {
      for (let n = 0; n < held; n += 1) {
        pair.envA.pointer = { x: x + drag * (n + 1), y, down: true };
        go();
      }
      pair.envA.pointer = { x: x + drag * held, y, down: false };
    }
    go();
    for (let n = 0; n < wait; n += 1) go();
  }
  for (let n = 0; n < 40; n += 1) go();
  return { rushed: rushedAt !== -1, pair, values };
}

for (const mode of MODES) {
  const one = presses(mode, [{}]);
  assert.ok(!one.rushed, `${mode}: one press on empty sky does nothing`);
  assert.equal(sky(one.pair.a), sky(one.pair.b), `${mode}: not one star is moved by it`);
  const two = presses(mode, [{}, {}]);
  assert.ok(two.rushed, `${mode}: two quick presses on empty sky are hyperspace`);
  assert.equal(sky(two.pair.a), sky(two.pair.b), `${mode}: today's hyperspace, and nothing more`);
  assert.ok(presses(mode, [{ quick: true }, { quick: true }]).rushed, `${mode}: also when each is over before a step has seen it`);
  assert.ok(presses(mode, [{}, { wait: 0 }], { time: 2 }).rushed && presses(mode, [{ wait: 8 }, {}], { time: 2 }).rushed, `${mode}: how quick is the reader's clock, not TIME's`);
  assert.ok(!presses(mode, [{ wait: 20 }, {}]).rushed, `${mode}: two slow presses are not a double one`);
  assert.ok(!presses(mode, [{}, { far: true }]).rushed, `${mode}: nor two in different places`);
  assert.ok(!presses(mode, [{ held: 4, drag: 3 }, {}]).rushed, `${mode}: a drag is not a press: the first one dragged`);
  assert.ok(!presses(mode, [{}, { held: 4, drag: 3 }]).rushed, `${mode}: a drag is not a press: the second one dragged`);
  assert.ok(!presses(mode, [{}, { held: 25 }]).rushed, `${mode}: nor one held down a long while`);
  assert.ok(!presses(mode, [{ star: true }, {}]).rushed, `${mode}: a first press on a star and a second beside it: no rush`);
  assert.ok(!presses(mode, [{}, { star: true }, {}]).rushed && !presses(mode, [{ quick: true }, { star: true, quick: true }, { quick: true }]).rushed, `${mode}: a star pressed in between starts the count again`);
  assert.ok(!presses(mode, [{}, {}, { wait: 20 }]).pair.a.touch.miss, `${mode}: and nothing is left waiting`);
}
// Round a fullscreen picture a double press already leaves fullscreen, so there one press on empty sky stays hyperspace.
{
  const values = { ...still({ touch: 'nudge', stars: 20 }), stage: true };
  const pair = twins(values);
  const [[x, y]] = emptyPlace(pair.a);
  engine.press(pair.a, x, y, values, pair.envA);
  assert.ok(pair.a.hyper > 0, 'on a fullscreen surround, one press on empty sky is hyperspace');
}
{
  const off = presses('off', [{}]);
  assert.ok(off.pair.a.touch.miss === null, 'OFF: nothing is counted');
  const values = still({ touch: 'off', stars: 20 });
  const pair = twins(values);
  const [[x, y]] = emptyPlace(pair.a);
  engine.press(pair.a, x, y, values, pair.envA);
  assert.ok(pair.a.hyper > 0, 'OFF: one press on the sky is hyperspace, at once, as before');
}

/* ------------------------------------------------------------------ finding the star */

{
  const values = still({ touch: 'nudge', stars: 20 });
  const reach = 28 / CELL;
  const pressedAt = (dx, solids) => {
    const pair = twins(values);
    const n = lonely(pair.a);
    pair.envA.solids = solids ? [{ x0: pair.a.sx[n] - 2, y0: pair.a.sy[n] - 2, x1: pair.a.sx[n] + 3, y1: pair.a.sy[n] + 3 }] : [];
    engine.press(pair.a, pair.a.sx[n] + dx, pair.a.sy[n], values, pair.envA);
    return pair.a.touch.presses === 1;
  };
  assert.ok(pressedAt(0), 'a press on a star finds it');
  assert.ok(pressedAt(reach - 0.3), 'and one 28 screen pixels off still does');
  assert.ok(!pressedAt(reach + 1), 'one farther off is empty sky');
  assert.ok(!pressedAt(0, true), 'a star under a window is not there to be pressed');

  // Where a moving star just was counts too.
  const flying = still({ touch: 'nudge', stars: 20, speed: 100 });
  const pair = twins(flying, 11, 3);
  const n = Array.from({ length: pair.a.count }, (_, i) => i).filter((i) => visible(pair.a, i) && !Number.isNaN(pair.a.px[i])).sort((i, j) => Math.hypot(pair.a.sx[j] - pair.a.px[j], pair.a.sy[j] - pair.a.py[j]) - Math.hypot(pair.a.sx[i] - pair.a.px[i], pair.a.sy[i] - pair.a.py[i]))[0];
  const step = Math.hypot(pair.a.sx[n] - pair.a.px[n], pair.a.sy[n] - pair.a.py[n]);
  assert.ok(step * 3 > reach + 2, `a star fast enough to have left the reach behind (${step.toFixed(1)} cells a step)`);
  const back = [pair.a.sx[n] + (pair.a.px[n] - pair.a.sx[n]) * 3, pair.a.sy[n] + (pair.a.py[n] - pair.a.sy[n]) * 3];
  engine.press(pair.a, back[0], back[1], flying, pair.envA);
  assert.equal(pair.a.touch.presses, 1, 'a press where it was a tenth of a second ago finds it');
}

/* ------------------------------------------------------------------ NUDGE */

{
  const values = still({ touch: 'nudge' });
  const pair = twins(values);
  const n = lonely(pair.a);
  const [x0, y0] = [pair.a.sx[n], pair.a.sy[n]];
  engine.press(pair.a, x0 + 3, y0, values, pair.envA);
  const off = (m) => Math.hypot(pair.a.sx[m] - pair.b.sx[m], pair.a.sy[m] - pair.b.sy[m]);
  let peak = 0;
  let back = 0;
  let near = 0;
  let far = 0;
  pair.run(30, () => {
    peak = Math.max(peak, off(n));
    back = Math.min(back, pair.a.sx[n] - x0 > 0 ? pair.a.sx[n] - x0 : back);
    for (let m = 0; m < pair.a.count; m += 1) {
      if (m === n || !visible(pair.b, m)) continue;
      const away = Math.hypot(pair.b.sx[m] - x0, pair.b.sy[m] - y0);
      if (away < 70 / CELL) near = Math.max(near, off(m));
      else far = Math.max(far, off(m));
    }
  });
  assert.ok(peak > 9 && peak < 17, `NUDGE: shoved about 40 screen pixels (${(peak * CELL).toFixed(0)}px)`);
  assert.ok(near < peak * 0.55, `its neighbours stir less (${(near * CELL).toFixed(0)}px)`);
  assert.equal(far, 0, 'and stars farther off do not move at all');
  // It went away from the pointer first, then swung through.
  const again = twins(values);
  engine.press(again.a, x0 + 3, y0, values, again.envA);
  const ways = [];
  again.run(30, () => ways.push(again.a.sx[n] - x0));
  assert.ok(ways[1] < -1, 'away from the pointer');
  assert.ok(Math.max(...ways) > 1 && Math.min(...ways) < -5, 'and swinging back past where it was: a spring');
  assert.equal(pair.a.hyper, 0, 'no hyperspace');
  pair.run(90);
  assert.equal(sky(pair.a), sky(pair.b), 'four seconds on, every star is exactly where it would have been');
  assert.ok(samePicture(picture(pair.a, values), picture(pair.b, values)), 'and so is every cell');
}

// A close neighbour does feel it: some, and much less than the star pressed.
for (const mode of ['nudge', 'laser']) {
  const values = still({ touch: mode });
  const pair = twins(values);
  const all = Array.from({ length: pair.a.count }, (_, i) => i).filter((i) => visible(pair.a, i));
  const apart = (i, j) => Math.hypot(pair.a.sx[i] - pair.a.sx[j], pair.a.sy[i] - pair.a.sy[j]);
  let two = null;
  for (const i of all) for (const j of all) if (two === null && i !== j && apart(i, j) > 3 && apart(i, j) < 7) two = [i, j];
  assert.ok(two !== null, 'two stars close together');
  const [n, m] = two;
  const off = (i) => Math.hypot(pair.a.sx[i] - pair.b.sx[i], pair.a.sy[i] - pair.b.sy[i]);
  engine.press(pair.a, pair.a.sx[n], pair.a.sy[n], values, pair.envA);
  let [own, other] = [0, 0];
  pair.run(30, () => {
    own = Math.max(own, off(n));
    other = Math.max(other, off(m));
  });
  assert.ok(other * CELL > 1.5, `${mode}: a neighbour ${(apart(n, m) * CELL).toFixed(0)}px off stirs (${(other * CELL).toFixed(1)}px)`);
  assert.ok(other < own * 0.55, `${mode}: but much less than the star pressed (${(own * CELL).toFixed(0)}px)`);
}

/* ------------------------------------------------------------------ LASER */

{
  const values = still({ touch: 'laser' });
  const pair = twins(values);
  const n = lonely(pair.a);
  const [x0, y0] = [pair.a.sx[n], Math.round(pair.a.sy[n])];
  const left = x0 < W / 2;
  engine.press(pair.a, x0, pair.a.sy[n], values, pair.envA);
  pair.run(1);
  const [hit, plain] = [picture(pair.a, values), picture(pair.b, values)];
  const [from, to] = left ? [0, Math.floor(x0) - 8] : [Math.ceil(x0) + 8, W - 1];
  let lit = 0;
  for (let x = from; x <= to; x += 1) if (hit[y0 * W + x] !== plain[y0 * W + x]) lit += 1;
  assert.ok(lit > (to - from) * 0.75, `LASER: a line one cell wide from the nearer side to the star (${lit} of ${to - from + 1} cells)`);
  let above = 0;
  for (let x = from; x <= to; x += 1) if (hit[(y0 - 6) * W + x] !== plain[(y0 - 6) * W + x]) above += 1;
  assert.ok(above < 6, 'and only one cell wide');
  const cellsNear = (p) => {
    let count = 0;
    for (let y = y0 - 3; y <= y0 + 3; y += 1) for (let x = Math.round(x0) - 7; x <= Math.round(x0) + 7; x += 1) if (p[y * W + x] !== 0) count += 1;
    return count;
  };
  assert.ok(cellsNear(hit) > cellsNear(plain) + 3, 'the star glows bigger, with sparks');
  assert.ok((left ? 1 : -1) * (pair.a.sx[n] - pair.b.sx[n]) > 1, 'and recoils the way the light was going');
  pair.run(6);
  const bright = (p) => {
    let sum = 0;
    for (let x = from; x <= to; x += 1) if (p[y0 * W + x] !== 0) sum += p[y0 * W + x] & 255;
    return sum;
  };
  assert.ok(bright(picture(pair.a, values)) < bright(hit) * 0.35, 'the beam fades fast');
  pair.run(90);
  assert.equal(sky(pair.a), sky(pair.b), 'and a few seconds on, nothing is left of it');
  assert.ok(samePicture(picture(pair.a, values), picture(pair.b, values)), 'not one cell');
}

/* ------------------------------------------------------------------ THROW */

{
  /** Hold the lonely star, move the hand `vx, vy` cells a step for eight steps, let go. */
  const throwOne = (changes, vx, vy) => {
    const values = still({ touch: 'throw', stars: 20, ...changes });
    const pair = twins(values);
    const n = lonely(pair.a, 60);
    let [x, y] = [pair.a.sx[n], pair.a.sy[n]];
    engine.press(pair.a, x, y, values, pair.envA);
    for (let k = 0; k < 8; k += 1) {
      x += vx;
      y += vy;
      pair.envA.pointer = { x, y, down: true };
      pair.run(1);
      assert.ok(Math.abs(pair.a.sx[n] - x) < 1e-3 && Math.abs(pair.a.sy[n] - y) < 1e-3, 'THROW: held, the star is where the hand is');
    }
    pair.envA.pointer = { x: x + 40, y: y + 40, down: false };
    const way = [[pair.a.sx[n], pair.a.sy[n]]];
    const go = (count) => pair.run(count, () => way.push([pair.a.sx[n], pair.a.sy[n]]));
    return { pair, values, n, way, go };
  };
  const moved = (way, k) => [way[k][0] - way[k - 1][0], way[k][1] - way[k - 1][1]];

  const flung = throwOne({}, 4, -2);
  flung.go(2);
  let [dx, dy] = moved(flung.way, 1);
  assert.ok(Math.abs(dx - 4) < 0.05 && Math.abs(dy + 2) < 0.05, `it leaves at the speed and way of the hand (${dx.toFixed(2)}, ${dy.toFixed(2)} a step)`);
  [dx] = moved(flung.way, 2);
  assert.ok(dx < 4 && dx > 3.7, 'and loses it slowly');
  const slow = throwOne({ time: 2 }, 4, -2);
  slow.go(1);
  assert.ok(Math.abs(moved(slow.way, 1)[0] - 4) < 0.05, 'whatever TIME says, it leaves at the hand`s speed');

  const moving = throwOne({ speed: 40, wind: 50, fall: 30 }, 4, -2);
  moving.go(1);
  [dx, dy] = moved(moving.way, 1);
  assert.ok(Math.abs(dx - 4) < 0.05 && Math.abs(dy + 2) < 0.05, `with the sky itself moving, it still leaves at the hand's speed (${dx.toFixed(2)}, ${dy.toFixed(2)})`);

  const falling = throwOne({ fall: 60 }, 3, 0);
  falling.go(20);
  const level = throwOne({}, 3, 0);
  level.go(20);
  assert.ok(moved(falling.way, 10)[1] > moved(falling.way, 1)[1] + 0.2 && moved(falling.way, 20)[1] > moved(falling.way, 10)[1] + 0.2, 'FALL bends its way down, more and more');
  assert.ok(falling.way[20][1] - falling.way[0][1] > level.way[20][1] - level.way[0][1] + 5, 'well below the same throw without it');
  const blown = throwOne({ wind: 100 }, 0, -3);
  blown.go(20);
  const calm = throwOne({}, 0, -3);
  calm.go(20);
  assert.ok(moved(blown.way, 20)[0] > moved(blown.way, 10)[0] + 0.2 && moved(blown.way, 20)[0] > 0.6, 'WIND takes hold of it more and more');
  assert.ok(blown.way[20][0] - blown.way[0][0] > calm.way[20][0] - calm.way[0][0] + 5, 'and carries it sideways of the same throw without it');
  const streak = throwOne({ warp: 100 }, 4, 0);
  streak.go(1);
  const plain = { ...streak.values, warp: 0 };
  const count = (p) => p.reduce((sum, c) => sum + (c !== 0 ? 1 : 0), 0);
  assert.ok(count(picture(streak.pair.a, streak.values)) > count(picture(streak.pair.a, plain)) + 10, 'WARP streaks it');
  const outward = throwOne({ speed: 60 }, 0.001, 0);
  const from = [outward.way[0][0] - outward.pair.a.cx, outward.way[0][1] - outward.pair.a.cy];
  outward.go(11);
  const to = [outward.way[11][0] - outward.pair.a.cx, outward.way[11][1] - outward.pair.a.cy];
  assert.ok(Math.hypot(...to) > Math.hypot(...from) + 0.5, 'SPEED carries it outward with the rest');

  // Thrown hard it leaves the screen and a new star takes its place; nothing is left.
  const away = throwOne({}, 12, 0);
  away.go(150);
  assert.equal(away.pair.a.touch.flights.length, 0, 'a hard throw ends');
  assert.equal(away.pair.a.count, 20, 'and the sky has as many stars as before');
  assert.ok(away.pair.a.z[away.n] === 1 && away.pair.a.x[away.n] >= -1 && away.pair.a.x[away.n] <= 1, 'the one thrown away is a new star far off');
  assert.equal(ST.starfieldEngine.meters(away.pair.a)[0].value, away.pair.a.inView, 'counted');
  assert.deepEqual([away.pair.a.touch.wake.length, away.pair.a.touch.pushes.length], [0, 0], 'with no wake or stir left over');

  // Thrown softly it slows and is a star again where it got to.
  const soft = throwOne({}, 0.8, 0.3);
  soft.go(150);
  assert.equal(soft.pair.a.touch.flights.length, 0, 'a soft throw ends too');
  const rest = [soft.pair.a.sx[soft.n], soft.pair.a.sy[soft.n]];
  assert.ok(rest[0] > soft.way[0][0] + 10, 'farther along than where it was let go');
  soft.go(30);
  assert.ok(Math.hypot(soft.pair.a.sx[soft.n] - rest[0], soft.pair.a.sy[soft.n] - rest[1]) < 0.01, 'and stays there, a star like any other');
  for (let m = 0; m < 20; m += 1) if (m !== soft.n && soft.pair.a.touch.pushes.length === 0) assert.ok(Math.abs(soft.pair.a.x[m] - soft.pair.b.x[m]) < 1e-9, 'the others are where they were');

  // A click without a drag does nothing to the sky.
  const values = still({ touch: 'throw', stars: 20 });
  const pair = twins(values);
  const n = lonely(pair.a);
  engine.press(pair.a, pair.a.sx[n], pair.a.sy[n], values, pair.envA);
  pair.run(30);
  assert.ok(Math.hypot(pair.a.sx[n] - pair.b.sx[n], pair.a.sy[n] - pair.b.sy[n]) < 0.01, 'pressed and let go where it was: it stays');
  assert.equal(pair.a.hyper, 0, 'and no hyperspace');

  for (const held of [0, 4]) {
    const snow = still({ touch: 'throw', stars: 20, wind: 15, fall: 35 });
    const two = twins(snow);
    const m = lonely(two.a, 60);
    const at = { x: two.a.sx[m], y: two.a.sy[m] };
    engine.press(two.a, at.x, at.y, snow, two.envA);
    for (let k = 0; k < held; k += 1) {
      two.envA.pointer = { ...at, down: true };
      two.run(1);
    }
    two.envA.pointer = { ...at, down: false };
    two.run(1);
    const from = [two.a.sx[m], two.a.sy[m]];
    two.run(40);
    const [movedX, movedY] = [two.a.sx[m] - from[0], two.a.sy[m] - from[1]];
    assert.ok(Math.abs(movedX - 6) < 0.05 && Math.abs(movedY - 14) < 0.05, `WIND and FALL on, ${held ? 'held still and let go' : 'only clicked'}: it falls like any other flake (${movedX.toFixed(1)}, ${movedY.toFixed(1)} cells in 40 steps, not 6, 14)`);
  }
}

/* ------------------------------------------------------------------ PULL */

/** Stars round one: how far each is from it, in screen pixels, in the sky left alone. */
const around = (state, n) => Array.from({ length: state.count }, (_, m) => m).filter((m) => m !== n && visible(state, m)).map((m) => ({ m, px: Math.hypot(state.sx[m] - state.sx[n], state.sy[m] - state.sy[n]) * CELL }));
/** The star with the most others 30 to 100 screen pixels from it. */
function crowded(state) {
  const all = Array.from({ length: state.count }, (_, n) => n).filter((n) => visible(state, n) && state.sx[n] > 40 && state.sx[n] < W - 40 && state.sy[n] > 40 && state.sy[n] < H - 40);
  const score = (n) => around(state, n).filter((each) => each.px > 30 && each.px < 100).length - 9 * around(state, n).filter((each) => each.px < 30).length;
  return all.sort((m, n) => score(n) - score(m))[0];
}
{
  const values = still({ touch: 'pull' });
  const pair = twins(values);
  const n = crowded(pair.a);
  const near = around(pair.b, n).filter((each) => each.px > 30 && each.px < 100);
  assert.ok(near.length >= 3, 'stars near enough to be pulled');
  engine.press(pair.a, pair.a.sx[n], pair.a.sy[n], values, pair.envA);
  const off = (m) => Math.hypot(pair.a.sx[m] - pair.b.sx[m], pair.a.sy[m] - pair.b.sy[m]) * CELL;
  const drawnIn = new Map(near.map((each) => [each.m, 0]));
  let [most, own, far, bigger] = [0, 0, 0, 0];
  pair.run(60, (step) => {
    own = Math.max(own, off(n));
    for (const { m, px } of near) drawnIn.set(m, Math.max(drawnIn.get(m), px - Math.hypot(pair.a.sx[m] - pair.a.sx[n], pair.a.sy[m] - pair.a.sy[n]) * CELL));
    for (const { m, px } of around(pair.b, n)) {
      most = Math.max(most, off(m));
      if (px > 185) far = Math.max(far, off(m));
    }
    if (step === 8) {
      const cells = (p) => [-1, 0, 1, 2].flatMap((dy) => [-1, 0, 1, 2].map((dx) => p[(Math.round(pair.a.sy[n]) + dy) * W + Math.round(pair.a.sx[n]) + dx])).filter((c) => c !== 0).length;
      bigger = cells(picture(pair.a, values)) - cells(picture(pair.b, values));
    }
  });
  const pulls = [...drawnIn.values()];
  assert.ok(pulls.every((px) => px > 2) && Math.max(...pulls) > 10, `PULL: the stars near bend towards it (${pulls.map((px) => px.toFixed(0)).join(', ')}px)`);
  assert.ok(most < 60, `and none is dragged far (${most.toFixed(0)}px)`);
  assert.equal(own, 0, 'the heavy star itself stays on its path');
  assert.equal(far, 0, 'and stars beyond its reach do not feel it');
  assert.ok(bigger >= 2, 'drawn a size bigger while it is heavy');
  pair.run(150);
  assert.equal(sky(pair.a), sky(pair.b), 'a few seconds on, every star is exactly where it would have been');
  assert.ok(samePicture(picture(pair.a, values), picture(pair.b, values)), 'and so is every cell');
}

/* ------------------------------------------------------------------ BURST */

{
  const values = still({ touch: 'burst' });
  const pair = twins(values);
  const n = lonely(pair.a);
  const [x0, y0] = [pair.a.sx[n], pair.a.sy[n]];
  engine.press(pair.a, x0, y0, values, pair.envA);
  const spread = () => pair.a.touch.shards.reduce((sum, s) => sum + Math.hypot(s.x - x0, s.y - y0), 0) / Math.max(1, pair.a.touch.shards.length);
  pair.run(1);
  assert.equal(pair.a.count, pair.b.count, 'BURST: as many stars as before');
  assert.ok(pair.a.z[n] === 1 && Math.abs(pair.a.x[n]) <= 1, 'the one pressed is a new star far off');
  assert.equal(pair.a.touch.shards.length, 8, 'and eight pieces of it');
  pair.run(2);
  const early = spread();
  const hit = picture(pair.a, values);
  const plain = picture(pair.b, values);
  let [pieces, brightest] = [0, 0];
  for (let y = Math.round(y0) - 12; y <= Math.round(y0) + 12; y += 1) {
    for (let x = Math.round(x0) - 12; x <= Math.round(x0) + 12; x += 1) {
      const c = hit[y * W + x];
      if (c === 0 || plain[y * W + x] !== 0) continue;
      pieces += 1;
      brightest = Math.max(brightest, c & 255, (c >> 8) & 255, (c >> 16) & 255);
    }
  }
  assert.ok(pieces >= 6, `pieces on the screen round where it was (${pieces})`);
  assert.ok(brightest <= 165, `faint ones (${brightest} of 255)`);
  pair.run(8);
  const middle = spread();
  pair.run(10);
  const late = spread();
  assert.ok(early > 1 && middle > early && late > middle, 'flying apart');
  assert.ok((late - middle) / 10 < ((middle - early) / 8) * 0.7, 'and slowing');
  assert.ok(late * CELL < 50, `never far (${(late * CELL).toFixed(0)}px)`);
  pair.run(10);
  assert.equal(pair.a.touch.shards.length, 0, 'gone inside a second and a bit');
  const others = (s) => FIELDS.map((f) => Array.from(s[f].slice(0, s.count)).filter((_, i) => i !== n).join(',')).join('|');
  assert.equal(others(pair.a), others(pair.b), 'every other star is where it was');

  // In a moving sky the pieces together still go the way the star was going.
  const flying = still({ touch: 'burst', stars: 40, speed: 50 });
  const two = twins(flying);
  const m = Array.from({ length: two.a.count }, (_, i) => i).filter((i) => visible(two.a, i) && !Number.isNaN(two.a.px[i]) && two.a.sx[i] > 40 && two.a.sx[i] < W - 40 && two.a.sy[i] > 40 && two.a.sy[i] < H - 40).sort((i, j) => Math.hypot(two.a.sx[j] - two.a.px[j], two.a.sy[j] - two.a.py[j]) - Math.hypot(two.a.sx[i] - two.a.px[i], two.a.sy[i] - two.a.py[i]))[0];
  const [ax, ay, ux, uy] = [two.a.sx[m], two.a.sy[m], two.a.sx[m] - two.a.px[m], two.a.sy[m] - two.a.py[m]];
  assert.ok(Math.hypot(ux, uy) > 0.4, 'a star on the move');
  engine.press(two.a, ax, ay, flying, two.envA);
  two.run(10);
  const mid = two.a.touch.shards.reduce((sum, s) => [sum[0] + s.x / 8, sum[1] + s.y / 8], [0, 0]);
  assert.ok(Math.hypot(mid[0] - ax - ux * 10, mid[1] - ay - uy * 10) < 0.3, 'their middle goes where the star was going');
}

/* ------------------------------------------------------------------ TIE */

{
  const values = still({ touch: 'tie', stars: 40 });
  /** Two stars well apart and well inside. */
  const two = (state) => {
    const all = Array.from({ length: state.count }, (_, i) => i).filter((i) => visible(state, i) && state.sx[i] > 30 && state.sx[i] < W - 30 && state.sy[i] > 30 && state.sy[i] < H - 30);
    for (const i of all) for (const j of all) if (i !== j && Math.hypot(state.sx[i] - state.sx[j], state.sy[i] - state.sy[j]) > 50 && all.every((k) => k === i || Math.hypot(state.sx[k] - state.sx[i], state.sy[k] - state.sy[i]) > 12) && all.every((k) => k === j || Math.hypot(state.sx[k] - state.sx[j], state.sy[k] - state.sy[j]) > 12)) return [i, j];
    throw new Error('two stars apart');
  };
  const press = (pair, i) => engine.press(pair.a, pair.a.sx[i], pair.a.sy[i], values, pair.envA);
  const differ = (pair) => {
    const [p, q] = [picture(pair.a, values), picture(pair.b, values)];
    return p.reduce((sum, c, k) => sum + (c !== q[k] ? 1 : 0), 0);
  };

  const pair = twins(values);
  const [n, m] = two(pair.a);
  press(pair, n);
  pair.run(10);
  assert.equal(sky(pair.a), sky(pair.b), 'TIE: the first star waits without moving');
  assert.ok(differ(pair) >= 4, 'and is marked');
  const length = () => Math.hypot(pair.a.sx[m] - pair.a.sx[n], pair.a.sy[m] - pair.a.sy[n]);
  const rest = length();
  press(pair, m);
  const lengths = [];
  let [peak, even] = [0, 0];
  pair.run(8);
  const dotted = differ(pair);
  assert.ok(dotted > rest / 6 && dotted < rest * 0.7, `a dotted thread between them (${dotted} cells over ${rest.toFixed(0)})`);
  pair.run(100, () => {
    lengths.push(length());
    const [dx, dy] = [pair.a.sx[n] - pair.b.sx[n], pair.a.sy[n] - pair.b.sy[n]];
    peak = Math.max(peak, Math.hypot(dx, dy) * CELL);
    even = Math.max(even, Math.hypot(dx + pair.a.sx[m] - pair.b.sx[m], dy + pair.a.sy[m] - pair.b.sy[m]));
  });
  assert.ok(Math.min(...lengths) < rest - 6, 'they are drawn towards each other');
  let turns = 0;
  for (let k = 2; k < lengths.length; k += 1) if ((lengths[k] - lengths[k - 1]) * (lengths[k - 1] - lengths[k - 2]) < 0) turns += 1;
  assert.ok(turns >= 4, `and swing on the thread (${turns} turns)`);
  assert.ok(peak > 12 && peak < 50, `by a few dozen pixels at most (${peak.toFixed(0)}px)`);
  assert.ok(even < 1e-3, 'each as much as the other, the opposite way');
  pair.run(110);
  assert.equal(pair.a.touch.ties.length, 0, 'six seconds and the thread is gone');
  assert.equal(sky(pair.a), sky(pair.b), 'with both exactly where they would have been');
  assert.ok(samePicture(picture(pair.a, values), picture(pair.b, values)), 'not one cell of it left');

  const same = twins(values);
  press(same, n);
  press(same, n);
  assert.deepEqual([same.a.touch.ties.length, same.a.touch.waiting], [0, null], 'the same star pressed twice is let go of');
  const late = twins(values);
  press(late, n);
  late.run(200);
  press(late, m);
  assert.equal(late.a.touch.ties.length, 0, 'a first star left more than six seconds is forgotten');
  const switched = twins(values);
  press(switched, n);
  engine.step(switched.a, { ...values, touch: 'nudge' }, switched.envA);
  press(switched, m);
  assert.equal(switched.a.touch.ties.length, 0, 'and so is one left when PRESS A STAR is turned to something else');
  const again = twins(values);
  for (const i of [n, m, m, n]) press(again, i);
  assert.equal(again.a.touch.ties.length, 1, 'two stars are tied once');

  // One end gone (past the viewer): the thread snaps, and the other springs back from where it was, no jump.
  const cut = twins(values);
  press(cut, n);
  press(cut, m);
  cut.run(10);
  const held = [cut.a.sx[n] - cut.b.sx[n], cut.a.sy[n] - cut.b.sy[n]];
  assert.ok(Math.hypot(...held) * CELL > 12, 'drawn well off its place');
  cut.a.z[m] = 0.001;
  cut.run(1);
  assert.equal(cut.a.touch.ties.length, 0, 'one end gone, the thread snaps');
  const now = [cut.a.sx[n] - cut.b.sx[n], cut.a.sy[n] - cut.b.sy[n]];
  assert.ok(Math.hypot(now[0] - held[0], now[1] - held[1]) < Math.hypot(...held) * 0.5, 'the other does not jump back');
  cut.run(90);
  assert.ok(Math.hypot(cut.a.sx[n] - cut.b.sx[n], cut.a.sy[n] - cut.b.sy[n]) < 0.01, 'it springs back to its place');
}

/* ------------------------------------------------------------------ switched OFF mid-way, fewer stars, and a long rough run */

for (const mode of MODES) {
  const values = still({ touch: mode });
  const pair = twins(values);
  const n = lonely(pair.a);
  const [[x, y]] = emptyPlace(pair.a);
  engine.press(pair.a, x, y, values, pair.envA);
  engine.press(pair.a, pair.a.sx[n], pair.a.sy[n], values, pair.envA);
  engine.press(pair.a, x, y, values, pair.envA);
  pair.envA.pointer = { x: pair.a.sx[n] + 5, y: pair.a.sy[n], down: true };
  engine.step(pair.a, values, pair.envA);
  engine.press(pair.a, x, y, values, pair.envA);
  assert.ok(pair.a.touch.miss !== null, 'a miss waiting');
  pair.envA.pointer = null;
  engine.step(pair.a, { ...values, touch: 'off' }, pair.envA);
  const left = Object.entries(pair.a.touch).filter(([key, value]) => key !== 'presses' && (Array.isArray(value) ? value.length > 0 : value !== null));
  assert.deepEqual(left, [], `${mode}: switched to OFF, it all ends at once`);
}
for (const mode of MODES) {
  const random = seeded(mode.length * 31);
  let values = still({ touch: mode, speed: 70, warp: 60, wind: 30, fall: 20, spin: 40, stars: 800 });
  const env = envOf(9);
  const state = engine.init(env, values);
  for (let step = 0; step < 1500; step += 1) {
    if (step % 9 === 0) {
      const n = Math.floor(random() * state.count);
      if (!Number.isNaN(state.sx[n])) engine.press(state, state.sx[n], state.sy[n], values, env);
    }
    env.pointer = step % 40 < 30 ? { x: random() * W, y: random() * H, down: step % 18 < 9 } : null;
    if (step === 600) values = { ...values, stars: 20 };
    if (step === 900) values = { ...values, stars: 800, time: 3, reverse: true };
    engine.step(state, values, env);
    if (step % 100 === 0) picture(state, values);
  }
  for (let n = 0; n < state.count; n += 1) {
    assert.ok(Number.isFinite(state.x[n]) && Number.isFinite(state.y[n]) && (Number.isNaN(state.sx[n]) || (Number.isFinite(state.sx[n]) && Number.isFinite(state.sy[n]))), `${mode}: every star is somewhere after 1500 rough steps`);
  }
  assert.ok(state.touch.pushes.length <= 800 && state.touch.wake.length < 400 && state.touch.ties.length <= 12 && state.touch.shards.length < 100 && state.touch.wells.length < 20 && state.touch.ripples.length < 40, `${mode}: and nothing piles up`);
}

/* ------------------------------------------------------------------ the knob */

const knob = STARFIELD_DEF.knobs.find((each) => each.key === 'touch');
assert.deepEqual(knob.options.map((option) => option.value), [...MODES, 'off'], 'PRESS A STAR: the six and OFF');
assert.ok(/TWICE/.test(knob.tip) && /TWICE.*HYPERSPACE/.test(knob.note), 'the double press is said in the hover words and in a line under the keys');
assert.equal(STARFIELD_DEF.defaults.touch, 'nudge', 'NUDGE as it comes');
assert.equal(K.parseValues(STARFIELD_DEF, { touch: 'nonsense' }).touch, 'nudge', 'anything else read back as the default');
// That the looks, MORPH and PARTY leave it as the reader has it is in the window: the browser drive proves it.

/* ------------------------------------------------------------------ cost */

const cost = (mode) => {
  const values = still({ touch: mode, stars: 800, speed: 60, warp: 50 });
  const env = envOf(2);
  const state = engine.init(env, values);
  const pixels = new Uint32Array(W * H);
  for (let n = 0; n < 300; n += 1) engine.step(state, values, env);
  const start = process.hrtime.bigint();
  for (let n = 0; n < 3000; n += 1) {
    engine.step(state, values, env);
    engine.render(state, values, pixels, palette, env);
  }
  return Number(process.hrtime.bigint() - start) / 1e6 / 3000;
};
cost('off');
const [offCost, onCost] = [Math.min(cost('off'), cost('off')), Math.min(cost('nudge'), cost('nudge'))];

console.log('starfield, a star pressed');
console.log('  OFF as before step for step; nobody pressing, every mode is the same sky');
console.log('  with a mode on, one miss does nothing and a quick double press on empty sky is hyperspace');
console.log('  NUDGE springs back, LASER fades, THROW leaves at the hand`s speed, PULL bends, BURST scatters, TIE swings');
console.log('  all end with nothing left over');
console.log(`  cost with nobody pressing, 800 stars, a step and a picture: OFF ${offCost.toFixed(3)} ms, a mode on ${onCost.toFixed(3)} ms`);
