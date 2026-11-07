/**
 * A sign-up that needs email confirmation says so (bug found 2026-10-25, SPEC-less-text.md follow-up).
 *
 * With confirmation on, Supabase's sign-up hands back the new user and no session. AuthProvider used to
 * set its status back to `loading` for that, so the account page swapped the form - and its
 * "CHECK YOUR EMAIL TO CONFIRM." line - for a LOADING... that never ended.
 *
 * This drives the real page in Chrome. The sign-up request is answered here, in the browser, with the
 * shape Supabase sends when confirmation is pending: nothing reaches Supabase, and no account is made.
 *
 *   node Temp/check-signup-confirm.cjs                    the local build (`npm run build` first); starts
 *                                                         its own `next start` on :3211 if none is up
 *   node Temp/check-signup-confirm.cjs --url <origin>     any deployed copy, e.g. the live site
 */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3211;
const urlAt = process.argv.indexOf('--url');
const BASE = urlAt === -1 ? `http://127.0.0.1:${PORT}` : process.argv[urlAt + 1].replace(/\/$/, '');

async function up() {
  try {
    return (await fetch(`${BASE}/account`)).ok;
  } catch {
    return false;
  }
}

(async () => {
  let server = null;

  if (urlAt === -1 && !(await up())) {
    // The CLI entry under this node, not `npx` with a shell: killing it then kills the server
    // (scripts/capture-qa.cjs has the story).
    server = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    for (let attempt = 0; attempt < 40 && !(await up()); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    assert.ok(await up(), `nothing is serving ${BASE}/account (run npm run build first)`);

    const page = await browser.newPage();
    // Signed-out pages open the lost-account window (LostAccountWindow.tsx), which this check is not about.
    await page.addInitScript(() => window.localStorage.setItem('debaser.lost-account.never.v1', '1'));
    let signUpCalls = 0;

    // The reply GoTrue sends when confirmation is required: the user, and no access token - so
    // `data.session` is null and the repository answers `confirmationRequired`.
    await page.route('**/auth/v1/signup**', (route) => {
      signUpCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-4000-8000-00000000c0de',
          aud: 'authenticated',
          role: '',
          email: 'confirm-check@example.test',
          email_confirmed_at: null,
          confirmation_sent_at: new Date().toISOString(),
          user_metadata: { display_name: 'CONFIRM CHECK' },
          app_metadata: { provider: 'email', providers: ['email'] },
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    });

    await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#account-signup-email', { timeout: 20000 });

    await page.fill('#account-signup-email', 'confirm-check@example.test');
    await page.fill('#account-signup-name', 'CONFIRM CHECK');
    await page.fill('#account-signup-password', 'check-password-1234');
    await page.fill('#account-signup-confirm', 'check-password-1234');
    await page.click('button:has-text("[ CREATE ACCOUNT ]")');

    // Give the answer time to land and the page time to settle on what it draws for it.
    await page.waitForTimeout(3000);

    assert.equal(signUpCalls, 1, 'the sign-up went to the (intercepted) sign-up endpoint once');

    const text = await page.locator('body').innerText();
    assert.match(text, /CHECK YOUR EMAIL TO CONFIRM\./, 'the page tells the new account to confirm by email');
    assert.ok(await page.locator('#account-signup-email').isVisible(), 'the form stays on screen rather than a LOADING... that never ends');
    assert.doesNotMatch(text, /UNREGISTERED ENTITY/, 'and the guest fault is not shown to somebody who just registered');

    console.log(`signup confirm checks passed (${BASE})`);
  } finally {
    await browser.close();
    if (server !== null) server.kill();
  }
})().catch((caught) => {
  console.error(caught instanceof Error ? caught.message : caught);
  process.exitCode = 1;
});
