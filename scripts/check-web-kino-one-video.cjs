/*
 * WEB: a KINO free copy has to play, and its label has to be true (SPEC-kino-sources.md, Luke 2026-11-06); run by `npm run checks:web`:
 *   npx tsc app/lib/web/kino-sources.ts --outDir Temp/out-web-kino-one-video --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - an Archive film must be one video: its player stops after one, so a DVD copy plays a 10-second menu and ends
 * - PUBLIC DOMAIN is said only when Wikidata says so
 * - no evidence of the public domain is asked for, and YouTube's licensed mark decides nothing (Luke, 2026-11-06: "Remove the evidence thing and serve the YouTube videos that are found")
 * - Wikidata calling a film copyrighted still keeps its Archive copy off, which he has not asked to change
 * - a title offers every copy that will play, each saying who holds it and how long it is, so one can be chosen (Luke, 2026-11-06)
 */
const { join } = require('node:path');
const { makeAsserts } = require('./web-search-check-kit.cjs');

const asserts = makeAsserts('WEB KINO one video');
const { same } = asserts;
const k = require(join(__dirname, '..', 'Temp', 'out-web-kino-one-video', 'lib', 'web', 'kino-sources.js'));

const PD = { publicDomain: true, copyrighted: false };
const UNSAID = { publicDomain: false, copyrighted: false };
const BOTH = { publicDomain: true, copyrighted: true };
const video = (name, length) => ({ name, format: 'h.264', length, source: 'original' });
const archive = (files, metadata = {}) => ({ metadata: { mediatype: 'movies', ...metadata }, files });

/* An Archive film */
same(k.archiveVerdict('a', archive([video('film.mp4', '6000')]), PD, 100)?.id, 'a', 'one video: offered');
same(k.archiveVerdict('a', archive([video('VIDEO_TS.mp4', '10'), video('VTS_01_1.mp4', '2500'), video('VTS_01_2.mp4', '2500')]), PD, 90), null, 'a DVD copy in several videos: not offered');
same(k.archiveVerdict('a', archive([video('part1.mp4', '3000'), video('part2.mp4', '3000')]), PD, 90), null, 'a film in two long parts: not offered');
same(k.archiveVerdict('a', archive([video('e1.mp4', '1500'), video('e2.mp4', '1500')]), PD, 25, 'tv')?.id, 'a', 'a show may hold its episodes');
same(k.archiveVerdict('a', archive([video('a-promo.mp4', '30'), video('e1.mp4', '1500')]), PD, 25, 'tv'), null, 'a show that opens on a promo: not offered');

/* The label */
same(k.archiveVerdict('a', archive([video('film.mp4', '6000')]), PD, 100)?.publicDomain, true, 'Archive, Wikidata says public domain: labelled');
same(k.archiveVerdict('a', archive([video('film.mp4', '6000')], { licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/' }), UNSAID, 100)?.publicDomain, false, "Archive, only the uploader's mark: not labelled");

same(k.archiveVerdict('a', archive([video('film.mp4', '6000')]), UNSAID, 100)?.id, 'a', 'Archive, one video and nothing said either way: offered');
same(k.archiveVerdict('a', archive([video('film.mp4', '6000')]), UNSAID, 100)?.publicDomain, false, 'and not labelled');
same(k.archiveVerdict('a', archive([video('film.mp4', '6000')], { licenseurl: 'https://creativecommons.org/licenses/by-nc/4.0/' }), UNSAID, 100)?.id, 'a', 'Archive, a licence with terms: offered');
same(k.archiveVerdict('a', archive([video('film.mp4', '6000')]), { publicDomain: false, copyrighted: true }, 100), null, 'Archive, Wikidata says copyrighted: still not offered');

const upload = (licensedContent) => ({ id: 'AAAAAAAAAAA', status: { privacyStatus: 'public', embeddable: true }, contentDetails: { duration: 'PT1H40M', licensedContent } });
same(k.youtubeVerdict(upload(false), PD, 100, 'SE')?.publicDomain, true, 'YouTube, Wikidata says public domain: labelled');
same(k.youtubeVerdict(upload(true), UNSAID, 100, 'SE')?.publicDomain, false, 'YouTube, a licensed upload: offered, not labelled');
same(k.youtubeVerdict(upload(true), BOTH, 100, 'SE')?.publicDomain, false, 'Wikidata says both: not labelled');
same(k.youtubeVerdict(upload(false), UNSAID, 100, 'SE')?.id, 'AAAAAAAAAAA', 'YouTube, nothing said either way: offered');
same(k.youtubeVerdict(upload(false), UNSAID, 100, 'SE')?.publicDomain, false, 'and not labelled');
same(k.youtubeVerdict(upload(false), BOTH, 100, 'SE')?.publicDomain, false, 'YouTube, Wikidata says both: offered, not labelled');
same(k.youtubeVerdict({ ...upload(false), status: { privacyStatus: 'public', embeddable: false } }, UNSAID, 100, 'SE'), null, 'YouTube, can\'t be embedded: not offered, because it would not play');
same(k.youtubeVerdict({ ...upload(false), contentDetails: { duration: 'PT2M' } }, UNSAID, 100, 'SE'), null, 'YouTube, a trailer\'s length: not offered');

/* Choosing: every copy that will play comes back, not the first on each site */
(async () => {
  const film = { type: 'movie', tmdbId: 123 };
  const long = (id, channelTitle, duration = 'PT1H40M') => ({ id, status: { privacyStatus: 'public', embeddable: true }, contentDetails: { duration }, snippet: { channelTitle, viewCount: 9, title: 'x' }, statistics: { viewCount: '9' } });
  const ARCHIVES = { first: archive([video('a.mp4', '6000')], { title: 'First copy', creator: 'Someone' }), second: archive([video('b.mp4', '5400')], { title: 'Second copy' }), dvd: archive([video('m.mp4', '10'), video('f.mp4', '6000')], { title: 'A DVD' }) };
  const YOUTUBE = [long('AAAAAAAAAAA', 'Channel One'), long('BBBBBBBBBBB', 'Channel Two', 'PT1H30M'), long('CCCCCCCCCCC', 'A trailer', 'PT2M')];
  const row = (site, value) => ({ type: { value: 'movie' }, tmdb: { value: '123' }, site: { value: site }, value: { value } });
  const fetchImpl = async (input) => {
    const url = String(input);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('query.wikidata.org')) return json({ results: { bindings: [row('archive', 'first'), row('archive', 'second'), row('archive', 'dvd'), row('youtube', 'AAAAAAAAAAA'), row('youtube', 'BBBBBBBBBBB'), row('youtube', 'CCCCCCCCCCC')] } });
    if (url.includes('archive.org/metadata/')) return json(ARCHIVES[url.split('/').pop()]);
    if (url.includes('googleapis.com')) { same(new URL(url).searchParams.get('part'), 'status,contentDetails,snippet', 'YouTube is asked for the channel name, and for no counts'); return json({ items: YOUTUBE }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  const answer = await k.readKinoSources([film], 'SE', { fetch: fetchImpl, youtubeKey: 'test' });
  const free = answer['movie-123'].free;
  same(free.map((copy) => copy.id), ['first', 'second', 'AAAAAAAAAAA', 'BBBBBBBBBBB'], 'every copy that will play is offered, and the DVD and the trailer are not');
  same(free.map((copy) => copy.label), ['First copy', 'Second copy', 'Channel One', 'Channel Two'], 'each says what it is: the Archive item\'s title, the YouTube channel');
  same(free.map((copy) => copy.seconds), [6000, 5400, 6000, 5400], 'and how long it is');
  same(free.every((copy) => Object.keys(copy).every((key) => ['platform', 'id', 'publicDomain', 'label', 'seconds'].includes(key))), true, 'and nothing else about it: no counts reach the page');
  same(k.youtubeVerdict(long('AAAAAAAAAAA', '   '), UNSAID, 100, 'SE')?.label, undefined, 'a blank name is no name');
  same(k.youtubeVerdict(long('AAAAAAAAAAA', 'x'.repeat(200)), UNSAID, 100, 'SE')?.label?.length, 80, 'and a long one is cut');
  asserts.done();
})().catch((error) => { console.error(error); process.exit(1); });
