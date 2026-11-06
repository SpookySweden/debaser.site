import { recommendOrder, type Taste } from '../web/recommend';
import { focusOf, itemCommonness, matchItems, type StationIndex } from './query';
import type { Recipe } from './recipe';
import type { StationItem } from './types';

/**
 * What MEDIA's RECOMMENDED and DISCOVER filters list (SPEC-discover.md). Pure and client-safe, so a check can hold it. Words and scores only ever
 * order the list: nothing here is shown on MEDIA.
 */

/** Both filters stay blank until this many items have been tagged (Luke, 2026-11-05). Never a fake list. */
export const POOL_TARGET = 10_000;

export function poolReady(index: StationIndex): boolean {
  return (index.graph.tagged ?? 0) >= POOL_TARGET;
}

export type PickSort = 'best' | 'newest' | 'oldest' | 'popular';

const words = (item: StationItem) => item.words.map((word) => word.word);

function ordered(index: StationIndex, items: readonly StationItem[], taste: Taste, sort: PickSort, now: number): StationItem[] {
  const list = [...items];
  const byId = (a: StationItem, b: StationItem) => (a.id < b.id ? -1 : 1);
  if (sort === 'newest') return list.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || byId(a, b));
  if (sort === 'oldest') return list.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || byId(a, b));
  // The site's own: how common an item's words are here. Never a platform's count.
  if (sort === 'popular') return list.sort((a, b) => itemCommonness(index, b) - itemCommonness(index, a) || byId(a, b));
  const row = list.map((item) => ({ ...item, tags: words(item) }));
  const order = recommendOrder(row, taste, () => [], now);
  const byItem = new Map(list.map((item) => [item.id, item]));
  return order.map((item) => byItem.get(item.id) as StationItem);
}

/** DISCOVER: the algorithm alone, applied the way the active preset says. */
export function discoverList(index: StationIndex, recipe: Recipe, taste: Taste, sort: PickSort, now: number): StationItem[] {
  const applied: Recipe = { ...recipe, tag: null, item: null, link: null };
  return ordered(index, matchItems(index, applied, focusOf(index, applied)), taste, sort, now);
}

export type RecommendedRow = { item: StationItem; people: { id: string; name: string }[] };

/** RECOMMENDED: people's picks first, each with who picked it, then the algorithm's own with nobody beside them. */
export function recommendedList(index: StationIndex, picks: readonly { person: string; displayName: string; itemId: string }[], taste: Taste, sort: PickSort, now: number): RecommendedRow[] {
  const people = new Map<string, { id: string; name: string }[]>();
  for (const pick of picks) {
    if (!index.itemById.has(pick.itemId)) continue;
    const list = people.get(pick.itemId) ?? [];
    if (!list.some((one) => one.id === pick.person)) list.push({ id: pick.person, name: pick.displayName });
    people.set(pick.itemId, list);
  }
  const picked = [...people.keys()].map((id) => index.itemById.get(id) as StationItem);
  const others = index.graph.items.filter((item) => !people.has(item.id));
  return [
    ...ordered(index, picked, taste, sort, now).map((item) => ({ item, people: people.get(item.id) ?? [] })),
    ...ordered(index, others, taste, sort, now).map((item) => ({ item, people: [] })),
  ];
}
