/*
 * SPEC-forum-v2.md (Luke's answers, 2026-11-17): the board's keys working together, driven in a real browser on a LOCAL
 * mock dev server only (core.md, "Test locally"): every data switch on mock, sign-in mock, the Supabase address empty
 * (Temp/browse/dev-mock-forumux.cjs). The live hosts are blocked and the run fails if anything asked them.
 *
 *   node scripts/drive-forum-v2.cjs --base http://localhost:<port> [--out Temp/browse/forum-v2]
 *
 * Seeds the mock board (12 posts, 4 with pictures, a pinned one, tags) and six stream records with their rooms (two
 * answered, one live). Each step reports and the run goes on, so old code shows every failure at once.
 */
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3341');
const OUT = opt('--out', join('Temp', 'browse', 'forum-v2'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;
const check = (ok, what, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` :: ${detail}` : ''}`);
};

const PIC = { src: '/assets/concepts/concept-sheet-01.png', alt: 'a concept sheet', width: 800, height: 600 };

function seed() {
  const now = Date.now();
  const at = (minutes) => new Date(now - minutes * 60000).toISOString();
  const tag = (label, colour = 'sun') => ({ id: `tag-${label}`, label, kind: 'user', colour });
  const reply = (threadId, k, minutes, extra = {}) => ({
    id: `${threadId}-r${k}`,
    threadId,
    body: `reply ${k} on ${threadId}`,
    author: { id: `ux-replier-${k}`, displayName: `REPLIER${k}` },
    createdAt: at(minutes),
    tags: [],
    ...extra,
  });
  const pictured = [2, 5, 9, 11];
  const post = (n) => {
    const id = `p${n}`;
    const tags = [];
    if (n <= 3) tags.push(tag('lore'));
    if ([2, 5, 9].includes(n)) tags.push(tag('art', 'ena'));
    return {
      id,
      title: `Board post ${n}`,
      body: `Words of board post ${n}.`,
      author: { id: `ux-user-${n}`, displayName: `POSTER${n}` },
      createdAt: at(10 + n * 7),
      anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' },
      tags,
      comments: n % 3 === 0 ? [] : [reply(id, 1, 9 + n * 7)],
      ...(pictured.includes(n) ? { media: PIC } : {}),
      origin: 'user',
    };
  };
  const record = (n, host, minutes, comments = [], extra = {}) => ({
    id: `s${n}`,
    title: `STREAM :: ${host} :: ${at(minutes).slice(0, 10)}`,
    body: '',
    author: { id: null, displayName: host },
    createdAt: at(minutes),
    anchor: { kind: 'board', id: `watch:room-s${n}`, label: 'STREAM' },
    tags: [],
    comments,
    origin: 'user',
    ...extra,
  });
  const threads = [
    ...Array.from({ length: 12 }, (_u, i) => post(i + 1)),
    record(1, 'ALPHA', 1),
    record(2, 'BRAVO', 2, [reply('s2', 1, 1)]),
    record(3, 'CHARLIE', 3, [], { media: PIC }),
    record(4, 'DELTA', 4),
    record(5, 'ECHO', 5, [reply('s5', 1, 2, { media: PIC })]),
    record(6, 'FOXTROT', 6),
  ];
  const pins = [{ threadId: 'p12', pinnedById: 'debaser-site', pinnedByName: 'debaser.site', pinnedAt: at(3), expiresAt: null }];

  // The rooms behind the records: CHARLIE played three videos over 40 minutes and ended; ALPHA is still on.
  const room = (n, host, startedMin, endedMin) => ({
    id: `room-s${n}`, originalHostId: `host-${n}`, originalHostLabel: host, hostId: `host-${n}`, forumThreadId: `s${n}`,
    currentEntryId: null, positionSeconds: 0, isPlaying: endedMin === null, startedAt: at(startedMin),
    updatedAt: endedMin === null ? new Date(now).toISOString() : at(endedMin), endedAt: endedMin === null ? null : at(endedMin),
    origin: 'stream', isPublic: true, privacy: 'open', clearedAt: null, name: null, topic: null, addMode: 'anyone', guestsCanTalk: true,
  });
  const play = (n, k) => ({
    id: `q-s${n}-${k}`, roomId: `room-s${n}`, position: k, inQueue: false, mediaItemId: null,
    link: { url: `https://example.org/${k}`, kind: 'youtube', title: `VIDEO ${k}` }, series: null, addedBy: null,
    addedAt: at(60), playedAt: at(50 - k), playIndex: k,
  });
  const watch = {
    rooms: [room(1, 'ALPHA', 10, null), room(3, 'CHARLIE', 63, 23)],
    queue: [play(1, 0), play(3, 0), play(3, 1), play(3, 2)],
    messages: [], crowns: [], members: [], passwords: {}, attempts: [], privateRows: [],
  };
  return { forum: { version: 2, threads, pins }, watch };
}

async function newContext(browser, { width = 1440, height = 900, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  let live = 0;
  await context.route(/supabase\.(co|in)\/|debaser-site\.vercel\.app/, (route) => {
    live += 1;
    return route.abort();
  });
  const data = seed();
  await context.addInitScript(({ forum, watch }) => {
    try {
      if (window.localStorage.getItem('v2-seeded') === null) {
        window.localStorage.setItem('v2-seeded', '1');
        window.localStorage.setItem('debaser.forum.ugc.v2', JSON.stringify(forum));
        window.localStorage.setItem('debaser.watch.v1', JSON.stringify(watch));
        (window.localStorage.setItem('debaser.lost-account.never.v1', '1'), window.localStorage.setItem('debaser.tour.v2', 'skipped'));
      }
    } catch {
      // no storage
    }
  }, data);
  return { context, liveHits: () => live };
}

async function boardReady(page) {
  await page.getByRole('button', { name: '+ NEW POST' }).first().waitFor({ timeout: 180000 });
  await page.locator('#forum-thread-list').first().waitFor({ timeout: 60000 });
  await sleep(1200);
}

const tabs = (page) => page.locator('[data-undo-picks="VIEW"] button');
async function lit(page) {
  return tabs(page).evaluateAll((keys) => keys.filter((k) => k.getAttribute('aria-pressed') === 'true').map((k) => k.getAttribute('aria-label').split('.')[0]));
}
const tab = (page, name) => page.locator(`[data-undo-picks="VIEW"] button[aria-label^="${name}"]`);
async function shownIds(page) {
  return page.locator('#forum-thread-list [id^="thread-"]').evaluateAll((nodes) => nodes.map((n) => n.id.replace('thread-', '')));
}
async function openFilter(page) {
  await page.getByRole('button', { name: /^\[ FILTER/ }).first().click();
  await sleep(300);
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  let liveTotal = 0;
  try {
    console.log('1. Three tabs, one lit (1A)');
    let { context, liveHits } = await newContext(browser);
    let page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  ..  page error: ${error.message.slice(0, 160)}`));
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await boardReady(page);
    check((await tabs(page).count()) === 3, 'FEED, GALLERY and STREAMS are one row of three tabs');
    check(JSON.stringify(await lit(page)) === '["FEED"]', 'a fresh board has FEED lit', JSON.stringify(await lit(page)));
    const firstFeed = (await tabs(page).first().textContent()).trim();
    check(firstFeed === '[ FEED ]', 'a first visit, with nothing read, shows no NEW count (9B)', firstFeed);
    for (const name of ['GALLERY', 'STREAMS', 'FEED', 'STREAMS', 'GALLERY', 'GALLERY', 'FEED']) {
      await tab(page, name).click();
      await sleep(350);
      const now = await lit(page);
      check(now.length === 1 && now[0] === name, `after ${name}: exactly ${name} lit`, JSON.stringify(now));
    }
    await tab(page, 'STREAMS').click();
    await sleep(500);
    const streamIds = await shownIds(page);
    check(streamIds.length === 6 && streamIds.every((id) => id.startsWith('s')), 'STREAMS lists the six records and nothing else', streamIds.join(','));
    await tab(page, 'GALLERY').click();
    await sleep(500);
    const tiles = await page.locator('#forum-thread-list > li').count();
    check(tiles === 5, 'GALLERY is the main board\'s pictures, not the records\' (4 posts + the answered ECHO)', `${tiles} tiles`);

    console.log('2. The address, memory, Back and undo (2A)');
    check(new URL(page.url()).searchParams.get('view') === 'gallery', 'GALLERY is in the address', page.url());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await boardReady(page);
    check(JSON.stringify(await lit(page)) === '["GALLERY"]', 'a reload comes back to GALLERY');
    const second = await context.newPage();
    await second.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await boardReady(second);
    check(JSON.stringify(await lit(second)) === '["GALLERY"]', 'a plain /forum in this browser remembers GALLERY', second.url());
    check(new URL(second.url()).searchParams.get('view') === 'gallery', 'and writes it into the address');
    await second.close();
    await tab(page, 'STREAMS').click();
    await sleep(400);
    await page.goBack();
    await sleep(900);
    check(JSON.stringify(await lit(page)) === '["GALLERY"]', 'Back steps from STREAMS to GALLERY, staying on the board', `${JSON.stringify(await lit(page))} ${page.url()}`);
    await page.goForward();
    await sleep(900);
    check(JSON.stringify(await lit(page)) === '["STREAMS"]', 'Forward steps to STREAMS again');
    await tab(page, 'FEED').click();
    await sleep(400);
    await page.locator('[data-undo-arrow="undo"]').click();
    await sleep(900);
    check(JSON.stringify(await lit(page)) === '["STREAMS"]', 'the top bar\'s undo arrow takes the tab back', JSON.stringify(await lit(page)));
    await page.goto(`${BASE}/forum?view=feed`, { waitUntil: 'domcontentloaded' });
    await boardReady(page);
    check(JSON.stringify(await lit(page)) === '["FEED"]', 'an address with the feed opens the feed (the address wins over memory)');

    console.log('3. FILTER and SORT (10A, 4A); tags set aside on STREAMS (12A)');
    check((await page.getByRole('button', { name: /^\[ FILTER ▾ \]$/ }).count()) === 1, 'the tag key is [ FILTER ▾ ]');
    await page.getByRole('button', { name: /^\[ SORT:/ }).first().click();
    await sleep(300);
    check((await page.locator('#board-controls-panel #forum-source-filter').count()) === 0, 'SORT holds no source filter');
    await page.keyboard.press('Escape');
    await sleep(300);
    await openFilter(page);
    check((await page.locator('#board-tags-panel #forum-source-filter').count()) === 1, 'FILTER holds the source');
    const options = await page.locator('#forum-source-filter option').allTextContents();
    check(!options.includes('STREAMS'), 'the source no longer offers STREAMS', options.join('|'));
    await page.locator('#forum-source-filter').selectOption('board');
    await sleep(400);
    const boardFoot = await page.locator('nav[aria-label="Board pages"] span').first().textContent();
    check(/OF 14$/.test(boardFoot.trim()), 'BOARD THREADS shows the 14 of ALL, not 18 (4A)', boardFoot);
    await page.locator('#forum-source-filter').selectOption('all');
    await sleep(300);
    await page.locator('#board-tags-panel button', { hasText: 'lore' }).first().click();
    await sleep(400);
    await page.keyboard.press('Escape');
    await sleep(300);
    check((await page.getByRole('button', { name: /^\[ FILTER · 1 ▾ \]$/ }).count()) === 1, 'the key counts what is on: [ FILTER · 1 ▾ ]');
    check(new URL(page.url()).searchParams.get('tags') === 'lore', 'the tag is in the address', page.url());
    const loreIds = await shownIds(page);
    check(loreIds.join(',') === 'p1,p2,p3', 'LORE narrows the feed', loreIds.join(','));
    await tab(page, 'STREAMS').click();
    await sleep(500);
    check((await shownIds(page)).length === 6, 'on STREAMS the tag is set aside: all six records show');
    check((await page.locator('[data-tag-chips="set-aside"]').count()) === 1, 'its chip is greyed');
    check((await page.getByText("TAGS DON'T APPLY TO STREAMS").count()) === 1, "with TAGS DON'T APPLY TO STREAMS");
    await page.screenshot({ path: join(OUT, 'streams-set-aside.png') });
    await tab(page, 'FEED').click();
    await sleep(500);
    check((await shownIds(page)).join(',') === 'p1,p2,p3', 'back on FEED the tag applies again');

    console.log('4. Empty lines say why (11A)');
    await openFilter(page);
    await page.locator('#forum-source-filter').selectOption('asset');
    await sleep(400);
    await page.keyboard.press('Escape');
    await sleep(300);
    const emptyText = (await page.locator('#forum-thread-list p').first().textContent()).trim();
    check(emptyText === 'NOTHING TAGGED LORE IN ASSET THREADS.', 'the empty line names the tag and the source', emptyText);
    const clears = await page.locator('[data-empty-clears] button').allTextContents();
    check(clears.join(' ') === '[ CLEAR TAGS ] [ ALL SOURCES ]', 'with a key for each', clears.join(' '));
    await page.locator('[data-empty-clears] button', { hasText: 'ALL SOURCES' }).click();
    await sleep(400);
    check((await shownIds(page)).join(',') === 'p1,p2,p3', '[ ALL SOURCES ] brings the posts back');
    await page.getByRole('button', { name: /LORE ×|lore ×/i }).first().click();
    await sleep(400);

    console.log('5. GALLERY: four across, twelve a page (6A)');
    await tab(page, 'GALLERY').click();
    await sleep(800);
    const tops = await page.locator('#forum-thread-list > li').evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().top)));
    const firstRow = tops.filter((top) => top === tops[0]).length;
    check(firstRow === 4, 'four tiles on the first row at 1440', `${firstRow} (${tops.join(',')})`);
    const sizes = await page.locator('#forum-per-page option').allTextContents();
    check(sizes.join(',') === '8,12,24,48' && (await page.locator('#forum-per-page').inputValue()) === '12', 'the gallery pages by 8/12/24/48, 12 to begin with', sizes.join(','));
    await page.screenshot({ path: join(OUT, 'gallery.png') });

    console.log('6. Stream rows say what happened (3A)');
    await tab(page, 'STREAMS').click();
    await sleep(1500);
    const charlie = (await page.locator('#thread-s3 summary').textContent()).replace(/\s+/g, ' ');
    check(/HOSTED/.test(charlie) && /3 VIDEOS · 40 MIN/.test(charlie), 'CHARLIE: HOSTED ... · 3 VIDEOS · 40 MIN', charlie.slice(0, 160));
    const alpha = await page.locator('#thread-s1 summary').textContent();
    check(/1 VIDEO/.test(alpha) && /\[ ▶ WATCH \]/.test(alpha), 'ALPHA is on: 1 VIDEO and [ ▶ WATCH ]', alpha.replace(/\s+/g, ' ').slice(0, 160));
    await page.screenshot({ path: join(OUT, 'streams.png') });

    console.log('7. The reply line and the NEWSWIRE (5B, 8A)');
    await tab(page, 'FEED').click();
    await sleep(800);
    const masked = await page.locator('#thread-p1 [data-reveal="reserved"] [aria-hidden="true"] > div').first().evaluate((node) => getComputedStyle(node).maskImage || getComputedStyle(node).webkitMaskImage);
    check(/gradient/.test(masked), 'the reply line fades at its ends instead of being chopped', masked.slice(0, 80));
    const wireRows = await page.locator('section .crawl ul').first().locator('li, a').count();
    check(wireRows > 2, 'the NEWSWIRE carries more than the pinned post', `${wireRows} items`);
    const replyHref = await page.locator('section .crawl a[href*="#comment-"]').first().getAttribute('href').catch(() => null);
    check(replyHref !== null, "a reply's row on the wire opens the reply", String(replyHref));
    await page.locator('[data-wire-pause]').click();
    await sleep(300);
    const state = await page.locator('section .crawl').first().evaluate((node) => getComputedStyle(node).animationPlayState);
    check(state === 'paused', '[ ❚❚ ] stops the crawl', state);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await boardReady(page);
    check((await page.locator('section .crawl[data-crawl-paused="true"]').count()) === 1, 'and it stays stopped after a reload');
    await page.locator('[data-wire-pause]').click();
    if (replyHref !== null) {
      const commentId = replyHref.split('#comment-')[1];
      await page.locator(`section .crawl a[href="${replyHref}"]`).first().click({ force: true });
      await sleep(2500);
      const inView = await page.evaluate((id) => {
        const node = document.getElementById(`comment-${id}`);
        if (node === null) return 'missing';
        const box = node.getBoundingClientRect();
        return box.height > 0 && box.top >= 0 && box.bottom <= innerHeight ? 'in view' : `at ${Math.round(box.top)}`;
      }, commentId);
      check(inView === 'in view', 'pressing it lands on that reply, in view', inView);
    }

    console.log('8. NEW on the FEED tab (9B)');
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await boardReady(page);
    const before = await tab(page, 'FEED').getAttribute('aria-label');
    await page.locator('#thread-p12 summary').click();
    await sleep(800);
    const after = (await tab(page, 'FEED').textContent()).trim();
    check(/NEW/.test(after) && after !== '[ FEED ]', 'once something has been read, the tab says what is new', `${before} -> ${after}`);
    await tab(page, 'GALLERY').click();
    await sleep(400);
    await tab(page, 'FEED').click();
    await sleep(400);
    check(JSON.stringify(await lit(page)) === '["FEED"]', 'and the count does not get in the way of the tab');

    console.log('9. Tidy-ups (13)');
    const boardText = await page.locator('#forum-thread-list').textContent();
    check(!/NO TAGS/.test(boardText), 'no "NO TAGS" on the feed');
    await page.getByRole('button', { name: '+ NEW POST' }).first().click();
    await sleep(800);
    check((await page.locator('[data-picture-pane="none"]', { hasText: 'NO PICTURE' }).count()) === 1, 'the composer says NO PICTURE in a quiet box');
    const labels = await page.locator('[role="dialog"] span.shrink-0.font-bold').allTextContents();
    check(labels.some((l) => l === 'THEME:') && !labels.some((l) => /^[a-z]+:$/.test(l)), 'its tag groups are in capitals', labels.join(' '));
    await page.screenshot({ path: join(OUT, 'composer.png') });
    liveTotal += liveHits();
    await context.close();

    console.log('10. Phone width: no sideways scroll');
    ({ context, liveHits } = await newContext(browser, { width: 390, height: 844 }));
    page = await context.newPage();
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await boardReady(page);
    for (const name of ['FEED', 'GALLERY', 'STREAMS']) {
      await tab(page, name).click();
      await sleep(500);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(wide <= 0, `${name} at 390 wide: no sideways scroll`, `${wide}px`);
    }
    liveTotal += liveHits();
    await context.close();
  } catch (error) {
    failed += 1;
    console.log(`  FAIL the run stopped: ${error.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
  check(liveTotal === 0, 'nothing reached the live site', `${liveTotal} requests`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
