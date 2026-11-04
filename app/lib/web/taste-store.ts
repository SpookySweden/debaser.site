'use client';

import { NO_TASTE, trimCounts, withOpened, type ScoredItem, type Taste } from './recommend';

/**
 * A reader's tastes, kept in this browser only (recommend.ts). Never sent anywhere: the page reads it to order the list
 * it already has. Storage can throw or come back empty (a private window, cleared data), and then the list is simply
 * ordered for a stranger.
 */
const KEY = 'debaser.media-taste.v1';
const MAX_WORDS = 200;
const MAX_NAMES = 100;

const counts = (value: unknown): Record<string, number> =>
  typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
    : {};

export function readTaste(): Taste {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<Taste> | null;
    if (saved === null) return NO_TASTE;
    return { tags: counts(saved.tags), creators: counts(saved.creators), platforms: counts(saved.platforms) };
  } catch {
    return NO_TASTE;
  }
}

export function saveTaste(taste: Taste): void {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ tags: trimCounts(taste.tags, MAX_WORDS), creators: trimCounts(taste.creators, MAX_NAMES), platforms: taste.platforms }),
    );
  } catch {
    // A browser that will not store it just stays a stranger.
  }
}

/** The reader opened or played this row. */
export function noteOpened(item: Pick<ScoredItem, 'platform' | 'creator' | 'tags'>, extra: readonly string[] = []): void {
  saveTaste(withOpened(readTaste(), item, extra));
}
