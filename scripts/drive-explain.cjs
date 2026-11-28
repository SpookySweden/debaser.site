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
const { crc32 } = require('node:zlib');
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

/**
 * A tiny EPUB made here, for the READER step: three chapters of plain test sentences, zipped with no compression (the
 * `mimetype` entry first, as an EPUB asks). Nothing is read from disk or the network, so the drive needs no book file.
 */
function tinyEpub() {
  const lines = (chapter) =>
    Array.from({ length: 60 }, (_, index) => `<p>Chapter ${chapter}, paragraph ${index + 1}: plain words in the test book of the EXPLAIN drive, long enough to fill a line or two of the page.</p>`).join('');
  const chapter = (number) =>
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${number}</title></head><body><h1>Chapter ${number}</h1>${lines(number)}</body></html>`;
  const files = [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    [
      'book.opf',
      '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">explain-drive-test-book</dc:identifier><dc:title>Zzqx Explain Drive Test Book</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-11-27T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine></package>',
    ],
    [
      'nav.xhtml',
      '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Chapter 1</a></li><li><a href="c2.xhtml">Chapter 2</a></li><li><a href="c3.xhtml">Chapter 3</a></li></ol></nav></body></html>',
    ],
    ['c1.xhtml', chapter(1)],
    ['c2.xhtml', chapter(2)],
    ['c3.xhtml', chapter(3)],
  ];
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

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
  // The character workbench is three.js (`ssr: false`): a headless browser only has WebGL with the software renderer.
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=swiftshader'] });
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
    // A page still waking up misses a hover: no box is tried again, twice, before it counts.
    let words = null;
    for (let tries = 0; tries < 3 && words === null; tries += 1) {
      await page.mouse.move(700, 900);
      await sleep(tries === 0 ? 300 : 2000);
      await locator.hover();
      await sleep(800);
      words = await boxText(page);
    }
    return words;
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

  // The reader (EXPLAIN-READER, 2026-11-27): the READ page, a file of your own (a tiny EPUB made above, never a real book),
  // and the open book's keys. Open Library is answered here with "nothing found", so no request leaves this machine.
  console.log('THE READER: THE READ PAGE, A FILE OF YOUR OWN AND THE OPEN BOOK');
  let library = 0;
  await context.route(/openlibrary\.org\//, (route) => {
    library += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ numFound: 0, docs: [] }) });
  });
  await page.goto(`${BASE}/read`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  const drop = page.locator('[data-own-drop]');
  await drop.waitFor({ timeout: 240000 });
  await sleep(2000);
  const said = (words, ...parts) => words !== null && parts.every((part) => words.includes(part));
  const chooseWords = await sayOf(drop.locator('label', { hasText: 'CHOOSE A FILE' }));
  check(said(chooseWords, 'file chooser', 'never uploaded'), 'CHOOSE A FILE explains itself', chooseWords ?? 'none');
  const keepWords = await sayOf(drop.locator('label', { hasText: 'KEEP IT ON THIS DEVICE' }));
  check(said(keepWords, 'YOUR FILES', 'never sent anywhere'), 'the KEEP IT ON THIS DEVICE tick explains itself', keepWords ?? 'none');
  const mediaLink = page.locator('a', { hasText: 'FIND A BOOK IN MEDIA' });
  if ((await mediaLink.count()) > 0) {
    const mediaWords = await sayOf(mediaLink.first());
    check(said(mediaWords, 'Opens the MEDIA page'), "the empty shelf's FIND A BOOK IN MEDIA explains itself", mediaWords ?? 'none');
  }
  await page.locator('[data-own-input]').first().setInputFiles({ name: 'zzqx-explain-drive-test-book.epub', mimeType: 'application/epub+zip', buffer: tinyEpub() });
  const card = page.locator('[data-own-card]');
  await card.waitFor({ timeout: 60000 });
  const cardRead = card.locator('[data-own-read]:not([disabled])');
  await cardRead.waitFor({ timeout: 60000 });
  const cardReadWords = await sayOf(cardRead);
  check(said(cardReadWords, 'Opens this file in the reader'), "the file card's READ explains itself", cardReadWords ?? 'none');
  const findItWords = await sayOf(card.locator('button', { hasText: 'FIND IT' }));
  check(said(findItWords, 'say by hand which book this file is'), "the file card's FIND IT explains itself", findItWords ?? 'none');
  const notListedWords = await sayOf(card.locator('button', { hasText: 'NOT LISTED' }));
  check(said(notListedWords, 'none of the books in the catalogue'), "the file card's NOT LISTED explains itself", notListedWords ?? 'none');
  const anotherWords = await sayOf(card.locator('button', { hasText: 'ANOTHER FILE' }));
  check(said(anotherWords, 'shows the drop box again'), "the file card's ANOTHER FILE explains itself", anotherWords ?? 'none');
  await page.screenshot({ path: join(OUT, 'dark-reader-card.png') });
  await cardRead.click();
  const readerKeys = page.locator('nav[aria-label="The reader\'s keys"]');
  const lookKey = readerKeys.locator('button:not([disabled])', { hasText: 'LOOK' });
  await lookKey.waitFor({ timeout: 120000 });
  await sleep(1500);
  const contentsWords = await sayOf(readerKeys.locator('button', { hasText: 'CONTENTS' }));
  check(said(contentsWords, 'list of chapters'), "the open book's CONTENTS explains itself", contentsWords ?? 'none');
  const highlightsWords = await sayOf(readerKeys.locator('button', { hasText: 'HIGHLIGHTS' }));
  check(said(highlightsWords, 'list of highlights in this book'), "the open book's HIGHLIGHTS explains itself", highlightsWords ?? 'none');
  const focusWords = await sayOf(readerKeys.locator('button', { hasText: 'FOCUS' }));
  check(said(focusWords, 'Fills the whole window with the book'), 'FOCUS explains itself', focusWords ?? 'none');
  const backWords = await sayOf(page.locator('header button', { hasText: 'BACK' }).first());
  check(said(backWords, 'Leaves the reader', 'saved a second or two after each page turn'), 'BACK explains itself', backWords ?? 'none');
  const forwardWords = await sayOf(page.locator('button[aria-label="Page forward"]'));
  check(said(forwardWords, 'Turns forward one page', 'FINISHED'), 'the page-forward key explains itself', forwardWords ?? 'none');
  const sliderWords = await sayOf(page.locator('label', { has: page.locator('[data-reader-percent]') }));
  check(said(sliderWords, 'how far through the book you are'), 'the progress bar explains itself', sliderWords ?? 'none');
  // The book's own page shows no box (Luke, 2026-11-28: "No box on the page (Recommended)"), so nothing covers the text:
  // resting on it opens nothing, and moving onto it from a key puts that key's box away.
  const book = page.locator('[role="document"][aria-label="The book"]');
  const bookWords = await sayOf(book);
  check(bookWords === null, 'resting on the page of the book shows no box', bookWords ?? 'none');
  await page.screenshot({ path: join(OUT, 'dark-reader-book.png') });
  await sayOf(page.locator('button[aria-label="Page forward"]'));
  await book.hover({ position: { x: 200, y: 200 } });
  await sleep(900);
  const afterKey = await boxText(page);
  check(afterKey === null, "from a key onto the page: the key's box goes and none opens", afterKey ?? 'none');
  await lookKey.click();
  const lookPanel = page.locator('aside[aria-label="LOOK"]');
  const bigger = lookPanel.locator('button[aria-label="text size bigger"]');
  await bigger.waitFor({ timeout: 15000 });
  const biggerWords = await sayOf(bigger);
  check(said(biggerWords, "Makes the book's text one step bigger", 'Kept for every book'), "LOOK's text-size key explains itself", biggerWords ?? 'none');
  const verseWords = await sayOf(lookPanel.locator('button', { hasText: 'VERSE' }).first());
  check(said(verseWords, 'lines that must not be rejoined'), "LOOK's VERSE layout explains itself", verseWords ?? 'none');
  await page.screenshot({ path: join(OUT, 'dark-reader-look.png') });
  console.log(`  (Open Library was answered here, never asked: ${library} request${library === 1 ? '' : 's'} caught)`);

  // Letters (EXPLAIN-REST-1, 2026-11-28): a letter made here on the mock, its window, its settings and one thing on it.
  console.log('LETTERS: A LETTER, ITS SETTINGS AND A THING ON IT');
  await page.goto(`${BASE}/profile/${ME.id}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  const newLetter = page.locator('[data-new-letter-key]');
  await newLetter.waitFor({ timeout: 240000 });
  await sleep(1500);
  await newLetter.click();
  await page.locator('#new-letter-name').fill('ZZQX EXPLAIN LETTER');
  await page.keyboard.press('Enter');
  const letter = page.locator('[data-dock-window="letter"]');
  await letter.waitFor({ timeout: 60000 });
  await sleep(1500);
  const sendToWords = await sayOf(letter.locator('button', { hasText: 'SEND TO' }));
  check(said(sendToWords, 'send this whole letter', 'Greyed out while the letter is empty'), "the letter's SEND TO explains itself, greyed out or not", sendToWords ?? 'none');
  const lockWords = await sayOf(letter.locator('button', { hasText: 'PRIVATE' }).or(letter.locator('button', { hasText: 'PUBLIC' })).first());
  check(said(lockWords, 'Makes this letter'), "the letter's lock explains itself", lockWords ?? 'none');
  await letter.locator('input[aria-label="Link address"]').fill('https://example.com/zzqx');
  const addLinkWords = await sayOf(letter.locator('button', { hasText: 'ADD LINK' }));
  check(said(addLinkWords, 'link card'), '+ ADD LINK explains itself', addLinkWords ?? 'none');
  await letter.locator('button', { hasText: 'ADD LINK' }).click();
  const thing = letter.locator('button[aria-label$="Open its details."]').first();
  await thing.waitFor({ timeout: 30000 });
  const thingWords = await sayOf(thing);
  check(said(thingWords, "Opens this thing's details"), 'a card on the letter explains itself', thingWords ?? 'none');
  await thing.click();
  const takeOut = page.locator('button', { hasText: 'TAKE OUT' });
  await takeOut.waitFor({ timeout: 30000 });
  const takeOutWords = await sayOf(takeOut);
  check(said(takeOutWords, 'Takes this thing off the letter', 'NO QUESTION IS ASKED'), 'TAKE OUT explains itself, with its caution', takeOutWords ?? 'none');
  await page.keyboard.press('Escape');
  await takeOut.waitFor({ state: 'detached', timeout: 15000 });
  await letter.locator('button[aria-label="Letter settings"]').click();
  const deleteLetter = page.locator('button', { hasText: 'DELETE LETTER' });
  await deleteLetter.waitFor({ timeout: 30000 });
  const densityWords = await sayOf(page.locator('label', { hasText: 'DENSITY' }));
  check(said(densityWords, 'how many times the stamp picture repeats'), 'the DENSITY slider explains itself', densityWords ?? 'none');
  const deleteLetterWords = await sayOf(deleteLetter);
  check(said(deleteLetterWords, 'Asks whether to delete this letter'), 'DELETE LETTER explains itself', deleteLetterWords ?? 'none');
  await page.screenshot({ path: join(OUT, 'dark-letter-settings.png') });

  // Docs (EXPLAIN-REST-1): the front page's one line of keys, a new document, its toolbar, SHARE and HISTORY.
  console.log('DOCS: THE FRONT PAGE, A NEW DOCUMENT, SHARE AND HISTORY');
  await page.goto(`${BASE}/docs`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  const newDoc = page.locator('button[aria-label="New document"]');
  await newDoc.waitFor({ timeout: 240000 });
  await sleep(1500);
  const mineWords = await sayOf(page.locator('nav[aria-label="Where to look"] a', { hasText: 'MINE' }));
  check(said(mineWords, 'your own documents'), "DOCS' MINE explains itself", mineWords ?? 'none');
  const newDocWords = await sayOf(newDoc);
  check(said(newDocWords, 'name and make a new document'), "DOCS' + NEW explains itself", newDocWords ?? 'none');
  await newDoc.click();
  await page.locator('#doc-new-title').fill('ZZQX EXPLAIN DOCUMENT');
  const createWords = await sayOf(page.locator('button[type="submit"]', { hasText: 'CREATE' }));
  check(said(createWords, 'Makes the document and opens it'), 'CREATE explains itself', createWords ?? 'none');
  await page.locator('button[type="submit"]', { hasText: 'CREATE' }).click();
  const tools = page.locator('[role="toolbar"][aria-label="Writing tools"]');
  await tools.waitFor({ timeout: 240000 });
  await sleep(1500);
  const boldWords = await sayOf(tools.locator('button', { hasText: 'BOLD' }));
  check(said(boldWords, 'selected words bold'), "the editor's BOLD explains itself", boldWords ?? 'none');
  const commentsWords = await sayOf(page.locator('button', { hasText: 'COMMENTS' }).first());
  check(said(commentsWords, 'comments panel'), 'COMMENTS explains itself', commentsWords ?? 'none');
  const deleteDocWords = await sayOf(page.locator('button', { hasText: 'DELETE THIS DOCUMENT' }));
  check(said(deleteDocWords, 'Asks whether to delete this document', 'ASKS YOU FIRST'), 'DELETE THIS DOCUMENT explains itself', deleteDocWords ?? 'none');
  await page.locator('button', { hasText: '[ SHARE ]' }).click();
  const everyone = page.locator('label', { has: page.locator('input[name="doc-access"][value="public"]') });
  await everyone.waitFor({ timeout: 30000 });
  const everyoneWords = await sayOf(everyone);
  check(said(everyoneWords, 'anyone at all can read it'), "SHARE's EVERYONE row explains itself", everyoneWords ?? 'none');
  await page.screenshot({ path: join(OUT, 'dark-doc-share.png') });
  await page.keyboard.press('Escape');
  await everyone.waitFor({ state: 'detached', timeout: 15000 });
  await page.locator('button', { hasText: '[ HISTORY ]' }).last().click();
  const keepVersion = page.locator('button', { hasText: '[ KEEP ]' });
  await keepVersion.waitFor({ timeout: 30000 });
  const keepVersionWords = await sayOf(keepVersion);
  check(said(keepVersionWords, 'Keeps a copy of the document'), "HISTORY's KEEP explains itself", keepVersionWords ?? 'none');
  await page.keyboard.press('Escape');

  // Lore (EXPLAIN-REST-1): the shelf, the project's strip and the link shelf.
  console.log('LORE: THE SHELF, THE PROJECT STRIP AND THE LINK SHELF');
  await page.goto(`${BASE}/lore`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  const newPage = page.locator('button', { hasText: '[ NEW PAGE ]' });
  await newPage.waitFor({ timeout: 240000 });
  await sleep(1500);
  const newPageWords = await sayOf(newPage);
  check(said(newPageWords, 'new lore page', 'OTHER PEOPLE SEE THIS'), "LORE's NEW PAGE explains itself", newPageWords ?? 'none');
  const inDocsWords = await sayOf(page.locator('a', { hasText: '[ IN DOCS ]' }));
  check(said(inDocsWords, 'LORE folder'), 'IN DOCS explains itself', inDocsWords ?? 'none');
  const notesChipWords = await sayOf(page.locator('a', { hasText: '[ NOTES ]' }).first());
  check(said(notesChipWords, "project's NOTES shelf"), "the project strip's NOTES explains itself", notesChipWords ?? 'none');
  await page.screenshot({ path: join(OUT, 'dark-lore.png') });
  await page.goto(`${BASE}/links`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  // The shelf's own list: the words are in the served page, but the box needs the page awake.
  const boardLink = page.locator('li a', { hasText: 'MESSAGE BOARD' }).first();
  await boardLink.waitFor({ timeout: 240000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await sleep(2500);
  const boardLinkWords = await sayOf(boardLink);
  check(said(boardLinkWords, 'MESSAGE BOARD page'), 'a link on the link shelf explains itself', boardLinkWords ?? 'none');

  // EXPLAIN-REST-2 (2026-11-28): the comic, the character workbench, animate and beatbox. One area failing to be reached is
  // counted as a failure and the next area still runs, so a run on old code lists every area.
  const area = async (name, run) => {
    console.log(name);
    try {
      await run();
    } catch (error) {
      check(false, `${name}: the step did not finish`, String(error.message).split('\n')[0]);
    }
  };
  const arrive = async (path, ready) => {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await ready.waitFor({ timeout: 240000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await sleep(2000);
  };
  const hoverSays = async (what, locator, ...parts) => {
    let words = null;
    try {
      await locator.first().waitFor({ timeout: 20000 });
      words = await sayOf(locator.first());
    } catch (error) {
      words = null;
    }
    check(said(words, ...parts), what, words ?? 'none');
  };
  const key = (words, within = page) => within.locator('button, a', { hasText: words });

  await area('COMIC: THE CONTENTS, A CHAPTER AND THE STUDIO', async () => {
    // The mock moderator is this drive's person, so the studio opens.
    await page.evaluate((id) => window.localStorage.setItem('debaser.moderation.mock.v1', JSON.stringify({ moderators: [{ id, owner: true, addedAt: new Date().toISOString() }] })), ME.id);
    await arrive('/comic', key('[ STUDIO ]').first());
    await hoverSays('the contents page: FOLLOW explains itself', key('FOLLOW'), 'new pages', 'bell');
    await hoverSays('STUDIO explains itself', key('[ STUDIO ]'), 'comic studio');
    await arrive('/comic/1', key('[ COMMENTS ]').first());
    await hoverSays("a chapter's COMMENTS explains itself", key('[ COMMENTS ]'), 'comments on the panels');
    await hoverSays("a page's ZOOM explains itself", key('[ ZOOM ]'), 'on its own');
    await arrive('/comic/studio', key('[ ADD PAGES ]').first());
    await hoverSays("the studio's PANELS tab explains itself", key('[ PANELS ]'), 'panel boxes');
    await hoverSays('ADD PAGES explains itself', key('[ ADD PAGES ]'), 'file chooser', 'QUEUED');
    await hoverSays("a page's SPREAD explains itself", key('[ SPREAD ]'), 'spread');
    await hoverSays("a page's DELETE explains itself, with its caution", page.locator('li button', { hasText: '[ DELETE ]' }).last(), 'Asks whether to delete', 'ASKS YOU FIRST');
    await key('[ RELEASE ]').first().click();
    await hoverSays('RELEASE tab: TICK ALL explains itself', key('[ TICK ALL ]'), 'Ticks every page');
    await page.screenshot({ path: join(OUT, 'dark-comic-studio.png') });
  });

  await area('THE CHARACTER WORKBENCH (three.js, drawn in the browser only)', async () => {
    await arrive('/account', page.locator('button', { hasText: '[ EDIT PROFILE ]' }).first());
    await page.locator('button', { hasText: '[ EDIT PROFILE ]' }).first().click();
    await page.locator('button', { hasText: '[ CHAR' }).first().click();
    const tool = (name) => page.locator('button', { hasText: name });
    const shelf = page.locator('button', { hasText: '[ SAVED CHARACTERS ]' }).first();
    await shelf.waitFor({ timeout: 120000 });
    await page.locator('canvas').first().waitFor({ timeout: 120000 });
    await sleep(3000);
    await hoverSays("the workbench's SELECT explains itself", tool('SELECT'), 'Takes up the SELECT tool');
    await hoverSays('its ADD explains itself', page.locator('button[aria-expanded]', { hasText: 'ADD' }), 'list of shapes');
    await hoverSays('its UNDO explains itself, greyed out or not', tool('UNDO'), 'Takes back the last change');
    await hoverSays('the PIXELATE layer switch explains itself', tool('PIXELATE'), 'big pixels');
    await hoverSays('the light key explains itself', page.locator('button[aria-label="Light"]'), 'light controls');
    await tool('NEW').first().click();
    await hoverSays("the figure picker's START explains itself", tool('[ START ]'), 'chosen starting figure', 'UNDO');
    await page.locator('button[aria-label="Close the figure picker"]').click();
    await hoverSays('SAVED CHARACTERS explains itself', shelf, 'saved characters');
    await shelf.click();
    await hoverSays("the shelf's SAVE explains itself", page.locator('button', { hasText: '[ SAVE ]' }).last(), 'figure on the bench');
    await page.screenshot({ path: join(OUT, 'dark-workbench.png') });
  });

  await area('ANIMATE: THE BARS, THE LAYERS, THE MENU AND THE TIMELINE MENU', async () => {
    await arrive('/animate', page.locator('[data-animate-menu-key]').first());
    await hoverSays("animate's FRAMES explains itself", page.locator('[data-animate-frames-key]'), 'timeline menu');
    await hoverSays('TOOLS explains itself', page.locator('[data-animate-tools-key]'), 'tool pop-up');
    const layers = page.locator('[data-animate-layers-key]').first();
    if ((await layers.getAttribute('aria-pressed')) !== 'true') await layers.click();
    await hoverSays('+ LAYER explains itself', key('[ + LAYER ]'), 'new empty layer');
    await page.locator('[data-animate-tools-key]').first().click();
    await hoverSays('a tool in the pop-up explains itself', page.locator('[data-animate-tile="ERASER"]'), 'eraser');
    await page.keyboard.press('Escape');
    await page.locator('[data-animate-frames-key]').first().click();
    await hoverSays("the timeline menu's COPY IT explains itself", page.locator('[data-animate-tile="COPY IT"]'), 'copy of this drawing');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: join(OUT, 'dark-animate.png') });
  });

  await area('BEATBOX: THE MAIN KEYS, A WINDOW AND THE CREDITS', async () => {
    const main = page.locator('[role="group"][aria-label="Main keys"]');
    await arrive('/beatbox', main);
    await hoverSays("beatbox's Play explains itself", main.locator('button[aria-label="Play"]'), 'Plays the song', 'picked bar');
    await hoverSays('Stop explains itself', main.locator('button[aria-label="Stop"]'), 'Stops the music');
    await hoverSays('Record explains itself', main.locator('button[aria-label="Record"]'), 'Records');
    await hoverSays('the Sounds window key explains itself', main.locator('button[data-window-key="sounds"]'), 'Sounds window');
    await main.locator('button[data-window-key="settings"]').click();
    await hoverSays('Follow explains itself', page.locator('button', { hasText: /^Follow (on|off)$/ }), 'follow');
    // CREDITS sits in the Song window, under open and save.
    await main.locator('button[data-window-key="song"]').click();
    await hoverSays('CREDITS explains itself', key('[ CREDITS ]'), 'credits page');
    await page.screenshot({ path: join(OUT, 'dark-beatbox.png') });
  });

  // EXPLAIN-REST-3 (2026-11-28): the last areas. LEAGUEBOT, COMMS, DISCOVER (the tag station), RECOMMENDATIONS, and keys
  // that belong to no named area (STREAM, the arcade, the desk, MEDIA's front page).
  await area('LEAGUEBOT: LOOK UP', async () => {
    await arrive('/leaguebot', key(/^LOOK UP$/).first());
    await hoverSays('LOOK UP explains itself', key(/^LOOK UP$/), 'Looks up the player', 'Enter in the box');
    await page.screenshot({ path: join(OUT, 'dark-leaguebot.png') });
  });

  await area('COMMS: THE KEYS ABOVE THE CONVERSATIONS', async () => {
    await arrive('/comms', key('[ + NEW MESSAGE ]').first());
    await hoverSays('NEW MESSAGE explains itself', key('[ + NEW MESSAGE ]'), 'accounts you can message');
    await hoverSays('NEW GROUP explains itself', key('[ + NEW GROUP ]'), 'name a group');
    await hoverSays('PURGE LOCAL COMMS explains itself, with its caution', key('[ PURGE LOCAL COMMS ]'), 'test conversation', 'NO QUESTION IS ASKED');
    await page.screenshot({ path: join(OUT, 'dark-comms.png') });
  });

  await area('DISCOVER (the tag station): SIZE, COPY LINK, FILTERS AND PRESETS', async () => {
    await arrive('/discover', key('[ COPY LINK ]').first());
    await hoverSays('COPY LINK explains itself', key('[ COPY LINK ]'), 'Copies the address');
    await hoverSays('a text size key explains itself', page.locator('button[aria-label="Text size L"]'), 'size L');
    await hoverSays('FILTERS explains itself', key('[ FILTERS ]'), 'Opens the filters');
    await hoverSays('PRESETS explains itself', key('[ PRESETS ]'), 'saved presets');
    await page.screenshot({ path: join(OUT, 'dark-discover.png') });
  });

  await area('RECOMMENDATIONS: THE TABS AND THE COMPOSER', async () => {
    await arrive('/recommendations', key('MAKE A RECOMMENDATION').first());
    await hoverSays('a tab explains itself', page.locator('[role="tab"]').first(), 'posted for everyone');
    await hoverSays('MAKE A RECOMMENDATION explains itself', key('MAKE A RECOMMENDATION'), 'put a recommendation together');
    await key('MAKE A RECOMMENDATION').first().click();
    await hoverSays("the composer's YOUR LETTERS explains itself", key('[ YOUR LETTERS ]'), 'Lists your letters');
    await hoverSays('its SEARCH explains itself', key('[ SEARCH ]'), 'kept pages');
    await page.screenshot({ path: join(OUT, 'dark-recommendations.png') });
  });

  await area('STREAM: THE LOOKS AND GO LIVE', async () => {
    await arrive('/stream', key('[ GO LIVE ]').first());
    await hoverSays('GO LIVE explains itself', key('[ GO LIVE ]'), 'your own stream');
    await hoverSays('a STREAM tab explains itself', page.locator('[role="tablist"][aria-label="STREAM"] [role="tab"]').first(), 'rooms that are live');
    await hoverSays('CUSTOMIZE LAYOUT explains itself', key('[ CUSTOMIZE LAYOUT ]'), 'looks your room');
    await key('[ CUSTOMIZE LAYOUT ]').first().click();
    await hoverSays('KEEP MY OWN LOOK explains itself', key('[ KEEP MY OWN LOOK ]'), 'your own look');
  });

  await area('THE ARCADE, THE DESK AND MEDIA (keys in no named area)', async () => {
    await arrive('/forum?arcade=1', key('[ PLAY SOLO ]').first());
    await hoverSays('PLAY SOLO explains itself', key('[ PLAY SOLO ]'), 'against the computer');
    await arrive('/forum?desk=1', page.locator('[data-desk-auto]').first());
    await hoverSays("the desk's AUTO POP-UP explains itself", page.locator('[data-desk-auto]'), 'desk');
    await arrive('/media', key('+ UPLOAD').first());
    await hoverSays("MEDIA's UPLOAD explains itself", key('+ UPLOAD'), 'upload a new file');
    await page.screenshot({ path: join(OUT, 'dark-media-upload.png') });
  });

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
  for (let tries = 0; tries < 2 && (await boxText(page)) === null; tries += 1) {
    await page.mouse.move(700, 900);
    await sleep(2000);
    await page.locator('[data-search-key]').hover();
    await sleep(800);
  }
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
