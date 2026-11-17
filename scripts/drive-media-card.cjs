/*
 * MEDIA's cards, neat (list 4, MEDIACARD; Luke, 2026-11-17: "the media stuff needs to be significantly neater, with the
 * source also only showing on expansion, please work it out"). On a local dev server with mock data only, signed in as the
 * mock's hidden test person, in GRID, LIST and LARGE at several window widths, every result with the arrow:
 *
 *   1. folded: the source (YOUTUBE, OPENVERSE...) is nowhere in its words; its facts line is whole (never cut with "…")
 *      and, in GRID, one line;
 *   2. opened: the source shows, in the opened area, with the licence beside it where there is one;
 *   3. opened: no key breaks inside its own brackets (each key's words on one line, a two-halved key's halves on one
 *      line), every key stays inside the card, and the keys of the opened area start at one left edge, line after line;
 *   4. nothing under 13px; every key at least 24px tall to press (its own box or its `.hit` room).
 *
 *   node scripts/drive-media-card.cjs --base http://localhost:3316 [--shots] [--themes dark,default,peach]
 *
 * Start the server with Temp/browse/dev-mock-feed.cjs (every data source on mock, Supabase empty). The drive aborts any
 * request to Supabase and fails if one was tried. `--shots` keeps pictures in Temp/browse/media-card/ (folded and opened,
 * at the laptop's width and 1920, in each `--themes` theme).
 */
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3316');
const SHOTS = join('Temp', 'browse', 'media-card');
mkdirSync(SHOTS, { recursive: true });
// The laptop's MEDIA window (about 1065 wide), the narrowest 4-across window, and the desktop.
const WIDTHS = opt('--widths', '1024,1065,1920').split(',').map(Number);
const THEMES = opt('--themes', 'dark').split(',');
const VIEWS = opt('--views', 'grid,list,large').split(',');

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
  window.localStorage.setItem(
    'debaser.auth.mock.v1',
    JSON.stringify({ users: [{ id: person, email: 'test-mock@debaser.site', displayName: 'TEST ACCOUNT (MOCK)', createdAt: '2026-11-14T00:00:00.000Z', salt: '', secretHash: '', hidden: true }], sessionUserId: person, bannedIds: [] }),
  );
};

/**
 * Every result with an arrow, measured in the page. `phase` is 'shut' or 'open'. The source is read from the picture's
 * OPEN key, whose name says "on <SOURCE> (new tab)"; a reading row (a paper, news...) names its outlet on its own key, so
 * it is measured for its keys only.
 */
const measure = (page, phase) =>
  page.$$eval(
    'li[data-view]',
    (cards, phase) => {
      const lineMids = (el) => {
        const mids = new Set();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) mids.add(Math.round(r.top + r.height / 2));
        }
        return [...mids];
      };
      const spread = (mids) => (mids.length === 0 ? 0 : Math.max(...mids) - Math.min(...mids));
      const visible = (el) => el !== null && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      return cards
        .filter((li) => li.querySelector('[data-more-keys]') && li.offsetParent !== null)
        .map((li) => {
          const card = li.getBoundingClientRect();
          const open = li.querySelector('[data-thumb-open]');
          const source = (open?.getAttribute('aria-label') ?? '').match(/ on (.+) \(new tab\)$/)?.[1] ?? null;
          const facts = li.querySelector('[data-row-facts]');
          const more = li.querySelector('[data-row-more]');
          const sourceLine = li.querySelector('[data-row-source]');
          // Each key: a button or link drawn as a bracket key, or a two-halved key's group.
          const keys = [...li.querySelectorAll('[data-split-key], .key')].filter((el) => visible(el) && !el.closest('[data-split-key]:not(:scope)') && !el.closest('[role="menu"], [role="dialog"]'));
          const broken = keys.filter((el) => spread(lineMids(el)) > 3).map((el) => el.textContent.trim());
          const outside = keys.filter((el) => el.getBoundingClientRect().right > card.right + 1).map((el) => el.textContent.trim());
          const short = keys
            .filter((el) => !el.matches('[data-split-key]'))
            .filter((el) => {
              const own = el.getBoundingClientRect().height;
              const room = parseFloat(getComputedStyle(el, '::before').height) || 0;
              return Math.max(own, room) < 23.5;
            })
            .map((el) => el.textContent.trim());
          // The opened area's keys: the first key on each line starts at the same left edge.
          let lefts = [];
          if (more !== null && visible(more)) {
            const own = [...more.querySelectorAll('[data-split-key], .key')].filter((el) => visible(el) && !el.closest('[data-split-key]:not(:scope)') && !el.closest('[role="menu"], [role="dialog"]'));
            const byLine = new Map();
            for (const el of own) {
              const r = el.getBoundingClientRect();
              const mid = Math.round((r.top + r.bottom) / 2 / 4);
              byLine.set(mid, Math.min(byLine.get(mid) ?? Infinity, Math.round(r.left)));
            }
            lefts = [...byLine.values()];
          }
          const words = (el) => (el === null ? '' : el.innerText ?? '');
          const smallest = Math.min(...[...li.querySelectorAll('*')].filter((n) => visible(n) && n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())).map((n) => parseFloat(getComputedStyle(n).fontSize)));
          return {
            phase,
            title: (li.querySelector('p[id^="web-row-"]')?.textContent ?? '').slice(0, 28),
            view: li.getAttribute('data-view'),
            reading: li.hasAttribute('data-reading'),
            width: Math.round(card.width),
            source,
            facts: words(facts),
            // Cut anywhere in the line: the line itself, or a part of it drawn with "…" (`truncate`).
            factsCut: facts !== null && [facts, ...facts.querySelectorAll('*')].some((n) => n.scrollWidth > n.clientWidth + 1),
            factsLines: facts === null ? 0 : lineMids(facts).length,
            // What the folded card says outside its title and creator (either may name a platform: a channel called YouTube).
            spoken: words(facts) + ' ' + words(li.querySelector('[data-why]')) + ' ' + words(li.querySelector('[data-row-keys]')) + ' ' + (visible(more) ? words(more) : ''),
            sourceShown: visible(sourceLine) ? words(sourceLine) : null,
            moreShown: visible(more),
            broken,
            outside,
            short,
            lefts,
            smallest,
          };
        });
    },
    phase,
  );

/**
 * Waits for the page to stop moving: the side panel (the signed-in profile) arrives after the stream and narrows the cards, as
 * it does on Luke's laptop. The mock account's first-visit PRIVACY window is kept as it is (KEEP THESE SETTINGS, saved in this
 * browser's mock only), so it covers nothing.
 */
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

const say = (list) => list.slice(0, 3).map((c) => `"${c.title}" (${c.view} ${c.width}px)`).join(', ');

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

  for (const theme of THEMES) {
    for (const view of VIEWS) {
      for (const width of WIDTHS) {
        await page.evaluate(({ view, theme }) => {
          window.localStorage.setItem('debaser.media.view.v1', view);
          window.localStorage.setItem('debaser.site.theme.v2', theme);
        }, { view, theme });
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(`li[data-view="${view}"] [data-more-keys]`, { timeout: 120_000 });
        await settle(page);
        console.log(`${theme} ${view} ${width}:`);
        const shut = await measure(page, 'shut');
        check(shut.length >= 4, `at least four results with the arrow (${shut.length}, ${Math.min(...shut.map((c) => c.width))}-${Math.max(...shut.map((c) => c.width))}px)`);
        const named = shut.filter((c) => !c.reading && c.source !== null);
        const sourceShut = named.filter((c) => c.spoken.toUpperCase().includes(c.source.toUpperCase()) || c.sourceShown !== null);
        check(named.length > 0 && sourceShut.length === 0, `folded: no source in the words (${named.length - sourceShut.length}/${named.length})${sourceShut.length ? `: ${say(sourceShut)} "${sourceShut[0].facts}"` : ''}`);
        const cut = shut.filter((c) => c.factsCut);
        check(cut.length === 0, `folded: facts whole, never cut${cut.length ? `: ${say(cut)} "${cut[0].facts}"` : ''}`);
        if (view === 'grid') {
          const twoLines = shut.filter((c) => c.factsLines > 1 && !/SERIES ::/.test(c.facts));
          check(twoLines.length === 0, `folded: facts on one line${twoLines.length ? `: ${say(twoLines)} "${twoLines[0].facts}"` : ''}`);
        }
        const shutBroken = shut.filter((c) => c.broken.length);
        check(shutBroken.length === 0, `folded: no key breaks inside its brackets${shutBroken.length ? `: ${say(shutBroken)} ${JSON.stringify(shutBroken[0].broken)}` : ''}`);
        if (args.includes('--shots') && width !== 1024) await page.screenshot({ path: join(SHOTS, `${theme}-${view}-${width}-shut.png`) });

        // Open every arrow on screen at once.
        await page.$$eval('[data-more-keys="shut"]', (arrows) => arrows.forEach((a) => a.click()));
        await page.waitForTimeout(400);
        const open = await measure(page, 'open');
        const sourceOpen = open.filter((c) => !c.reading && c.source !== null);
        const missing = sourceOpen.filter((c) => c.sourceShown === null || !c.sourceShown.toUpperCase().includes(c.source.toUpperCase()));
        check(sourceOpen.length > 0 && missing.length === 0, `opened: the source shows (${sourceOpen.length - missing.length}/${sourceOpen.length})${missing.length ? `: ${say(missing)} shows "${missing[0].sourceShown}"` : ''}`);
        const broken = open.filter((c) => c.broken.length);
        check(broken.length === 0, `opened: no key breaks inside its brackets${broken.length ? `: ${say(broken)} ${JSON.stringify(broken[0].broken)}` : ''}`);
        const outside = open.filter((c) => c.outside.length);
        check(outside.length === 0, `opened: every key inside the card${outside.length ? `: ${say(outside)} ${JSON.stringify(outside[0].outside)}` : ''}`);
        const ragged = open.filter((c) => c.lefts.length > 1 && Math.max(...c.lefts) - Math.min(...c.lefts) > 1);
        check(open.every((c) => c.moreShown) && ragged.length === 0, `opened: the keys start at one left edge, line after line${ragged.length ? `: ${say(ragged)} ${JSON.stringify(ragged[0].lefts)}` : ''}`);
        const short = open.filter((c) => c.short.length);
        check(short.length === 0, `opened: every key 24px to press${short.length ? `: ${say(short)} ${JSON.stringify(short[0].short)}` : ''}`);
        const small = open.filter((c) => c.smallest < 13);
        check(small.length === 0, `nothing under 13px${small.length ? `: ${small[0].smallest}px` : ''}`);
        if (args.includes('--shots') && width !== 1024) await page.screenshot({ path: join(SHOTS, `${theme}-${view}-${width}-open.png`) });
      }
    }
  }

  await browser.close();
  check(supabaseTried === 0, `no request reached Supabase (${supabaseTried})`);
  console.log(failed ? `FAILED: ${failed} failed, ${passed} passed` : `ok: ${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
