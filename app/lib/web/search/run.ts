import { compareItems } from '../paging';
import { matchesAuthor, MAX_QUERY_WORDS } from '../search';
import { SafeFetchError } from '../safe-fetch';
import type { WebItem, WebPlatform } from '../types';
import { decodeSearchCursor, encodeSearchCursor, type SearchCursor } from './cursor';
import type { SearchKind } from './types';
import { SearchProblemError, type ProviderPage, type SearchDeps, type SearchProblem, type SearchProvider } from './types';

/**
 * One search across every provider (SPEC-web-search.md). SERVER ONLY.
 *
 * - every provider is asked at once, each with its own time limit, so none holds up the others for longer
 *   than its own wait (the slowest, Openverse, is 20s);
 * - a provider that fails or is too slow becomes one plain line ("OPENVERSE: NO ANSWER") and the rest still show;
 * - the results are one list, newest first; LOAD MORE asks each provider that had more for its own next page.
 */

/** What became of one provider in this search: null when it answered (even with nothing). */
export type ProviderStatus = { platform: WebPlatform; problem: SearchProblem | null };

export type EverywhereResult = { items: WebItem[]; statuses: ProviderStatus[]; nextCursor: string | null };

/** Grace on top of a provider's own fetch timeout, for parsing; past it the route stops waiting. */
const GRACE_MS = 1_500;

/** A failure, as the one fixed phrase the page shows. */
export function problemOf(error: unknown): SearchProblem {
  if (error instanceof SearchProblemError) return error.problem;
  if (error instanceof SafeFetchError) {
    if (error.status === undefined) return 'NO ANSWER';
    return error.status === 429 ? 'DAILY LIMIT REACHED' : 'COULD NOT READ';
  }
  return 'COULD NOT READ';
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SearchProblemError('NO ANSWER')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * `cursor` null is a new search (every provider, first page); otherwise only the providers it names. An
 * unreadable cursor is treated as the end of the results, never as a new search.
 *
 * `author` (a `from:` creator's words, search.ts `authorWords`): a provider that can filter by creator
 * (`byAuthor`) is handed it; the others search the name as extra words. Either way only items whose creator
 * matches are kept, so a platform without a creator filter finds fewer, never someone else's.
 */
export async function searchEverywhere(
  words: string,
  cursor: string | null,
  providers: readonly SearchProvider[],
  deps: SearchDeps = {},
  author: readonly string[] | null = null,
  kind?: SearchKind,
): Promise<EverywhereResult> {
  const platforms = providers.map((provider) => provider.platform);
  let pages: Partial<Record<WebPlatform, ProviderPage | null>>;
  if (cursor === null) {
    pages = Object.fromEntries(platforms.map((platform) => [platform, null]));
  } else {
    const decoded = decodeSearchCursor(cursor, platforms);
    if (decoded === null) return { items: [], statuses: [], nextCursor: null };
    pages = decoded;
  }

  const asked = providers.filter((provider) => provider.platform in pages);
  const name = author === null ? null : author.join(' ');
  const ask = (provider: SearchProvider) => {
    const page = pages[provider.platform] ?? null;
    if (name === null) return provider.search(words, page, deps, undefined, kind);
    if (provider.byAuthor) return provider.search(words, page, deps, name, kind);
    // The name first, then the words, within the usual word cap; the creator check below keeps the result right.
    return provider.search([...(author ?? []), ...words.split(' ').filter(Boolean)].slice(0, MAX_QUERY_WORDS).join(' '), page, deps, undefined, kind);
  };
  const settled = await Promise.allSettled(
    asked.map((provider) =>
      // A quota-limited provider over its day's budget is not asked at all.
      provider.dailyBudget && !provider.spendsOwnBudget && deps.spendBudget && !deps.spendBudget(provider.platform)
        ? Promise.reject(new SearchProblemError('DAILY LIMIT REACHED'))
        : withTimeout(ask(provider), provider.timeoutMs + GRACE_MS),
    ),
  );

  const statuses: ProviderStatus[] = [];
  const next: SearchCursor = {};
  const byId = new Map<string, WebItem>();
  settled.forEach((outcome, index) => {
    const { platform } = asked[index];
    if (outcome.status === 'rejected') {
      statuses.push({ platform, problem: problemOf(outcome.reason) });
      return;
    }
    statuses.push({ platform, problem: null });
    // A provider answers only for itself: an item claiming another platform is dropped.
    for (const item of outcome.value.items) {
      if (author !== null && !matchesAuthor(item, [author])) continue;
      if (item.platform === platform && !byId.has(item.id)) byId.set(item.id, item);
    }
    if (outcome.value.next !== null) next[platform] = outcome.value.next;
  });

  return { items: [...byId.values()].sort(compareItems), statuses, nextCursor: encodeSearchCursor(next) };
}
