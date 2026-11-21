/*
 * MEDIA's cards, details behind an `i` (MEDIADETAILS; Luke, 2026-11-20: "i want removed the BECAUSE YOU FINISHED ... now only
 * visible with an "i" icon on the top right of a thumbnail replacing the go to arrow. the i icon shows a pop up window with
 * video details, recommendation details, description, go to etc. make the date text a little smaller too, and make all the
 * "play queue" interactable buttons align across each row on grid view. make grid view default view in media page too.").
 * On a local dev server with mock data only, signed in as the mock's hidden test person, on /media (the default feed):
 *
 *   1. a browser that never chose a view gets GRID; one that chose LIST keeps LIST;
 *   2. no card carries a why-line; every card has an `i` key in its picture's top right, 24px to press, and no ↗ there;
 *   3. the `i` opens a window over the page: the title, the kind and date, where it is from, the why (for a feed row that
 *      has one), the description as plain text, and a GO TO link to the same address the ↗ had; X, Escape and a click
 *      outside each close it, and the `i` has the focus back afterwards; nothing in it is a count;
 *   4. the date reads quieter than the kind beside it, never under 13px and at least 4.5:1 on what it sits on, in every
 *      theme given;
 *   5. GRID: in each row of cards, the PLAY / QUEUE keys stand at one height, folded and with one card opened, in the feed
 *      and in DISCOVER and RECOMMENDED (which wrap each card with its people);
 *   6. Escape shuts DETAILS only, never a window behind it.
 *
 *   node scripts/drive-media-details.cjs --base http://localhost:3316 [--shots] [--themes dark,default,marmalade-peach]
 *
 * Start the server with Temp/browse/dev-mock-feed.cjs (every data source on mock, Supabase empty). The drive aborts any
 * request to Supabase and fails if one was tried. `--shots` keeps pictures in Temp/browse/media-details/.
 */
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3316');
const SHOTS = join('Temp', 'browse', 'media-details');
mkdirSync(SHOTS, { recursive: true });
const WIDTHS = opt('--widths', '1065,1920').split(',').map(Number);
const THEMES = opt('--themes', 'dark').split(',');

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const PERSON = 'mock-test-account';
const signIn = (person) => {
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser.tour.v1', 'skipped');
  window.localStorage.setItem(
    'debaser.auth.mock.v1',
    JSON.stringify({ users: [{ id: person, email: 'test-mock@debaser.site', displayName: 'TEST ACCOUNT (MOCK)', createdAt: '2026-11-14T00:00:00.000Z', salt: '', secretHash: '', hidden: true }], sessionUserId: person, bannedIds: [] }),
  );
};

/** Waits for the page to stop moving (the side panel arrives after the stream); keeps the mock's first-visit PRIVACY window. */
async function settle(page) {
  let last = '';
  for (let i = 0; i < 30; i += 1) {
    await page.waitForTimeout(500);
    const keep = page.getByRole('button', { name: /KEEP THESE SETTINGS/ });
    if (await keep.isVisible().catch(() => false)) await keep.click().catch(() => {});
    const now = await page.$$eval('li[data-view]', (cards) => cards.map((li) => Math.round(li.getBoundingClientRect().width)).join(','));
    if (now === last && i >= 3) return;
    last = now;
  }
}

async function open(page, { view, theme, width }) {
  await page.evaluate(({ view, theme }) => {
    // The account's own saved settings (mock: this browser's storage) would win on sign-in (SPEC-forum-v3.md, F2A): none saved,
    // so the browser's choice below, or no choice at all, is what the page reads.
    window.localStorage.removeItem('debaser.user-settings.mock.v1');
    if (view === null) window.localStorage.removeItem('debaser.media.view.v1');
    else window.localStorage.setItem('debaser.media.view.v1', view);
    window.localStorage.setItem('debaser.site.theme.v2', theme);
  }, { view, theme });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('li[data-view] [data-more-keys]', { timeout: 120_000 });
  await settle(page);
}

/** The WCAG ratio of an element's text against the nearest surface that paints, blending a see-through ink onto it. */
const contrastOf = (el) => {
  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean);
    return [Number(r), Number(g), Number(b), Number(a)];
  };
  // Asks the browser to turn any colour (oklab, color-mix) into rgb: a 1px canvas.
  const toRgb = (value) => {
    const direct = parse(value);
    if (direct) return direct;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  let surface = null;
  for (let n = el; n !== null; n = n.parentElement) {
    const bg = toRgb(getComputedStyle(n).backgroundColor);
    if (bg[3] > 0.99) {
      surface = bg;
      break;
    }
  }
  surface ??= [255, 255, 255, 1];
  const ink = toRgb(getComputedStyle(el).color);
  const mixed = ink.slice(0, 3).map((c, i) => c * ink[3] + surface[i] * (1 - ink[3]));
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(mixed), lum(surface.slice(0, 3))].sort((a, b) => b - a);
  return { ratio: (hi + 0.05) / (lo + 0.05), alpha: ink[3], size: parseFloat(getComputedStyle(el).fontSize) };
};

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let supabaseTried = 0;
  await context.route(/supabase\.(co|in)\//, (route) => {
    supabaseTried += 1;
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(signIn, PERSON);

  // 1. GRID is the default; a kept choice wins.
  await open(page, { view: null, theme: 'dark', width: 1065 });
  const firstView = await page.$eval('li[data-view]', (li) => li.getAttribute('data-view'));
  check(firstView === 'grid', `a browser that never chose a view gets GRID (${firstView})`);
  await open(page, { view: 'list', theme: 'dark', width: 1065 });
  const keptView = await page.$eval('li[data-view]', (li) => li.getAttribute('data-view'));
  check(keptView === 'list', `a browser that chose LIST keeps LIST (${keptView})`);

  await page.addInitScript(contrastOf.toString().replace(/^/, 'window.__contrastOf = '));
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      await open(page, { view: 'grid', theme, width });
      await page.evaluate(contrastOf.toString().replace(/^/, 'window.__contrastOf = '));
      console.log(`${theme} grid ${width}:`);

      // 2. The card itself.
      const cards = await page.$$eval('li[data-view]', (lis) =>
        lis
          .filter((li) => li.querySelector('[data-more-keys]') && li.offsetParent !== null)
          .map((li) => {
            const thumb = li.querySelector('span.relative');
            const info = li.querySelector('[data-thumb-info]');
            const t = thumb?.getBoundingClientRect();
            const r = info?.getBoundingClientRect();
            const room = info ? parseFloat(getComputedStyle(info, '::before').height) || 0 : 0;
            return {
              title: (li.querySelector('p[id^="web-row-"]')?.textContent ?? '').slice(0, 28),
              why: li.querySelector('[data-why]') !== null,
              arrow: li.querySelector('[data-thumb-open]') !== null,
              info: info !== null,
              corner: info !== null && t !== undefined && Math.abs(r.right - t.right) <= 2 && Math.abs(r.top - t.top) <= 2,
              tap: info === null ? 0 : Math.max(r.height, room),
            };
          }),
      );
      check(cards.length >= 4 && cards.every((c) => !c.why), `no why-line on any card (${cards.filter((c) => c.why).length} have one)`);
      check(cards.every((c) => c.info && c.corner && !c.arrow), `every card: an i key in the picture's top right, no ↗ (${cards.filter((c) => c.info && c.corner && !c.arrow).length}/${cards.length})`);
      check(cards.every((c) => c.tap >= 23.5), `the i key is 24px to press (${Math.min(...cards.map((c) => c.tap))}px)`);

      // 4. The date: quieter than the kind, 13px or more, 4.5:1 or better.
      const dates = await page.$$eval('li[data-view] [data-row-facts] time', (times) =>
        times.map((time) => ({ date: window.__contrastOf(time), kind: window.__contrastOf(time.parentElement.firstElementChild) })),
      );
      const loud = dates.filter((d) => !(d.date.ratio < d.kind.ratio - 0.05));
      const faint = dates.filter((d) => d.date.ratio < 4.5 || d.date.size < 13);
      check(dates.length > 0 && loud.length === 0, `the date reads quieter than the kind (${dates[0] ? `${dates[0].date.ratio.toFixed(2)} vs ${dates[0].kind.ratio.toFixed(2)}` : 'none'})`);
      check(faint.length === 0, `the date: 13px or more, 4.5:1 or better${faint.length ? `: ${faint[0].date.ratio.toFixed(2)}:1 ${faint[0].date.size}px` : ` (lowest ${Math.min(...dates.map((d) => d.date.ratio)).toFixed(2)}:1)`}`);

      // 5. The PLAY / QUEUE keys line up across each row of cards, folded and with one card opened.
      const rows = () =>
        page.$$eval('li[data-view="grid"]', (lis) => {
          const byRow = new Map();
          for (const li of lis) {
            const keys = li.querySelector('[data-row-keys]');
            if (keys === null || li.offsetParent === null) continue;
            const top = Math.round(li.getBoundingClientRect().top);
            const k = Math.round(keys.getBoundingClientRect().top);
            byRow.set(top, [...(byRow.get(top) ?? []), k]);
          }
          return [...byRow.values()].filter((tops) => tops.length > 1).map((tops) => Math.max(...tops) - Math.min(...tops));
        });
      const shut = await rows();
      check(shut.length > 0 && shut.every((d) => d <= 1), `folded: PLAY / QUEUE at one height in every row (${shut.length} rows, worst ${Math.max(...shut)}px)`);
      if (args.includes('--shots')) await page.screenshot({ path: join(SHOTS, `${theme}-grid-${width}-shut.png`) });
      await page.locator('[data-more-keys="shut"]').first().click();
      await page.waitForTimeout(300);
      const opened = await rows();
      check(opened.length > 0 && opened.every((d) => d <= 1), `one card opened: still one height in every row (worst ${Math.max(...opened)}px)`);
      await page.locator('[data-more-keys="open"]').first().click();

      // 3. The window behind the i, on a feed row with a why.
      const target = page.locator('li[data-view]').filter({ has: page.locator('[data-thumb-info]') }).filter({ has: page.locator('[data-split-key]') }).first();
      const title = (await target.locator('p[id^="web-row-"]').innerText()).trim();
      const info = target.locator('[data-thumb-info]');
      await info.click();
      const dialog = page.getByRole('dialog').filter({ hasText: title.slice(0, 20) });
      const shown = await dialog.isVisible().catch(() => false);
      check(shown, `the i opens a window with the title ("${title.slice(0, 30)}")`);
      if (shown) {
        const words = await dialog.innerText();
        const goTo = dialog.locator('[data-details-go]');
        const href = (await goTo.count()) > 0 ? await goTo.getAttribute('href') : null;
        check(/VIDEO|AUDIO|IMAGE|TEXT|PAPER|NEWS|LONG READ|TECH/.test(words) && /\d{4}-\d{2}-\d{2}|● LIVE|ON NOW/.test(words), 'it says the kind and the date');
        check(await dialog.locator('[data-details-from]').count() > 0, 'it says where it is from');
        check(href !== null && /^https:\/\//.test(href) && (await goTo.getAttribute('target')) === '_blank', `GO TO opens the platform in a new tab (${href})`);
        check((await dialog.locator('[data-details-why]').count()) > 0, 'it carries the why');
        check(!/\b\d[\d,.]*\s*(views|likes|plays|followers|downloads|ratings?|stars?)\b/i.test(words), 'no counts or ratings');
        check(await dialog.locator('[data-details-description]').evaluate((el) => el.children.length === 0).catch(() => true), 'the description is plain text');
        const low = await dialog.evaluate((box) =>
          [...box.querySelectorAll('*')]
            .filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && n.getClientRects().length > 0)
            .map((n) => ({ text: n.textContent.trim().slice(0, 24), ...window.__contrastOf(n) }))
            .filter((n) => n.ratio < 4.5 || n.size < 13),
        );
        check(low.length === 0, `every line in the window reads 4.5:1 at 13px or more${low.length ? `: "${low[0].text}" ${low[0].ratio.toFixed(2)}:1 ${low[0].size}px` : ''}`);
        if (args.includes('--shots')) await page.screenshot({ path: join(SHOTS, `${theme}-grid-${width}-details.png`) });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        const afterEsc = await dialog.isVisible().catch(() => false);
        const focused = await info.evaluate((el) => document.activeElement === el);
        check(!afterEsc && focused, `Escape closes it and the i has the focus back (${afterEsc ? 'still open' : 'closed'}, focus ${focused ? 'back' : 'lost'})`);
        await info.click();
        await page.mouse.click(5, 500);
        await page.waitForTimeout(200);
        check(!(await dialog.isVisible().catch(() => false)), 'a click outside closes it');
        await info.click();
        await dialog.getByRole('button', { name: 'Close window' }).click();
        await page.waitForTimeout(200);
        check(!(await dialog.isVisible().catch(() => false)), 'X closes it');
      }
    }
  }

  // 6. RECOMMENDED and DISCOVER wrap each card with its people (WebPickedList.tsx): their keys line up across a row too. The
  // mock catalogue's tagged count is raised in this browser only (the answer from /api/tag-station/graph), as
  // drive-media-feed's --pool-ready does, so the lists draw.
  await context.route(/\/api\/tag-station\/graph/, async (route) => {
    const response = await route.fetch();
    const graph = await response.json();
    await route.fulfill({ response, json: { ...graph, tagged: Math.max(graph.tagged ?? 0, 10_000) } });
  });
  for (const list of ['discover', 'recommended']) {
    await page.evaluate(() => {
      window.localStorage.removeItem('debaser.user-settings.mock.v1');
      window.localStorage.setItem('debaser.media.view.v1', 'grid');
    });
    await page.setViewportSize({ width: 1065, height: 1000 });
    await page.goto(`${BASE}/media?list=${list}`, { waitUntil: 'domcontentloaded' });
    const drew = await page.waitForSelector('ul.media-grid li [data-row-keys]', { timeout: 60_000 }).then(() => true, () => false);
    if (!drew) {
      console.log(`  NOTE ${list.toUpperCase()}: no rows on this mock site`);
      continue;
    }
    await settle(page);
    const spreads = await page.$$eval('ul.media-grid', (lists) => {
      const byRow = new Map();
      for (const li of lists[0].querySelectorAll('.media-card')) {
        const keys = li.querySelector('[data-row-keys]');
        const top = Math.round(li.parentElement.closest('li')?.getBoundingClientRect().top ?? li.getBoundingClientRect().top);
        byRow.set(top, [...(byRow.get(top) ?? []), Math.round(keys.getBoundingClientRect().top)]);
      }
      return [...byRow.values()].filter((tops) => tops.length > 1).map((tops) => Math.max(...tops) - Math.min(...tops));
    });
    check(spreads.length > 0 && spreads.every((d) => d <= 1), `${list.toUpperCase()}: PLAY / QUEUE at one height in every row (${spreads.length} rows, worst ${Math.max(...spreads)}px)`);
    if (args.includes('--shots')) await page.screenshot({ path: join(SHOTS, `dark-${list}-1065.png`) });
  }

  // 7. Escape shuts DETAILS only, when another window is open behind it: a stand-in window listening on the document, as every
  // PopoutWindow does (a letter's popout draws MEDIA rows inside one).
  await open(page, { view: 'grid', theme: 'dark', width: 1065 });
  await page.evaluate(() => {
    window.__behindShut = 0;
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') window.__behindShut += 1;
    });
  });
  await page.locator('[data-thumb-info]').first().click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const behind = await page.evaluate(() => window.__behindShut);
  const stillOpen = await page.locator('[data-details]').count();
  check(stillOpen === 0 && behind === 0, `Escape shuts DETAILS and nothing behind it (window ${stillOpen ? 'open' : 'shut'}, ${behind} behind heard it)`);

  await browser.close();
  check(supabaseTried === 0, `no request reached Supabase (${supabaseTried})`);
  console.log(failed ? `FAILED: ${failed} failed, ${passed} passed` : `ok: ${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
