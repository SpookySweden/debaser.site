/*
 * WEB search everywhere: the fan-out, the cursor and the rate limit, offline (SPEC-web-search.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/search/run.ts app/lib/web/search/rate-limit.ts --outDir Temp/out-web-search-run --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - every provider is asked at once; a failing one becomes one fixed phrase and the others still answer
 * - a provider that never answers is given up on after its own time limit, so it cannot hold the search
 * - the merged list is newest first, each item once, and a provider cannot answer for another platform
 * - the cursor carries only each provider's next page; LOAD MORE asks only those; a tampered cursor asks nobody
 * - no failure ever carries a platform's own message into the answer
 * - the per-address limit refuses the 21st search in a minute and forgets after the window; IPv6 counts by its /64
 * - a quota-limited provider (YouTube, Openverse) has a daily budget per address and per instance; over it, that
 *   provider says DAILY LIMIT REACHED and is not asked, and the others still answer
 */
const { join } = require('node:path');
const { makeAsserts } = require('./web-search-check-kit.cjs');

const OUT = join(__dirname, '..', 'Temp', 'out-web-search-run', 'lib', 'web');
const { searchEverywhere, problemOf } = require(join(OUT, 'search', 'run.js'));
const { encodeSearchCursor, decodeSearchCursor } = require(join(OUT, 'search', 'cursor.js'));
const { SearchProblemError } = require(join(OUT, 'search', 'types.js'));
const { SafeFetchError } = require(join(OUT, 'safe-fetch.js'));
const { makeRateLimiter, clientAddress, makeDailyBudgets } = require(join(OUT, 'search', 'rate-limit.js'));
const asserts = makeAsserts('WEB search: fan-out, cursor, rate limit');
const { ok, same } = asserts;

const item = (platform, id, publishedAt) => ({
  id: `${platform}:${id}`, platform, externalId: id, kind: 'video', url: 'https://example.org/', canonicalUrl: 'https://example.org/',
  title: id, publishedAt, fetchedAt: publishedAt,
});

function provider(platform, behaviour, timeoutMs = 200) {
  const calls = [];
  return {
    calls,
    platform,
    allowedHosts: [],
    timeoutMs,
    async search(words, page) {
      calls.push({ words, page });
      return behaviour(page);
    },
    async fetchOne() {
      return null;
    },
  };
}

(async () => {
  /* ---------------------------------------------------------------- cursor */
  const PLATFORMS = ['internet_archive', 'youtube', 'peertube'];
  const cursor = encodeSearchCursor({ internet_archive: 2, youtube: 'CAoQAA' });
  same(decodeSearchCursor(cursor, PLATFORMS), { internet_archive: 2, youtube: 'CAoQAA' }, 'a cursor reads back');
  same(encodeSearchCursor({}), null, 'nothing more: no cursor');
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  for (const [bad, why] of [
    [enc({ vimeo: 2 }), 'a platform not searched'],
    [enc({ internet_archive: 10 ** 9 }), 'a huge page'],
    [enc({ internet_archive: -1 }), 'a negative page'],
    [enc({ youtube: 'a b' }), 'a token with a space'],
    [enc({ youtube: 'x'.repeat(121) }), 'a token too long'],
    [enc({ youtube: { $gt: '' } }), 'an object'],
    [enc([1, 2]), 'an array'],
    [enc({}), 'empty'],
    ['not base64!', 'not base64url'],
    ['A'.repeat(1001), 'too long'],
    [enc({ __proto__: { internet_archive: 1 } }), 'a prototype trick'],
  ]) {
    same(decodeSearchCursor(bad, PLATFORMS), null, `a tampered cursor is refused: ${why}`);
  }

  /* ---------------------------------------------------------------- fan-out */
  const ia = provider('internet_archive', (page) => ({ items: [item('internet_archive', `ia${page ?? 1}`, '2026-01-01T00:00:00.000Z')], next: (page ?? 1) + 1 }));
  const yt = provider('youtube', () => {
    throw new SearchProblemError('NOT SET UP');
  });
  const pt = provider('peertube', () => ({
    items: [
      item('peertube', 'new', '2026-05-01T00:00:00.000Z'),
      item('youtube', 'smuggled', '2026-06-01T00:00:00.000Z'),
      item('peertube', 'new', '2026-05-01T00:00:00.000Z'),
    ],
    next: null,
  }));
  const ov = provider('openverse', () => {
    throw new SafeFetchError('timed out');
  });
  const wc = provider('wikimedia_commons', () => new Promise(() => {}), 100);
  const vi = provider('vimeo', () => {
    throw new Error('secret platform message https://api.example/?key=SECRET');
  });
  const started = Date.now();
  const first = await searchEverywhere('night', null, [ia, yt, pt, ov, wc, vi], {});
  const took = Date.now() - started;
  ok(took < 2500, `a provider that never answers is given up on (${took}ms)`);
  same(first.items.map((x) => x.id), ['peertube:new', 'internet_archive:ia1'], 'newest first, once each, nothing smuggled');
  same(
    first.statuses,
    [
      { platform: 'internet_archive', problem: null },
      { platform: 'youtube', problem: 'NOT SET UP' },
      { platform: 'peertube', problem: null },
      { platform: 'openverse', problem: 'NO ANSWER' },
      { platform: 'wikimedia_commons', problem: 'NO ANSWER' },
      { platform: 'vimeo', problem: 'COULD NOT READ' },
    ],
    'one fixed phrase per failing provider',
  );
  ok(!JSON.stringify(first).includes('SECRET') && !JSON.stringify(first).includes('api.example'), 'no platform message reaches the answer');
  same(ia.calls, [{ words: 'night', page: null }], 'a new search asks for the first page');
  same(decodeSearchCursor(first.nextCursor, ['internet_archive', 'peertube', 'youtube']), { internet_archive: 2 }, 'the cursor holds only who has more');

  const more = await searchEverywhere('night', first.nextCursor, [ia, yt, pt], {});
  same(ia.calls[1], { words: 'night', page: 2 }, 'LOAD MORE asks for the next page');
  same(yt.calls.length, 1, 'LOAD MORE does not ask a provider that had no more');
  same(pt.calls.length, 1, '... nor one that finished');
  same(more.items.map((x) => x.id), ['internet_archive:ia2'], 'the next page');
  same(more.statuses.map((s) => s.platform), ['internet_archive'], 'statuses only for who was asked');

  const tampered = await searchEverywhere('night', 'garbage', [ia, yt, pt], {});
  same(tampered, { items: [], statuses: [], nextCursor: null }, 'a tampered cursor is the end, not a new search');
  same(ia.calls.length, 2, '... and asks nobody');

  same(problemOf(new SafeFetchError('HTTP 429', 429)), 'DAILY LIMIT REACHED', '429 is a limit');
  same(problemOf(new SafeFetchError('HTTP 500', 500)), 'COULD NOT READ', '500 could not read');
  same(problemOf(new SafeFetchError('request failed: TypeError')), 'NO ANSWER', 'no answer at all');

  /* ---------------------------------------------------------------- rate limit */
  const limiter = makeRateLimiter(20, 60_000);
  let allowed = 0;
  for (let i = 0; i < 25; i += 1) if (limiter.allow('1.2.3.4', 1_000)) allowed += 1;
  same(allowed, 20, '20 searches a minute per address');
  ok(limiter.allow('5.6.7.8', 1_000), 'another address has its own count');
  ok(limiter.allow('1.2.3.4', 62_000), 'the count forgets after the window');
  same(clientAddress(new Headers({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })), '9.9.9.9', 'Vercel\'s x-real-ip first');
  same(clientAddress(new Headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })), '1.1.1.1', 'then the first forwarded hop');
  same(clientAddress(new Headers()), 'unknown', 'else one shared bucket');
  same(clientAddress(new Headers({ 'x-real-ip': '2001:db8:aa:bb:1:2:3:4' })), '2001:db8:aa:bb::/64', 'IPv6 counts by its /64');
  same(clientAddress(new Headers({ 'x-real-ip': '2001:DB8:aa:bb:ffff::9' })), '2001:db8:aa:bb::/64', '... whatever the rest of the address');
  same(clientAddress(new Headers({ 'x-real-ip': '2001:db8::1' })), '2001:db8:0:0::/64', '... zeros filled in');

  /* ---------------------------------------------------------------- daily budgets */
  const quota = provider('youtube', () => ({ items: [item('youtube', 'aqz-KE-bpKQ', '2026-01-01T00:00:00.000Z')], next: null }));
  quota.dailyBudget = { perAddress: 2, perInstance: 3 };
  const free = provider('internet_archive', () => ({ items: [], next: null }));
  const budgets = makeDailyBudgets([quota, free]);
  const outcome = async (address) => (await searchEverywhere('x', null, [quota, free], { spendBudget: budgets(address) })).statuses.map((s) => s.problem);
  same(await outcome('a'), [null, null], 'first search: asked');
  same(await outcome('a'), [null, null], 'second: asked');
  same(await outcome('a'), ['DAILY LIMIT REACHED', null], 'third from the same address: over its budget, the others still answer');
  same(quota.calls.length, 2, '... and YouTube was not asked');
  same(await outcome('b'), [null, null], 'another address has its own budget');
  same(await outcome('c'), ['DAILY LIMIT REACHED', null], 'the instance budget (3) is shared by everyone');
  same(quota.calls.length, 3, '... still not asked over it');
  for (let i = 0; i < 50; i += 1) await outcome('a');
  same(free.calls.length, 55, 'a provider without a budget is always asked');

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${error.stack}`);
  process.exit(1);
});
