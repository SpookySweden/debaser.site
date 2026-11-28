/*
 * The reader keeps your place when you leave straight after a page turn (the brief of 2026-11-28; the save waits 1.5 s after a
 * turn, and leaving sooner used to drop it). Driven on a LOCAL mock dev server only (`node scripts/dev-mock-live.cjs <port>`:
 * every switch on mock, mock sign-in, Supabase address empty). Live hosts are blocked and counted; Open Library is answered here.
 *
 * Your own file (a twelve-page PDF made here, so the foot says exactly which page you are on), signed in and as a visitor:
 * turn a page and wait for the save; turn again and leave within a second, by [ ◀ BACK ] or a top-bar key (no page load: the
 * reader is taken off the screen), by the browser's reload and by closing the tab; open the same file again: CONTINUE lands on
 * the page you had turned to.
 *
 *   node scripts/drive-reader-leave.cjs --base http://localhost:<port> [--reset <address that empties a stand-in database>]
 */
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3341');
const RESET = opt('--reset', '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;
const check = (ok, what, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` :: ${detail}` : ''}`);
};

const ME = { id: 'leave-me', name: 'LEAVEREADER' };

function seed({ me }) {
  if (window.localStorage.getItem('rl-seeded') !== null) return;
  window.localStorage.setItem('rl-seeded', '1');
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser.tour.v2', 'skipped');
  // READ's own key ticked onto the top bar (it is off for a first visit).
  window.localStorage.setItem('debaser-modules-v2', JSON.stringify({ on: { read: true }, colours: {} }));
  if (me === null) return;
  const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const user = { id: me.id, email: `${me.id}@debaser.site`, displayName: me.name, createdAt: at(1000), salt: '', secretHash: '', hidden: true };
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user], sessionUserId: me.id, bannedIds: [] }));
  const profile = { userId: me.id, displayName: me.name, bio: '', tags: [], comments: [], updatedAt: at(1), privacySeen: true };
  window.localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: { [me.id]: profile } }));
}

/** A made-up PDF: pages that say "DEBASER TEST PAGE n", never a real book's text. */
function testPdf(pages = 12) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add('');
  const tree = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (let n = 1; n <= pages; n += 1) {
    const text = `BT /F1 24 Tf 30 200 Td (DEBASER TEST PAGE ${n}) Tj ET`;
    const content = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 360 480] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${pages} >>`;
  const info = add('<< /Title (Zzqx Leave Drive Test File) >>');
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const FILE = { name: 'zzqx-leave-drive-test-file.pdf', mimeType: 'application/pdf', buffer: testPdf() };

const foot = async (page) => (await page.locator('[data-reader-left]').innerText()).trim();
const ready = (page) => page.locator('footer input[type="range"]:not([disabled])').waitFor({ timeout: 120000 });
const asked = (page) => page.getByRole('dialog', { name: 'Where to open the book' });

/**
 * To the READ page the way a reader gets there: the top bar's own key, from another page, without a page load, so that BACK
 * and the top bar stay inside the site. A press before the page is live loads the page afresh instead, so it is tried again.
 */
async function toRead(page) {
  const key = page.locator('nav[aria-label="Modules"] a[href="/read"]').first();
  for (let attempt = 1; ; attempt += 1) {
    await key.waitFor({ timeout: 240000 });
    await sleep(2000);
    await page.evaluate(() => {
      window.rlBefore = true;
    });
    await key.evaluate((element) => element.click());
    await page.waitForURL((url) => url.pathname === '/read', { timeout: 240000 });
    await sleep(500);
    if (await page.evaluate(() => window.rlBefore === true)) return;
    if (attempt === 3) throw new Error('could not reach READ without a page load');
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  }
}

/** On the READ page: the file chosen, its card's READ, then the question (if asked) answered. */
async function openFile(page) {
  await page.locator('[data-own-drop]').waitFor({ timeout: 240000 });
  // The shelf has read its list once the page is live; a file given before that is not heard, so it is given again.
  await page.locator('[data-shelf="reading"]').or(page.getByText('NOTHING STARTED YET')).first().waitFor({ timeout: 120000 });
  await sleep(2000);
  const read = page.locator('[data-own-card] [data-own-read]:not([disabled])');
  for (let attempt = 1; ; attempt += 1) {
    await page.locator('[data-own-input]').first().setInputFiles([]);
    await page.locator('[data-own-input]').first().setInputFiles(FILE);
    const shown = await read.waitFor({ timeout: 20000 }).then(() => true, () => false);
    if (shown) break;
    if (attempt === 4) throw new Error('the file card never appeared');
  }
  await read.click();
  await Promise.race([asked(page).waitFor({ timeout: 120000 }), ready(page)]);
  let question = null;
  if ((await asked(page).count()) > 0) {
    const key = asked(page).getByRole('button').first();
    question = (await key.innerText()).trim();
    await key.click();
  }
  await ready(page);
  await sleep(1500);
  return question;
}

/** One page forward with the arrow key; resolves with what the foot says once it has changed. */
async function turn(page) {
  const before = await foot(page);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((old) => document.querySelector('[data-reader-left]')?.textContent?.trim() !== old, before, { timeout: 15000, polling: 30 });
  return foot(page);
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  let live = 0;
  for (const [who, me] of [['SIGNED IN', ME], ['A VISITOR', null]]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route(/supabase\.(co|in)\/|debaser-site\.vercel\.app|api\.debaser\.site|debaser\.site\//, (route) => {
      live += 1;
      return route.abort();
    });
    await context.route(/openlibrary\.org\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ numFound: 0, docs: [] }) }));
    await context.addInitScript(seed, { me });
    let page = await context.newPage();

    for (const how of ['[ ◀ BACK ]', 'a top-bar key', 'a reload', 'closing the tab']) {
      console.log(`${who}, LEAVING BY ${how.toUpperCase()}`);
      const inside = how === '[ ◀ BACK ]' || how === 'a top-bar key';
      // Each way of leaving starts from a clean place: this browser's kept places wiped, the file opened at its start.
      await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded', timeout: 240000 });
      await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith('debaser-reader-place')).forEach((key) => window.localStorage.removeItem(key)));
      if (RESET) await fetch(RESET);
      await toRead(page);
      await openFile(page);
      const first = await turn(page);
      await sleep(2500);
      const second = await turn(page);
      // The save's 1.5 s starts as the foot changes: leaving is timed from there.
      const started = Date.now();
      check(first !== second, 'two page turns, each shown by the foot', `${first} -> ${second}`);
      const soon = () => {
        const took = Date.now() - started;
        check(took < 1200, 'left within about a second of the turn', `${took} ms`);
      };

      if (inside) {
        await page.evaluate(() => {
          window.rlSamePage = true;
        });
        // Pressed from inside the page: a mouse press waits for a key to hold still, which can outlast the 1.5 s.
        if (how === '[ ◀ BACK ]') await page.locator('header button', { hasText: 'BACK' }).first().evaluate((element) => element.click());
        else await page.locator('nav[aria-label="Modules"] a', { hasText: 'MEDIA' }).first().evaluate((element) => element.click());
        soon();
        await page.waitForURL((url) => !url.pathname.startsWith('/read'), { timeout: 240000 });
        await sleep(2500);
        check(await page.evaluate(() => window.rlSamePage === true), 'and left without a page load', page.url());
        await toRead(page);
      } else {
        soon();
        if (how === 'a reload') await page.reload({ waitUntil: 'domcontentloaded' });
        else {
          await page.close({ runBeforeUnload: true });
          await sleep(1000);
          page = await context.newPage();
          await page.goto(`${BASE}/read`, { waitUntil: 'domcontentloaded', timeout: 240000 });
        }
      }

      const question = await openFile(page);
      const now = await foot(page);
      check(question !== null && now === second, 'opened again: you are on the page you had turned to', `left on ${second}; asked "${question ?? 'nothing'}"; opened on ${now}`);
    }
    // The browser's copy only stands in for the account's when it is newer AND this person's (a database apart from the
    // browser is needed to tell the two apart, so only with the stand-in).
    if (me && RESET) {
      console.log('SIGNED IN, WHICH PLACE WINS');
      for (const [what, updatedAt, saver, wantsKept] of [
        ['an older browser copy: the account wins', '2000-01-01T00:00:00.000Z', me.id, false],
        ["a newer copy kept for someone else: the account wins", '2100-01-01T00:00:00.000Z', 'somebody-else', false],
        ['a newer copy of your own: it wins', '2100-01-01T00:00:00.000Z', me.id, true],
      ]) {
        await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded', timeout: 240000 });
        await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith('debaser-reader-place')).forEach((key) => window.localStorage.removeItem(key)));
        await fetch(RESET);
        await toRead(page);
        await openFile(page);
        const early = await turn(page);
        await sleep(2500);
        const copy = await page.evaluate(() => {
          const key = Object.keys(window.localStorage).find((each) => each.startsWith('debaser-reader-place:'));
          return { key, value: window.localStorage.getItem(key) };
        });
        const late = await turn(page);
        await sleep(2500);
        await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded', timeout: 240000 });
        await page.evaluate(
          ({ key, value, updatedAt: at, saver: who }) => {
            window.localStorage.setItem(key, JSON.stringify({ ...JSON.parse(value), updatedAt: at }));
            window.localStorage.setItem(key.replace('debaser-reader-place:', 'debaser-reader-saver:'), who);
          },
          { ...copy, updatedAt, saver },
        );
        await toRead(page);
        await openFile(page);
        const now = await foot(page);
        check(now === (wantsKept ? early : late), what, `browser's copy ${early}, account ${late}, opened on ${now}`);
      }
    }
    await context.close();
  }
  check(live === 0, 'nothing reached the live site', `${live} blocked`);
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
