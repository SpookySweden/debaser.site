import type { WebPlatform } from '../types';
import { internetArchiveSearch } from './providers/internet-archive';
import { kinoSearch } from './providers/kino';
import { audiobooksSearch } from './providers/audiobooks';
import { booksSearch } from './providers/books';
import { openverseSearch } from './providers/openverse';
import { peertubeSearch } from './providers/peertube';
import { vimeoLookup } from './providers/vimeo';
import { wikimediaCommonsSearch } from './providers/wikimedia-commons';
import { youtubeSearch } from './providers/youtube';
import type { SearchProvider } from './types';

/**
 * Every provider searched by EVERYWHERE, in the order their problem lines show. SERVER ONLY.
 * Adding one: `.claude/skills/add-web-adapter/SKILL.md`, "A search provider".
 */
export const SEARCH_PROVIDERS: readonly SearchProvider[] = [
  internetArchiveSearch,
  youtubeSearch,
  peertubeSearch,
  wikimediaCommonsSearch,
  openverseSearch,
  kinoSearch,
  booksSearch,
  audiobooksSearch,
];

/**
 * Every provider that can fetch one item by id: the search providers, plus platforms reached only by a
 * pasted link. The hourly ingest saves an opened item through these (`web_requests`).
 */
export const FETCH_ONE_PROVIDERS: Partial<Record<WebPlatform, SearchProvider>> = Object.fromEntries(
  [...SEARCH_PROVIDERS, vimeoLookup].map((provider) => [provider.platform, provider]),
);
