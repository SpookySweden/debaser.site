/*
 * MEDIA (WEB in the code) is open to signed-out visitors since 2026-11-09 (Luke: "remove the need to be signed in to access
 * the media tab", then "Everything"). Until then this check proved the opposite (SPEC-media-servers.md decision 4, as it was).
 * Offline; run by `npm run checks:web`:
 *   npx tsc app/api/web/search/route.ts app/lib/web/web-session.ts node_modules/next/types/global.d.ts --outDir Temp/out-web-signed-in --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx
 *
 * - webSignedIn, still the lock on the account-only routes: no token, a blank token or a refused token is signed out; a
 *   live one is signed in; the mock accounts (no auth backend) always pass
 * - readerToken, for the open routes that read as the reader: a live account's token is used, anything else reads as a
 *   visitor (null), and only real bearer tokens are ever sent to Supabase
 * - the real search route, with Supabase as the auth backend, answers a request with no session (a 400 for a source that
 *   doesn't exist, so nothing is fetched), and a visitor still meets the per-address limit (the cost guard)
 * - the route never lets Vercel's edge keep an answer
 * - the page: /media draws the stream with no sign-in gate around it
 * What still refuses a visitor, asked live: Temp/check-media-visitors.cjs.
 */
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { makeAsserts } = require('./web-search-check-kit.cjs');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-signed-in');
const asserts = makeAsserts('WEB signed in');
const { ok, same } = asserts;

// Supabase as the auth backend, so the mock-accounts pass does not apply. Set before anything is loaded:
// the backend is read once, when auth-repository loads.
process.env.NEXT_PUBLIC_AUTH_BACKEND = 'supabase';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-test-key';

const session = require(join(OUT, 'lib', 'web', 'web-session.js'));
const route = require(join(OUT, 'api', 'web', 'search', 'route.js'));

const ask = (headers = {}, query = 'q=night') => new Request(`https://debaser.site/api/web/search?${query}`, { headers });

async function main() {
  /* ---------------------------------------------------------------- the session test (account-only routes) */
  const seen = [];
  const check = async (token) => {
    seen.push(token);
    return token === 'live-token';
  };
  same(await session.webSignedIn(ask(), false, check), false, 'no Authorization header: signed out');
  same(await session.webSignedIn(ask({ Authorization: 'Bearer ' }), false, check), false, 'a blank token: signed out');
  same(await session.webSignedIn(ask({ Authorization: 'Basic live-token' }), false, check), false, 'not a bearer token: signed out');
  same(await session.webSignedIn(ask({ Authorization: 'Bearer stale-token' }), false, check), false, 'a token Supabase refuses: signed out');
  same(await session.webSignedIn(ask({ Authorization: 'Bearer live-token' }), false, check), true, 'a live token: signed in');
  same(await session.webSignedIn(ask(), true, check), true, 'the mock accounts: always let through (no session exists to show)');
  same(seen, ['stale-token', 'live-token'], 'only real bearer tokens are ever sent to Supabase');

  /* ---------------------------------------------------------------- the reader's token (open routes) */
  seen.length = 0;
  same(await session.readerToken(ask(), check), null, 'no Authorization header: read as a visitor');
  same(await session.readerToken(ask({ Authorization: 'Bearer ' }), check), null, 'a blank token: read as a visitor');
  same(await session.readerToken(ask({ Authorization: 'Basic live-token' }), check), null, 'not a bearer token: read as a visitor');
  same(await session.readerToken(ask({ Authorization: 'Bearer stale-token' }), check), null, 'a refused (or guest) token: read as a visitor, never passed on');
  same(await session.readerToken(ask({ Authorization: 'Bearer live-token' }), check), 'live-token', 'a live account: read as them');
  same(seen, ['stale-token', 'live-token'], 'only real bearer tokens are ever sent to Supabase');

  /* ---------------------------------------------------------------- the real route, signed out */
  const visitor = { 'x-forwarded-for': '203.0.113.9' };
  const answer = await route.GET(ask(visitor, 'q=night&provider=nowhere'));
  same(answer.status, 400, 'the search route answers a request with no session (here, that the source does not exist)');
  same(await answer.json(), { error: 'There is no such source.' }, 'with the route\'s own answer, not a sign-in refusal');
  // The per-address limit is 60 a minute; this visitor has used one.
  for (let i = 0; i < 59; i += 1) await route.GET(ask(visitor, 'q=night&provider=nowhere'));
  const after = await route.GET(ask(visitor, 'q=night&provider=nowhere'));
  same(after.status, 429, 'a visitor meets the per-address limit like anyone: the cost guard holds with the sign-in gone');

  const source = readFileSync(join(ROOT, 'app', 'api', 'web', 'search', 'route.ts'), 'utf8');
  ok(!/s-maxage|['"]public\b/.test(source), 'the route never asks Vercel\'s edge to keep an answer');
  ok(!source.includes('webSignedIn'), 'the search route has no sign-in refusal');

  /* ---------------------------------------------------------------- the page */
  const page = readFileSync(join(ROOT, 'app', 'media', 'page.tsx'), 'utf8').replace(/\r\n/g, '\n');
  ok(/<Suspense fallback=\{null\}>\s*<WebStream \/>\s*<\/Suspense>/.test(page), '/media draws the stream for everyone');
  ok(!/SignInGate/.test(page), 'with no sign-in gate around it');
  ok(!existsSync(join(ROOT, 'app', 'components', 'WebSignInGate.tsx')), 'the old gate is gone');

  asserts.done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
