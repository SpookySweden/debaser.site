/*
 * WEB: where a KINO title can be watched (SPEC-kino-sources.md, Luke 2026-11-06), offline; run by `npm run checks:web`:
 *   npx tsc app/api/web/kino/sources/route.ts node_modules/next/types/global.d.ts --outDir Temp/out-web-kino-sources --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx
 *
 * - where to watch: one country only, service names only, no logo, address, rating or vote; nothing there is null
 * - Wikidata: only checked numbers reach the question; a trailer or other side video is dropped; an impossible id is dropped
 * - an Archive copy needs a public video item, long enough, not called copyrighted, with public-domain evidence
 * - a YouTube copy needs to be public, embeddable, long enough and public domain; a stranger's upload of a film under
 *   copyright is never offered, YouTube's rights-partner flag or not, and without the key nothing is
 * - the reader: only the expected hosts; the project's name and no contact to Wikidata and the Archive; every failure
 *   leaves the row with fewer choices and no error; never a key in an answer
 * - the route: signed-out refused first; only well-formed titles; never kept at Vercel's edge; the JustWatch credit is drawn
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { makeAsserts } = require('./web-search-check-kit.cjs');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-kino-sources');
const asserts = makeAsserts('WEB KINO sources');
const { ok, same } = asserts;

process.env.NEXT_PUBLIC_AUTH_BACKEND = 'supabase';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-test-key';

const k = require(join(OUT, 'lib', 'web', 'kino-sources.js'));
const tmdb = require(join(OUT, 'lib', 'web', 'tmdb.js'));
const kino = require(join(OUT, 'lib', 'web', 'kino.js'));
const route = require(join(OUT, 'api', 'web', 'kino', 'sources', 'route.js'));

/* ---------------------------------------------------------------- where to watch */
const PROVIDERS = {
  title: 'A Film',
  runtime: 100,
  'watch/providers': {
    results: {
      SE: {
        link: 'https://evil.example/not-used',
        flatrate: [{ provider_name: 'Second', display_priority: 2, logo_path: '/x.jpg', provider_id: 9 }, { provider_name: 'First', display_priority: 1 }],
        rent: [{ provider_name: 'Rent <b>Shop</b>', display_priority: 1 }],
        buy: [{ provider_name: 'Rent Shop', display_priority: 1 }],
        ads: [{ provider_name: 'Tubi' }],
      },
      US: { flatrate: [{ provider_name: 'Elsewhere' }] },
      NO: {},
    },
  },
};
const offer = tmdb.toWatchOffer(PROVIDERS, 'SE');
same(offer.stream, ['First', 'Second'], "TMDB's own order");
same(offer.ads, ['Tubi'], 'with ads is its own list');
ok(!JSON.stringify(offer).includes('Elsewhere'), "another country's list never comes along");
ok(!/logo|link|https|\/x\.jpg|provider_id|<b>/.test(JSON.stringify(offer)), 'service names only, as plain text');
same(tmdb.toWatchOffer(PROVIDERS, 'FR'), null, 'not listed in the country: null');
same(tmdb.toWatchOffer(PROVIDERS, 'NO'), null, 'an empty listing: null');
same(tmdb.toWatchOffer({}, 'SE'), null, 'no block at all: null');
same(tmdb.toWatchOffer('junk', 'SE'), null, 'not an object: null');
ok(tmdb.detailsWithWatchUrl('movie', 603).startsWith('https://api.themoviedb.org/3/movie/603?') && tmdb.detailsWithWatchUrl('movie', 603).includes('append_to_response=watch%2Fproviders'), 'one answer holds the details and the listing');
same(kino.kinoWatchPage({ type: 'tv', tmdbId: 1399 }, 'SE'), 'https://www.themoviedb.org/tv/1399/watch?locale=SE', "the link is built by us, to TMDB's own page");
same(kino.parseKinoTitleKey('movie-603'), { type: 'movie', tmdbId: 603 }, 'a title key reads');
for (const bad of ['movie-0', 'movie-', 'film-603', 'movie-603 ', 'movie-1234567890', 'tv-1;DROP', '"movie-1"']) same(kino.parseKinoTitleKey(bad), null, `not a title: ${bad}`);

/* ---------------------------------------------------------------- Wikidata */
const q = k.freeCopyQuery([{ type: 'movie', tmdbId: 603 }, { type: 'tv', tmdbId: 1399 }, { type: 'movie', tmdbId: Number.NaN }]);
ok(q.includes('wdt:P4947') && q.includes('"603"') && q.includes('wdt:P4983') && q.includes('"1399"') && !q.includes('NaN'), 'films by P4947, shows by P4983, checked numbers only');
ok(!k.freeCopyQuery([{ type: 'movie', tmdbId: 1 }]).includes('P4983'), 'no shows asked: that half is left out, which an empty list would break');
ok(q.includes('hint:optimizer "None"'), "Wikidata's optimizer stays off (it times out otherwise)");
ok(q.includes('DeprecatedRank'), 'a link Wikidata marks wrong is not read');

const E = 'http://www.wikidata.org/entity/';
const row = (tmdb_, site, value, extra = {}) => ({ type: { value: 'movie' }, tmdb: { value: tmdb_ }, site: { value: site }, value: { value }, ...extra });
const answer = {
  results: {
    bindings: [
      row('1', 'archive', 'good_item', { status: { value: `${E}Q19652` } }),
      row('1', 'youtube', 'AAAAAAAAAAA', { status: { value: `${E}Q19652` } }),
      row('1', 'youtube', 'BBBBBBBBBBB', { role: { value: `${E}Q622550` }, status: { value: `${E}Q19652` } }),
      row('1', 'youtube', 'CCCCCCCCCCC', { role: { value: `${E}Q11424` }, status: { value: `${E}Q19652` } }),
      row('1', 'youtube', 'too-short'),
      row('1', 'archive', '../../evil'),
      row('2', 'youtube', 'DDDDDDDDDDD', { status: { value: `${E}Q50423863` } }),
      row('2', 'youtube', 'DDDDDDDDDDD', { status: { value: `${E}Q19652` } }),
      row('3', 'archive', 'dedicated', { status: { value: `${E}Q88088423` } }),
      { type: { value: 'book' }, tmdb: { value: '9' }, site: { value: 'archive' }, value: { value: 'x' } },
      row('NaN', 'archive', 'x'),
      row('4', 'somewhere', 'x'),
    ],
  },
};
const found = k.parseCandidates(answer);
same(found.get('movie-1').archive, ['good_item'], 'an Archive id the player address could never hold is dropped');
same(found.get('movie-1').youtube, ['AAAAAAAAAAA', 'CCCCCCCCCCC'], 'a trailer is dropped; a video marked as the film itself stays; an impossible id is dropped');
same([found.get('movie-1').publicDomain, found.get('movie-1').copyrighted], [true, false], 'public domain read');
same([found.get('movie-2').publicDomain, found.get('movie-2').copyrighted], [true, true], 'both statuses are both kept: it counts as copyrighted below');
same(found.get('movie-3').publicDomain, true, 'dedicated to the public domain by its owner counts');
same([...found.keys()].sort(), ['movie-1', 'movie-2', 'movie-3'], 'nothing else, whatever the answer holds');
same(k.parseCandidates({}).size, 0, 'a broken answer is no candidates');

/* ---------------------------------------------------------------- an Archive item */
const PD = { publicDomain: true, copyrighted: false };
const UNKNOWN = { publicDomain: false, copyrighted: false };
const NAMED_COPYRIGHTED = { publicDomain: true, copyrighted: true };
const item = (metadata, length = '6000', extra = {}) => ({ metadata: { mediatype: 'movies', ...metadata }, files: [{ name: 'film.mp4', format: 'h.264', length, source: 'original' }], ...extra });
const MARK = { licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/' };
same(k.archiveVerdict('a', item({}), PD, 100), { platform: 'internet_archive', id: 'a' }, 'Wikidata says public domain, a public video item: offered');
same(k.archiveVerdict('a', item(MARK), UNKNOWN, 100)?.id, 'a', "the Archive's own public-domain mark: offered");
same(k.archiveVerdict('a', item({ licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/' }), UNKNOWN, 100)?.id, 'a', 'CC0: offered');
same(k.archiveVerdict('a', item({ licenseurl: 'http://creativecommons.org/licenses/publicdomain/' }), UNKNOWN, 100)?.id, 'a', "the Archive's older public-domain mark: offered");
same(k.archiveVerdict('a', item({ licenseurl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' }), UNKNOWN, 100), null, 'a licence with terms is not evidence here');
same(k.archiveVerdict('a', item({ licenseurl: 'https://evil.example/publicdomain/mark/1.0/' }), UNKNOWN, 100), null, 'only Creative Commons marks count');
same(k.archiveVerdict('a', item({}), UNKNOWN, 100), null, 'a public item with no evidence: NOT offered (most uploads with no status are not plainly legal)');
same(k.archiveVerdict('a', item(MARK), NAMED_COPYRIGHTED, 100), null, 'Wikidata says copyrighted: refused, whatever else is said');
same(k.archiveVerdict('a', item({ 'access-restricted-item': 'true' }), PD, 100), null, 'restricted: refused');
same(k.archiveVerdict('a', item({}, '6000', { is_dark: true }), PD, 100), null, 'dark: refused');
same(k.archiveVerdict('a', {}, PD, 100), null, 'gone: refused');
same(k.archiveVerdict('a', item({ mediatype: 'texts' }), PD, 100), null, 'a scan of the book: refused');
same(k.archiveVerdict('a', { metadata: { mediatype: 'movies' }, files: [{ name: 'notes.txt', format: 'Text' }] }, PD, 100), null, 'no video in it: refused');
same(k.archiveVerdict('a', item({}, '140'), PD, 100), null, 'a two-minute trailer of a 100-minute film: refused');
same(k.archiveVerdict('a', item({}, '3000'), PD, 100)?.id, 'a', 'half the running time passes');
same(k.archiveVerdict('a', item({}, '2999'), PD, 100), null, 'under half does not');
same(k.archiveVerdict('a', item({}, '140'), PD, undefined), null, 'no running time known: a clip still fails');
same(k.archiveVerdict('a', { metadata: { mediatype: 'movies' }, files: [{ name: 'film.mp4', format: 'h.264', source: 'original' }] }, PD, 100)?.id, 'a', 'a video with no length listed is still offered');

/* ---------------------------------------------------------------- a YouTube upload */
const video = (over = {}, details = {}) => ({ id: 'AAAAAAAAAAA', status: { privacyStatus: 'public', embeddable: true, ...over }, contentDetails: { duration: 'PT1H40M', licensedContent: false, ...details } });
same(k.isoSeconds('PT1H24M3S'), 5043, 'a length reads');
same(k.isoSeconds('P1DT2H'), 93600, 'a very long one reads');
same(k.isoSeconds('soon'), null, 'junk is no length');
same(k.isoSeconds('P'), null, 'an empty length is no length');
same(k.youtubeVerdict(video(), PD, 100, 'SE'), { platform: 'youtube', id: 'AAAAAAAAAAA' }, 'a public-domain film, any uploader: offered');
same(k.youtubeVerdict(video(), UNKNOWN, 100, 'SE'), null, "a stranger's upload of a film with no status: NOT offered");
same(k.youtubeVerdict(video(), NAMED_COPYRIGHTED, 100, 'SE'), null, "a stranger's upload of a copyrighted film: NOT offered");
same(k.youtubeVerdict(video({}, { licensedContent: true }), UNKNOWN, 100, 'SE'), null, "YouTube's claimed flag is no evidence: a stranger's claimed upload has it too");
same(k.youtubeVerdict(video({}, { licensedContent: true }), NAMED_COPYRIGHTED, 100, 'SE'), null, 'nor for a film called copyrighted');
same(k.youtubeVerdict(video({ embeddable: false }), PD, 100, 'SE'), null, 'cannot be embedded: refused');
same(k.youtubeVerdict(video({ privacyStatus: 'unlisted' }), PD, 100, 'SE'), null, 'not public: refused');
same(k.youtubeVerdict(video({}, { duration: 'PT2M' }), PD, 100, 'SE'), null, 'a trailer: refused');
same(k.youtubeVerdict(video({}, { contentRating: { ytRating: 'ytAgeRestricted' } }), PD, 100, 'SE'), null, 'age-locked (the embed refuses): refused');
same(k.youtubeVerdict(video({}, { regionRestriction: { blocked: ['SE'] } }), PD, 100, 'SE'), null, 'blocked here: refused');
same(k.youtubeVerdict(video({}, { regionRestriction: { allowed: ['US'] } }), PD, 100, 'SE'), null, 'not allowed here: refused');
same(k.youtubeVerdict(video({}, { regionRestriction: { blocked: ['US'] } }), PD, 100, 'SE')?.id, 'AAAAAAAAAAA', "blocked somewhere else doesn't matter");
same(k.youtubeVerdict(undefined, PD, 100, 'SE'), null, 'YouTube has no such video: refused');
same(k.youtubeVerdict({ ...video(), id: '../evil' }, PD, 100, 'SE'), null, 'an impossible id: refused');

/* ---------------------------------------------------------------- the country */
same(k.viewerCountry(new Headers({ 'x-vercel-ip-country': 'se' })), 'SE', "Vercel's country");
same(k.viewerCountry(new Headers({ 'x-vercel-ip-country': 'XXX', 'accept-language': 'de-AT,de;q=0.9' })), 'AT', "then the browser's");
same(k.viewerCountry(new Headers({ 'accept-language': 'en' })), 'US', 'then the US');

/* ---------------------------------------------------------------- the reader */
function world(over = {}) {
  const asked = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    asked.push({ host: u.hostname, url, agent: init?.headers?.['User-Agent'], auth: init?.headers?.Authorization });
    const say = (body, status = 200) => new Response(JSON.stringify(body), { status });
    const handler = over[u.hostname];
    if (handler) return handler(u, say);
    if (u.hostname === 'api.themoviedb.org') return say(PROVIDERS);
    if (u.hostname === 'query.wikidata.org') return say({ results: { bindings: [row('603', 'archive', 'bad_item', { status: { value: `${E}Q19652` } }), row('603', 'archive', 'good_item', { status: { value: `${E}Q19652` } }), row('603', 'youtube', 'AAAAAAAAAAA', { status: { value: `${E}Q19652` } })] } });
    if (u.hostname === 'archive.org') return say(u.pathname.endsWith('bad_item') ? item({ 'access-restricted-item': 'true' }) : item({}));
    if (u.hostname === 'www.googleapis.com') return say({ items: [video()] });
    return say({}, 500);
  };
  return { fetch, asked };
}
const secretEnv = process.env.WEB_FETCH_CONTACT;

async function main() {
  process.env.WEB_FETCH_CONTACT = 'someone@example.com';
  const titles = [{ type: 'movie', tmdbId: 603 }, { type: 'tv', tmdbId: 1399 }];
  const all = world();
  const full = await k.readKinoSources(titles, 'SE', { fetch: all.fetch, tmdbToken: 'tmdb-secret', youtubeKey: 'yt-secret' });
  same(full['movie-603'].free, [{ platform: 'internet_archive', id: 'good_item' }, { platform: 'youtube', id: 'AAAAAAAAAAA' }], 'the restricted item is passed over; one copy per site');
  same(full['movie-603'].watch.stream, ['First', 'Second'], 'the country asked for');
  same(full['tv-1399'].free, [], 'a title with no links: none');
  ok(!JSON.stringify(full).includes('secret'), 'no key in the answer');
  same([...new Set(all.asked.map((a) => a.host))].sort(), ['api.themoviedb.org', 'archive.org', 'query.wikidata.org', 'www.googleapis.com'], 'those four hosts and no others');
  ok(all.asked.filter((a) => a.host === 'query.wikidata.org' || a.host === 'archive.org').every((a) => a.agent === 'DebaserSiteKino/1.0 (+https://github.com/SpookySweden/debaser.site)'), 'Wikidata and the Archive are told the project address, never a person');
  ok(all.asked.filter((a) => a.host !== 'api.themoviedb.org').every((a) => a.auth === undefined), 'the TMDB token goes to TMDB alone');
  ok(all.asked.filter((a) => a.host === 'api.themoviedb.org').every((a) => a.auth === 'Bearer tmdb-secret' && !a.url.includes('tmdb-secret')), "TMDB's token is a header, never in an address");
  same(all.asked.filter((a) => a.host === 'query.wikidata.org').length, 1, 'one question to Wikidata for the whole page');
  process.env.WEB_FETCH_CONTACT = secretEnv ?? '';

  const nokey = world();
  const without = await k.readKinoSources(titles, 'SE', { fetch: nokey.fetch });
  same(without['movie-603'].free.map((c) => c.platform), ['internet_archive'], 'no YouTube key: nothing from YouTube, because nothing could be checked');
  same(without['movie-603'].watch, null, 'no TMDB token: no listing, no error');
  ok(!nokey.asked.some((a) => a.host === 'api.themoviedb.org' || a.host === 'www.googleapis.com'), 'and neither is asked');

  const refusing = async (u, say) => say({}, 500);
  for (const host of ['query.wikidata.org', 'archive.org', 'www.googleapis.com', 'api.themoviedb.org']) {
    const broken = world({ [host]: refusing });
    const read = await k.readKinoSources(titles, 'SE', { fetch: broken.fetch, tmdbToken: 'x', youtubeKey: 'y' });
    ok(read['movie-603'] !== undefined && read['tv-1399'] !== undefined, `${host} failing: every title still answers`);
  }
  const noWiki = await k.readKinoSources(titles, 'SE', { fetch: world({ 'query.wikidata.org': refusing }).fetch, tmdbToken: 'x', youtubeKey: 'y' });
  same(noWiki['movie-603'].free, [], 'Wikidata failing: no copies');
  ok(noWiki['movie-603'].watch !== null, 'and the listing still shows');
  const thrown = await k.readKinoSources(titles, 'SE', { fetch: async () => { throw new Error('offline'); }, tmdbToken: 'x', youtubeKey: 'y' });
  same(thrown['movie-603'], { watch: null, free: [] }, 'offline: nothing, and no throw');

  /* ---------------------------------------------------------------- the route */
  const ask = (query) => new Request(`https://debaser.site/api/web/kino/sources?${query}`);
  const signedOut = await route.GET(ask('titles=movie-603'));
  same(signedOut.status, 401, 'signed out: refused');
  for (let i = 0; i < 100; i += 1) await route.GET(ask('titles=movie-603'));
  same((await route.GET(ask('titles=movie-603'))).status, 401, 'refused before the rate limit');
  const source = readFileSync(join(ROOT, 'app', 'api', 'web', 'kino', 'sources', 'route.ts'), 'utf8');
  ok(!/s-maxage|['"]public\b/.test(source) && source.includes('no-store'), "an answer is never kept at Vercel's edge");
  ok(source.indexOf('webSignedIn(request)') < source.indexOf('searchParams'), 'the session is read before anything sent');

  const rowSource = readFileSync(join(ROOT, 'app', 'components', 'KinoSources.tsx'), 'utf8');
  ok(rowSource.includes('data-justwatch-credit') && rowSource.includes('JUSTWATCH'), "the listing credits JustWatch (TMDB's rule)");
  ok(rowSource.includes('officialEmbedUrl(freeCopyEmbed(copy))') && rowSource.includes('WEB_EMBED_SANDBOX'), 'a free copy is checked before it is framed, and sandboxed like every WEB embed');
  ok(!/vote|rating|popularity/i.test(rowSource), 'no rating anywhere on the row');

  asserts.done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
