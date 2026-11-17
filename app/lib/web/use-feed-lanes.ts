'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadStationIndex } from '../tag-station/client';
import { useMoreItems, type PoolAsk } from '../tag-station/more';
import { discoverList, poolReady, recommendedList } from '../tag-station/picks';
import { getPresetStore, withPreset, type Preset } from '../tag-station/presets';
import type { StationIndex } from '../tag-station/query';
import { EMPTY_RECIPE, type Recipe } from '../tag-station/recipe';
import type { StationItem } from '../tag-station/types';
import { getRecommendationStore, type RecommendedPick } from './recommendations';
import type { Taste } from './recommend';
import type { WebItem } from './types';

/**
 * Two of the default feed's sources (SPEC-media-feed.md), read the way MEDIA's DISCOVER and RECOMMENDED read them
 * (WebPickedList.tsx): NEW TO YOU, the DISCOVER catalogue's finds by the reader's active preset or else their own
 * strongest words; and PEOPLE'S PICKS, what people here recommended publicly (shown without names to a visitor, as
 * RECOMMENDED does). Both are null until they have answered, and empty when the catalogue can't be read or isn't
 * ready. `on` false asks for nothing.
 */
export type FeedLanes = {
  discover: readonly WebItem[] | null;
  /** People's public picks found in the catalogue, with who recommended each. */
  people: readonly { item: WebItem; people: readonly { id: string; name: string }[] }[] | null;
  /** Every public pick as read (an id and who), so the page can find the ones in the saved stream too. */
  picks: readonly RecommendedPick[];
};

/** A catalogue row as a MEDIA row: its words become its tags (they only ever order a list). */
function asItem(item: StationItem): WebItem {
  const { words, seenOnly, catalogue, ...rest } = item;
  void seenOnly;
  void catalogue;
  return { ...rest, tags: words.map((word) => word.word) };
}

export function useFeedLanes(on: boolean, taste: Taste | null, now: number): FeedLanes {
  const [loaded, setLoaded] = useState<StationIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [picks, setPicks] = useState<readonly RecommendedPick[]>([]);
  const [recipe, setRecipe] = useState<Recipe | null>(null);

  useEffect(() => {
    if (!on) return;
    let live = true;
    void (async () => {
      try {
        const [map, feed, presets] = await Promise.all([
          loadStationIndex(),
          getRecommendationStore().feed(300).catch((): RecommendedPick[] => []),
          getPresetStore().list().catch((): Preset[] => []),
        ]);
        if (!live) return;
        const active = presets.find((one) => one.active);
        setRecipe(active ? withPreset(EMPTY_RECIPE, active.settings) : EMPTY_RECIPE);
        setPicks(feed);
        setLoaded(map);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [on]);

  // The preset's words, or the reader's own strongest, as DISCOVER asks the pool's files.
  const ask = useMemo((): PoolAsk | null => {
    if (loaded === null || !poolReady(loaded) || taste === null || recipe === null) return null;
    const preset = [...recipe.must, ...recipe.any];
    const own = Object.entries(taste.tags).sort(([, a], [, b]) => b - a).map(([word]) => word);
    const wanted = preset.length > 0 ? preset : own;
    return wanted.length > 0 ? { words: wanted.slice(0, 12) } : { browse: true };
  }, [loaded, recipe, taste]);
  const digging = useMoreItems(loaded, ask);

  return useMemo((): FeedLanes => {
    if (failed || (loaded !== null && !poolReady(loaded))) return { discover: [], people: [], picks };
    const index = digging.index;
    if (index === null || taste === null || recipe === null || digging.loading) return { discover: null, people: null, picks };
    const discover = discoverList(index, recipe, taste, 'best', now)
      .filter((item) => !item.seenOnly)
      .slice(0, 120)
      .map(asItem);
    const people = recommendedList(index, picks, taste, 'best', now)
      .filter((row) => row.people.length > 0 && !row.item.seenOnly)
      .slice(0, 60)
      .map((row) => ({ item: asItem(row.item), people: row.people }));
    return { discover, people, picks };
  }, [failed, loaded, digging.index, digging.loading, taste, recipe, picks, now]);
}
