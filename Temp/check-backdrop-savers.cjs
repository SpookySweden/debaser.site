/**
 * STARFIELD and MYSTIFY (SPEC-backgrounds.md): the two Windows 98 screensavers rebuilt as arithmetic, run with no browser.
 *
 * Held here, for STARFIELD: stars rush out from one point and are replaced as they pass; REVERSE; STARS; the point they come
 * from (the pad, and STEER); SPIN; FALL and WIND, which never run out of stars; hyperspace on a press; the picture (dots, bigger
 * nearer; WARP's streaks; the colour sets).
 * For MYSTIFY: corners fly straight at a steady speed and bounce off the edges, never leaving the screen; SHAPES, CORNERS,
 * TRAILS; GRAVITY, SPRINGS, the pointer's pull and push, WINDOWS ARE SOLID; the picture (closed shapes of lines, a trail
 * behind, LINE's thickness, colours that cycle).
 * For both: knobs, looks and parties in range, and long runs with everything on stay finite and on the screen.
 *
 * Compiled fresh on every run:
 *   npx tsc app/lib/backdrops/starfield/sim.ts app/lib/backdrops/starfield/def.ts app/lib/backdrops/mystify/sim.ts app/lib/backdrops/mystify/def.ts app/lib/backdrops/engine.ts app/lib/backdrops/knobs.ts --outDir Temp/backdrop-savers-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, 'backdrop-savers-out');
const ST = require(path.join(OUT, 'starfield/sim.js'));
const { STARFIELD_DEF } = require(path.join(OUT, 'starfield/def.js'));
const MY = require(path.join(OUT, 'mystify/sim.js'));
const { MYSTIFY_DEF } = require(path.join(OUT, 'mystify/def.js'));
const K = require(path.join(OUT, 'knobs.js'));
const E = require(path.join(OUT, 'engine.js'));

const seeded = (seed) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const palette = Object.fromEntries(E.DYES.map((name, n) => [name, E.pixel((n * 97 + 20) % 256, (n * 57 + 140) % 256, (n * 151 + 60) % 256)]));
const W = 320;
const H = 180;
const envOf = (solids = [], seed = 4) => ({ w: W, h: H, pointer: null, solids, random: seeded(seed) });
const drawn = (pixels) => pixels.reduce((sum, p) => sum + (p !== 0 ? 1 : 0), 0);

/* ================================================================== STARFIELD */
{
  const SD = STARFIELD_DEF.defaults;
  const stars = (changes = {}) => K.parseValues(STARFIELD_DEF, { ...SD, twinkle: 0, ...changes });
  const run = (state, values, env, steps, each) => {
    for (let n = 0; n < steps; n += 1) {
      ST.stepStars(state, values, env);
      if (each) each(n);
    }
  };
  /** How far the stars in view are from a point, on average. */
  const spreadFrom = (state, cx, cy) => {
    let [sum, n] = [0, 0];
    for (let i = 0; i < state.count; i += 1) {
      if (state.lit[i] <= 0 || Number.isNaN(state.sx[i])) continue;
      sum += Math.hypot(state.sx[i] - cx, state.sy[i] - cy);
      n += 1;
    }
    return sum / Math.max(1, n);
  };

  // They rush outward from the middle, and are replaced as they pass.
  const env = envOf();
  const state = ST.newStars(W, H);
  ST.stepStars(state, stars(), env);
  assert.equal(state.count, 200, 'STARS: as many as the knob says');
  const tracked = Array.from({ length: state.count }, (_, n) => ({ far: Math.hypot(state.sx[n] - W / 2, state.sy[n] - H / 2), z: state.z[n] }));
  let outward = 0;
  let judged = 0;
  let replaced = 0;
  run(state, stars(), env, 20, () => {
    for (let n = 0; n < state.count; n += 1) {
      if (Number.isNaN(state.sx[n])) {
        replaced += 1;
        tracked[n] = { far: Number.NaN, z: state.z[n] };
        continue;
      }
      const far = Math.hypot(state.sx[n] - W / 2, state.sy[n] - H / 2);
      if (!Number.isNaN(tracked[n].far)) {
        judged += 1;
        if (far >= tracked[n].far - 1e-6) outward += 1;
        assert.ok(state.z[n] < tracked[n].z, 'every star comes nearer each step');
      }
      tracked[n] = { far, z: state.z[n] };
    }
  });
  assert.ok(judged > 1000 && outward === judged, `every star moves outward from the middle, every step (${judged} moves)`);
  run(state, stars({ speed: 100 }), env, 120);
  assert.ok(replaced >= 0 && state.count === 200 && state.inView > 60, `stars that pass are replaced: the sky never empties (${state.inView} in view)`);
  for (let n = 0; n < state.count; n += 1) assert.ok(state.z[n] > 0 && state.z[n] <= 1, 'and no star is ever at or behind the viewer');

  // REVERSE: they fall away into the middle.
  const back = ST.newStars(W, H);
  run(back, stars({ reverse: true }), envOf(), 5);
  const before = spreadFrom(back, W / 2, H / 2);
  const zs = Array.from(back.z.slice(0, 200));
  ST.stepStars(back, stars({ reverse: true }), envOf());
  assert.ok(Array.from(back.z.slice(0, 200)).filter((z, n) => z > zs[n]).length > 190, 'REVERSE: the stars go away from you');
  run(back, stars({ reverse: true, speed: 100 }), envOf(), 300);
  assert.ok(back.inView > 20 && before > 0, 'and the sky still never empties');

  // STARS follows the knob both ways; a still sky is still.
  run(state, stars({ stars: 40 }), env, 2);
  assert.equal(state.count, 40, 'fewer when the knob is turned down');
  run(state, stars({ stars: 800 }), env, 2);
  assert.equal(state.count, ST.MOST_STARS, 'and up to eight hundred');
  const stopped = ST.newStars(W, H);
  run(stopped, stars({ speed: 0 }), envOf(), 3);
  const places = Array.from(stopped.sx.slice(0, 200));
  run(stopped, stars({ speed: 0 }), envOf(), 30);
  assert.deepEqual(Array.from(stopped.sx.slice(0, 200)), places, 'SPEED at nothing: the stars hang where they are');

  // Where they come from: the pad, and the pointer.
  const moved = ST.newStars(W, H);
  run(moved, stars({ originX: 100, originY: -100, speed: 5 }), envOf(), 200);
  assert.ok(Math.abs(moved.cx - (W - 0)) < 2 && Math.abs(moved.cy - 0) < 2, 'the pad moves the point the stars come from (here: the top-right corner)');
  const steered = ST.newStars(W, H);
  const pointed = { ...envOf(), pointer: { x: 40, y: 150, down: false } };
  run(steered, stars({ steer: true }), pointed, 200);
  assert.ok(Math.abs(steered.cx - 40) < 2 && Math.abs(steered.cy - 150) < 2, 'STEER: they come from wherever the pointer is');
  const unsteered = ST.newStars(W, H);
  run(unsteered, stars(), pointed, 200);
  assert.ok(Math.abs(unsteered.cx - W / 2) < 1, 'off, the pointer changes nothing');

  // SPIN turns the sky; FALL and WIND carry the stars and bring them round again.
  const spun = ST.newStars(W, H);
  ST.stepStars(spun, stars({ speed: 0 }), envOf());
  const angle = (s, n) => Math.atan2(s.y[n], s.x[n]);
  const a0 = angle(spun, 0);
  run(spun, stars({ speed: 0, spin: 100 }), envOf(), 10);
  assert.ok(Math.abs(angle(spun, 0) - a0) > 0.2, 'SPIN: the whole sky turns');
  const snow = ST.newStars(W, H);
  const snowing = STARFIELD_DEF.looks.find((look) => look.id === 'snow').values;
  run(snow, snowing, envOf(), 5);
  const y0 = Array.from(snow.sy.slice(0, snow.count));
  ST.stepStars(snow, snowing, envOf());
  const falling = Array.from(snow.sy.slice(0, snow.count)).filter((y, n) => y > y0[n]).length;
  assert.ok(falling > snow.count * 0.9, `SNOW: the flakes fall (${falling} of ${snow.count} lower than a step ago)`);
  run(snow, snowing, envOf(), 2000);
  assert.ok(snow.inView === snow.count, `and come round again at the top: it never stops snowing (${snow.inView} of ${snow.count} in view)`);

  // Hyperspace.
  const jump = ST.newStars(W, H);
  run(jump, stars(), envOf(), 3);
  const z0 = jump.z[0];
  ST.stepStars(jump, stars(), envOf());
  const usual = z0 - jump.z[0];
  ST.starsPress(jump);
  const z1 = jump.z[1];
  ST.stepStars(jump, stars(), envOf());
  assert.ok(Math.abs((z1 - jump.z[1]) / usual - 6) < 0.01, 'a press on the background: six times the speed');
  run(jump, stars(), envOf(), 70);
  assert.equal(jump.hyper, 0, 'for two seconds');

  // The picture.
  const shown = ST.newStars(W, H);
  run(shown, stars({ size: 1 }), envOf(), 40);
  const dots = new Uint32Array(W * H);
  ST.renderStars(shown, stars({ size: 1, warp: 0 }), dots, palette);
  assert.ok(drawn(dots) > 30 && drawn(dots) <= shown.count, `a dot a star, and nothing else (${drawn(dots)} cells for ${shown.inView} stars in view)`);
  const big = new Uint32Array(W * H);
  ST.renderStars(shown, stars({ size: 5, warp: 0 }), big, palette);
  assert.ok(drawn(big) > drawn(dots) * 1.5, 'STAR SIZE: the near ones are bigger');
  const streaked = new Uint32Array(W * H);
  ST.renderStars(shown, stars({ size: 1, warp: 100 }), streaked, palette);
  assert.ok(drawn(streaked) > drawn(dots) * 1.5, `WARP: each star leaves a streak (${drawn(streaked)} cells against ${drawn(dots)})`);
  const pictures = ['white', 'dyes', 'warm', 'rainbow'].map((colours) => {
    const pixels = new Uint32Array(W * H);
    ST.renderStars(shown, stars({ colours }), pixels, palette);
    return Array.from(pixels).join(',');
  });
  assert.equal(new Set(pictures).size, 4, 'each colour set is its own');
  const whites = new Uint32Array(W * H);
  ST.renderStars(shown, stars({ colours: 'white', warp: 0 }), whites, palette);
  assert.ok(Array.from(whites).every((p) => p === 0 || p >>> 24 === 255), 'stars are solid colours on nothing');

  assert.ok(K.sameValues(STARFIELD_DEF, STARFIELD_DEF.looks[0].values, SD), 'the first look is STARFIELD as it comes');
  assert.deepEqual(STARFIELD_DEF.looks.map((look) => look.label), ['98', 'WARP', 'SNOW'], 'its looks');
  assert.equal(ST.starfieldEngine.cell(SD), 3, 'a dot is three screen pixels as it comes');
  for (const values of [...STARFIELD_DEF.looks.map((look) => look.values), ...Array.from({ length: 8 }, (_, n) => K.partyValues(STARFIELD_DEF, seeded(n + 1)))]) {
    assert.deepEqual(K.parseValues(STARFIELD_DEF, values), values, 'a look or a party reads back as itself');
    const long = ST.newStars(W, H);
    const where = envOf();
    const pixels = new Uint32Array(W * H);
    for (let n = 0; n < 900; n += 1) {
      where.pointer = { x: (n * 5) % W, y: (n * 3) % H, down: false };
      ST.stepStars(long, values, where);
      if (n % 200 === 100) ST.starsPress(long);
      if (n % 90 === 0) ST.renderStars(long, values, pixels, palette);
    }
    for (let n = 0; n < long.count; n += 1) assert.ok(Number.isFinite(long.z[n]) && (Number.isNaN(long.sx[n]) || (Number.isFinite(long.sx[n]) && Number.isFinite(long.sy[n]))), 'every star is somewhere');
    assert.ok(Number.isFinite(ST.starfieldEngine.meters(long)[0].value), 'and the meter has a number');
  }
}

/* ================================================================== MYSTIFY */
{
  const MD = MYSTIFY_DEF.defaults;
  const myst = (changes = {}) => K.parseValues(MYSTIFY_DEF, { ...MD, ...changes });
  const run = (state, values, env, steps, each) => {
    for (let n = 0; n < steps; n += 1) {
      MY.stepMystify(state, values, env);
      if (each) each(n);
    }
  };
  const inside = (state) => state.shapes.every((shape) => shape.x.every((x, n) => x >= 0 && x <= W - 1 && shape.y[n] >= 0 && shape.y[n] <= H - 1));

  // As it comes: corners fly straight at a steady speed, bounce off the edges, and never leave.
  const env = envOf();
  const state = MY.newMystify(W, H);
  MY.stepMystify(state, myst(), env);
  assert.ok(state.shapes.length === 2 && state.shapes.every((shape) => shape.x.length === 4), 'two shapes of four corners, as the screensaver had');
  const speeds = () => state.shapes.flatMap((shape) => shape.vx.map((vx, n) => Math.hypot(vx, shape.vy[n])));
  const s0 = speeds();
  let bounces = 0;
  let straight = 0;
  let last = state.shapes.map((shape) => ({ vx: shape.vx.slice(), vy: shape.vy.slice() }));
  const onEdge = state.shapes.map((shape) => shape.x.map(() => 0));
  run(state, myst(), env, 1500, () => {
    assert.ok(inside(state), 'no corner ever leaves the screen');
    state.shapes.forEach((shape, s) =>
      shape.x.forEach((x, n) => {
        const edge = x <= 0 || x >= W - 1 || shape.y[n] <= 0 || shape.y[n] >= H - 1;
        onEdge[s][n] = edge ? onEdge[s][n] + 1 : 0;
        assert.ok(onEdge[s][n] <= 1, 'a corner that reaches an edge is off it the next step: it bounces, it does not slide along');
      }),
    );
    state.shapes.forEach((shape, s) =>
      shape.vx.forEach((vx, n) => {
        if (Math.sign(vx) !== Math.sign(last[s].vx[n]) || Math.sign(shape.vy[n]) !== Math.sign(last[s].vy[n])) bounces += 1;
        else if (Math.abs(vx - last[s].vx[n]) < 1e-9 && Math.abs(shape.vy[n] - last[s].vy[n]) < 1e-9) straight += 1;
      }),
    );
    last = state.shapes.map((shape) => ({ vx: shape.vx.slice(), vy: shape.vy.slice() }));
  });
  assert.ok(bounces > 40, `they bounce off the edges (${bounces} bounces)`);
  assert.ok(straight + bounces === 1500 * 8, 'and between bounces each flies dead straight');
  speeds().forEach((speed, n) => assert.ok(Math.abs(speed - s0[n]) < 1e-6, 'at the same steady speed it started with'));
  assert.ok(new Set(s0.map((speed) => speed.toFixed(3))).size > 3, 'each corner at its own');
  const faster = MY.newMystify(W, H);
  run(faster, myst({ speed: 100 }), envOf(), 2);
  assert.ok(Math.hypot(faster.shapes[0].vx[0], faster.shapes[0].vy[0]) > s0[0] * 2, 'SPEED moves them all');

  // SHAPES, CORNERS, TRAILS follow their knobs both ways.
  run(state, myst({ shapes: 6, corners: 8, trails: 12, gap: 1 }), env, 30);
  assert.ok(state.shapes.length === 6 && state.shapes.every((shape) => shape.x.length === 8 && shape.trail.length === 12 && shape.trail.every((past) => past.x.length === 8)), 'SHAPES, CORNERS and TRAILS: as many as the knobs say');
  run(state, myst({ shapes: 1, corners: 2, trails: 0 }), env, 5);
  assert.ok(state.shapes.length === 1 && state.shapes[0].x.length === 2 && state.shapes[0].trail.length === 0, 'and as few');
  const gapped = MY.newMystify(W, H);
  run(gapped, myst({ trails: 40, gap: 4 }), envOf(), 40);
  assert.equal(gapped.shapes[0].trail.length, 10, 'TRAIL GAP: an echo is kept every that many steps');

  // GRAVITY: corners spend their time lower down. SPRINGS: a shape holds together.
  const heavy = MY.newMystify(W, H);
  let low = 0;
  run(heavy, myst({ gravity: 100, shapes: 6, corners: 8 }), envOf(), 900, () => heavy.shapes.forEach((shape) => shape.y.forEach((y) => (low += y > H / 2 ? 1 : -1))));
  assert.ok(low > 900 * 48 * 0.25 && inside(heavy), 'GRAVITY: the corners fall and bounce, and stay on the screen');
  const sizeOf = (s) => s.shapes.reduce((sum, shape) => sum + Math.max(...shape.x) - Math.min(...shape.x) + Math.max(...shape.y) - Math.min(...shape.y), 0) / s.shapes.length;
  const loose = MY.newMystify(W, H);
  const sprung = MY.newMystify(W, H);
  let [looseSize, sprungSize] = [0, 0];
  run(loose, myst({ shapes: 4, corners: 6 }), envOf([], 8), 600, () => (looseSize += sizeOf(loose)));
  run(sprung, myst({ shapes: 4, corners: 6, springs: 100 }), envOf([], 8), 600, () => (sprungSize += sizeOf(sprung)));
  assert.ok(sprungSize < looseSize * 0.7 && inside(sprung), `SPRINGS: a shape holds together (${Math.round(sprungSize / 600)} cells across against ${Math.round(looseSize / 600)})`);

  // The pointer pulls them in, or drives them off.
  const meanFar = (values) => {
    const s = MY.newMystify(W, H);
    const where = { ...envOf([], 6), pointer: { x: W / 2, y: H / 2, down: false } };
    let [sum, n] = [0, 0];
    run(s, values, where, 600, (step) => {
      if (step < 200) return;
      s.shapes.forEach((shape) => shape.x.forEach((x, c) => ((sum += Math.hypot(x - W / 2, shape.y[c] - H / 2)), (n += 1))));
    });
    assert.ok(inside(s), 'the pointer never drives a corner off the screen');
    return sum / n;
  };
  const [pulled, ignored, pushed] = [meanFar(myst({ pointer: 'pull', shapes: 4 })), meanFar(myst({ shapes: 4 })), meanFar(myst({ pointer: 'push', shapes: 4 }))];
  assert.ok(pulled < ignored * 0.8 && pushed > ignored * 1.1, `the pointer pulls the corners in or pushes them off (${Math.round(pulled)}, ${Math.round(ignored)}, ${Math.round(pushed)} cells away on average)`);

  // WINDOWS ARE SOLID: no corner is ever inside the site window.
  const box = { x0: 80, y0: 40, x1: 240, y1: 140 };
  const caged = MY.newMystify(W, H);
  let within = 0;
  let turned = 0;
  run(caged, myst({ solid: true, shapes: 6, corners: 8, speed: 80 }), envOf([box]), 1200, (step) => {
    if (step < 2) return;
    caged.shapes.forEach((shape) => shape.x.forEach((x, n) => {
      if (x > box.x0 && x < box.x1 && shape.y[n] > box.y0 && shape.y[n] < box.y1) within += 1;
      if (x === box.x0 || x === box.x1 || shape.y[n] === box.y0 || shape.y[n] === box.y1) turned += 1;
    }));
  });
  assert.equal(within, 0, 'WINDOWS ARE SOLID: no corner is ever inside the site window');
  assert.ok(turned > 20, `they bounce off it (${turned} times)`);
  const through = MY.newMystify(W, H);
  let crossed = 0;
  run(through, myst({ shapes: 6, corners: 8, speed: 80 }), envOf([box]), 600, () => through.shapes.forEach((shape) => shape.x.forEach((x, n) => (crossed += x > box.x0 && x < box.x1 && shape.y[n] > box.y0 && shape.y[n] < box.y1 ? 1 : 0))));
  assert.ok(crossed > 100, 'off, they fly behind it as before');

  // The picture.
  const shown = MY.newMystify(W, H);
  run(shown, myst({ trails: 0 }), envOf(), 20);
  const bare = new Uint32Array(W * H);
  MY.renderMystify(shown, myst({ trails: 0 }), bare, palette);
  assert.ok(drawn(bare) > 60 && Array.from(bare).every((p) => p === 0 || p >>> 24 === 255), 'shapes are drawn as lines of solid colour on nothing');
  for (const shape of shown.shapes) for (let n = 0; n < 4; n += 1) assert.notEqual(bare[Math.round(shape.y[n]) * W + Math.round(shape.x[n])], 0, 'every corner is on a line');
  // A closed shape: the middle of the side from the last corner back to the first is drawn too.
  const mid = (shape, a, b) => bare[Math.round((shape.y[a] + shape.y[b]) / 2) * W + Math.round((shape.x[a] + shape.x[b]) / 2)];
  const near = (shape, a, b) => {
    const [mx, my] = [Math.round((shape.x[a] + shape.x[b]) / 2), Math.round((shape.y[a] + shape.y[b]) / 2)];
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (bare[(my + dy) * W + mx + dx] !== 0) return true;
    return mid(shape, a, b) !== 0;
  };
  assert.ok(shown.shapes.every((shape) => near(shape, 3, 0)), 'and the shape is closed: the last corner is joined to the first');
  const thick = new Uint32Array(W * H);
  MY.renderMystify(shown, myst({ trails: 0, line: 4 }), thick, palette);
  assert.ok(drawn(thick) > drawn(bare) * 2, 'LINE: thicker lines');
  run(shown, myst({ trails: 10, gap: 2 }), envOf(), 40);
  const trailed = new Uint32Array(W * H);
  MY.renderMystify(shown, myst({ trails: 10, gap: 2 }), trailed, palette);
  const alone = new Uint32Array(W * H);
  MY.renderMystify({ ...shown, shapes: shown.shapes.map((shape) => ({ ...shape, trail: [] })) }, myst({ trails: 10, gap: 2 }), alone, palette);
  assert.ok(drawn(trailed) > drawn(alone) * 3 && new Set(trailed).size > new Set(alone).size + 4, 'TRAILS: echoes behind each shape, fainter the older');
  const colourAt = (cycle, steps) => {
    const s = MY.newMystify(W, H);
    run(s, myst({ cycle, speed: 0, trails: 0 }), envOf(), steps);
    const pixels = new Uint32Array(W * H);
    MY.renderMystify(s, myst({ cycle, trails: 0 }), pixels, palette);
    return [...new Set(pixels)].filter((p) => p !== 0).join(',');
  };
  assert.notEqual(colourAt(100, 5), colourAt(100, 120), 'COLOUR CYCLE: a shape changes colour as it goes');
  assert.equal(colourAt(0, 5), colourAt(0, 120), 'at nothing it keeps the one it has');
  const sets = ['dyes', 'cool', 'mono', 'rainbow'].map((colours) => {
    const pixels = new Uint32Array(W * H);
    MY.renderMystify(shown, myst({ colours }), pixels, palette);
    return [...new Set(pixels)].join(',');
  });
  assert.equal(new Set(sets).size, 4, 'each colour set is its own');

  assert.ok(K.sameValues(MYSTIFY_DEF, MYSTIFY_DEF.looks[0].values, MD), 'the first look is MYSTIFY as it comes');
  assert.deepEqual(MYSTIFY_DEF.looks.map((look) => look.label), ['98', 'JELLY', 'CAGE'], 'its looks');
  assert.equal(MY.mystifyEngine.cell(MD), 3, 'a dot of a line is three screen pixels as it comes');
  for (const values of [...MYSTIFY_DEF.looks.map((look) => look.values), ...Array.from({ length: 8 }, (_, n) => K.partyValues(MYSTIFY_DEF, seeded(n + 1))), myst({ gravity: 100, springs: 100, pointer: 'pull', solid: true, speed: 100, time: 3, shapes: 6, corners: 8, trails: 40 })]) {
    assert.deepEqual(K.parseValues(MYSTIFY_DEF, values), values, 'a look or a party reads back as itself');
    const long = MY.newMystify(W, H);
    const where = envOf([{ x0: 100, y0: 50, x1: 220, y1: 130 }]);
    const pixels = new Uint32Array(W * H);
    for (let n = 0; n < 900; n += 1) {
      where.pointer = { x: (n * 5) % W, y: (n * 3) % H, down: false };
      MY.stepMystify(long, values, where);
      assert.ok(inside(long), 'every corner stays on the screen, whatever acts on it');
      if (n % 90 === 0) MY.renderMystify(long, values, pixels, palette);
    }
    assert.ok(long.shapes.every((shape) => [...shape.x, ...shape.y, ...shape.vx, ...shape.vy].every(Number.isFinite)), 'and every number stays a number');
  }
}

// The line both of them draw with.
{
  const pixels = new Uint32Array(20 * 10);
  ST.line(pixels, 20, 10, 2, 2, 17, 7, 1, 5);
  assert.ok(pixels[2 * 20 + 2] === 5 && pixels[7 * 20 + 17] === 5 && drawn(pixels) === 16, 'a line runs from one end to the other, one cell a column');
  ST.line(pixels, 20, 10, 3, 8, 500, 300, 1, 9);
  assert.ok(drawn(pixels) > 16 && pixels[8 * 20 + 3] === 9, 'and one that runs off the grid is drawn where it is on it, and ends');
}

console.log('backdrop: starfield and mystify');
console.log('  starfield : outward from one point, replaced as they pass; reverse, steer, spin, snow that never runs out, hyperspace');
console.log('  mystify   : straight, steady, bouncing, never off the screen; gravity, springs, the pointer, solid windows');
console.log('  pictures  : dots and streaks; closed shapes with fading trails; colour sets; line thickness');
console.log('  range     : every look, eight parties each and everything-at-once, 900 steps: finite and on the screen');
