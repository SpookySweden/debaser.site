import { isCountryCode } from '../profile/countries';

/**
 * Which language a piece of content is in, and which flag says so (Luke, 2026-11-03: "a lot of content is
 * in languages other than english. include a country flag next to content to signify its language").
 *
 * **Where a language comes from, best first.** A platform that says (PeerTube's `language.id`, the Internet
 * Archive's `language`, TMDB's `original_language`) is listened to; the adapter puts it on
 * `WebItem.language`. (The podcast feeds are a fixed list of English shows, so they say nothing.) Otherwise the title and description are read here: the alphabet
 * decides Japanese, Korean, Chinese, Arabic, Hebrew, Thai, Greek, the Indian scripts and Cyrillic reliably,
 * and Latin-script languages are told apart by their common little words and letters, only when the text
 * leaves no doubt. A guess that is not sure says nothing: no flag beats a wrong flag.
 *
 * **Nothing is stored.** The language is worked out where the row is drawn, from metadata the site already
 * keeps (CLAUDE.md, WEB: metadata only), so a guess that improves here improves every old row too.
 *
 * **A language is not a country, so the flag follows one rule** (`languageFlag`):
 *   1. English is never flagged: it is the site's own language.
 *   2. A tag that names a region uses it: `pt-BR` -> Brazil, `es-MX` -> Mexico, `fr-CA` -> Canada.
 *   3. Otherwise the language's home country (`HOME`): Spanish -> Spain, Portuguese -> Portugal,
 *      Arabic -> Saudi Arabia, Chinese -> China, Hindi -> India.
 *   4. A language with no one country (Catalan, Basque, Welsh, Latin, Esperanto...) gets no flag but its
 *      two letters on a plate, so it is still said.
 * The flag is always named by the language ("SPANISH"), never the country, on hover and to a screen reader.
 *
 * Pure: no React, no fetching, so the server's adapters and the browser's rows share it.
 */

/** A language as the site keeps it: a lowercase ISO 639-1 code, maybe with a region (`pt-BR`). */
export type LanguageTag = string;

/** The language's home country, for a tag with no region. Missing: the language has no one country. */
const HOME: Record<string, string> = {
  af: 'ZA', am: 'ET', ar: 'SA', az: 'AZ', be: 'BY', bg: 'BG', bn: 'BD', bs: 'BA', cs: 'CZ', da: 'DK',
  de: 'DE', el: 'GR', es: 'ES', et: 'EE', fa: 'IR', fi: 'FI', fil: 'PH', fr: 'FR', ga: 'IE', gu: 'IN',
  ha: 'NG', he: 'IL', hi: 'IN', hr: 'HR', hu: 'HU', hy: 'AM', id: 'ID', is: 'IS', it: 'IT', ja: 'JP',
  ka: 'GE', kk: 'KZ', km: 'KH', kn: 'IN', ko: 'KR', lb: 'LU', lo: 'LA', lt: 'LT', lv: 'LV', mk: 'MK',
  ml: 'IN', mn: 'MN', mr: 'IN', ms: 'MY', mt: 'MT', my: 'MM', nb: 'NO', ne: 'NP', nl: 'NL', nn: 'NO',
  no: 'NO', pa: 'IN', pl: 'PL', ps: 'AF', pt: 'PT', ro: 'RO', ru: 'RU', si: 'LK', sk: 'SK', sl: 'SI',
  so: 'SO', sq: 'AL', sr: 'RS', sv: 'SE', sw: 'TZ', ta: 'IN', te: 'IN', th: 'TH', tl: 'PH', tr: 'TR',
  uk: 'UA', ur: 'PK', uz: 'UZ', vi: 'VN', yo: 'NG', zh: 'CN', zu: 'ZA',
};

/** ISO 639-2 codes (the Internet Archive's usual spelling: "eng", "spa") as their two-letter codes. */
const THREE_LETTER: Record<string, string> = {
  afr: 'af', ara: 'ar', arm: 'hy', hye: 'hy', baq: 'eu', eus: 'eu', bel: 'be', ben: 'bn', bul: 'bg',
  cat: 'ca', chi: 'zh', zho: 'zh', cze: 'cs', ces: 'cs', dan: 'da', dut: 'nl', nld: 'nl', eng: 'en',
  epo: 'eo', est: 'et', fil: 'fil', fin: 'fi', fre: 'fr', fra: 'fr', geo: 'ka', kat: 'ka', ger: 'de',
  deu: 'de', gle: 'ga', glg: 'gl', gre: 'el', ell: 'el', heb: 'he', hin: 'hi', hrv: 'hr', hun: 'hu',
  ice: 'is', isl: 'is', ind: 'id', ita: 'it', jpn: 'ja', kor: 'ko', lat: 'la', lav: 'lv', lit: 'lt',
  may: 'ms', msa: 'ms', nor: 'no', nob: 'nb', nno: 'nn', per: 'fa', fas: 'fa', pol: 'pl', por: 'pt',
  rum: 'ro', ron: 'ro', rus: 'ru', slo: 'sk', slk: 'sk', slv: 'sl', spa: 'es', srp: 'sr', swa: 'sw',
  swe: 'sv', tam: 'ta', tgl: 'tl', tha: 'th', tur: 'tr', ukr: 'uk', urd: 'ur', vie: 'vi', wel: 'cy',
  cym: 'cy', yid: 'yi',
};

const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language' });

/** English names ("Spanish", "Portuguese") back to codes, for sources that write the name. */
const BY_NAME: Map<string, string> = (() => {
  const names = new Map<string, string>();
  const codes = new Set([...Object.keys(HOME), ...Object.values(THREE_LETTER), 'en']);
  for (const code of codes) {
    const name = LANGUAGE_NAMES.of(code);
    if (name !== undefined && name !== code) names.set(name.toLowerCase(), code);
  }
  return names;
})();

/**
 * A language as a platform wrote it, as the site's tag - or null.
 *
 * Takes `en`, `en-US`, `pt_BR`, `eng`, `English`, `Spanish; Castilian`, `zh-Hant-TW`; the first of a list
 * wins. A region is kept only when it is a real country code (`es-419`, Latin America, is just Spanish).
 */
export function normaliseLanguage(raw: unknown): LanguageTag | null {
  if (typeof raw !== 'string') return null;
  const first = raw.split(/[;,/|]/)[0]?.trim() ?? '';
  if (first.length === 0 || first.length > 40) return null;

  const byName = BY_NAME.get(first.toLowerCase());
  if (byName !== undefined) return byName;

  const parts = first.replace(/_/g, '-').split('-');
  let language = parts[0].toLowerCase();
  if (!/^[a-z]{2,3}$/.test(language)) return null;
  if (language.length === 3) {
    const two = THREE_LETTER[language];
    if (two === undefined) return null;
    language = two;
  }
  // A code nobody names ("xx") is not a language.
  if (LANGUAGE_NAMES.of(language) === language) return null;
  // Chinese written in traditional characters, with no region, is Taiwan's.
  const script = parts.find((part) => /^[A-Za-z]{4}$/.test(part))?.toLowerCase();
  const region = parts.slice(1).find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase();
  if (region !== undefined && isCountryCode(region)) return `${language}-${region}`;
  if (language === 'zh' && script === 'hant') return 'zh-TW';
  return language;
}

/** The language's own part of a tag: `pt-BR` -> `pt`. */
function baseOf(tag: LanguageTag): string {
  return tag.split('-')[0];
}

/** What a row draws for a language: the country whose flag stands for it (or none), and its name. */
export type LanguageFlag = { language: string; country: string | null; name: string };

/** The flag a language wears (the rule in the header), or null for English and for no language. */
export function languageFlag(tag: LanguageTag | null | undefined): LanguageFlag | null {
  if (tag === null || tag === undefined || tag.length === 0) return null;
  const language = baseOf(tag);
  if (language === 'en') return null;
  const region = tag.split('-')[1];
  const country = region !== undefined && isCountryCode(region) ? region : (HOME[language] ?? null);
  const name = (LANGUAGE_NAMES.of(tag) ?? LANGUAGE_NAMES.of(language) ?? language).toUpperCase();
  return { language, country, name };
}

/* ------------------------------------------------------------------ reading the text */

/** Letters of one alphabet, and the language it means when the text is mostly that. Order matters. */
const SCRIPTS: readonly [string, RegExp][] = [
  ['ko', /[가-힯ᄀ-ᇿ㄰-㆏]/gu],
  ['ja', /[぀-ヿ]/gu],
  ['zh', /[一-鿿㐀-䶿]/gu],
  ['th', /[฀-๿]/gu],
  ['he', /[֐-׿]/gu],
  ['el', /[Ͱ-Ͽἀ-῿]/gu],
  ['ar', /[؀-ۿݐ-ݿ]/gu],
  ['hi', /[ऀ-ॿ]/gu],
  ['bn', /[ঀ-৿]/gu],
  ['pa', /[਀-੿]/gu],
  ['gu', /[઀-૿]/gu],
  ['ta', /[஀-௿]/gu],
  ['te', /[ఀ-౿]/gu],
  ['kn', /[ಀ-೿]/gu],
  ['ml', /[ഀ-ൿ]/gu],
  ['si', /[඀-෿]/gu],
  ['ka', /[Ⴀ-ჿ]/gu],
  ['hy', /[԰-֏]/gu],
  ['km', /[ក-៿]/gu],
  ['lo', /[຀-໿]/gu],
  ['my', /[က-႟]/gu],
  ['ru', /[Ѐ-ӿ]/gu],
];

/**
 * The whole words of a text, lowercased: runs of letters between spaces and punctuation. A run glued to digits
 * is not a word, so a checksum ("6eec1af9") cannot vote "e" or "a" for Italian or Portuguese.
 */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .filter((word) => /^\p{L}+$/u.test(word));
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/** Which language an alphabet's text is, where letters inside the alphabet tell its languages apart. */
function refineScript(language: string, text: string): string {
  if (language === 'ar') {
    if (/[ٹڈڑںےۓ]/u.test(text)) return 'ur';
    if (/[پچژگکی]/u.test(text)) return 'fa';
    return 'ar';
  }
  if (language === 'ru') {
    const lower = text.toLowerCase();
    if (/[әғқңұһ]/u.test(lower)) return 'kk';
    if (/ў/u.test(lower)) return 'be';
    if (/[єїґі]/u.test(lower)) return 'uk';
    if (/[ђћџљњј]/u.test(lower)) return 'sr';
    if (/[ѓќѕ]/u.test(lower)) return 'mk';
    if (/[өү]/u.test(lower)) return 'mn';
    if (/[ыэё]/u.test(lower)) return 'ru';
    if (/ъ/u.test(lower)) return 'bg';
    return 'ru';
  }
  return language;
}

/**
 * The little words that give a Latin-script language away, chosen not to be English words too (no "a",
 * "in", "me", "on"), plus words YouTube titles carry ("oficial", "folge").
 */
const WORDS: Record<string, readonly string[]> = {
  en: ['the', 'and', 'of', 'to', 'is', 'with', 'for', 'this', 'that', 'you', 'my', 'how', 'what', 'from', 'are', 'was', 'your', 'official', 'live', 'episode', 'full', 'new', 'in', 'on', 'at', 'i', 'it', 'we', 'do', 'be', 'not', 'all', 'by', 'an', 'or', 'as', 'will', 'have', 'why', 'best'],
  es: ['el', 'los', 'las', 'del', 'y', 'que', 'por', 'para', 'con', 'una', 'es', 'como', 'más', 'pero', 'sus', 'muy', 'yo', 'tu', 'mi', 'oficial', 'canción', 'capítulo', 'en', 'lo', 'al', 'cómo', 'qué', 'mejor', 'nuevo', 'vivo', 'la', 'sin', 'un', 'completo', 'película', 'historia', 'también', 'mucho', 'esto', 'ella', 'cuando', 'hoy'],
  pt: ['os', 'da', 'dos', 'das', 'e', 'que', 'em', 'não', 'um', 'uma', 'com', 'para', 'por', 'mais', 'você', 'eu', 'meu', 'minha', 'oficial', 'ao', 'vivo', 'episódio', 'são', 'é', 'como', 'na', 'no', 'completo', 'filme', 'história', 'também', 'muito', 'isso', 'ela', 'ele', 'quando', 'ainda', 'hoje'],
  fr: ['le', 'les', 'des', 'du', 'et', 'est', 'une', 'dans', 'pour', 'qui', 'que', 'pas', 'sur', 'avec', 'je', 'vous', 'nous', 'ce', 'mon', 'officiel', 'épisode', 'en', 'au', 'aux', 'la', 'il', 'elle', 'un', 'ne', 'rien', 'très', 'mais', 'sans', 'tout'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'mit', 'auf', 'für', 'ich', 'sie', 'wir', 'von', 'zu', 'den', 'dem', 'auch', 'folge', 'offizielles', 'wie', 'mein', 'eines', 'einer', 'oder', 'aber', 'nur', 'noch', 'über', 'sich'],
  it: ['il', 'lo', 'gli', 'della', 'del', 'che', 'è', 'di', 'non', 'una', 'con', 'sono', 'mio', 'ufficiale', 'nel', 'alla', 'anche', 'questo', 'la', 'e', 'un'],
  nl: ['het', 'een', 'en', 'van', 'niet', 'ik', 'je', 'met', 'op', 'voor', 'zijn', 'dat', 'wat', 'hoe', 'aflevering', 'ook', 'naar'],
  sv: ['och', 'att', 'det', 'som', 'en', 'är', 'på', 'för', 'med', 'jag', 'inte', 'av', 'till', 'den', 'har', 'om', 'från', 'vad', 'hur', 'avsnitt'],
  da: ['og', 'det', 'som', 'er', 'på', 'med', 'jeg', 'ikke', 'af', 'til', 'den', 'har', 'om', 'fra', 'hvad', 'hvordan'],
  no: ['og', 'det', 'som', 'er', 'på', 'med', 'jeg', 'ikke', 'av', 'til', 'den', 'har', 'om', 'fra', 'hva', 'hvordan'],
  fi: ['ja', 'ei', 'se', 'että', 'kun', 'mutta', 'minä', 'sinä', 'hän', 'tämä', 'jakso', 'kanssa', 'mitä', 'miten'],
  pl: ['nie', 'się', 'na', 'jest', 'że', 'jak', 'z', 'ale', 'co', 'czy', 'dla', 'jestem', 'odcinek', 'oficjalny'],
  cs: ['je', 'se', 'na', 'že', 'jak', 'ale', 'co', 'pro', 'jsem', 'není', 'díl'],
  tr: ['ve', 'bir', 'bu', 'için', 'ile', 'ne', 'çok', 'gibi', 'ben', 'sen', 'nasıl', 'bölüm', 'resmi'],
  hu: ['és', 'az', 'egy', 'hogy', 'nem', 'van', 'meg', 'ez', 'rész', 'hivatalos'],
  ro: ['și', 'în', 'cu', 'pe', 'nu', 'este', 'un', 'o', 'că', 'pentru', 'oficial', 'episodul'],
  id: ['dan', 'yang', 'di', 'ini', 'itu', 'dengan', 'untuk', 'tidak', 'dari', 'ada', 'aku', 'kamu', 'saya', 'resmi', 'bagaimana'],
  vi: ['và', 'của', 'là', 'có', 'không', 'những', 'được', 'cho', 'với', 'này', 'một', 'người', 'tập', 'chính', 'thức'],
  tl: ['ang', 'ng', 'mga', 'sa', 'na', 'ay', 'ko', 'mo', 'ako', 'ikaw', 'hindi', 'bakit', 'paano'],
};

/** Letters that belong to few languages; each word carrying one is a vote for them. */
const LETTERS: readonly [RegExp, readonly string[]][] = [
  [/ñ/u, ['es']],
  [/[ãõ]/u, ['pt']],
  [/ç/u, ['pt', 'fr', 'tr']],
  [/[ß]/u, ['de']],
  [/[äöü]/u, ['de', 'sv', 'fi', 'tr', 'hu']],
  [/å/u, ['sv', 'da', 'no']],
  [/[æø]/u, ['da', 'no']],
  [/[ąęłńśźż]/u, ['pl']],
  [/[ěřůčš]/u, ['cs']],
  [/[ğış]/u, ['tr']],
  [/[őű]/u, ['hu']],
  [/[șțăâî]/u, ['ro']],
  [/[ơưđạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/u, ['vi']],
  [/[èêëœ]/u, ['fr']],
  [/[ìò]/u, ['it']],
  [/[¿¡]/u, ['es']],
];

/** Each language's word list as a set, built once. */
const WORD_SETS: [string, Set<string>][] = Object.entries(WORDS).map(([language, words]) => [language, new Set(words)]);
const ENGLISH_WORDS = new Set(WORDS.en);

/**
 * The language a title and description are written in, or null when the text does not say clearly.
 *
 * A non-Latin alphabet that makes up at least a third of the letters decides it (Japanese wins over Chinese
 * when kana appear among the characters). Latin-script text needs a language with at least two votes that
 * beats English and every other language outright; a tie or a lone accent ("Piñata Party") says nothing.
 * Plain English reads as `en`, which wears no flag.
 */
export function detectLanguage(text: string | undefined | null): LanguageTag | null {
  if (text === undefined || text === null) return null;
  const sample = text.slice(0, 600);
  const letters = count(sample, /\p{L}/gu);
  if (letters < 3) return null;

  let bestScript: string | null = null;
  let bestCount = 0;
  for (const [language, pattern] of SCRIPTS) {
    const found = count(sample, pattern);
    if (found > bestCount) {
      bestScript = language;
      bestCount = found;
    }
  }
  // Kana, hangul and the rest belong to their languages alone, so a few of them in a title that is
  // otherwise romanised names and English labels ("【MV】YOASOBI「アイドル」Official Music Video") still
  // decide it - unless the Latin words are themselves plainly English sentences.
  const latinWords = wordsOf(sample).filter((word) => ENGLISH_WORDS.has(word)).length;
  if (bestScript !== null && bestCount >= 2 && (bestCount * 3 >= letters || (bestCount >= 3 && latinWords <= 1))) {
    // Japanese is written with Chinese characters too: any kana at all makes it Japanese.
    if (bestScript === 'zh' && count(sample, SCRIPTS[1][1]) > 0) return 'ja';
    return refineScript(bestScript, sample);
  }

  const words = wordsOf(sample);
  const votes = new Map<string, number>();
  const vote = (language: string) => votes.set(language, (votes.get(language) ?? 0) + 1);
  for (const word of words) {
    for (const [language, set] of WORD_SETS) if (set.has(word)) vote(language);
    for (const [pattern, languages] of LETTERS) if (pattern.test(word)) languages.forEach(vote);
  }

  const ranked = [...votes.entries()].sort((left, right) => right[1] - left[1]);
  const [best, second] = ranked;
  if (best === undefined || best[1] < 2) return null;
  if (second !== undefined && second[1] >= best[1]) return null;
  // Plainly English is an answer too: it overrules a platform's wrong label (`contentLanguage`).
  if (best[0] === 'en') return second === undefined || best[1] >= second[1] * 2 ? 'en' : null;
  const english = votes.get('en') ?? 0;
  if (english * 2 >= best[1]) return null;
  return best[0];
}

/** A row's language: what the platform said, else what its title and description read as. */
/** The alphabet a language is written in, for the languages that have one of their own. */
function alphabetOf(language: string): RegExp | undefined {
  const family = ['fa', 'ur'].includes(language) ? 'ar' : ['uk', 'sr', 'bg', 'kk', 'be', 'mk', 'mn'].includes(language) ? 'ru' : language;
  const pattern = SCRIPTS.find(([name]) => name === family)?.[1];
  if (pattern === undefined) return undefined;
  // Japanese is kana and kanji, so a title in kanji alone is still written in its alphabet.
  const kanji = family === 'ja' ? `|${SCRIPTS.find(([name]) => name === 'zh')?.[1].source ?? ''}` : '';
  return new RegExp(`${pattern.source}${kanji}`, 'u');
}

/**
 * A row's language: the platform's word, checked against the text.
 *
 * TMDB's `original_language` (KINO rows and media-server titles) is believed outright: TMDB hands its titles
 * over in English, so "Spirited Away" is still Japanese. Everybody else's is an uploader's setting (PeerTube's is often the
 * instance's default: a Spanish title filed as Japanese, an English talent-show clip as German), so text that
 * plainly reads as another language wins, and a language with its own alphabet is not believed of a title
 * and description with none of its letters.
 */
export function contentLanguage(item: {
  language?: string | null;
  title: string;
  description?: string | null;
  platform?: string;
  media?: unknown;
}): LanguageTag | null {
  const said = normaliseLanguage(item.language ?? undefined);
  if (said !== null && (item.platform === 'kino' || item.media !== undefined)) return said;
  const text = item.description ? `${item.title}\n${item.description}` : item.title;
  const read = detectLanguage(text);
  // Japanese written all in kanji reads as Chinese (any kana would have made it Japanese): the label stands.
  const kanjiOnly = said !== null && baseOf(said) === 'ja' && read === 'zh';
  if (read !== null && !kanjiOnly && (said === null || baseOf(read) !== baseOf(said))) return read;
  if (said === null) return null;
  const alphabet = alphabetOf(baseOf(said));
  return alphabet !== undefined && !alphabet.test(text) ? null : said;
}
