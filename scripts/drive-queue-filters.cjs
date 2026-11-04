/**
 * The stream queue search's filters, MEDIA and FILES, driven on a real site (Luke, 2026-11-04).
 *   node scripts/drive-queue-filters.cjs [base]      default: the deployed site
 *
 * Signs in as TEST ACCOUNT A with the kept tool, so it GOES LIVE for real: on the live site it leaves one ended
 * stream, its board thread and one queue row (`supabase/cleanup/watch-test-streams.sql` lists and removes them).
 * Pictures: Temp/browse/queue-filters/. Every request to the search route is read for what it asks.
 */
const path = require('node:path');
const { open, close, capture, signInPage } = require('./browser.cjs');

const BASE = (process.argv[2] ?? 'https://debaser-site.vercel.app').replace(/\/$/, '');
const OUT = path.join('Temp', 'browse', 'queue-filters');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
let passes = 0;
function ok(condition, message, detail = '') {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}${detail ? ` :: ${detail}` : ''}`);
}

async function main() {
  /* --- a visitor ------------------------------------------------------------------------------- */
  const guest = await open({ size: [1280, 800] });
  await guest.page.goto(`${BASE}/archive`, { waitUntil: 'domcontentloaded' });
  await guest.page.getByText('SIGN IN TO USE MEDIA').first().waitFor({ timeout: 20000 });
  ok(new URL(guest.page.url()).pathname === '/media', 'a visitor at /archive lands on /media');
  ok(true, 'and is asked to sign in, in the new words');
  await capture(guest.page, { out: path.join(OUT, 'guest-media-1280.png') });
  await close(guest);

  /* --- signed in ------------------------------------------------------------------------------- */
  const session = await open({ size: [1280, 800] });
  const { page } = session;
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  const account = await signInPage(page);
  if (account.error) throw new Error(`could not sign in: ${account.error}`);
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });

  const asked = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/web/search')) asked.push(new URL(request.url()).searchParams);
  });
  const press = (locator) => locator.evaluate((element) => element.click());

  const settings = page.getByRole('button', { name: 'Profile settings' });
  await settings.waitFor({ timeout: 30000 });
  ok((await settings.innerText()).includes('SETTINGS'), 'the settings key says SETTINGS', (await settings.innerText()).trim());
  await press(settings);
  await page.getByRole('menuitem', { name: /ACCOUNT/ }).first().waitFor({ timeout: 5000 });
  ok(true, 'it opens the settings menu');
  await capture(page, { out: path.join(OUT, 'settings-open-1280.png') });
  await press(settings);

  const nav = page.getByRole('navigation', { name: 'Site pages' });
  const keys = (await nav.getByRole('link').allInnerTexts()).map((word) => word.trim());
  ok(keys.includes('MEDIA') && !keys.includes('ARCHIVE'), 'the header has MEDIA and no ARCHIVE', keys.join(' '));
  ok((await nav.getByRole('link', { name: 'MEDIA' }).getAttribute('href')) === '/media', 'the MEDIA key goes to /media');

  await press(page.locator('button:has-text("START"), a:has-text("START")').first());
  await sleep(600);
  const start = await page.locator('body').innerText();
  ok(/FILES/.test(start) && /MEDIA/.test(start), 'the Start menu has FILES and MEDIA');
  await capture(page, { out: path.join(OUT, 'start-menu-1280.png') });
  await page.keyboard.press('Escape');

  /* --- the queue window ------------------------------------------------------------------------ */
  await press(page.locator('button:has-text("GO LIVE"), a:has-text("GO LIVE")').first());
  const queueKey = page.locator('[data-stream-bar-queue], [data-watch-queue-key]').first();
  await queueKey.waitFor({ state: 'attached', timeout: 30000 });
  await sleep(1500);
  await press(queueKey);
  const bar = page.locator('#stream-queue-search');
  await bar.waitFor({ timeout: 15000 });
  ok((await bar.getAttribute('placeholder')) === 'SEARCH MEDIA OR PASTE A VIDEO LINK', 'the bar says MEDIA');
  const rows = page.locator('[data-queue-filters]');
  const key = (label) => rows.locator(`button[aria-label="${label}"]`);
  const lit = async () => (await rows.locator('button[aria-pressed="true"]').allInnerTexts()).map((word) => word.trim()).join(' ');
  const sources = (await rows.getByRole('group', { name: 'Source' }).getByRole('button').allInnerTexts()).map((word) => word.trim());
  ok(sources.join(' ') === '[ ALL ] [ INTERNET ARCHIVE ] [ PEERTUBE ] [ YOUTUBE ]', 'SOURCE offers what a room can play', sources.join(' '));
  const types = (await rows.getByRole('group', { name: 'Type' }).getByRole('button').allInnerTexts()).map((word) => word.trim());
  ok(types.join(' ') === '[ ALL ] [ BOOKS ] [ VIDEO ] [ MUSIC ]', 'TYPE is the black screen\'s keys', types.join(' '));
  await capture(page, { out: path.join(OUT, 'queue-empty-1280.png') });

  const settled = async () => {
    await sleep(400);
    await page.waitForFunction(() => document.querySelector('[data-watch-results]')?.getAttribute('data-watch-results') !== 'searching', undefined, { timeout: 40000 });
    await sleep(200);
  };
  const lastAsk = () => asked[asked.length - 1];
  const found = async () => page.locator('[data-watch-results] li').count();
  const step = async (message, want, barWant, litWant) => {
    await settled();
    const params = lastAsk();
    const wrong = Object.entries(want).filter(([name, value]) => params?.get(name) !== value);
    ok(wrong.length === 0, `${message}: asks the right thing`, wrong.map(([name, value]) => `${name}=${params?.get(name)} (want ${value})`).join(', '));
    ok((await bar.inputValue()) === barWant, `${message}: the bar reads back`, await bar.inputValue());
    ok((await lit()) === litWant, `${message}: the right keys are lit`, await lit());
    const count = await found();
    ok(count > 0, `${message}: rows came back`, `${count}`);
  };

  await bar.fill('blade runner');
  await bar.press('Enter');
  await step('words', { q: 'blade runner', order: 'relevance', provider: null }, 'blade runner', '[ ALL ] [ ALL ] [ BEST MATCH ]');
  await press(key('Source: YOUTUBE'));
  await step('YOUTUBE', { provider: 'youtube', order: 'relevance' }, 'blade runner in:youtube', '[ YOUTUBE ] [ ALL ] [ BEST MATCH ]');
  await press(key('Type: VIDEO'));
  await step('VIDEO', { provider: 'youtube', type: 'video' }, 'type:video blade runner in:youtube', '[ YOUTUBE ] [ VIDEO ] [ BEST MATCH ]');
  await press(key('Sort: POPULAR'));
  await step('POPULAR', { order: 'popular' }, 'type:video blade runner in:youtube sort:popular', '[ YOUTUBE ] [ VIDEO ] [ POPULAR ]');
  await press(key('Sort: DATE'));
  await step('DATE', { order: 'newest' }, 'type:video blade runner in:youtube sort:newest', '[ YOUTUBE ] [ VIDEO ] [ DATE ]');
  await press(rows.locator('button[aria-label^="Newest first"]'));
  await step('the flip key', { order: 'oldest' }, 'type:video blade runner in:youtube sort:oldest', '[ YOUTUBE ] [ VIDEO ] [ DATE ]');
  await press(key('Sort: BEST MATCH'));
  await settled();
  await press(key('Vibe search: mood and tag words'));
  await step('VIBE', { vibe: 'on' }, 'type:video blade runner in:youtube vibe:on', '[ YOUTUBE ] [ VIDEO ] [ ON ] [ BEST MATCH ]');
  await press(key('Vibe search: mood and tag words'));
  await settled();
  await press(key('Type: ALL'));
  await settled();
  await press(key('Source: INTERNET ARCHIVE'));
  await step('INTERNET ARCHIVE', { provider: 'internet_archive' }, 'blade runner in:internet-archive', '[ INTERNET ARCHIVE ] [ ALL ] [ BEST MATCH ]');
  await press(key('Source: PEERTUBE'));
  await step('PEERTUBE', { provider: 'peertube' }, 'blade runner in:peertube', '[ PEERTUBE ] [ ALL ] [ BEST MATCH ]');
  await press(key('Source: ALL'));
  await settled();
  await press(key('Sort: POPULAR'));
  await step('POPULAR across ALL', { order: 'popular', provider: null }, 'blade runner sort:popular', '[ ALL ] [ ALL ] [ POPULAR ]');
  const lines = await page.locator('[data-watch-results]').innerText();
  ok(!/WIKIMEDIA COMMONS:|OPENVERSE:/.test(lines), 'no line about a source a room cannot use');
  await capture(page, { out: path.join(OUT, 'queue-results-1280.png') });

  const beforeMore = await found();
  const more = page.locator('[data-watch-results] button:has-text("MORE")');
  if ((await more.count()) > 0) {
    const askedBefore = asked.length;
    await press(more);
    await sleep(600);
    await page.waitForFunction(() => !document.querySelector('[data-watch-results]')?.innerText.includes('LOADING...'), undefined, { timeout: 40000 });
    const params = asked[askedBefore];
    ok(params?.get('order') === 'popular' && params?.get('cursor') !== null, '[ MORE ] keeps the filter and asks for the next page', params?.toString().slice(0, 60));
    ok((await found()) >= beforeMore, '[ MORE ] adds rows', `${beforeMore} -> ${await found()}`);
  } else console.log('note no [ MORE ] offered for this search');

  await bar.fill('from:prelinger');
  await bar.press('Enter');
  await step('typed from:', { from: 'prelinger', q: '' }, 'from:prelinger', '[ ALL ] [ ALL ] [ BEST MATCH ]');

  await bar.fill('');
  await press(key('Source: YOUTUBE'));
  await sleep(300);
  ok((await page.locator('[role="alert"]').first().innerText()).includes('TYPE WHAT TO LOOK FOR'), 'one source and no words asks for words');
  ok(await bar.evaluate((element) => document.activeElement === element), 'and the caret is in the bar');

  await bar.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await sleep(200);
  const all = rows.locator('button');
  const off = await rows.locator('button:disabled').count();
  ok(off === (await all.count()) && off > 0, 'a pasted link turns the keys off', `${off} of ${await all.count()}`);

  // A row found under a filter goes on the list, as any row does (this writes one row on the test account's own room).
  await bar.fill('blade runner');
  await press(key('Source: YOUTUBE'));
  await settled();
  const add = page.locator('[data-watch-results] button:has-text("+ ADD")').first();
  await press(add);
  await page.locator('[data-watch-results]').getByText('ADDED').first().waitFor({ timeout: 15000 }).then(
    () => ok(true, 'a row found under a filter can be added'),
    () => ok(false, 'a row found under a filter can be added'),
  );

  /* --- a narrow window ------------------------------------------------------------------------- */
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(800);
  const narrow = await page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth > window.innerWidth,
    off: [...document.querySelectorAll('[data-queue-filters] button')].filter((button) => {
      const box = button.getBoundingClientRect();
      return box.right > window.innerWidth + 1 || box.left < -1;
    }).length,
  }));
  ok(!narrow.sideways && narrow.off === 0, 'at 390 wide the keys wrap, with no sideways scroll', JSON.stringify(narrow));
  await capture(page, { out: path.join(OUT, 'queue-results-390.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await sleep(500);

  /* --- a black screen's key, then the end ------------------------------------------------------ */
  await press(page.locator('button:has-text("×")').filter({ has: page.locator(':scope') }).first()).catch(() => {});
  await page.keyboard.press('Escape');
  await sleep(500);
  ok(true, 'closing the queue window');

  const end = page.getByRole('button', { name: /END STREAM/ }).first();
  await press(end);
  await sleep(300);
  await press(page.getByRole('button', { name: /END FOR EVERYBODY/ }).first());
  await sleep(2500);
  const canvas = page.getByText('SAVE THIS CANVAS?');
  if ((await canvas.count()) > 0) console.log('note the canvas asked to be saved; left unanswered');
  console.log(`room ended as ${account.user?.email ?? 'the kept test account'}`);

  await page.goto(`${BASE}/media?kind=audio`, { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  ok(new URL(page.url()).pathname === '/files', 'an old catalogue link lands on /files', page.url());
  await capture(page, { out: path.join(OUT, 'files-1280.png') });
  await page.goto(`${BASE}/media?q=blade+runner&in=youtube`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form[role="search"]', { timeout: 20000 });
  await sleep(5000);
  ok((await page.locator('form[role="search"] input').first().inputValue()).includes('blade runner'), 'a shared search opens on /media');
  await capture(page, { out: path.join(OUT, 'media-1280.png') });

  await close(session);
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`STOPPED: ${error.message}`);
  process.exit(1);
});
