/*
 * BROWSER's table of what works (SPEC-seeing-machine.md, "How each phase is proved"): the fixed list of real sites, each opened by the
 * server's eye on a LOCAL mock dev server with the real way out, and what came of it. Fetches each page once, from home. Prints a table for
 * docs/seeing-machine.md, with a picture of each in --out to be looked at: what it can't judge is whether a page looks right.
 *
 *   SEEING_DEV_OPEN=1 node scripts/dev-mock-live.cjs 3341      (in another terminal, from Git Bash)
 *   node scripts/see-table.cjs --base http://localhost:3341 [--out Temp/browse/see-table] [--only wikipedia]
 */
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3341');
const OUT = opt('--out', join('Temp', 'browse', 'see-table'));
const ONLY = opt('--only', '');
mkdirSync(OUT, { recursive: true });

const SITES = [
  ['wikipedia', 'https://en.wikipedia.org/wiki/Steve_Mann_(inventor)'],
  ['bbc', 'https://www.bbc.co.uk/news'],
  ['guardian', 'https://www.theguardian.com/uk'],
  ['hackernews', 'https://news.ycombinator.com/'],
  ['github', 'https://github.com/parcel-bundler/lightningcss'],
  ['archive', 'https://archive.org/details/texts'],
  ['oldreddit', 'https://old.reddit.com/r/comics/'],
  ['oneapp', 'https://excalidraw.com/'],
  ['paywall', 'https://www.ft.com/'],
  ['youtube', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
  ['x', 'https://x.com/NASA'],
  ['instagram', 'https://www.instagram.com/nasa/'],
  ['404', 'https://en.wikipedia.org/wiki/No_such_page_here_at_all_1'],
  ['redirect', 'http://github.com'],
  ['pdf', 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'],
  ['smallweb', 'https://danluu.com/'],
  ['japanese', 'https://www.aozora.gr.jp/cards/000148/files/773_14560.html'],
  ['signin', 'https://accounts.google.com/'],
];
/** `--engines`: each search engine's results for the same plain words, once each (SPEC-seeing-machine.md, search). */
const ts = require('typescript');
const made = { exports: {} };
const transpiled = (file) => ts.transpileModule(require('node:fs').readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('module', 'exports', 'require', transpiled('app/lib/seeing/search.ts'))(made, made.exports, () => {
  const address = { exports: {} };
  new Function('module', 'exports', transpiled('app/lib/seeing/address.ts'))(address, address.exports);
  return address.exports;
});
if (args.includes('--engines')) SITES.splice(0, SITES.length, ...made.exports.ENGINES.filter((each) => each.opens !== 'site').map((each) => [each.id, made.exports.searchAddress(each, 'harbour fog signal')]));
const ANN = { id: '11111111-1111-4111-8111-111111111111', displayName: 'SEE ANN', email: 'a@example.com', createdAt: '2026-11-01T00:00:00.000Z', salt: '', secretHash: '', hidden: true };

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=swiftshader', '--disable-features=IsolateSandboxedIframes'] });
  for (const [name, address] of SITES.filter(([each]) => ONLY === '' || ONLY.split(',').includes(each))) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((user) => {
      if (window.top !== window) return;
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user], sessionUserId: user.id, bannedIds: [] }));
      localStorage.setItem('debaser.tour.v2', 'skipped');
      localStorage.setItem('debaser.lost-account.never.v1', '1');
      localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: { [user.id]: { userId: user.id, displayName: user.displayName, bio: '', tags: [], comments: [], updatedAt: user.createdAt, privacySeen: true } } }));
    }, ANN);
    const page = await context.newPage();
    const files = { ok: 0, refused: 0 };
    const strangers = new Set();
    page.on('response', (response) => {
      if (/\/api\/see\/(?:asset|ask|seal)/.test(response.url())) files[response.ok() ? 'ok' : 'refused'] += 1;
    });
    // A request the policy stopped is seen here too, as one that failed: only what was answered, or failed for any other reason, left the browser.
    const other = (request) => !request.url().startsWith(BASE) && !/^(?:data|blob|about|ws):/.test(request.url());
    page.on('response', (response) => other(response.request()) && strangers.add(`ANSWERED ${new URL(response.url()).host}`));
    page.on('requestfailed', (request) => other(request) && !/csp|BLOCKED_BY/i.test(request.failure()?.errorText ?? '') && strangers.add(`${request.failure()?.errorText} ${new URL(request.url()).host}`));
    let line = '';
    let words = 0;
    let reader = '';
    const started = Date.now();
    let took = 0;
    try {
      await page.goto(`${BASE}/browser`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.locator('[data-seeing-address]').fill(address);
      const asked = Date.now();
      await page.locator('[data-seeing-address]').press('Enter');
      await page.waitForFunction(() => /RECONSTRUCTED|REFUSED:/.test(document.querySelector('[data-seeing-status]')?.textContent ?? ''), null, { timeout: 40000 });
      took = Date.now() - asked;
      await page.waitForTimeout(7000);
      line = await page.locator('[data-seeing-status]').innerText();
      if (await page.locator('[data-seeing-frame]').count()) {
        const inner = page.frameLocator('[data-seeing-frame]').frameLocator('iframe');
        words = (await inner.locator('body').innerText({ timeout: 5000 }).catch(() => '')).split(/\s+/).filter(Boolean).length;
        await page.screenshot({ path: join(OUT, `${name}.png`) });
        await page.locator('[data-seeing-lenses]').getByRole('button', { name: '[ READER ]' }).click();
        await page.waitForTimeout(1200);
        reader = (await page.getByText('NO MAIN TEXT FOUND.').count()) ? 'none' : `${(await inner.locator('body').innerText({ timeout: 5000 }).catch(() => '')).split(/\s+/).filter(Boolean).length} words`;
        await page.screenshot({ path: join(OUT, `${name}-reader.png`) });
      } else await page.screenshot({ path: join(OUT, `${name}.png`) });
    } catch (error) {
      line = `FAILED: ${error.message.slice(0, 80)}`;
    }
    console.log(`| ${name} | ${address} | ${line} | ${took} ms | ${words} words | files ${files.ok} ok, ${files.refused} refused | reader ${reader} | strangers ${[...strangers].join(' ') || 'none'} | ${Date.now() - started} |`);
    await context.close();
  }
  await browser.close();
})();
