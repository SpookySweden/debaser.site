/*
 * Every edition of every book (SPEC-book-editions.md, Luke 2026-11-11), driven in a real browser as a visitor, at desktop
 * and phone width, against a running site (live data from Open Library, so not in `npm run checks`):
 *   node scripts/drive-book-editions.cjs [--base http://localhost:3000]
 * Dracula's page (1,920 editions): EDITIONS lists detailed editions first, DETAILS folds open, the filters and the order ask
 * again, MORE adds fifty; an edition's address opens the page at it, marked THIS EDITION; a book with one edition shows
 * it with BORROW; an ISBN search finds its book. Pictures land in Temp/browse/editions-*.png. No sideways scroll on a phone.
 */
const path = require('node:path');
const { open, close, capture } = require('./browser.cjs');

const BASE = (process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'Temp', 'browse');
let failures = 0;
function ok(condition, message, detail = '') {
  if (!condition) failures += 1;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}${detail ? ` :: ${detail}` : ''}`);
}

/** The lost-account question pops up for a browser that once held a session; a fresh profile shouldn't, but close it if so. */
async function quiet(page) {
  const never = page.getByRole('button', { name: /NOT NOW/ });
  if (await never.count()) await never.first().evaluate((element) => element.click()).catch(() => undefined);
}

async function drive(size, mobile, tag) {
  const session = await open({ size, mobile });
  const { page } = session;
  const press = (locator) => locator.evaluate((element) => element.click());
  const rows = page.locator('ul[aria-label="Editions"] > li');
  try {
    await page.goto(`${BASE}/media/book/books:OL85892W-pg345`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-editions-count]').waitFor({ timeout: 60000 });
    await quiet(page);
    const count = (await page.locator('[data-editions-count]').innerText()).trim();
    ok(/^1,9\d\d EDITIONS/.test(count), `${tag}: Dracula's count`, count);
    ok((await rows.count()) === 50, `${tag}: fifty editions to a page`, String(await rows.count()));
    const first = await rows.first().innerText();
    ok(/DETAILS/.test(first), `${tag}: the first edition has details`, first.split('\n').slice(0, 3).join(' / '));
    ok(/READ GUTENBERG TEXT/.test(first), `${tag}: Dracula's Gutenberg text is offered on each edition`);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(scroll <= 0, `${tag}: no sideways scroll`, String(scroll));
    const details = rows.first().getByRole('button', { name: /DETAILS/ });
    await press(details);
    ok((await details.getAttribute('aria-expanded')) === 'true', `${tag}: DETAILS folds open`);
    const opened = await rows.first().innerText();
    const folded = (await rows.first().locator('[id^="list-details-"]').innerText()).replace(/\s+/g, ' ').slice(0, 160);
    ok(/ by |CONTENTS/.test(folded), `${tag}: who else is in it, or the contents`, folded);
    await rows.first().scrollIntoViewIfNeeded();
    await capture(page, { out: path.join(OUT, `editions-dracula-${tag}.png`) });

    await press(page.getByRole('button', { name: '[ MORE ]' }));
    await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Editions"] > li').length > 50, null, { timeout: 30000 });
    ok((await rows.count()) === 100, `${tag}: MORE adds fifty`, String(await rows.count()));

    await press(page.getByRole('button', { name: '[ HAS DETAILS ]' }));
    await page.waitForFunction(() => /OF 1,9\d\d EDITIONS/.test(document.querySelector('[data-editions-count]')?.textContent ?? ''), null, { timeout: 30000 });
    ok(true, `${tag}: HAS DETAILS`, (await page.locator('[data-editions-count]').innerText()).trim());
    await press(page.getByRole('button', { name: '[ OLDEST ]' }));
    await page.waitForFunction(() => document.querySelector('[aria-label="Order"] [aria-pressed="true"]')?.textContent === 'OLDEST', null, { timeout: 10000 });
    await rows.first().waitFor({ timeout: 30000 });
    const oldest = await rows.first().innerText();
    ok(/· 1[89]\d\d ·/.test(oldest), `${tag}: OLDEST starts with an old edition`, oldest.split('\n').slice(0, 3).join(' / '));
    await press(page.getByRole('button', { name: '[ CAN BE READ HERE ]' }));
    await page.waitForFunction(() => /OF 1,9\d\d EDITIONS/.test(document.querySelector('[data-editions-count]')?.textContent ?? '') && document.querySelector('[aria-label="Which editions"] [aria-pressed="true"]')?.textContent === 'CAN BE READ HERE', null, { timeout: 30000 });
    const readable = (await page.locator('[data-editions-count]').innerText()).trim();
    ok(true, `${tag}: CAN BE READ HERE`, readable);
    if ((await rows.count()) > 0) ok(/\[ READ \]/.test(await rows.first().innerText()), `${tag}: and each reads here`);

    // One edition's own address: the book's page, opened at it.
    await page.goto(`${BASE}/media/book/edition:OL10416488M`, { waitUntil: 'domcontentloaded' });
    const marked = page.locator('ul[aria-label="This edition"] > li');
    await marked.waitFor({ timeout: 60000 });
    await quiet(page);
    const markedText = await marked.innerText();
    ok(/THIS EDITION/.test(markedText) && /9780141439846/.test(markedText), `${tag}: an edition's address opens at it`, markedText.split('\n').slice(0, 4).join(' / '));
    ok((await page.locator('#book-itself').innerText()).trim() === 'DRACULA', `${tag}: on its book's page`);
    await capture(page, { out: path.join(OUT, `editions-at-${tag}.png`) });

    // A book with one edition.
    await page.goto(`${BASE}/media/book/books:OL24218144W`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-editions-count]').waitFor({ timeout: 60000 });
    await quiet(page);
    ok((await page.locator('[data-editions-count]').innerText()).trim() === '1 EDITION', `${tag}: one edition`);
    const only = await rows.first().innerText();
    ok(/BORROW ON ARCHIVE\.ORG/.test(only) && !/NO FREE COPY/.test(only), `${tag}: its lending scan is BORROW`, only.split('\n').slice(0, 4).join(' / '));
    await capture(page, { out: path.join(OUT, `editions-one-${tag}.png`) });
  } catch (error) {
    ok(false, `${tag}: the drive ran`, error.message.split('\n')[0]);
    await capture(page, { out: path.join(OUT, `editions-failed-${tag}.png`) }).catch(() => undefined);
  } finally {
    const bad = session.log.errors.filter((line) => !/hydrat/i.test(line));
    ok(bad.length === 0, `${tag}: no page errors`, bad.slice(0, 2).join(' | '));
    await close(session);
  }
}

(async () => {
  await drive([1280, 900], false, 'desktop');
  await drive([390, 844], true, 'phone');
  console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
