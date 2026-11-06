/**
 * The site knows who you are at once, however slow the server is (Luke, 2026-11-06: "it seems to take
 * ages to realise if a user is logged in or not"; the database was taking 40 seconds to answer).
 *
 * This drives the real page in Chrome. The session is a made-up one for a made-up person, put in this
 * browser's storage only, and every sign-in request is answered here, so nothing reaches Supabase.
 *
 *   node Temp/check-auth-at-once.cjs                 the local build (`npm run build` first); starts its
 *                                                    own `next start` on :3212 if none is up
 *   node Temp/check-auth-at-once.cjs --url <origin>  any deployed copy, e.g. the live site
 */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3212;
const urlAt = process.argv.indexOf('--url');
const BASE = urlAt === -1 ? `http://127.0.0.1:${PORT}` : process.argv[urlAt + 1].replace(/\/$/, '');
const AT_ONCE_MS = 4000;

const supabaseUrl = readFileSync(path.join(ROOT, '.env.production'), 'utf8').match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)[1].trim();
const STORAGE_KEY = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

const session = () => ({
  access_token: 'made.up.token',
  refresh_token: 'made-up',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: '00000000-0000-4000-8000-00000000a7ce',
    aud: 'authenticated',
    email: 'at-once-check@example.test',
    // Updated on purpose 2026-11-06: an account from before the loss is a lost one now (lost-account.ts), so this reader's is after it.
    created_at: '2026-12-01T00:00:00Z',
    user_metadata: { display_name: 'AT ONCE CHECK' },
  },
});

async function up() {
  try {
    return (await fetch(`${BASE}/forum`)).ok;
  } catch {
    return false;
  }
}

/** Opens /forum with `stored` in storage, the server answering `userReply`. What the top bar settles on, and when. */
async function open(browser, stored, userReply, where = '/forum', tokenReply = (route) => route.fulfill({ status: 504, contentType: 'text/plain', body: 'Gateway Timeout' })) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (stored !== null) {
    await context.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [STORAGE_KEY, JSON.stringify(stored)]);
  }

  const page = await context.newPage();
  let userCalls = 0;
  await page.route('**/auth/v1/user**', async (route) => {
    userCalls += 1;
    await userReply(route);
  });
  await page.route('**/auth/v1/token**', (route) => tokenReply(route));
  // Nothing else of the site's data is needed, and none of it should reach the real database from a check.
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/realtime/v1/**', (route) => route.abort());

  const started = Date.now();
  await page.goto(`${BASE}${where}`, { waitUntil: 'domcontentloaded' });

  return { context, page, started, userCalls: () => userCalls };
}

const logInKey = (page) => page.getByText('LOG IN', { exact: false }).first();
const guestBanner = (page) => page.getByText('UNREGISTERED ENTITY', { exact: false }).first();
const signedOutShows = async (page) => (await logInKey(page).isVisible().catch(() => false)) || (await guestBanner(page).isVisible().catch(() => false));

async function waitForSignedOut(page, ms) {
  await logInKey(page).waitFor({ state: 'visible', timeout: ms });
}

async function neverSignedOut(page, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    assert.equal(await signedOutShows(page), false, 'a signed-in reader was shown as signed out');
    await page.waitForTimeout(150);
  }
}

(async () => {
  let server = null;

  if (urlAt === -1 && !(await up())) {
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
    assert.ok(await up(), `nothing is serving ${BASE}/forum (run npm run build first)`);

    // Signed out: nobody stored, and the server never answers. The page must not wait for it.
    {
      const { context, page, started } = await open(browser, null, () => new Promise(() => {}));
      await waitForSignedOut(page, AT_ONCE_MS);
      console.log(`  ok    signed out: LOG IN drawn after ${Date.now() - started} ms`);
      await context.close();
    }

    // Signed in, server hanging: the account page knows them at once, and the guest state never shows.
    {
      const { context, page, started } = await open(browser, session(), () => new Promise(() => {}), '/account');
      await page.getByText(/at-once-check@example\.test|AT ONCE CHECK/i).first().waitFor({ state: 'visible', timeout: AT_ONCE_MS });
      console.log(`  ok    signed in, server silent: named after ${Date.now() - started} ms`);
      await neverSignedOut(page, 2000);
      console.log('  ok    signed in, server silent: never shown as signed out');
      await context.close();
    }

    // Back after an hour: the stored token has run out, so the sign-in library asks the server for a new
    // one before it says anything. This is the wait people actually sit through.
    {
      const expired = session();
      expired.expires_at = Math.floor(Date.now() / 1000) - 600;
      const { context, page, started } = await open(browser, expired, () => new Promise(() => {}), '/account', () => new Promise(() => {}));
      await page.getByText(/at-once-check@example\.test|AT ONCE CHECK/i).first().waitFor({ state: 'visible', timeout: AT_ONCE_MS });
      console.log(`  ok    back after an hour, server silent: named after ${Date.now() - started} ms`);
      await context.close();
    }

    // Signed in, server fails with a gateway timeout: that isn't signing out.
    {
      const { context, page } = await open(browser, session(), (route) =>
        route.fulfill({ status: 504, contentType: 'text/plain', body: 'Gateway Timeout' }),
      );
      await page.waitForLoadState('load').catch(() => {});
      await neverSignedOut(page, AT_ONCE_MS);
      console.log('  ok    signed in, server answers 504: still signed in');
      await context.close();
    }

    // The server says plainly that the session is over: the server still decides.
    {
      const { context, page, userCalls } = await open(browser, session(), (route) =>
        route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }) }),
      );
      await waitForSignedOut(page, 15000);
      assert.ok(userCalls() > 0, 'the server was never asked');
      console.log('  ok    server says the account is gone: shown as signed out');
      await context.close();
    }

    console.log('PASS check-auth-at-once');
  } finally {
    await browser.close();
    if (server !== null) server.kill();
  }
})().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
