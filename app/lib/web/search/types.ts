import type { FetchLike } from '../safe-fetch';
import type { WebItem, WebPlatform } from '../types';

/**
 * WEB search everywhere (SPEC-web-search.md): one provider per platform, asked live at the moment of
 * searching. SERVER ONLY: every provider fetches through `safe-fetch` (`scripts/check-web-types.cjs` keeps
 * this folder out of browser code). Adding one: `.claude/skills/add-web-adapter/SKILL.md`, "A search provider".
 */

/** What a provider is handed, so a check can run it offline with a fake fetch, a fixed clock and a fake key. */
export type SearchDeps = {
  fetch?: FetchLike;
  now?: () => Date;
  /** Server-only settings (`YOUTUBE_API_KEY`). Read from `process.env` by the route, never by a provider. */
  env?: Readonly<Record<string, string | undefined>>;
  /** PeerTube instances from the public index (peertube-index.ts); a host outside it is never used. */
  peertubeHosts?: ReadonlySet<string>;
  /**
   * Spends one search from a quota-limited provider's daily budget (rate-limit.ts), false when it is spent:
   * that provider then shows "DAILY LIMIT REACHED" and is not asked. Only providers with `dailyBudget`.
   */
  spendBudget?: (platform: WebPlatform) => boolean;
  /** The VIBE toggle (search-intent.ts): mood and tag words, read by the providers that can (KINO, the Archive). */
  vibe?: boolean;
  /** KINO only: a TMDB keyword number from /api/web/related, for the titles tagged with it. */
  keyword?: number;
  /**
   * The order asked for (SPEC-web-sort.md). Absent is the platform's own best match. A provider is only handed
   * an order it lists in `orders`; run.ts answers for the rest with "NO POPULARITY ORDER" or "CAN'T SORT BY DATE".
   */
  order?: SearchOrder;
};

/**
 * How a search is ordered (SPEC-web-sort.md): the platform's own best match, its own popularity order, or by date.
 * A count or rating may decide the order on the server; it is never part of an item, an answer or a log.
 */
export type SearchOrder = 'relevance' | 'popular' | 'newest' | 'oldest';
export const SEARCH_ORDERS: readonly SearchOrder[] = ['relevance', 'popular', 'newest', 'oldest'];

/**
 * A provider's place in its own results: a page number, an offset or the platform's own page token. It
 * travels inside the opaque search cursor (cursor.ts), and every provider re-validates what it gets back.
 */
export type ProviderPage = string | number;

/** A `type:` filter handed to a provider that can ask its platform for one kind (Internet Archive, Commons). */
export type SearchKind = 'video' | 'audio' | 'image' | 'text';
export const SEARCH_KINDS: readonly SearchKind[] = ['video', 'audio', 'image', 'text'];

export type SearchPage = {
  items: WebItem[];
  /** The next page, or null when the platform has no more. */
  next: ProviderPage | null;
  /** A plain note beside a good answer (KINO: "SORTED THE FIRST 500 MATCHES"); shown like a problem line. */
  note?: SearchProblem;
};

/**
 * Why a provider gave nothing, in the words the page shows after its name ("YOUTUBE: NOT SET UP").
 * Fixed sentences only: never a platform's message, a URL or a stack trace.
 */
export type SearchProblem =
  | 'NOT SET UP'
  | 'DAILY LIMIT REACHED'
  | 'KEY REFUSED'
  | 'NO ANSWER'
  | 'COULD NOT READ'
  // SPEC-web-sort.md: a site that cannot give the order asked for is not asked, and says so.
  | 'NO POPULARITY ORDER'
  | "CAN'T SORT BY DATE"
  // KINO read its first 500 matches to order them; a search with more says so (it answered all the same).
  | 'SORTED THE FIRST 500 MATCHES';

export class SearchProblemError extends Error {
  constructor(readonly problem: SearchProblem) {
    super(problem);
    this.name = 'SearchProblemError';
  }
}

export type SearchProvider = {
  platform: WebPlatform;
  /** The only hosts this provider fetches from (its API). Item addresses are held to `PLATFORM_HOSTS`. */
  allowedHosts: readonly string[];
  /** How long one search may take before the route stops waiting (Openverse is slow: 20s). */
  timeoutMs: number;
  /** The orders beyond best match this platform can really give (SPEC-web-sort.md); absent: best match only. */
  orders?: readonly Exclude<SearchOrder, 'relevance'>[];
  /** A longer wait for a sorted search that reads many pages (KINO's 25, YouTube's date windows). */
  sortedTimeoutMs?: number;
  /**
   * For a platform whose quota is small (YouTube ~100 searches a day, Openverse 200 requests a day shared with
   * the stream): at most this many searches a day per visitor address and per server instance.
   */
  dailyBudget?: { perAddress: number; perInstance: number };
  /** Spends `dailyBudget` itself, only on the requests that cost quota (YouTube's fallback), instead of up front. */
  spendsOwnBudget?: boolean;
  /**
   * One page of results for the words of a search (`searchText`: letters and digits only). With `byAuthor`,
   * `author` is a `from:` creator's words (letters and digits, space-separated) for the platform's own creator
   * filter, and `words` may then be empty; run.ts keeps only the matching creators either way. With `kind`
   * (a `type:` filter) a platform that can ask for one kind does; the page keeps only that kind either way.
   */
  search(words: string, page: ProviderPage | null, deps: SearchDeps, author?: string, kind?: SearchKind): Promise<SearchPage>;
  /** The platform can ask for one creator itself (Internet Archive, Openverse); the rest search the name as words. */
  byAuthor?: boolean;
  /**
   * One item by its external id, from the platform's own API: how the hourly ingest saves an item someone
   * opened (`web_requests`). Null when the platform no longer has it, or it is not one WEB keeps.
   */
  fetchOne(externalId: string, deps: SearchDeps): Promise<WebItem | null>;
};
