import { PLATFORM_LABELS, type WebPlatform } from '../web/types';
import { strength } from './closeness';
import { FACETS, type Facet } from './word-facts';
import type { Niche, Recipe } from './recipe';
import { EMPTY_RECIPE } from './recipe';
import type { StationGraph, StationItem, StationTag } from './types';
import { editDistance, wordKey } from './words';
import { poorTitle, sinkPoor } from './title-quality';

/**
 * Asking the map things (SPEC-tag-station.md): which items a recipe finds, what sits near a word or item, what to loosen when
 * little is found, and what the search box suggests. Pure and client-safe, so it runs in the browser and a check can hold it.
 */

export type StationIndex = {
  graph: StationGraph;
  total: number;
  tagByName: Map<string, StationTag>;
  tagByKey: Map<string, StationTag>;
  itemById: Map<string, StationItem>;
  itemsByWord: Map<string, Set<string>>;
  eras: string[];
  facets: Facet[];
};

export function buildIndex(graph: StationGraph): StationIndex {
  const itemsByWord = new Map<string, Set<string>>();
  for (const item of graph.items) {
    for (const { word } of item.words) {
      const ids = itemsByWord.get(word) ?? new Set<string>();
      ids.add(item.id);
      itemsByWord.set(word, ids);
    }
  }
  return {
    graph,
    total: graph.items.length,
    tagByName: new Map(graph.tags.map((tag) => [tag.name, tag])),
    // Spellings the word pass joined land on the word too. `byName` isn't ready yet, so found here.
    tagByKey: new Map([
      ...Object.entries(graph.aliases ?? {}).flatMap(([key, name]): [string, StationTag][] => {
        const tag = graph.tags.find((one) => one.name === name);
        return tag === undefined ? [] : [[key, tag]];
      }),
      ...graph.tags.map((tag): [string, StationTag] => [wordKey(tag.name), tag]),
    ]),
    itemById: new Map(graph.items.map((item) => [item.id, item])),
    itemsByWord,
    eras: [...new Set(graph.tags.map((tag) => tag.era).filter((era): era is string => era !== null))].sort(),
    facets: FACETS.filter((facet) => graph.tags.some((tag) => tag.facet === facet)),
  };
}

/** A word as the map spells it, whatever spelling it came in, or null when the map doesn't have it. */
export function findTag(index: StationIndex, word: string): StationTag | null {
  return index.tagByKey.get(wordKey(word)) ?? null;
}

/** What an item's words are under the source filter. */
export function wordsOfItem(item: StationItem, src: Recipe['src']): string[] {
  return item.words.filter((word) => (src === 'both' ? true : src === 'claude' ? word.claude : word.platform)).map((word) => word.word);
}

function tagHasSource(tag: StationTag, src: Recipe['src']): boolean {
  return src === 'both' || (src === 'claude' ? tag.claude > 0 : tag.platform > 0);
}

/** Mainstream, middling or obscure, by how many of our items carry a word. Scales with how much there is. */
export function nicheOfCount(count: number, total: number): Exclude<Niche, 'all'> {
  if (count >= Math.max(4, total * 0.05)) return 'main';
  return count <= Math.max(2, total * 0.01) ? 'rare' : 'mid';
}

/** How common an item's words are: the middle one's count. Zero for an item with none. */
export function itemCommonness(index: StationIndex, item: StationItem): number {
  const counts = item.words.map(({ word }) => index.tagByName.get(word)?.count ?? 0).sort((a, b) => a - b);
  return counts.length === 0 ? 0 : counts[Math.floor(counts.length / 2)];
}

export function tagPassesNiche(tag: StationTag, recipe: Recipe, total: number): boolean {
  return recipe.niche === 'all' || nicheOfCount(tag.count, total) === recipe.niche;
}

/** Whether the recipe's word-type filter leaves a word on the map and in the lists. */
export function tagPassesFacet(tag: StationTag, recipe: Recipe): boolean {
  return recipe.facet === null || tag.facet === recipe.facet;
}

/** The map's own spelling of each word in a list, dropping any it doesn't have. */
function known(index: StationIndex, words: readonly string[]): string[] {
  return words.map((word) => findTag(index, word)?.name).filter((name): name is string => name !== undefined);
}

const SWEPT_SOURCE_LABELS: Readonly<Record<string, string>> = { wikidata: 'WIKIDATA', tvmaze: 'TVMAZE' };

/** An item's source, as named beside it: MEDIA's platforms, and the two the sweep reads for films and shows. */
export function sourceLabel(platform: string): string {
  return PLATFORM_LABELS[platform as WebPlatform] ?? SWEPT_SOURCE_LABELS[platform] ?? platform.toUpperCase();
}

export type Focus = {
  kind: 'none' | 'tag' | 'item' | 'link';
  /** The words everything is measured from. */
  words: string[];
};

/**
 * What the page is centred on: the chosen word, or the chosen item's words, or a pasted link's matched words. With nothing
 * chosen, the must-have words stand in, so a recipe alone still has a neighbourhood.
 */
export function focusOf(index: StationIndex, recipe: Recipe, linkWords: readonly string[] = []): Focus {
  if (recipe.tag !== null) {
    const tag = findTag(index, recipe.tag);
    return { kind: 'tag', words: tag ? [tag.name] : [] };
  }
  if (recipe.item !== null) {
    const item = index.itemById.get(recipe.item);
    return { kind: 'item', words: item ? wordsOfItem(item, recipe.src) : [] };
  }
  if (recipe.link !== null) return { kind: 'link', words: known(index, linkWords) };
  const must = known(index, recipe.must);
  return must.length > 0 ? { kind: 'none', words: must } : { kind: 'none', words: [] };
}

/** Every word one step from the focus, by name. */
function partnersOfFocus(index: StationIndex, focus: readonly string[]): Set<string> {
  const near = new Set<string>();
  for (const word of focus) for (const partner of index.tagByName.get(word)?.partners ?? []) near.add(partner.name);
  for (const word of focus) near.delete(word);
  return near;
}

/** How many of `must` an item needs under the strictness setting: all, about two thirds, or one. */
export function mustNeeded(strict: Recipe['strict'], count: number): number {
  if (count === 0) return 0;
  if (strict === 'any') return 1;
  return strict === 'most' ? Math.max(1, Math.ceil((count * 2) / 3)) : count;
}

/** The items a recipe finds, in no particular order. */
export function matchItems(index: StationIndex, recipe: Recipe, focus: Focus): StationItem[] {
  const must = known(index, recipe.must);
  // A must-have the map has never heard of finds nothing, rather than being quietly ignored.
  const impossibleMust = recipe.strict === 'all' && must.length < recipe.must.length;
  const any = known(index, recipe.any);
  const anyImpossible = recipe.any.length > 0 && any.length === 0;
  const not = new Set(known(index, recipe.not));
  if (impossibleMust || anyImpossible) return [];
  const needed = mustNeeded(recipe.strict, must.length);
  const focusSet = new Set(focus.words);
  const around = recipe.near === 'far' ? partnersOfFocus(index, focus.words) : null;
  const eraWords = recipe.era === null ? null : new Set(index.graph.tags.filter((tag) => tag.era === recipe.era).map((tag) => tag.name));
  const facetWords = recipe.facet === null ? null : new Set(index.graph.tags.filter((tag) => tag.facet === recipe.facet).map((tag) => tag.name));

  return index.graph.items.filter((item) => {
    if (item.id === recipe.item) return false;
    if (recipe.kind !== null && item.kind !== recipe.kind) return false;
    if (recipe.site !== null && item.platform !== recipe.site) return false;
    if (recipe.from !== null || recipe.to !== null) {
      if (!Number.isFinite(Date.parse(item.publishedAt))) return false;
      const year = Number(item.publishedAt.slice(0, 4));
      if (recipe.from !== null && year < recipe.from) return false;
      if (recipe.to !== null && year > recipe.to) return false;
    }
    if (recipe.niche !== 'all' && nicheOfCount(itemCommonness(index, item), index.total) !== recipe.niche) return false;
    const words = wordsOfItem(item, recipe.src);
    const has = new Set(words);
    if (must.filter((word) => has.has(word)).length < needed) return false;
    if (any.length > 0 && !any.some((word) => has.has(word))) return false;
    if (words.some((word) => not.has(word))) return false;
    if (eraWords !== null && !words.some((word) => eraWords.has(word))) return false;
    if (facetWords !== null && !words.some((word) => facetWords.has(word))) return false;
    if (focusSet.size > 0) {
      const shared = words.filter((word) => focusSet.has(word)).length;
      if (recipe.near === 'near' && shared < Math.min(2, focusSet.size)) return false;
      if (recipe.near === 'wider' && shared < 1) return false;
      if (recipe.near === 'far' && shared < 1 && !words.some((word) => around?.has(word))) return false;
    }
    return true;
  });
}

const rarity = (index: StationIndex, word: string): number => Math.log(1 + index.total / (index.tagByName.get(word)?.count ?? 1));

/** How well an item matches the focus: rare shared words count for most, words near the focus for a little. */
export function itemScore(index: StationIndex, item: StationItem, focus: readonly string[], src: Recipe['src'] = 'both'): number {
  const focusSet = new Set(focus);
  const words = wordsOfItem(item, src);
  let score = 0;
  for (const word of words) if (focusSet.has(word)) score += rarity(index, word);
  for (const word of focus) {
    for (const partner of index.tagByName.get(word)?.partners ?? []) {
      if (words.includes(partner.name) && !focusSet.has(partner.name)) score += 0.25 * strength(partner);
    }
  }
  return score;
}

/** The items in the order the recipe asks for. Ids break ties, so the order is fixed. */
export function sortItems(index: StationIndex, items: readonly StationItem[], recipe: Recipe, focus: Focus): StationItem[] {
  const byId = (a: StationItem, b: StationItem) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const newest = (a: StationItem, b: StationItem) => b.publishedAt.localeCompare(a.publishedAt) || byId(a, b);
  const list = [...items];
  if (recipe.sort === 'rare') return sinkPoor(list.sort((a, b) => itemCommonness(index, a) - itemCommonness(index, b) || newest(a, b)));
  if (recipe.sort === 'new') return sinkPoor(list.sort(newest));
  if (recipe.sort === 'tagged') return sinkPoor(list.sort((a, b) => b.words.length - a.words.length || newest(a, b)));
  if (focus.words.length === 0) return sinkPoor(list.sort(newest));
  const scores = new Map(list.map((item) => [item.id, itemScore(index, item, focus.words, recipe.src)]));
  return sinkPoor(list.sort((a, b) => (scores.get(b.id) as number) - (scores.get(a.id) as number) || newest(a, b)));
}

export type RelatedTag = {
  tag: StationTag;
  score: number;
  /** True when a pair behind it shares enough items to count (`MIN_SHARED`). */
  close: boolean;
  /** "WITH ambient AND dub ON 14 ITEMS". Always true of the data. */
  reason: string;
};

const itemsWord = (count: number) => (count === 1 ? '1 ITEM' : `${count} ITEMS`);

/** Words near the focus, closest first, each with a reason. With no focus, the commonest words. */
export function relatedTags(index: StationIndex, recipe: Recipe, focus: Focus, limit = 30): RelatedTag[] {
  const usable = (tag: StationTag) => tagHasSource(tag, recipe.src) && tagPassesNiche(tag, recipe, index.total) && tagPassesFacet(tag, recipe);
  const not = new Set(known(index, recipe.not));
  if (focus.words.length === 0) {
    return [...index.graph.tags]
      .filter((tag) => usable(tag) && !not.has(tag.name))
      .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))
      .slice(0, limit)
      .map((tag) => ({ tag, score: tag.count, close: false, reason: `ON ${itemsWord(tag.count)}` }));
  }

  const focusSet = new Set(focus.words);
  const found = new Map<string, { score: number; close: boolean; through: { word: string; shared: number }[]; hop: string | null }>();
  for (const word of focus.words) {
    for (const partner of index.tagByName.get(word)?.partners ?? []) {
      if (focusSet.has(partner.name) || not.has(partner.name)) continue;
      const entry = found.get(partner.name) ?? { score: 0, close: false, through: [], hop: null };
      entry.score += strength(partner);
      entry.close ||= partner.close;
      entry.through.push({ word, shared: partner.shared });
      found.set(partner.name, entry);
    }
  }
  if (recipe.near === 'far') {
    // One step further out, marked down, and only from what the word's close partners vouch for.
    for (const [name, direct] of [...found.entries()]) {
      for (const partner of index.tagByName.get(name)?.partners ?? []) {
        if (focusSet.has(partner.name) || not.has(partner.name) || found.has(partner.name) || !partner.close) continue;
        found.set(partner.name, { score: 0.5 * direct.score * strength(partner), close: false, through: [], hop: name });
      }
    }
  }

  const list: RelatedTag[] = [];
  for (const [name, entry] of found) {
    const tag = index.tagByName.get(name);
    if (!tag || !usable(tag)) continue;
    if (recipe.near === 'near' && !entry.close) continue;
    let reason: string;
    if (entry.hop !== null) {
      reason = `VIA ${entry.hop}`;
    } else {
      // The count from the closest pair, which covers items that were counted and dropped, not just the ones loaded here.
      const named = [...entry.through].sort((a, b) => b.shared - a.shared || (a.word < b.word ? -1 : 1));
      reason = `WITH ${named[0].word} ON ${itemsWord(named[0].shared)}`;
    }
    list.push({ tag, score: entry.score, close: entry.close, reason });
  }
  return list.sort((a, b) => b.score - a.score || (a.tag.name < b.tag.name ? -1 : 1)).slice(0, limit);
}

export type MixItem = { item: StationItem; note: string };

/** Items that share most of the focus but differ on a word: the same mix, a different flavour. Needs two words to mix. */
export function sameMix(index: StationIndex, items: readonly StationItem[], recipe: Recipe, focus: Focus, skip: ReadonlySet<string>, limit = 5): MixItem[] {
  if (focus.words.length < 2) return [];
  const focusSet = new Set(focus.words);
  const least = Math.max(2, focus.words.length - 2);
  const found: { item: StationItem; shared: number; note: string }[] = [];
  for (const item of items) {
    if (skip.has(item.id)) continue;
    const words = wordsOfItem(item, recipe.src);
    const shared = words.filter((word) => focusSet.has(word));
    if (shared.length < least) continue;
    const extra = words.filter((word) => !focusSet.has(word)).sort((a, b) => rarity(index, b) - rarity(index, a) || (a < b ? -1 : 1))[0];
    const missing = focus.words.find((word) => !shared.includes(word));
    if (extra === undefined && missing === undefined) continue;
    const note = missing !== undefined && extra !== undefined ? `${extra} INSTEAD OF ${missing}` : extra !== undefined ? `ADDS ${extra}` : `WITHOUT ${missing}`;
    found.push({ item, shared: shared.length, note });
  }
  return found
    .sort((a, b) => b.shared - a.shared || (a.item.id < b.item.id ? -1 : 1))
    .slice(0, limit)
    .map(({ item, note }) => ({ item, note }));
}

/** The rarest items still near the focus. Needs a focus, or "rarest" would just be every odd item on the site. */
export function edgePicks(index: StationIndex, items: readonly StationItem[], focus: Focus, skip: ReadonlySet<string>, limit = 5): StationItem[] {
  if (focus.words.length === 0) return [];
  return items
    .filter((item) => !skip.has(item.id) && !poorTitle(item.title, item.externalId))
    .sort((a, b) => itemCommonness(index, a) - itemCommonness(index, b) || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
}

export type Loosening = { label: string; recipe: Recipe; more: number };

/**
 * When little is found, what to loosen and what that gains: "DROP THE vocals EXCLUSION: 12 MORE". Each one is tried for real,
 * and only one that finds more is offered, so the number is never a guess.
 */
export function loosenings(index: StationIndex, recipe: Recipe, focus: Focus, found: number, linkWords: readonly string[] = [], limit = 3): Loosening[] {
  const options: { label: string; recipe: Recipe }[] = [];
  for (const word of recipe.not) options.push({ label: `DROP THE ${word} EXCLUSION`, recipe: { ...recipe, not: recipe.not.filter((one) => one !== word) } });
  for (const word of recipe.must) options.push({ label: `DROP MUST-HAVE ${word}`, recipe: { ...recipe, must: recipe.must.filter((one) => one !== word) } });
  if (recipe.strict === 'all' && recipe.must.length > 1) options.push({ label: 'MOST OF THE MUST-HAVES', recipe: { ...recipe, strict: 'most' } });
  if (recipe.any.length > 0) options.push({ label: 'DROP THE ANY-OF WORDS', recipe: { ...recipe, any: [] } });
  if (recipe.niche !== 'all') options.push({ label: 'ANY NICHE', recipe: { ...recipe, niche: 'all' } });
  if (recipe.near === 'near') options.push({ label: 'LOOK WIDER', recipe: { ...recipe, near: 'wider' } });
  if (recipe.near === 'wider' && focus.words.length > 0) options.push({ label: 'LOOK FAR', recipe: { ...recipe, near: 'far' } });
  if (recipe.src !== 'both') options.push({ label: 'BOTH WORD SOURCES', recipe: { ...recipe, src: 'both' } });
  if (recipe.era !== null) options.push({ label: `ANY ERA, NOT JUST ${recipe.era}`, recipe: { ...recipe, era: null } });
  if (recipe.facet !== null) options.push({ label: 'ANY WORD TYPE', recipe: { ...recipe, facet: null } });
  if (recipe.kind !== null) options.push({ label: 'ANY TYPE', recipe: { ...recipe, kind: null } });
  if (recipe.site !== null) options.push({ label: 'ANY SOURCE', recipe: { ...recipe, site: null } });
  if (recipe.from !== null || recipe.to !== null) options.push({ label: 'ANY YEAR', recipe: { ...recipe, from: null, to: null } });

  return options
    .map((option) => ({ ...option, more: matchItems(index, option.recipe, focusOf(index, option.recipe, linkWords)).length - found }))
    .filter((option) => option.more > 0)
    .sort((a, b) => b.more - a.more || (a.label < b.label ? -1 : 1))
    .slice(0, limit);
}

/**
 * How many items carry a word, and how many of them the page holds so far (SPEC-discover.md). The first number is the whole catalogue's; a list holds what's been read of it, so one number alone
 * promises rows nobody can reach. `finished` says every file that could hold the word has been read.
 */
export function wordItemsLine(index: StationIndex, name: string, finished = false): string {
  const count = index.tagByName.get(name)?.count ?? 0;
  const found = index.itemsByWord.get(name)?.size ?? 0;
  const on = count === 1 ? 'ON 1 ITEM' : `ON ${count} ITEMS`;
  if (found >= count) return count === 1 ? on : `${on} · ALL FOUND`;
  return finished ? `${on} · ${found} FOUND, ALL FILES READ` : `${on} · ${found} FOUND SO FAR`;
}

/** What's typed, as a word to look up in the catalogue, when nothing offered spells it. The map shows 2,000 words and the catalogue holds far more. Null when there's nothing to look up. */
export function wordToLookUp(typed: string, onMap: readonly string[]): string | null {
  const word = typed.trim().toLowerCase();
  return word.length < 3 || onMap.some((name) => wordKey(name) === wordKey(word)) ? null : word;
}

export type Suggestions = { tags: StationTag[]; items: StationItem[] };

/** What the search box offers for what's typed: exact words, then starts-with, then contains, then near-misses for typos. */
export function suggest(index: StationIndex, text: string, limits = { tags: 6, items: 5 }): Suggestions {
  const typed = text.trim().toLowerCase();
  const key = wordKey(typed);
  if (key.length === 0) return { tags: [], items: [] };

  const tierOf = (tag: StationTag): number | null => {
    const tagKey = wordKey(tag.name);
    if (tagKey === key) return 0;
    if (tagKey.startsWith(key)) return 1;
    if (tag.name.split(' ').some((part) => part.startsWith(typed))) return 2;
    if (key.length >= 3 && tagKey.includes(key)) return 3;
    const limit = key.length <= 3 ? 0 : key.length <= 5 ? 1 : 2;
    return limit > 0 && editDistance(key, tagKey, limit) <= limit ? 4 : null;
  };
  const joined = index.tagByKey.get(key);
  const found = index.graph.tags
    .map((tag) => ({ tag, tier: tierOf(tag) }))
    .filter((entry): entry is { tag: StationTag; tier: number } => entry.tier !== null)
    .sort((a, b) => a.tier - b.tier || b.tag.count - a.tag.count || (a.tag.name < b.tag.name ? -1 : 1))
    .map((entry) => entry.tag);
  // A spelling joined to another word finds that word first, whatever it looks like.
  const tags = (joined !== undefined ? [joined, ...found.filter((tag) => tag !== joined)] : found).slice(0, limits.tags);

  const words = typed.split(/\s+/).filter(Boolean);
  const items = index.graph.items
    .filter((item) => {
      const haystack = `${item.title} ${item.creator ?? ''}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, limits.items);
  return { tags, items };
}

/**
 * Map words a link's own title and description mention, for a link that came with few words of its own. Whole words and two-word
 * phrases only, and only words on at least two items, so a stray rare word can't place a link.
 */
export function wordsInText(index: StationIndex, text: string, limit = 8): string[] {
  const parts = text.toLowerCase().split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
  const found = new Set<string>();
  const offer = (phrase: string) => {
    const tag = findTag(index, phrase);
    if (tag !== null && tag.count >= 2) found.add(tag.name);
  };
  parts.forEach((part, at) => {
    if (part.length >= 4) offer(part);
    if (at + 1 < parts.length) offer(`${part} ${parts[at + 1]}`);
  });
  return [...found].slice(0, limit);
}

/** Everything the three panels need at once, so they can't disagree. */
export function neighbourhood(index: StationIndex, recipe: Recipe, linkWords: readonly string[] = []) {
  const focus = focusOf(index, recipe, linkWords);
  const matched = matchItems(index, recipe, focus);
  const results = sortItems(index, matched, recipe, focus);
  return { focus, matched, results };
}

/** The recipe with everything but what was chosen and how it's shown put back to its defaults. */
export function clearedFilters(recipe: Recipe): Recipe {
  return { ...EMPTY_RECIPE, tag: recipe.tag, item: recipe.item, link: recipe.link, view: recipe.view, sort: recipe.sort };
}
