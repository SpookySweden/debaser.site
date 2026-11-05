import { wordKey } from './words';

/**
 * What the word pass said about each word (SPEC-tag-station.md), turned into what the map needs: which words are one word, which are too
 * vague to draw, and what type each is. Pure and client-safe. `web_item_tags` is never changed; this is only applied when the map is built.
 */

export const FACETS = ['genre', 'mood', 'place', 'era', 'form', 'subject'] as const;
export type Facet = (typeof FACETS)[number];

/** The letter a word wears for its type, chosen so none is also a word-source letter (C, P, L, T). */
export const FACET_LETTERS: Record<Facet, string> = { genre: 'G', mood: 'M', place: 'W', era: 'E', form: 'F', subject: 'S' };

export type WordFact = { word: string; facet: Facet | null; sameAs: string | null; vague: boolean };

/** More merged than this is the model joining things that aren't one word, so the join is refused. */
const MAX_GROUP = 6;

export type WordRules = {
  /** The key a word counts under, after merges. */
  canonical(key: string): string;
  isVague(key: string): boolean;
  /** The type of the group a word is in, or null. */
  facet(key: string): Facet | null;
};

export const NO_WORD_RULES: WordRules = { canonical: (key) => key, isVague: () => false, facet: () => null };

export function buildWordRules(facts: readonly WordFact[]): WordRules {
  const sorted = [...facts].sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  const parent = new Map<string, string>();
  const size = new Map<string, number>();
  const find = (key: string): string => {
    let at = key;
    while ((parent.get(at) ?? at) !== at) at = parent.get(at) as string;
    return at;
  };
  const vague = new Set<string>();
  const facetByKey = new Map<string, Facet>();
  for (const fact of sorted) {
    const key = wordKey(fact.word);
    if (key.length === 0) continue;
    if (fact.vague) vague.add(key);
    if (fact.facet !== null && !facetByKey.has(key)) facetByKey.set(key, fact.facet);
  }
  for (const fact of sorted) {
    if (fact.sameAs === null || fact.vague) continue;
    const a = find(wordKey(fact.word));
    const b = find(wordKey(fact.sameAs));
    if (a.length === 0 || b.length === 0 || a === b || vague.has(wordKey(fact.sameAs))) continue;
    const together = (size.get(a) ?? 1) + (size.get(b) ?? 1);
    if (together > MAX_GROUP) continue;
    // The smaller key stands for the group, so the same answers always give the same groups, in any order.
    const [root, child] = a < b ? [a, b] : [b, a];
    parent.set(child, root);
    size.set(root, together);
  }
  const facetOfGroup = new Map<string, Facet>();
  for (const [key, facet] of [...facetByKey].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const root = find(key);
    if (!facetOfGroup.has(root)) facetOfGroup.set(root, facet);
  }
  return {
    canonical: find,
    isVague: (key) => vague.has(key),
    facet: (key) => facetOfGroup.get(find(key)) ?? null,
  };
}
