/*
 * Audio and subtitle languages (SPEC-subtitles.md, Luke 2026-11-03; run by `npm run checks:web`, part of `npm run verify`):
 *   npx tsc app/lib/web/subtitles.ts app/lib/web/series-files.ts app/lib/web/row-addresses.ts --outDir Temp/out-web-subtitles --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --resolveJsonModule
 *
 * - subtitles burned into the picture are read from the title (the spec's word list), never from "no subs"
 * - an Archive file name says its language (`.en.vtt`, `.pt-BR.srt`), `.asr.` is AUTO in the item's language
 * - each played video gets the subtitle files named after it or after its upload; a one-video item gets them all
 * - English subtitles are flagged (GB unless the tag names a region); English audio still is not
 * - the default: English on when the audio isn't English and English subtitles exist, human-made before AUTO
 * - a pick carries to the next episode by language and AUTO
 * - SRT becomes WebVTT; a VTT passes; anything else is refused
 * - the pass-through refuses a file the item doesn't list, and a host that isn't archive.org or its file servers,
 *   and never fetches the text through the metadata's (cached) fetch
 * - the archive page's own players are asked to start with English subtitles on foreign-language audio
 */
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'Temp', 'out-web-subtitles', 'lib', 'web');
const subs = require(join(OUT, 'subtitles.js'));
const files = require(join(OUT, 'series-files.js'));
const { startingEmbed, withEnglishSubtitles } = require(join(OUT, 'row-addresses.js'));

// Failing until the last line says otherwise (an early end is a failure, never a silent pass).
process.exitCode = 1;
let passed = 0;
const fail = (message) => {
  console.log(`FAIL ${message}`);
  process.exit(1);
};
const ok = (condition, message) => {
  if (!condition) fail(message);
  passed += 1;
};
const same = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message} (got ${JSON.stringify(a)})`);

/* --- burned in ------------------------------------------------------------------------------------- */

const burned = {
  'Amélie (2001) [ENG SUB]': 'en',
  'Sen to Chihiro english subtitles': 'en',
  'Full movie subbed': 'en',
  'ENGSUB Episode 3': 'en',
  'Le Samouraï VOSTFR': 'fr',
  'Cidade de Deus filme completo legendado': 'pt',
  'El laberinto del fauno subtitulado': 'es',
  'Pelicula completa sub español': 'es',
  'Der Himmel über Berlin (OmU)': 'de',
  'Lola rennt mit deutschen Untertiteln': 'de',
  'La dolce vita sub ita': 'it',
  'Seksmisja napisy PL': 'pl',
  'Japanese subbed anime': 'ja',
  'Subtitled in Spanish': 'es',
  'Episode 4 (subtitles in English)': 'en',
};
for (const [title, language] of Object.entries(burned)) same(subs.burnedInSubtitles(title), language, `burned in: "${title}"`);
for (const title of ['Subscribe for more', 'Subway Surfers gameplay', 'RAW no subs episode 2', 'Episode 2 (without subtitles)', 'Episode 4 RAW (no subtitles in English)','A subtle film', 'Submarine documentary', '']) {
  same(subs.burnedInSubtitles(title), null, `burned in: nothing in "${title}"`);
}

/* --- Archive file names ---------------------------------------------------------------------------- */

same(subs.archiveSubtitleFile('Ep 1.en.vtt', 'ja'), { file: 'Ep 1.en.vtt', stem: 'Ep 1', language: 'en', auto: false }, 'archive: .en.vtt is English');
same(subs.archiveSubtitleFile('Ep 1.pt-BR.srt', null).language, 'pt-BR', 'archive: a region is kept');
same(subs.archiveSubtitleFile('Ep 1.eng.SRT', null).language, 'en', 'archive: a three-letter code, any case');
same(subs.archiveSubtitleFile('Ep 1.English.srt', null).language, 'en', 'archive: a language name');
same(subs.archiveSubtitleFile('Ep 1.asr.srt', 'ja'), { file: 'Ep 1.asr.srt', stem: 'Ep 1', language: 'ja', auto: true }, 'archive: .asr. is AUTO in the item language');
same(subs.archiveSubtitleFile('Ep 1.asr.vtt', null).language, null, 'archive: .asr. with no item language is unknown');
same(subs.archiveSubtitleFile('Episode.01.srt', null), { file: 'Episode.01.srt', stem: 'Episode.01', language: null, auto: false }, 'archive: a number is part of the name');
same(subs.archiveSubtitleFile('Ep 1.mp4', null), null, 'archive: a video is not subtitles');

const item = {
  metadata: { title: 'A Series', language: 'jpn' },
  files: [
    { name: 'Ep 1.mkv', source: 'original', format: 'Matroska' },
    { name: 'Ep 1.mp4', source: 'derivative', format: 'h.264', original: 'Ep 1.mkv' },
    { name: 'Ep 1.en.srt', source: 'original', format: 'SubRip', size: '40000' },
    { name: 'Ep 1.asr.srt', source: 'derivative', format: 'SubRip', original: 'Ep 1.mkv' },
    { name: 'Ep 2.mp4', source: 'original', format: 'MPEG4' },
    { name: 'Ep 2.es.vtt', source: 'original', format: 'Web Video Text Tracks' },
    { name: 'Ep 2.fr.vtt', source: 'original', format: 'Web Video Text Tracks', size: '9000000' },
    { name: 'Ep 3.de.vtt', source: 'original', format: 'Web Video Text Tracks', private: 'true' },
  ],
};
const read = files.parseArchiveSubtitles(item);
same(read.language, 'ja', 'archive: the item language');
same(read.videos['Ep 1.mp4'].map((file) => [file.file, file.language, file.auto]), [['Ep 1.en.srt', 'en', false], ['Ep 1.asr.srt', 'ja', true]], 'archive: a copy shares its upload\'s subtitles');
same(read.videos['Ep 2.mp4'].map((file) => file.file), ['Ep 2.es.vtt'], 'archive: a file over the size cap is left out');
same(Object.keys(read.videos).sort(), ['Ep 1.mp4', 'Ep 2.mp4'], 'archive: a private file belongs to nothing');
same(files.archiveSubtitleLanguages(read).sort(), ['en', 'es', 'ja:auto'], 'archive: the row languages, AUTO marked');
const one = files.parseArchiveSubtitles({ metadata: { language: 'French' }, files: [{ name: 'film.mp4', format: 'h.264' }, { name: 'subs/english.srt', format: 'SubRip' }] });
same(one.videos['film.mp4'].map((file) => file.file), ['subs/english.srt'], 'archive: a one-video item owns every subtitle file');
same(files.parseArchiveSubtitles({ is_dark: true, files: [] }), null, 'archive: a dark item has nothing');
// The episodes read the same as before the shared reader.
same(files.parseArchiveSeries('s', item).episodes.map((episode) => episode.url), ['https://archive.org/download/s/Ep%201.mp4', 'https://archive.org/download/s/Ep%202.mp4'], 'archive: the episodes are unchanged');

/* --- flags, order, default, carry-over ------------------------------------------------------------- */

same(subs.subtitleFlag('en').country, 'GB', 'flag: English subtitles wear GB');
same(subs.subtitleFlag('en-US').country, 'US', 'flag: a region wins');
same(subs.subtitleFlag('es').country, 'ES', 'flag: other languages as the audio flag');
same(subs.subtitleFlag(null), null, 'flag: none for unknown');

const track = (id, language, auto, label = id) => ({ id, language, label, auto });
const yt = [track('a.ja', 'ja', true), track('.fr', 'fr', false), track('a.en', 'en', true), track('.en', 'en', false), track('x', null, false, 'Commentary')];
same(subs.orderSubtitles(yt).map((each) => each.id), ['x', '.en', '.fr', 'a.en', 'a.ja'], 'order: human-made first, AUTO after');
same(subs.defaultSubtitle(yt, 'ja'), '.en', 'default: foreign audio starts on human English');
same(subs.defaultSubtitle([track('a.en', 'en', true), track('.fr', 'fr', false)], 'ja'), 'a.en', 'default: AUTO English when there is no human English');
same(subs.defaultSubtitle(yt, 'en'), null, 'default: English audio starts with none');
same(subs.defaultSubtitle(yt, null), null, 'default: unknown audio starts with none');
same(subs.defaultSubtitle([track('.fr', 'fr', false)], 'ja'), null, 'default: no English, none');
same(subs.audioLanguage(yt, 'fr'), 'ja', 'audio: a machine-made track says what is spoken');
same(subs.audioLanguage([track('.fr', 'fr', false)], 'de'), 'de', 'audio: otherwise the text');
const readsAs = (text) => (/ç|ã/.test(text) ? 'pt' : /ñ/.test(text) ? 'es' : null);
same(subs.seriesAudioLanguage('Año uno', ['a', 'b'], readsAs), 'es', 'series: its own title first');
same(subs.seriesAudioLanguage('Playlist', ['ação 1', 'ação 2', 'ep 3'], readsAs), 'pt', 'series: most episodes agreeing');
same(subs.seriesAudioLanguage('Playlist', ['ação 1', 'ep 2', 'ep 3'], readsAs), null, 'series: not most, no flag');
same(subs.trackForChoice([track('e2.en', 'en', false), track('e2.es', 'es', false)], subs.choiceOf(track('e1.es', 'es', false))), 'e2.es', 'carry: the same language on the next episode');
same(subs.trackForChoice(yt, subs.choiceOf(null)), null, 'carry: OFF stays off');
same(subs.trackForChoice([track('.fr', 'fr', false)], subs.choiceOf(track('.en', 'en', false))), undefined, 'carry: no such language');

/* --- SRT -> WebVTT --------------------------------------------------------------------------------- */

const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello <b>there</b>\r\n\r\n2\r\n00:01:02,03 --> 00:01:04,000\r\nTwo\r\nlines\r\n\r\n3\r\n00:01:05,000 --> 00:01:06,000\r\nleft --> right\r\n';
same(subs.toWebVtt(srt), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello <b>there</b>\n\n00:01:02.030 --> 00:01:04.000\nTwo\nlines\n\n00:01:05.000 --> 00:01:06.000\nleft -> right\n', 'vtt: SRT converted (an arrow inside a cue cannot end it)');
same(subs.toWebVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nhi\n'), 'WEBVTT\n\n00:01.000 --> 00:02.000\nhi\n', 'vtt: a VTT passes');
same(subs.toWebVtt('<html><body>Not found</body></html>'), null, 'vtt: a web page is refused');

/* --- the pass-through route's reader --------------------------------------------------------------- */

const fakeResponse = (status, body, headers = {}) => new Response(status >= 300 && status < 400 ? null : body, { status, headers });
(async () => {
  const metadataFetch = async (url) => {
    if (url.startsWith('https://archive.org/metadata/s')) return fakeResponse(200, JSON.stringify(item));
    fail(`metadata fetch asked for ${url}`);
  };
  const asked = [];
  const textFetch = (redirect) => async (url) => {
    asked.push(url);
    if (url === 'https://archive.org/download/s/Ep%201.en.srt') return fakeResponse(302, null, { location: redirect });
    if (url.endsWith('.archive.org/7/items/s/Ep%201.en.srt') || url.startsWith('https://evil.example')) return fakeResponse(200, srt);
    return fakeResponse(404, 'no');
  };

  const vtt = await files.readArchiveSubtitleText('s', 'Ep 1.en.srt', { fetch: metadataFetch, textFetch: textFetch('https://ia800300.us.archive.org/7/items/s/Ep%201.en.srt') });
  ok(typeof vtt === 'string' && vtt.startsWith('WEBVTT\n\n00:00:01.000'), 'route: a listed file passes, converted, via the file server');
  same(asked, ['https://archive.org/download/s/Ep%201.en.srt', 'https://ia800300.us.archive.org/7/items/s/Ep%201.en.srt'], 'route: the text comes through textFetch only');

  // With no textFetch the plain fetch is used, never the metadata's cached one.
  asked.length = 0;
  const plainFetch = globalThis.fetch;
  globalThis.fetch = textFetch('https://ia800300.us.archive.org/7/items/s/Ep%201.en.srt');
  try {
    ok(typeof (await files.readArchiveSubtitleText('s', 'Ep 1.en.srt', { fetch: metadataFetch })) === 'string' && asked.length === 2, 'route: the text never goes through the cached fetch');
  } finally {
    globalThis.fetch = plainFetch;
  }

  asked.length = 0;
  same(await files.readArchiveSubtitleText('s', 'Ep 3.de.vtt', { fetch: metadataFetch, textFetch: textFetch('') }), null, 'route: a file the item does not list is refused');
  same(await files.readArchiveSubtitleText('s', 'Ep 1.mp4', { fetch: metadataFetch, textFetch: textFetch('') }), null, 'route: a video is refused');
  same(await files.readArchiveSubtitleText('s', '../other/x.vtt', { fetch: metadataFetch, textFetch: textFetch('') }), null, 'route: a path out of the item is refused');
  same(await files.readArchiveSubtitleText('s/../x', 'Ep 1.en.srt', { fetch: metadataFetch, textFetch: textFetch('') }), null, 'route: a bad item id is refused');
  same(asked, [], 'route: nothing refused was fetched');

  let refused = null;
  try {
    await files.readArchiveSubtitleText('s', 'Ep 1.en.srt', { fetch: metadataFetch, textFetch: textFetch('https://evil.example/7/items/s/Ep%201.en.srt') });
  } catch (error) {
    refused = error;
  }
  ok(refused instanceof Error && /host not allowed/.test(refused.message), 'route: a redirect off archive.org is refused');
  refused = null;
  try {
    await files.readArchiveSubtitleText('s', 'Ep 1.en.srt', { fetch: metadataFetch, textFetch: textFetch('https://ia800300.us.archive.org.evil.example/7/items/s/Ep%201.en.srt') });
  } catch (error) {
    refused = error;
  }
  ok(refused instanceof Error && /host not allowed/.test(refused.message), 'route: a look-alike file server is refused');

  /* --- the archive page's own players ------------------------------------------------------------ */

  const yte = 'https://www.youtube-nocookie.com/embed/abcdefghijk';
  const asks = (url) => Object.fromEntries([...new URL(url).searchParams].sort());
  same(asks(startingEmbed(yte, 'youtube', 'ja')), { autoplay: '1', cc_lang_pref: 'en', cc_load_policy: '1' }, 'row player: YouTube asked for English subtitles on foreign audio');
  same(asks(withEnglishSubtitles('https://framatube.org/videos/embed/11111111-2222-3333-4444-555555555555', 'peertube', 'ja')), { subtitle: 'en' }, 'room player: PeerTube asked for English, never told to start by itself');
  same(startingEmbed(yte, 'youtube', 'en'), `${yte}?autoplay=1`, 'row player: not on English audio');
  same(startingEmbed(yte, 'youtube', null), `${yte}?autoplay=1`, 'row player: not on unknown audio');
  ok(new URL(startingEmbed('https://player.vimeo.com/video/123', 'vimeo', 'fr')).searchParams.get('texttrack') === 'en', 'row player: Vimeo texttrack=en');
  ok(new URL(startingEmbed('https://framatube.org/videos/embed/11111111-2222-3333-4444-555555555555', 'peertube', 'fr')).searchParams.get('subtitle') === 'en', 'row player: PeerTube subtitle=en');

  console.log(`check-web-subtitles: ${passed} passed`);
  process.exitCode = 0;
})().catch((error) => fail(error.stack ?? String(error)));
