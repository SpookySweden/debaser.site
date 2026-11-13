/*
 * Drives DOCS in two real browsers (SPEC-live-docs.md, "How it's proven"). Not in `npm run checks`.
 *
 *   node scripts/drive-docs.cjs --base http://localhost:3217
 *   node scripts/drive-docs.cjs --base https://debaser-site.vercel.app
 *   (--minute counts a full minute of two people working for the realtime cost; --quick skips it)
 *
 * TEST ACCOUNT A and B sign in. A makes a document (ANYONE SIGNED IN) from the file browser; both open it.
 * Proven, each by what the other browser shows:
 *   - each sees the other's face (picture slot and name) at their typing spot, and the other's pointer moving;
 *   - a margin comment stays on its words while the other types in front of them;
 *   - a picture added by A shows for B;
 *   - HISTORY restores an earlier version, for both;
 *   - the realtime messages both browsers sent and heard in a minute of working together;
 *   - the same at phone width;
 *   - a lore page opens at /lore/<slug> and from DOCS > LORE, and its first save makes the one board post.
 * Everything it makes (two documents, one picture, one board post) is deleted at the end by A.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const zlib = require('node:zlib');
const { findChrome, installSession, signInTestAccount, testAccountClient } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3217');
const MINUTE = !args.includes('--quick');
const SHOTS = join('Temp', 'browse');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LORE_FOLDER_ID = '00000000-0000-4000-8000-00000000d0c1';
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

/** A small real PNG, made here: 40x30, two colours. */
function testPng() {
  const width = 40;
  const height = 30;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = [0];
    for (let x = 0; x < width; x += 1) row.push(...((x + y) % 2 === 0 ? [255, 0, 160] : [29, 60, 166]));
    rows.push(Buffer.from(row));
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function person(browser, letter, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error (${letter}): ${String(error).slice(0, 200)}`));
  const account = await signInTestAccount(letter);
  if (account.error) throw new Error(`sign-in ${letter}: ${account.error}`);
  await installSession(page, account);
  return page;
}

async function clearPrivacyWindow(page) {
  const close = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if ((await close.count()) > 0) await close.click().catch(() => undefined);
}

const editorOf = (page) => page.locator('.doc-document[contenteditable="true"]');

async function openDoc(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await clearPrivacyWindow(page);
  await editorOf(page).waitFor({ timeout: 45000 });
  await sleep(2500);
}

/** Moves the mouse across the document in steps, as a person would. */
async function wander(page, steps = 12) {
  const box = await editorOf(page).boundingBox();
  for (let step = 0; step < steps; step += 1) {
    await page.mouse.move(box.x + 20 + ((step * 37) % Math.max(40, box.width - 40)), box.y + 10 + ((step * 13) % Math.max(20, box.height - 20)));
    await sleep(60);
  }
}

async function pointerSpots(page, name) {
  return page.evaluate((who) => [...document.querySelectorAll(`.doc-pointer[data-pointer-of="${who}"]`)].map((el) => `${el.style.left},${el.style.top}`), name);
}

async function seesOthers(page, otherName, otherPage, label) {
  // Their caret: the other clicks into the text, and their face shows at that spot here.
  await editorOf(otherPage).click();
  await otherPage.keyboard.press('End');
  await page.waitForFunction(
    (who) => [...document.querySelectorAll('.collaboration-carets__caret .doc-face')].some((face) => face.textContent.includes(who)),
    otherName,
    { timeout: 15000 },
  );
  const face = await page.evaluate((who) => {
    const tag = [...document.querySelectorAll('.collaboration-carets__caret .doc-face')].find((el) => el.textContent.includes(who));
    const picture = tag.querySelector('.doc-face__picture');
    return { picture: picture !== null, drawn: picture?.querySelector('img') !== null, colour: tag.style.backgroundColor };
  }, otherName);
  assert.ok(face.picture, 'the caret wears a picture slot');
  pass(`${label}: ${otherName}'s face at their typing spot (picture ${face.drawn ? 'drawn' : 'slot: no profile picture on file'}, in their colour ${face.colour})`);

  // Their pointer, moving.
  await wander(otherPage, 6);
  await page.waitForFunction((who) => document.querySelector(`.doc-pointer[data-pointer-of="${who}"]`) !== null, otherName, { timeout: 10000 });
  const first = await pointerSpots(page, otherName);
  await wander(otherPage, 10);
  await sleep(600);
  const second = await pointerSpots(page, otherName);
  assert.notDeepEqual(first, second, 'the pointer moved');
  pass(`${label}: ${otherName}'s pointer moves (${first[0]} -> ${second[0]})`);
}

(async () => {
  const a = await testAccountClient('A');
  const cleanup = { docs: [], threads: [], pictures: [] };
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  try {
    const pageA = await person(browser, 'A', { width: 1440, height: 1000 });
    const pageB = await person(browser, 'B', { width: 1440, height: 1000 });

    // A makes a document from the file browser.
    await pageA.goto(`${BASE}/docs`, { waitUntil: 'domcontentloaded' });
    await clearPrivacyWindow(pageA);
    await pageA.getByRole('button', { name: '[ NEW DOC ]' }).click();
    const make = pageA.getByRole('dialog', { name: 'NEW DOC' });
    await make.locator('#doc-new-title').fill('Drive doc');
    await make.locator('select').selectOption('signed_in');
    await make.getByRole('button', { name: '[ MAKE ]' }).click();
    await pageA.waitForURL(/\/docs\/[0-9a-f-]{36}$/, { timeout: 20000 });
    const path = new URL(pageA.url()).pathname;
    const docId = path.split('/').pop();
    cleanup.docs.push(docId);
    pass(`A made a document from DOCS (${path})`);
    await editorOf(pageA).waitFor({ timeout: 30000 });
    await sleep(2000);

    await openDoc(pageB, path);
    await editorOf(pageA).click();
    await pageA.keyboard.type('The corridor is glass on one side and concrete on the other.');
    await pageB.waitForFunction(() => document.querySelector('.doc-document')?.textContent.includes('concrete on the other'), null, { timeout: 15000 });
    pass('what A types arrives in B');

    await seesOthers(pageB, 'TEST ACCOUNT A', pageA, 'B sees');
    await seesOthers(pageA, 'TEST ACCOUNT B', pageB, 'A sees');
    await pageA.mouse.move(700, 500);
    await pageB.screenshot({ path: join(SHOTS, 'docs-two-people-desktop-B.png') });
    await pageA.screenshot({ path: join(SHOTS, 'docs-two-people-desktop-A.png') });

    // A margin comment on "glass", then B types in front of it.
    await sleep(3200); // let the first save land, which keeps the first version
    const glass = await pageA.evaluate(() => {
      const editor = document.querySelector('.doc-document');
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent.indexOf('glass');
        if (at >= 0) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + 5);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        }
      }
      return false;
    });
    assert.ok(glass);
    await sleep(300);
    await pageA.getByRole('button', { name: '[ COMMENT ON THIS ]' }).click();
    await pageA.locator('#doc-comment-new').fill('Is it really glass?');
    await pageA.getByRole('button', { name: '[ COMMENT ]', exact: true }).click();
    await pageA.waitForSelector('.doc-commented', { timeout: 10000 });
    await editorOf(pageB).click();
    await pageB.keyboard.press('Control+Home');
    await pageB.keyboard.type('Written first: ');
    await sleep(1500);
    const shaded = await pageA.evaluate(() => [...document.querySelectorAll('.doc-commented')].map((el) => el.textContent).join(''));
    assert.equal(shaded, 'glass', 'the comment is still on its word after B typed in front of it');
    pass(`a margin comment stays on its words while B types in front of them (shaded: "${shaded}")`);
    await pageB.waitForSelector('[data-comment-card]', { timeout: 20000 });
    pass('B sees the margin comment');

    // A picture.
    await pageA.locator('input[type="file"][aria-label="Picture to add"]').setInputFiles({ name: 'drive.png', mimeType: 'image/png', buffer: testPng() });
    await pageA.waitForSelector('img.doc-picture', { timeout: 20000 });
    await pageB.waitForSelector('img.doc-picture', { timeout: 20000 });
    const src = await pageB.locator('img.doc-picture').first().getAttribute('src');
    assert.match(src, /\/storage\/v1\/object\/public\/doc-pictures\//);
    cleanup.pictures.push(src.split('/doc-pictures/')[1]);
    const loaded = await pageB.locator('img.doc-picture').first().evaluate((img) => img.complete && img.naturalWidth > 0);
    assert.ok(loaded, 'the picture loads');
    pass('a picture A added is filed and shows for B');

    // The minute: both working, then the counts.
    if (MINUTE) {
      const start = await Promise.all([pageA.evaluate(() => window.debaserDocStats?.()), pageB.evaluate(() => window.debaserDocStats?.())]);
      const until = Date.now() + 60_000;
      let round = 0;
      while (Date.now() < until) {
        round += 1;
        await wander(pageA, 8);
        await wander(pageB, 8);
        if (round % 4 === 0) {
          await editorOf(pageA).click();
          await pageA.keyboard.press('End');
          await pageA.keyboard.type(' more');
        }
      }
      const end = await Promise.all([pageA.evaluate(() => window.debaserDocStats?.()), pageB.evaluate(() => window.debaserDocStats?.())]);
      const sent = end[0].sent - start[0].sent + end[1].sent - start[1].sent;
      const heard = end[0].heard - start[0].heard + end[1].heard - start[1].heard;
      const pointers = end[0].pointersSent - start[0].pointersSent + end[1].pointersSent - start[1].pointersSent;
      console.log(`  REALTIME, ONE MINUTE, TWO PEOPLE: ${sent} messages sent (${pointers} of them pointers), ${heard} heard`);
      pass('the realtime cost of a minute is counted');
    }

    // HISTORY: restore the first kept version.
    await sleep(3000);
    await pageA.getByRole('button', { name: '[ HISTORY ]' }).click();
    const history = pageA.getByRole('dialog', { name: 'HISTORY' });
    await history.getByRole('button', { name: '[ VIEW ]' }).last().click();
    await history.getByRole('button', { name: '[ RESTORE ]' }).click();
    await sleep(2000);
    const restored = await pageB.evaluate(() => document.querySelector('.doc-document').textContent);
    assert.ok(restored.startsWith('The corridor is glass'), `B sees the restored version: "${restored.slice(0, 60)}"`);
    assert.ok(!restored.includes('Written first'), 'without what came after it');
    pass('HISTORY restores an earlier version, and B sees it at once');

    // Phone width.
    await pageB.setViewportSize({ width: 390, height: 844 });
    await pageA.setViewportSize({ width: 390, height: 844 });
    await sleep(1000);
    await seesOthers(pageB, 'TEST ACCOUNT A', pageA, 'B sees, phone width');
    await pageA.mouse.move(200, 400);
    await pageB.screenshot({ path: join(SHOTS, 'docs-two-people-phone-B.png'), fullPage: false });
    const sideways = await pageB.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(sideways, false, 'no sideways scroll at phone width');
    pass('phone width: no sideways scroll');
    await pageA.setViewportSize({ width: 1440, height: 1000 });
    await pageB.setViewportSize({ width: 1440, height: 1000 });

    // A lore page: both addresses, and its first save posts to the board.
    await pageA.goto(`${BASE}/lore`, { waitUntil: 'domcontentloaded' });
    await clearPrivacyWindow(pageA);
    await pageA.getByRole('button', { name: '[ NEW PAGE ]' }).click();
    const lore = pageA.getByRole('dialog', { name: 'NEW LORE PAGE' });
    await lore.locator('#doc-new-title').fill('Drive lore page');
    await lore.getByRole('button', { name: '[ MAKE ]' }).click();
    await pageA.waitForURL(/\/lore\/drive-lore-page$/, { timeout: 20000 });
    await editorOf(pageA).waitFor({ timeout: 30000 });
    const loreRow = await a.client.from('docs').select('id, access, folder_id').eq('slug', 'drive-lore-page').single();
    cleanup.docs.push(loreRow.data.id);
    assert.equal(loreRow.data.access, 'public');
    assert.equal(loreRow.data.folder_id, LORE_FOLDER_ID);
    await sleep(2000);
    await editorOf(pageA).click();
    await pageA.keyboard.type('Hexham was drawn as a grid of nine blocks.');
    await sleep(4500);
    const posted = await a.client.from('docs').select('board_thread_id').eq('id', loreRow.data.id).single();
    assert.notEqual(posted.data.board_thread_id, null, 'the first save made the board post');
    cleanup.threads.push(posted.data.board_thread_id);
    const thread = await a.client.from('forum_threads').select('title, body').eq('id', posted.data.board_thread_id).single();
    assert.equal(thread.data.title, 'NEW DOC :: DRIVE LORE PAGE');
    assert.match(thread.data.body, /Hexham was drawn[\s\S]*\/lore\/drive-lore-page$/);
    pass('a PUBLIC lore page\'s first save makes one board post with its title and first lines');

    await pageB.goto(`${BASE}/docs?folder=${LORE_FOLDER_ID}`, { waitUntil: 'domcontentloaded' });
    await pageB.getByRole('link', { name: 'DRIVE LORE PAGE' }).click();
    await pageB.waitForURL(/\/lore\/drive-lore-page$/);
    await pageB.waitForFunction(() => document.querySelector('.doc-document')?.textContent.includes('nine blocks'), null, { timeout: 20000 });
    pass('the lore page opens from DOCS > LORE, at its /lore address, with its writing');
    await pageB.screenshot({ path: join(SHOTS, 'docs-lore-from-docs.png') });

    await pageB.goto(`${BASE}/docs`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    await pageB.screenshot({ path: join(SHOTS, 'docs-browser-desktop.png') });
  } finally {
    for (const threadId of cleanup.threads) await a.client.from('forum_threads').delete().eq('id', threadId);
    if (cleanup.pictures.length > 0) await a.client.storage.from('doc-pictures').remove(cleanup.pictures);
    for (const id of cleanup.docs) await a.client.from('docs').delete().eq('id', id);
    console.log(`cleaned up: ${cleanup.docs.length} documents, ${cleanup.threads.length} board post, ${cleanup.pictures.length} picture`);
    await browser.close();
  }

  console.log(`drive-docs: ${passed} passed`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
