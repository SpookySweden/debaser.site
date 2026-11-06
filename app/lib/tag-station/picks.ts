import { dayJitter, recommendOrder, tasteScore, type Taste } from '../web/recommend';
import { focusOf, itemCommonness, matchItems, type StationIndex } from './query';
import type { Recipe } from './recipe';
import { sinkPoor } from './title-quality';
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

const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;
/** How much each thing counts toward a find. What the reader has shown they like is on its own scale (`tasteScore`) and comes first. */
const FIND = { obscure: 3, old: 2, oldWord: 1, jitter: 2, repeat: 1.5 };
/** A word naming an era before this year makes an item an old one, whatever day it was uploaded. */
const OLD_BEFORE = 1990;

/**
 * The catalogue's own order: old and obscure finds, with what the reader has shown they like first. A maker's further items cost more each, so one collection can't fill the page, and it changes by
 * the day, not the second, so a list holds still.
 */
function findsOrder(index: StationIndex, items: readonly StationItem[], taste: Taste, now: number): StationItem[] {
  const day = Math.floor(now / DAY_MS);
  const most = Math.log(1 + Math.max(index.total, 2));
  const scored = items.map((item) => {
    const obscure = 1 - Math.min(1, Math.log(1 + itemCommonness(index, item)) / most);
    const published = Date.parse(item.publishedAt);
    const old = Number.isFinite(published) ? Math.min(1, Math.max(0, now - published) / (20 * YEAR_MS)) : 0.5;
    const oldWord = item.words.some(({ word }) => Number.parseInt(index.tagByName.get(word)?.era ?? '', 10) < OLD_BEFORE);
    const score = tasteScore({ tags: words(item), creator: item.creator }, taste) + FIND.obscure * obscure + FIND.old * old + (oldWord ? FIND.oldWord : 0) + FIND.jitter * dayJitter(item.id, day);
    return { item, score };
  });
  scored.sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : 1));
  const seen = new Map<string, number>();
  return scored
    .map(({ item, score }) => {
      const maker = (item.creator ?? '').toLowerCase();
      const earlier = maker === '' ? 0 : (seen.get(maker) ?? 0);
      seen.set(maker, earlier + 1);
      return { item, score: score - FIND.repeat * earlier };
    })
    .sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : 1))
    .map(({ item }) => item);
}

/**
 * DISCOVER: the algorithm alone, applied the way the active preset says, leading with the tagged catalogue, then the saved feed, each in SORT's order. So it's never RECOMMENDED's list, under any
 * SORT. Junk titles and what has no player go last.
 */
export function discoverList(index: StationIndex, recipe: Recipe, taste: Taste, sort: PickSort, now: number): StationItem[] {
  const applied: Recipe = { ...recipe, tag: null, item: null, link: null };
  const found = matchItems(index, applied, focusOf(index, applied));
  const catalogue = found.filter((item) => item.catalogue);
  const leading = sort === 'best' ? findsOrder(index, catalogue, taste, now) : ordered(index, catalogue, taste, sort, now);
  return sinkPoor([...leading, ...ordered(index, found.filter((item) => !item.catalogue), taste, sort, now)]);
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
  const rest = index.graph.items.filter((item) => !people.has(item.id));
  // Under BEST the algorithm weighs everything together, and favours what's recent. Under SORT's other keys the saved feed leads, where DISCOVER has the catalogue lead, so they stay two lists.
  const others = sinkPoor(sort === 'best' ? ordered(index, rest, taste, sort, now) : [...ordered(index, rest.filter((item) => !item.catalogue), taste, sort, now), ...ordered(index, rest.filter((item) => item.catalogue), taste, sort, now)]);
  return [
    ...ordered(index, picked, taste, sort, now).map((item) => ({ item, people: people.get(item.id) ?? [] })),
    ...others.map((item) => ({ item, people: [] })),
  ];
}
