import { buildStationGraph } from './graph';
import type { StationGraph, StationItem, StationRow } from './types';
import { wordKey } from './words';
import type { WordFact } from './word-facts';

/**
 * Items from the compressed files for a few words (SPEC-discover.md): what a reader's list needs of the whole pool, when only a sample of it is on the map. Pure.
 */

/** Asked words, with every spelling that lands on them, as the files hold them. */
export function spellingsOf(words: readonly string[], graph: Pick<StationGraph, 'aliases'>): string[] {
  const wanted = new Set(words.map(wordKey).filter((word) => word.length > 0));
  for (const [own, name] of Object.entries(graph.aliases ?? {})) if (wanted.has(wordKey(name))) wanted.add(own);
  return [...wanted];
}

/** Rows from the files as a list's items: words joined by the word pass, spelled as the map spells them, and only those on the map. */
export function moreItems(rows: readonly StationRow[], facts: readonly WordFact[], graph: Pick<StationGraph, 'tags' | 'aliases'>): StationItem[] {
  const nameOf = new Map(graph.tags.map((tag) => [wordKey(tag.name), tag.name]));
  for (const [own, name] of Object.entries(graph.aliases ?? {})) if (nameOf.has(wordKey(name))) nameOf.set(own, name);
  return buildStationGraph(rows, facts).items.flatMap((item) => {
    const seen = new Map<string, StationItem['words'][number]>();
    for (const entry of item.words) {
      const name = nameOf.get(wordKey(entry.word));
      if (name !== undefined && !seen.has(name)) seen.set(name, { ...entry, word: name });
    }
    return seen.size === 0 ? [] : [{ ...item, words: [...seen.values()] }];
  });
}
