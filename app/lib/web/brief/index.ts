/**
 * The reading for MEDIA's default feed, all sources at once (SPEC-media-feed.md; Luke's decision 1A, 2026-11-16: read
 * live, kept 30 minutes on the server, no database). Server-only: `/api/web/brief` calls `readBrief`.
 *
 * Every source is asked at the same time, one request each. One that fails keeps its last good answer for up to six
 * hours (in this server instance's memory), then goes quiet; the others carry on. Only rows still inside their kind's
 * shelf life come back, newest first within each source's own order where it has one (Hacker News keeps its own).
 */
import type { FetchLike } from '../safe-fetch';
import type { WebItem } from '../types';
import { internetArchiveAdapter } from '../adapters/internet-archive';
import { youtubeAdapter } from '../adapters/youtube';
import { fetchArxiv } from './arxiv';
import { fetchArticles } from './articles';
import { fetchEuropePmc } from './europe-pmc';
import { ARTICLE_FEEDS, LECTURE_QUERY, NEWS_CHANNELS, SHELF_LIFE_MS, type BriefRow, type ReadingKind } from './feeds';
import { fetchWikipedia } from './wikipedia';

export type BriefDeps = { fetch?: FetchLike; now?: () => Date };

/** One source: its key (for its last good answer) and how to read it. */
export type BriefSource = { key: string; read: (deps: BriefDeps) => Promise<BriefRow[]> };

const rowsOf = (kind: ReadingKind, items: readonly WebItem[]): BriefRow[] => items.map((item) => ({ kind, item }));
const source = (key: string, kind: ReadingKind, read: (deps: BriefDeps) => Promise<WebItem[]>): BriefSource => ({
  key,
  read: async (deps) => rowsOf(kind, await read(deps)),
});
const stub = (ref: string, platform: 'youtube' | 'internet_archive') => ({ id: `brief-${ref}`, platform, ref, label: ref, enabled: true });

/** Every reading source, in one list: about 21 requests a read. */
export const BRIEF_SOURCES: readonly BriefSource[] = [
  source('arxiv', 'paper', fetchArxiv),
  source('europepmc', 'paper', fetchEuropePmc),
  { key: 'wikipedia', read: fetchWikipedia },
  ...ARTICLE_FEEDS.map((feed) => source(feed.key, feed.kind, (deps) => fetchArticles(feed, deps))),
  // The broadcasters' news videos and the Archive's lectures, read by the stream's own adapters.
  ...NEWS_CHANNELS.map(({ channelId }) => source(`yt-${channelId}`, 'news', (deps) => youtubeAdapter.fetchItems(stub(channelId, 'youtube'), deps))),
  source('lectures', 'longread', (deps) => internetArchiveAdapter.fetchItems(stub(LECTURE_QUERY, 'internet_archive'), deps)),
];

export const LAST_GOOD_MS = 6 * 60 * 60 * 1000;

/** Each source's last good answer, by key: kept in this instance's memory only. */
const lastGood = new Map<string, { rows: BriefRow[]; at: number }>();

/** For a check: forget every kept answer. */
export function forgetLastGood(): void {
  lastGood.clear();
}

/** Whether a row is still inside its kind's shelf life at `now`. A row with no readable date is not. */
export function onShelf(row: BriefRow, now: number): boolean {
  const published = Date.parse(row.item.publishedAt);
  return Number.isFinite(published) && now - published <= SHELF_LIFE_MS[row.kind];
}

/** Every source read at once; the rows still on their shelves, by source. Never throws. */
export async function readBrief(deps: BriefDeps = {}, sources: readonly BriefSource[] = BRIEF_SOURCES): Promise<BriefRow[]> {
  const now = (deps.now?.() ?? new Date()).getTime();
  const answers = await Promise.all(
    sources.map(async ({ key, read }) => {
      try {
        const rows = await read(deps);
        lastGood.set(key, { rows, at: now });
        return rows;
      } catch {
        const kept = lastGood.get(key);
        return kept && now - kept.at <= LAST_GOOD_MS ? kept.rows : [];
      }
    }),
  );
  const seen = new Set<string>();
  const out: BriefRow[] = [];
  for (const row of answers.flat()) {
    if (seen.has(row.item.id) || !onShelf(row, now)) continue;
    seen.add(row.item.id);
    out.push(row);
  }
  return out;
}
