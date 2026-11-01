/*
 * WEB is for signed-in people only (SPEC-media-servers.md decision 4), offline; run by `npm run checks:web`:
 *   npx tsc app/api/web/search/route.ts node_modules/next/types/global.d.ts --outDir Temp/out-web-signed-in --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx
 *
 * - webSignedIn: no token, a blank token or a refused token is signed out; a live one is signed in; the mock
 *   accounts (no auth backend) always pass
 * - the real search route, with Supabase as the auth backend, answers a request with no session 401 and the
 *   plain refusal, before it reads the search or spends the rate limit
 * - the route never lets Vercel's edge keep an answer (`public` / `s-maxage` would hand a signed-in answer to
 *   anyone asking the same address)
 * - the page: /web wraps the stream in the sign-in gate, and the gate shows the stream only when signed in
 */
const { readFileSync } = require('node:fs');
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

const ask = (headers = {}) => new Request('https://debaser.site/api/web/search?q=night', { headers });

async function main() {
  /* ---------------------------------------------------------------- the session test */
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

  /* ---------------------------------------------------------------- the real route */
  const answer = await route.GET(ask());
  same(answer.status, 401, 'the search route answers a signed-out request 401');
  same(await answer.json(), { error: session.SIGNED_OUT_REFUSAL }, 'with the plain refusal and nothing else');
  // A hundred signed-out requests would spend the per-address limit (60 a minute) if the session came second.
  for (let i = 0; i < 100; i += 1) await route.GET(ask());
  const after = await route.GET(ask());
  same(after.status, 401, 'refused before the rate limit: a signed-out caller never spends anyone\'s searches');

  const source = readFileSync(join(ROOT, 'app', 'api', 'web', 'search', 'route.ts'), 'utf8');
  ok(!/s-maxage|['"]public\b/.test(source), 'the route never asks Vercel\'s edge to keep an answer');

  /* ---------------------------------------------------------------- the page */
  const page = readFileSync(join(ROOT, 'app', 'web', 'page.tsx'), 'utf8').replace(/\r\n/g, '\n');
  ok(/<WebSignInGate>[\s\S]*<WebStream \/>[\s\S]*<\/WebSignInGate>/.test(page), '/web draws the stream only inside the sign-in gate');
  const gate = readFileSync(join(ROOT, 'app', 'components', 'WebSignInGate.tsx'), 'utf8');
  ok(/if \(status === 'signed-in'\) return <>\{children\}<\/>;/.test(gate), 'the gate shows the stream for a signed-in reader only');
  ok(/SIGN IN TO USE WEB/.test(gate) && /href="\/account"/.test(gate), 'signed out, it says so in large words and links to sign in');

  asserts.done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
