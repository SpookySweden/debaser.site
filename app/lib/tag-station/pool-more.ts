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

/** Rows from the files as a list's items: spelled as the map spells a word, with words joined as the map joins them, and only those on the map. */
export function moreItems(rows: readonly StationRow[], graph: Pick<StationGraph, 'tags' | 'aliases'>): StationItem[] {
  const nameOf = new Map(graph.tags.map((tag) => [wordKey(tag.name), tag.name]));
  for (const [own, name] of Object.entries(graph.aliases ?? {})) if (nameOf.has(wordKey(name))) nameOf.set(own, name);
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
      words: names.map((word) => ({ word, claude: true, platform: false })),
    };
    return [station];
  });
}
