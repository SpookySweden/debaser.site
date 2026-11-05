/*
 * WEB audio in the music bar (Luke's OK 2026-10-31; run by `npm run checks:web`, part of `npm run verify`):
 *   npx tsc app/lib/web/audio-files.ts app/lib/web/row-addresses.ts --outDir Temp/out-web-audio --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --resolveJsonModule
 *
 * - an Archive item gives one format only (the best present), in track order, with each chapter's title,
 *   and its addresses are archive.org/download/<id>/<file>; restricted, dark and audio-less items give nothing
 * - a podcast episode is found by the same id the stream gave it, and only its https audio enclosure is used
 * - Openverse gives its work's https file; anything else (http-only junk, credentials) gives nothing
 * - the page is told titles and running times, never a platform's file address
 * - a track's src is our own redirect address, and only those parse back to an item
 * - the player address gets `autoplay=1` and nothing else, and only on the platforms that honour it
 * - the file route answers with a redirect only, so no audio passes through the site
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-audio', 'lib', 'web');
const files = require(join(OUT, 'audio-files.js'));
const web = require(join(OUT, 'web-audio.js'));
const { startingEmbed } = require(join(OUT, 'row-addresses.js'));
const { episodeExternalId } = require(join(OUT, 'adapters', 'podcast.js'));
const { parseXml, child, children } = require(join(OUT, 'adapters', 'xml.js'));
const { PODCAST_FEEDS } = require(join(OUT, 'hosts.js'));

let passed = 0;
const ok = (condition, message) => {
  if (!condition) {
    console.log(`FAIL ${message}`);
    process.exit(1);
  }
  passed += 1;
};

/* ------------------------------------------------------------------ Internet Archive */
const book = {
  metadata: { title: 'The Art of War', creator: ['Sun Tzu'] },
  files: [
    { name: 'b_03-04.mp3', format: 'VBR MP3', title: '3 Attack', length: '465.67', track: '2' },
    { name: 'b_01-02.mp3', format: 'VBR MP3', title: '1 Laying Plans', length: '507.1', track: '1' },
    { name: 'b_01-02_64kb.mp3', format: '64Kbps MP3', title: '1 Laying Plans', length: '08:26' },
    { name: 'b_01-02.ogg', format: 'Ogg Vorbis', length: '506.3' },
    { name: 'b_secret.mp3', format: 'VBR MP3', private: 'true', track: '3' },
    { name: 'cover.jpg', format: 'JPEG' },
    { name: 'disc 2/b_05.mp3', format: 'VBR MP3', title: '5 Energy', length: '1:02:03', track: '4' },
  ],
};
const ia = files.parseArchiveMetadata('art_of_war_librivox', book);
ok(ia && ia.files.length === 3, 'the Archive book gives its three VBR chapters only (no 64kb, ogg, private or picture)');
ok(ia.files.map((f) => f.title).join('|') === '1 Laying Plans|3 Attack|5 Energy', 'chapters are in track order with their own titles');
ok(ia.files[0].url === 'https://archive.org/download/art_of_war_librivox/b_01-02.mp3', 'a chapter address is archive.org/download/<id>/<file>');
ok(ia.files[2].url === 'https://archive.org/download/art_of_war_librivox/disc%202/b_05.mp3', 'a file in a folder keeps its folder, each part encoded');
ok(ia.files[0].seconds === 507.1 && ia.files[2].seconds === 3723, 'running times read as seconds and h:mm:ss');
ok(ia.title === 'The Art of War' && ia.creator === 'Sun Tzu', 'the item title and creator are kept');
ok(files.parseArchiveMetadata('x', { ...book, metadata: { 'access-restricted-item': 'true' } }) === null, 'a restricted item gives nothing');
ok(files.parseArchiveMetadata('x', { ...book, is_dark: true }) === null, 'a dark item gives nothing');
ok(files.parseArchiveMetadata('x', { metadata: {}, files: [{ name: 'a.pdf', format: 'Text PDF' }] }) === null, 'an item with no audio gives nothing');
ok(files.parseArchiveMetadata('x', { metadata: {}, files: [{ name: '../evil.mp3', format: 'MP3' }] }) === null, 'a file name that climbs out of the item is refused');
const only64 = files.parseArchiveMetadata('x', { metadata: {}, files: [{ name: 'z_02.mp3', format: '64Kbps MP3' }, { name: 'z_01.mp3', format: '64Kbps MP3' }] });
ok(only64 && only64.files.map((f) => f.url.slice(-8)).join('|') === 'z_01.mp3|z_02.mp3', 'with no track numbers, files go in name order');
const untitled = web.webTracks('internet_archive', 'x', { ...files.answerFor(only64), title: 'A Book' });
ok(untitled.map((t) => t.title).join('|') === 'A Book (1)|A Book (2)', 'an untitled chapter is named after the book and its number, never the file');

// (2026-11-05) A one-file audiobook: the Archive labels an .m4b "Audiobook", which was missing, so it "couldn't play in a room".
const m4b = files.parseArchiveMetadata('dune-book', { metadata: { title: 'A Book' }, files: [{ name: 'A Book [Reader].m4b', format: 'Audiobook', source: 'original' }, { name: 'cover.png', format: 'PNG' }] });
ok(m4b && m4b.files.length === 1 && m4b.files[0].url === 'https://archive.org/download/dune-book/A%20Book%20%5BReader%5D.m4b', 'an .m4b audiobook gives its one file, its name encoded');
ok(m4b.files[0].seconds === null, 'with no length listed, which the player finds out');
const both = files.parseArchiveMetadata('x', { metadata: {}, files: [{ name: 'p1.m4b', format: 'Audiobook' }, { name: 'p1.mp3', format: 'VBR MP3', length: '20' }] });
ok(both.files.length === 1 && both.files[0].url.endsWith('/p1.mp3'), 'an item with both uses the MP3 once, never both');
const unknown = files.parseArchiveMetadata('x', { metadata: {}, files: [
  { name: 'b.m4a', format: 'Some New Label', source: 'original' },
  { name: 'a.opus', format: 'Another Label', source: 'original' },
  { name: 'a_copy.opus', format: 'Another Label', source: 'derivative' },
  { name: 'clip.mp3', format: 'MP3 Sample', source: 'original' },
  { name: 'notes.pdf', format: 'Text PDF', source: 'original' },
  { name: 'film.mp4', format: 'Unknown Video', source: 'original' },
] });
ok(unknown && unknown.files.map((f) => f.url.split('/').pop()).join('|') === 'a.opus|b.m4a', 'an unknown label still plays by its file ending: uploads only, no sample, no document, no video');

/* ------------------------------------------------------------------ podcast */
const feed = PODCAST_FEEDS[0];
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Show</title>
<item><title>Episode one</title><guid>ep-1</guid><itunes:author>host@example.org (Ahuka)</itunes:author><enclosure url="https://hub.example.org/ep1.ogg" type="audio/ogg"/><itunes:duration>12:34</itunes:duration></item>
<item><title>Video one</title><guid>ep-2</guid><enclosure url="https://hub.example.org/ep2.mp4" type="video/mp4"/></item>
<item><title>Plain http</title><guid>ep-3</guid><enclosure url="http://hub.example.org/ep3.mp3" type="audio/mpeg"/></item>
<item><title>Credentials</title><guid>ep-4</guid><enclosure url="https://user:pw@hub.example.org/ep4.mp3" type="audio/mpeg"/></item>
</channel></rss>`;
const items = children(child(parseXml(rss), 'channel'), 'item');
const ids = items.map((item) => episodeExternalId(item, feed));
const ep = files.parsePodcastEpisode(rss, ids[0]);
ok(ep && ep.files.length === 1 && ep.files[0].url === 'https://hub.example.org/ep1.ogg', 'the episode is found by its stream id and its enclosure used');
ok(ep.title === 'Episode one' && ep.files[0].seconds === 754, 'the episode title and running time are read');
ok(ep.creator === 'Ahuka', 'the credit is the host name, never an email address');
ok(files.parsePodcastEpisode(rss, ids[1]) === null, 'a video episode is not handed to the music bar');
ok(files.parsePodcastEpisode(rss, ids[2]).files[0].url === 'https://hub.example.org/ep3.mp3', 'a plain-http enclosure is upgraded to https');
ok(files.parsePodcastEpisode(rss, ids[3]) === null, 'an enclosure carrying credentials is refused');
ok(files.parsePodcastEpisode(rss, `${feed.key}-${'0'.repeat(32)}`) === null, 'an unknown episode id gives nothing');
ok(files.parsePodcastEpisode(rss, `nofeed-${'0'.repeat(32)}`) === null, 'an id from no listed feed gives nothing');

/* ------------------------------------------------------------------ Openverse */
const ov = files.parseOpenverseAudio({ mature: false, title: 'Rain', creator: 'Someone', url: 'https://cdn.freesound.org/previews/1/1.mp3', duration: 61500 });
ok(ov && ov.files[0].url === 'https://cdn.freesound.org/previews/1/1.mp3' && ov.files[0].seconds === 62, 'Openverse gives its https file and running time');
ok(files.parseOpenverseAudio({ mature: true, url: 'https://a.example/x.mp3' }) === null, 'a mature Openverse work gives nothing');
ok(files.parseOpenverseAudio({ mature: false, url: 'javascript:alert(1)' }) === null, 'a non-https Openverse address gives nothing');
ok(files.parseOpenverseAudio({ mature: false, url: 'https://a.example:8080/x.mp3' }) === null, 'an address on an odd port gives nothing');

/* ------------------------------------------------------------------ what the page sees */
const answer = files.answerFor(ia);
ok(!JSON.stringify(answer).includes('archive.org'), 'the page is never told the platform file address');
const tracks = web.webTracks('internet_archive', 'art_of_war_librivox', answer);
ok(tracks.length === 3 && tracks.every((t) => t.shelf === 'web'), 'each chapter becomes a web track');
ok(tracks[1].src === '/api/web/audio/internet_archive/art_of_war_librivox/1', 'a track src is our redirect address for that file');
ok(tracks[0].title === '1 Laying Plans' && tracks[0].credit === 'Sun Tzu' && tracks[0].kind === 'INTERNET ARCHIVE', 'a chapter keeps its title, the creator and the source name');
ok(tracks[2].length === '1:02:03' && tracks[0].length === '8:27', 'running times read the way the player lists them');
const single = web.webTracks('podcast', ids[0], files.answerFor(ep));
ok(single[0].title === 'Episode one', 'a single file takes the item title');
ok(web.readWebAudioAnswer({ title: 't', creator: '', files: [] }) === null, 'an answer with no files is not playable');
ok(web.readWebAudioAnswer('<html>') === null, 'an off-shape answer is not playable');

ok(JSON.stringify(web.parseWebAudioSrc(tracks[1].src)) === JSON.stringify({ platform: 'internet_archive', externalId: 'art_of_war_librivox', index: 1 }), 'a web src parses back to its item');
for (const bad of ['/api/web/audio/youtube/abc/0', '/api/web/audio/podcast/../x/0', '/api/web/audio/podcast/x/01', '/api/web/audio/podcast/x/300', 'https://archive.org/download/x/y.mp3', '/assets/audio/a.mp3']) {
  ok(web.parseWebAudioSrc(bad) === null, `not a web track src: ${bad}`);
}
ok(web.playsInBar({ kind: 'audio', platform: 'internet_archive', externalId: 'x' }), 'Archive audio plays in the bar');
ok(!web.playsInBar({ kind: 'video', platform: 'internet_archive', externalId: 'x' }), 'Archive video keeps its own player');
ok(!web.playsInBar({ kind: 'audio', platform: 'wikimedia_commons', externalId: 'x' }), 'Commons audio keeps its own player');

/* ------------------------------------------------------------------ the player starts on PLAY */
ok(startingEmbed('https://www.youtube-nocookie.com/embed/abcdefghijk', 'youtube') === 'https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1', 'YouTube starts at once');
ok(startingEmbed('https://archive.org/embed/x', 'internet_archive') === 'https://archive.org/embed/x?autoplay=1', 'the Archive player starts at once');
ok(startingEmbed('https://commons.wikimedia.org/wiki/File:A.ogg?embedplayer=yes', 'wikimedia_commons') === 'https://commons.wikimedia.org/wiki/File:A.ogg?embedplayer=yes', 'a player not listed is framed as it was');

/* ------------------------------------------------------------------ the routes */
const page = readFileSync(join(ROOT, 'app/components/WebStream.tsx'), 'utf8');
// 2026-11-03 (SPEC-subtitles.md): the row also hands over its language, so a foreign row's player is asked for
// English subtitles (check-web-subtitles.cjs); the address is still the checked one.
ok(/src=\{startingEmbed\(embed, item\.platform(, contentLanguage\(item\))?\)\}/.test(page), 'the row frames the checked address, asked to start');
const fileRoute = readFileSync(join(ROOT, 'app/api/web/audio/[platform]/[id]/[n]/route.ts'), 'utf8');
ok(/status: 302/.test(fileRoute) && /Location: file\.url/.test(fileRoute) && !/\bfetch\(/.test(fileRoute), 'the file route only redirects, and fetches nothing itself');
ok(/'Referrer-Policy': 'no-referrer'/.test(fileRoute), 'the redirect sends no referrer on to the platform');
const listRoute = readFileSync(join(ROOT, 'app/api/web/audio/[platform]/[id]/route.ts'), 'utf8');
ok(/answerFor\(found\.item\)/.test(listRoute), 'the list route answers through answerFor (no file addresses)');

console.log(`ok: ${passed} assertions (WEB audio in the music bar)`);
