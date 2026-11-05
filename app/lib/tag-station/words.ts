/**
 * One spelling per word (SPEC-tag-station.md): "hip hop", "hip-hop" and "hiphop" are the same word, so a search never
 * splits. Pure and client-safe: the graph builder, the page's search box and the link resolver all match through here.
 */

/** Longer than any real word or short phrase; a platform's tag past this is a sentence, not a tag. */
export const MAX_WORD_LENGTH = 40;

/**
 * Words that mean the same but squeeze to different letters, by what they squeeze to. Short and hand-written: anything
 * that differs only by spaces, hyphens or case is already one word without an entry here.
 */
const ALIASES: Readonly<Record<string, string>> = {
  scifi: 'sciencefiction',
  sf: 'sciencefiction',
  rnb: 'rhythmandblues',
  randb: 'rhythmandblues',
  rocknroll: 'rockandroll',
  drumnbass: 'drumandbass',
  dnb: 'drumandbass',
  technews: 'technologynews',
  nineteenthcentury: '19thcentury',
  twentiethcentury: '20thcentury',
  eighteenthcentury: '18thcentury',
  animatedfilm: 'animation',
  animated: 'animation',
  audiobooks: 'audiobook',
  podcasts: 'podcast',
  documentaries: 'documentary',
  shortfilms: 'shortfilm',
};

/** The letters and digits of a word, lower-case and without accents: what two spellings must share to be one word. */
function squeezed(word: string): string {
  return word
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** What identifies a word, whatever its spelling. Empty for something with no letters or digits. */
export function wordKey(word: string): string {
  const key = squeezed(word);
  return ALIASES[key] ?? key;
}

/** A word fit to keep and show, lower-case with single spaces, or null: no addresses, no sentences, nothing empty. */
export function cleanWord(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const word = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (word.length === 0 || word.length > MAX_WORD_LENGTH) return null;
  if (word.includes('://') || word.startsWith('www.')) return null;
  return squeezed(word).length === 0 ? null : word;
}

/** The era a word names, in one form ("1920s", "19th century"), or null. Spotted from the word: the tagger records no facet. */
export function eraOf(word: string): string | null {
  const text = word.trim().toLowerCase();
  const decade = /^(1[0-9]|20)([0-9])0'?s$/.exec(text);
  if (decade) return `${decade[1]}${decade[2]}0s`;
  const century = /^([0-9]{1,2})(st|nd|rd|th)[ -]century$/.exec(text);
  if (century) return `${century[1]}${century[2]} century`;
  const squeezedCentury = /^([0-9]{1,2})(st|nd|rd|th)century$/.exec(text);
  return squeezedCentury ? `${squeezedCentury[1]}${squeezedCentury[2]} century` : null;
}

/** How far apart two strings are, in single-letter edits, giving up past `limit`. For typos in the search box. */
export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      current.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}
