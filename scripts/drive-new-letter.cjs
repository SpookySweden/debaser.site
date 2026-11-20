/*
 * `[ + NEW LETTER ]` on your own profile opens a window (Luke, 2026-11-15), in a real browser on a LOCAL dev server
 * running on MOCK data. It touches no database: the account and the letter live in that browser's own storage.
 *
 *   npx cross-env NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= next dev -p 3313      (the mock server)
 *   node scripts/drive-new-letter.cjs [--base http://localhost:3313] [--headed]
 *
 *   a. on your own profile LETTERS has one key and no open field; the key says a window is what it opens, and is shut;
 *   b. pressed, the NEW LETTER window opens with the name field ready to type in, and the key says it is open;
 *      with no name the letter cannot be made;
 *   c. ESC puts the window away with nothing made, and the key says it is shut again;
 *   d. a name and Enter make the letter: the window goes, the letter opens in its own window, and it is in the list;
 *   e. on somebody else's profile there is no key at all.
 * Screenshots in Temp/browse/profile/new-letter-*.png.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3313').replace(/\/$/, '');
const SHOTS = join('Temp', 'browse', 'profile');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const ME = { id: 'letter-owner', name: 'LETTER OWNER' };
const OTHER = { id: 'letter-other', name: 'LETTER OTHER' };

function seed({ me, other }) {
  if (!/^localhost$|^127\.0\.0\.1$/.test(window.location.hostname)) return;
  if (window.localStorage.getItem('debaser.auth.mock.v1') !== null) return;
  const user = (person) => ({ id: person.id, email: `${person.id}@debaser.site`, displayName: person.name, createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true });
  (window.localStorage.setItem('debaser.lost-account.never.v1', '1'), window.localStorage.setItem('debaser.tour.v1', 'skipped'));
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user(me), user(other)], sessionUserId: me.id, bannedIds: [] }));
  // Profiles that have already seen the first-visit PRIVACY window, which would otherwise sit over the page.
  const profile = (person) => ({ userId: person.id, displayName: person.name, bio: '', tags: [], comments: [], updatedAt: new Date().toISOString(), privacySeen: true });
  window.localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: { [me.id]: profile(me), [other.id]: profile(other) } }));
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !args.includes('--headed'), args: ['--no-first-run'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(seed, { me: ME, other: OTHER });
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
    await page.goto(`${BASE}/profile/${ME.id}`, { waitUntil: 'domcontentloaded' });
    await page.mouse.move(600, 200);
    const key = page.locator('[data-new-letter-key]');
    await key.waitFor({ timeout: 120000 });
    const section = page.locator('section[aria-labelledby="profile-letters"]');

    /* a. one key, no open field */
    assert.equal(await key.getAttribute('aria-expanded'), 'false', 'the key says its window is shut');
    assert.equal(await key.getAttribute('aria-haspopup'), 'dialog', 'and that a window is what it opens');
    assert.equal(await section.locator('input, form').count(), 0, 'no field stands open in LETTERS');
    assert.equal(await page.getByRole('dialog', { name: 'NEW LETTER' }).count(), 0, 'and no window is open');
    await key.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, 'new-letter-shut.png') });
    pass('LETTERS has one key, [ + NEW LETTER ], shut, and no open field');

    /* b. pressed: the window */
    await key.click();
    const dialog = page.locator('[role="dialog"]').filter({ has: page.locator('[data-new-letter-window]') });
    await dialog.waitFor({ timeout: 10000 });
    assert.equal(await key.getAttribute('aria-expanded'), 'true', 'the key says its window is open');
    const field = dialog.locator('#new-letter-name');
    assert.equal(await field.evaluate((el) => document.activeElement === el), true, 'the name field is ready to type in');
    const make = dialog.getByRole('button', { name: 'MAKE LETTER' });
    assert.equal(await make.isDisabled(), true, 'with no name the letter cannot be made');
    await field.fill('   ');
    assert.equal(await make.isDisabled(), true, 'nor with only spaces');
    await page.screenshot({ path: join(SHOTS, 'new-letter-window.png') });
    pass('one press opens the NEW LETTER window: the name field has the keyboard, and nothing can be made without a name');

    /* c. ESC */
    await field.fill('');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached', timeout: 5000 });
    assert.equal(await key.getAttribute('aria-expanded'), 'false', 'the key says it is shut again');
    const before = await section.locator('ul > li').count();
    pass('ESC puts the window away with nothing made');

    /* d. a name and Enter */
    await key.click();
    await dialog.waitFor({ timeout: 10000 });
    const NAME = 'DRIVE LETTER';
    await dialog.locator('#new-letter-name').fill(NAME);
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached', timeout: 10000 });
    await page.waitForFunction((count) => document.querySelectorAll('section[aria-labelledby="profile-letters"] ul > li').length === count + 1, before, { timeout: 10000 });
    assert.ok((await section.locator('ul > li').filter({ hasText: NAME }).count()) === 1, 'the new letter is in the list, by its name');
    assert.equal(await key.getAttribute('aria-expanded'), 'false', 'and the key is shut');
    // The letter opens in its own window, as it did from the old field.
    await page.waitForFunction((name) => [...document.querySelectorAll('[role="dialog"], [data-dock-window]')].some((el) => (el.textContent ?? '').includes(name)), NAME, { timeout: 10000 });
    await page.screenshot({ path: join(SHOTS, 'new-letter-made.png') });
    pass(`a name and Enter made "${NAME}": the window went, the letter opened in its own window, and it is in the list`);

    /* e. somebody else's profile */
    await page.goto(`${BASE}/profile/${OTHER.id}`, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    assert.equal(await page.locator('[data-new-letter-key]').count(), 0, "no key on somebody else's profile");
    pass("on somebody else's profile there is no key");

    console.log(`${passed} proofs passed`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAILED after ${passed} proofs: ${error.message}`);
  process.exit(1);
});
