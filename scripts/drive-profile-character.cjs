/*
 * Characters on profiles (SPEC-profile-characters.md), in a real browser. Not in `npm run checks` (it signs in and writes).
 *
 *   node scripts/drive-profile-character.cjs --base http://localhost:3017      (dev: includes the pixel-for-pixel proof)
 *   node scripts/drive-profile-character.cjs --base https://debaser-site.vercel.app
 *
 *   1. THE PROOF (dev only, where the workbench lends the bake to the page): GUY on the bench, the skeleton off; the bench's
 *      figure baked into exactly the low-res grid the FRONT view is drawing, compared with the FRONT view on screen, block
 *      by block. Every baked pixel must be the screen's colour exactly, and the screen must show no figure pixel the bake
 *      lacks. Writes Temp/browse/profile-character-proof.png: the screen on the left, the bake on the right.
 *   2. As TEST ACCOUNT A: saves the bench as PROFILE DRIVE (once), shows it ON YOUR PROFILE, mood BUSY.
 *   3. As TEST ACCOUNT B, on A's profile: for 30 seconds, the character's box never crosses text, a picture, a key or a field,
 *      and it walks; clicked, it waves; with A's track playing, it dances.
 *   4. Reduced motion: it stands still in its idle frame. A phone: shown only with room, and measured if shown.
 *   5. The database, as B: none of A's saved characters can be read (not even the shown one's figure); A's shown row can be
 *      read but not changed; nothing can be put in A's picture folder.
 *
 * Leaves A's PROFILE DRIVE character saved and shown on A's profile (a kept test account).
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, installSession, signInTestAccount, testAccountClient } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3017');
const DEV = /localhost|127\.0\.0\.1/.test(BASE);
const SHOTS = join('Temp', 'browse');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const NAME = 'PROFILE DRIVE';

async function signedIn(browser, account, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
  await installSession(page, account);
  return page;
}

async function clearPrivacyWindow(page) {
  const close = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if ((await close.count()) > 0) await close.first().click();
}

/** In the page: the character's box, and every box of text, picture, key and field on the page area it lives in. */
function measureInPage() {
  const button = document.querySelector('[data-profile-character]');
  if (button === null) return null;
  const layer = button.parentElement;
  const root = layer.parentElement;
  const SOLID = 'img, svg, canvas, video, iframe, audio, picture, input, textarea, select, button, a, label, [role="button"], [tabindex]';
  const boxes = [];
  const push = (rect) => {
    if (rect.width > 0 && rect.height > 0) boxes.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  };
  for (const el of root.querySelectorAll(SOLID)) if (!layer.contains(el)) push(el.getBoundingClientRect());
  for (const el of root.querySelectorAll('[style*="background-image"]')) if (!layer.contains(el)) push(el.getBoundingClientRect());
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || layer.contains(node)) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) push(rect);
  }
  const r = button.getBoundingClientRect();
  const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  const hits = boxes.filter((o) => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top);
  return { box, motion: button.getAttribute('data-motion'), hits: hits.length, obstacles: boxes.length };
}

async function proof(page) {
  await page.waitForFunction(() => window.__characterBakeProof !== undefined, null, { timeout: 60000 });
  await page.evaluate(() => {
    window.__characterBakeProof.applyPreset('guy');
    window.__characterBakeProof.hideSkeleton();
  });
  await sleep(1500);
  const front = page.locator('section[aria-label="FRONT view"] canvas').first();
  const shot = (await front.screenshot()).toString('base64');
  const result = await page.evaluate(async (b64) => {
    const hook = window.__characterBakeProof;
    const canvas = document.querySelector('section[aria-label="FRONT view"] canvas');
    const ratio = window.devicePixelRatio;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const zoom = hook.fitZoom(cssW, cssH);
    const grid = hook.pixelGrid(canvas.width, canvas.height, zoom, ratio, true, false);
    const rel = hook.lowResFrustum({ left: -cssW / 2, bottom: -cssH / 2, zoom }, grid, ratio);
    // The FRONT camera sits at x 0, y FIGURE_CENTRE_Y.
    const frame = { left: rel.left, right: rel.right, bottom: rel.bottom + hook.centreY, top: rel.top + hook.centreY };
    const baked = hook.bakeStill(hook.figure(), frame, grid.width, grid.height);

    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const read = document.createElement('canvas');
    read.width = img.width;
    read.height = img.height;
    const ctx = read.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const screen = ctx.getImageData(0, 0, img.width, img.height).data;
    const scale = img.width / canvas.width;

    const colours = new Set();
    for (let k = 0; k < baked.length; k += 4) if (baked[k + 3] === 255) colours.add(`${baked[k]},${baked[k + 1]},${baked[k + 2]}`);
    let figure = 0;
    let mismatched = 0;
    let extra = 0;
    let firstMiss = null;
    let minI = Infinity, maxI = -1, minJ = Infinity, maxJ = -1;
    for (let j = 0; j < grid.height; j += 1) {
      for (let i = 0; i < grid.width; i += 1) {
        const dx = Math.floor((i + 0.5) * grid.block * scale);
        const dyFromTop = Math.floor((canvas.height - (j + 0.5) * grid.block) * scale);
        if (dx >= img.width || dyFromTop < 0 || dyFromTop >= img.height) continue;
        const s = (dyFromTop * img.width + dx) * 4;
        const b = ((grid.height - 1 - j) * grid.width + i) * 4;
        const on = `${screen[s]},${screen[s + 1]},${screen[s + 2]}`;
        if (baked[b + 3] === 255) {
          figure += 1;
          minI = Math.min(minI, i); maxI = Math.max(maxI, i); minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
          if (on !== `${baked[b]},${baked[b + 1]},${baked[b + 2]}`) {
            mismatched += 1;
            firstMiss ??= { i, j, screen: on, baked: `${baked[b]},${baked[b + 1]},${baked[b + 2]}` };
          }
          // The bench's grid lines are MODEL_GRID, which is also the ROYAL BLUE dye (GUY's legs): a grid line behind the
          // figure is not a figure block the bake lacks.
        } else if (colours.has(on) && on !== '29,60,166') extra += 1;
      }
    }

    // Side by side, 8 screen pixels a block: the screen's blocks on the left, the bake on the right.
    const pad = 2;
    const w = maxI - minI + 1 + pad * 2;
    const h = maxJ - minJ + 1 + pad * 2;
    const S = 8;
    const out = document.createElement('canvas');
    out.width = (w * 2 + 2) * S;
    out.height = h * S;
    const o = out.getContext('2d');
    o.fillStyle = '#000';
    o.fillRect(0, 0, out.width, out.height);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = minI - pad + x;
        const j = maxJ + pad - y;
        if (i < 0 || j < 0 || i >= grid.width || j >= grid.height) continue;
        const dx = Math.floor((i + 0.5) * grid.block * scale);
        const dyFromTop = Math.floor((canvas.height - (j + 0.5) * grid.block) * scale);
        if (dx < img.width && dyFromTop >= 0 && dyFromTop < img.height) {
          const s = (dyFromTop * img.width + dx) * 4;
          o.fillStyle = `rgb(${screen[s]},${screen[s + 1]},${screen[s + 2]})`;
          o.fillRect(x * S, y * S, S, S);
        }
        const b = ((grid.height - 1 - j) * grid.width + i) * 4;
        if (baked[b + 3] === 255) {
          o.fillStyle = `rgb(${baked[b]},${baked[b + 1]},${baked[b + 2]})`;
          o.fillRect((w + 2 + x) * S, y * S, S, S);
        }
      }
    }
    return { grid, figure, mismatched, extra, firstMiss, colours: colours.size, picture: out.toDataURL('image/png') };
  }, shot);
  writeFileSync(join(SHOTS, 'profile-character-proof.png'), Buffer.from(result.picture.split(',')[1], 'base64'));
  console.log(`  proof: block ${result.grid.block}px, ${result.figure} figure blocks in ${result.colours} colours, ${result.mismatched} differ, ${result.extra} extra`);
  if (result.firstMiss) console.log(`  first difference: ${JSON.stringify(result.firstMiss)}`);
  assert.ok(result.figure > 150, 'the figure fills the grid');
  assert.equal(result.mismatched, 0, 'every baked block is the screen colour exactly');
  assert.equal(result.extra, 0, 'the screen shows no figure block the bake lacks');
  pass('a baked frame is the workbench FRONT render, block for block (Temp/browse/profile-character-proof.png)');
}

async function showAsA(page) {
  // Save the bench once, as PROFILE DRIVE.
  await page.getByRole('button', { name: '[ SAVED CHARACTERS ]' }).click();
  const shelf = page.getByRole('dialog').filter({ hasText: 'SAVE FIGURE' });
  await shelf.waitFor();
  if ((await shelf.getByText(NAME, { exact: true }).count()) === 0) {
    await shelf.locator('#character-save-name').fill(NAME);
    await shelf.getByRole('button', { name: '[ SAVE ]' }).click();
    await shelf.getByText(NAME, { exact: true }).first().waitFor();
  }
  await shelf.getByRole('button', { name: 'Close window' }).click();

  const pick = page.locator('#profile-character-pick');
  const value = await pick.evaluate((select, name) => [...select.options].find((o) => o.textContent.startsWith(name))?.value ?? '', NAME);
  assert.ok(value.length > 0, 'PROFILE DRIVE is on the list');
  const started = Date.now();
  await pick.selectOption(value);
  await page
    .getByRole('status')
    .filter({ hasText: 'ON YOUR PROFILE.' })
    .waitFor({ timeout: 90000 })
    .catch(async (error) => {
      const said = await page.locator('#profile-character-pick').locator('xpath=ancestor::div[1]').innerText();
      throw new Error(`the row says: ${said.replace(/\s+/g, ' ')} (${error.message.split('\n')[0]})`);
    });
  console.log(`  baked and saved in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  await page.getByRole('button', { name: '[ BUSY ]' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Mood"] [aria-pressed="true"]')?.textContent.includes('BUSY'));
  await page.getByRole('status').filter({ hasText: 'ON YOUR PROFILE.' }).waitFor({ timeout: 30000 });
  pass('A shows PROFILE DRIVE on the profile, mood BUSY');
}

async function visitAsB(page, profileUrl) {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
  await clearPrivacyWindow(page);
  await page.waitForSelector('[data-profile-character]', { timeout: 60000 });
  await sleep(1000);
  await page.screenshot({ path: join(SHOTS, 'profile-character-desktop.png'), fullPage: true });

  const lefts = new Set();
  const motions = new Set();
  let samples = 0;
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const seen = await page.evaluate(measureInPage);
    assert.ok(seen !== null, 'still there');
    assert.equal(seen.hits, 0, `its box ${JSON.stringify(seen.box)} crosses ${seen.hits} thing(s) on the page`);
    lefts.add(Math.round(seen.box.left));
    motions.add(seen.motion);
    samples += 1;
    await sleep(150);
  }
  console.log(`  ${samples} looks over 30 s; ${lefts.size} places; motions ${[...motions].join(', ')}`);
  assert.ok(lefts.size > 5 && motions.has('walk'), 'it walked');
  pass('for 30 s its box crossed no text, picture, key or field, and it walked');

  await page.locator('[data-profile-character]').click();
  await page.waitForFunction(() => document.querySelector('[data-profile-character]')?.getAttribute('data-motion') === 'wave', null, { timeout: 2000 });
  await sleep(300);
  await page.screenshot({ path: join(SHOTS, 'profile-character-wave.png') });
  pass('clicked, it waves');

  const play = page.getByRole('button', { name: '[ ▶ PLAY ]' }).first();
  if ((await play.count()) === 0) {
    console.log('  SKIPPED: A has no track on the profile, so dancing to it could not be driven');
    return;
  }
  await sleep(2000);
  await play.click();
  await page.waitForFunction(
    () => /^dance[123]$/.test(document.querySelector('[data-profile-character]')?.getAttribute('data-motion') ?? ''),
    null,
    { timeout: 15000 },
  );
  const dancing = [];
  for (let i = 0; i < 12; i += 1) {
    dancing.push(await page.evaluate(() => document.querySelector('[data-profile-character]').getAttribute('data-motion')));
    await sleep(250);
  }
  await page.screenshot({ path: join(SHOTS, 'profile-character-dance.png') });
  assert.ok(dancing.every((m) => /^dance[123]$/.test(m)), `dancing throughout: ${dancing.join(',')}`);
  const pause = page.getByRole('button', { name: '[ ❚❚ PAUSE ]' }).first();
  if ((await pause.count()) > 0) await pause.click();
  pass('with the track playing, it dances');
}

async function reducedMotion(browser, account, profileUrl) {
  const page = await signedIn(browser, account, { reducedMotion: 'reduce' });
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
  await clearPrivacyWindow(page);
  await page.waitForSelector('[data-profile-character]', { timeout: 60000 });
  const first = await page.evaluate(measureInPage);
  await sleep(3000);
  const later = await page.evaluate(measureInPage);
  assert.equal(first.motion, 'idle');
  assert.equal(later.motion, 'idle');
  assert.equal(later.box.left, first.box.left, 'it has not moved');
  await page.screenshot({ path: join(SHOTS, 'profile-character-reduced.png') });
  pass('reduced motion: it stands still in its idle frame');
  await page.context().close();
}

async function phone(browser, account, profileUrl) {
  const page = await signedIn(browser, account, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
  await clearPrivacyWindow(page);
  await sleep(8000);
  const seen = await page.evaluate(measureInPage);
  await page.screenshot({ path: join(SHOTS, 'profile-character-phone.png'), fullPage: true });
  if (seen === null) {
    pass('a phone: not shown (no room measured)');
  } else {
    for (let i = 0; i < 20; i += 1) {
      const now = await page.evaluate(measureInPage);
      assert.equal(now.hits, 0, 'on a phone too, it crosses nothing');
      await sleep(200);
    }
    pass('a phone: shown where there is room, crossing nothing');
  }
  await page.context().close();
}

async function database(aId) {
  const { client } = await testAccountClient('B');
  try {
    const theirs = await client.from('user_characters').select('id, figure').eq('person', aId);
    assert.equal(theirs.error, null);
    assert.equal(theirs.data.length, 0, "B reads none of A's saved characters");
    const shown = await client.from('profile_characters').select('person, character_id, mood, strip, sheet').eq('person', aId);
    assert.equal(shown.data?.length, 1, "B reads A's shown row");
    assert.ok(!('figure' in shown.data[0]), 'which holds no figure');
    const figureColumn = await client.from('profile_characters').select('figure').eq('person', aId);
    assert.ok(figureColumn.error !== null, 'and has no figure to ask for');
    const changed = await client.from('profile_characters').update({ mood: 'party' }).eq('person', aId).select('person');
    assert.equal(changed.data?.length ?? 0, 0, "B can't change A's row");
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const put = await client.storage.from('profile-characters').upload(`${aId}/b-was-here.png`, png, { contentType: 'image/png' });
    assert.ok(put.error !== null, "B can't put a picture in A's folder");
    pass("the database: B can't read A's characters, change A's row, or write to A's folder");
  } finally {
    await client.auth.signOut({ scope: 'local' });
  }
}

(async () => {
  const a = await signInTestAccount('A');
  const b = await signInTestAccount('B');
  if (a.error || b.error) throw new Error(`sign-in: ${a.error ?? b.error}`);
  const profileUrl = `${BASE}/profile/${encodeURIComponent(a.userId)}`;
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    console.log(`profile characters, ${BASE}`);
    const pageA = await signedIn(browser, a);
    await pageA.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await clearPrivacyWindow(pageA);
    await pageA.getByRole('button', { name: '[ EDIT PROFILE ]' }).first().click();
    await pageA.getByRole('button', { name: '[ CHAR 🐰 ]' }).click();
    await pageA.locator('section[aria-label="FRONT view"] canvas').first().waitFor({ timeout: 60000 });
    if (DEV) await proof(pageA);
    else console.log('  (the pixel proof runs against the dev server, where the workbench lends the bake to the page)');
    await showAsA(pageA);
    await pageA.context().close();

    const pageB = await signedIn(browser, b);
    await visitAsB(pageB, profileUrl);
    await pageB.context().close();
    await reducedMotion(browser, b, profileUrl);
    await phone(browser, b, profileUrl);
    await database(a.userId);
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} passed`);
})().catch((error) => {
  console.error(`FAILED: ${error.stack ?? error}`);
  process.exit(1);
});
