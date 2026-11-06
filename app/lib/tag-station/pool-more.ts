import type { StationGraph, StationItem, StationRow } from './types';
import { wordKey } from './words';
import type { WordFact } from './word-facts';

/**
 * Items from the compressed files for a few words (SPEC-discover.md): what a reader's list needs of the whole pool, when only a sample of it is on the map. Pure.
 * Nothing here draws a map, so a reader isn't kept waiting for one.
 */

/** Asked words as the files hold them, lower-case with their spaces, and every spelling the word pass joined to them. */
export function spellingsOf(words: readonly string[], facts: readonly WordFact[], graph: Pick<StationGraph, 'aliases'>): string[] {
  const wanted = new Set(words.map((word) => word.trim().toLowerCase()).filter((word) => word.length > 0));
  const keys = new Set([...wanted].map(wordKey));
  for (const [own, name] of Object.entries(graph.aliases ?? {})) if (keys.has(wordKey(name))) keys.add(own);
  for (const fact of facts) if (keys.has(wordKey(fact.word))) wanted.add(fact.word.toLowerCase());
  return [...wanted];
}

/** The words a search can be cut into, longest first: small words alone say nothing, and a few words are all a search needs. */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'is', 'of', 'on', 'or', 'the', 'to', 'with']);
const MOST_SEARCH_WORDS = 8;

const searchParts = (query: string): string[] => (query.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? []).slice(0, MOST_SEARCH_WORDS);

/** What to look up for a MEDIA search: the whole of it, and every run of up to three of its words. */
export function searchCandidates(query: string): string[] {
  const parts = searchParts(query);
  const runs = parts.flatMap((_, at) => [1, 2, 3].flatMap((size) => (at + size <= parts.length ? [parts.slice(at, at + size).join(' ')] : [])));
  return [...new Set([parts.join(' '), ...runs])].filter((one) => one.length > 0 && !SMALL_WORDS.has(one));
}

/**
 * How a search reads against the words that exist: each stretch as the longest word it can be ("film noir", not "film" and "noir"). What's left over has to be in the title instead, unless it's a
 * small word or a bare number. No words at all finds nothing: a search of titles alone is the outside sites' job.
 */
export function searchTerms(query: string, known: ReadonlySet<string>): { terms: string[]; inTitle: string[] } {
  const parts = searchParts(query);
  if (known.has(parts.join(' '))) return { terms: [parts.join(' ')], inTitle: [] };
  const terms: string[] = [];
  const inTitle: string[] = [];
  for (let at = 0; at < parts.length; ) {
    const size = [3, 2, 1].find((one) => at + one <= parts.length && !SMALL_WORDS.has(parts.slice(at, at + one).join(' ')) && known.has(parts.slice(at, at + one).join(' ')));
    if (size !== undefined) {
      terms.push(parts.slice(at, at + size).join(' '));
      at += size;
    } else {
      if (!SMALL_WORDS.has(parts[at]) && !/^\d+$/.test(parts[at])) inTitle.push(parts[at]);
      at += 1;
    }
  }
  return { terms: [...new Set(terms)], inTitle };
}

/**
 * Rows from the files as a list's items: spelled as the map spells a word, with words joined as the map joins them, and only those on the map or asked for by name. A word the map doesn't show
 * would otherwise be lost from the very items found by it.
 */
export function moreItems(rows: readonly StationRow[], graph: Pick<StationGraph, 'tags' | 'aliases'>, asked: readonly string[] = []): StationItem[] {
  const nameOf = new Map(graph.tags.map((tag) => [wordKey(tag.name), tag.name]));
  for (const [own, name] of Object.entries(graph.aliases ?? {})) if (nameOf.has(wordKey(name))) nameOf.set(own, name);
  for (const word of asked) if (!nameOf.has(wordKey(word))) nameOf.set(wordKey(word), word.trim().toLowerCase());
  return rows.flatMap(({ item, claudeWords, seenOnly }) => {
    const names = [...new Set(claudeWords.flatMap((word) => nameOf.get(wordKey(word)) ?? []))].sort();
    if (names.length === 0) return [];
    // Named one by one, as on the map: only what a row's page needs reaches the answer.
    const station: StationItem = {
      id: item.id,
      platform: item.platform,
      externalId: item.externalId,
      kind: item.kind,
      url: item.url,
      canonicalUrl: item.canonicalUrl,
      title: item.title,
      publishedAt: item.publishedAt,
      fetchedAt: item.fetchedAt,
      ...(item.creator ? { creator: item.creator } : {}),
      ...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
      ...(item.embedUrl ? { embedUrl: item.embedUrl } : {}),
      ...(seenOnly ? { seenOnly: true } : {}),
      catalogue: true,
      words: names.map((word) => ({ word, claude: true, platform: false })),
    };
    return [station];
  });
}
