/**
 * Words out of a title (SPEC-media-feed-v2.md, "Words from titles"): most of what a person plays here has no topic words
 * of its own (a YouTube video saved from a play has none), so its title is read for them. Weak words, half the weight of
 * an item's own tags, and the same rule on both sides: the history's titles and every candidate's title. Pure.
 */

/** Words that say nothing about a topic: English glue and the words every platform puts in titles. */
const STOP = new Set(
  (
    'about above after again against also among another anyone because been before being below between both came cannot could ' +
    'does doing done down during each even every from further have having here hers herself himself into itself just know like ' +
    'made make many more most much must myself never next once only other ours ourselves over same shall should some such ' +
    'than that their theirs them themselves then there these they this those through under until upon very want were what when ' +
    'where which while whom whose will with within without would your yours yourself yourselves ' +
    // Platform and format words.
    'official video videos full episode episodes part parts version volume edition live stream streams trailer clip clips ' +
    'audio audiobook librivox podcast show today week weekly daily news update updates review reviews best ever really things ' +
    'thing first last new old vol. www http https com'
  ).split(/\s+/),
);

/** A word folded so "mechanics" meets "mechanic" and "stories" meets "story". */
export function foldWord(word: string): string {
  if (word.length > 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) return word.slice(0, -1);
  return word;
}

/**
 * A title's topic words as spelled (lower case): four letters or more, no numbers, common words dropped, once each by their
 * folded form, at most `limit`. They are matched by `wordKey`.
 */
export function titleWords(title: string, limit = 6): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  for (const raw of title.toLowerCase().split(/[^\p{L}]+/u)) {
    if (raw.length < 4 || STOP.has(raw)) continue;
    const key = foldWord(raw);
    if (STOP.has(key) || keys.has(key)) continue;
    keys.add(key);
    out.push(raw);
    if (out.length >= limit) break;
  }
  return out;
}

/** A tag, topic or title word as it is shown: lower case, trimmed, single spaces. */
export function spellWord(word: string): string {
  return word.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A word as the profile matches it: spelled, then each part folded ("quantum mechanics" -> "quantum mechanic"). */
export function wordKey(word: string): string {
  return spellWord(word).split(' ').map(foldWord).join(' ');
}
