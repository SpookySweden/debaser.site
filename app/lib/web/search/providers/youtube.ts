/**
 * Search everywhere: all of YouTube. `youtubeSearch` asks InnerTube first (youtube-innertube.ts: no key, no
 * quota), and only when that fails the official Data API below (`youtubeApiSearch`), spending its daily
 * budget then and only then; with neither, "YOUTUBE: NO ANSWER". A next page goes back to whichever answered.
 *
 * The fallback, through the YouTube Data API v3 (`search.list`, videos only, embeddable
 * only, YouTube's moderate safe search). It needs a key: `YOUTUBE_API_KEY`, a server-only setting Luke adds
 * on Vercel (SPEC-web-search.md has his steps). Without it YouTube says "NOT SET UP" and asks nothing.
 *
 * **The key never leaves the server.** It is read from `deps.env` (the route reads `process.env`), goes
 * into the request URL only, and nothing here returns, throws or logs anything that holds it: errors are
 * fixed phrases (`SearchProblemError`) and `safe-fetch` errors carry a status, never the URL.
 * `scripts/check-web-search-youtube.cjs` holds that, and keeps the name out of browser code and NEXT_PUBLIC.
 *
 * Quota: a search costs 100 of the free 10,000 units a day, so about 100 searches; the day-long fetch cache
 * makes a repeated search free. YouTube answers 403 when the day's quota is spent ("DAILY LIMIT REACHED")
 * and 400 for a key it does not accept ("KEY REFUSED").
 *
 * One item by id: `videos.list` with the key (1 unit); without it YouTube's keyless oEmbed, which knows the
 * title and channel but not the upload date, so the item is dated when it was read.
 *
 * Addresses are the stream adapter's (`../../adapters/youtube.ts`): youtu.be page, i.ytimg.com thumbnail,
 * the youtube-nocookie player. Ids starting with `-` or `_` are skipped, as there.
 */
import { SafeFetchError, safeFetchJson } from '../../safe-fetch';
import { MAX_TEXT_LENGTH, plausibleIsoDate, sanitiseText } from '../../sanitise';
import { buildUrl } from '../../urls';
import type { WebItem } from '../../types';
import { SearchProblemError, type ProviderPage, type SearchDeps, type SearchPage, type SearchProvider } from '../types';
import { INNERTUBE_TOKEN, innertubeSearch } from './youtube-innertube';

const API_HOST = 'www.googleapis.com';
const OEMBED_HOST = 'www.youtube.com';
export const YT_SEARCH_HOSTS = [API_HOST, OEMBED_HOST] as const;
export const YT_SEARCH_MAX = 20;
/** YouTube's 11-character id, with WEB's alphanumeric first character. */
export const YT_VIDEO_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{10}$/;
const PAGE_TOKEN = /^[A-Za-z0-9_-]{1,120}$/;
/** The shape of a Google API key; anything else is treated as not set up rather than sent. */
const KEY_SHAPE = /^[A-Za-z0-9_-]{20,100}$/;

/** The key, or null when it is missing or not shaped like one. */
export function youtubeKey(deps: SearchDeps): string | null {
  const key = deps.env?.YOUTUBE_API_KEY?.trim();
  return key && KEY_SHAPE.test(key) ? key : null;
}

export function ytSearchUrl(words: string, pageToken: string | null, key: string): string {
  return buildUrl(API_HOST, ['youtube', 'v3', 'search'], [
    ['part', 'snippet'],
    ['type', 'video'],
    ['videoEmbeddable', 'true'],
    ['safeSearch', 'moderate'],
    ['maxResults', String(YT_SEARCH_MAX)],
    ['q', words],
    ...(pageToken ? [['pageToken', pageToken] as const] : []),
    ['key', key],
  ]);
}

export function ytVideoUrl(id: string, key: string): string {
  return buildUrl(API_HOST, ['youtube', 'v3', 'videos'], [
    ['part', 'snippet'],
    ['id', id],
    ['key', key],
  ]);
}

export function ytOembedUrl(id: string): string {
  return buildUrl(OEMBED_HOST, ['oembed'], [
    ['url', buildUrl('www.youtube.com', ['watch'], [['v', id]])],
    ['format', 'json'],
  ]);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A video as a WebItem, from its validated id and its words. */
export function youtubeItem(id: string, words: { title?: string; creator?: string; description?: string }, publishedAt: string, fetchedAt: string): WebItem {
  const page = buildUrl('youtu.be', [id]);
  const title = sanitiseText(words.title, 300) || id;
  const creator = sanitiseText(words.creator, 200) || undefined;
  const description = sanitiseText(words.description, MAX_TEXT_LENGTH) || undefined;
  return {
    id: `youtube:${id}`,
    platform: 'youtube',
    externalId: id,
    kind: 'video',
    url: page,
    canonicalUrl: page,
    title,
    ...(creator ? { creator } : {}),
    ...(description ? { description } : {}),
    thumbnailUrl: buildUrl('i.ytimg.com', ['vi', id, 'hqdefault.jpg']),
    embedUrl: buildUrl('www.youtube-nocookie.com', ['embed', id]),
    publishedAt,
    fetchedAt,
  };
}

/** One search result (or `videos.list` entry, `idField` 'id') as a WebItem, or null. */
export function toWebItem(doc: unknown, fetchedAt: string, idField: 'search' | 'videos' = 'search'): WebItem | null {
  const entry = record(doc);
  if (!entry) return null;
  const id = idField === 'search' ? str(record(entry.id)?.videoId) : str(entry.id);
  if (!id || !YT_VIDEO_ID.test(id)) return null;
  const snippet = record(entry.snippet);
  if (!snippet) return null;
  // Live and upcoming broadcasts are not something to queue or play later.
  if (str(snippet.liveBroadcastContent) !== 'none') return null;
  const publishedAt = plausibleIsoDate(snippet.publishedAt, fetchedAt);
  if (!publishedAt) return null;
  return youtubeItem(id, { title: str(snippet.title), creator: str(snippet.channelTitle), description: str(snippet.description) }, publishedAt, fetchedAt);
}

export function parseYtSearch(body: unknown, fetchedAt: string): SearchPage {
  const root = record(body);
  if (!root || !Array.isArray(root.items)) throw new Error('unexpected response shape');
  const items: WebItem[] = [];
  for (const doc of root.items) {
    const item = toWebItem(doc, fetchedAt);
    if (item && !items.some((seen) => seen.id === item.id)) items.push(item);
  }
  const token = str(root.nextPageToken);
  return { items, next: token && PAGE_TOKEN.test(token) ? token : null };
}

/** A failure as a fixed phrase. Nothing of the error, which never holds the URL anyway, is passed on. */
function youtubeProblem(error: unknown): never {
  if (error instanceof SafeFetchError && error.status === 403) throw new SearchProblemError('DAILY LIMIT REACHED');
  if (error instanceof SafeFetchError && error.status === 400) throw new SearchProblemError('KEY REFUSED');
  if (error instanceof SafeFetchError && error.status === undefined) throw new SearchProblemError('NO ANSWER');
  throw new SearchProblemError('COULD NOT READ');
}

/** One video by id: `videos.list` with the key, keyless oEmbed without. Null when YouTube does not have it. */
export async function youtubeById(id: string, deps: SearchDeps): Promise<WebItem | null> {
  if (!YT_VIDEO_ID.test(id)) return null;
  const fetchedAt = (deps.now?.() ?? new Date()).toISOString();
  const key = youtubeKey(deps);
  if (key) {
    let body: unknown;
    try {
      body = await safeFetchJson(ytVideoUrl(id, key), { allowedHosts: [API_HOST], fetchImpl: deps.fetch });
    } catch (error) {
      youtubeProblem(error);
    }
    const first = record(body)?.items;
    return Array.isArray(first) ? (toWebItem(first[0], fetchedAt, 'videos') ?? null) : null;
  }
  let body: unknown;
  try {
    body = await safeFetchJson(ytOembedUrl(id), { allowedHosts: [OEMBED_HOST], fetchImpl: deps.fetch });
  } catch (error) {
    // 401 (embedding off), 403 (private) and 404 (gone) all mean there is nothing WEB can play.
    if (error instanceof SafeFetchError && error.status !== undefined && error.status >= 400 && error.status < 500) return null;
    throw error;
  }
  const root = record(body);
  if (!root || str(root.type) !== 'video') return null;
  return youtubeItem(id, { title: str(root.title), creator: str(root.author_name) }, fetchedAt, fetchedAt);
}

/** The official Data API alone: the fallback `youtubeSearch` uses. */
export const youtubeApiSearch: SearchProvider = {
  platform: 'youtube',
  allowedHosts: YT_SEARCH_HOSTS,
  timeoutMs: 10_000,
  // 100 units a search of the 10,000 a day: at most 80 a day per server instance and 15 per visitor.
  dailyBudget: { perAddress: 15, perInstance: 80 },
  async search(words: string, page: ProviderPage | null, deps: SearchDeps): Promise<SearchPage> {
    const key = youtubeKey(deps);
    if (!key) throw new SearchProblemError('NOT SET UP');
    const token = typeof page === 'string' && PAGE_TOKEN.test(page) ? page : null;
    let body: unknown;
    try {
      body = await safeFetchJson(ytSearchUrl(words, token, key), { allowedHosts: [API_HOST], fetchImpl: deps.fetch });
    } catch (error) {
      youtubeProblem(error);
    }
    return parseYtSearch(body, (deps.now?.() ?? new Date()).toISOString());
  },
  fetchOne: youtubeById,
};

/** An InnerTube next page travels in the cursor as `it_<token>`; a Data API page token never starts so. */
const INNERTUBE_PAGE = 'it_';

export const youtubeSearch: SearchProvider = {
  platform: 'youtube',
  // www.youtube.com (InnerTube) is already in YT_SEARCH_HOSTS for oEmbed. Plain values here, not youtube-innertube.ts's
  // constants: the two files import each other, so neither may read the other while it loads.
  allowedHosts: YT_SEARCH_HOSTS,
  // InnerTube's 6s (INNERTUBE_TIMEOUT_MS), then the Data API's 10s.
  timeoutMs: 16_000,
  // The Data API's budget, spent here only when the fallback is used (run.ts does not spend it up front).
  dailyBudget: youtubeApiSearch.dailyBudget,
  spendsOwnBudget: true,
  async search(words: string, page: ProviderPage | null, deps: SearchDeps): Promise<SearchPage> {
    const fetchedAt = (deps.now?.() ?? new Date()).toISOString();
    const continuation = typeof page === 'string' && page.startsWith(INNERTUBE_PAGE) ? page.slice(INNERTUBE_PAGE.length) : null;
    if (page === null || continuation !== null) {
      if (continuation !== null && !INNERTUBE_TOKEN.test(continuation)) return { items: [], next: null };
      try {
        const found = await innertubeSearch(words, continuation, deps.fetch, fetchedAt);
        return { items: found.items, next: found.next === null ? null : `${INNERTUBE_PAGE}${found.next}` };
      } catch {
        // InnerTube failed (changed, blocked or slow). A next page of it cannot be asked of the Data API.
        if (continuation !== null) throw new SearchProblemError('NO ANSWER');
      }
    }
    if (!youtubeKey(deps)) throw new SearchProblemError('NO ANSWER');
    if (deps.spendBudget && !deps.spendBudget('youtube')) throw new SearchProblemError('DAILY LIMIT REACHED');
    return youtubeApiSearch.search(words, page, deps);
  },
  fetchOne: youtubeById,
};
