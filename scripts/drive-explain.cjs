/*
 * EXPLAIN (Luke, 2026-11-27: "for mysake make it so that hovering over any buttons gives a detailed explaination of the function and
 * purpose"): the explanation box, driven on a LOCAL mock dev server only (`node scripts/dev-mock-live.cjs <port>`: every switch on
 * mock, mock sign-in, Supabase address empty). Live hosts are blocked and counted.
 *
 * Off by default (nothing shows); turned on from the profile cog's PREFERENCES and saved to the (mock) account; the pause before it
 * opens; it never covers the key and stays inside the screen; it follows the pointer from key to key at once; the key's grey browser
 * tip is held back and put back; a press puts it away and it stays away; keyboard focus opens it at once and Esc puts it away; it is
 * read by screen readers (`aria-describedby`); its words read 4.5:1 on the dark and the bright theme; off again, nothing shows.
 *
 *   node scripts/drive-explain.cjs --base http://localhost:<port> [--out Temp/browse/explain]
 */
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3341');
const OUT = opt('--out', join('Temp', 'browse', 'explain'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;
const check = (ok, what, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` :: ${detail}` : ''}`);
};

const ME = { id: 'explain-me', name: 'EXPLAINREADER' };

function seed({ me }) {
  if (window.localStorage.getItem('ex-seeded') !== null) return;
  window.localStorage.setItem('ex-seeded', '1');
  const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser.tour.v2', 'skipped');
  const user = { id: me.id, email: `${me.id}@debaser.site`, displayName: me.name, createdAt: at(1000), salt: '', secretHash: '', hidden: true };
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user], sessionUserId: me.id, bannedIds: [] }));
  const profile = { userId: me.id, displayName: me.name, bio: '', tags: [], comments: [], updatedAt: at(1), privacySeen: true };
  window.localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: { [me.id]: profile } }));
}

const box = (page) => page.locator('[data-explain-box]');
const boxText = async (page) => ((await box(page).count()) === 0 ? null : (await box(page).innerText()).replace(/\s+/g, ' ').trim());
const rect = (locator) => locator.evaluate((element) => element.getBoundingClientRect().toJSON());
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** The box's words against its own background, and the caution strip's, as contrast ratios. */
async function boxContrast(page) {
  return box(page).evaluate((element) => {
    const parse = (colour) => {
      const probe = document.createElement('canvas').getContext('2d');
      probe.fillStyle = colour;
      probe.fillRect(0, 0, 1, 1);
      return [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(parse(a)), lum(parse(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const style = getComputedStyle(element);
    const note = element.querySelector('p.bg-bubble-pale');
    const noteStyle = note === null ? null : getComputedStyle(note);
    return {
      words: ratio(style.color, style.backgroundColor),
      note: noteStyle === null ? null : ratio(noteStyle.color, noteStyle.backgroundColor),
      size: parseFloat(style.fontSize),
    };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let live = 0;
  await context.route(/supabase\.(co|in)\/|debaser-site\.vercel\.app|api\.debaser\.site|debaser\.site\//, (route) => {
    live += 1;
    return route.abort();
  });
  await context.addInitScript(seed, { me: ME });
  const page = await context.newPage();
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  const media = page.locator('nav[aria-label="Modules"] a', { hasText: 'MEDIA' }).first();
  await media.waitFor({ timeout: 240000 });
  await sleep(3000);

  console.log('OFF BY DEFAULT');
  check((await page.evaluate(() => window.localStorage.getItem('debaser.site.explain.v1'))) === null, 'nothing stored: the switch starts off');
  await media.hover();
  await sleep(900);
  check((await box(page).count()) === 0, 'off: resting on MEDIA shows no box');
  check((await page.locator('[data-search-key]').getAttribute('title')) !== null, "off: SEARCH keeps its own grey tip");

  console.log('TURNED ON FROM PREFERENCES');
  await page.locator('[aria-label="Profile settings"]').click();
  await page.locator('button', { hasText: 'PREFERENCES' }).first().click();
  const toggle = page.locator('[data-explain-switch]');
  await toggle.waitFor({ timeout: 15000 });
  check((await toggle.getAttribute('aria-pressed')) === 'false', '[ EXPLAIN ] shows off');
  await toggle.click();
  await sleep(1800);
  check((await toggle.getAttribute('aria-pressed')) === 'true', '[ EXPLAIN ] pressed in after a press');
  check((await page.evaluate(() => window.localStorage.getItem('debaser.site.explain.v1'))) === '1', 'saved in this browser as on');
  const row = await page.evaluate((id) => JSON.parse(window.localStorage.getItem('debaser.user-settings.mock.v1') ?? '{}')[id]?.settings?.keys?.explain ?? null, ME.id);
  check(row === '1', 'saved to the account (the mock settings row)', String(row));
  await page.locator(`[data-dock-window="preferences"] button[aria-label="Close PREFERENCES"]`).click();
  await page.mouse.move(700, 600);
  await sleep(400);

  console.log('HOVER');
  await media.hover();
  await sleep(150);
  check((await box(page).count()) === 0, 'not at once: passing over a key opens nothing');
  await sleep(700);
  const mediaWords = await boxText(page);
  check(mediaWords !== null && mediaWords.includes('Goes to MEDIA'), 'resting on MEDIA opens its explanation', mediaWords ?? 'none');
  const mediaKey = await rect(media);
  const mediaBox = await rect(box(page));
  check(!overlaps(mediaKey, mediaBox), 'the box does not cover the key', `${JSON.stringify(mediaBox)}`);
  check(mediaBox.left >= 0 && mediaBox.right <= 1440 && mediaBox.top >= 0 && mediaBox.bottom <= 900, 'the box is inside the screen');
  check((await media.getAttribute('aria-describedby')) === 'explain-box', 'the key names the box for screen readers');
  const look = await boxContrast(page);
  check(look.words >= 4.5, 'its words read 4.5:1 on the dark theme', look.words.toFixed(2));
  check(look.size >= 13, 'its words are 13px or bigger', `${look.size}px`);
  await page.screenshot({ path: join(OUT, 'dark-media.png') });

  console.log('FOLLOWS, AND HOLDS BACK THE GREY TIP');
  const search = page.locator('[data-search-key]');
  await search.hover();
  await sleep(80);
  const searchWords = await boxText(page);
  check(searchWords !== null && searchWords.includes('SEARCH window'), 'moving to SEARCH changes the box at once', searchWords ?? 'none');
  check((await search.getAttribute('title')) === null, "SEARCH's grey tip is held back while the box is about it");
  check((await media.getAttribute('aria-describedby')) === null, 'MEDIA no longer names the box');
  await page.mouse.move(700, 600);
  await sleep(200);
  check((await box(page).count()) === 0, 'moving off the keys puts the box away');
  check((await search.getAttribute('title')) === 'Search the whole site (Ctrl+K)', "SEARCH's grey tip is back");

  console.log('A PRESS');
  const modulos = page.locator('[data-tour="modulos"]');
  await modulos.hover();
  await sleep(800);
  check((await boxText(page))?.includes('MODULOS') === true, 'MODULOS explains itself');
  await modulos.click();
  await sleep(150);
  check((await box(page).count()) === 0, 'a press puts the box away');
  await sleep(900);
  check((await box(page).count()) === 0, 'and it stays away while the pointer stays on the pressed key');
  const tick = page.locator('[data-dock-window="modules"] button[role="checkbox"]', { hasText: 'PROJECTS' }).first();
  await tick.hover();
  await sleep(800);
  const tickWords = await boxText(page);
  check(tickWords !== null && tickWords.includes('PROJECTS key on the top bar'), 'a tick in MODULOS explains itself', tickWords ?? 'none');
  const close = page.locator('[data-dock-window="modules"] button[aria-label="Close MODULOS"]');
  await close.hover();
  await sleep(100);
  check((await boxText(page))?.includes('Closes the MODULOS window') === true, "the window's × explains itself");
  await close.click();

  console.log('KEYBOARD');
  await page.mouse.move(700, 600);
  await page.locator('body').click({ position: { x: 700, y: 600 } }).catch(() => undefined);
  let reached = null;
  for (let step = 0; step < 40 && reached === null; step += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => {
      const active = document.activeElement;
      return active !== null && active.closest('nav[aria-label="Modules"]') !== null && active.hasAttribute('data-explain') ? active.textContent : null;
    });
  }
  check(reached !== null, 'Tab reaches a top-bar key', reached ?? 'none');
  const tabbed = await boxText(page);
  check(tabbed !== null, 'reaching a key with Tab opens its box at once', tabbed ?? 'none');
  await page.keyboard.press('Escape');
  await sleep(100);
  check((await box(page).count()) === 0, 'Esc puts it away');

  console.log('THE FAR RIGHT AND A DISABLED KEY');
  const fullscreen = page.locator('[data-site-fullscreen-key]');
  if ((await fullscreen.count()) > 0) {
    await fullscreen.hover();
    await sleep(800);
    const far = await rect(box(page));
    check(far.right <= 1440 && far.left >= 0, 'the box for the last key on the bar stays inside the screen', JSON.stringify(far));
    check(!overlaps(await rect(fullscreen), far), 'and does not cover it');
  }
  const undo = page.locator('[data-undo-arrow="undo"]');
  await page.mouse.move(700, 600);
  await sleep(200);
  await undo.hover({ force: true });
  await sleep(800);
  const undoWords = await boxText(page);
  console.log(`  note undo arrow (${(await undo.isDisabled()) ? 'disabled' : 'enabled'}): ${undoWords ?? 'no box'}`);
  check(undoWords !== null, 'the undo arrow explains itself, disabled or not', undoWords ?? 'none');

  // The room area's second half (EXPLAIN-ROOMS, 2026-11-27): the HISTORY window opened from its address, its keys explained.
  console.log('A ROOM-AREA WINDOW: HISTORY');
  await page.goto(`${BASE}/forum?history=1`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  const pause = page.locator('[data-history-log] [data-history-pause]');
  await pause.waitFor({ timeout: 120000 });
  await sleep(1500);
  await pause.hover();
  await sleep(800);
  const pauseWords = await boxText(page);
  check(pauseWords !== null && pauseWords.includes('new lines in your log'), "HISTORY's PAUSE explains itself", pauseWords ?? 'none');
  const music = page.locator('[data-history-log] [data-history-filter="music"]');
  await music.hover();
  await sleep(100);
  const musicWords = await boxText(page);
  check(musicWords !== null && musicWords.includes('only the songs'), 'its MUSIC filter explains itself', musicWords ?? 'none');
  const erase = page.locator('[data-history-log] [data-history-erase]');
  await erase.hover();
  await sleep(100);
  check((await boxText(page))?.includes("CAN'T BE UNDONE") === true, 'its ERASE carries the caution');
  await page.screenshot({ path: join(OUT, 'dark-history.png') });

  // Profile and settings (EXPLAIN-PROFILE, 2026-11-27): the account page, its PRIVACY tab, and the profile editor.
  console.log('PROFILE AND SETTINGS: THE ACCOUNT PAGE AND THE PROFILE EDITOR');
  await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  const signOut = page.locator('button', { hasText: '[ SIGN OUT ]' }).first();
  await signOut.waitFor({ timeout: 120000 });
  await sleep(1500);
  await signOut.hover();
  await sleep(800);
  const signOutWords = await boxText(page);
  check(signOutWords !== null && signOutWords.includes('Signs you out'), 'SIGN OUT explains itself', signOutWords ?? 'none');
  const privacyTab = page.locator('button[role="tab"]', { hasText: 'PRIVACY' }).first();
  await page.mouse.move(700, 600);
  await sleep(300);
  await privacyTab.hover();
  await sleep(800);
  const privacyTabWords = await boxText(page);
  check(privacyTabWords !== null && privacyTabWords.includes('PRIVACY switches'), "the account page's PRIVACY tab explains itself", privacyTabWords ?? 'none');
  await privacyTab.click();
  const lamp = page.locator('button[aria-label^="ONLINE LAMP:"]').first();
  await lamp.waitFor({ timeout: 30000 });
  await page.mouse.move(700, 600);
  await sleep(300);
  await lamp.hover();
  await sleep(800);
  const lampWords = await boxText(page);
  check(lampWords !== null && lampWords.includes('ONLINE LAMP switch') && lampWords.includes('Saved the moment'), 'a privacy switch says what it shares', lampWords ?? 'none');
  await page.locator('button[role="tab"]', { hasText: 'ACCOUNT' }).first().click();
  const editProfile = page.locator('button', { hasText: '[ EDIT PROFILE ]' }).first();
  await editProfile.waitFor({ timeout: 30000 });
  await editProfile.click();
  const colour = page.locator('[data-change-colour]');
  await colour.waitFor({ timeout: 60000 });
  await page.mouse.move(700, 600);
  await sleep(300);
  await colour.hover();
  await sleep(800);
  const colourWords = await boxText(page);
  check(colourWords !== null && colourWords.includes('NAME COLOUR window'), "the editor's CHANGE COLOUR explains itself", colourWords ?? 'none');
  const charTab = page.locator('button', { hasText: '[ CHAR' }).first();
  await charTab.hover();
  await sleep(100);
  const charWords = await boxText(page);
  check(charWords !== null && charWords.includes('CHAR tab') && charWords.includes('ASKS YOU FIRST'), "the editor's CHAR tab explains itself, with its caution", charWords ?? 'none');
  await page.screenshot({ path: join(OUT, 'dark-profile-editor.png') });

  // The forum (EXPLAIN-FORUM, 2026-11-27): the board's own row of keys, its FILTER panel, the search box and the new post form.
  console.log('THE FORUM: THE BOARD ROW, FILTER, SEARCH AND A NEW POST');
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await media.waitFor({ timeout: 120000 });
  const boardRow = page.locator('[role="group"][aria-label="Board view"]');
  await boardRow.waitFor({ timeout: 120000 });
  await sleep(1500);
  const sayOf = async (locator) => {
    await page.mouse.move(700, 900);
    await sleep(300);
    await locator.hover();
    await sleep(800);
    return boxText(page);
  };
  const galleryWords = await sayOf(boardRow.locator('button', { hasText: 'GALLERY' }));
  check(galleryWords !== null && galleryWords.includes('carry a picture'), "the board's GALLERY tab explains itself", galleryWords ?? 'none');
  const filterKey = page.locator('button[aria-controls="board-tags-panel"]');
  const filterWords = await sayOf(filterKey);
  check(filterWords !== null && filterWords.includes('where posts come from'), 'FILTER explains itself', filterWords ?? 'none');
  await filterKey.click();
  const tagIndex = page.locator('#board-tags-panel button', { hasText: 'TAG INDEX' });
  await tagIndex.waitFor({ timeout: 15000 });
  const tagIndexWords = await sayOf(tagIndex);
  check(tagIndexWords !== null && tagIndexWords.includes('whole tag index'), "the FILTER panel's TAG INDEX explains itself", tagIndexWords ?? 'none');
  await filterKey.click();
  const sortWords = await sayOf(page.locator('button[aria-controls="board-controls-panel"]'));
  check(sortWords !== null && sortWords.includes('time frame'), 'SORT explains itself', sortWords ?? 'none');
  const boardSearchWords = await sayOf(page.locator('input[aria-label="Search the board"]'));
  check(boardSearchWords !== null && boardSearchWords.includes("Searches the board"), "the board search box explains itself", boardSearchWords ?? "none");
  await page.keyboard.press('Escape');
  const newPost = page.locator('[data-main-key]', { hasText: 'NEW POST' });
  const newPostWords = await sayOf(newPost);
  check(newPostWords !== null && newPostWords.includes('writing a new post'), '+ NEW POST explains itself', newPostWords ?? 'none');
  await newPost.click();
  const filePost = page.locator('button[type="submit"]', { hasText: 'FILE POST' });
  await filePost.waitFor({ timeout: 30000 });
  const filePostWords = await sayOf(filePost);
  check(
    filePostWords !== null && filePostWords.includes('Files the post on the board') && filePostWords.includes('OTHER PEOPLE SEE THIS'),
    "the new post form's FILE POST explains itself, with its note",
    filePostWords ?? 'none',
  );
  await page.screenshot({ path: join(OUT, 'dark-forum-new-post.png') });

  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await media.waitFor({ timeout: 120000 });

  console.log('BRIGHT THEME');
  await page.evaluate(() => window.localStorage.setItem('debaser.site.theme.v2', 'default'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await media.waitFor({ timeout: 120000 });
  await sleep(2500);
  const themeNow = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.locator('[data-search-key]').hover();
  await sleep(800);
  const bright = await boxContrast(page);
  check(bright.words >= 4.5, `its words read 4.5:1 on the ${themeNow} theme`, bright.words.toFixed(2));
  await page.screenshot({ path: join(OUT, 'bright-search.png') });

  console.log('A CAUTION, THEN OFF AGAIN FROM PREFERENCES');
  await page.locator('[aria-label="Profile settings"]').click();
  await page.locator('button', { hasText: 'PREFERENCES' }).first().click();
  await toggle.waitFor({ timeout: 15000 });
  const reset = page.locator('[data-dock-window="preferences"] button', { hasText: 'RESET LAYOUT' });
  await reset.scrollIntoViewIfNeeded();
  await sleep(300);
  await reset.hover();
  await sleep(800);
  const caution = await boxContrast(page);
  check(caution.note !== null && caution.note >= 4.5, `RESET LAYOUT's caution strip reads 4.5:1 on the ${themeNow} theme`, String(caution.note?.toFixed(2)));
  check((await boxText(page))?.includes('FORGOTTEN') === true, 'and says what is lost');
  await page.screenshot({ path: join(OUT, 'bright-caution.png') });
  const weekly = page.locator('[data-dock-window="preferences"] [data-notify-switch="weeklyEmail"]');
  await weekly.scrollIntoViewIfNeeded();
  await sleep(300);
  await weekly.hover();
  await sleep(800);
  const weeklyWords = await boxText(page);
  check(weeklyWords !== null && weeklyWords.includes('Sunday evenings'), "PREFERENCES' WEEKLY EMAIL switch explains itself", weeklyWords ?? 'none');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await sleep(1800);
  check((await toggle.getAttribute('aria-pressed')) === 'false', '[ EXPLAIN ] off after a second press');
  const rowOff = await page.evaluate((id) => JSON.parse(window.localStorage.getItem('debaser.user-settings.mock.v1') ?? '{}')[id]?.settings?.keys?.explain ?? null, ME.id);
  check(rowOff === '0', 'saved to the account as off', String(rowOff));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await media.waitFor({ timeout: 120000 });
  await sleep(2500);
  await media.hover();
  await sleep(900);
  check((await box(page).count()) === 0, 'switched off: no box');

  check(live === 0, 'nothing reached the live site', `${live} blocked`);
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
