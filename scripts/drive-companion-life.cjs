/*
 * Drives the companion's life of its own (Luke, 2026-11-14) in a real browser, as TEST ACCOUNT A. Not in `npm run
 * checks`: it needs the kept test accounts.
 *
 *   node scripts/drive-companion-life.cjs --base https://debaser-site.vercel.app [--long] [--headed] [--env-test <path>]
 *
 *   1. an old strip is baked again, quietly: A's sheet gains the newer motions within a minute of the page opening (or
 *      already holds them), and the strip is saved to Temp/browse/companion-strip.png to be looked at;
 *   2. picked up: a press and a drag lifts it off its strip, it follows the pointer swinging (`dangle`), and let go it
 *      falls, lands (`land`) and is back on its strip;
 *   3. a press without a drag: a hop, a wave, a spin, in turn;
 *   4. it runs (`run`) after the pointer;
 *   5. it dances one of five dances while the music bar plays, and changes dance when the track changes;
 *   6. asleep after a minute, `z`s drift up from it; with --long, five minutes on it curls up, and stretches then waves
 *      when the pointer comes back;
 *   7. under reduced motion a drag carries nothing and nothing drifts up.
 *
 * It writes nothing but A's own re-baked strip (the same save SHOW does): no messages, no rooms, nothing to clear.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, installSession, loadEnv, signInTestAccount, testAccountClient } = require('./browser.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'https://debaser-site.vercel.app').replace(/\/$/, '');
const LONG = flag('--long');
const SHOTS = join('Temp', 'browse');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const NEWER = ['stretch', 'dance4', 'dance5', 'run', 'cheer', 'slump', 'dangle', 'land', 'curl', 'watch', 'read', 'flick', 'type', 'climb'];

function readOwn() {
  const own = document.querySelector('[data-companion="own"]');
  if (own === null || own.style.visibility !== 'visible') return null;
  const box = own.getBoundingClientRect();
  const bar = Number.parseFloat(document.documentElement.style.getPropertyValue('--bottom-bar')) || 0;
  const trail = own.querySelector('[data-note-trail]');
  return {
    left: Math.round(box.left),
    top: Math.round(box.top),
    bottom: Math.round(box.bottom),
    w: Math.round(box.width),
    h: Math.round(box.height),
    floor: Math.round(window.innerHeight - bar),
    mood: own.dataset.mood,
    motion: own.dataset.motion ?? null,
    held: own.dataset.held,
    trail: trail === null ? null : trail.getAttribute('data-note-trail'),
    glyphs: trail === null ? '' : trail.textContent,
    figure: own.querySelector('[data-companion-figure]')?.getAttribute('data-companion-figure') ?? null,
  };
}

/** Every motion it plays over `ms`, read ten times a second. */
async function motionsOver(page, ms) {
  const seen = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const now = await page.evaluate(readOwn);
    if (now !== null && seen[seen.length - 1] !== now.motion) seen.push(now.motion);
    await sleep(90);
  }
  return seen;
}

async function waitFor(page, test, ms, every = 150) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const now = await page.evaluate(readOwn);
    if (now !== null && test(now)) return now;
    await sleep(every);
  }
  return null;
}

async function open(browser, { reduced = false } = {}) {
  const account = await signInTestAccount('A');
  if (account.error) throw new Error(`sign-in A: ${account.error}`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await context.addInitScript(() => window.localStorage.setItem('debaser.lost-account.never.v1', '1'));
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
  await installSession(page, account);
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  // Headless Chrome reports no mouse until the first move, and the site would take it for a phone.
  await page.mouse.move(700, 300);
  await sleep(3000);
  const close = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if ((await close.count()) > 0) await close.first().click().catch(() => undefined);
  await page.waitForSelector('[data-companion="own"]', { state: 'attached', timeout: 20000 });
  return { page, context, account };
}

(async () => {
  loadEnv();
  process.loadEnvFile('.env.production');
  process.loadEnvFile(opt('--env-test', '.env.test'));
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: !flag('--headed'),
    // swiftshader: the re-bake needs WebGL, which a headless browser has only this way.
    args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const { client, id } = await testAccountClient('A');
    const sheetNow = async () => {
      const { data, error } = await client.from('profile_characters').select('strip, sheet, baked_at').eq('person', id).maybeSingle();
      if (error || data === null) throw new Error('A has no SHOWN character: show one first (scripts/drive-profile-character.cjs)');
      return data;
    };
    const before = await sheetNow();
    const lacked = NEWER.filter((motion) => before.sheet.motions[motion] === undefined);
    console.log(`A's strip before: baked ${before.baked_at}, ${Object.keys(before.sheet.motions).length} motions${lacked.length > 0 ? `, lacking ${lacked.length} of the newer ones` : ''}`);

    const { page } = await open(browser);
    let own = await waitFor(page, () => true, 15000);
    assert.ok(own, 'the companion is drawn');
    assert.equal(own.figure, 'character', "it wears A's SHOWN character");
    pass(`it is out on its strip wearing A's character (${own.w} x ${own.h}), playing ${own.motion}`);

    console.log('An old strip is baked again, quietly');
    let after = before;
    if (lacked.length > 0) {
      // Even before the bake, every newer motion plays as an older one: pressed now, it hops rather than breaking.
      const end = Date.now() + 90000;
      while (Date.now() < end && NEWER.some((motion) => after.sheet.motions[motion] === undefined)) {
        await sleep(3000);
        await page.mouse.move(600 + Math.round(Math.random() * 200), 300);
        after = await sheetNow();
      }
      assert.deepEqual(NEWER.filter((motion) => after.sheet.motions[motion] === undefined), [], 'the strip was baked again with the newer motions');
      assert.notEqual(after.baked_at, before.baked_at);
      pass(`A's browser baked the strip again on its own: ${Object.keys(after.sheet.motions).length} motions, ${after.sheet.cells} cells, a ${after.sheet.cell.w} x ${after.sheet.cell.h} cell (was ${before.sheet.cell.w} x ${before.sheet.cell.h})`);
      await sleep(2500);
    } else {
      pass(`A's strip already holds the newer motions (${Object.keys(before.sheet.motions).length} motions, ${before.sheet.cells} cells)`);
    }
    const stripUrl = client.storage.from('profile-characters').getPublicUrl(after.strip).data.publicUrl;
    const png = Buffer.from(await (await fetch(stripUrl)).arrayBuffer());
    writeFileSync(join(SHOTS, 'companion-strip.png'), png);
    assert.ok(png.length < 512 * 1024, `the strip is under the 512 KB cap (${png.length} bytes)`);
    pass(`the strip is ${png.length} bytes (cap 512 KB), saved to ${join(SHOTS, 'companion-strip.png')}`);

    console.log('Picked up, carried, dropped');
    own = await waitFor(page, (now) => now.held === 'false' && now.bottom === now.floor, 10000);
    assert.ok(own, 'standing on its strip');
    const start = { x: own.left + own.w / 2, y: own.top + own.h / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y - 60, { steps: 4 });
    await page.mouse.move(start.x - 200, start.y - 320, { steps: 12 });
    // It moves in whole frames, ten a second: a moment for it to catch the pointer up.
    await sleep(400);
    const held = await waitFor(page, (now) => now.held === 'true' && now.motion === 'dangle', 3000);
    assert.ok(held, 'a drag lifts it: held, dangling');
    assert.ok(held.bottom < held.floor - 200, `it is up off its strip (feet ${held.bottom}, strip ${held.floor})`);
    assert.ok(Math.abs(held.left + held.w / 2 - (start.x - 200)) <= 2, 'it hangs where the pointer has it');
    assert.equal(held.mood, 'stand');
    await page.screenshot({ path: join(SHOTS, 'companion-held.png') });
    pass(`a press and a drag picks it up: it hangs from the pointer ${held.floor - held.bottom}px above its strip, playing dangle`);
    // Carried right off the top and the side: it stays on the screen.
    await page.mouse.move(-50, -50, { steps: 6 });
    await sleep(400);
    const cornered = await page.evaluate(readOwn);
    assert.ok(cornered.left >= 0 && cornered.top >= 0, `carried off the corner, it stays on screen (${cornered.left}, ${cornered.top})`);
    await page.mouse.move(500, 300, { steps: 6 });
    await sleep(300);
    await page.mouse.up();
    const heights = [];
    let landed = null;
    const fallEnd = Date.now() + 6000;
    const fallMotions = new Set();
    while (Date.now() < fallEnd) {
      const now = await page.evaluate(readOwn);
      if (now !== null) {
        heights.push(now.bottom);
        fallMotions.add(now.motion);
        assert.ok(now.bottom <= now.floor, 'never under its floor');
        if (now.held === 'false' && now.bottom === now.floor) {
          landed = now;
          break;
        }
      }
      await sleep(60);
    }
    assert.ok(landed, 'let go, it comes back down to its strip');
    assert.ok(heights.some((h, i) => i > 0 && h > heights[i - 1]), 'it fell, frame by frame');
    const landing = await motionsOver(page, 900);
    assert.ok(fallMotions.has('land') || landing.includes('land'), `it lands (saw ${[...fallMotions, ...landing].join(' ')})`);
    pass(`let go, it falls back to its strip and lands (${[...new Set([...fallMotions, ...landing])].join(', ')})`);

    console.log('A press without a drag: hop, wave, spin');
    const pokes = [];
    for (let press = 0; press < 3; press += 1) {
      await page.mouse.move(700, 300);
      await sleep(1600);
      const at = await page.evaluate(readOwn);
      const watching = motionsOver(page, 1300);
      await page.mouse.click(at.left + at.w / 2, at.top + at.h / 2);
      pokes.push((await watching).filter((motion) => ['hop', 'wave', 'dance4'].includes(motion)));
      const still = await page.evaluate(readOwn);
      assert.equal(still.held, 'false', 'a press is not a pick-up');
    }
    assert.deepEqual(pokes.map((seen) => seen[0]), ['hop', 'wave', 'dance4'], `in turn (saw ${JSON.stringify(pokes)})`);
    pass('pressed three times: a hop, a wave, a spin');

    console.log('It runs after the pointer');
    const at = await page.evaluate(readOwn);
    const far = at.left > 720 ? 200 : 1200;
    await page.mouse.move(far, at.floor - 40, { steps: 3 });
    const running = await waitFor(page, (now) => now.motion === 'run' && now.mood === 'chase', 3000);
    assert.ok(running, 'runs after the pointer near its strip');
    await page.screenshot({ path: join(SHOTS, 'companion-run.png') });
    pass('the pointer near its strip: it runs after it');
    await page.mouse.move(700, 300);

    console.log('It dances, and changes dance with the track');
    const tile = page.locator('span[data-companion-avoid] > button').first();
    if ((await tile.count()) > 0 && (await tile.isVisible())) await tile.click();
    await sleep(500);
    const cell = page.locator('button[title="Playing"], button[title="Paused"], button[title="Looping"]').first();
    await cell.waitFor({ timeout: 30000 });
    let dancing = null;
    for (let press = 0; press < 4 && dancing === null; press += 1) {
      await cell.click();
      await page.mouse.move(700, 200);
      dancing = await waitFor(page, (now) => now.mood === 'dance', 4000);
    }
    assert.ok(dancing, 'dances while the bar plays');
    assert.match(dancing.motion ?? '', /^dance[1-5]$/);
    const dances = new Set([dancing.motion]);
    for (let track = 0; track < 6; track += 1) {
      const was = (await page.evaluate(readOwn)).motion;
      await page.getByRole('button', { name: 'Next track' }).first().click();
      await page.mouse.move(700, 200);
      const changed = await waitFor(page, (now) => now.mood === 'dance' && now.motion !== was && /^dance[1-5]$/.test(now.motion ?? ''), 5000);
      assert.ok(changed, `a new track is a new dance (still ${was})`);
      dances.add(changed.motion);
    }
    assert.ok(dances.size >= 3, `several dances over six tracks (${[...dances].join(' ')})`);
    await page.screenshot({ path: join(SHOTS, 'companion-dance.png') });
    pass(`the music bar playing: it dances, a different dance with each new track (${[...dances].join(', ')})`);
    for (let press = 0; press < 4 && (await cell.getAttribute('title')) !== 'Paused'; press += 1) {
      await cell.click();
      await sleep(800);
    }
    assert.equal(await cell.getAttribute('title'), 'Paused', 'the bar is paused again');

    console.log('Asleep: z z z');
    await page.mouse.move(700, 200);
    const hour = new Date().getHours();
    const asleep = await waitFor(page, (now) => now.mood === 'sleep', 75000, 500);
    assert.ok(asleep, 'asleep after a minute with nothing happening');
    const snoring = await waitFor(page, (now) => now.trail === 'snores' && /z/i.test(now.glyphs), 5000);
    assert.ok(snoring, 'z z z drifts up from it');
    await page.screenshot({ path: join(SHOTS, 'companion-asleep.png') });
    pass(`a minute with nothing happening${hour < 5 ? ' (the small hours: sooner)' : ''}: it sleeps, and "${snoring.glyphs}" drifts up from it`);
    if (LONG) {
      const curled = await waitFor(page, (now) => now.motion === 'curl', 260000, 1000);
      assert.ok(curled, 'curled up after five minutes');
      await page.screenshot({ path: join(SHOTS, 'companion-curled.png') });
      pass('five minutes alone: it curls right up');
      const waking = motionsOver(page, 4500);
      await page.mouse.move(600, 300);
      const woke = await waking;
      assert.ok(woke.includes('stretch'), `it stretches when you come back (saw ${woke.join(' ')})`);
      assert.ok(woke.indexOf('wave') > woke.indexOf('stretch'), `then waves (saw ${woke.join(' ')})`);
      pass(`you coming back: ${woke.join(', ')}`);
    } else {
      const waking = motionsOver(page, 2500);
      await page.mouse.move(600, 300);
      const woke = await waking;
      assert.ok(woke.includes('stretch'), `it stretches when you come back (saw ${woke.join(' ')})`);
      pass(`you coming back: it wakes with a stretch (${woke.join(', ')})`);
    }
    await page.context().close();

    console.log('Reduced motion: nothing is carried, nothing drifts');
    const calm = await open(browser, { reduced: true });
    const stood = await waitFor(calm.page, () => true, 15000);
    assert.ok(stood, 'drawn under reduced motion');
    await calm.page.mouse.move(stood.left + stood.w / 2, stood.top + stood.h / 2);
    await calm.page.mouse.down();
    await calm.page.mouse.move(stood.left - 200, stood.top - 300, { steps: 8 });
    await sleep(500);
    const unmoved = await calm.page.evaluate(readOwn);
    await calm.page.mouse.up();
    assert.equal(unmoved.held, 'false');
    assert.equal(unmoved.left, stood.left);
    assert.equal(unmoved.bottom, unmoved.floor);
    assert.equal(unmoved.trail, null);
    pass('under reduced motion a drag carries nothing: it stands still on its strip');
    await calm.context.close();

    console.log(`\n${passed} passed. Screenshots in ${SHOTS}/companion-*.png`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});
