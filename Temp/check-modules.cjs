/**
 * The top bar's modules (Luke, 2026-11-06), driven in Chrome: what's on by default, the list, ticking one on, a hover colour, and the arrows' width.
 * Choices stay in this throwaway browser: signed out, nothing reaches an account.
 *
 *   node Temp/check-modules.cjs                 the local build (`npm run build` first); starts its own `next start` on :3213 if none is up
 *   node Temp/check-modules.cjs --url <origin>  any deployed copy, e.g. the live site
 */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3213;
const urlAt = process.argv.indexOf('--url');
const BASE = urlAt === -1 ? `http://127.0.0.1:${PORT}` : process.argv[urlAt + 1].replace(/\/$/, '');
const shotAt = process.argv.indexOf('--shots');
const SHOTS = shotAt === -1 ? null : process.argv[shotAt + 1];

async function up() {
  try {
    return (await fetch(`${BASE}/forum`)).ok;
  } catch {
    return false;
  }
}

(async () => {
  let server = null;
  if (urlAt === -1 && !(await up())) {
    server = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    for (let attempt = 0; attempt < 40 && !(await up()); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    assert.ok(await up(), `nothing is serving ${BASE}/forum (run npm run build first)`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await nav.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(800);

    const keys = async () => (await nav.locator('a, button:not([aria-label])').allInnerTexts()).map((text) => text.trim());
    assert.deepEqual(await keys(), ['PROJECTS', 'FORUM', 'MEDIA', 'DISCOVER', 'STREAM', 'MODULES'], 'the keys a first visit shows');
    console.log('  ok    first visit: PROJECTS FORUM MEDIA DISCOVER STREAM MODULES, no BEATBOX or ANIMATE');

    const title = nav.getByText('MODULES:', { exact: true });
    const back = nav.getByRole('button', { name: 'Back' });
    const forward = nav.getByRole('button', { name: 'Forward' });
    const [backBox, forwardBox, titleBox] = await Promise.all([back.boundingBox(), forward.boundingBox(), title.boundingBox()]);
    assert.ok(backBox.width <= 24 && forwardBox.width <= 24, `arrows are ${backBox.width} and ${forwardBox.width} wide`);
    assert.ok(titleBox.x > forwardBox.x, 'MODULES: sits to the right of the arrows');
    console.log(`  ok    arrows ${Math.round(backBox.width)} and ${Math.round(forwardBox.width)} px wide, MODULES: to their right`);

    await nav.getByRole('button', { name: 'MODULES', exact: true }).click();
    const list = page.getByRole('dialog', { name: 'MODULES' }).or(page.getByLabel('MODULES', { exact: true }).filter({ hasText: 'CREATIVE' })).first();
    await list.waitFor({ state: 'visible', timeout: 5000 });
    const creative = list.locator('section', { hasText: 'CREATIVE' });
    assert.deepEqual(
      (await creative.getByRole('checkbox').all()).length,
      3,
      'CREATIVE holds three modules',
    );
    const tick = (name) => list.getByRole('checkbox', { name: new RegExp(name) });
    assert.equal(await tick('STREAM').getAttribute('aria-checked'), 'true', 'STREAM starts ticked');
    assert.equal(await tick('BEATBOX').getAttribute('aria-checked'), 'false', 'BEATBOX starts unticked');
    assert.equal(await tick('ANIMATE').getAttribute('aria-checked'), 'false', 'ANIMATE starts unticked');
    assert.ok(await tick('MODULES').isDisabled(), 'MODULES cannot be unticked');
    console.log('  ok    list: CREATIVE holds BEATBOX, STREAM (ticked), ANIMATE; MODULES can\'t be unticked');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/modules-list.png` });

    await tick('BEATBOX').click();
    await tick('MEDIA').click();
    assert.deepEqual(await keys(), ['PROJECTS', 'FORUM', 'DISCOVER', 'BEATBOX', 'STREAM', 'MODULES'], 'ticking moves the bar at once');
    console.log('  ok    ticking BEATBOX on and MEDIA off changes the bar at once');

    // A hover colour: the word turns it on the bar, with no fill.
    const forumGroup = list.getByRole('group', { name: 'PROJECTS hover colour' });
    const first = forumGroup.locator('button[style]').first();
    const wanted = await first.evaluate((button) => getComputedStyle(button).backgroundColor);
    await first.click();
    const coloured = nav.getByRole('link', { name: 'PROJECTS' });
    const other = nav.getByRole('link', { name: 'STREAM' });
    await page.mouse.move(0, 0);
    await other.hover();
    await page.waitForTimeout(250);
    const plain = await other.evaluate((link) => getComputedStyle(link).color);
    await coloured.hover();
    await page.waitForTimeout(250);
    const hovered = await coloured.evaluate((link) => getComputedStyle(link).color);
    assert.equal(hovered, wanted, 'on hover the word wears the picked colour');
    assert.notEqual(hovered, plain, 'a module with no colour keeps the site hover');
    console.log(`  ok    PROJECTS turns ${hovered} on hover`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/modules-hover.png` });

    // It survives a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await nav.waitFor({ state: 'visible' });
    await page.waitForTimeout(800);
    assert.deepEqual(await keys(), ['PROJECTS', 'FORUM', 'DISCOVER', 'BEATBOX', 'STREAM', 'MODULES'], 'choices survive a reload');
    console.log('  ok    choices survive a reload');

    // An unticked module's address still works.
    await page.goto(`${BASE}/animate`, { waitUntil: 'domcontentloaded' });
    assert.ok(await page.title(), 'the page opens');
    console.log('  ok    an unticked module\'s address still opens');

    console.log('PASS check-modules');
  } finally {
    await browser.close();
    if (server !== null) server.kill();
  }
})().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
