/*
 * DOCS's top keys on one line (list 4, DOCSBAR; Luke, 2026-11-17: "in the documents tab, have [ + NEW DOCUMENT ],
 * TEXT SIZE [ A− ] [ A+ ], [ RECENT ], [ MY DOCUMENTS ], [ SHARED WITH ME ], [ FOLDERS ] all be on one line"). On a local dev
 * server with mock data only, signed in (the mock account, in this browser only), at the default TEXT SIZE. They can't
 * share one line as they were (about 1000px of keys in a DOCS box 633-940px wide), so Luke chose "A: shorter words":
 * [ + NEW ] [ RECENT ] [ MINE ] [ SHARED ] [ FOLDERS ] [ A− ] [ A+ ], one key size smaller. The drive checks:
 *
 *   1. at each window width, those keys sit on ONE line (their middles level), inside the page's box;
 *   2. every one keeps a thumb's height (44px) and nothing is under 13px;
 *   3. the full names stay: the title bar says RECENT DOCUMENTS, A− and A+ are named "Smaller text" and "Bigger text";
 *   4. in MY DOCUMENTS, where [ + NEW FOLDER ] joins them, the line is reported (it may need a second line at the narrowest).
 * On the old code (the long words, two rows) it failed at every width.
 *
 *   node scripts/drive-docs-bar.cjs --base http://localhost:3321 [--shots] [--widths 1024,1065,1280,1366,1920]
 *
 * Start the server with every data source on mock and the Supabase address and key empty (a node launcher, see
 * Temp/browse/dev-mock-gridcard.cjs). The drive aborts any request to Supabase and fails if one was tried.
 */
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3321');
const SHOTS = join('Temp', 'browse', 'docs-bar');
mkdirSync(SHOTS, { recursive: true });
const WIDTHS = opt('--widths', '1024,1065,1280,1366,1920').split(',').map(Number);
const KEYS = ['[ + NEW ]', '[ RECENT ]', '[ MINE ]', '[ SHARED ]', '[ FOLDERS ]', '[ A− ]', '[ A+ ]'];

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

// The mock account, kept in this browser's storage only (no server, no database).
const SIGNED_IN = `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    if (!kept.sessionUserId) {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== user.id), user], sessionUserId: user.id }));
    }
  } catch {}
})()`;

/** Each key Luke named: where its middle sits, its height, its font size, and whether it stays inside the DOCS box. */
const measure = (page, names) =>
  page.evaluate((names) => {
    const box = document.querySelector('.docs-ui')?.getBoundingClientRect();
    const all = [...document.querySelectorAll('.docs-ui button, .docs-ui a, .docs-ui span')];
    return names.map((name) => {
      const el = name === 'TEXT SIZE' ? all.find((n) => n.tagName === 'SPAN' && n.firstChild?.nodeValue?.trim() === 'TEXT SIZE') : all.find((n) => n.tagName !== 'SPAN' && n.textContent.replace(/\s+/g, ' ').trim() === name);
      if (!el) return { name, found: false };
      const target = name === 'TEXT SIZE' ? el.firstChild : el;
      let r;
      if (target.nodeType === 3) {
        const range = document.createRange();
        range.selectNodeContents(target);
        r = range.getBoundingClientRect();
      } else r = el.getBoundingClientRect();
      return { name, found: true, mid: Math.round(r.top + r.height / 2), height: Math.round(el.getBoundingClientRect().height), font: parseFloat(getComputedStyle(el).fontSize), inside: box ? r.right <= box.right + 1 && r.left >= box.left - 1 : false, lines: target.nodeType === 3 ? 1 : el.getClientRects().length };
    });
  }, names);

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let supabaseTried = 0;
  await context.route(/supabase\.(co|in)\//, (route) => {
    supabaseTried += 1;
    return route.abort();
  });
  await context.addInitScript(SIGNED_IN);
  const page = await context.newPage();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/docs`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /\[ \+ NEW/.test(document.querySelector('.docs-ui')?.textContent ?? ''), null, { timeout: 120_000 });
    for (const text of ['NOT NOW', '[ KEEP THESE SETTINGS ]', '[ I NEVER HAD ONE ]']) {
      const key = page.getByText(text, { exact: true });
      if (await key.count()) await key.first().click().catch(() => undefined);
    }
    await page.waitForTimeout(600);
    const keys = await measure(page, KEYS);
    const missing = keys.filter((k) => !k.found).map((k) => k.name);
    const mids = keys.filter((k) => k.found).map((k) => k.mid);
    const box = await page.evaluate(() => Math.round(document.querySelector('.docs-ui').getBoundingClientRect().width));
    console.log(`window ${width}: DOCS box ${box}px`);
    check(missing.length === 0, `all ${KEYS.length} keys found${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
    const names = await page.evaluate(() => ({
      title: document.querySelector('.docs-ui h2')?.textContent ?? '',
      smaller: document.querySelector('.docs-ui button[aria-label="Smaller text"]') !== null,
      bigger: document.querySelector('.docs-ui button[aria-label="Bigger text"]') !== null,
      newName: [...document.querySelectorAll('.docs-ui button')].find((b) => b.textContent.trim() === '[ + NEW ]')?.getAttribute('aria-label') ?? '',
    }));
    check(names.title === 'RECENT DOCUMENTS' && names.smaller && names.bigger && names.newName === 'New document', `full names kept (title "${names.title}", A− and A+ named, NEW named "${names.newName}")`);
    const spread = Math.max(...mids) - Math.min(...mids);
    check(spread <= 3 && keys.every((k) => !k.found || k.lines === 1), `one line: middles within ${spread}px${spread > 3 ? ` (${keys.map((k) => `${k.name}@${k.mid}`).join(' ')})` : ''}`);
    check(keys.every((k) => !k.found || k.inside), 'inside the DOCS box');
    check(keys.filter((k) => k.found && k.name !== 'TEXT SIZE').every((k) => k.height >= 44), `a thumb tall (${Math.min(...keys.filter((k) => k.found && k.name !== 'TEXT SIZE').map((k) => k.height))}px at least)`);
    check(keys.every((k) => !k.found || k.font >= 13), 'nothing under 13px');
    if (args.includes('--shots')) await page.screenshot({ path: join(SHOTS, `docs-${width}.png`) });

    // MY DOCUMENTS: [ + NEW FOLDER ] joins the line there (not one of Luke's six; reported, not judged).
    await page.goto(`${BASE}/docs?folder=mine`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    const folder = await page
      .waitForFunction(() => document.querySelector('.docs-ui')?.textContent.includes('NEW FOLDER'), null, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (folder) {
      const withFolder = await measure(page, [...KEYS, '[ + NEW FOLDER ]']);
      const m = withFolder.filter((k) => k.found).map((k) => k.mid);
      console.log(`       MY DOCUMENTS with [ + NEW FOLDER ]: ${Math.max(...m) - Math.min(...m) <= 3 ? 'one line' : 'two lines'}`);
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
