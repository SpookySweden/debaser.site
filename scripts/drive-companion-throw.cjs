/*
 * Drives throwing the companion (Luke, 2026-11-14: "retain momentum and splat against the edge of the screen and obey the
 * principles of animation such as squash and stretch and wind up and smearing") in a real browser, against a LOCAL dev
 * server on mock accounts and mock data. Not in `npm run checks`: it needs that server. It never touches the live site or
 * the live database, and leaves nothing: everything it makes is in the test browser's own storage.
 *
 *   start the server with every switch on mock (in its environment, never by editing a file), for example:
 *     NEXT_PUBLIC_AUTH_BACKEND=mock NEXT_PUBLIC_PROFILE_DATA_SOURCE=mock NEXT_PUBLIC_FORUM_DATA_SOURCE=mock ... npm run dev -- -p 3317
 *   node scripts/drive-companion-throw.cjs --base http://localhost:3317 [--headed]
 *
 * How it can be exact: the browser's clock is taken over (Playwright's `page.clock`), so the pointer's moves are a known
 * number of milliseconds apart and the companion's loop is stepped one frame at a time. Every frame of every throw is
 * read off the page and compared with what the rules in `app/lib/companion/throw.ts` say that frame should be, run here in
 * Node from the same let-go: where it is, which part of the throw it is in, and how its picture is squashed or stretched.
 *
 *   1. GUY is baked in the dev workbench (the bake the SHOW key runs) and shown as the mock account's character; the strip
 *      holds the three new motions (flung, splat, dizzy) and they do not make its box any bigger;
 *   2. in real time: picked up, swung and let go on the move, it flies on and comes down (the pointer's measured speed
 *      against its first frame in the air);
 *   3. frame by frame: an arc (wind-up, stretch, smear, a bounce with a squash, settling); a splat on the right, the left
 *      and the top of the screen (stuck flat, peeling, dropping, dizzy with stars, a hop); a soft bounce off a side;
 *   4. let go slowly, or after the pointer has stopped, it only drops; put down on the move after a double press, it is
 *      thrown; caught again out of the air, the throw is over;
 *   5. under reduced motion nothing is carried or thrown.
 *
 * Close-up pictures of the frames go to Temp/browse/throw/ (kept locally, to be looked at).
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3317').replace(/\/$/, '');
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.log('This drive is for a local dev server on mock data only (core.md: test locally, not on the live site).');
  process.exit(2);
}
const SHOTS = join('Temp', 'browse', 'throw');
rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

/** The rules themselves, compiled here from the site's own source, so the browser is compared with them and not a copy. */
function loadRules() {
  const load = (file, deps) => {
    const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const made = { exports: {} };
    new Function('module', 'exports', 'require', js)(made, made.exports, (name) => deps[name]);
    return made.exports;
  };
  const brain = load(join('app', 'lib', 'companion', 'brain.ts'), {});
  return load(join('app', 'lib', 'companion', 'throw.ts'), { './brain': brain });
}
const rules = loadRules();

/** The mock's hidden test person (`app/lib/auth/mock-auth.ts`), signed in by writing this browser's own storage. */
const PERSON = 'mock-test-account';
const AUTH = {
  users: [{ id: PERSON, email: 'test-mock@debaser.site', displayName: 'TEST ACCOUNT (MOCK)', createdAt: '2026-11-14T00:00:00.000Z', salt: '', secretHash: '', hidden: true }],
  sessionUserId: PERSON,
  bannedIds: [],
};

function seed({ auth, shown }) {
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify(auth));
  if (shown !== null) window.localStorage.setItem('debaser.profile-character.v1', JSON.stringify(shown));
}

/** What the page shows of the companion just now. */
function readOwn() {
  const own = document.querySelector('[data-companion="own"]');
  if (own === null) return null;
  const box = own.getBoundingClientRect();
  const body = own.querySelector('[data-companion-figure]');
  const bar = Number.parseFloat(document.documentElement.style.getPropertyValue('--bottom-bar')) || 0;
  const mark = own.querySelector('[data-companion-mark]');
  return {
    shown: own.style.visibility === 'visible',
    x: Math.round(box.left),
    feet: Math.round(box.bottom),
    w: Math.round(box.width),
    h: Math.round(box.height),
    floor: Math.round(window.innerHeight - bar),
    screen: document.documentElement.clientWidth,
    stage: own.dataset.throw ?? '',
    motion: own.dataset.motion ?? null,
    held: own.dataset.held,
    facing: own.dataset.facing,
    figure: body === null ? null : body.getAttribute('data-companion-figure'),
    body: body === null ? '' : body.style.transform,
    ghosts: [...own.querySelectorAll('[data-companion-smear]')].filter((ghost) => ghost.style.visibility === 'visible').map((ghost) => ghost.style.transform),
    mark: mark !== null && mark.style.visibility === 'visible' ? mark.textContent.trim() : null,
  };
}

/** `translate(..) matrix(..) [scaleX(-1)]` as numbers; an empty transform is the figure untouched. */
function parseLook(text) {
  const move = /translate\((-?[\d.]+)px(?:, (-?[\d.]+)px)?\)/.exec(text);
  const matrix = /matrix\(([^)]+)\)/.exec(text);
  const [a, b, c, d] = matrix === null ? [1, 0, 0, 1] : matrix[1].split(',').map((part) => Number(part.trim()));
  return { a, b, c, d, dx: move === null ? 0 : Number(move[1]), dy: move === null || move[2] === undefined ? 0 : Number(move[2]), mirrored: /scaleX\(-1\)/.test(text) };
}

const near = (one, other, slack = 0.0011) => Math.abs(one - other) <= slack;

/** Its own shape: not squashed, stretched or nudged (it may still be mirrored to face left). */
function plain(seen) {
  const got = parseLook(seen.body);
  return got.a === 1 && got.b === 0 && got.c === 0 && got.d === 1 && got.dx === 0 && got.dy === 0;
}

/** Whether the page's picture is what the rules say for this frame of the throw. */
function sameLook(seen, want) {
  const got = parseLook(seen.body);
  if (!(near(got.a, want.a) && near(got.b, want.b) && near(got.c, want.c) && near(got.d, want.d) && got.dx === want.dx && got.dy === want.dy)) return false;
  if (seen.ghosts.length !== want.ghosts.length) return false;
  return want.ghosts.every((ghost, order) => {
    const copy = parseLook(seen.ghosts[order]);
    return copy.dx === ghost.dx && copy.dy === ghost.dy && near(copy.a, want.a) && near(copy.d, want.d);
  });
}

async function closeUp(page, name) {
  const now = await page.evaluate(readOwn);
  if (now === null) return;
  const view = page.viewportSize();
  const width = 420;
  const height = 320;
  const x = Math.max(0, Math.min(view.width - width, Math.round(now.x + now.w / 2 - width / 2)));
  const y = Math.max(0, Math.min(view.height - height, Math.round(now.feet - now.h / 2 - height / 2)));
  await page.screenshot({ path: join(SHOTS, `${name}.png`), clip: { x, y, width, height } });
}

async function openPage(browser, shown, { reduced = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await context.addInitScript(seed, { auth: AUTH, shown });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 300)}`));
  return { context, page };
}

async function clearPrivacyWindow(page) {
  const close = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if ((await close.count()) > 0) await close.first().click().catch(() => undefined);
}

/** GUY, baked by the dev workbench's own bake, as the mock account's shown character. Also: how much room each motion takes. */
async function bake(browser) {
  const { context, page } = await openPage(browser, null);
  await page.goto(`${BASE}/profile/${PERSON}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.mouse.move(700, 300);
  await sleep(2500);
  await clearPrivacyWindow(page);
  await page.getByRole('button', { name: '[ EDIT PROFILE ]' }).first().click({ timeout: 120000 });
  await page.getByRole('button', { name: '[ CHAR 🐰 ]' }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__characterBakeProof !== undefined, null, { timeout: 180000 });
  const baked = await page.evaluate(async () => {
    const hook = window.__characterBakeProof;
    hook.applyPreset('guy');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const made = await hook.bakeCharacter(hook.figure(), 'guy');
    const stripUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(made.strip);
    });
    // How far each cell's picture reaches from the middle of its box, and how near its top, motion by motion.
    const image = new Image();
    image.src = stripUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context2d = canvas.getContext('2d');
    context2d.drawImage(image, 0, 0);
    const { w, h } = made.sheet.cell;
    const reach = {};
    for (const [id, motion] of Object.entries(made.sheet.motions)) {
      let across = 0;
      let top = h;
      let top0 = h;
      let left = w;
      let right = -1;
      for (const cell of new Set(motion.ticks)) {
        const data = context2d.getImageData((cell % made.sheet.columns) * w, Math.floor(cell / made.sheet.columns) * h, w, h).data;
        for (let row = 0; row < h; row += 1) {
          for (let column = 0; column < w; column += 1) {
            if (data[(row * w + column) * 4 + 3] === 0) continue;
            across = Math.max(across, Math.abs(column + 0.5 - w / 2));
            top = Math.min(top, row);
            if (cell === motion.ticks[0]) {
              top0 = Math.min(top0, row);
              left = Math.min(left, column);
              right = Math.max(right, column);
            }
          }
        }
      }
      reach[id] = { across, top, top0, left, right: w - 1 - right };
    }
    return { stripUrl, sheet: made.sheet, reach, bytes: made.strip.size };
  });
  writeFileSync(join(SHOTS, 'strip.png'), Buffer.from(baked.stripUrl.slice(baked.stripUrl.indexOf(',') + 1), 'base64'));
  await context.close();
  return baked;
}

/** Steps the companion's loop one frame (its clock is ours) and reads it. */
async function frame(page) {
  await page.clock.runFor(100);
  return page.evaluate(readOwn);
}

/** Picks it up from wherever it stands and carries it to (x, y) for the pointer; then holds still long enough to be at rest. */
async function carryTo(page, x, y) {
  let own = await page.evaluate(readOwn);
  for (let tries = 0; tries < 80 && (own === null || !own.shown || own.held !== 'false' || own.stage !== '' || own.feet !== own.floor); tries += 1) own = await frame(page);
  assert.ok(own !== null && own.shown && own.held === 'false', 'it is on its strip to be picked up');
  await page.mouse.move(own.x + own.w / 2, own.feet - own.h / 2);
  await page.mouse.down();
  await page.mouse.move(own.x + own.w / 2, own.feet - own.h / 2 - 14);
  await frame(page);
  await page.mouse.move(x, y);
  // Its start at being lifted plays out, and the pointer has been still well over a tenth of a second.
  for (let i = 0; i < 9; i += 1) await frame(page);
  const held = await page.evaluate(readOwn);
  assert.equal(held.held, 'true', 'carried');
  return held;
}

/**
 * A let-go on the move: five moves of (dx, dy) ten milliseconds apart, then the key lifted (or pressed, for a put-down
 * after a double press). By the rules that is a speed of exactly ten times (dx, dy) a frame.
 */
async function swing(page, from, dx, dy, release = 'up') {
  let x = from.x;
  let y = from.y;
  for (let i = 0; i < 5; i += 1) {
    x += dx;
    y += dy;
    await page.mouse.move(x, y);
    if (i < 4) await page.clock.runFor(10);
  }
  if (release === 'up') await page.mouse.up();
  else await page.mouse.down();
  return { x, y };
}

/**
 * Follows a throw to the ground, a frame at a time, against the rules run here from the same let-go. Returns the frames
 * (the page's and the rules' side by side).
 */
async function follow(page, name, speed, insets, { shots = 0, after = 0 } = {}) {
  const start = await page.evaluate(readOwn);
  assert.equal(start.stage, 'wind', `${name}: let go on the move, it winds up at once (stage "${start.stage}", held ${start.held}, motion ${start.motion})`);
  const box = { w: start.w, h: start.h, ...insets };
  const arena = { left: -insets.left, right: start.screen - start.w + insets.right, ceiling: start.h - insets.top, floor: start.floor };
  let want = rules.startThrow(start.x, start.feet, speed.vx, speed.vy);
  const frames = [{ seen: start, want }];
  assert.ok(sameLook(start, rules.throwLook(want, box)), `${name}: the wind-up is drawn the moment it is let go (${start.body})`);
  if (shots > 0) await closeUp(page, `${name}-00-wind`);
  let wrong = 0;
  for (let count = 1; count < 300; count += 1) {
    const seen = await frame(page);
    want = rules.throwStep(want, arena);
    frames.push({ seen, want });
    if (count <= shots) await closeUp(page, `${name}-${String(count).padStart(2, '0')}-${want.stage}${want.edge !== null && want.stage === 'fly' ? `-hit-${want.edge}` : ''}`);
    if (want.stage === 'landed') {
      // Down: on its strip again, squashed by the landing (the first frame of its settling).
      assert.equal(seen.held, 'false', `${name}: down, it is its own again`);
      assert.equal(seen.stage, '', `${name}: and the throw is over`);
      assert.equal(seen.feet, seen.floor, `${name}: feet on its floor`);
      const settle = rules.settleFrames(want.impact);
      if (settle.length > 0) assert.ok(near(parseLook(seen.body).d, settle[0]), `${name}: squashed as it lands (${seen.body}, wanted ${settle[0]} tall)`);
      break;
    }
    const placed = seen.x === want.x && seen.feet === want.y && seen.stage === want.stage;
    const drawn = sameLook(seen, rules.throwLook(want, box));
    if (!placed || !drawn) {
      wrong += 1;
      if (wrong <= 3) console.log(`    frame ${count}: page (${seen.x}, ${seen.feet}) ${seen.stage} "${seen.body}" ghosts ${seen.ghosts.length}; rules (${want.x}, ${want.y}) ${want.stage} ${JSON.stringify(rules.throwLook(want, box))}`);
    }
  }
  assert.equal(frames[frames.length - 1].want.stage, 'landed', `${name}: it came down`);
  assert.equal(wrong, 0, `${name}: ${wrong} of ${frames.length} frames differ from the rules`);
  const tail = [];
  for (let i = 0; i < after; i += 1) {
    const seen = await frame(page);
    tail.push(seen);
    if (shots > 0 && i < 6) await closeUp(page, `${name}-after-${String(i + 1).padStart(2, '0')}-${seen.motion}`);
  }
  return { frames, tail, box, arena };
}

const stagesOf = (frames) => frames.map((entry) => entry.want.stage).filter((stage, index, all) => index === 0 || stage !== all[index - 1]);

(async () => {
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: !flag('--headed'),
    // swiftshader: the bake needs WebGL, which a headless browser has only this way.
    args: ['--no-first-run', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    console.log(`throwing the companion, ${BASE} (mock accounts, mock data)`);

    console.log('Its strip');
    const baked = await bake(browser);
    const { sheet, reach } = baked;
    for (const id of ['flung', 'splat', 'dizzy']) assert.ok(sheet.motions[id] !== undefined && sheet.motions[id].ticks.length > 0, `the strip holds ${id}`);
    const fresh = ['flung', 'splat', 'dizzy'];
    const older = Object.keys(reach).filter((id) => !fresh.includes(id));
    const widestOld = Math.max(...older.map((id) => reach[id].across));
    const tallestOld = Math.min(...older.map((id) => reach[id].top));
    for (const id of fresh) {
      assert.ok(reach[id].across <= widestOld, `${id} is no wider than the widest motion it already had (${reach[id].across} against ${widestOld} blocks from the middle)`);
      assert.ok(reach[id].top >= tallestOld, `${id} is no taller than the tallest (${reach[id].top} against row ${tallestOld})`);
    }
    assert.ok(baked.bytes < 512 * 1024, `the strip is under the 512 KB cap (${baked.bytes} bytes)`);
    pass(
      `GUY baked by the workbench's own bake: ${Object.keys(sheet.motions).length} motions, ${sheet.cells} cells of ${sheet.cell.w} x ${sheet.cell.h}, ${baked.bytes} bytes; flung, splat and dizzy fit the box the older motions already need (reach ${fresh.map((id) => reach[id].across).join(', ')} against ${widestOld})`,
    );
    const shown = { [PERSON]: { characterId: 'throw-drive', mood: 'calm', stripUrl: baked.stripUrl, sheet, bakedAt: new Date().toISOString() } };
    // The empty margin round the splat's picture, measured here the way the page measures it: what meets the glass.
    const SCALE = 2;
    const insets = { left: reach.splat.left * SCALE, right: reach.splat.right * SCALE, top: reach.splat.top0 * SCALE };

    const { context, page } = await openPage(browser, shown);
    await page.clock.install();
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    // Headless Chrome reports no mouse until the first move, and the site would take it for a phone.
    await page.mouse.move(700, 300);
    await sleep(3000);
    await clearPrivacyWindow(page);
    await page.waitForFunction(() => document.querySelector('[data-companion="own"]')?.style.visibility === 'visible', null, { timeout: 120000 });
    let own = await page.evaluate(readOwn);
    assert.equal(own.figure, 'character', 'it wears the baked character');
    pass(`it is out on its strip wearing it (${own.w} x ${own.h}, floor at ${own.floor}, screen ${own.screen} wide)`);

    console.log('In real time: swung and let go');
    {
      const at = { x: own.x + own.w / 2, y: own.feet - own.h / 2 };
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x, at.y - 40, { steps: 3 });
      await page.mouse.move(500, 520, { steps: 8 });
      await sleep(900);
      // Swung up and to the right, the moves timed by the real clock.
      const moves = [];
      let x = 500;
      let y = 520;
      for (let i = 0; i < 7; i += 1) {
        x += 14;
        y -= 10;
        await page.mouse.move(x, y);
        moves.push({ x, y, t: Date.now() });
        await sleep(12);
      }
      await page.mouse.up();
      const seen = [];
      const end = Date.now() + 9000;
      while (Date.now() < end) {
        const now = await page.evaluate(readOwn);
        if (now !== null && (seen.length === 0 || now.x !== seen[seen.length - 1].x || now.feet !== seen[seen.length - 1].feet || now.stage !== seen[seen.length - 1].stage)) seen.push(now);
        if (seen.length > 3 && now.held === 'false' && now.feet === now.floor) break;
        await sleep(15);
      }
      const over = moves[moves.length - 1].t - moves[0].t;
      const hand = { vx: ((moves[moves.length - 1].x - moves[0].x) / over) * 100, vy: ((moves[moves.length - 1].y - moves[0].y) / over) * 100 };
      const stages = seen.map((entry) => entry.stage).filter((stage, index, all) => index === 0 || stage !== all[index - 1]);
      assert.ok(stages.includes('wind') || stages.includes('fly'), `let go on the move, it is thrown (saw ${stages.join(' > ')})`);
      const air = seen.filter((entry) => entry.stage === 'fly');
      assert.ok(air.length >= 4, `it flew (${air.length} frames in the air)`);
      const top = Math.min(...air.map((entry) => entry.feet));
      assert.ok(top < seen[0].feet - 30, `up past where it was let go (${seen[0].feet - top}px higher)`);
      assert.ok(air[air.length - 1].x > seen[0].x + 60, `and on to the right (${air[air.length - 1].x - seen[0].x}px)`);
      assert.ok(air.some((entry) => entry.ghosts.length === 2) || Math.hypot(hand.vx, hand.vy) < rules.SMEAR_SPEED + 10, 'with a smear behind it while it is fast');
      const last = seen[seen.length - 1];
      assert.equal(last.held, 'false');
      assert.equal(last.feet, last.floor, 'and comes down onto its strip');
      pass(
        `the hand was going about (${Math.round(hand.vx)}, ${Math.round(hand.vy)}) px a frame; it flew on ${air[air.length - 1].x - seen[0].x}px to the right, ${seen[0].feet - top}px up past the let-go, ${air.length} frames in the air, and landed on its strip (${stages.map((stage) => stage || 'down').join(' > ')})`,
      );
    }

    // From here the clock is ours: the loop runs a frame when it is told to.
    await page.clock.pauseAt(new Date(Date.now() + 2000));
    for (let i = 0; i < 40; i += 1) await frame(page);

    console.log('Frame by frame: an arc');
    {
      await carryTo(page, 420, 560);
      await swing(page, { x: 420, y: 560 }, 6, -8);
      const { frames, tail } = await follow(page, 'arc', { vx: 60, vy: -80 }, insets, { shots: 40, after: 8 });
      const first = frames.find((entry) => entry.want.stage === 'fly');
      const start = frames[0].seen;
      assert.equal(first.seen.x - start.x, Math.round(60 * rules.DRAG), 'its first frame in the air: the speed it was let go at, less the air');
      assert.equal(first.seen.feet - start.feet, Math.round(-80 * rules.DRAG + rules.GRAVITY), 'and the pull of the ground');
      const air = frames.filter((entry) => entry.want.stage === 'fly');
      const apex = Math.min(...air.map((entry) => entry.seen.feet));
      const smeared = air.filter((entry) => entry.seen.ghosts.length === 2).length;
      const stretched = Math.max(...air.map((entry) => Math.max(parseLook(entry.seen.body).a, parseLook(entry.seen.body).d)));
      const bounces = air.filter((entry) => entry.want.edge === 'floor' && entry.want.vy < 0);
      assert.ok(smeared >= 3, `a smear on its fast frames (${smeared})`);
      assert.ok(stretched >= 1.25, `drawn out along its path (${stretched.toFixed(2)})`);
      assert.ok(bounces.length >= 1, 'it bounced on its floor');
      const squash = parseLook(bounces[0].seen.body);
      assert.ok(squash.d <= 0.65 && squash.a >= 1.2, `squashed flat on the frame of the bounce (${squash.d} tall, ${squash.a} wide)`);
      assert.ok(air.every((entry) => entry.seen.motion === 'flung'), 'playing flung all the way');
      assert.ok(frames.filter((entry) => entry.want.stage === 'wind').every((entry) => entry.seen.motion === 'dangle'), 'and winding up as it hung in the hand');
      assert.ok(tail.some((entry) => entry.motion === 'land'), `then it lands (${[...new Set(tail.map((entry) => entry.motion))].join(' ')})`);
      const sprung = tail.map((entry) => parseLook(entry.body).d);
      assert.ok(sprung[0] !== 1 || frames[frames.length - 1].want.impact < 8, 'and settles: a spring back after the squash');
      pass(
        `let go at (60, -80) px a frame: all ${frames.length} frames are the rules' own (${stagesOf(frames).join(' > ')}); first air frame +${first.seen.x - start.x}, ${first.seen.feet - start.feet}; rose ${start.feet - apex}px; ${smeared} frames smeared; longest stretch ${stretched.toFixed(2)}; ${bounces.length} bounce(s), the first at ${Math.round(bounces[0].want.impact)} px a frame squashed to ${squash.d} tall by ${squash.a} wide; settling ${sprung.slice(0, 3).join(', ')}`,
      );
    }

    console.log('Frame by frame: splats');
    for (const side of ['right', 'left', 'top']) {
      const from = side === 'right' ? { x: 1000, y: 420 } : side === 'left' ? { x: 440, y: 420 } : { x: 720, y: 520 };
      const step = side === 'right' ? { dx: 16, dy: -1 } : side === 'left' ? { dx: -16, dy: -1 } : { dx: 1, dy: -17 };
      await carryTo(page, from.x, from.y);
      await swing(page, from, step.dx, step.dy);
      const { frames, tail } = await follow(page, `splat-${side}`, { vx: step.dx * 10, vy: step.dy * 10 }, insets, { shots: 30, after: 36 });
      const stuck = frames.filter((entry) => entry.want.stage === 'stuck');
      assert.ok(stuck.length >= rules.STUCK_TICKS[0], `it splatted on the ${side} (${stuck.length} frames stuck)`);
      const hit = stuck[0];
      assert.equal(hit.want.edge, side);
      assert.ok(hit.want.impact >= rules.SPLAT_SPEED);
      // Flat against that edge: the figure's own picture on the glass, short the way it hit, spread the other way.
      const flat = parseLook(hit.seen.body);
      const along = side === 'top' ? flat.d : flat.a;
      const across = side === 'top' ? flat.a : flat.d;
      assert.ok(along <= 0.45 && across >= 1.5, `flat on the hit (${along} by ${across})`);
      assert.ok(Math.abs(along * across * across - 1) < 0.01, `as much of it as before (${(along * across * across).toFixed(3)})`);
      if (side === 'right') assert.equal(hit.seen.x + hit.seen.w - insets.right, hit.seen.screen, 'its picture on the right edge of the screen');
      if (side === 'left') assert.equal(hit.seen.x + insets.left, 0, 'its picture on the left edge of the screen');
      if (side === 'top') assert.equal(hit.seen.feet - hit.seen.h + insets.top, 0, 'its head on the top edge of the screen');
      assert.ok(stuck.every((entry) => entry.seen.motion === 'splat'), 'playing splat while it is stuck');
      const peel = frames.filter((entry) => entry.want.stage === 'peel');
      assert.equal(peel.length, rules.PEEL_TICKS, 'then it peels off');
      assert.equal(frames[frames.length - 1].want.splatted, true);
      // Dizzy: the reel with stars going round, then the shake, then a hop to get going.
      const motions = tail.map((entry) => entry.motion).filter((motion, index, all) => index === 0 || motion !== all[index - 1]);
      assert.equal(motions[0], 'dizzy', `down, it is dizzy (${motions.join(' > ')})`);
      assert.ok(motions.includes('hop'), `and hops to get going again (${motions.join(' > ')})`);
      const stars = [...new Set(tail.filter((entry) => entry.motion === 'dizzy' && entry.mark !== null).map((entry) => entry.mark))];
      assert.ok(stars.length >= 3 && stars.every((mark) => mark.includes('✶')), `stars go round its head (${stars.join(' ')})`);
      pass(
        `${side}: let go at (${step.dx * 10}, ${step.dy * 10}); all ${frames.length} frames are the rules' own (${stagesOf(frames).join(' > ')}); hit at ${Math.round(hit.want.impact)} px a frame, ${along} by ${across} on the glass, stuck ${stuck.length} frames, peeled ${peel.length}; then ${motions.join(' > ')} with ${stars.join(' ')}`,
      );
    }

    console.log('Frame by frame: a soft bounce off a side');
    {
      await carryTo(page, 1290, 500);
      await swing(page, { x: 1290, y: 500 }, 5, -3);
      const { frames, tail } = await follow(page, 'bump', { vx: 50, vy: -30 }, insets, { shots: 8, after: 4 });
      assert.equal(frames.filter((entry) => entry.want.stage === 'stuck').length, 0, 'no splat: too slow into the glass');
      const bump = frames.find((entry) => entry.want.edge === 'right');
      assert.ok(bump, 'it met the right side');
      assert.ok(bump.want.impact < rules.SPLAT_SPEED && bump.want.vx < 0, 'and came back off it');
      const look = parseLook(bump.seen.body);
      assert.ok(look.a < 0.8, `squashed against it for the frame of the bounce (${look.a})`);
      assert.equal(frames[frames.length - 1].want.splatted, false);
      assert.ok(!tail.some((entry) => entry.motion === 'dizzy'), 'and it is not dizzy after');
      pass(`into the right side at ${Math.round(bump.want.impact)} px a frame (under ${rules.SPLAT_SPEED}): squashed to ${look.a} for one frame, back off it at ${Math.round(bump.want.vx)}, no splat, no stars; all ${frames.length} frames are the rules' own`);
    }

    console.log('Put down, not thrown');
    {
      // Let go slowly: under the speed of a throw.
      await carryTo(page, 700, 500);
      await swing(page, { x: 700, y: 500 }, 1, 0);
      let now = await page.evaluate(readOwn);
      assert.equal(now.stage, '', 'slow: no wind-up');
      const seen = [];
      for (let i = 0; i < 40; i += 1) {
        now = await frame(page);
        seen.push(now);
        if (now.held === 'false' && now.feet === now.floor) break;
      }
      assert.ok(seen.every((entry) => entry.stage === '' && plain(entry) && entry.ghosts.length === 0), 'it only drops: no throw, no squash, no smear');
      assert.equal(seen[seen.length - 1].feet, seen[seen.length - 1].floor);
      assert.ok(Math.abs(seen[seen.length - 1].x - seen[0].x) <= 40, 'straight down, near enough');
      // Swung fast, but the pointer stops before the key is lifted: at rest, so it drops.
      await carryTo(page, 700, 500);
      let x = 700;
      for (let i = 0; i < 5; i += 1) {
        x += 16;
        await page.mouse.move(x, 500);
        await page.clock.runFor(10);
      }
      await page.clock.runFor(rules.SAMPLE_FRESH_MS + 30);
      await page.mouse.up();
      now = await page.evaluate(readOwn);
      assert.equal(now.stage, '', 'stopped first: no throw');
      for (let i = 0; i < 40 && !(now.held === 'false' && now.feet === now.floor); i += 1) now = await frame(page);
      assert.equal(now.feet, now.floor);
      pass(`let go at 10 px a frame (a throw is ${rules.THROW_MIN}) it drops straight down ${seen.length} frames with no wind-up, squash or smear; swung fast and then held still ${rules.SAMPLE_FRESH_MS + 30} ms before letting go, it drops too`);
    }

    console.log('A double press, then put down on the move');
    {
      for (let i = 0; i < 20; i += 1) await frame(page);
      own = await page.evaluate(readOwn);
      const at = { x: own.x + own.w / 2, y: own.feet - own.h / 2 };
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.clock.runFor(120);
      await page.mouse.down();
      await page.mouse.up();
      await frame(page);
      await page.mouse.move(600, 480);
      for (let i = 0; i < 9; i += 1) await frame(page);
      own = await page.evaluate(readOwn);
      assert.equal(own.held, 'true', 'two presses close together pick it up, nothing held down');
      await swing(page, { x: 600, y: 480 }, 9, -6, 'down');
      await page.mouse.up();
      const { frames } = await follow(page, 'put-down', { vx: 90, vy: -60 }, insets, { shots: 0, after: 2 });
      pass(`carried after a double press and put down with the pointer going (90, -60): thrown, all ${frames.length} frames the rules' own (${stagesOf(frames).join(' > ')})`);
    }

    console.log('Caught out of the air');
    {
      await carryTo(page, 500, 300);
      await swing(page, { x: 500, y: 300 }, 4, -6);
      let now = await page.evaluate(readOwn);
      assert.equal(now.stage, 'wind');
      for (let i = 0; i < 5; i += 1) now = await frame(page);
      assert.equal(now.stage, 'fly');
      await page.mouse.move(now.x + now.w / 2, now.feet - now.h / 2);
      await page.mouse.down();
      await page.mouse.move(now.x + now.w / 2 + 12, now.feet - now.h / 2 - 12);
      now = await frame(page);
      assert.equal(now.held, 'true');
      assert.equal(now.stage, '', 'caught: the throw is over');
      assert.ok(plain(now), 'and it is its own shape again');
      assert.equal(now.ghosts.length, 0);
      const caught = { x: now.x, feet: now.feet };
      for (let i = 0; i < 4; i += 1) now = await frame(page);
      assert.ok(Math.abs(now.x - caught.x) <= 2 && Math.abs(now.feet - caught.feet) <= 2, 'it hangs from the pointer where it was caught');
      // Held still and let go: a plain drop.
      await page.clock.runFor(200);
      await page.mouse.up();
      for (let i = 0; i < 50 && !(now.held === 'false' && now.feet === now.floor); i += 1) now = await frame(page);
      assert.equal(now.feet, now.floor);
      pass('pressed and dragged in mid-air it is caught: the throw stops, it hangs from the pointer in its own shape, and let go at rest it drops');
    }
    await context.close();

    console.log('Reduced motion');
    {
      const still = await openPage(browser, shown, { reduced: true });
      await still.page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded', timeout: 180000 });
      await still.page.mouse.move(700, 300);
      await sleep(3000);
      await clearPrivacyWindow(still.page);
      await still.page.waitForFunction(() => document.querySelector('[data-companion="own"]')?.style.visibility === 'visible', null, { timeout: 120000 });
      const before = await still.page.evaluate(readOwn);
      const at = { x: before.x + before.w / 2, y: before.feet - before.h / 2 };
      await still.page.mouse.move(at.x, at.y);
      await still.page.mouse.down();
      const seen = [];
      let x = at.x;
      let y = at.y;
      for (let i = 0; i < 8; i += 1) {
        x += 16;
        y -= 12;
        await still.page.mouse.move(x, y);
        await sleep(12);
        seen.push(await still.page.evaluate(readOwn));
      }
      await still.page.mouse.up();
      for (let i = 0; i < 12; i += 1) {
        await sleep(100);
        seen.push(await still.page.evaluate(readOwn));
      }
      assert.ok(seen.every((entry) => entry.stage === '' && entry.held === 'false' && plain(entry) && entry.ghosts.length === 0), 'nothing is carried, thrown, squashed or smeared');
      assert.ok(seen.every((entry) => entry.x === before.x && entry.feet === before.floor), 'it stays where it stands');
      await still.context.close();
      pass('under reduced motion a press, a fast drag and a let-go move nothing: it stays where it stands, in one frame');
    }

    console.log(`\n${passed} passed. Close-ups: ${SHOTS}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});
