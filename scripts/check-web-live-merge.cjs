/*
 * WEB one live search: how arriving results join the list, offline (SPEC-web-search.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/live-merge.ts --outDir Temp/out-web-live-merge --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - each item shows once: the same platform:externalId from the stream and a live source, or an ALSO ON copy, is one row
 * - before the reader scrolls or presses anything, arrivals slot in newest first
 * - after, nothing moves: arrivals wait behind "N MORE RESULTS"; pressing it puts them at the top, newest first
 * - LOAD MORE's arrivals go at the end, never above what is shown
 * - the page asks every live source on its own (one request each) and the stream at the same time; the client's
 *   list of live sources is the server's
 * - no switch: one search box; a slow source is a status line, not a wait
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { makeAsserts } = require('./web-search-check-kit.cjs');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-live-merge', 'lib', 'web');
const { arrive, freeze, release, EMPTY_LIVE } = require(join(OUT, 'live-merge.js'));
const asserts = makeAsserts('WEB one live search: merging arrivals');
const { ok, same } = asserts;

const row = (id, publishedAt, alsoOn = []) => ({ id, platform: id.split(':')[0], externalId: id.split(':')[1], publishedAt, title: id, alsoOn });
const ids = (items) => items.map((item) => item.id);

/* ---------------------------------------------------------------- once each */
let list = arrive(EMPTY_LIVE, [row('youtube:a', '2026-05-01T00:00:00.000Z'), row('peertube:b', '2026-03-01T00:00:00.000Z', [row('internet_archive:c', '2026-03-01T00:00:00.000Z')])]);
same(ids(list.shown), ['youtube:a', 'peertube:b'], 'stream rows in');
list = arrive(list, [row('youtube:a', '2026-05-01T00:00:00.000Z'), row('internet_archive:c', '2026-03-01T00:00:00.000Z'), row('youtube:d', '2026-04-01T00:00:00.000Z'), row('youtube:d', '2026-04-01T00:00:00.000Z')]);
same(ids(list.shown), ['youtube:a', 'youtube:d', 'peertube:b'], 'a live copy of a stream row, an ALSO ON copy and a repeat each show once; the new one slots in newest first');
same(arrive(list, [row('youtube:a', '2026-05-01T00:00:00.000Z')]), list, 'nothing new: the same list back (no re-render)');

/* ---------------------------------------------------------------- frozen */
const before = list.shown;
list = freeze(list);
list = arrive(list, [row('openverse:e', '2026-12-01T00:00:00.000Z'), row('openverse:f', '2026-01-01T00:00:00.000Z')]);
same(ids(list.shown), ids(before), 'after the reader scrolls nothing is added above or between their rows');
same(ids(list.held), ['openverse:e', 'openverse:f'], 'the arrivals wait');
list = arrive(list, [row('openverse:e', '2026-12-01T00:00:00.000Z')]);
same(list.held.length, 2, 'a held result is not held twice');
list = release(list);
same(ids(list.shown), ['openverse:e', 'openverse:f', 'youtube:a', 'youtube:d', 'peertube:b'], 'MORE RESULTS puts them at the top, newest first');
same(list.held.length, 0, 'none held after');
ok(list.frozen, 'still frozen after');
same(release(list), list, 'releasing nothing changes nothing');

/* ---------------------------------------------------------------- LOAD MORE */
const shownBefore = ids(list.shown);
list = arrive(list, [row('youtube:g', '2027-01-01T00:00:00.000Z'), row('youtube:h', '2020-01-01T00:00:00.000Z')], true);
same(ids(list.shown), [...shownBefore, 'youtube:g', 'youtube:h'], "LOAD MORE's arrivals go at the end, newest first among themselves");
const open = arrive(EMPTY_LIVE, [row('youtube:x', '2020-01-01T00:00:00.000Z')]);
same(ids(arrive(open, [row('youtube:y', '2030-01-01T00:00:00.000Z')], true).shown), ['youtube:x', 'youtube:y'], '... even before the reader scrolled');

/* ---------------------------------------------------------------- the page */
const client = readFileSync(join(ROOT, 'app/lib/web/everywhere-client.ts'), 'utf8');
// The live sources and what each can return live in web-filters.ts since the SOURCE / TYPE filters.
const filters = readFileSync(join(ROOT, 'app/lib/web/web-filters.ts'), 'utf8');
const live = filters.match(/LIVE_SOURCE_KINDS[^=]*= \{([^}]*)\}/);
ok(live, 'the client lists its live sources');
const clientList = [...live[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]).sort();
const index = readFileSync(join(ROOT, 'app/lib/web/search/index.ts'), 'utf8');
const serverBlock = index.match(/SEARCH_PROVIDERS: readonly SearchProvider\[\] = \[([^\]]*)\]/)[1];
const NAMES = { internetArchiveSearch: 'internet_archive', youtubeSearch: 'youtube', peertubeSearch: 'peertube', wikimediaCommonsSearch: 'wikimedia_commons', openverseSearch: 'openverse' };
const serverList = [...serverBlock.matchAll(/(\w+Search)/g)].map((m) => NAMES[m[1]]).sort();
same(clientList, serverList, "the page asks exactly the server's live sources");
ok(/params\.set\('provider', provider\)/.test(client), 'each source is asked on its own');

const page = readFileSync(join(ROOT, 'app/components/WebStream.tsx'), 'utf8');
ok(!/EVERYWHERE \]|\[ STREAM \]|switchScope/.test(page), 'no STREAM / EVERYWHERE switch');
// Since the SOURCE / TYPE filters, a search asks the stream and every live source the filters allow
// (web-filters.ts sourcesToAsk, held by check-web-filters.cjs).
ok(/const plan = sourcesToAsk\(shown\.filters\);/.test(page) && /\[\.\.\.stream, \.\.\.plan\.live\]/.test(page), 'a search asks the stream and every live source the filters allow');
ok(/for \(const source of sources\) ask\(asked, source, next, null, false\);/.test(page), '... each one at once, not one after another');
// The rows the filters allow (`items`, check-web-filters.cjs) join as they arrive.
ok(/arrive\(current, items, end\)/.test(page), 'each answer joins the list as it arrives');
ok(/\['wheel', 'touchmove', 'pointerdown', 'keydown'\]/.test(page) && /freeze\(current\)/.test(page), 'scrolling or pressing anything freezes the list');
ok(/MORE RESULTS/.test(page) && /setList\(release\)/.test(page), 'the held results are one press away');
ok(!/Promise\.all\(/.test(page), 'the page never waits for every source together');

asserts.done();
