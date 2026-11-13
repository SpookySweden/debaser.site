/*
 * Titles on the shelf (Luke, 2026-11-13: "make sure they come with their titles here"), driven in a real browser:
 *   node scripts/drive-shelf-titles.cjs [--base https://debaser-site.vercel.app]
 *
 * As TEST ACCOUNT A: two places saved with no title, as places were before titles were kept (an Internet Archive book and a
 * Project Gutenberg book). /read must show each by its real title, never "A BOOK", and write the title onto the place, so
 * the account has it next time. A's two places are deleted at the start and the end.
 */
const path = require('node:path');
const { open, close, installSession, signInTestAccount, testAccountClient } = require('./browser.cjs');

const argv = process.argv.slice(2);
const BASE = (argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'Temp', 'browse');
const REFS = ['internet_archive:dracula-bram-stoker-18970526', 'books:OL16067296W-pg14814'];

let failures = 0;
function ok(condition, message, detail = '') {
  if (!condition) failures += 1;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}${detail ? ` :: ${detail}` : ''}`);
}

(async () => {
  const a = await testAccountClient('A');
  const session = await signInTestAccount('A');
  const cleanUp = () => a.client.from('book_places').delete().eq('person', a.id).in('book_ref', REFS);
  await cleanUp();
  // As they were saved before titles: a page to go back to, and no title.
  const old = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const { error } = await a.client
    .from('book_places')
    .insert(REFS.map((ref, index) => ({ person: a.id, book_ref: ref, cfi: 'epubcfi(/6/4)', place: 0, progress: 0, updated_at: new Date(Date.parse(old) + index * 1000).toISOString() })));
  ok(!error, 'two places with no title, as A', error?.message);
  const before = (await a.client.from('book_places').select('book_ref, title').eq('person', a.id).in('book_ref', REFS)).data ?? [];
  ok(before.length === 2 && before.every((row) => !row.title), 'neither has a title', JSON.stringify(before));

  const opened = await open({ size: [1440, 1000] });
  try {
    await installSession(opened.page, session);
    await opened.page.goto(`${BASE}/read`, { waitUntil: 'domcontentloaded' });
    const never = opened.page.getByRole('button', { name: /NOT NOW/ });
    await opened.page.locator('[data-shelf="reading"]').waitFor({ timeout: 60000 });
    if (await never.count()) await never.first().evaluate((element) => element.click()).catch(() => undefined);
    for (const ref of REFS) {
      const row = opened.page.locator(`[data-shelf="reading"] [data-book="${ref}"]`);
      await row.waitFor({ timeout: 30000 });
      let title = '';
      for (let waited = 0; waited < 30; waited += 1) {
        title = (await row.locator('p.text-key').innerText()).trim();
        if (title !== 'A BOOK') break;
        await opened.page.waitForTimeout(1000);
      }
      ok(title && title !== 'A BOOK', `${ref} shows its title`, title);
      const line = (await row.locator('p.text-label').first().innerText()).trim();
      ok(/^BY /.test(line), 'and its author', line);
    }
    await opened.page.screenshot({ path: path.join(OUT, 'shelf-titles.png') });
  } finally {
    await close(opened);
  }

  let after = [];
  for (let waited = 0; waited < 30; waited += 1) {
    after = (await a.client.from('book_places').select('book_ref, title, updated_at').eq('person', a.id).in('book_ref', REFS)).data ?? [];
    if (after.length === 2 && after.every((row) => row.title)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  ok(after.length === 2 && after.every((row) => row.title), 'both titles are written onto the places', after.map((row) => row.title).join(' | '));
  ok(after.every((row) => Date.parse(row.updated_at) < Date.now() - 24 * 3600 * 1000), 'and LAST READ is left as it was');

  await cleanUp();
  console.log(failures ? `${failures} FAILED` : 'shelf titles: all passed');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
