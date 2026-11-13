/*
 * Keeping your place in every book (SPEC-reading-places.md, Luke 2026-11-13), driven in real browsers against a running site
 * (live books from Gutenberg and the Internet Archive, so not in `npm run checks`):
 *   node scripts/drive-reading-places.cjs [--base http://localhost:3000] [--visitor] [--only gutenberg,pdf,...] [--shots]
 *
 * Signed in as TEST ACCOUNT A in two browsers with separate profiles (the desktop and the laptop stand-ins):
 * - for each kind (a Gutenberg book, an Archive EPUB, an Archive PDF read in slices, a scanned Archive book's page pictures,
 *   your own PDF), browser one opens it, goes to about 40%, and waits for the save; browser two opens it, sees
 *   `CONTINUE FROM n%`, presses it, and lands at that percent; /read in browser two lists it in CONTINUE READING at n%.
 *   Your own file goes back as /read?file=<fingerprint>, chosen again; no request either browser sends carries its bytes.
 * - finishing a short Gutenberg book moves it to READ; [ NOT FINISHED ] moves it back.
 * - pictures of /read at desktop and phone width (Temp/browse/reading-places-*.png); no sideways scroll on a phone.
 * `--visitor` does the same in one signed-out browser (the places live in that browser), and needs no database change.
 * A's places for these books are deleted at the start and the end. The own file is made up here: pages that say
 * "DEBASER TEST PAGE n", never a real book's text.
 */
const path = require('node:path');
const fs = require('node:fs');
const { open, close, capture, installSession, signInTestAccount, testAccountClient } = require('./browser.cjs');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const BASE = value('--base', 'http://localhost:3000').replace(/\/$/, '');
const VISITOR = flag('--visitor');
const ONLY = value('--only', '').split(',').filter(Boolean);
const OUT = path.join(__dirname, '..', 'Temp', 'browse');
fs.mkdirSync(OUT, { recursive: true });

const KINDS = [
  { key: 'gutenberg', ref: 'books:OL85892W-pg345', label: 'a Gutenberg EPUB' },
  { key: 'archive-epub', ref: 'internet_archive:einbeitragzurfes00stei', label: 'an Internet Archive EPUB' },
  { key: 'archive-pdf', ref: 'internet_archive:ktp2019-bskn4275', label: 'an Internet Archive PDF, read in slices', fixed: true },
  { key: 'pictures', ref: 'internet_archive:manwomanortempl00dumagoog', label: "a scanned Archive book's page pictures", fixed: true },
  { key: 'own', ref: null, label: 'your own PDF', fixed: true },
].filter((kind) => ONLY.length === 0 || ONLY.includes(kind.key));
const SHORT_BOOK = 'books:OL46170130W-pg7256';

let failures = 0;
function ok(condition, message, detail = '') {
  if (!condition) failures += 1;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}${detail ? ` :: ${detail}` : ''}`);
}

// ---------- a made-up PDF: twelve pages that say "DEBASER TEST PAGE n" ----------

const MARK = 'DEBASERTESTBYTES';
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
  const info = add(`<< /Title (DEBASER TEST FILE) /Subject (${MARK}) >>`);
  // A comment of padding, so the file is larger than any request the site itself sends (a size test as well as a bytes one).
  let out = `%PDF-1.4\n%${MARK}${'.'.repeat(200_000)}\n`;
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
const PDF = testPdf();
const PDF_PATH = path.join(OUT, 'reading-places-test.pdf');
fs.writeFileSync(PDF_PATH, PDF);
const OWN_HASH = require('node:crypto').createHash('sha256').update(PDF).digest('hex');
const OWN_REF = `own:${OWN_HASH}`;

// ---------- the browsers ----------

async function browser(tag, session) {
  const opened = await open({ size: [1440, 1000], profile: path.join(OUT, `reading-profile-${tag}`) });
  if (session) await installSession(opened.page, session);
  const sent = [];
  opened.page.on('request', (request) => {
    const body = request.postDataBuffer();
    sent.push({ url: request.url(), size: body ? body.length : 0, carries: body ? body.includes(MARK) || body.includes(PDF.subarray(0, 64)) || body.includes('.'.repeat(4096)) : false });
  });
  return { ...opened, sent, tag };
}

/** The lost-account question pops up for a browser that once held a session; close it if so. */
async function quiet(page) {
  const never = page.getByRole('button', { name: /NOT NOW/ });
  if (await never.count()) await never.first().evaluate((element) => element.click()).catch(() => undefined);
}

const ready = (page) => page.locator('footer input[type="range"]:not([disabled])').waitFor({ timeout: 120000 });
const percentShown = async (page) => Number((await page.locator('[data-reader-percent]').innerText()).replace('%', '').trim());
const asked = (page) => page.getByRole('dialog', { name: 'Where to open the book' });

/** Opens a kind in this browser: its address, or for your own file /read (or /read?file=) and the file chosen. */
async function openKind(page, kind, { again = false } = {}) {
  if (kind.ref) {
    await page.goto(`${BASE}/read/${kind.ref}`, { waitUntil: 'domcontentloaded' });
  } else {
    await page.goto(`${BASE}/read${again ? `?file=${OWN_HASH}` : ''}`, { waitUntil: 'domcontentloaded' });
    // The shelf has read its list once the page is live, so the file box listens by then.
    await page.locator('[data-shelf="reading"]').or(page.getByText('NOTHING STARTED YET')).first().waitFor({ timeout: 60000 });
    await quiet(page);
    await page.locator('input[type="file"]').first().setInputFiles(PDF_PATH);
  }
  await quiet(page);
}

/** Waits for the question or the page, whichever comes. */
async function questionOrPage(page) {
  await Promise.race([asked(page).waitFor({ timeout: 120000 }), ready(page)]);
  return (await asked(page).count()) > 0;
}

async function goTo(page, fraction) {
  await page.evaluate((to) => document.querySelector('foliate-view')?.goToFraction(to), fraction);
  await page.waitForTimeout(1200);
  // A turn after the jump, as a reader would, then the save's 1.5 s.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(3000);
}

async function placesOf(client, id) {
  const { data } = await client.from('book_places').select('book_ref, progress, finished_at, place, title').eq('person', id);
  return data ?? [];
}

(async () => {
  let a = null;
  let session = null;
  const refs = [...KINDS.map((kind) => kind.ref ?? OWN_REF), SHORT_BOOK];
  if (!VISITOR) {
    a = await testAccountClient('A');
    session = await signInTestAccount('A');
    if (session.error) throw new Error(session.error);
    await a.client.from('book_places').delete().eq('person', a.id).in('book_ref', refs);
  }
  const one = await browser('one', session);
  const two = VISITOR ? one : await browser('two', session);
  const seen = {};
  try {
    for (const kind of KINDS) {
      // Browser one reads to about 40%.
      await openKind(one.page, kind);
      if (await questionOrPage(one.page)) await asked(one.page).getByRole('button', { name: /START OVER/ }).evaluate((element) => element.click());
      await ready(one.page);
      await goTo(one.page, 0.38);
      const at = await percentShown(one.page);
      const left = (await one.page.locator('[data-reader-left]').innerText()).trim();
      seen[kind.key] = at;
      ok(at >= 25 && at <= 60, `${kind.label}: read to about 40% in browser ${one.tag}`, `${at}%${left ? ` · ${left}` : ''}`);
      if (kind.fixed) ok(/^PAGE \d+ OF \d+$/.test(left), `${kind.label}: the foot says PAGE n OF m`, left);
      if (!VISITOR) {
        const row = (await placesOf(a.client, a.id)).find((each) => each.book_ref === (kind.ref ?? OWN_REF));
        ok(row && Math.abs(row.progress - at) <= 1, `${kind.label}: the account holds ${at}%`, JSON.stringify(row ?? null));
        if (kind.fixed) ok(row && row.place > 0, `${kind.label}: and the page`, String(row?.place));
        if (!kind.ref) ok(row && row.title === 'DEBASER TEST FILE', 'your own file: the title from inside it, never its file name', row?.title);
      }

      // Browser two opens it: the question, then that place.
      await openKind(two.page, kind, { again: true });
      const question = await questionOrPage(two.page);
      const main = question ? (await asked(two.page).getByRole('button').first().innerText()).trim() : '';
      ok(question && main === `CONTINUE FROM ${at}%`, `${kind.label}: browser ${two.tag} asks CONTINUE FROM ${at}%`, main || 'no question');
      if (question) {
        await asked(two.page).getByRole('button').first().evaluate((element) => element.click());
        await ready(two.page);
        await two.page.waitForTimeout(1500);
        const landed = await percentShown(two.page);
        ok(Math.abs(landed - at) <= 2, `${kind.label}: and opens there`, `${landed}%`);
      }
    }

    // A ?at= link skips the question.
    if (KINDS.some((kind) => kind.key === 'gutenberg')) {
      await two.page.goto(`${BASE}/read/books:OL85892W-pg345?at=epubcfi(/6/10!/4/2/2)`, { waitUntil: 'domcontentloaded' });
      await ready(two.page);
      ok((await asked(two.page).count()) === 0, 'an ?at= link skips the question');
    }

    // /read lists them all at their percent.
    await two.page.goto(`${BASE}/read`, { waitUntil: 'domcontentloaded' });
    await two.page.locator('[data-shelf="reading"]').or(two.page.getByText('NOTHING STARTED YET')).first().waitFor({ timeout: 60000 });
    await quiet(two.page);
    for (const kind of KINDS) {
      const row = two.page.locator(`[data-shelf="reading"] li[data-book="${kind.ref ?? OWN_REF}"]`);
      const shown = (await row.count()) ? (await row.locator('[data-progress]').innerText()).trim() : 'not listed';
      ok(shown === `${seen[kind.key]}%`, `${kind.label}: CONTINUE READING shows ${seen[kind.key]}%`, shown);
      if (!kind.ref && (await row.count())) ok(/YOUR FILE/.test(await row.innerText()), 'your own file: its row says YOUR FILE');
    }

    // Finishing a short book moves it to READ; NOT FINISHED moves it back.
    await one.page.goto(`${BASE}/read/${SHORT_BOOK}`, { waitUntil: 'domcontentloaded' });
    await quiet(one.page);
    if (await questionOrPage(one.page)) await asked(one.page).getByRole('button', { name: /START OVER/ }).evaluate((element) => element.click());
    await ready(one.page);
    // Part way in (the story is the first 43% of the file: the rest is Gutenberg's licence), then page by page to its end.
    await goTo(one.page, 0.2);
    for (let turn = 0; turn < 120 && (await percentShown(one.page)) < 100; turn += 1) {
      await one.page.evaluate(() => document.querySelector('foliate-view')?.next());
      await one.page.waitForTimeout(300);
    }
    await one.page.waitForTimeout(3000);
    ok((await percentShown(one.page)) === 100, 'the short book reaches its last page', `${await percentShown(one.page)}%`);
    await two.page.goto(`${BASE}/read`, { waitUntil: 'domcontentloaded' });
    const finished = two.page.locator(`[data-shelf="read"] li[data-book="${SHORT_BOOK}"]`);
    await finished.waitFor({ timeout: 60000 }).catch(() => undefined);
    ok((await finished.count()) === 1, 'finishing it moves it to READ', (await finished.count()) ? (await finished.innerText()).replace(/\s+/g, ' ') : 'not on READ');
    ok((await two.page.locator(`[data-shelf="reading"] li[data-book="${SHORT_BOOK}"]`).count()) === 0, 'and out of CONTINUE READING');

    // Pictures from a fresh profile each, carrying this browser's places (a visitor) or the account's session.
    const kept = VISITOR
      ? await two.page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((key) => key.startsWith('debaser-reader-')).map((key) => [key, localStorage.getItem(key)])))
      : {};
    for (const [size, mobile, tag] of [
      [[1440, 1000], false, 'desktop'],
      [[390, 844], true, 'phone'],
    ]) {
      const shot = await open({ size, mobile, profile: path.join(OUT, 'reading-profile-shot') });
      if (session) await installSession(shot.page, session);
      await shot.page.addInitScript((entries) => {
        for (const [key, stored] of Object.entries(entries)) window.localStorage.setItem(key, stored);
      }, kept);
      await shot.page.goto(`${BASE}/read`, { waitUntil: 'domcontentloaded' });
      await shot.page.locator('[data-shelf="reading"]').waitFor({ timeout: 60000 }).catch(() => undefined);
      await quiet(shot.page);
      await shot.page.waitForTimeout(2500);
      const sideways = await shot.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(sideways <= 0, `/read at ${tag} width: no sideways scroll`, String(sideways));
      const theme = await shot.page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      console.log(`     /read at ${tag}: theme ${theme}`);
      await capture(shot.page, { out: path.join(OUT, `reading-places-${tag}${VISITOR ? '-visitor' : ''}.png`) });
      await close(shot);
    }

    await finished.getByRole('button', { name: /NOT FINISHED/ }).evaluate((element) => element.click()).catch(() => undefined);
    await two.page.waitForTimeout(2000);
    await two.page.reload({ waitUntil: 'domcontentloaded' });
    await two.page.locator('[data-shelf="reading"]').waitFor({ timeout: 60000 }).catch(() => undefined);
    ok((await two.page.locator(`[data-shelf="reading"] li[data-book="${SHORT_BOOK}"]`).count()) === 1, '[ NOT FINISHED ] puts it back in CONTINUE READING');

    // Your own file's bytes went nowhere.
    const carrying = [...one.sent, ...(VISITOR ? [] : two.sent)].filter((request) => request.carries || request.size >= PDF.length);
    ok(carrying.length === 0, 'no request carried the own file', carrying.map((request) => `${request.url} (${request.size} bytes)`).join(', '));
  } finally {
    if (a) {
      await a.client.from('book_places').delete().eq('person', a.id).in('book_ref', refs);
      await a.client.auth.signOut({ scope: 'local' });
    }
    await close(one);
    if (!VISITOR) await close(two);
  }
  console.log(failures === 0 ? '\nREADING PLACES DRIVE PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
