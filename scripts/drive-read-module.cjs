/*
 * The READ module (Luke, 2026-11-13: "a new module for reading which has this clear feature where you can upload pdfs to be
 * read, which will then automatically hook to the correct book and all its variants"), driven in real browsers:
 *   node scripts/drive-read-module.cjs --pdf <a public-domain PDF of Alice's Adventures in Wonderland> [--base http://localhost:3000]
 *
 * As TEST ACCOUNT A, with the 1911 Alice PDF (the Internet Archive's alicesadventures00carr, out of copyright) and Project
 * Gutenberg's EPUB of the same book (books:OL138052W-pg11):
 * - READ is a key on the top bar, on for a first visit; it goes to /read and is lit there.
 * - A reads a few pages of Gutenberg's EPUB (a place in another copy).
 * - A drops the PDF on /read's box: before it opens, the card says THIS IS: ... (the work OL138052W, saved to the account),
 *   how it was found, how many editions, YOU'RE n% THROUGH IN ANOTHER COPY, and KEPT ON THIS DEVICE.
 * - [ READ ] opens it in the reader, which offers CONTINUE FROM n% (READ IN ANOTHER COPY), and shows THIS IS: above the page.
 * - YOUR FILES lists it; its [ READ ] opens it with no file chosen; so does CONTINUE READING's /read?file=<fingerprint>.
 * - A file dropped anywhere on the page goes to the card.
 * - The book page's [ READ YOUR OWN COPY ] opens /read?for=<work>: a file chosen there is that book (CHOSEN BY YOU).
 * - [ FORGET ] asks once, then takes it off this device; /read?file= then asks for it again.
 * - Signed out: the READ key and the drop box are there.
 * - No request carried the PDF's bytes.
 * A's places for these two copies are deleted at the start and the end (no highlights or posts are made here). Nothing of the
 * book's text is printed.
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { open, close, installSession, signInTestAccount, testAccountClient } = require('./browser.cjs');

const argv = process.argv.slice(2);
const value = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const BASE = value('--base', 'http://localhost:3000').replace(/\/$/, '');
const PDF_PATH = path.resolve(value('--pdf', 'Temp/browse/pd/alice-1911.pdf'));
const OUT = path.join(__dirname, '..', 'Temp', 'browse');
const WORK = 'books:OL138052W';
const EPUB = 'books:OL138052W-pg11';
const PDF = fs.readFileSync(PDF_PATH);
const HASH = crypto.createHash('sha256').update(PDF).digest('hex');
const OWN = `own:${HASH}`;
const HEAD = PDF.subarray(0, 512);

let failures = 0;
function ok(condition, message, detail = '') {
  if (!condition) failures += 1;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}${detail ? ` :: ${detail}` : ''}`);
}

const press = (locator) => locator.evaluate((element) => element.click());
async function quiet(page) {
  const never = page.getByRole('button', { name: /NOT NOW/ });
  if (await never.count()) await press(never.first()).catch(() => undefined);
}
const ready = (page) => page.locator('footer input[type="range"]:not([disabled])').waitFor({ timeout: 180000 });
const asked = (page) => page.getByRole('dialog', { name: 'Where to open the book' });
const card = (page) => page.locator(`[data-own-card="${OWN}"]`);

async function until(ask, test, seconds = 30) {
  let last = null;
  for (let waited = 0; waited < seconds; waited += 1) {
    last = await ask();
    if (test(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return last;
}

/** The card, once it has found the book and looked through its copies. */
async function cardDone(page) {
  await card(page).waitFor({ timeout: 120000 });
  await card(page).locator('[data-match-line]').waitFor({ timeout: 120000 });
  await card(page)
    .locator('[data-copies] [role="status"]')
    .waitFor({ state: 'detached', timeout: 60000 })
    .catch(() => undefined);
  await card(page).locator('[data-kept]').waitFor({ timeout: 30000 }).catch(() => undefined);
}

async function shelf(page, url = `${BASE}/read`) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-own-drop], [data-own-card]').first().waitFor({ timeout: 60000 });
  await quiet(page);
}

(async () => {
  const a = await testAccountClient('A');
  const sessionA = await signInTestAccount('A');
  const cleanUp = async () => {
    await a.client.from('book_places').delete().eq('person', a.id).in('book_ref', [EPUB, OWN]);
  };
  await cleanUp();

  const opened = await open({ size: [1440, 1000], profile: path.join(OUT, 'read-module-profile') });
  const { page } = opened;
  await installSession(page, sessionA);
  const sent = [];
  page.on('request', (request) => {
    const body = request.postDataBuffer();
    if (body && body.includes(HEAD)) sent.push(request.url());
  });

  try {
    // 1. The READ key on the top bar.
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    const bar = page.getByRole('navigation', { name: 'Modules' });
    await bar.waitFor({ timeout: 60000 });
    const readKey = bar.getByRole('link', { name: 'READ', exact: true });
    ok((await readKey.count()) === 1, 'READ is a key on the top bar');
    ok((await readKey.getAttribute('href')) === '/read', 'it goes to /read');
    await press(readKey);
    await page.waitForURL(/\/read$/, { timeout: 60000 });
    await page.locator('[data-own-drop]').waitFor({ timeout: 60000 });
    ok((await bar.getByRole('link', { name: 'READ', exact: true }).getAttribute('aria-current')) === 'page', 'READ is lit on /read');
    ok((await page.locator('[data-own-drop]').innerText()).includes('DROP IT HERE'), 'the drop box is at the top');
    await quiet(page);

    // 2. A place in another copy: a few pages of Gutenberg's EPUB.
    await page.goto(`${BASE}/read/${EPUB}`, { waitUntil: 'domcontentloaded' });
    await quiet(page);
    await Promise.race([asked(page).waitFor({ timeout: 180000 }), ready(page)]);
    if (await asked(page).count()) await press(asked(page).getByRole('button').first());
    await ready(page);
    await page.evaluate(() => document.querySelector('foliate-view')?.goToFraction(0.3));
    await page.waitForTimeout(2500);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(3500);
    const epubPlace = await until(
      async () => (await a.client.from('book_places').select('progress').eq('person', a.id).eq('book_ref', EPUB).maybeSingle()).data,
      (row) => row && row.progress > 0,
    );
    ok(epubPlace && epubPlace.progress > 0, 'a place in Gutenberg\'s copy is saved', `${epubPlace?.progress}%`);

    // 3. The PDF into the box: the card before it opens.
    await shelf(page);
    await page.locator('[data-own-input]').setInputFiles(PDF_PATH);
    await cardDone(page);
    const line = await card(page).locator('[data-match-line]').innerText();
    ok(/^THIS IS: .*ALICE/i.test(line), 'the card says which book it is', line.slice(0, 80));
    const how = await card(page).locator('[data-match-how]').getAttribute('data-match-how');
    ok(['archive', 'isbn', 'inside', 'name'].includes(how), 'and how it was found, by itself', how);
    const matchRow = await until(
      async () => (await a.client.from('book_places').select('work_ref').eq('person', a.id).eq('book_ref', OWN).maybeSingle()).data,
      (row) => row?.work_ref,
    );
    ok(/^books:OL\d+W$/.test(matchRow?.work_ref ?? ''), 'the match is saved to the account, before the file opens', matchRow?.work_ref);
    // Open Library from this computer (the [ CHANGE ] search and the edition count ask it from the browser).
    const olUp = await fetch('https://openlibrary.org/search.json?q=alice&limit=1', { signal: AbortSignal.timeout(20000) })
      .then((response) => response.ok)
      .catch(() => false);
    if (matchRow?.work_ref !== WORK && !olUp) {
      // This 1911 PDF holds both Alice books, and the Archive files it under that combined work. Open Library doesn't answer
      // from here, so it is made Wonderland the other way: the book page's READ YOUR OWN COPY (/read?for=), which asks only
      // the site's own server.
      console.log('note Open Library does not answer from this computer: Wonderland is chosen through /read?for= instead of [ CHANGE ]');
      await shelf(page, `${BASE}/read?for=${encodeURIComponent(WORK)}`);
      await page.locator('[data-own-input]').setInputFiles(PDF_PATH);
      await cardDone(page);
      ok((await card(page).locator('[data-match-how]').getAttribute('data-match-how')) === 'chosen', 'READ YOUR OWN COPY makes it that book');
      const changed = await until(
        async () => (await a.client.from('book_places').select('work_ref').eq('person', a.id).eq('book_ref', OWN).maybeSingle()).data,
        (row) => row?.work_ref === WORK,
      );
      ok(changed?.work_ref === WORK, "now Alice's Adventures in Wonderland, on the account", changed?.work_ref);
    } else if (matchRow?.work_ref !== WORK) {
      // This 1911 PDF holds both Alice books, and the Archive files it under that combined work: [ CHANGE ] to Wonderland.
      await press(card(page).getByRole('button', { name: /CHANGE|FIND IT/ }));
      const searchBox = card(page).locator('[data-match-search]');
      await searchBox.locator('input').fill("Alice's Adventures in Wonderland Lewis Carroll");
      await press(searchBox.getByRole('button', { name: /SEARCH BOOKS/ }));
      const choice = searchBox.locator(`[data-work="${WORK}"]`);
      await choice.waitFor({ timeout: 90000 });
      await press(choice.getByRole('button', { name: /THIS ONE/ }));
      await card(page).locator('[data-match-how="chosen"]').waitFor({ timeout: 30000 });
      await cardDone(page);
      const changed = await until(
        async () => (await a.client.from('book_places').select('work_ref').eq('person', a.id).eq('book_ref', OWN).maybeSingle()).data,
        (row) => row?.work_ref === WORK,
      );
      ok(changed?.work_ref === WORK, '[ CHANGE ] makes it Alice\'s Adventures in Wonderland, on the account', changed?.work_ref);
    }
    const editions = Number(await card(page).locator('[data-editions]').getAttribute('data-editions').catch(() => '0'));
    if (olUp) ok(editions > 1, 'the card counts the editions of the book', String(editions));
    else console.log('SKIP the edition count: it comes from Open Library, which does not answer from this computer');
    const elsewhere = await card(page).locator('[data-elsewhere]').innerText().catch(() => '');
    ok(/THROUGH IN ANOTHER COPY/.test(elsewhere), 'and says where you are in another copy', elsewhere);
    ok((await card(page).locator('[data-kept]').getAttribute('data-kept')) === 'yes', 'KEPT ON THIS DEVICE');
    await page.screenshot({ path: path.join(OUT, 'read-module-card.png') });

    // 4. [ READ ]: the reader, with the other copy's place offered.
    await press(card(page).locator('[data-own-read]'));
    await Promise.race([asked(page).waitFor({ timeout: 180000 }), ready(page)]);
    const offer = (await asked(page).count()) ? await asked(page).innerText() : '';
    ok(/READ IN ANOTHER COPY/.test(offer), 'the reader offers the place from the other copy', offer.replace(/\s+/g, ' ').slice(0, 90));
    if (await asked(page).count()) await press(asked(page).getByRole('button').first());
    await ready(page);
    const bar2 = await page.locator('[data-match]').innerText().catch(() => '');
    ok(/THIS IS: .*ALICE/i.test(bar2), 'the reader says THIS IS: above the page');

    // 5. YOUR FILES: opens with no file chosen.
    await shelf(page);
    const row = page.locator(`[data-shelf="files"] [data-file="${OWN}"]`);
    await row.waitFor({ timeout: 30000 });
    ok((await row.innerText()).includes('ALICE'), 'YOUR FILES lists it under its book');
    await press(row.getByRole('button', { name: /^READ YOUR FILE/ }));
    await Promise.race([asked(page).waitFor({ timeout: 180000 }), ready(page)]);
    ok(true, 'YOUR FILES opens it without choosing it again');
    if (await asked(page).count()) await press(asked(page).getByRole('button').first());
    await ready(page);

    // 6. /read?file=<fingerprint> (CONTINUE READING's READ) opens the kept file at once.
    await page.goto(`${BASE}/read?file=${HASH}`, { waitUntil: 'domcontentloaded' });
    await Promise.race([asked(page).waitFor({ timeout: 180000 }), ready(page)]);
    ok((await page.getByText(/AGAIN TO CONTINUE|CHOOSE .* AGAIN/).count()) === 0, '/read?file= opens a kept file with no question about the file');

    // 7. Dropped anywhere on the page.
    await shelf(page);
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'drive-drop';
      input.style.display = 'none';
      document.body.append(input);
    });
    await page.locator('#drive-drop').setInputFiles(PDF_PATH);
    await page.evaluate(() => {
      const file = document.getElementById('drive-drop').files[0];
      const data = new DataTransfer();
      data.items.add(file);
      const target = document.getElementById('continue-reading');
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    });
    await cardDone(page);
    ok((await card(page).locator('[data-match-how]').getAttribute('data-match-how')) === 'saved', 'a file dropped on the shelf goes to the card (matched before, so the saved match)');

    // 8. The book page's READ YOUR OWN COPY.
    await page.goto(`${BASE}/media/book/${WORK}`, { waitUntil: 'domcontentloaded' });
    const ownCopy = page.locator('[data-own-copy] a');
    await ownCopy.waitFor({ timeout: 60000 });
    ok((await ownCopy.getAttribute('href')) === `/read?for=${encodeURIComponent(WORK)}`, 'the book page has READ YOUR OWN COPY');
    await press(ownCopy);
    await page.waitForURL(/\/read\?for=/, { timeout: 60000 });
    await page.locator('[data-own-drop] h2', { hasText: 'YOUR OWN COPY OF' }).waitFor({ timeout: 60000 });
    await page.locator('[data-own-input]').setInputFiles(PDF_PATH);
    await cardDone(page);
    ok((await card(page).locator('[data-match-how]').getAttribute('data-match-how')) === 'chosen', 'a file chosen there is that book');

    // 9. [ FORGET ]: asks once, then goes; /read?file= then asks for the file.
    await shelf(page);
    const forget = page.locator(`[data-file="${OWN}"]`).getByRole('button', { name: /FORGET/ });
    await press(forget);
    ok((await forget.innerText()).includes('SURE?'), '[ FORGET ] asks first');
    await press(forget);
    await page.locator(`[data-file="${OWN}"]`).waitFor({ state: 'detached', timeout: 15000 });
    ok(true, 'and then takes it off this device');
    await page.goto(`${BASE}/read?file=${HASH}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-own-drop] h2', { hasText: 'AGAIN' }).waitFor({ timeout: 60000 });
    ok(true, '/read?file= asks for a file this device no longer keeps');
    await page.screenshot({ path: path.join(OUT, 'read-module-again.png') });

    ok(sent.length === 0, 'no request carried the PDF', sent.slice(0, 3).join(' '));
  } finally {
    await close(opened);
  }

  // 10. Signed out.
  const visitor = await open({ size: [1440, 1000] });
  try {
    await visitor.page.goto(`${BASE}/read`, { waitUntil: 'domcontentloaded' });
    await visitor.page.locator('[data-own-drop]').waitFor({ timeout: 60000 });
    ok((await visitor.page.getByRole('navigation', { name: 'Modules' }).getByRole('link', { name: 'READ', exact: true }).count()) === 1, 'signed out: the READ key and the drop box');
  } finally {
    await close(visitor);
  }

  await cleanUp();
  console.log(failures ? `${failures} FAILED` : 'read module: all passed');
  process.exit(failures ? 1 : 0);
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
