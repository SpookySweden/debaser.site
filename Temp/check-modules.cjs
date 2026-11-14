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
    // Signed-out pages open the lost-account window (LostAccountWindow.tsx), which this check is not about.
    await context.addInitScript(() => window.localStorage.setItem('debaser.lost-account.never.v1', '1'));
    const page = await context.newPage();
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await nav.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(800);

    const keys = async () => (await nav.locator('a, button:not([aria-label])').allInnerTexts()).map((text) => text.trim().replace(/\s+/g, ' '));
    // (2026-11-13) DOCS is on for everyone from a first visit (Luke: "on for everyone", SPEC-live-docs.md).
    // (2026-11-13) READ, the reader's module, is on for everyone too (Luke: 'a new module for reading').
    // (2026-11-14) A first visit's bar is FORUM, MEDIA and STREAM only (Luke); PROJECTS, READ and DOCS start off.
    assert.deepEqual(await keys(), ['FORUM', 'MEDIA', 'STREAM', 'MODULOS'], 'the keys a first visit shows');
    console.log('  ok    first visit: FORUM MEDIA STREAM MODULOS, no PROJECTS, READ, DOCS, DISCOVER, BEATBOX or ANIMATE');

    // MODULOS is a solid block: neither a bare word nor the dark block of the page you're on, and its word reads.
    const modulosKey = nav.getByRole('button', { name: 'MODULOS', exact: true });
    const face = (key) => key.evaluate((node) => { const style = getComputedStyle(node); return { fill: style.backgroundColor, ink: style.color }; });
    const channels = (colour) => colour.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = (colour) => { const [r, g, b] = channels(colour).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    await page.mouse.move(0, 0);
    const modulosFace = await face(modulosKey);
    const standing = await face(nav.getByRole('link', { name: 'FORUM' }));
    const bare = await face(nav.getByRole('link', { name: 'MEDIA' }));
    assert.equal(bare.fill, 'rgba(0, 0, 0, 0)', 'the other keys are bare words');
    assert.notEqual(modulosFace.fill, 'rgba(0, 0, 0, 0)', 'MODULOS is filled');
    assert.notEqual(modulosFace.fill, standing.fill, 'MODULOS does not look like the page you are on');
    assert.ok(ratio(modulosFace.ink, modulosFace.fill) >= 4.5, `MODULOS reads at ${ratio(modulosFace.ink, modulosFace.fill)}`);
    const [lastLink, modulosBox] = await Promise.all([nav.getByRole('link', { name: 'STREAM' }).boundingBox(), modulosKey.boundingBox()]);
    console.log(`  ok    MODULOS is a solid ${modulosFace.fill} block, ${ratio(modulosFace.ink, modulosFace.fill).toFixed(1)}:1, ${Math.round(modulosBox.x - lastLink.x - lastLink.width)} px from STREAM`);

    const title = nav.getByText('MODULES:', { exact: true });
    const back = nav.getByRole('button', { name: 'Back' });
    const forward = nav.getByRole('button', { name: 'Forward' });
    const [backBox, forwardBox, titleBox] = await Promise.all([back.boundingBox(), forward.boundingBox(), title.boundingBox()]);
    assert.ok(backBox.width <= 24 && forwardBox.width <= 24, `arrows are ${backBox.width} and ${forwardBox.width} wide`);
    assert.ok(titleBox.x > forwardBox.x, 'MODULES: sits to the right of the arrows');
    console.log(`  ok    arrows ${Math.round(backBox.width)} and ${Math.round(forwardBox.width)} px wide, MODULES: to their right`);

    await modulosKey.click();
    const list = page.getByRole('dialog', { name: 'MODULOS' }).or(page.getByLabel('MODULOS', { exact: true }).filter({ hasText: 'CREATIVE' })).first();
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
    assert.equal(await tick('DISCOVER').getAttribute('aria-checked'), 'false', 'DISCOVER starts unticked');
    for (const name of ['DISCOVER', 'BEATBOX', 'ANIMATE']) assert.match(await tick(name).innerText(), /WIP/, `${name} is tagged WIP in the list`);
    assert.equal(await tick('DOCS').getAttribute('aria-checked'), 'false', 'DOCS starts unticked (Luke, 2026-11-14)');
    assert.equal(await tick('READ').getAttribute('aria-checked'), 'false', 'READ starts unticked (Luke, 2026-11-14)');
    assert.equal(await tick('PROJECTS').getAttribute('aria-checked'), 'false', 'PROJECTS starts unticked (Luke, 2026-11-14)');
    for (const name of ['PROJECTS', 'FORUM', 'MEDIA', 'READ', 'DOCS', 'STREAM', 'MODULOS']) assert.doesNotMatch(await tick(name).innerText(), /WIP/, `${name} is not tagged WIP`);
    assert.ok(await tick('MODULOS').isDisabled(), 'MODULOS cannot be unticked');
    console.log('  ok    list: CREATIVE holds BEATBOX, STREAM (ticked), ANIMATE; DISCOVER, BEATBOX and ANIMATE tagged WIP; MODULOS can\'t be unticked');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/modules-list.png` });

    await tick('BEATBOX').click();
    await tick('MEDIA').click();
    assert.deepEqual(await keys(), ['FORUM', 'BEATBOX WIP', 'STREAM', 'MODULOS'], 'ticking moves the bar at once, and BEATBOX wears its tag');
    console.log('  ok    ticking BEATBOX on and MEDIA off changes the bar at once');

    // A hover colour: the word turns it on the bar, with no fill.
    const forumGroup = list.getByRole('group', { name: 'FORUM hover colour' });
    const first = forumGroup.locator('button[style]').first();
    const wanted = await first.evaluate((button) => getComputedStyle(button).backgroundColor);
    await first.click();
    const coloured = nav.getByRole('link', { name: 'FORUM' });
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
    console.log(`  ok    FORUM turns ${hovered} on hover`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/modules-hover.png` });

    // MODULOS keeps its hover colour too: it steps back to an outline, and the word turns the colour against the bar.
    const modulosGroup = list.getByRole('group', { name: 'MODULOS hover colour' });
    const modulosSwatch = modulosGroup.locator('button[style]').first();
    const modulosWanted = await modulosSwatch.evaluate((button) => getComputedStyle(button).backgroundColor);
    await modulosSwatch.click();
    await modulosKey.click();
    await list.waitFor({ state: 'hidden', timeout: 5000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    assert.notEqual((await face(modulosKey)).fill, 'rgba(0, 0, 0, 0)', 'with a colour picked, MODULOS is still solid at rest');
    await modulosKey.hover();
    await page.waitForTimeout(250);
    const modulosHovered = await face(modulosKey);
    assert.equal(modulosHovered.ink, modulosWanted, 'on hover MODULOS wears the picked colour');
    assert.equal(modulosHovered.fill, 'rgba(0, 0, 0, 0)', 'and steps back from its fill, so the colour reads against the bar');
    console.log(`  ok    MODULOS turns ${modulosHovered.ink} on hover`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/modules-modulos-hover.png` });

    // It survives a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await nav.waitFor({ state: 'visible' });
    await page.waitForTimeout(800);
    assert.deepEqual(await keys(), ['FORUM', 'BEATBOX WIP', 'STREAM', 'MODULOS'], 'choices survive a reload');
    console.log('  ok    choices survive a reload');

    // An unticked module's address still works.
    await page.goto(`${BASE}/animate`, { waitUntil: 'domcontentloaded' });
    assert.ok(await page.title(), 'the page opens');
    assert.equal((await page.goto(`${BASE}/discover`, { waitUntil: 'domcontentloaded' })).status(), 200, 'DISCOVER, unticked, still opens');
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
