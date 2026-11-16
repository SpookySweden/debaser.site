/*
 * Drives the companion being shoved by windows (Luke, 2026-11-16: "If a window pops up on him or moves across him, it pushes
 * him in silly, fun ways, like a physics experiment") in a real browser, against a LOCAL dev server on mock accounts and mock
 * data. Not in `npm run checks`: it needs that server. It never touches the live site or the live database (the Supabase host
 * is blocked and the run fails if anything tried it), and leaves nothing: everything is in the test browser's own storage.
 *
 *   start the server with every switch on mock and the Supabase address and key empty (from a node launcher, see core.md), then
 *   node scripts/drive-companion-shove.cjs --base http://localhost:3355 [--headed]
 *
 * In real time, the mock's hidden test person signed in with the companion switched on (the plain figure, no character):
 *   1. PREFERENCES is dragged down onto the strip and then hard across the companion: it is thrown the way the window went;
 *   2. the companion is put down where the window will open, and PREFERENCES is opened on top of it: it pops out sideways;
 *   3. under reduced motion the same drag moves nothing.
 * A watcher in the page writes down every frame's throw stage and place, so a shove is read from what the page did.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = (args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3355').replace(/\/$/, '');
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.log('This drive is for a local dev server on mock data only (core.md: test locally, not on the live site).');
  process.exit(2);
}
const HEADED = args.includes('--headed');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ok = (what) => console.log(`  ok  ${what}`);

const PERSON = 'mock-test-account';
function seed() {
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser-companion', JSON.stringify({ computer: true, phone: false }));
  if (window.localStorage.getItem('debaser.auth.mock.v1') === null) {
    window.localStorage.setItem(
      'debaser.auth.mock.v1',
      JSON.stringify({ users: [{ id: 'mock-test-account', email: 'test-mock@debaser.site', displayName: 'TEST ACCOUNT (MOCK)', createdAt: '2026-11-14T00:00:00.000Z', salt: '', secretHash: '', hidden: true }], sessionUserId: 'mock-test-account', bannedIds: [] }),
    );
  }
}

/** Writes down the companion's throw stage and place every time either changes. */
function watch() {
  const own = document.querySelector('[data-companion="own"]');
  window.__shoveLog = [];
  const note = () => {
    const box = own.getBoundingClientRect();
    window.__shoveLog.push({ t: performance.now(), stage: own.dataset.throw ?? '', x: Math.round(box.left), feet: Math.round(box.bottom) });
  };
  note();
  new MutationObserver(note).observe(own, { attributes: true, attributeFilter: ['style', 'data-throw'] });
}

const where = (page) =>
  page.evaluate(() => {
    const own = document.querySelector('[data-companion="own"]');
    if (own === null || own.style.visibility !== 'visible') return null;
    const box = own.getBoundingClientRect();
    return { x: Math.round(box.left), w: Math.round(box.width), h: Math.round(box.height), feet: Math.round(box.bottom), stage: own.dataset.throw ?? '' };
  });

async function openPage(browser, reduced) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  let live = 0;
  await context.route(/supabase\.(co|in)\//, (route) => {
    live += 1;
    return route.abort();
  });
  await context.addInitScript(seed);
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 300)}`));
  await page.mouse.move(700, 200);
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  const keep = page.getByText('[ KEEP THESE SETTINGS ]');
  await keep.waitFor({ timeout: 30_000 }).then(() => keep.click(), () => undefined);
  await page.waitForFunction(() => document.querySelector('[data-companion="own"]')?.style.visibility === 'visible', null, { timeout: 120_000 });
  return { context, page, live: () => live };
}

async function togglePreferences(page) {
  // The side panel's settings menu may still be open from the last press.
  const item = page.getByText(/\[ PREFERENCES \]/).first();
  if (!(await item.isVisible().catch(() => false))) await page.getByText(/\[\s*⚙\s*SETTINGS\s*\]/).first().click();
  await item.click();
}

/** Drags a window by its title line from where it is to (x, y) for its title's middle, in `steps` moves `gap` ms apart. */
async function dragWindow(page, id, to, steps, gap) {
  const title = page.locator(`[data-dock-window="${id}"] .title-line`).first();
  const box = await title.boundingBox();
  const from = { x: box.x + 20, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(gap);
  }
  await page.mouse.up();
}

const windowBox = (page, id) => page.locator(`[data-dock-window="${id}"]`).first().boundingBox();

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !HEADED });
  const { context, page, live } = await openPage(browser, false);
  // The bar settles first (its height moves the strip): its feet are measured once they stop moving.
  await sleep(3000);
  const floor = await where(page);
  assert.ok(floor !== null, 'the companion is out');
  ok(`the companion is out on its strip (feet at ${floor.feet})`);

  // 1. A window dragged hard across it.
  await togglePreferences(page);
  await page.locator('[data-dock-window="preferences"]').waitFor();
  let win = await windowBox(page, 'preferences');
  const grip = (await page.locator('[data-dock-window="preferences"] .title-line').first().boundingBox());
  const titleDrop = win.height - (grip.y + grip.height / 2 - win.y);
  // Down onto the strip at the left of the screen, slowly (a window barely moving only leans), its foot level with the
  // companion's middle, so it reaches into the band it stands in.
  await dragWindow(page, 'preferences', { x: 40, y: floor.feet - floor.h / 2 - titleDrop }, 30, 60);
  await sleep(1500);
  win = await windowBox(page, 'preferences');
  // It walks round the window by itself; wait for it to stand clear right of the window.
  let before = await where(page);
  for (let i = 0; i < 40 && (before === null || before.x < win.x + win.width + 20 || before.stage !== ''); i += 1) {
    await sleep(250);
    before = await where(page);
  }
  assert.ok(before !== null && before.stage === '', 'standing on its strip before the hit');
  if (args.includes('--debug')) console.log('  window', JSON.stringify(win), 'companion', JSON.stringify(before));
  await page.evaluate(watch);
  const title = await page.locator('[data-dock-window="preferences"] .title-line').first().boundingBox();
  // Hard to the right, through where it stands: 60px every 30ms.
  await dragWindow(page, 'preferences', { x: Math.min(1400, before.x + win.width + 200), y: title.y + title.height / 2 }, 14, 30);
  await sleep(2500);
  if (args.includes('--debug')) { console.log('  after', JSON.stringify(await windowBox(page, 'preferences'))); await page.screenshot({ path: 'Temp/browse/shove-after.png' }); }
  const log = await page.evaluate(() => window.__shoveLog);
  const flew = log.filter((frame) => frame.stage === 'fly');
  assert.ok(flew.length > 0, `thrown by the window (stages seen: ${[...new Set(log.map((frame) => frame.stage))].join(', ')})`);
  const highest = Math.min(...flew.map((frame) => frame.feet));
  const furthest = Math.max(...log.map((frame) => frame.x));
  assert.ok(furthest > before.x + 40, `the way the window went (from x ${before.x} to ${furthest})`);
  assert.ok(highest < before.feet - 10, `up into the air (feet up to ${highest}, floor ${before.feet})`);
  const splat = log.some((frame) => frame.stage === 'stuck');
  ok(`dragged across it: thrown right from x ${before.x} to ${furthest}, up to ${before.feet - highest}px off its floor${splat ? ', splat against the edge' : ''}`);
  // A splat sticks, peels, drops and leaves it dizzy for a moment: give it time to come down.
  let down = await where(page);
  for (let i = 0; i < 40 && down?.stage !== ''; i += 1) {
    await sleep(250);
    down = await where(page);
  }
  assert.equal(down?.stage, '', 'and down again');
  ok('down again after');

  // 2. A window opened on top of it.
  win = await windowBox(page, 'preferences');
  // Shut by its own close key (it now covers the side panel's menu).
  await page.locator('[data-dock-window="preferences"]').getByRole('button', { name: /close/i }).first().click();
  await page.locator('[data-dock-window="preferences"]').waitFor({ state: 'detached' }).catch(() => undefined);
  await sleep(500);
  // Pick it up and put it down slowly under where the window was (and will open again), well left of its middle.
  let at = await where(page);
  const target = Math.round(win.x + win.width * 0.3 - at.w / 2);
  await page.mouse.move(at.x + at.w / 2, at.feet - at.h / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i += 1) {
    await page.mouse.move(at.x + at.w / 2 + ((target - at.x) * i) / 20, at.feet - at.h / 2 - 40);
    await sleep(40);
  }
  await sleep(400);
  await page.mouse.up();
  await sleep(2000);
  at = await where(page);
  assert.ok(at !== null && at.stage === '' && at.x + at.w > win.x && at.x < win.x + win.width, `put down under where the window opens (x ${at?.x}; window ${Math.round(win.x)}..${Math.round(win.x + win.width)})`);
  await page.mouse.move(700, 100);
  await page.evaluate(watch);
  await togglePreferences(page);
  await sleep(2500);
  const popLog = await page.evaluate(() => window.__shoveLog);
  const popped = popLog.filter((frame) => frame.stage === 'fly');
  assert.ok(popped.length > 0, `popped by the window opening on it (stages: ${[...new Set(popLog.map((frame) => frame.stage))].join(', ')})`);
  const middle = win.x + win.width / 2;
  // Its first frames in the air say which way it was knocked (later it may bounce off an edge of the screen).
  const went = popped[Math.min(2, popped.length - 1)].x - at.x;
  assert.ok(at.x + at.w / 2 < middle && went < 0, `out to the side away from the window's middle (stood ${Math.round(middle - at.x - at.w / 2)}px left of it, moved ${went})`);
  ok(`a window opened on it: popped ${went > 0 ? 'right' : 'left'} ${Math.abs(went)}px, up to ${at.feet - Math.min(...popped.map((frame) => frame.feet))}px`);

  assert.equal(live(), 0, 'nothing reached the live site');
  await context.close();

  // 3. Reduced motion: the same drag moves nothing.
  const still = await openPage(browser, true);
  await togglePreferences(still.page);
  await still.page.locator('[data-dock-window="preferences"]').waitFor();
  const quiet = await where(still.page);
  if (quiet !== null) {
    await still.page.evaluate(watch);
    await dragWindow(still.page, 'preferences', { x: 40, y: quiet.feet - titleDrop + 20 }, 10, 30);
    const t2 = await still.page.locator('[data-dock-window="preferences"] .title-line').first().boundingBox();
    await dragWindow(still.page, 'preferences', { x: 1400, y: t2.y + t2.height / 2 }, 14, 30);
    await sleep(1500);
    const quietLog = await still.page.evaluate(() => window.__shoveLog);
    assert.ok(!quietLog.some((frame) => frame.stage !== ''), 'nothing throws it under reduced motion');
    ok('reduced motion: the same drag throws nothing');
  } else ok('reduced motion: (the companion is not drawn here)');
  assert.equal(still.live(), 0, 'nothing reached the live site');
  ok('nothing reached the live site');
  await browser.close();
  console.log(`\nshoved by windows: OK (as ${PERSON}, on ${BASE})`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
