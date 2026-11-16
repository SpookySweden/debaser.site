import type { WebItem } from '../types';

/**
 * The reading sources mixed into MEDIA's default feed (SPEC-media-feed.md; Luke's yes and decisions 1A, 2A, 3A,
 * 2026-11-16): papers, news, long reads and tech links, read live by `/api/web/brief` and never stored.
 *
 * No fetching here, so the page may import this file too. The article feeds and every reading host and path live in
 * `../hosts.ts` (re-exported here), as the podcast feeds do, so the page re-checks every address against them before it
 * draws a link or a picture (`rowAddresses`); the open-link rule lives in `../urls.ts`. They are there, not here, because
 * hosts.ts must not import this folder: the production build's prerender broke on it (2026-11-16). Adding or removing
 * an outlet is one entry in hosts.ts and `npm run checks:web`; no feed, host or picture ever comes from the feeds.
 */

/** The four kinds of reading, each its own platform in the stream's terms (types.ts `ReadingPlatform`). */
export type ReadingKind = 'paper' | 'news' | 'longread' | 'tech';
export const READING_KINDS: readonly ReadingKind[] = ['paper', 'news', 'longread', 'tech'];

export function isReadingKind(value: unknown): value is ReadingKind {
  return typeof value === 'string' && (READING_KINDS as readonly string[]).includes(value);
}

/**
 * One row of `/api/web/brief`: an item and its kind. Papers, articles and Wikipedia are rows of their kind's platform;
 * the broadcasters' news videos are ordinary YouTube rows (kind `news`) and the Archive's lectures ordinary Internet
 * Archive rows (kind `longread`), so they play as those always have.
 */
export type BriefRow = { kind: ReadingKind; item: WebItem };

/** What the route answers. No person, no words: the same for everyone. */
export type BriefAnswer = { rows: BriefRow[] };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long each kind stays in the default feed (a search still finds it). Wikipedia's "In the news" is read from
 * today's list only, so it is as fresh as the list is.
 */
export const SHELF_LIFE_MS: Readonly<Record<ReadingKind, number>> = {
  news: 48 * HOUR_MS,
  tech: 3 * DAY_MS,
  paper: 30 * DAY_MS,
  longread: 365 * DAY_MS,
};

export {
  ARTICLE_FEEDS,
  ARXIV_API_HOST,
  ARXIV_ID,
  ARXIV_PAGE_HOST,
  ARXIV_PAGE_PATH,
  articleHosts,
  articlePaths,
  EUROPE_PMC_API_HOST,
  EUROPE_PMC_PAGE_HOST,
  EUROPE_PMC_PAGE_PATH,
  OPEN_LINK_PREFIXES,
  WIKIPEDIA_HOST,
  WIKIPEDIA_PAGE_PATH,
  type ArticleFeed,
} from '../hosts';
export { openLink, openLinkSite } from '../urls';

/** The broadcasters' news videos (SPEC-media-feed.md): read by the stream's own YouTube adapter, ids live-checked 2026-11-16. */
export const NEWS_CHANNELS: readonly { channelId: string; outlet: string }[] = [
  { channelId: 'UCknLrEdhRCp1aegoMqRaCZg', outlet: 'DW NEWS' },
  { channelId: 'UC6ZFN9Tx6xh-skXCuRHCDpQ', outlet: 'PBS NEWSHOUR' },
  { channelId: 'UCNye-wNBqNL5ZzHSJj3l8Bg', outlet: 'AL JAZEERA ENGLISH' },
];

/** Lectures as long reads: the stream's own Internet Archive adapter, this one query, newest first in English (2026-11-16: 1,007 items). */
export const LECTURE_QUERY = 'mediatype:movies AND subject:(lecture) AND licenseurl:*creativecommons* AND (language:eng OR language:English)';
