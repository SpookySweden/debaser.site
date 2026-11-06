import type { WebItem, WebItemKind } from './types';

/**
 * What MEDIA shows before anyone has searched (Luke, 2026-11-04; SPEC-media-picks.md): the saved items in the order most
 * likely to suit this reader, and never an empty list. Pure, so it can be held by a check: nothing here reads a clock,
 * the browser or the network.
 *
 * Reader's tastes are counts built from what they open and play in this browser (`taste-store.ts`), plus the channels
 * from a linked YouTube account. Metadata only (CLAUDE.md): no likes, views or ratings of anybody else's go in.
 */

/** How much a reader has shown for each word, creator and platform. Keys are normalised by `normal`. */
export type Taste = {
  tags: Readonly<Record<string, number>>;
  creators: Readonly<Record<string, number>>;
  platforms: Readonly<Record<string, number>>;
};

export const NO_TASTE: Taste = { tags: {}, creators: {}, platforms: {} };

export type ScoredItem = Pick<WebItem, 'id' | 'platform' | 'title' | 'creator' | 'tags' | 'publishedAt' | 'thumbnailUrl'>;

const normal = (word: string): string => word.trim().toLowerCase();

/** A tag counts up to this many times, so one obsession cannot push out everything else. */
const CAP = 4;
const DAY_MS = 86_400_000;

/** The weights: what the reader has shown matters most; age and a picture only break ties between strangers. */
const WEIGHT = { tag: 3, creator: 5, platform: 0.5, fresh: 2, picture: 0.5, jitter: 1 };

/** A steady number from 0 to 1 for this item on this day: the same list all day, a different one tomorrow. */
export function dayJitter(id: string, day: number): number {
  let hash = (day * 2654435761) >>> 0;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0;
  return hash / 0xffffffff;
}

/** The item's words: the platform's own tags and Claude's (`web_item_tags`), once each. */
export function wordsOf(item: Pick<ScoredItem, 'tags'>, extra: readonly string[] = []): string[] {
  return [...new Set([...(item.tags ?? []), ...extra].map(normal).filter(Boolean))];
}

/** How much this item's words and maker are what the reader has shown they like. */
export function tasteScore(item: Pick<ScoredItem, 'tags' | 'creator'>, taste: Taste, extra: readonly string[] = []): number {
  const tagScore = wordsOf(item, extra).reduce((sum, word) => sum + Math.min(taste.tags[word] ?? 0, CAP), 0);
  const creator = item.creator ? Math.min(taste.creators[normal(item.creator)] ?? 0, CAP) : 0;
  return WEIGHT.tag * tagScore + WEIGHT.creator * creator;
}

export function scoreItem(item: ScoredItem, taste: Taste, extra: readonly string[], now: number): number {
  const day = Math.floor(now / DAY_MS);
  const platform = Math.min(taste.platforms[item.platform] ?? 0, CAP);
  const published = Date.parse(item.publishedAt ?? '');
  // Halves every 30 days. A row with no date is treated as a month old, not as new.
  const age = Number.isFinite(published) ? Math.max(0, now - published) / DAY_MS : 30;
  return (
    tasteScore(item, taste, extra) +
    WEIGHT.platform * platform +
    WEIGHT.fresh * 0.5 ** (age / 30) +
    (item.thumbnailUrl ? WEIGHT.picture : 0) +
    WEIGHT.jitter * dayJitter(item.id, day)
  );
}

/** Each earlier pick from the same place costs a later one this much, so one site or channel cannot fill the page. */
const REPEAT = { platform: 0.75, creator: 2 };

/**
 * The items best first, with variety: picks one at a time, marking down whatever has just been used. Every item comes
 * back exactly once, so the list never loses a row; that is what makes it safe to draw in place of the saved order.
 */
export function recommendOrder<T extends ScoredItem>(
  items: readonly T[],
  taste: Taste,
  extraFor: (id: string) => readonly string[],
  now: number,
): T[] {
  const left = items.map((item) => ({ item, score: scoreItem(item, taste, extraFor(item.id), now) }));
  const fromPlatform = new Map<string, number>();
  const fromCreator = new Map<string, number>();
  const picked: T[] = [];
  while (left.length > 0) {
    let best = 0;
    let bestValue = -Infinity;
    left.forEach(({ item, score }, index) => {
      const creator = item.creator ? normal(item.creator) : '';
      const value =
        score -
        REPEAT.platform * (fromPlatform.get(item.platform) ?? 0) -
        (creator ? REPEAT.creator * (fromCreator.get(creator) ?? 0) : 0);
      if (value > bestValue || (value === bestValue && item.id < left[best].item.id)) {
        best = index;
        bestValue = value;
      }
    });
    const [{ item }] = left.splice(best, 1);
    picked.push(item);
    fromPlatform.set(item.platform, (fromPlatform.get(item.platform) ?? 0) + 1);
    if (item.creator) fromCreator.set(normal(item.creator), (fromCreator.get(normal(item.creator)) ?? 0) + 1);
  }
  return picked;
}

/** A reader's taste after opening or playing this. Counts only go up; the store caps how many words it keeps. */
export function withOpened(taste: Taste, item: Pick<ScoredItem, 'platform' | 'creator' | 'tags'>, extra: readonly string[] = []): Taste {
  const bump = (from: Readonly<Record<string, number>>, key: string, by = 1) => ({ ...from, [key]: (from[key] ?? 0) + by });
  return {
    tags: wordsOf(item, extra).reduce<Readonly<Record<string, number>>>((tags, word) => bump(tags, word), taste.tags),
    creators: item.creator ? bump(taste.creators, normal(item.creator)) : taste.creators,
    platforms: bump(taste.platforms, item.platform),
  };
}

/** Keeps the strongest `limit` keys, so a browser's saved taste cannot grow for ever. */
export function trimCounts(counts: Readonly<Record<string, number>>, limit: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts)
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .slice(0, limit),
  );
}

const MAX_TASTE_SEEDS = 3;

/**
 * Words to ask a live source for when the saved stream has nothing to show under the filters. Generic on purpose, so a
 * picked list reads as a browse rather than as a search somebody made. Each kind has its own, and KINO's are genres.
 */
const SEEDS: Readonly<Record<'kino' | WebItemKind | 'all', readonly string[]>> = {
  kino: ['drama', 'comedy', 'thriller', 'science fiction', 'documentary', 'animation', 'horror', 'mystery'],
  video: ['documentary', 'short film', 'live concert', 'animation', 'science', 'history'],
  audio: ['music', 'jazz', 'field recording', 'interview', 'radio', 'storytelling'],
  image: ['painting', 'photograph', 'poster', 'nature', 'architecture', 'map'],
  text: ['novel', 'history', 'science', 'poetry', 'essay', 'biography'],
  other: ['archive', 'history', 'art'],
  all: ['documentary', 'music', 'art', 'history', 'science', 'film'],
};

/**
 * The next word to try: the reader's strongest word that has not been tried, then the day's turn through the seeds for
 * this kind. Null once every seed has been tried, which is when a list may honestly say it found nothing.
 */
export function pickSeed(
  want: { kino: boolean; kind: WebItemKind | 'all' },
  taste: Taste,
  tried: ReadonlySet<string>,
  now: number,
): string | null {
  // KINO's words have to be genres TMDB knows, so a reader's free-form tags are not offered to it.
  if (!want.kino) {
    const strongest = Object.entries(taste.tags)
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([word]) => word)
      .filter((word) => word.length >= 3)
      // Only the strongest few, so one empty filter cannot run hundreds of searches.
      .slice(0, MAX_TASTE_SEEDS)
      .find((word) => !tried.has(word));
    if (strongest !== undefined) return strongest;
  }
  const seeds = SEEDS[want.kino ? 'kino' : want.kind];
  const start = Math.floor(now / DAY_MS) % seeds.length;
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[(start + i) % seeds.length];
    if (!tried.has(seed)) return seed;
  }
  return null;
}
