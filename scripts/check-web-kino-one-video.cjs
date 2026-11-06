/*
 * WEB: a KINO free copy has to play, and its label has to be true (SPEC-kino-sources.md, Luke 2026-11-06); run by `npm run checks:web`:
 *   npx tsc app/lib/web/kino-sources.ts --outDir Temp/out-web-kino-one-video --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - an Archive film must be one video: its player stops after one, so a DVD copy plays a 10-second menu and ends
 * - PUBLIC DOMAIN is said only when Wikidata says so
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

const upload = (licensedContent) => ({ id: 'AAAAAAAAAAA', status: { privacyStatus: 'public', embeddable: true }, contentDetails: { duration: 'PT1H40M', licensedContent } });
same(k.youtubeVerdict(upload(false), PD, 100, 'SE')?.publicDomain, true, 'YouTube, Wikidata says public domain: labelled');
same(k.youtubeVerdict(upload(true), UNSAID, 100, 'SE')?.publicDomain, false, 'YouTube, a licensed upload: offered, not labelled');
same(k.youtubeVerdict(upload(true), BOTH, 100, 'SE')?.publicDomain, false, 'Wikidata says both: not labelled');
same(k.youtubeVerdict(upload(false), UNSAID, 100, 'SE'), null, 'neither public domain nor licensed: not offered');

asserts.done();
