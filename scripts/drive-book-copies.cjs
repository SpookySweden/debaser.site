/*
 * Every copy of a book counts as that book (Luke, 2026-11-13), driven in real browsers against a running site:
 *   node scripts/drive-book-copies.cjs --pdf <a public-domain PDF of Alice's Adventures in Wonderland> [--base http://localhost:3000]
 *
 * One work (Open Library's OL138052W) read through two copies: Project Gutenberg's EPUB (books:OL138052W-pg11) and your own
 * PDF of the 1911 edition (the Internet Archive's alicesadventures00carr, not in copyright), as TEST ACCOUNT A, with B
 * looking on:
 * - A opens the PDF at /read: THIS IS: <TITLE> BY <AUTHOR>, matched from the title and author inside it (or [ CHANGE ]),
 *   saved to the account; A highlights words on a PDF page (posted), and reads on.
 * - A opens Gutenberg's EPUB: CONTINUE FROM n% (READ IN ANOTHER COPY); the PDF's highlight is listed (found by its words, or
 *   FROM ANOTHER COPY); A highlights words there too (posted).
 * - Back in the PDF, the EPUB's highlight is listed FROM ANOTHER COPY (a PDF can't be searched by words here).
 * - Both highlights carry the work, and their posts went to one thread, A's "[NAME] READING [BOOK]" for the work.
 * - B opens Gutenberg's EPUB and sees both of A's public highlights in the panel.
 * - A second device (a fresh browser as A) opens the same PDF and finds the same match, from the account.
 * - No request carried the PDF's bytes.
 * Nothing of the book's text is printed: quotes are counted, never shown. A's places, highlights and the thread's posts for
 * these copies are deleted at the start and the end.
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
const OWN = `own:${crypto.createHash('sha256').update(PDF).digest('hex')}`;
const HEAD = PDF.subarray(0, 4096);

let failures = 0;
function ok(condition, message, detail = '') {
  if (!condition) failures += 1;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}${detail ? ` :: ${detail}` : ''}`);
}

async function browser(tag, session) {
  const opened = await open({ size: [1440, 1000], profile: path.join(OUT, `copies-profile-${tag}`) });
  await installSession(opened.page, session);
  const sent = [];
  opened.page.on('request', (request) => {
    const body = request.postDataBuffer();
    sent.push({ url: request.url(), size: body ? body.length : 0, carries: body ? body.includes(HEAD.subarray(0, 512)) : false });
  });
  return { ...opened, sent, tag };
}

const press = (locator) => locator.evaluate((element) => element.click());
async function quiet(page) {
  const never = page.getByRole('button', { name: /NOT NOW/ });
  if (await never.count()) await press(never.first()).catch(() => undefined);
}
const ready = (page) => page.locator('footer input[type="range"]:not([disabled])').waitFor({ timeout: 180000 });
const asked = (page) => page.getByRole('dialog', { name: 'Where to open the book' });
const percentShown = async (page) => Number((await page.locator('[data-reader-percent]').innerText()).replace('%', '').trim());

async function questionOrPage(page) {
  await Promise.race([asked(page).waitFor({ timeout: 180000 }), ready(page)]);
  return (await asked(page).count()) > 0;
}

/** Opens the PDF from the device at /read. */
async function openPdf(page) {
  await page.goto(`${BASE}/read`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-shelf="reading"]').or(page.getByText('NOTHING STARTED YET')).first().waitFor({ timeout: 60000 });
  await quiet(page);
  await page.locator('input[type="file"]').first().setInputFiles(PDF_PATH);
}

/**
 * Chooses some words on the page now shown, in whichever frame holds them (an EPUB chapter, or a PDF page's words layer),
 * the way a reader's drag would: a selection, which the reader turns into the highlight bar.
 */
async function chooseWords(page, { pdf }) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    for (const frame of page.frames()) {
      const chosen = await frame
        .evaluate((isPdf) => {
          const root = isPdf ? document.querySelector('.textLayer') : document.body;
          if (!root) return 0;
          if (isPdf) {
            // A PDF page's words come in short pieces: forty characters from the first long run of letters, across pieces.
            const all = root.textContent ?? '';
            const at = all.search(/[A-Za-z]{3,}[A-Za-z ,']{30,}/);
            if (at === -1 || root.getBoundingClientRect().width === 0) return 0;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const range = document.createRange();
            let count = 0;
            let started = false;
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const length = node.textContent?.length ?? 0;
              if (!started && at <= count + length) {
                range.setStart(node, at - count);
                started = true;
              }
              if (started && at + 40 <= count + length) {
                range.setEnd(node, at + 40 - count);
                const selection = document.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                return range.toString().length;
              }
              count += length;
            }
            return 0;
          }
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent ?? '';
            // A run of plain words, long enough to find again.
            const at = text.search(/[A-Za-z][A-Za-z ,']{40,}/);
            if (at === -1) continue;
            const rect = node.parentElement?.getBoundingClientRect();
            if (!rect || rect.width === 0 || rect.right < 0 || rect.left > window.innerWidth) continue;
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, Math.min(text.length, at + 40));
            const selection = document.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            return range.toString().length;
          }
          return 0;
        }, pdf)
        .catch(() => 0);
      if (chosen > 0) return chosen;
    }
    await page.waitForTimeout(1000);
  }
  return 0;
}

/** Highlights the chosen words in yellow, posted, and waits for it to be saved. */
async function highlightChosen(page) {
  await page.locator('[aria-label="Highlight the words you chose"]').first().waitFor({ timeout: 15000 });
  await press(page.getByRole('button', { name: 'Highlight in yellow' }).first());
  await page.waitForTimeout(4000);
}

/** Asks the database until a row is there (a save and its forum post can take seconds on the live site), up to 30 s. */
async function until(ask, test, seconds = 30) {
  let last = null;
  for (let waited = 0; waited < seconds; waited += 1) {
    last = await ask();
    if (test(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return last;
}

async function goTo(page, fraction) {
  await page.evaluate((to) => document.querySelector('foliate-view')?.goToFraction(to), fraction);
  await page.waitForTimeout(2500);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(3500);
}

async function openPanel(page) {
  await press(page.getByRole('button', { name: /HIGHLIGHTS/ }).first());
  await page.locator('aside[aria-label="HIGHLIGHTS"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
}

(async () => {
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const sessionA = await signInTestAccount('A');
  const sessionB = await signInTestAccount('B');
  if (sessionA.error || sessionB.error) throw new Error(sessionA.error || sessionB.error);
  const clean = async () => {
    const { data: mine } = await a.client.from('book_highlights').select('id, forum_comment_id').eq('person', a.id).in('book_ref', [EPUB, OWN]);
    for (const row of mine ?? []) {
      if (row.forum_comment_id) await a.client.from('forum_comments').delete().eq('id', row.forum_comment_id);
      await a.client.from('book_highlights').delete().eq('id', row.id);
    }
    await a.client.from('book_places').delete().eq('person', a.id).in('book_ref', [EPUB, OWN]);
    await a.client.from('forum_threads').delete().in('anchor_id', [`book:${a.id}:${WORK}`, `book:${a.id}:${OWN}`, `book:${a.id}:${EPUB}`]);
  };
  await clean();

  const one = await browser('a', sessionA);
  const two = await browser('b', sessionB);
  let three = null;
  try {
    // 1. A's own PDF: matched, highlighted, read on.
    await openPdf(one.page);
    if (await questionOrPage(one.page)) await press(asked(one.page).getByRole('button', { name: /START OVER/ }));
    await ready(one.page);
    await one.page.locator('[data-match]').waitFor({ timeout: 60000 });
    let line = (await one.page.locator('[data-match]').innerText()).replace(/\s+/g, ' ');
    let matchRow = (await a.client.from('book_places').select('work_ref').eq('person', a.id).eq('book_ref', OWN).maybeSingle()).data;
    console.log(`     the PDF's match: ${line.split('[')[0].trim()} (${matchRow?.work_ref ?? 'none saved'})`);
    if (matchRow?.work_ref !== WORK) {
      // Not the work Gutenberg's copy is: [ CHANGE ], search BOOKS, choose it.
      await press(one.page.getByRole('button', { name: /CHANGE|FIND IT/ }).first());
      const panel = one.page.locator('aside[aria-label="WHICH BOOK IS THIS?"]');
      await panel.locator('input').fill("Alice's Adventures in Wonderland Lewis Carroll");
      await press(panel.getByRole('button', { name: /SEARCH BOOKS/ }));
      await panel.locator(`li[data-work="${WORK}"]`).waitFor({ timeout: 30000 });
      await press(panel.locator(`li[data-work="${WORK}"] button`));
      await one.page.waitForTimeout(2000);
      matchRow = (await a.client.from('book_places').select('work_ref').eq('person', a.id).eq('book_ref', OWN).maybeSingle()).data;
      line = (await one.page.locator('[data-match]').innerText()).replace(/\s+/g, ' ');
      ok(matchRow?.work_ref === WORK, '[ CHANGE ] matches the file to the book', line.split('[')[0].trim());
    } else ok(true, 'the PDF is matched from the title and author inside it', line.split('[')[0].trim());
    ok(/^THIS IS: .+/.test(line), 'the match line reads THIS IS: <TITLE> BY <AUTHOR>', line.split('[')[0].trim());

    await goTo(one.page, 0.3);
    const pdfChosen = await chooseWords(one.page, { pdf: true });
    ok(pdfChosen > 0, 'words chosen on a PDF page', `${pdfChosen} characters`);
    await highlightChosen(one.page);
    const pdfHighlight = await until(
      async () => (await a.client.from('book_highlights').select('id, cfi, start_at, end_at, work_ref, forum_comment_id').eq('person', a.id).eq('book_ref', OWN)).data?.[0],
      (row) => Boolean(row?.forum_comment_id),
    );
    ok(Boolean(pdfHighlight), 'the PDF highlight is saved on the account');
    ok(pdfHighlight && /^epubcfi\(\/6\/\d+\)$/.test(pdfHighlight.cfi) && pdfHighlight.end_at > pdfHighlight.start_at, 'kept as its page and the characters within its words', pdfHighlight ? `${pdfHighlight.cfi}, ${pdfHighlight.start_at}-${pdfHighlight.end_at}` : '');
    ok(pdfHighlight?.work_ref === WORK, 'and counted as the book', pdfHighlight?.work_ref ?? 'no work');
    ok(Boolean(pdfHighlight?.forum_comment_id), 'and posted in the forum');
    const painted = await until(
      () => Promise.all(one.page.frames().map((frame) => frame.evaluate(() => (CSS.highlights ? CSS.highlights.size : 0)).catch(() => 0))),
      (counts) => counts.some((count) => count > 0),
      15,
    );
    ok(painted.some((count) => count > 0), 'it is painted on the PDF page');
    const pdfAt = await percentShown(one.page);

    // 2. Gutenberg's EPUB of the same book: the place from the PDF, the PDF's highlight, a highlight here.
    await one.page.goto(`${BASE}/read/${EPUB}`, { waitUntil: 'domcontentloaded' });
    await quiet(one.page);
    const question = await questionOrPage(one.page);
    const main = question ? (await asked(one.page).getByRole('button').first().innerText()).trim() : '';
    ok(main === `CONTINUE FROM ${pdfAt}% (READ IN ANOTHER COPY)`, 'the EPUB offers the place read in the PDF', main || 'no question');
    if (question) await press(asked(one.page).getByRole('button').first());
    await ready(one.page);
    await one.page.waitForTimeout(2500);
    const landed = await percentShown(one.page);
    ok(Math.abs(landed - pdfAt) <= 3, 'and opens about there', `${landed}% (the PDF was at ${pdfAt}%)`);
    await one.page.waitForTimeout(8000);
    await openPanel(one.page);
    const pdfRow = one.page.locator(`li[data-highlight="${pdfHighlight?.id}"]`);
    const pdfRowText = (await pdfRow.count()) ? (await pdfRow.innerText()).replace(/\s+/g, ' ') : '';
    ok((await pdfRow.count()) === 1, 'the PDF highlight is listed in the EPUB', /FROM ANOTHER COPY/.test(pdfRowText) ? (/FOUND/.test(pdfRowText) ? 'found by its words' : 'FROM ANOTHER COPY (its words not found here)') : 'listed');
    await press(one.page.getByRole('button', { name: /Close highlights/ }).first()).catch(() => undefined);
    await goTo(one.page, 0.5);
    const epubChosen = await chooseWords(one.page, { pdf: false });
    ok(epubChosen > 0, 'words chosen in the EPUB', `${epubChosen} characters`);
    await highlightChosen(one.page);
    const epubHighlight = await until(
      async () => (await a.client.from('book_highlights').select('id, work_ref, forum_comment_id').eq('person', a.id).eq('book_ref', EPUB)).data?.[0],
      (row) => Boolean(row?.forum_comment_id),
    );
    ok(epubHighlight?.work_ref === WORK && Boolean(epubHighlight?.forum_comment_id), 'the EPUB highlight is saved with the book and posted', epubHighlight?.work_ref ?? 'missing');

    // 3. One thread for both: A's posts for the two copies are in the same thread, the work's.
    const comments = (await a.client.from('forum_comments').select('id, thread_id').in('id', [pdfHighlight?.forum_comment_id, epubHighlight?.forum_comment_id].filter(Boolean))).data ?? [];
    const threads = new Set(comments.map((row) => row.thread_id));
    const thread = threads.size === 1 ? (await a.client.from('forum_threads').select('anchor_id, title').eq('id', [...threads][0]).maybeSingle()).data : null;
    ok(threads.size === 1 && thread?.anchor_id === `book:${a.id}:${WORK}`, 'both posts went to one thread, the book`s', thread ? `${thread.title} (${thread.anchor_id.split(':').slice(2).join(':')})` : `${threads.size} threads`);

    // 4. Back in the PDF: the EPUB's highlight is listed FROM ANOTHER COPY.
    await openPdf(one.page);
    if (await questionOrPage(one.page)) await press(asked(one.page).getByRole('button').first());
    await ready(one.page);
    await one.page.waitForTimeout(3000);
    await openPanel(one.page);
    const epubRow = one.page.locator(`li[data-highlight="${epubHighlight?.id}"]`);
    ok((await epubRow.getAttribute('data-from-another-copy').catch(() => null)) === 'true', 'in the PDF, the EPUB highlight is listed FROM ANOTHER COPY', (await epubRow.count()) ? (await epubRow.innerText()).split('\n')[0] : 'not listed');

    // 5. B sees both of A's public highlights in Gutenberg's EPUB.
    await two.page.goto(`${BASE}/read/${EPUB}`, { waitUntil: 'domcontentloaded' });
    await quiet(two.page);
    if (await questionOrPage(two.page)) await press(asked(two.page).getByRole('button', { name: /START OVER/ }));
    await ready(two.page);
    await two.page.waitForTimeout(8000);
    await openPanel(two.page);
    for (const [name, id] of [
      ['the PDF', pdfHighlight?.id],
      ['the EPUB', epubHighlight?.id],
    ]) {
      const row = two.page.locator(`li[data-highlight="${id}"]`);
      const text = (await row.count()) ? (await row.innerText()).split('\n')[0] : '';
      ok((await row.count()) === 1 && /A READER'S/.test(text), `B sees A's highlight from ${name}`, text);
    }

    // 6. A second device finds the same match, from the account.
    three = await browser('a2', sessionA);
    await openPdf(three.page);
    const again = await questionOrPage(three.page);
    const againMain = again ? (await asked(three.page).getByRole('button').first().innerText()).trim() : '';
    ok(/^CONTINUE FROM \d+%$/.test(againMain), 'the second device asks to continue the PDF', againMain || 'no question');
    if (again) await press(asked(three.page).getByRole('button').first());
    await ready(three.page);
    await three.page.locator('[data-match]').waitFor({ timeout: 60000 });
    const lineThere = (await three.page.locator('[data-match]').innerText()).replace(/\s+/g, ' ').split('[')[0].trim();
    ok(lineThere === line.split('[')[0].trim(), 'and shows the same match', lineThere);

    const carrying = [...one.sent, ...two.sent, ...(three?.sent ?? [])].filter((request) => request.carries || request.size >= PDF.length);
    ok(carrying.length === 0, 'no request carried the PDF', carrying.map((request) => request.url).join(', '));
  } finally {
    await clean();
    await a.client.auth.signOut({ scope: 'local' });
    await b.client.auth.signOut({ scope: 'local' });
    await close(one);
    await close(two);
    if (three) await close(three);
  }
  console.log(failures === 0 ? '\nBOOK COPIES DRIVE PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
