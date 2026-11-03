/*
 * Language flags on content (Luke, 2026-11-03; run by `npm run checks:web`, part of `npm run verify`):
 *   npx tsc app/lib/web/language.ts --outDir Temp/out-web-language --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --resolveJsonModule
 *
 * - a platform's own language wins, in any spelling it uses (en-US, pt_BR, eng, Spanish; Castilian)
 * - the alphabet decides Japanese, Korean, Chinese, Arabic/Persian/Urdu, Hebrew, Thai, Greek, Hindi and the
 *   Cyrillic languages; Latin-script languages only when their words leave no doubt
 * - English, mixed and unclear text gets no language (no flag beats a wrong flag)
 * - the flag rule: English never; a region in the tag wins; else the language's home country; a language
 *   with no one country has no flag but is still named
 * - every flag a language can wear is a country with a flag file
 */
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-language');
const { normaliseLanguage, detectLanguage, languageFlag, contentLanguage } = require(join(OUT, 'lib', 'web', 'language.js'));

let passed = 0;
const ok = (condition, message) => {
  if (!condition) {
    console.log(`FAIL ${message}`);
    process.exit(1);
  }
  passed += 1;
};
const is = (actual, expected, message) => ok(actual === expected, `${message}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);

/* ------------------------------------------------------------------ what platforms write */
for (const [raw, tag] of [
  ['en', 'en'], ['en-US', 'en-US'], ['pt_BR', 'pt-BR'], ['PT-br', 'pt-BR'], ['eng', 'en'], ['spa', 'es'], ['fre', 'fr'],
  ['English', 'en'], ['Spanish; Castilian', 'es'], ['Japanese', 'ja'], ['zh-Hant', 'zh-TW'], ['zh-Hant-HK', 'zh-HK'],
  ['es-419', 'es'], ['ger;eng', 'de'], ['', null], ['xx-YY-zz-123', null], ['klingon', null], [42, null], [undefined, null],
]) is(normaliseLanguage(raw), tag, `normalise ${JSON.stringify(raw)}`);

/* ------------------------------------------------------------------ reading titles */
const reads = [
  // Alphabets.
  ['【MV】YOASOBI「アイドル」Official Music Video', 'ja'],
  ['日本の古い映画 完全版', 'ja'],
  ['BTS (방탄소년단) 봄날 Official MV', 'ko'],
  ['周杰倫 Jay Chou【稻香】官方完整版 MV', 'zh'],
  ['عمرو دياب - تملي معاك', 'ar'],
  ['پادکست فارسی درباره تاریخ ایران', 'fa'],
  ['یہ ہے پاکستان کی کہانی بڑی', 'ur'],
  ['שיר ישראלי ישן', 'he'],
  ['เพลงไทยใหม่ล่าสุด 2024', 'th'],
  ['Ελληνική μουσική παλιά', 'el'],
  ['भारत की कहानी हिंदी में', 'hi'],
  ['Кино - Группа крови (клип)', 'ru'],
  ['Мультфильм для детей: Ёжик в тумане', 'ru'],
  ['Українська народна пісня Їхав козак', 'uk'],
  ['Српска музика љубав', 'sr'],
  // Latin script, sure.
  ['Bad Bunny - Tití Me Preguntó (Video Oficial) | Un Verano Sin Ti', 'es'],
  ['Cómo hacer pan casero en casa, la mejor receta', 'es'],
  ['Documentário completo: a história do Brasil em 1 hora', 'pt'],
  ['Les meilleurs moments de la saison - épisode complet', 'fr'],
  ['Die Geschichte der Stadt und ihre Menschen | Doku', 'de'],
  ['La storia della musica italiana che non conosci', 'it'],
  ['Hoe maak je het beste brood? Een recept voor thuis', 'nl'],
  ['Hur man bakar bröd och varför det är svårt', 'sv'],
  ['Jak zrobić najlepszą pizzę w domu? To nie jest trudne', 'pl'],
  ['Türkçe film izle - bu bir komedi, çok güzel', 'tr'],
  ['Cara membuat nasi goreng yang enak untuk keluarga', 'id'],
  ['Hướng dẫn nấu phở bò của người Hà Nội', 'vi'],
  // English reads as English (no flag); mixed or unclear text reads as nothing.
  ['The History of Rome in 20 Minutes', 'en'],
  ['How to Make the Perfect Piñata for a Party', 'en'],
  ['(FREE) Dei V Type Beat - "HALLOWEEN"', null],
  ['Despacito', null],
  ['Café del Mar - Ibiza Chillout Mix', null],
  ['Los Angeles Lakers vs Boston Celtics Full Game Highlights', null],
  ['Ave Maria', null],
  ['My trip to São Paulo and the best food I ate', 'en'],
  ['Interview with Pedro Almodóvar about his new film', 'en'],
  ['', null],
  ['12 34', null],
];
for (const [title, tag] of reads) is(detectLanguage(title), tag, `read ${JSON.stringify(title)}`);

// The platform's word beats the reading, and a description helps a short title.
is(contentLanguage({ title: 'The Big Lebowski', language: 'en' }), 'en', 'a platform language wins');
is(contentLanguage({ title: 'Despacito', description: 'Canción oficial de Luis Fonsi con Daddy Yankee, la más vista del mundo y de la historia' }), 'es', 'a description decides a bare title');
is(contentLanguage({ title: 'Amélie', language: 'fr' }), 'fr', 'TMDB original_language');
is(contentLanguage({ title: 'Untitled', language: 'not a language' }), null, 'a junk platform field falls through to reading');
is(contentLanguage({ platform: 'internet_archive', language: 'es', title: '[FULL ALBUM] Un Verano Sin Ti - Bad Bunny [FLAC]', description: 'SHA256 Checksums 93f6f7b5013a8355dca2e52082b959971d0a6 01 - Bad Bunny - Moscow Mule.flac 930af7506b10f6afec6f2046b2e005cef4393 02 - Bad Bunny - Después de la Playa.flac 1cce2b5eb6e426b6851b200041e38b377f2f0c 05 - Bad Bunny - Un Ratito.flac e48b6f567ca2958e6ee43d11d29e9446b1 06 - Bad Bunny - Yo No Soy Celoso.flac' }), 'es', 'checksums are not words (a live Archive row read as Italian)');
// An uploader's label is checked against the text (live PeerTube rows, 2026-11-03); TMDB's is not.
is(contentLanguage({ platform: 'peertube', language: 'de', title: 'Venezuelan Singer Has the Crowd Jumping With Bad Bunny Hit! | The Voice Germany', description: 'A singer brings incredible energy to the show with a cover of the song, and he receives a pair of sneakers from the coaches.' }), 'en', 'plain English overrules a wrong label');
is(contentLanguage({ platform: 'peertube', language: 'ja', title: 'EL GRITO DE TWINKY WHINKY BAD BUNNY - Creepypasta' }), null, 'Japanese is not believed of a title with no Japanese letters');
is(contentLanguage({ platform: 'peertube', language: 'es-MX', title: 'Cómo hacer pan casero en casa, la mejor receta' }), 'es-MX', 'agreeing text keeps the label and its region');
is(contentLanguage({ platform: 'peertube', language: 'fr', title: 'Les meilleurs moments' }), 'fr', 'a label the text does not contradict stands');
is(contentLanguage({ platform: 'internet_archive', language: 'jpn', title: '呪術廻戦' }), 'ja', 'Japanese in kanji alone keeps its Japanese label (not China)');
is(contentLanguage({ platform: 'peertube', language: 'ja', title: '日本語講座 第一回' }), 'ja', 'the same on PeerTube');
is(contentLanguage({ title: '日本語講座 第一回' }), 'zh', 'with no label, kanji alone can only read as Chinese');
is(contentLanguage({ platform: 'luke', media: {}, language: 'ja', title: 'Spirited Away' }), 'ja', "a media-server title believes TMDB's language too");
is(contentLanguage({ platform: 'kino', language: 'ja', title: 'Spirited Away', description: 'A young girl wanders into a world ruled by gods, witches and spirits, where humans are changed into beasts.' }), 'ja', "TMDB's original language is believed of an English title");

/* ------------------------------------------------------------------ the flag rule */
is(languageFlag('en'), null, 'English is never flagged');
is(languageFlag('en-AU'), null, 'any English is never flagged');
is(languageFlag(null), null, 'no language, no flag');
is(languageFlag('es')?.country, 'ES', 'Spanish -> Spain');
is(languageFlag('es-MX')?.country, 'MX', 'a region wins: Mexican Spanish -> Mexico');
is(languageFlag('pt')?.country, 'PT', 'Portuguese -> Portugal');
is(languageFlag('pt-BR')?.country, 'BR', 'Brazilian Portuguese -> Brazil');
is(languageFlag('ar')?.country, 'SA', 'Arabic -> Saudi Arabia');
is(languageFlag('zh')?.country, 'CN', 'Chinese -> China');
is(languageFlag('zh-TW')?.country, 'TW', 'Taiwanese Chinese -> Taiwan');
is(languageFlag('hi')?.country, 'IN', 'Hindi -> India');
is(languageFlag('ja')?.country, 'JP', 'Japanese -> Japan');
is(languageFlag('ca')?.country, null, 'Catalan has no one country');
is(languageFlag('ca')?.name, 'CATALAN', 'but is still named');
is(languageFlag('la')?.country, null, 'Latin has no country');
is(languageFlag('es')?.name, 'SPANISH', 'a flag is named by its language, not its country');
is(languageFlag('pt-BR')?.name, 'BRAZILIAN PORTUGUESE', 'a regional name');

// Every home country is a real flag file, so no language can point at a missing picture.
const homes = new Set(
  [...'af am ar az be bg bn bs cs da de el es et fa fi fil fr ga gu ha he hi hr hu hy id is it ja ka kk km kn ko lb lo lt lv mk ml mn mr ms mt my nb ne nl nn no pa pl ps pt ro ru si sk sl so sq sr sv sw ta te th tl tr uk ur uz vi yo zh zu'.split(' ')]
    .map((language) => languageFlag(language)?.country),
);
ok(!homes.has(null) && !homes.has(undefined), 'every listed language has a home country');
for (const country of homes) ok(existsSync(join(ROOT, 'assets', 'flags', `${country.toLowerCase()}.png`)), `assets/flags/${country.toLowerCase()}.png exists`);

console.log(`check-web-language: ${passed} passed`);
